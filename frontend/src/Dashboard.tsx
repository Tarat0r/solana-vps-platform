import { useEffect, useEffectEvent, useMemo, useState } from 'react';
import { address, createSolanaRpc, getAddressDecoder, isAddress, isSolanaError, SOLANA_ERROR__JSON_RPC__SERVER_ERROR_SEND_TRANSACTION_PREFLIGHT_FAILURE } from '@solana/kit';
import type { Address, Instruction } from '@solana/kit';
import {
  confirmFinalized, describeError, estimateCost, explorerUrl, formatPeriod, formatSol, grantAddress, grantInstruction, isForSale,
  loadDashboardConfig, loadReceipts, loadServerState, NO_OWNER, paidCost, PAYMENT_OVERHEAD_LAMPORTS, paymentInstruction, receiptAddress,
  requestTestSol, revokeInstruction, sendSignedTransaction, signatureStatus, sshCommand, transactionSignature, unsignedTransaction, walletBalance,
} from './billing.ts';
import type { DashboardConfig, Grant, PaidCost, Receipt, ServerConfig, ServerState, TransactionCost } from './billing.ts';
import { checkPending, newPaymentId, pendingKey, PendingStore } from './payments.ts';
import type { PaymentOperation, PendingPayment, Reconciliation } from './payments.ts';
import { CopyButton, shorten, Spinner, TerminalIcon } from './ui.tsx';
import { connectWallet, extensionsBlockedHere, signWalletTransaction, walletCanConnect, walletProvider, WalletTimeoutError } from './wallets.ts';
import type { WalletConnection, WalletName } from './wallets.ts';

const wallets: WalletName[] = ['Phantom', 'Solflare'];
const formatDate = (seconds: bigint) => new Date(Number(seconds) * 1000).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' });
const unixNow = () => BigInt(Math.floor(Date.now() / 1000));
const pad = (value: number) => String(value).padStart(2, '0');
const toLocalInput = (seconds: bigint) => {
  const date = new Date(Number(seconds) * 1000);
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
};
const fromLocalInput = (value: string) => {
  const milliseconds = new Date(value).getTime();
  return Number.isFinite(milliseconds) ? BigInt(Math.floor(milliseconds / 1000)) : null;
};
const walletRejected = (error: unknown) =>
  ((error as { code?: number }).code ?? (error as { error?: { code?: number } }).error?.code) === 4001;

const relativeTime = new Intl.RelativeTimeFormat(undefined, { numeric: 'auto' });
const timeUnits: [Intl.RelativeTimeFormatUnit, number][] = [['day', 86_400], ['hour', 3_600], ['minute', 60], ['second', 1]];
/** "in 30 days", "3 hours ago": the largest whole unit between now and `seconds`. */
function fromNow(seconds: bigint, now: bigint): string {
  const delta = Number(seconds - now);
  const [unit, size] = timeUnits.find(([, size]) => Math.abs(delta) >= size) ?? ['second', 1];
  return relativeTime.format(Math.round(delta / size), unit);
}

/** Expiry shortcuts for shared access; `null` is the end of the owner's term. */
const accessPresets: [string, bigint | null][] = [['1 day', 86_400n], ['7 days', 604_800n], ['Until your access ends', null]];

/** A wallet that has never had access, to price the first grant before an address is entered. */
const unknownWallet = () => getAddressDecoder().decode(crypto.getRandomValues(new Uint8Array(32)));

/** Browse servers lists every server; My servers lists those the connected wallet owns. */
type View = 'browse' | 'mine';
const MINE_HASH = '#my-servers';

const store = new PendingStore((() => { try { return window.localStorage; } catch { return undefined; } })());
const NO_RECEIPTS: Receipt[] = [];

/** One server's status for the connected wallet, as shown in the server list. */
function serverStatus(state: ServerState | null | undefined, wallet: Address | null, now: bigint) {
  if (state === undefined) return 'Loading…';
  if (state === null) return 'Not registered';
  if (!state.record.enabled) return 'Disabled';
  const active = state.paidUntil > now;
  if (wallet && state.record.ownerWallet === wallet) return active ? 'Owned by you' : 'Your access expired';
  if (wallet && active && state.delegates.some(grant => grant.wallet === wallet)) return 'Shared with you';
  return isForSale(state, now) ? 'Available' : 'Taken';
}

const tones: Record<string, string> = {
  Available: 'success', 'Owned by you': 'accent', 'Shared with you': 'accent', 'Your access expired': 'warning',
  Disabled: 'danger', 'Disabled by the provider': 'danger',
};

function StatusPill({ status }: { status: string }) {
  return <span className={`pill pill-${tones[status] ?? 'neutral'}`}>{status}</span>;
}

const grantStatus = (grant: Grant) => `Until ${formatDate(grant.validUntil)}`;

/**
 * A cost estimate for `key`, which names everything the estimate depends on; it is
 * re-read on each refresh. Undefined while loading, null when the RPC could not estimate.
 */
function useCostEstimate(key: string | null, estimate: () => Promise<TransactionCost>, refreshes: number) {
  const [result, setResult] = useState<{ key: string; cost: TransactionCost | null } | null>(null);
  const run = useEffectEvent(estimate);
  useEffect(() => {
    if (!key) return;
    let cancelled = false;
    void run().catch(() => null).then(cost => {
      // A failed re-read keeps the last estimate for the same key.
      if (!cancelled) setResult(current => cost === null && current?.key === key ? current : { key, cost });
    });
    return () => { cancelled = true; };
  }, [key, refreshes]);
  return key !== null && result?.key === key ? result.cost : undefined;
}

/** Itemized cost of a payment before it is signed. */
function CostBreakdown({ cost, price }: { cost: TransactionCost | null | undefined; price: bigint }) {
  if (cost === undefined) return <p className="loading with-spinner"><Spinner />Estimating the network fee and rent…</p>;
  return <dl className="cost-breakdown">
    <div><dt>Server price</dt><dd>{formatSol(price)}</dd></div>
    {cost ? <>
      <div><dt>Network fee</dt><dd>{formatSol(cost.fee)}</dd></div>
      {cost.rent > 0n && <div><dt>Account rent<small>Held by the on-chain records this payment creates</small></dt><dd>{formatSol(cost.rent)}</dd></div>}
    </> : <div><dt>Network fee and account rent</dt><dd>up to {formatSol(PAYMENT_OVERHEAD_LAMPORTS)}</dd></div>}
    <div className="cost-total"><dt>Total from your wallet</dt><dd>{cost ? formatSol(cost.total) : `up to ${formatSol(price + PAYMENT_OVERHEAD_LAMPORTS)}`}</dd></div>
  </dl>;
}

export function Dashboard() {
  const [config, setConfig] = useState<DashboardConfig | null | undefined>(undefined);
  // Finalized state of every listed server, keyed by server ID; one is selected.
  const [states, setStates] = useState<Record<string, ServerState | null>>({});
  const [view, setView] = useState<View>(() => window.location.hash === MINE_HASH ? 'mine' : 'browse');
  // Each menu keeps its own selection.
  const [browseId, setBrowseId] = useState<string | null>(null);
  const [mineId, setMineId] = useState<string | null>(null);
  // A server just bought opens in My servers once its finalized state shows the new owner.
  const [openWhenOwned, setOpenWhenOwned] = useState<string | null>(null);
  // The selected server's payment history, and the server and wallet it was read for.
  const [loadedReceipts, setLoadedReceipts] = useState<{ key: string; receipts: Receipt[] } | null>(null);
  // What each finalized payment took from the wallet, keyed by receipt address; receipts never change.
  const [paidCosts, setPaidCosts] = useState<Record<string, PaidCost | null>>({});
  const [loadError, setLoadError] = useState<string | null>(null);
  const [refreshes, setRefreshes] = useState(0);
  const [available, setAvailable] = useState<WalletName[]>([]);
  const [connection, setConnection] = useState<WalletConnection | null>(null);
  const [pending, setPending] = useState<PendingPayment | null>(null);
  // The storage key `pending` was read from, and the latest chain check of that payment.
  const [pendingFor, setPendingFor] = useState<string | null>(null);
  const [checked, setChecked] = useState<{ pending: PendingPayment; result: Reconciliation } | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [delegateWallet, setDelegateWallet] = useState('');
  const [delegateUntil, setDelegateUntil] = useState('');
  const [delegateError, setDelegateError] = useState<string | null>(null);
  const [confirming, setConfirming] = useState<PaymentOperation | null>(null);
  const [loadedBalance, setLoadedBalance] = useState<{ wallet: Address; value: bigint } | null>(null);
  const [now, setNow] = useState(unixNow);
  const rpc = useMemo(() => config ? createSolanaRpc(config.rpcUrl) : null, [config]);
  const wallet = connection ? address(connection.address) : null;
  const statesLoaded = !!config && config.servers.every(item => item.serverId in states);
  const owned = config && wallet ? config.servers.filter(item => states[item.serverId]?.record.ownerWallet === wallet) : [];
  const target: ServerConfig | undefined = view === 'mine'
    ? owned.find(item => item.serverId === mineId) ?? owned[0]
    : config?.servers.find(item => item.serverId === browseId) ?? config?.servers[0];
  const state = target ? states[target.serverId] : undefined;
  const refresh = () => setRefreshes(value => value + 1);
  const balance = wallet && loadedBalance?.wallet === wallet ? loadedBalance.value : null;
  const reconciliation = checked && checked.pending === pending ? checked.result : null;

  // A payment recorded in this browser stays pending until a finalized receipt or proof that it cannot land.
  const currentPendingKey = config && target && wallet ? pendingKey(config, target, wallet) : null;
  if (pendingFor !== currentPendingKey) {
    setPendingFor(currentPendingKey);
    setPending(currentPendingKey ? store.get(currentPendingKey) : null);
    setConfirming(null);
  }

  const record = state?.record;
  const hasOwner = !!record && record.ownerWallet !== NO_OWNER;
  const isOwner = hasOwner && wallet === record.ownerWallet;
  const forSale = !!state && isForSale(state, now);
  const ownerActive = !!state && state.paidUntil > now && !!state.ownerGrant?.active && state.ownerGrant.validUntil > now;
  const ownGrant = state?.delegates.find(item => item.wallet === wallet);
  const hasAccess = !!record?.enabled && ownerActive && (isOwner || !!ownGrant);
  const operation: PaymentOperation | null = !connection || !record?.enabled ? null : isOwner ? 'renew' : forSale ? 'purchase' : null;
  const validDelegate = isAddress(delegateWallet) && delegateWallet !== wallet ? delegateWallet : null;

  useEffect(() => {
    document.title = `${view === 'mine' ? 'My servers' : 'Browse servers'} · Wallet SSH`;
    // The hash keeps the menu across reloads, such as while a payment finalizes.
    window.history.replaceState(null, '', view === 'mine' ? MINE_HASH : `${window.location.pathname}${window.location.search}`);
  }, [view]);

  const openIfOwned = useEffectEvent((loaded: Record<string, ServerState | null>) => {
    if (!openWhenOwned || !wallet || loaded[openWhenOwned]?.record.ownerWallet !== wallet) return;
    setMineId(openWhenOwned); setView('mine'); setOpenWhenOwned(null);
    window.scrollTo(0, 0);
  });

  useEffect(() => {
    const controller = new AbortController();
    void loadDashboardConfig(controller.signal).then(setConfig).catch(error => {
      if (!controller.signal.aborted) { setConfig(null); setLoadError(describeError(error)); }
    });
    return () => controller.abort();
  }, []);

  useEffect(() => {
    const update = () => {
      setNow(unixNow());
      setAvailable(current => {
        const detected = wallets.filter(name => walletProvider(name));
        return detected.join() === current.join() ? current : detected;
      });
    };
    update();
    const interval = window.setInterval(update, 1000);
    return () => window.clearInterval(interval);
  }, []);

  useEffect(() => {
    if (!connection) return;
    const changed = () => { setConnection(null); setActionError('Your wallet account changed or disconnected. Connect your wallet again.'); };
    connection.provider.on?.('connect', changed);
    connection.provider.on?.('disconnect', changed);
    return () => {
      connection.provider.removeListener?.('connect', changed);
      connection.provider.removeListener?.('disconnect', changed);
    };
  }, [connection]);

  useEffect(() => {
    if (!config || !rpc) return;
    let cancelled = false;
    void (async () => {
      try {
        const loaded = await Promise.all(config.servers.map(async item => [item.serverId, await loadServerState(rpc, config, item)] as const));
        if (!cancelled) {
          const next = Object.fromEntries(loaded);
          setStates(next);
          setLoadError(null);
          openIfOwned(next);
        }
      } catch (error) {
        if (!cancelled) setLoadError(`Server state could not be read: ${describeError(error)}`);
      }
    })();
    return () => { cancelled = true; };
  }, [config, rpc, refreshes]);

  useEffect(() => {
    if (!rpc || !wallet) return;
    let cancelled = false;
    void walletBalance(rpc, wallet).then(value => { if (!cancelled) setLoadedBalance({ wallet, value }); }).catch(() => {});
    return () => { cancelled = true; };
  }, [rpc, wallet, refreshes, pending]);

  // Payment history is owner-only detail, loaded for the selected server.
  const server = state?.server;
  const receipts = server && wallet && loadedReceipts?.key === `${server}:${wallet}` ? loadedReceipts.receipts : NO_RECEIPTS;
  useEffect(() => {
    if (!config || !rpc || !server || !wallet) return;
    let cancelled = false;
    void loadReceipts(rpc, config.programId, server, wallet)
      .then(history => { if (!cancelled) setLoadedReceipts({ key: `${server}:${wallet}`, receipts: history }); }).catch(() => {});
    return () => { cancelled = true; };
  }, [config, rpc, server, wallet, refreshes]);

  const costUnknown = useEffectEvent((receipt: Receipt) => !(receipt.address in paidCosts));
  useEffect(() => {
    if (!config || !rpc) return;
    const missing = receipts.filter(receipt => costUnknown(receipt));
    if (missing.length === 0) return;
    let cancelled = false;
    void (async () => {
      // One at a time: public RPCs rate-limit transaction history reads.
      for (const receipt of missing) {
        const cost = await paidCost(rpc, config.programId, receipt).catch(() => null);
        if (cancelled) return;
        setPaidCosts(current => ({ ...current, [receipt.address]: cost }));
      }
    })();
    return () => { cancelled = true; };
  }, [config, rpc, receipts]);

  const subscription = state?.subscription;
  const price = state?.record.priceLamports;
  useEffect(() => {
    if (!rpc || !config || !target || !wallet || !server || !subscription || price === undefined || !pending) return;
    let cancelled = false;
    let timer: number | undefined;
    const check = async () => {
      try {
        const result = await checkPending(rpc, { programId: config.programId, server, subscription, payer: wallet, amount: price }, pending);
        if (cancelled) return;
        if (result.state === 'completed') {
          store.clear(pendingKey(config, target, wallet));
          setPending(null);
          setActionError(null);
          setNotice(`Payment confirmed. Access is paid until ${formatDate(result.receipt.paidUntil)}.`);
          if (pending.operation === 'purchase') setOpenWhenOwned(target.serverId);
          refresh();
          return;
        }
        setChecked({ pending, result });
        if (result.state === 'pending') timer = window.setTimeout(() => void check(), 1500);
      } catch {
        if (!cancelled) timer = window.setTimeout(() => void check(), 3000);
      }
    };
    void check();
    return () => { cancelled = true; window.clearTimeout(timer); };
  }, [rpc, config, target, wallet, server, subscription, price, pending]);

  async function ownerAccounts(delegate: Address) {
    if (!config || !wallet || !state) throw new Error('Connect the owner wallet first.');
    return {
      programId: config.programId, owner: wallet, server: state.server, subscription: state.subscription,
      ownerGrant: await grantAddress(config.programId, state.server, wallet),
      grant: await grantAddress(config.programId, state.server, delegate),
    };
  }

  // The fee does not depend on the payment ID, and a fresh one never has a receipt yet.
  const paymentCost = useCostEstimate(operation && target && wallet && record ? [operation, target.serverId, wallet, record.priceLamports].join(':') : null, async () => {
    if (!rpc || !config || !state || !wallet || !operation) throw new Error('Nothing to estimate.');
    const paymentId = newPaymentId();
    const ownerGrant = await grantAddress(config.programId, state.server, wallet);
    const receipt = await receiptAddress(config.programId, state.server, paymentId);
    const ix = paymentInstruction(operation, {
      programId: config.programId, owner: wallet, server: state.server, subscription: state.subscription, ownerGrant, receipt, treasury: state.record.treasury,
    }, paymentId);
    return estimateCost(rpc, config.programId, wallet, ix, state.record.priceLamports, [[receipt, 'PaymentReceipt'], [ownerGrant, 'AccessGrant']]);
  }, refreshes);

  const grantCost = useCostEstimate(isOwner && ownerActive && record?.enabled && target && wallet ? ['grant', target.serverId, wallet, validDelegate].join(':') : null, async () => {
    if (!rpc || !config || !state) throw new Error('Nothing to estimate.');
    const delegate = validDelegate ? address(validDelegate) : unknownWallet();
    const accounts = await ownerAccounts(delegate);
    return estimateCost(rpc, config.programId, accounts.owner, grantInstruction(accounts, delegate, state.paidUntil), 0n, [[accounts.grant, 'AccessGrant']]);
  }, refreshes);

  function showView(next: View, serverId?: string) {
    if (serverId) (next === 'mine' ? setMineId : setBrowseId)(serverId);
    setView(next); setActionError(null); setNotice(null); setDelegateError(null);
    window.scrollTo(0, 0);
  }

  function selectServer(serverId: string) {
    (view === 'mine' ? setMineId : setBrowseId)(serverId);
    setActionError(null); setNotice(null); setDelegateError(null);
  }

  async function connect(name: WalletName) {
    setBusy(`Connecting to ${name}… Approve the request in ${name}. If no ${name} window opens, reload this page.`);
    setActionError(null);
    try { setConnection(await connectWallet(name)); }
    catch (error) {
      setActionError(error instanceof WalletTimeoutError ? error.message : `Could not connect to ${name}. Open your wallet and try again.`);
    }
    finally { setBusy(null); }
  }

  async function disconnect() {
    const previous = connection;
    setConnection(null); setActionError(null); setNotice(null);
    try { await previous?.provider.disconnect(); } catch { /* Local disconnect is enough. */ }
  }

  async function pay(operation: PaymentOperation) {
    if (!rpc || !config || !target || !connection || !wallet || !state) return;
    const key = pendingKey(config, target, wallet);
    // A retry keeps its payment ID, so an earlier attempt can never charge twice.
    const previous = reconciliation?.state === 'retry' ? pending : null;
    const attempt: PendingPayment = previous
      ? { operation: previous.operation, paymentId: previous.paymentId, createdAt: previous.createdAt }
      : { operation, paymentId: newPaymentId(), createdAt: Date.now() };
    setConfirming(null); setActionError(null); setNotice(null);
    try {
      store.set(key, attempt);
      setBusy('Preparing payment…');
      const { wire, lastValidBlockHeight } = await unsignedTransaction(rpc, wallet, paymentInstruction(attempt.operation, {
        programId: config.programId, owner: wallet, server: state.server, subscription: state.subscription,
        ownerGrant: await grantAddress(config.programId, state.server, wallet),
        receipt: await receiptAddress(config.programId, state.server, attempt.paymentId), treasury: state.record.treasury,
      }, attempt.paymentId));
      setBusy('Confirm the payment in your wallet…');
      let signed: Uint8Array;
      try { signed = await signWalletTransaction(connection, wire); }
      catch (error) { store.clear(key); setPending(null); throw error; }
      const sent = { ...attempt, signature: transactionSignature(signed, wallet), lastValidBlockHeight: String(lastValidBlockHeight) };
      store.set(key, sent);
      setBusy('Sending payment…');
      try { await sendSignedTransaction(rpc, signed); }
      catch (error) {
        // A failed preflight never reached the network; anything else may still land.
        if (isSolanaError(error, SOLANA_ERROR__JSON_RPC__SERVER_ERROR_SEND_TRANSACTION_PREFLIGHT_FAILURE)) { store.clear(key); setPending(null); throw error; }
        setActionError('The payment result is not confirmed yet. It is safe to wait or reload: it will not be charged twice.');
      }
      setPending(sent);
    } catch (error) {
      setActionError(walletRejected(error) ? 'Payment was cancelled in your wallet. Nothing was charged.' : describeError(error));
    } finally { setBusy(null); }
  }

  async function addTestSol() {
    if (!rpc || !wallet) return;
    setActionError(null); setNotice(null);
    try {
      setBusy('Requesting 10 test SOL…');
      const signature = await requestTestSol(rpc, wallet, 10n);
      for (let attempt = 0; attempt < 60; attempt++) {
        const status = await signatureStatus(rpc, signature);
        if (status?.err) throw new Error('The airdrop failed.');
        if (status?.confirmationStatus === 'confirmed' || status?.confirmationStatus === 'finalized') break;
        await new Promise(resolve => setTimeout(resolve, 500));
      }
      setNotice('Added 10 test SOL to this wallet.');
      refresh();
    } catch (error) {
      setActionError(`Could not get test SOL: ${describeError(error)}`);
    } finally { setBusy(null); }
  }

  function discardPayment() {
    if (!config || !target || !wallet || reconciliation?.state !== 'retry') return;
    store.clear(pendingKey(config, target, wallet));
    setPending(null); setActionError(null);
  }

  async function ownerTransaction(ix: Instruction, done: string) {
    if (!rpc || !connection || !wallet) return;
    setActionError(null); setNotice(null);
    try {
      setBusy('Confirm in your wallet…');
      const { wire, lastValidBlockHeight } = await unsignedTransaction(rpc, wallet, ix);
      const signed = await signWalletTransaction(connection, wire);
      const signature = transactionSignature(signed, wallet);
      setBusy('Waiting for Solana to finalize the change…');
      await sendSignedTransaction(rpc, signed);
      await confirmFinalized(rpc, signature, lastValidBlockHeight);
      setNotice(done);
      refresh();
    } catch (error) {
      setActionError(walletRejected(error) ? 'The change was cancelled in your wallet.' : describeError(error));
    } finally { setBusy(null); }
  }

  async function grant() {
    if (!state || !wallet) return;
    const until = fromLocalInput(delegateUntil || toLocalInput(state.paidUntil));
    if (!validDelegate) { setDelegateError('Enter another wallet address to share access with.'); return; }
    if (until === null || until <= unixNow() || until > state.paidUntil) { setDelegateError(`Choose an expiry after now and no later than ${formatDate(state.paidUntil)}.`); return; }
    setDelegateError(null);
    const delegate = address(validDelegate);
    await ownerTransaction(grantInstruction(await ownerAccounts(delegate), delegate, until), `Access shared with ${shorten(delegate)} until ${formatDate(until)}.`);
    setDelegateWallet('');
  }

  async function revoke(delegate: Address) {
    await ownerTransaction(revokeInstruction(await ownerAccounts(delegate), delegate), `Access revoked for ${shorten(delegate)}.`);
  }

  const needed = record ? paymentCost?.total ?? record.priceLamports + PAYMENT_OVERHEAD_LAMPORTS : 0n;
  const lowBalance = balance !== null && !!record && balance < needed;
  const paymentOpen = pending !== null || busy !== null || lowBalance;
  const period = record ? formatPeriod(record.periodSeconds) : '';
  const status = state ? (state.record.enabled ? serverStatus(state, wallet, now) : 'Disabled by the provider') : '';
  // Total of every payment, once each one's transaction has been read.
  const spent = receipts.length > 0 && receipts.every(receipt => paidCosts[receipt.address])
    ? receipts.reduce((sum, receipt) => sum + paidCosts[receipt.address]!.total, 0n) : null;
  const step = !connection ? 0 : !hasAccess ? 1 : 2;
  // Shown before paying; the program computes the final term from the chain clock.
  const newExpiry = (operation: PaymentOperation) =>
    (operation === 'renew' && state && state.paidUntil > now ? state.paidUntil : now) + (record?.periodSeconds ?? 0n);

  const pendingNotice = pending && reconciliation && <div className={`notice ${reconciliation.state === 'retry' || reconciliation.state === 'invalid' ? 'notice-error' : ''}`} role="status">
    {reconciliation.state === 'pending' ? <><h2 className="with-spinner"><Spinner />Payment in progress</h2><p>Waiting for Solana to finalize your {pending.operation === 'purchase' ? 'purchase' : 'renewal'}. This page checks the receipt before showing access as paid.</p></>
      : reconciliation.state === 'invalid' ? <><h2>Payment needs attention</h2><p>A receipt exists for this payment but does not match this wallet and server. Do not pay again; contact the provider.</p></>
      : reconciliation.state === 'retry' && <><h2>{reconciliation.reason === 'failed' ? 'Payment failed' : reconciliation.reason === 'expired' ? 'Payment expired' : 'Payment was not signed'}</h2>
        <p>{reconciliation.reason === 'failed' ? `${reconciliation.error ?? 'The transaction failed.'} No SOL was transferred.` : 'It was not processed, so no SOL was transferred.'} Retrying reuses the same payment ID.</p>
        <div className="button-row"><button className="secondary-button" onClick={() => void pay(pending.operation)} disabled={busy !== null}>Retry payment</button><button className="text-button" onClick={discardPayment} disabled={busy !== null}>Cancel payment</button></div></>}
  </div>;

  // Every payment is a deliberate two-step action: review the terms and cost, then pay.
  const payment = (operation: PaymentOperation) => record && <>
    {pendingNotice}
    {!pending && lowBalance && <p className="callout callout-warning">This wallet has {formatSol(balance)} on {config?.cluster}; paying needs {formatSol(needed)}, including the network fee and account rent.{config?.cluster === 'localnet' && ' Use "Add 10 test SOL" above.'}</p>}
    {!pending && (confirming === operation
      ? <div className="confirm-panel" role="group" aria-labelledby="confirm-title">
        <h3 id="confirm-title">{operation === 'purchase' ? 'Confirm purchase' : 'Confirm renewal'}</h3>
        <dl className="login-details">
          {operation === 'renew' && <div><dt>Current access until</dt><dd>{formatDate(state.paidUntil)}</dd></div>}
          <div><dt>{operation === 'renew' ? 'New expiry' : 'Access until'}</dt><dd>about {formatDate(newExpiry(operation))}</dd></div>
        </dl>
        <CostBreakdown cost={paymentCost} price={record.priceLamports} />
        <p className="muted">Your wallet asks you to approve this payment next.</p>
        <div className="button-row">
          <button className="primary-button" onClick={() => void pay(operation)} disabled={paymentOpen || !record.enabled || paymentCost === undefined}>Pay {formatSol(paymentCost?.total ?? record.priceLamports)}</button>
          <button className="text-button" onClick={() => setConfirming(null)} disabled={busy !== null}>Cancel</button>
        </div>
      </div>
      : <>
        <button className="primary-button" onClick={() => { setConfirming(operation); setActionError(null); setNotice(null); }} disabled={paymentOpen || !record.enabled}>
          {operation === 'purchase' ? `Buy access for ${formatSol(record.priceLamports)}…` : `Renew for ${formatSol(record.priceLamports)}…`}</button>
        {paymentCost && <p className="cost-hint">{formatSol(paymentCost.total)} in total with the network fee and account rent.</p>}
      </>)}
  </>;

  const serverPicker = (title: string, items: ServerConfig[], summary: (state: ServerState) => string) => target &&
    <section className="server-picker" aria-labelledby="servers-title">
      <h2 id="servers-title" className="section-label">{title}</h2>
      <ul className="server-list">{items.map(item => {
        const selected = item.serverId === target.serverId;
        const itemState = states[item.serverId];
        return <li key={item.serverId}><button className={`server-option${selected ? ' selected' : ''}`} aria-pressed={selected}
          onClick={() => selectServer(item.serverId)} disabled={busy !== null}>
          <span className="server-option-head"><strong>{item.name}</strong><StatusPill status={serverStatus(itemState, wallet, now)} /></span>
          <span className="muted">{itemState ? summary(itemState) : ' '}</span>
        </button></li>;
      })}</ul>
    </section>;

  const serverDetails = config && target && <>
    <div className="server-card">
      <div className="server-hero">
        <strong>{target.name}</strong>
        <span>Server <code title={target.serverId}>{shorten(target.serverId)}</code> on {config.cluster}</span>
      </div>
      {loadError ? <div className="notice notice-error" role="alert"><h2>Server state is unavailable</h2><p>{loadError}</p><button className="secondary-button" onClick={refresh}>Try again</button></div>
        : state === undefined ? <p className="loading with-spinner" role="status"><Spinner />Reading finalized server state…</p>
        : state === null ? <div className="notice notice-error" role="alert"><h2>This server is not registered yet</h2><p>The provider has not registered this server with the billing program.</p></div>
        : <dl className="login-details">
          <div><dt>Price</dt><dd>{formatSol(state.record.priceLamports)} per {period}</dd></div>
          <div><dt>Status</dt><dd><StatusPill status={status} /></dd></div>
          {isOwner && <div><dt>Your access</dt><dd className={ownerActive ? '' : 'urgent'}>{ownerActive ? `Until ${formatDate(state.paidUntil)}` : `Expired ${formatDate(state.paidUntil)}`} <span className="relative">{fromNow(state.paidUntil, now)}</span></dd></div>}
        </dl>}
    </div>
    {state && !loadError && hasAccess && <div className="ssh-card">
      <div className="ssh-card-head"><span>Log in with SSH</span><CopyButton text={sshCommand(target)} label="Copy SSH command" /></div>
      <code className="ssh-command">{sshCommand(target)}</code>
      <p>Run this in your terminal, open the signing link it prints, and approve the login with this wallet.</p>
    </div>}
  </>;

  const walletSection = config && <section className="wallet-section wallet-panel" aria-labelledby="wallet-title">
    <h2 id="wallet-title">Your wallet</h2>
    {connection ? <><div className="connected-wallet"><span className={`wallet-symbol ${connection.name.toLowerCase()}`} aria-hidden="true">{connection.name[0]}</span>
      <div><strong>{connection.name} connected</strong><code title={connection.address}>{shorten(connection.address)}</code></div>
      <CopyButton text={connection.address} label="Copy your address" />
      <button className="text-button" onClick={() => void disconnect()} disabled={busy !== null}>Disconnect</button></div>
      <div className="wallet-balance"><span>Balance on {config.cluster}: <strong>{balance === null ? '…' : formatSol(balance)}</strong></span>
        {config.cluster === 'localnet' && <button className="text-button" onClick={() => void addTestSol()} disabled={busy !== null}>Add 10 test SOL</button>}</div></>
      : <><div className="wallet-options" role="group" aria-label="Choose a wallet">{wallets.map(name => <button key={name} className="wallet-button" onClick={() => void connect(name)} disabled={busy !== null || !walletCanConnect(name)}><span className={`wallet-symbol ${name.toLowerCase()}`} aria-hidden="true">{name[0]}</span><span>Connect {name}<small>{available.includes(name) ? 'Detected' : walletCanConnect(name) ? 'Open wallet' : 'Not installed'}</small></span></button>)}</div>
        {extensionsBlockedHere(window.location) && <p className="muted">Wallet extensions do not run on this plain-HTTP address. Ask the operator for the HTTPS dashboard.</p>}
        <p className="muted">Connect a wallet to buy access or see your own access.</p></>}
  </section>;

  // Choosing and buying: every server, with what the connected wallet can do with it.
  const browsePanel = config && target && <>
    {serverPicker('Servers', config.servers, item => `${formatSol(item.record.priceLamports)} per ${formatPeriod(item.record.periodSeconds)}`)}
    {serverDetails}
    {state && !loadError && connection && <section className="dashboard-section" aria-labelledby="access-title">
      {isOwner ? <><h2 id="access-title">You own this server</h2><p className="muted">Renew it, share it with other wallets, and see its payments in My servers.</p>{pendingNotice}
        <button className="secondary-button" onClick={() => showView('mine', target.serverId)} disabled={busy !== null}>Manage in My servers</button></>
        : ownGrant ? <><h2 id="access-title">Shared access</h2><p>The owner shared this server with you. {grantStatus(ownGrant)}. Only the owner can pay or manage access.</p></>
        : forSale && state.record.enabled ? <><h2 id="access-title">Buy access</h2><p className="muted">You become the owner for {period}. You can then renew it and share it with other wallets. It goes back on sale if you do not renew in time.</p>{payment('purchase')}</>
        : <><h2 id="access-title">{state.record.enabled ? 'Not available' : 'Unavailable'}</h2><p>{state.record.enabled ? 'Another wallet owns this server. It becomes available to buy when that subscription ends.' : 'The provider has disabled this server, so it cannot be bought right now.'}</p>{pendingNotice}</>}
    </section>}
  </>;

  const sharedWithYou = config?.servers.filter(item => serverStatus(states[item.serverId], wallet, now) === 'Shared with you') ?? [];
  // Managing: only the servers the connected wallet owns.
  const minePanel = !connection ? <div className="empty-panel"><h2>Your servers appear here</h2><p>Connect a wallet above to see the servers it owns.</p></div>
    : !statesLoaded ? (loadError ? <div className="notice notice-error" role="alert"><h2>Server state is unavailable</h2><p>{loadError}</p><button className="secondary-button" onClick={refresh}>Try again</button></div>
      : <p className="loading with-spinner" role="status"><Spinner />Finding your servers…</p>)
    : owned.length === 0 || !target ? <div className="empty-panel"><h2>No servers yet</h2>
      <p>This wallet does not own any servers yet.{sharedWithYou.length > 0 && ` ${sharedWithYou.length === 1 ? 'The server' : 'Servers'} shared with you ${sharedWithYou.length === 1 ? 'is' : 'are'} in Browse servers, with ${sharedWithYou.length === 1 ? 'its' : 'their'} SSH command.`}</p>
      <button className="secondary-button" onClick={() => showView('browse')} disabled={busy !== null}>Find a server</button></div>
    : <>
      {serverPicker('Your servers', owned, item => `${item.paidUntil > now ? 'Expires' : 'Expired'} ${fromNow(item.paidUntil, now)}`)}
      {serverDetails}
      {state && !loadError && isOwner && <>
        <section className="dashboard-section" aria-labelledby="payment-title">
          <h2 id="payment-title">Renew access</h2>
          <p className="muted">Renewal adds {period} from {ownerActive ? 'your current expiry' : 'now'}. Shared access keeps its own expiry.{!ownerActive && ' Until you renew, any wallet can buy this server.'}</p>
          {payment('renew')}
        </section>

        <section className="dashboard-section" aria-labelledby="delegates-title">
          <h2 id="delegates-title">Shared access</h2>
          <p className="muted">Let other wallets log in to this server until a date you choose, within your paid term.</p>
          {state.delegates.length === 0 ? <p className="empty-state">No other wallets have access.</p>
            : <ul className="item-list">{state.delegates.map(item => <li key={item.address}><div><code title={item.wallet}>{shorten(item.wallet)}</code><span className="muted">{grantStatus(item)} · {fromNow(item.validUntil, now)}</span></div><button className="text-button danger" onClick={() => void revoke(item.wallet)} disabled={busy !== null || !ownerActive || !state.record.enabled} aria-label={`Revoke ${item.wallet}`}>Revoke</button></li>)}</ul>}
          <form className="delegate-form" noValidate onSubmit={event => { event.preventDefault(); void grant(); }}>
            <label>Wallet address<input value={delegateWallet} onChange={event => { setDelegateWallet(event.target.value.trim()); setDelegateError(null); }} placeholder="Solana address" spellCheck={false} autoComplete="off" aria-invalid={delegateError !== null} /></label>
            <label>Access until<input type="datetime-local" value={delegateUntil || (ownerActive ? toLocalInput(state.paidUntil) : '')} max={toLocalInput(state.paidUntil)} onChange={event => { setDelegateUntil(event.target.value); setDelegateError(null); }} /></label>
            <button className="secondary-button" type="submit" disabled={busy !== null || !ownerActive || !state.record.enabled}>Grant access</button>
          </form>
          {ownerActive && <div className="presets" role="group" aria-label="Access length">{accessPresets.map(([label, length]) =>
            <button key={label} type="button" className="chip" disabled={busy !== null}
              onClick={() => { setDelegateUntil(toLocalInput(length === null || now + length > state.paidUntil ? state.paidUntil : now + length)); setDelegateError(null); }}>{label}</button>)}</div>}
          {delegateError && <p className="field-error" role="alert">{delegateError}</p>}
          {grantCost && <p className="cost-hint">{grantCost.rent > 0n
            ? `${validDelegate ? 'Sharing with this wallet' : 'Sharing with a new wallet'} costs ${formatSol(grantCost.total)}: the ${formatSol(grantCost.fee)} network fee and ${formatSol(grantCost.rent)} rent for its access record.`
            : `Updating this wallet's access costs the ${formatSol(grantCost.fee)} network fee.`} Revoking costs only the network fee.</p>}
          {!ownerActive && <p className="muted">Sharing requires an active subscription.</p>}
        </section>

        <section className="dashboard-section" aria-labelledby="history-title">
          <div className="section-head"><h2 id="history-title">Payment history</h2>{spent !== null && <span className="muted">{formatSol(spent)} spent</span>}</div>
          {receipts.length === 0 ? <p className="empty-state">No finalized payments from this wallet.</p>
            : <ul className="item-list">{receipts.map(receipt => {
              const cost = paidCosts[receipt.address];
              return <li key={receipt.address}>
                <div><strong>{formatDate(receipt.paidAt)}</strong><span className="muted">Access until {formatDate(receipt.paidUntil)}</span></div>
                <div className="receipt-cost">
                  <strong>{formatSol(cost?.total ?? receipt.amount)}</strong>
                  {cost ? <span className="muted">{formatSol(cost.price)} price + {formatSol(cost.fee)} fee{cost.rent > 0n && ` + ${formatSol(cost.rent)} rent`}</span>
                    : cost === undefined && <span className="muted">Reading fees…</span>}
                  {cost && config && <a href={explorerUrl(config, cost.signature)} target="_blank" rel="noreferrer">View transaction</a>}
                </div>
              </li>;
            })}</ul>}
        </section>
      </>}
    </>;

  return <div className="app-shell">
    <header className="masthead"><a className="brand" href="/"><TerminalIcon /><span>Wallet SSH</span></a>
      {config && <nav className="view-nav" aria-label="Dashboard">
        <button aria-current={view === 'browse' ? 'page' : undefined} onClick={() => showView('browse')} disabled={busy !== null}>Browse servers</button>
        <button aria-current={view === 'mine' ? 'page' : undefined} onClick={() => showView('mine')} disabled={busy !== null}>
          My servers{connection && statesLoaded && <>{' '}<span className="nav-count">{owned.length}</span></>}</button>
      </nav>}
      {config ? <span className="cluster-badge">Solana {config.cluster}</span> : <span className="masthead-note">Server access</span>}</header>
    <main className="approval-layout">
      <section className="approval-sheet" aria-labelledby="page-title">
        <h1 id="page-title">{config && view === 'mine' ? 'My servers' : config ? 'Browse servers' : 'Server access'}</h1>
        <p className="intro">{config && view === 'mine'
          ? 'The servers this wallet owns. Renew them, share access with other wallets, and see what you paid.'
          : 'Choose a server to see its price and availability. Buy one with SOL to become its owner, then renew and share it.'}</p>

        {config === undefined ? <p className="loading with-spinner" role="status"><Spinner />Loading server details…</p>
          : config === null ? <div className="notice"><h2>Start in your terminal</h2><p>Connect to your server with SSH, then open its signing link or scan the QR code shown in the login prompt.</p>{loadError && <p className="action-error">{loadError}</p>}</div>
          : <>
            {walletSection}
            {view === 'mine' ? minePanel : browsePanel}
          </>}
      </section>
      <aside className="ssh-guidance" aria-labelledby="steps-title">
        <h2 id="steps-title">From wallet to shell</h2>
        <ol className="steps">{([
          ['Connect a wallet', 'Phantom or Solflare holds the key you log in with.'],
          ['Get access', 'Buy the server with SOL, or have its owner share it with you.'],
          ['Log in with SSH', 'Approve each login in your wallet. No passwords or SSH keys.'],
        ] as const).map(([title, text], index) =>
          <li key={title} className={index < step ? 'done' : index === step ? 'current' : ''} aria-current={index === step ? 'step' : undefined}><strong>{title}</strong><span>{text}</span></li>)}</ol>
        <p className="muted">Changes apply to new logins once Solana finalizes them, usually within a minute.</p>
      </aside>
    </main>
    <footer>Access is read from finalized Solana state. Payments are sent from your wallet directly to the network.</footer>
    <div className="toasts">
      {busy && <div className="toast" role="status"><Spinner /><p>{busy}</p></div>}
      {notice && <div className="toast toast-success" role="status"><p>{notice}</p><button className="toast-close" onClick={() => setNotice(null)} aria-label="Dismiss message">×</button></div>}
      {actionError && <div className="toast toast-error" role="alert"><p>{actionError}</p><button className="toast-close" onClick={() => setActionError(null)} aria-label="Dismiss error">×</button></div>}
    </div>
  </div>;
}

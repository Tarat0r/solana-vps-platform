import { useEffect, useState } from 'react';
import { CHALLENGE_TTL_SECONDS, loadChallenge, SessionError, sessionIdFromPath, submitProof } from './session.ts';
import type { LoginChallenge, SignedResponse } from './session.ts';
import { shorten, TerminalIcon } from './ui.tsx';
import { connectWallet, extensionsBlockedHere, signWalletMessage, walletBrowseUrl, walletCanConnect, walletProvider, WalletTimeoutError } from './wallets.ts';
import type { WalletConnection, WalletName } from './wallets.ts';

const wallets: WalletName[] = ['Phantom', 'Solflare'];
const countdown = (seconds: number) => `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`;
const messages = {
  missing: ['This login is no longer available', 'Start a new SSH login to get a fresh signing link.'],
  expired: ['This signing link has expired', 'Start a new SSH login. Each challenge is available for 5 minutes.'],
  invalid: ['This challenge could not be verified', 'Check that you opened the link from your SSH prompt, then start a new login.'],
  network: ['The signing service could not be reached', 'Check your connection and try loading this link again.'],
  duplicate: ['This login already has a response', 'Return to SSH and press Enter. Start a new login if it fails.'],
} as const;

export function App() {
  const id = sessionIdFromPath(window.location.pathname);
  const [challenge, setChallenge] = useState<LoginChallenge | null>(null);
  const [failure, setFailure] = useState<SessionError['kind'] | null>(null);
  const [reload, setReload] = useState(0);
  const [now, setNow] = useState(Date.now);
  const [available, setAvailable] = useState<WalletName[]>([]);
  const [connection, setConnection] = useState<WalletConnection | null>(null);
  const [busy, setBusy] = useState<'connecting' | 'signing' | 'submitting' | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [pendingProof, setPendingProof] = useState<SignedResponse | null>(null);
  const [submitted, setSubmitted] = useState(false);
  const [choosing, setChoosing] = useState(false);

  useEffect(() => {
    if (!id) return;
    const controller = new AbortController();
    void loadChallenge(id, controller.signal).then(value => {
      if (!controller.signal.aborted) { setChallenge(value); setNow(Date.now()); }
    }).catch(error => {
      if (!controller.signal.aborted) setFailure(error instanceof SessionError ? error.kind : 'network');
    });
    return () => controller.abort();
  }, [id, reload]);

  useEffect(() => {
    const update = () => {
      setNow(Date.now());
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
    const changed = () => {
      setConnection(null);
      setPendingProof(null);
      setActionError('Your wallet account changed or disconnected. Connect your wallet again.');
    };
    connection.provider.on?.('connect', changed);
    connection.provider.on?.('disconnect', changed);
    return () => {
      connection.provider.removeListener?.('connect', changed);
      connection.provider.removeListener?.('disconnect', changed);
    };
  }, [connection]);

  const seconds = challenge ? Math.max(0, Math.ceil(challenge.expiresAt - now / 1000)) : 0;
  const expired = challenge !== null && seconds === 0;
  const terminalFailure = failure ?? (expired && !submitted ? 'expired' : null);
  const disabled = busy !== null || submitted || expired || terminalFailure !== null;

  async function connect(name: WalletName) {
    setBusy('connecting'); setActionError(null);
    try { const connected = await connectWallet(name); setConnection(connected); if (connected) setChoosing(false); }
    catch (error) {
      setActionError(error instanceof WalletTimeoutError ? error.message : `Could not connect to ${name}. Open your wallet and try again.`);
    }
    finally { setBusy(null); }
  }

  // One detected wallet connects directly; otherwise let the user choose.
  function chooseWallet() {
    const [installed, ...others] = wallets.filter(name => walletProvider(name));
    if (installed && others.length === 0) void connect(installed);
    else setChoosing(open => !open);
  }

  async function approve() {
    if (!id || !challenge || !connection || Date.now() / 1000 >= challenge.expiresAt) return;
    setActionError(null);
    let proof = pendingProof;
    try {
      if (!proof) {
        setBusy('signing');
        proof = await signWalletMessage(connection, challenge.bytes);
        setPendingProof(proof);
      }
      if (Date.now() / 1000 >= challenge.expiresAt) throw new SessionError('expired');
      setBusy('submitting');
      await submitProof(id, proof);
      setSubmitted(true); setPendingProof(null);
    } catch (error) {
      if (error instanceof SessionError) {
        if (error.kind === 'network') setActionError('The response could not be confirmed. Retry submission while this link is active.');
        else setFailure(error.kind);
      } else {
        const walletCode = (error as { code?: number; error?: { code?: number } }).code
          ?? (error as { error?: { code?: number } }).error?.code;
        setActionError(walletCode === 4001
          ? 'Signing was cancelled. You can try again while this link is active.'
          : error instanceof Error ? error.message : 'Signing failed. Open your wallet and try again.');
      }
    } finally { setBusy(null); }
  }

  async function disconnect() {
    const previous = connection;
    setConnection(null); setPendingProof(null); setActionError(null);
    try { await previous?.provider.disconnect(); } catch { /* Local disconnect is enough. */ }
  }

  return <div className="app-shell">
    <header className="masthead"><a className="brand" href="/"><TerminalIcon /><span>Wallet SSH</span></a><span className="masthead-note">Message approval</span></header>
    <main className="approval-layout">
      <section className="approval-sheet" aria-labelledby="page-title">
        <h1 id="page-title">Approve SSH login</h1>
        <p className="intro">Use your Solana wallet to sign the login request from your SSH window.</p>

        {!id ? <div className="notice"><h2>Start in your terminal</h2><p>Connect to your server with SSH, then open its signing link or scan the QR code shown in the login prompt.</p></div>
          : terminalFailure ? <div className={`notice ${terminalFailure === 'duplicate' ? 'notice-success' : 'notice-error'}`} role="alert"><h2>{messages[terminalFailure][0]}</h2><p>{messages[terminalFailure][1]}</p>{terminalFailure === 'network' && <button className="secondary-button" onClick={() => { setFailure(null); setReload(value => value + 1); }}>Try loading again</button>}</div>
          : !challenge ? <p className="loading" role="status">Loading your login request…</p>
          : <>
            <div className="login-target"><span className="detail-label">Linux account</span><strong>{challenge.unixUser}</strong><span>on server <code title={challenge.serverId}>{shorten(challenge.serverId)}</code></span></div>
            <dl className="login-details">
              <div><dt>Network</dt><dd>{challenge.cluster}</dd></div>
              <div><dt>Signing service</dt><dd>{new URL(challenge.authOrigin).host}</dd></div>
              <div className="expiry-detail"><dt>{submitted ? 'Response' : 'Time remaining'}</dt><dd className={seconds <= 30 && !submitted ? 'urgent' : ''}>{submitted ? 'Submitted' : countdown(seconds)}</dd></div>
            </dl>
            {!submitted && <div className="lifetime" aria-hidden="true"><span style={{ width: `${Math.min(100, seconds / CHALLENGE_TTL_SECONDS * 100)}%` }} /></div>}

            {submitted ? <div className="notice notice-success" role="status"><h2>Signature submitted</h2><p>Return to SSH and press Enter.</p><p className="muted">Your server will check the signature and your access before allowing the login.</p></div>
              : <section className="wallet-section" aria-labelledby="wallet-title">
                <h2 id="wallet-title">Sign with your wallet</h2>
                {connection ? <div className="connected-wallet"><div><strong>{connection.name} connected</strong><code title={connection.address}>{shorten(connection.address)}</code></div><button className="text-button" onClick={() => void disconnect()} disabled={busy !== null}>Disconnect</button></div>
                  : <><button className="connect-button" onClick={chooseWallet} disabled={disabled} aria-expanded={choosing} aria-controls={choosing ? 'wallet-choices' : undefined}><span className="wallet-stack" aria-hidden="true">{wallets.map(name => <span key={name} className={`wallet-symbol ${name.toLowerCase()}`}>{name[0]}</span>)}</span><span>{busy === 'connecting' ? 'Connecting…' : 'Connect wallet'}<small>{available.length ? `${available.join(' or ')} detected` : 'Phantom or Solflare'}</small></span></button>
                  {choosing && <div id="wallet-choices" className="wallet-options" role="group" aria-label="Choose a wallet">{wallets.map(name => <button key={name} className="wallet-button" onClick={() => void connect(name)} disabled={disabled || !walletCanConnect(name)}><span className={`wallet-symbol ${name.toLowerCase()}`} aria-hidden="true">{name[0]}</span><span>{name}<small>{available.includes(name) ? 'Detected' : walletCanConnect(name) ? 'Open wallet' : 'Not installed'}</small></span></button>)}</div>}
                  {available.length < wallets.length && <div className="phone-options"><p>On your phone, open this request in your wallet:</p><div>{wallets.filter(name => !available.includes(name)).map(name => <a key={name} href={walletBrowseUrl(name, `${window.location.origin}/v1/sessions/${id}`)}>Open in {name}</a>)}</div><p className="muted">{extensionsBlockedHere(window.location) ? 'Wallet extensions do not run on this plain-HTTP address. Ask the server operator for an HTTPS signing link.' : 'On desktop, install the wallet extension, then reload this page.'}</p></div>}</>}
                {actionError && <p className="action-error" role="alert">{actionError}</p>}
                <button className="primary-button" disabled={disabled || !connection} onClick={() => void approve()}>{busy === 'connecting' ? 'Connecting wallet…' : busy === 'signing' ? 'Confirm in your wallet…' : busy === 'submitting' ? 'Submitting signature…' : pendingProof ? 'Retry submission' : 'Sign login message'}</button>
                <p className="signing-note">This is a message signature. It does not send SOL or create a transaction.</p>
              </section>}
            <details className="message-details"><summary>Review the exact message</summary><pre>{challenge.text}</pre></details>
          </>}
      </section>
      <aside className="ssh-guidance"><div className="terminal-window" aria-hidden="true"><div className="terminal-top"><span /><span /><span /></div><div className="terminal-body"><span>SSH login</span><strong>Waiting for your wallet</strong><span className="terminal-cursor">▍</span></div></div><h2>Keep your SSH window open.</h2><p>Sign here, then return to your terminal and press Enter to complete the login.</p><p className="muted">If the link expires, start a new SSH connection for a fresh challenge.</p></aside>
    </main>
    <footer>Login approval is checked by your server.</footer>
  </div>;
}

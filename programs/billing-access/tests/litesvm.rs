//! Program behavior on LiteSVM, checked through the daemon's own decoder and
//! authorization rules in `auth-core`. Run `anchor build` first.
#![allow(
    clippy::unwrap_used,
    clippy::expect_used,
    clippy::arithmetic_side_effects,
    reason = "a panic in a test helper fails the test"
)]
use anchor_lang::{
    prelude::{Clock, Pubkey},
    solana_program::instruction::Instruction,
    system_program, AccountDeserialize, InstructionData, ToAccountMetas,
};
use auth_core::accounts::{self as contract, AccessSnapshot};
use billing_access::{accounts, instruction, BillingError, PaymentReceipt, ID, NO_OWNER};
use litesvm::LiteSVM;
use sha2::{Digest, Sha256};
use solana_keypair::Keypair;
use solana_signer::Signer;
use solana_transaction::Transaction;

const SO: &str = concat!(
    env!("CARGO_MANIFEST_DIR"),
    "/../target/deploy/billing_access.so"
);
const SERVER_ID: [u8; 32] = [7; 32];
// Above the rent-exempt minimum, so an unfunded treasury can receive it.
const PRICE: u64 = 1_000_000;
const PERIOD: i64 = 30 * 24 * 60 * 60;
const START: i64 = 1_800_000_000;

#[derive(Clone, Copy)]
enum Role {
    Provider,
    Owner,
    Delegate,
}

struct Env {
    svm: LiteSVM,
    provider: Keypair,
    owner: Keypair,
    delegate: Keypair,
    treasury: Pubkey,
    server: Pubkey,
}

fn pda(seeds: &[&[u8]]) -> Pubkey {
    Pubkey::find_program_address(seeds, &ID).0
}

fn code(error: BillingError) -> String {
    format!("Custom({})", u32::from(error))
}

/// Asserts failure; `expected` is a program error code or a runtime log fragment.
fn assert_fails(result: Result<(), String>, expected: &str) {
    let error = result.expect_err("transaction should fail");
    assert!(error.contains(expected), "expected {expected}, got {error}");
}

const IN_USE: &str = "already in use";
const UNINITIALIZED: &str = "AccountNotInitialized";

impl Env {
    fn new() -> Self {
        let mut svm = LiteSVM::new();
        svm.add_program_from_file(ID, SO)
            .expect("missing program binary; run `anchor build` in programs/");
        let (provider, owner, delegate) = (Keypair::new(), Keypair::new(), Keypair::new());
        for key in [&provider, &owner, &delegate] {
            svm.airdrop(&key.pubkey(), 10_000_000_000).unwrap();
        }
        let server = pda(&[b"server", provider.pubkey().as_ref(), &SERVER_ID]);
        let mut env = Env {
            svm,
            provider,
            owner,
            delegate,
            treasury: Keypair::new().pubkey(),
            server,
        };
        env.set_time(START);
        env
    }

    fn registered() -> Self {
        let mut env = Self::new();
        env.register(PRICE, PERIOD).unwrap();
        env
    }

    fn purchased() -> Self {
        let mut env = Self::registered();
        env.purchase(Role::Owner, [1; 32]).unwrap();
        env
    }

    fn key(&self, role: Role) -> &Keypair {
        match role {
            Role::Provider => &self.provider,
            Role::Owner => &self.owner,
            Role::Delegate => &self.delegate,
        }
    }

    fn set_time(&mut self, now: i64) {
        let mut clock: Clock = self.svm.get_sysvar();
        clock.unix_timestamp = now;
        self.svm.set_sysvar(&clock);
    }

    fn send(
        &mut self,
        role: Role,
        accounts: impl ToAccountMetas,
        args: impl InstructionData,
    ) -> Result<(), String> {
        let signer = self.key(role).insecure_clone();
        let ix = Instruction {
            program_id: ID,
            accounts: accounts.to_account_metas(None),
            data: args.data(),
        };
        // A fresh blockhash keeps retried identical transactions distinct.
        self.svm.expire_blockhash();
        let tx = Transaction::new_signed_with_payer(
            &[ix],
            Some(&signer.pubkey()),
            &[&signer],
            self.svm.latest_blockhash(),
        );
        self.svm
            .send_transaction(tx)
            .map(|_| ())
            .map_err(|failed| format!("{:?} {:?}", failed.err, failed.meta.logs))
    }

    fn subscription(&self) -> Pubkey {
        pda(&[b"subscription", self.server.as_ref()])
    }

    fn grant(&self, wallet: &Pubkey) -> Pubkey {
        pda(&[b"grant", self.server.as_ref(), wallet.as_ref()])
    }

    fn receipt(&self, payment_id: &[u8; 32]) -> Pubkey {
        pda(&[b"payment", self.server.as_ref(), payment_id])
    }

    fn register(&mut self, price_lamports: u64, period_seconds: i64) -> Result<(), String> {
        let accounts = accounts::RegisterServer {
            provider: self.provider.pubkey(),
            server: self.server,
            subscription: self.subscription(),
            system_program: system_program::ID,
        };
        let args = instruction::RegisterServer {
            server_id: SERVER_ID,
            treasury: self.treasury,
            price_lamports,
            period_seconds,
        };
        self.send(Role::Provider, accounts, args)
    }

    fn set_enabled(&mut self, role: Role, enabled: bool) -> Result<(), String> {
        let accounts = accounts::SetServerEnabled {
            provider: self.key(role).pubkey(),
            server: self.server,
        };
        self.send(role, accounts, instruction::SetServerEnabled { enabled })
    }

    fn purchase_to(
        &mut self,
        role: Role,
        payment_id: [u8; 32],
        treasury: Pubkey,
    ) -> Result<(), String> {
        let owner = self.key(role).pubkey();
        let accounts = accounts::PurchaseAccess {
            buyer: owner,
            server: self.server,
            subscription: self.subscription(),
            owner_grant: self.grant(&owner),
            receipt: self.receipt(&payment_id),
            treasury,
            system_program: system_program::ID,
        };
        self.send(role, accounts, instruction::PurchaseAccess { payment_id })
    }

    fn purchase(&mut self, role: Role, payment_id: [u8; 32]) -> Result<(), String> {
        self.purchase_to(role, payment_id, self.treasury)
    }

    fn renew_to(
        &mut self,
        role: Role,
        payment_id: [u8; 32],
        treasury: Pubkey,
    ) -> Result<(), String> {
        let owner = self.key(role).pubkey();
        let accounts = accounts::RenewAccess {
            owner,
            server: self.server,
            subscription: self.subscription(),
            owner_grant: self.grant(&owner),
            receipt: self.receipt(&payment_id),
            treasury,
            system_program: system_program::ID,
        };
        self.send(role, accounts, instruction::RenewAccess { payment_id })
    }

    fn renew(&mut self, role: Role, payment_id: [u8; 32]) -> Result<(), String> {
        self.renew_to(role, payment_id, self.treasury)
    }

    fn delegate(&mut self, role: Role, wallet: Pubkey, valid_until: i64) -> Result<(), String> {
        let owner = self.key(role).pubkey();
        let accounts = accounts::GrantDelegatedAccess {
            owner,
            server: self.server,
            subscription: self.subscription(),
            owner_grant: self.grant(&owner),
            grant: self.grant(&wallet),
            system_program: system_program::ID,
        };
        let args = instruction::GrantDelegatedAccess {
            wallet,
            valid_until,
        };
        self.send(role, accounts, args)
    }

    fn revoke(&mut self, role: Role, wallet: Pubkey) -> Result<(), String> {
        let owner = self.key(role).pubkey();
        let accounts = accounts::RevokeDelegatedAccess {
            owner,
            server: self.server,
            subscription: self.subscription(),
            owner_grant: self.grant(&owner),
            grant: self.grant(&wallet),
        };
        self.send(
            role,
            accounts,
            instruction::RevokeDelegatedAccess { wallet },
        )
    }

    /// Decodes with auth-core and checks the bytes re-encode exactly.
    fn load<T: contract::Account>(&self, key: &Pubkey) -> Option<T> {
        let account = self.svm.get_account(key)?;
        assert_eq!(account.owner, ID);
        let decoded: T = contract::decode(&account.data).expect("auth-core decodes account");
        assert_eq!(contract::encode(&decoded), account.data);
        Some(decoded)
    }

    fn paid_until(&self) -> i64 {
        self.load::<contract::Subscription>(&self.subscription())
            .unwrap()
            .paid_until
    }

    fn grant_until(&self, wallet: &Pubkey) -> i64 {
        self.load::<contract::AccessGrant>(&self.grant(wallet))
            .unwrap()
            .valid_until
    }

    fn payment_receipt(&self, payment_id: &[u8; 32]) -> PaymentReceipt {
        let account = self.svm.get_account(&self.receipt(payment_id)).unwrap();
        assert_eq!(account.owner, ID);
        PaymentReceipt::try_deserialize(&mut account.data.as_slice()).unwrap()
    }

    fn exists(&self, key: &Pubkey) -> bool {
        self.svm.get_account(key).is_some()
    }

    fn balance(&self, key: &Pubkey) -> u64 {
        self.svm.get_balance(key).unwrap_or(0)
    }

    fn can_login(&self, role: Role, now: i64) -> bool {
        self.wallet_can_login(&self.key(role).pubkey(), now)
    }

    /// The daemon's login decision for `wallet` against current account state.
    fn wallet_can_login(&self, wallet: &Pubkey, now: i64) -> bool {
        let wallet = *wallet;
        let Some(server) = self.load::<contract::ServerRecord>(&self.server) else {
            return false;
        };
        let owner = Pubkey::from(server.owner_wallet);
        let (Some(subscription), Some(owner_grant), Some(wallet_grant)) = (
            self.load(&self.subscription()),
            self.load(&self.grant(&owner)),
            self.load(&self.grant(&wallet)),
        ) else {
            return false;
        };
        AccessSnapshot {
            server,
            subscription,
            owner_grant,
            wallet_grant,
        }
        .authorize(
            &ID.to_bytes(),
            &self.provider.pubkey().to_bytes(),
            &SERVER_ID,
            &wallet.to_bytes(),
            now,
        )
        .is_ok()
    }
}

#[test]
fn registration_matches_contract_and_starts_for_sale() {
    let env = Env::registered();
    let server: contract::ServerRecord = env.load(&env.server).unwrap();
    assert_eq!(server.provider, env.provider.pubkey().to_bytes());
    assert_eq!(server.server_id, SERVER_ID);
    assert_eq!(server.owner_wallet, NO_OWNER.to_bytes());
    assert_eq!(server.treasury, env.treasury.to_bytes());
    assert_eq!(
        (server.price_lamports, server.period_seconds),
        (PRICE, PERIOD)
    );
    assert!(server.enabled);
    let subscription: contract::Subscription = env.load(&env.subscription()).unwrap();
    assert_eq!(subscription.server, env.server.to_bytes());
    assert_eq!(subscription.owner_wallet, NO_OWNER.to_bytes());
    assert_eq!(subscription.paid_until, 0);
    assert!(!env.can_login(Role::Owner, START));
    assert!(!env.wallet_can_login(&NO_OWNER, START));
}

#[test]
fn registration_rejects_invalid_terms_and_reuse() {
    let mut env = Env::new();
    assert_fails(env.register(0, PERIOD), &code(BillingError::InvalidTerms));
    assert_fails(env.register(PRICE, 0), &code(BillingError::InvalidTerms));
    assert_fails(env.register(PRICE, -1), &code(BillingError::InvalidTerms));
    assert!(!env.exists(&env.server));
    env.register(PRICE, PERIOD).unwrap();
    assert_fails(env.register(PRICE, PERIOD), IN_USE);
}

#[test]
fn purchase_pays_treasury_and_authorizes_owner() {
    let mut env = Env::registered();
    let before = env.balance(&env.owner.pubkey());
    env.purchase(Role::Owner, [1; 32]).unwrap();

    let owner = env.owner.pubkey().to_bytes();
    let server: contract::ServerRecord = env.load(&env.server).unwrap();
    let subscription: contract::Subscription = env.load(&env.subscription()).unwrap();
    assert_eq!(
        (server.owner_wallet, subscription.owner_wallet),
        (owner, owner)
    );
    assert_eq!(env.balance(&env.treasury), PRICE);
    assert!(before - env.balance(&env.owner.pubkey()) > PRICE);
    assert_eq!(env.paid_until(), START + PERIOD);
    let grant: contract::AccessGrant = env.load(&env.grant(&env.owner.pubkey())).unwrap();
    assert_eq!(grant.grant_type, contract::GrantType::Owner);
    assert!(grant.active);
    assert_eq!(grant.valid_until, START + PERIOD);

    let receipt = env.payment_receipt(&[1; 32]);
    assert_eq!(receipt.server, env.server);
    assert_eq!(receipt.payer, env.owner.pubkey());
    assert_eq!(receipt.payment_id, [1; 32]);
    assert_eq!(receipt.amount, PRICE);
    assert_eq!(
        (receipt.paid_at, receipt.paid_until),
        (START, START + PERIOD)
    );

    assert!(env.can_login(Role::Owner, START + PERIOD - 1));
    assert!(!env.can_login(Role::Owner, START + PERIOD));
    assert!(!env.can_login(Role::Delegate, START));
}

#[test]
fn renewal_extends_from_expiry_or_now() {
    let mut env = Env::registered();
    // Without a grant account the signer is rejected before the owner check.
    assert_fails(env.renew(Role::Owner, [9; 32]), UNINITIALIZED);
    env.purchase(Role::Owner, [1; 32]).unwrap();
    // While the term runs, even the owner renews instead of buying again.
    assert_fails(
        env.purchase(Role::Owner, [2; 32]),
        &code(BillingError::NotAvailable),
    );

    env.set_time(START + 10);
    env.renew(Role::Owner, [3; 32]).unwrap();
    assert_eq!(env.paid_until(), START + 2 * PERIOD);
    assert_eq!(env.grant_until(&env.owner.pubkey()), START + 2 * PERIOD);
    let receipt = env.payment_receipt(&[3; 32]);
    assert_eq!(receipt.payer, env.owner.pubkey());
    assert_eq!(receipt.amount, PRICE);
    assert_eq!(
        (receipt.paid_at, receipt.paid_until),
        (START + 10, START + 2 * PERIOD)
    );
    // Earlier receipts keep the term they paid for.
    assert_eq!(env.payment_receipt(&[1; 32]).paid_until, START + PERIOD);

    let late = START + 5 * PERIOD;
    env.set_time(late);
    assert!(!env.can_login(Role::Owner, late));
    env.renew(Role::Owner, [4; 32]).unwrap();
    assert_eq!(env.paid_until(), late + PERIOD);
    assert!(env.can_login(Role::Owner, late));
    assert_eq!(env.balance(&env.treasury), 3 * PRICE);
}

#[test]
fn payments_reject_reuse_wrong_accounts_and_disabled_server() {
    let mut env = Env::purchased();
    let paid_until = env.paid_until();

    assert_fails(env.renew(Role::Owner, [1; 32]), IN_USE);
    assert_fails(env.renew(Role::Delegate, [5; 32]), UNINITIALIZED);
    let wrong = Keypair::new().pubkey();
    assert_fails(
        env.renew_to(Role::Owner, [6; 32], wrong),
        &code(BillingError::InvalidTreasury),
    );
    assert_eq!(env.paid_until(), paid_until);
    assert_eq!(env.balance(&env.treasury), PRICE);

    assert_fails(env.set_enabled(Role::Owner, false), "ConstraintSeeds");
    env.set_enabled(Role::Provider, false).unwrap();
    assert!(!env.can_login(Role::Owner, START));
    assert_fails(
        env.renew(Role::Owner, [7; 32]),
        &code(BillingError::ServerDisabled),
    );
    let delegate = env.delegate.pubkey();
    assert_fails(
        env.delegate(Role::Owner, delegate, START + 1),
        &code(BillingError::ServerDisabled),
    );
    env.set_enabled(Role::Provider, true).unwrap();
    assert!(env.can_login(Role::Owner, START));

    let mut fresh = Env::registered();
    fresh.set_enabled(Role::Provider, false).unwrap();
    assert_fails(
        fresh.purchase(Role::Owner, [1; 32]),
        &code(BillingError::ServerDisabled),
    );
    assert_eq!(fresh.balance(&fresh.treasury), 0);
    assert!(fresh.svm.get_account(&fresh.receipt(&[1; 32])).is_none());
}

#[test]
fn purchase_requires_the_recorded_treasury() {
    let mut env = Env::registered();
    let wrong = Keypair::new().pubkey();
    assert_fails(
        env.purchase_to(Role::Owner, [1; 32], wrong),
        &code(BillingError::InvalidTreasury),
    );
    assert_eq!(env.paid_until(), 0);
    assert_eq!(env.balance(&wrong), 0);
    assert!(!env.exists(&env.receipt(&[1; 32])));
}

#[test]
fn delegation_is_bounded_by_owner_access() {
    let mut env = Env::registered();
    let delegate = env.delegate.pubkey();
    assert_fails(
        env.delegate(Role::Owner, delegate, START + 1),
        UNINITIALIZED,
    );
    env.purchase(Role::Owner, [1; 32]).unwrap();

    for valid_until in [START, START + PERIOD + 1] {
        let result = env.delegate(Role::Owner, delegate, valid_until);
        assert_fails(result, &code(BillingError::InvalidExpiry));
    }
    let owner = env.owner.pubkey();
    assert_fails(
        env.delegate(Role::Owner, owner, START + 1),
        &code(BillingError::OwnerGrant),
    );
    assert_fails(
        env.revoke(Role::Owner, owner),
        &code(BillingError::OwnerGrant),
    );
    // A delegate has no owner grant of its own, so it cannot manage access.
    let third = Keypair::new().pubkey();
    assert_fails(
        env.delegate(Role::Delegate, third, START + 1),
        UNINITIALIZED,
    );
    assert_fails(env.revoke(Role::Delegate, owner), UNINITIALIZED);

    let half = START + PERIOD / 2;
    env.delegate(Role::Owner, delegate, half).unwrap();
    let grant: contract::AccessGrant = env.load(&env.grant(&delegate)).unwrap();
    assert_eq!(grant.grant_type, contract::GrantType::Delegated);
    assert!(env.can_login(Role::Delegate, half - 1));
    assert!(!env.can_login(Role::Delegate, half));

    env.revoke(Role::Owner, delegate).unwrap();
    assert!(!env.can_login(Role::Delegate, START));
    assert!(env.can_login(Role::Owner, START));
    env.delegate(Role::Owner, delegate, START + PERIOD).unwrap();
    assert!(env.can_login(Role::Delegate, START));

    env.renew(Role::Owner, [2; 32]).unwrap();
    assert_eq!(env.grant_until(&delegate), START + PERIOD);
    assert!(!env.can_login(Role::Delegate, START + PERIOD));
    assert!(env.can_login(Role::Owner, START + PERIOD));
}

#[test]
fn delegation_changes_require_unexpired_subscription() {
    let mut env = Env::purchased();
    let delegate = env.delegate.pubkey();
    env.delegate(Role::Owner, delegate, START + PERIOD).unwrap();
    env.set_time(START + PERIOD);
    for result in [
        env.delegate(Role::Owner, delegate, START + PERIOD + 1),
        env.revoke(Role::Owner, delegate),
    ] {
        assert_fails(result, &code(BillingError::AccessExpired));
    }
    assert!(!env.can_login(Role::Delegate, START + PERIOD));
}

#[test]
fn receipt_layout_matches_documented_encoding() {
    let env = Env::purchased();
    let (receipt, bump) =
        Pubkey::find_program_address(&[b"payment", env.server.as_ref(), &[1; 32]], &ID);
    let mut expected = Sha256::digest(b"account:PaymentReceipt")[..8].to_vec();
    expected.extend(env.server.to_bytes());
    expected.extend(env.owner.pubkey().to_bytes());
    expected.extend([1; 32]);
    expected.extend(PRICE.to_le_bytes());
    expected.extend(START.to_le_bytes());
    expected.extend((START + PERIOD).to_le_bytes());
    expected.push(bump);
    assert_eq!(env.svm.get_account(&receipt).unwrap().data, expected);
}

#[test]
fn overflowing_terms_roll_back_payments() {
    let mut env = Env::new();
    env.register(PRICE, i64::MAX).unwrap();
    assert_fails(
        env.purchase(Role::Owner, [1; 32]),
        &code(BillingError::Overflow),
    );
    assert_eq!(env.balance(&env.treasury), 0);
    assert!(!env.exists(&env.grant(&env.owner.pubkey())));
    assert!(!env.exists(&env.receipt(&[1; 32])));

    // A purchase may reach i64::MAX exactly; the next renewal cannot extend it.
    let mut env = Env::new();
    env.register(PRICE, i64::MAX - START).unwrap();
    env.purchase(Role::Owner, [1; 32]).unwrap();
    assert_eq!(env.paid_until(), i64::MAX);
    assert_fails(
        env.renew(Role::Owner, [2; 32]),
        &code(BillingError::Overflow),
    );
    assert_eq!(env.paid_until(), i64::MAX);
    assert_eq!(env.balance(&env.treasury), PRICE);
    assert!(!env.exists(&env.receipt(&[2; 32])));
}

#[test]
fn unaffordable_purchase_changes_nothing() {
    let mut env = Env::new();
    let before = env.balance(&env.owner.pubkey());
    env.register(before + 1, PERIOD).unwrap();
    assert_fails(env.purchase(Role::Owner, [1; 32]), "insufficient lamports");
    assert_eq!(env.paid_until(), 0);
    assert_eq!(env.balance(&env.treasury), 0);
    assert!(before - env.balance(&env.owner.pubkey()) <= 5_000);
    assert!(!env.exists(&env.grant(&env.owner.pubkey())));
    assert!(!env.exists(&env.receipt(&[1; 32])));
}

#[test]
fn new_treasury_needs_rent_exempt_first_payment() {
    let mut env = Env::new();
    env.register(1_000, PERIOD).unwrap();
    assert_fails(
        env.purchase(Role::Owner, [1; 32]),
        "InsufficientFundsForRent",
    );
    assert_eq!(env.paid_until(), 0);

    let treasury = env.treasury;
    env.svm.airdrop(&treasury, 1_000_000).unwrap();
    env.purchase(Role::Owner, [1; 32]).unwrap();
    assert_eq!(env.balance(&treasury), 1_001_000);
    assert!(env.can_login(Role::Owner, START));
}

#[test]
fn delegated_grants_are_independent_and_updatable() {
    let mut env = Env::purchased();
    let first = env.delegate.pubkey();
    let second = Keypair::new().pubkey();
    env.delegate(Role::Owner, first, START + 100).unwrap();
    env.delegate(Role::Owner, second, START + PERIOD).unwrap();

    // The owner can extend or shorten an existing delegated grant.
    env.delegate(Role::Owner, first, START + 200).unwrap();
    assert_eq!(env.grant_until(&first), START + 200);
    env.delegate(Role::Owner, first, START + 50).unwrap();
    assert_eq!(env.grant_until(&first), START + 50);
    assert!(env.wallet_can_login(&first, START + 49));
    assert!(!env.wallet_can_login(&first, START + 50));

    env.revoke(Role::Owner, second).unwrap();
    assert!(!env.wallet_can_login(&second, START));
    assert!(env.wallet_can_login(&first, START));
    let stranger = Keypair::new().pubkey();
    assert_fails(env.revoke(Role::Owner, stranger), UNINITIALIZED);
    assert!(!env.wallet_can_login(&stranger, START));

    // Disabling the server denies every login and freezes delegation, but keeps grants.
    env.set_enabled(Role::Provider, false).unwrap();
    assert!(!env.wallet_can_login(&first, START));
    assert!(!env.can_login(Role::Owner, START));
    assert_fails(
        env.revoke(Role::Owner, first),
        &code(BillingError::ServerDisabled),
    );
    env.set_enabled(Role::Provider, true).unwrap();
    assert!(env.wallet_can_login(&first, START));
    assert_eq!(env.grant_until(&first), START + 50);
}

#[test]
fn accounts_from_other_servers_or_owners_are_rejected() {
    let mut env = Env::registered();
    let owner = env.owner.pubkey();
    let delegate = env.delegate.pubkey();

    // A second server from the same provider and owner, already paid.
    let other_id = [8; 32];
    let other = pda(&[b"server", env.provider.pubkey().as_ref(), &other_id]);
    let other_subscription = pda(&[b"subscription", other.as_ref()]);
    let other_grant = pda(&[b"grant", other.as_ref(), owner.as_ref()]);
    let register = accounts::RegisterServer {
        provider: env.provider.pubkey(),
        server: other,
        subscription: other_subscription,
        system_program: system_program::ID,
    };
    let args = instruction::RegisterServer {
        server_id: other_id,
        treasury: env.treasury,
        price_lamports: PRICE,
        period_seconds: PERIOD,
    };
    env.send(Role::Provider, register, args).unwrap();
    let purchase = accounts::PurchaseAccess {
        buyer: owner,
        server: other,
        subscription: other_subscription,
        owner_grant: other_grant,
        receipt: pda(&[b"payment", other.as_ref(), &[1; 32]]),
        treasury: env.treasury,
        system_program: system_program::ID,
    };
    let args = instruction::PurchaseAccess {
        payment_id: [1; 32],
    };
    env.send(Role::Owner, purchase, args).unwrap();
    // Payment IDs are scoped to their server, and the same wallet owns both.
    env.purchase(Role::Owner, [1; 32]).unwrap();

    // One server's subscription and owner grant cannot stand in for another's.
    let substituted = accounts::GrantDelegatedAccess {
        owner,
        server: env.server,
        subscription: other_subscription,
        owner_grant: other_grant,
        grant: env.grant(&delegate),
        system_program: system_program::ID,
    };
    let args = instruction::GrantDelegatedAccess {
        wallet: delegate,
        valid_until: START + 1,
    };
    assert_fails(env.send(Role::Owner, substituted, args), "ConstraintSeeds");
    assert!(!env.exists(&env.grant(&delegate)));

    // An account of another type cannot pose as a subscription.
    let confused = accounts::PurchaseAccess {
        buyer: owner,
        server: env.server,
        subscription: other_grant,
        owner_grant: env.grant(&owner),
        receipt: env.receipt(&[2; 32]),
        treasury: env.treasury,
        system_program: system_program::ID,
    };
    let args = instruction::PurchaseAccess {
        payment_id: [2; 32],
    };
    assert_fails(
        env.send(Role::Owner, confused, args),
        "AccountDiscriminatorMismatch",
    );

    assert!(env.can_login(Role::Owner, START));

    // A look-alike record owned by another program is not trusted.
    let mut forged = env.svm.get_account(&env.server).unwrap();
    forged.owner = Pubkey::new_unique();
    env.svm.set_account(env.server, forged).unwrap();
    assert_fails(
        env.renew(Role::Owner, [3; 32]),
        "AccountOwnedByWrongProgram",
    );
}

#[test]
fn any_wallet_buys_an_unsold_server() {
    let mut env = Env::registered();
    // The "delegate" key stands in for an arbitrary new wallet here.
    env.purchase(Role::Delegate, [1; 32]).unwrap();
    let buyer = env.delegate.pubkey();
    let server: contract::ServerRecord = env.load(&env.server).unwrap();
    assert_eq!(server.owner_wallet, buyer.to_bytes());
    assert!(env.can_login(Role::Delegate, START));
    assert!(!env.can_login(Role::Owner, START));
    assert_eq!(env.payment_receipt(&[1; 32]).payer, buyer);
}

#[test]
fn an_owned_server_is_unavailable_until_it_expires() {
    let mut env = Env::purchased();
    let owner = env.owner.pubkey();
    for now in [START, START + PERIOD - 1] {
        env.set_time(now);
        assert_fails(
            env.purchase(Role::Delegate, [2; 32]),
            &code(BillingError::NotAvailable),
        );
    }
    assert_eq!(env.balance(&env.treasury), PRICE);
    assert!(!env.exists(&env.receipt(&[2; 32])));
    let server: contract::ServerRecord = env.load(&env.server).unwrap();
    assert_eq!(server.owner_wallet, owner.to_bytes());
    assert!(env.can_login(Role::Owner, START + PERIOD - 1));
}

#[test]
fn an_expired_server_passes_to_a_new_buyer() {
    let mut env = Env::purchased();
    let (owner, buyer, friend) = (
        env.owner.pubkey(),
        env.delegate.pubkey(),
        Keypair::new().pubkey(),
    );
    env.delegate(Role::Owner, friend, START + PERIOD).unwrap();

    let later = START + PERIOD + 100;
    env.set_time(later);
    env.purchase(Role::Delegate, [2; 32]).unwrap();
    let server: contract::ServerRecord = env.load(&env.server).unwrap();
    let subscription: contract::Subscription = env.load(&env.subscription()).unwrap();
    assert_eq!(server.owner_wallet, buyer.to_bytes());
    assert_eq!(subscription.owner_wallet, buyer.to_bytes());
    // The new term starts now, not at the old expiry.
    assert_eq!(env.paid_until(), later + PERIOD);
    assert!(env.can_login(Role::Delegate, later));

    // The previous owner and their delegates are locked out and cannot take it back.
    assert!(!env.can_login(Role::Owner, later));
    assert!(!env.wallet_can_login(&friend, later));
    assert_fails(
        env.renew(Role::Owner, [3; 32]),
        &code(BillingError::Unauthorized),
    );
    assert_fails(
        env.delegate(Role::Owner, friend, later + 1),
        &code(BillingError::Unauthorized),
    );
    let old: contract::AccessGrant = env.load(&env.grant(&owner)).unwrap();
    assert_eq!(old.valid_until, START + PERIOD);

    // The new owner can renew and share as usual.
    env.renew(Role::Delegate, [4; 32]).unwrap();
    assert_eq!(env.paid_until(), later + 2 * PERIOD);
    let new_friend = Keypair::new().pubkey();
    let accounts = accounts::GrantDelegatedAccess {
        owner: buyer,
        server: env.server,
        subscription: env.subscription(),
        owner_grant: env.grant(&buyer),
        grant: env.grant(&new_friend),
        system_program: system_program::ID,
    };
    let args = instruction::GrantDelegatedAccess {
        wallet: new_friend,
        valid_until: later + 10,
    };
    env.send(Role::Delegate, accounts, args).unwrap();
    assert!(env.wallet_can_login(&new_friend, later));
}

#[test]
fn a_former_owner_can_buy_back_an_expired_server() {
    let mut env = Env::purchased();
    let later = START + 3 * PERIOD;
    env.set_time(later);
    // Buying again after expiry reuses the owner's existing grant account.
    env.purchase(Role::Owner, [2; 32]).unwrap();
    assert_eq!(env.paid_until(), later + PERIOD);
    assert_eq!(env.grant_until(&env.owner.pubkey()), later + PERIOD);
    assert!(env.can_login(Role::Owner, later));
}

#[test]
fn a_former_delegate_who_buys_becomes_the_owner() {
    let mut env = Env::purchased();
    let delegate = env.delegate.pubkey();
    env.delegate(Role::Owner, delegate, START + 10).unwrap();
    let later = START + PERIOD;
    env.set_time(later);
    env.purchase(Role::Delegate, [2; 32]).unwrap();
    let grant: contract::AccessGrant = env.load(&env.grant(&delegate)).unwrap();
    assert_eq!(grant.grant_type, contract::GrantType::Owner);
    assert_eq!(grant.valid_until, later + PERIOD);
    assert!(env.can_login(Role::Delegate, later));
}

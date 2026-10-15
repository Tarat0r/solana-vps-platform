//! Native SOL billing and SSH access grants for authentication contract v1.
//!
//! `ServerRecord`, `Subscription`, and `AccessGrant` must stay byte-compatible
//! with `ssh/auth-core/src/accounts.rs`: Anchor discriminator, Borsh fields in
//! contract order, canonical bump, and no trailing bytes.
use anchor_lang::prelude::*;
use anchor_lang::system_program::{transfer, Transfer};

declare_id!("FxQU6c2sjyAADR7vg3PXTZrxUaQNzV2Jh2w7PweEkfTY");

pub const SERVER_SEED: &[u8] = b"server";
pub const SUBSCRIPTION_SEED: &[u8] = b"subscription";
pub const GRANT_SEED: &[u8] = b"grant";
pub const PAYMENT_SEED: &[u8] = b"payment";
/// `owner_wallet` of a server nobody has bought. No wallet can sign as it, and
/// the daemon finds no owner grant for it, so logins are denied.
pub const NO_OWNER: Pubkey = Pubkey::new_from_array([0; 32]);

#[program]
pub mod billing_access {
    use super::*;

    /// Provider-signed: register a prepared server for sale, with no owner yet.
    pub fn register_server(
        ctx: Context<RegisterServer>,
        server_id: [u8; 32],
        treasury: Pubkey,
        price_lamports: u64,
        period_seconds: i64,
    ) -> Result<()> {
        require!(
            price_lamports > 0 && period_seconds > 0,
            BillingError::InvalidTerms
        );
        let server = ctx.accounts.server.key();
        ctx.accounts.server.set_inner(ServerRecord {
            provider: ctx.accounts.provider.key(),
            server_id,
            owner_wallet: NO_OWNER,
            treasury,
            price_lamports,
            period_seconds,
            enabled: true,
            bump: ctx.bumps.server,
        });
        ctx.accounts.subscription.set_inner(Subscription {
            server,
            owner_wallet: NO_OWNER,
            paid_until: 0,
            bump: ctx.bumps.subscription,
        });
        Ok(())
    }

    /// Provider-signed: allow or block new payments, delegation changes, and logins.
    pub fn set_server_enabled(ctx: Context<SetServerEnabled>, enabled: bool) -> Result<()> {
        ctx.accounts.server.enabled = enabled;
        Ok(())
    }

    /// Any wallet: buy a server that was never sold or whose subscription has
    /// expired. The buyer becomes the owner; the previous owner's grant and its
    /// delegates' grants ended with the old term, so they lose access.
    pub fn purchase_access(ctx: Context<PurchaseAccess>, payment_id: [u8; 32]) -> Result<()> {
        let a = ctx.accounts;
        let now = Clock::get()?.unix_timestamp;
        require!(
            a.server.owner_wallet == NO_OWNER || a.subscription.paid_until <= now,
            BillingError::NotAvailable
        );
        a.server.owner_wallet = a.buyer.key();
        a.subscription.owner_wallet = a.buyer.key();
        record_payment(
            &a.buyer,
            &a.server,
            &mut a.subscription,
            &mut a.owner_grant,
            &mut a.receipt,
            &a.treasury,
            payment_id,
            (ctx.bumps.owner_grant, ctx.bumps.receipt),
        )
    }

    /// Owner-signed: extend the owner's subscription, even after it expired,
    /// as long as no other wallet has bought the server since.
    pub fn renew_access(ctx: Context<RenewAccess>, payment_id: [u8; 32]) -> Result<()> {
        let a = ctx.accounts;
        let grant_bump = a.owner_grant.bump;
        record_payment(
            &a.owner,
            &a.server,
            &mut a.subscription,
            &mut a.owner_grant,
            &mut a.receipt,
            &a.treasury,
            payment_id,
            (grant_bump, ctx.bumps.receipt),
        )
    }

    /// Owner-signed: create or update a delegate's grant within the subscription term.
    pub fn grant_delegated_access(
        ctx: Context<GrantDelegatedAccess>,
        wallet: Pubkey,
        valid_until: i64,
    ) -> Result<()> {
        let a = ctx.accounts;
        let now = require_active_owner(&a.server, &a.subscription, &a.owner_grant)?;
        require_keys_neq!(wallet, a.owner.key(), BillingError::OwnerGrant);
        require!(
            valid_until > now && valid_until <= a.subscription.paid_until,
            BillingError::InvalidExpiry
        );
        a.grant.set_inner(AccessGrant {
            server: a.server.key(),
            wallet,
            grant_type: GrantType::Delegated,
            active: true,
            valid_until,
            bump: ctx.bumps.grant,
        });
        Ok(())
    }

    /// Owner-signed: deactivate a delegate's grant.
    pub fn revoke_delegated_access(
        ctx: Context<RevokeDelegatedAccess>,
        wallet: Pubkey,
    ) -> Result<()> {
        let a = ctx.accounts;
        require_active_owner(&a.server, &a.subscription, &a.owner_grant)?;
        require_keys_neq!(wallet, a.owner.key(), BillingError::OwnerGrant);
        require!(
            a.grant.grant_type == GrantType::Delegated,
            BillingError::OwnerGrant
        );
        a.grant.active = false;
        Ok(())
    }
}

/// Transfers the configured price and records the extended term atomically.
#[allow(clippy::too_many_arguments)]
fn record_payment<'info>(
    owner: &Signer<'info>,
    server: &Account<'info, ServerRecord>,
    subscription: &mut Account<'info, Subscription>,
    owner_grant: &mut Account<'info, AccessGrant>,
    receipt: &mut Account<'info, PaymentReceipt>,
    treasury: &SystemAccount<'info>,
    payment_id: [u8; 32],
    (grant_bump, receipt_bump): (u8, u8),
) -> Result<()> {
    require!(server.enabled, BillingError::ServerDisabled);
    let now = Clock::get()?.unix_timestamp;
    let paid_until = subscription
        .paid_until
        .max(now)
        .checked_add(server.period_seconds)
        .ok_or(BillingError::Overflow)?;
    transfer(
        CpiContext::new(
            System::id(),
            Transfer {
                from: owner.to_account_info(),
                to: treasury.to_account_info(),
            },
        ),
        server.price_lamports,
    )?;
    subscription.paid_until = paid_until;
    owner_grant.set_inner(AccessGrant {
        server: server.key(),
        wallet: owner.key(),
        grant_type: GrantType::Owner,
        active: true,
        valid_until: paid_until,
        bump: grant_bump,
    });
    receipt.set_inner(PaymentReceipt {
        server: server.key(),
        payer: owner.key(),
        payment_id,
        amount: server.price_lamports,
        paid_at: now,
        paid_until,
        bump: receipt_bump,
    });
    Ok(())
}

/// Delegation changes need an enabled server and the owner's unexpired access.
fn require_active_owner(
    server: &ServerRecord,
    subscription: &Subscription,
    owner_grant: &AccessGrant,
) -> Result<i64> {
    let now = Clock::get()?.unix_timestamp;
    require!(server.enabled, BillingError::ServerDisabled);
    require!(
        subscription.paid_until > now
            && owner_grant.grant_type == GrantType::Owner
            && owner_grant.active
            && owner_grant.valid_until > now,
        BillingError::AccessExpired
    );
    Ok(now)
}

#[account]
#[derive(InitSpace)]
pub struct ServerRecord {
    pub provider: Pubkey,
    pub server_id: [u8; 32],
    pub owner_wallet: Pubkey,
    pub treasury: Pubkey,
    pub price_lamports: u64,
    pub period_seconds: i64,
    pub enabled: bool,
    pub bump: u8,
}

#[account]
#[derive(InitSpace)]
pub struct Subscription {
    pub server: Pubkey,
    pub owner_wallet: Pubkey,
    pub paid_until: i64,
    pub bump: u8,
}

#[derive(AnchorSerialize, AnchorDeserialize, Clone, Copy, Debug, PartialEq, Eq, InitSpace)]
pub enum GrantType {
    Owner,
    Delegated,
}

#[account]
#[derive(InitSpace)]
pub struct AccessGrant {
    pub server: Pubkey,
    pub wallet: Pubkey,
    pub grant_type: GrantType,
    pub active: bool,
    pub valid_until: i64,
    pub bump: u8,
}

/// Payment recovery record; the daemon does not read receipts during login.
#[account]
#[derive(InitSpace)]
pub struct PaymentReceipt {
    pub server: Pubkey,
    pub payer: Pubkey,
    pub payment_id: [u8; 32],
    pub amount: u64,
    pub paid_at: i64,
    pub paid_until: i64,
    pub bump: u8,
}

#[derive(Accounts)]
#[instruction(server_id: [u8; 32])]
pub struct RegisterServer<'info> {
    #[account(mut)]
    pub provider: Signer<'info>,
    #[account(
        init,
        payer = provider,
        space = 8 + ServerRecord::INIT_SPACE,
        seeds = [SERVER_SEED, provider.key().as_ref(), server_id.as_ref()],
        bump,
    )]
    pub server: Account<'info, ServerRecord>,
    #[account(
        init,
        payer = provider,
        space = 8 + Subscription::INIT_SPACE,
        seeds = [SUBSCRIPTION_SEED, server.key().as_ref()],
        bump,
    )]
    pub subscription: Account<'info, Subscription>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct SetServerEnabled<'info> {
    pub provider: Signer<'info>,
    #[account(
        mut,
        has_one = provider @ BillingError::Unauthorized,
        seeds = [SERVER_SEED, provider.key().as_ref(), server.server_id.as_ref()],
        bump = server.bump,
    )]
    pub server: Account<'info, ServerRecord>,
}

#[derive(Accounts)]
#[instruction(payment_id: [u8; 32])]
pub struct PurchaseAccess<'info> {
    #[account(mut)]
    pub buyer: Signer<'info>,
    #[account(
        mut,
        has_one = treasury @ BillingError::InvalidTreasury,
        seeds = [SERVER_SEED, server.provider.as_ref(), server.server_id.as_ref()],
        bump = server.bump,
    )]
    pub server: Account<'info, ServerRecord>,
    #[account(
        mut,
        seeds = [SUBSCRIPTION_SEED, server.key().as_ref()],
        bump = subscription.bump,
    )]
    pub subscription: Account<'info, Subscription>,
    // The buyer may already have a grant from an earlier term or as a delegate;
    // the handler rewrites every field as the owner grant. Radar's reinitialization
    // rule does not apply: rewriting is only reachable while the server is for
    // sale, and the seeds bind the account to the signing buyer.
    #[account(
        init_if_needed, // radar-disable-line Init_If_Needed_Reinitialization
        payer = buyer,
        space = 8 + AccessGrant::INIT_SPACE,
        seeds = [GRANT_SEED, server.key().as_ref(), buyer.key().as_ref()],
        bump,
    )]
    pub owner_grant: Account<'info, AccessGrant>,
    #[account(
        init,
        payer = buyer,
        space = 8 + PaymentReceipt::INIT_SPACE,
        seeds = [PAYMENT_SEED, server.key().as_ref(), payment_id.as_ref()],
        bump,
    )]
    pub receipt: Account<'info, PaymentReceipt>,
    #[account(mut)]
    pub treasury: SystemAccount<'info>,
    pub system_program: Program<'info, System>,
}

/// Same accounts as `PurchaseAccess`, signed by the current owner.
#[derive(Accounts)]
#[instruction(payment_id: [u8; 32])]
pub struct RenewAccess<'info> {
    #[account(mut)]
    pub owner: Signer<'info>,
    #[account(
        has_one = treasury @ BillingError::InvalidTreasury,
        constraint = server.owner_wallet == owner.key() @ BillingError::Unauthorized,
        seeds = [SERVER_SEED, server.provider.as_ref(), server.server_id.as_ref()],
        bump = server.bump,
    )]
    pub server: Account<'info, ServerRecord>,
    #[account(
        mut,
        constraint = subscription.owner_wallet == owner.key() @ BillingError::Unauthorized,
        seeds = [SUBSCRIPTION_SEED, server.key().as_ref()],
        bump = subscription.bump,
    )]
    pub subscription: Account<'info, Subscription>,
    #[account(
        mut,
        seeds = [GRANT_SEED, server.key().as_ref(), owner.key().as_ref()],
        bump = owner_grant.bump,
    )]
    pub owner_grant: Account<'info, AccessGrant>,
    #[account(
        init,
        payer = owner,
        space = 8 + PaymentReceipt::INIT_SPACE,
        seeds = [PAYMENT_SEED, server.key().as_ref(), payment_id.as_ref()],
        bump,
    )]
    pub receipt: Account<'info, PaymentReceipt>,
    #[account(mut)]
    pub treasury: SystemAccount<'info>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
#[instruction(wallet: Pubkey)]
pub struct GrantDelegatedAccess<'info> {
    #[account(mut)]
    pub owner: Signer<'info>,
    #[account(
        constraint = server.owner_wallet == owner.key() @ BillingError::Unauthorized,
        seeds = [SERVER_SEED, server.provider.as_ref(), server.server_id.as_ref()],
        bump = server.bump,
    )]
    pub server: Account<'info, ServerRecord>,
    #[account(
        constraint = subscription.owner_wallet == owner.key() @ BillingError::Unauthorized,
        seeds = [SUBSCRIPTION_SEED, server.key().as_ref()],
        bump = subscription.bump,
    )]
    pub subscription: Account<'info, Subscription>,
    #[account(
        seeds = [GRANT_SEED, server.key().as_ref(), owner.key().as_ref()],
        bump = owner_grant.bump,
    )]
    pub owner_grant: Account<'info, AccessGrant>,
    // Updating in place is intended: the handler rewrites every field, and the
    // seeds cannot match the owner grant because `wallet` must differ from the owner.
    // Radar's reinitialization rule does not apply: only the active owner can rewrite it.
    #[account(
        init_if_needed, // radar-disable-line Init_If_Needed_Reinitialization
        payer = owner,
        space = 8 + AccessGrant::INIT_SPACE,
        seeds = [GRANT_SEED, server.key().as_ref(), wallet.as_ref()],
        bump,
    )]
    pub grant: Account<'info, AccessGrant>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
#[instruction(wallet: Pubkey)]
pub struct RevokeDelegatedAccess<'info> {
    pub owner: Signer<'info>,
    #[account(
        constraint = server.owner_wallet == owner.key() @ BillingError::Unauthorized,
        seeds = [SERVER_SEED, server.provider.as_ref(), server.server_id.as_ref()],
        bump = server.bump,
    )]
    pub server: Account<'info, ServerRecord>,
    #[account(
        constraint = subscription.owner_wallet == owner.key() @ BillingError::Unauthorized,
        seeds = [SUBSCRIPTION_SEED, server.key().as_ref()],
        bump = subscription.bump,
    )]
    pub subscription: Account<'info, Subscription>,
    #[account(
        seeds = [GRANT_SEED, server.key().as_ref(), owner.key().as_ref()],
        bump = owner_grant.bump,
    )]
    pub owner_grant: Account<'info, AccessGrant>,
    #[account(
        mut,
        seeds = [GRANT_SEED, server.key().as_ref(), wallet.as_ref()],
        bump = grant.bump,
    )]
    pub grant: Account<'info, AccessGrant>,
}

#[error_code]
pub enum BillingError {
    #[msg("Price and period must be positive")]
    InvalidTerms,
    #[msg("Signer is not authorized for this server")]
    Unauthorized,
    #[msg("Treasury does not match the server record")]
    InvalidTreasury,
    #[msg("Server is disabled")]
    ServerDisabled,
    #[msg("Server is owned by another wallet until its subscription expires")]
    NotAvailable,
    #[msg("Owner subscription or grant is inactive or expired")]
    AccessExpired,
    #[msg("Delegation instructions cannot change the owner grant")]
    OwnerGrant,
    #[msg("Delegated expiry must be in the future and within the subscription term")]
    InvalidExpiry,
    #[msg("Arithmetic overflow")]
    Overflow,
}

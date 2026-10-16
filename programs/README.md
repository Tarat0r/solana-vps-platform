# Solana programs

**Status:** the native SOL [billing and access program](billing-access/README.md) and the provider Bash script are implemented and tested on LiteSVM and `solana-test-validator`. An end-to-end test has the daemon's RPC reader authorize logins from the program on a local validator. The program is [deployed to devnet](billing-access/README.md#devnet-deployment), where it backs the [public deployment](../infra/README.md#public-deployment).

This folder is an Anchor 1.2.1 workspace ([Anchor.toml](Anchor.toml)). The program keeps the account layouts and PDA seeds consumed by [the existing authentication code](../ssh/auth-core/src/accounts.rs) and [authentication contract v1](../ssh/CONTRACTS.md). Its tests use that decoder directly. The IDL is published in [shared/billing-access/](../shared/billing-access/).

[scripts/provider.sh](scripts/provider.sh) is the operator-run Bash script for registering an existing server and enabling/disabling it. It deliberately stays small; a dedicated provider CLI is outside the MVP scope. Devnet is the default cluster. Isolated tests use LiteSVM and a local validator.

```sh
npm --prefix programs ci
npm --prefix programs run test:all
```

`./run.sh --devnet` deploys or upgrades the program and registers two servers on devnet; see [Devnet deployment](billing-access/README.md#devnet-deployment).

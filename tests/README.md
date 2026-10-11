# Integration tests

**Leads:** Vassil, Anurag, and Bala

Place cross-component and end-to-end tests here. Keep component-level tests beside each implementation.

Cover these scenarios as the components become available:

- Finalized SOL purchase, VM readiness, and successful owner SSH login.
- Pending/invalid payments, duplicate payment IDs, and uncertain transaction reconciliation.
- Provisioning failure and retry without charging again.
- Expiry, finalized renewal, delegated login, revocation, and provider disablement.
- Invalid signatures, replay, expired challenges, and wrong server/account bindings.
- Stale/unavailable RPC, gateway/daemon failure, and provider console recovery.
- Backend/container restart with persistent SQLite and reconciled payment state.

Use shared non-secret fixtures from [shared/](../shared/). Record the cluster/program ID, transaction signatures, order/payment IDs, and redacted outcomes. Add test commands when the integration harness exists.

See [Architecture.md](../Architecture.md).

Download the Debian 13 cloud image: [debian-13-nocloud-amd64.qcow2](https://saimei.ftp.acc.umu.se/images/cloud/trixie/latest/debian-13-nocloud-amd64.qcow2).

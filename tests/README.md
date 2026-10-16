# Integration tests

## Existing authentication suite

The working Rust, gateway, network, and Debian/OpenSSH tests live under [ssh/](../ssh/README.md). To run them with every other suite, from the repository root after installing the documented prerequisites:

```sh
./test-all.sh
```

Download [debian-13-nocloud-amd64.qcow2](https://saimei.ftp.acc.umu.se/images/cloud/trixie/latest/debian-13-nocloud-amd64.qcow2) into this directory for the QEMU harness. The harness keeps the supplied image unchanged and uses its own overlay.

Program, provider-script, and daemon-RPC tests against a local validator live under [programs/](../programs/README.md) (`npm --prefix programs run test:all`). `./test-all.sh` runs them before the SSH pipeline, whose browser stage also needs the built program.

These tests exercise real PAM, daemon logic, signatures, and OpenSSH with simulated gateway/RPC services and a command-line signer, and the SSH suite also checks that open sessions end at expiry or revocation. They do not use a deployed program, SOL payments, browser wallets, or HTTPS; the devnet demonstration below does.

## Devnet demonstration

On 15–16 October 2026, the program was deployed to devnet and the system ran on the [public deployment](../infra/README.md#public-deployment): the gateway and dashboard at `https://vps.oblaka.top:6441`, and wallet-only SSH on two Ubuntu 26.04 servers, Amsterdam 01 (30-day term) and Amsterdam 02 (10-minute term), each at 0.01 SOL. An owner and a delegate wallet were tested manually in a desktop browser wallet on devnet.

| | |
| --- | --- |
| Cluster | devnet, `https://api.devnet.solana.com` |
| Program | [`FxQU6c2sjyAADR7vg3PXTZrxUaQNzV2Jh2w7PweEkfTY`](https://explorer.solana.com/address/FxQU6c2sjyAADR7vg3PXTZrxUaQNzV2Jh2w7PweEkfTY?cluster=devnet), deployed in slot 511501728 ([transaction](https://explorer.solana.com/tx/aokzDanRLjXHgbqdNwxLX4bicECihuqsQrG5RsmcwxCgkkm939nuLY8WndjaYtkDxp6QtdNof57VbwifTw6Kaqk?cluster=devnet)); the provider key is its upgrade authority |
| Provider and treasury | `7bdGgJbAmB87yzpf4y58tjXBaKhMpdNdgu5Y4MivD9ns` |

Program transactions, all finalized and successful (times UTC; payment IDs shortened):

| Time | Instruction | Server | Payment ID | Transaction |
| --- | --- | --- | --- | --- |
| 15 Oct 22:36:34 | `register_server` | Amsterdam 01 | | [2jRuBZmc…](https://explorer.solana.com/tx/2jRuBZmcT1Wa8132iqe1RTiGfxiv6DeTUkgnbatF1wt2EKzFNL2tN9vgwbGHcS3vD64zW87PivwH8UqWpimQS45M?cluster=devnet) |
| 15 Oct 22:36:37 | `register_server` | Amsterdam 02 | | [9S5o3dXA…](https://explorer.solana.com/tx/9S5o3dXAe8wAwBy9bLrmDyGw8j73JFHjqb4idzi2T8MEztKzvbgFpogNrv2yK5nDAKVQk353TLmYTsBURiqNFxp?cluster=devnet) |
| 15 Oct 23:54:25 | `purchase_access` | Amsterdam 02 | `6acf58f8cb02…` | [4QQDanrr…](https://explorer.solana.com/tx/4QQDanrrGK1Taa31VpjrriHGKE9uFZyFaiKXnCH5ZfL8HPaAvRTDuYqDWWo9zH9cmKnU3zcneXhyBLaDbyuQeysV?cluster=devnet) |
| 16 Oct 00:01:21 | `grant_delegated_access` | Amsterdam 02 | | [2bu5EE35…](https://explorer.solana.com/tx/2bu5EE35pbsUqUUDCZgVyV3kFYLCqA1DstU2V5NVATAy9KxRjE8nqXREw5KUoWwsMdGuB3oKg7id7s7mkhz4BWqy?cluster=devnet) |
| 16 Oct 00:07:58 | `renew_access` | Amsterdam 02 | `33e8a66b5e1e…` | [2SrzaU6d…](https://explorer.solana.com/tx/2SrzaU6dzzdK4QeWyBBWVqLJXfVDphUC2kJhwADCmbEfdKx5NUKjQTfgStVYR1aRCth7aYMSaQiWfp7boXyfyyef?cluster=devnet) |
| 16 Oct 00:16:11 | `grant_delegated_access` | Amsterdam 02 | | [4pLK13k8…](https://explorer.solana.com/tx/4pLK13k835KvkYtMMdS5cW389QL2ZWvbss5Ev3AeanjDR7Nrnx4Km2MgRVCSYSNekUjr95im7gLFQ3vde2MkuCVE?cluster=devnet) |
| 16 Oct 00:19:03 | `renew_access` | Amsterdam 02 | `83eeae9b90b6…` | [sPaaoERU…](https://explorer.solana.com/tx/sPaaoERUt8DsEqoyjnYiaYZLJPx3EWEZo5Nb1Z2czbxCr86UF6yPcMtTacEWsG2KfJDedQMigNdh2d8Mv4VsrVQ?cluster=devnet) |
| 16 Oct 00:19:21 | `grant_delegated_access` | Amsterdam 02 | | [2NkARV8N…](https://explorer.solana.com/tx/2NkARV8NNwH8RWX2Z9Sf4urbnmFqEtJJh7mfbmKENsqoaHiJpbYcoq6PXf7cFSJFyxPY3dps4K6YPVJe2za3fU4P?cluster=devnet) |
| 16 Oct 00:57:59 | `renew_access` | Amsterdam 02 | `70990ed81618…` | [3Yb1i8Ke…](https://explorer.solana.com/tx/3Yb1i8KevmmodwcvQJ7yhHiKtn9hJncs1h3AYGVBNCZRL9tvDkHkGhTS7aKoF6rXvqgN21hX498DHpNNk8czcuaG?cluster=devnet) |

Outcomes, from the transactions above and the daemon's audit events on Amsterdam 02:

| Scenario | Outcome |
| --- | --- |
| Paid owner | The purchase at 23:54:25 was followed by an allowed wallet login at 23:55:09 |
| Delegation | The grant at 00:19:21 (to 00:29) was followed by an allowed login at 00:20:13 |
| Expiry and renewal | Each renewal extended the term by 10 minutes. After the renewal at 00:57:59, logins at 00:58:50 and 00:59:57 were allowed, and at 01:07:59, when the term ended, the daemon ended both open sessions through logind (`access_expired`) |
| Signature and failure handling | Unsigned or abandoned logins were denied (`authentication_failed`) on both servers |

Delegate revocation, provider disablement, and outage behavior were not exercised on devnet; the SSH suite above covers them against synthetic RPC data, and the program's [daemon RPC test](../programs/billing-access/README.md#build-and-test) covers revocation and disablement on a local validator.

Observed limitations:

- **Devnet only.** The program is unaudited, and its payments use devnet SOL.
- **Finality delay.** Purchases, grants, and revocations take effect after finalization, about 15–30 seconds on devnet, so a login immediately after a payment can be denied.
- **Revocation latency.** Revocation, disablement, or a new owner ends open sessions at the next re-check, within about a minute after finalization. When the RPC is unreachable, open sessions keep their known deadline until it can be read again.
- **Public RPC.** The dashboard and daemons use the rate-limited public devnet endpoint.
- **Certificate renewal.** The provider forwards no port 80 or 443, so the certificate uses a manual DNS-01 renewal about every 60–90 days (`infra/deploy.sh cert`).
- **Warnings depend on `mesg`.** A user who disables terminal messages gets no expiry warning, but is still disconnected.

Record any further runs the same way: cluster and program ID, payment IDs, transaction signatures, and redacted outcomes. Never publish wallet keys, daemon tokens, or full login challenges or signatures.

See [Architecture.md](../Architecture.md).

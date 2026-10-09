# pam_solana.so

Linux-PAM cdylib built as `libpam_solana.so`, installed as `pam_solana.so`. Exports
`pam_sm_authenticate` and `pam_sm_setcred`. It obtains the PAM username, connects
to the root-owned socket, displays a keyboard-interactive signing prompt, and
accepts only explicit daemon approval before expiry. Errors and panics fail closed.
While waiting, periodic conversation checks let OpenSSH notice disconnected
clients; they do not create another challenge or require another signature.

Configure `auth requisite pam_solana.so`, optionally with a root-controlled
`socket=/absolute/path`. Default: `/run/solana-authd.sock`. The module performs no
HTTP, RPC or signature verification and provides no alternative authentication.
See [../README.md](../README.md) for installation and real OpenSSH tests.

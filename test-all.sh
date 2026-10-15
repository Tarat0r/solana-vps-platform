#!/usr/bin/env bash
# Runs every build, check, and test in the repository. The billing program goes
# first: the dashboard browser tests in the SSH pipeline load it into a validator.
set -euo pipefail

usage() {
    cat <<'EOF'
Usage: ./test-all.sh [--stop-vm]

Runs every build, check, and test in dependency order:
  static     ./static-analysis.sh: secrets, shell scripts, the gateway image,
             Rust formatting, Clippy, and dependencies, and TypeScript types,
             lints, and dependencies
  programs/  billing program build, LiteSVM tests, and provider.sh and daemon
             RPC tests on solana-test-validator
  ssh/       the complete pipeline (npm --prefix ssh run test:all): frontend
             build and unit tests, gateway checks, signing and dashboard browser
             tests, daemon/PAM Rust checks, and the Debian/OpenSSH VM suite

The VM is left running at 127.0.0.2:2222; --stop-vm stops it after a successful run.
Requires Node 22.18+, Rust, Anchor 1.2.1, the Solana CLI, QEMU, Docker,
cargo-deny, and tests/debian-13-nocloud-amd64.qcow2. See ssh/README.md and
programs/README.md.
EOF
}

die() {
    echo "test-all.sh: $*" >&2
    exit 2
}

pipeline_args=()
for arg in "$@"; do
    case $arg in
        --stop-vm) pipeline_args+=(--stop-vm) ;;
        -h | --help) usage; exit 0 ;;
        *) usage >&2; exit 2 ;;
    esac
done

cd -- "$(dirname -- "${BASH_SOURCE[0]}")"
for tool in node npm cargo cargo-deny docker anchor solana solana-keygen solana-test-validator qemu-system-x86_64; do
    command -v "$tool" >/dev/null || die "required command not found: $tool"
done
[[ -f tests/debian-13-nocloud-amd64.qcow2 ]] ||
    die "missing tests/debian-13-nocloud-amd64.qcow2; see tests/README.md"

summary=()
stage() {
    local name=$1 started=$SECONDS
    shift
    printf '\n==> %s\n$ %s\n' "$name" "$*"
    if ! "$@"; then
        printf '\ntest-all.sh: failed at "%s" after %ss\n' "$name" "$((SECONDS - started))" >&2
        exit 1
    fi
    summary+=("$(printf '%6ss  %s' "$((SECONDS - started))" "$name")")
}

stage "Run static analysis" ./static-analysis.sh
stage "Install locked program dependencies" npm --prefix programs ci --ignore-scripts --no-audit --no-fund
stage "Build the billing program" npm --prefix programs run compile
stage "Type-check the provider helper" npm --prefix programs run typecheck
stage "Test the program on LiteSVM" npm --prefix programs test
stage "Test provider.sh on a local validator" npm --prefix programs run test:provider
stage "Test the daemon RPC reader on a local validator" npm --prefix programs run test:daemon
stage "Run the frontend, gateway, and SSH pipeline" npm --prefix ssh run test:all -- "${pipeline_args[@]}"

printf '\nAll stages passed in %ss:\n' "$SECONDS"
printf '%s\n' "${summary[@]}"

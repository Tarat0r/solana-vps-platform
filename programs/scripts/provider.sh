#!/usr/bin/env bash
# Provider operations for the billing/access program: register a prepared
# server for sale, enable or disable it, and show its state.
set -euo pipefail

usage() {
    cat <<'EOF'
Usage:
  provider.sh register --server-id HEX --treasury PUBKEY \
                       --price-lamports N --period-seconds N [options]
  provider.sh enable  --server-id HEX [options]
  provider.sh disable --server-id HEX [options]
  provider.sh show    --server-id HEX [options]

Options:
  --url URL|devnet|localhost  RPC endpoint (default: devnet)
  --keypair PATH              provider keypair (default: ~/.config/solana/id.json)
  --yes                       send without the confirmation prompt

The server ID is the 64-character lowercase hex value from server.toml. Any
wallet can buy a registered server; it is for sale again once that owner's
subscription expires.
EOF
}

die() {
    echo "provider.sh: $*" >&2
    exit 2
}

here=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)
command=${1:-}
case $command in
    register | enable | disable | show) shift ;;
    -h | --help) usage; exit 0 ;;
    *) usage >&2; exit 2 ;;
esac

url=devnet
keypair=$HOME/.config/solana/id.json
yes=false
server_id='' treasury='' price='' period=''
while (($#)); do
    case $1 in
        --url) url=${2:?}; shift 2 ;;
        --keypair) keypair=${2:?}; shift 2 ;;
        --server-id) server_id=${2:?}; shift 2 ;;
        --treasury) treasury=${2:?}; shift 2 ;;
        --price-lamports) price=${2:?}; shift 2 ;;
        --period-seconds) period=${2:?}; shift 2 ;;
        --yes) yes=true; shift ;;
        -h | --help) usage; exit 0 ;;
        *) die "unknown option $1" ;;
    esac
done

case $url in
    devnet) url=https://api.devnet.solana.com ;;
    localhost) url=http://127.0.0.1:8899 ;;
esac
[[ $server_id =~ ^[0-9a-f]{64}$ ]] || die "--server-id must be 64 lowercase hex characters"
[[ -r $keypair ]] || die "cannot read provider keypair $keypair"
[[ -d $here/../node_modules/@solana/kit ]] || die "install dependencies with: npm --prefix '$here/..' ci"

args=(--url "$url" --keypair "$keypair" --server-id "$server_id")
if [[ $command == register ]]; then
    [[ -n $treasury ]] || die "register needs --treasury"
    [[ $price =~ ^[1-9][0-9]*$ && $period =~ ^[1-9][0-9]*$ ]] ||
        die "register needs positive integer --price-lamports and --period-seconds"
    args+=(--treasury "$treasury" --price-lamports "$price" --period-seconds "$period")
fi

tx() {
    node --experimental-strip-types --disable-warning=ExperimentalWarning "$here/provider-tx.ts" "$@"
}

if [[ $command == show ]]; then
    tx show "${args[@]}"
    exit
fi

echo "Current state:"
tx show "${args[@]}"
echo
echo "Planned: $command server $server_id on $url, signed and paid by $keypair"
if [[ $command == register ]]; then
    echo "  for sale to any wallet: $price lamports per $period seconds, paid to $treasury"
fi
if [[ $yes != true ]]; then
    read -rp "Send this transaction? [y/N] " answer
    [[ $answer == [yY] ]] || { echo "Cancelled."; exit 1; }
fi
tx "$command" "${args[@]}"

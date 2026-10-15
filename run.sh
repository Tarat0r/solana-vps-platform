#!/usr/bin/env bash
# Builds everything and runs it for manual testing: solana-test-validator with
# the billing program, two servers for sale, the gateway and frontend in
# Docker, and one Debian VM per server whose daemon is pointed at both.
# `./run.sh down` stops it and restores the VMs' test setup.
set -euo pipefail

usage() {
    cat <<'EOF'
Usage:
  ./run.sh [up] [--fund WALLET]... [--no-vm]  build everything and start it
  ./run.sh down                               stop it and restore the VMs' test setup

up builds the billing program, the gateway image, and two VMs, then:
  - starts a fresh solana-test-validator with the program on 127.0.0.1:8899
  - registers two servers for sale; any wallet can buy either in the dashboard
  - airdrops 10 SOL to each WALLET
  - starts the gateway and frontend in Docker on http://127.0.0.1:3000
  - points each VM's daemon at its server, the validator, and the gateway:
    server 1 is SSH 127.0.0.2:2222, server 2 is SSH 127.0.0.3:2222
--no-vm skips the VMs: the dashboard works, SSH login does not.

Repeat --fund for each browser wallet you test with. Without it, the keypair
in .run/owner.json is funded: import .run/owner.private-key.txt into your
wallet to use it. Optional environment: PRICE_LAMPORTS (default 100000000),
PERIOD_SECONDS (2592000). Each VM uses 2 GB of memory.
The provider key, server IDs, and gateway token are kept in .run/; the ledger
and validator log in /tmp/wallet-ssh-run-<uid>/.
EOF
}

die() {
    echo "run.sh: $*" >&2
    exit 2
}

step() {
    printf '\n==> %s\n' "$*"
}

command=up vm=true funds=()
while (($#)); do
    case $1 in
        up | down) command=$1; shift ;;
        --fund) funds+=("${2:?--fund needs a wallet address}"); shift 2 ;;
        --no-vm) vm=false; shift ;;
        -h | --help) usage; exit 0 ;;
        *) usage >&2; exit 2 ;;
    esac
done

cd -- "$(dirname -- "${BASH_SOURCE[0]}")"
# Relative: the Solana CLI misreads keypair paths with spaces or non-ASCII characters.
state=.run
# The validator's admin socket lives in the ledger, so its path must be short.
ledger=/tmp/wallet-ssh-run-$(id -u)/ledger
rpc=http://127.0.0.1:8899
export GATEWAY_PORT=${GATEWAY_PORT:-3000}
# Server N runs on VM instance N (see ssh/tests/network.ts): instance 1 is the
# test suites' VM, the others keep their own state in ssh/.vm-N/.
servers=(1 2)

vm_host() {
    echo "127.0.0.$(($1 + 1))"
}

vm() {
    local instance=$1
    shift
    SOLANA_VM_INSTANCE=$instance npm --prefix ssh run -s vm -- "$@"
}

vm_running() {
    local dir=ssh/.vm
    (($1 == 1)) || dir=ssh/.vm-$1
    [[ -f $dir/qemu.pid ]] && kill -0 "$(<"$dir/qemu.pid")" 2>/dev/null
}

# Runs a root script on a VM's serial console; base64 avoids console quoting.
guest() {
    vm "$1" exec "echo $(base64 -w0) | base64 -d | bash" >/dev/null
}

validator_running() {
    [[ -f $state/validator.pid ]] &&
        grep -qs solana-test-validator "/proc/$(<"$state/validator.pid")/cmdline"
}

stop_validator() {
    if validator_running; then
        local pid
        pid=$(<"$state/validator.pid")
        kill "$pid"
        while kill -0 "$pid" 2>/dev/null; do sleep 0.5; done
    fi
    rm -f "$state/validator.pid"
}

down() {
    step "Stop the gateway"
    docker compose down
    step "Stop the validator"
    stop_validator
    for n in "${servers[@]}"; do
        vm_running "$n" || continue
        step "Restore VM $n's test services"
        vm "$n" rpc-forward on
        guest "$n" <<'EOF'
set -e
systemctl stop solana-live-rpc solana-live-gateway 2>/dev/null || true
set -a; . /etc/solana-auth/test.env; set +a
solana-test-services config > /etc/solana-auth/server.toml
chmod 600 /etc/solana-auth/server.toml
systemctl enable --now solana-test-services
systemctl restart solana-authd
EOF
    done
    echo "Stopped. Running VMs are back on their test services; stop VM N with SOLANA_VM_INSTANCE=N npm --prefix ssh run vm -- stop."
}

# Points VM $1's daemon at server ID $2, the validator, and the gateway.
wire_vm() {
    local n=$1 server_id=$2
    # 10.0.2.2 is the host under QEMU user networking. The daemon's localnet
    # test mode only accepts loopback HTTP, so forward guest loopback ports.
    guest "$n" <<EOF
set -e
date -u -s @$(date +%s) >/dev/null
systemctl disable --now solana-test-services
systemctl stop solana-live-rpc solana-live-gateway 2>/dev/null || true
systemd-run --quiet --collect --unit=solana-live-rpc \
    socat TCP-LISTEN:8899,bind=127.0.0.1,fork,reuseaddr TCP:10.0.2.2:8899
systemd-run --quiet --collect --unit=solana-live-gateway \
    socat TCP-LISTEN:8080,bind=127.0.0.1,fork,reuseaddr TCP:10.0.2.2:$GATEWAY_PORT
cat > /etc/solana-auth/server.toml <<'TOML'
cluster = "localnet"
rpc_url = "http://127.0.0.1:8899"
program_id = "$program_id"
provider_pubkey = "$provider"
server_id = "$server_id"
unix_user = "ubuntu"
auth_gateway = "http://127.0.0.1:8080"
auth_origin = "http://127.0.0.1:$GATEWAY_PORT"
gateway_token = "$token"
commitment = "finalized"
challenge_ttl_seconds = 300
local_test = true
socket_path = "/run/solana-authd.sock"
TOML
chmod 600 /etc/solana-auth/server.toml
systemctl restart solana-authd
sleep 2
systemctl is-active --quiet solana-authd
curl -fsS -X POST -H 'Content-Type: application/json' -d '{"jsonrpc":"2.0","id":1,"method":"getHealth"}' \
    http://127.0.0.1:8899 | grep -q '"ok"'
curl -fsS -o /dev/null http://127.0.0.1:8080/
EOF
}

up() {
    local tools=(node npm anchor solana solana-keygen solana-test-validator docker)
    $vm && tools+=(qemu-system-x86_64)
    for tool in "${tools[@]}"; do
        command -v "$tool" >/dev/null || die "required command not found: $tool"
    done
    local wallet_key=
    if ((${#funds[@]} == 0)) && [[ -f $state/owner.json ]]; then
        funds=("$(solana-keygen pubkey "$state/owner.json")")
        wallet_key=$state/owner.private-key.txt
    fi
    ((${#funds[@]})) || die "pass --fund WALLET or create .run/owner.json, so a wallet can pay; see --help"
    for wallet in "${funds[@]}"; do
        [[ $wallet =~ ^[1-9A-HJ-NP-Za-km-z]{32,44}$ ]] || die "not a Solana address: $wallet"
    done
    if $vm && [[ ! -f tests/debian-13-nocloud-amd64.qcow2 ]]; then
        die "missing tests/debian-13-nocloud-amd64.qcow2; see tests/README.md, or use --no-vm"
    fi

    step "Build the billing program"
    [[ -d programs/node_modules/@solana/kit ]] ||
        npm --prefix programs ci --ignore-scripts --no-audit --no-fund
    npm --prefix programs run compile

    step "Build the gateway and frontend image"
    docker compose build

    # A VM cannot start while the validator holds port 8899 on every address.
    stop_validator
    if $vm; then
        for n in "${servers[@]}"; do
            step "Build and start VM $n of ${#servers[@]} (reruns its provisioning; the first run takes longer)"
            vm "$n" prepare
        done
    fi

    step "Start solana-test-validator with the program"
    # The validator's RPC binds every address, so it needs the port each VM
    # forwards to its test RPC; the VMs do not use that forward in this mode.
    for n in "${servers[@]}"; do
        if vm_running "$n"; then
            vm "$n" rpc-forward off
        fi
    done
    if curl -s --max-time 2 "$rpc" >/dev/null; then
        die "something else is listening on 127.0.0.1:8899; stop it first"
    fi
    mkdir -p "$state" "$(dirname "$ledger")"
    program_id=$(node -p "require('./shared/billing-access/billing_access.json').address")
    # A fresh ledger keeps block times in step with the clocks the daemon checks.
    setsid solana-test-validator --reset --quiet --ledger "$ledger" --bind-address 127.0.0.1 \
        --rpc-port 8899 --upgradeable-program "$program_id" programs/target/deploy/billing_access.so none \
        >"$state/validator.out" 2>&1 &
    echo $! >"$state/validator.pid"
    for _ in $(seq 60); do
        solana cluster-version --url "$rpc" >/dev/null 2>&1 && break
        if ! validator_running; then
            tail -n 3 "$state/validator.out" >&2
            die "solana-test-validator exited; see $ledger/validator.log"
        fi
        sleep 1
    done
    solana cluster-version --url "$rpc" >/dev/null || die "solana-test-validator did not start"

    step "Register ${#servers[@]} servers for sale"
    umask 077
    [[ -f $state/provider.json ]] ||
        solana-keygen new --no-bip39-passphrase --silent --outfile "$state/provider.json"
    [[ -f $state/gateway_token ]] || od -An -tx1 -N32 /dev/urandom | tr -d ' \n' >"$state/gateway_token"
    provider=$(solana-keygen pubkey "$state/provider.json")
    token=$(<"$state/gateway_token")
    solana airdrop 10 "$provider" --url "$rpc" --keypair "$state/provider.json" >/dev/null
    for wallet in "${funds[@]}"; do
        solana airdrop 10 "$wallet" --url "$rpc" --keypair "$state/provider.json" >/dev/null
    done
    local server_ids=() n registered server
    for n in "${servers[@]}"; do
        [[ -f $state/server-$n.id ]] || od -An -tx1 -N32 /dev/urandom | tr -d ' \n' >"$state/server-$n.id"
        server_ids[n]=$(<"$state/server-$n.id")
        registered=$(programs/scripts/provider.sh register --url "$rpc" --keypair "$state/provider.json" \
            --server-id "${server_ids[n]}" --treasury "$provider" --yes \
            --price-lamports "${PRICE_LAMPORTS:-100000000}" --period-seconds "${PERIOD_SECONDS:-2592000}")
        server=$(node -e 'const s = require("fs").readFileSync(0, "utf8");
            console.log(JSON.parse(s.slice(s.lastIndexOf("\n{") + 1)).server)' <<<"$registered")
    done
    # The dashboard and the daemons read finalized state only; the last
    # registration finalizes after the earlier ones.
    for _ in $(seq 60); do
        solana account "$server" --url "$rpc" --commitment finalized >/dev/null 2>&1 && break
        sleep 1
    done
    solana account "$server" --url "$rpc" --commitment finalized >/dev/null ||
        die "the registrations did not finalize"

    step "Start the gateway and frontend"
    umask 022
    {
        printf '{\n  "cluster": "localnet",\n  "rpc_url": "%s",\n  "program_id": "%s",\n  "provider_pubkey": "%s",\n  "servers": [\n' \
            "$rpc" "$program_id" "$provider"
        for n in "${servers[@]}"; do
            printf '    {"name": "Server %s", "server_id": "%s", "unix_user": "ubuntu", "ssh_host": "%s", "ssh_port": 2222}%s\n' \
                "$n" "${server_ids[n]}" "$(vm_host "$n")" "$( ((n == ${servers[-1]})) || echo ,)"
        done
        printf '  ]\n}\n'
    } >"$state/dashboard.json"
    SOLANA_GATEWAY_TOKEN=$token DASHBOARD_CONFIG=$state/dashboard.json docker compose up -d --wait

    if $vm; then
        for n in "${servers[@]}"; do
            step "Point VM $n's daemon at server $n, the validator, and the gateway"
            wire_vm "$n" "${server_ids[n]}"
        done
    fi

    cat <<EOF

Ready for manual testing.
  Dashboard:  http://127.0.0.1:$GATEWAY_PORT
  Wallet:     set your wallet's network to localnet (http://127.0.0.1:8899)
              ${#servers[@]} servers are for sale: buy either in the dashboard with any wallet
              10 SOL each: ${funds[*]}
EOF
    if [[ -n $wallet_key ]]; then
        echo "              (from .run/owner.json; import $wallet_key into your wallet)"
    fi
    if $vm; then
        for n in "${servers[@]}"; do
            echo "  SSH:        server $n: ssh -p 2222 ubuntu@$(vm_host "$n")"
        done
        echo "              open the printed link at 127.0.0.1:$GATEWAY_PORT, sign, then press Enter"
    fi
    cat <<EOF
  Logs:       $ledger/validator.log, docker compose logs gateway$($vm && echo ", SOLANA_VM_INSTANCE=N npm --prefix ssh run vm -- exec journalctl -u solana-authd")
  Stop:       ./run.sh down
EOF
}

"$command"

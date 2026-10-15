#!/usr/bin/env bash
# Builds everything and runs it for manual testing: the billing program on
# solana-test-validator or devnet, two servers for sale, the gateway and
# frontend in Docker, and one Debian VM per server whose daemon is pointed at
# both. `./run.sh down` stops it and restores the VMs' test setup.
set -euo pipefail

usage() {
    cat <<'EOF'
Usage:
  ./run.sh [up] [--devnet] [--fund WALLET]... [--no-vm]  build everything and start it
  ./run.sh down                                          stop it and restore the VMs' test setup

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

--devnet uses Solana devnet instead of a local validator. Devnet keeps its
state, so a rerun reuses the deployment and registrations:
  - deploys the program with the provider key, which becomes its upgrade
    authority, or upgrades it when the local build differs
  - registers the two servers once, for 0.01 SOL: server 1 for 30 days and
    server 2 for 10 minutes, to show expiry and renewal
  - transfers FUND_SOL (default 1) from the provider key to each WALLET
  - points each VM's daemon at devnet; the gateway stays on loopback HTTP
When asked, fund the provider key at https://faucet.solana.com: a first
deploy needs about 2.7 SOL, of which about 1.3 SOL stays in the program
account. PRICE_LAMPORTS and PERIOD_SECONDS (for both servers) apply only to
new registrations. RPC_URL (default https://api.devnet.solana.com) selects
another HTTPS RPC. The provider key, server IDs, and gateway token are kept
in .run/devnet/.
EOF
}

die() {
    echo "run.sh: $*" >&2
    exit 2
}

step() {
    printf '\n==> %s\n' "$*"
}

command=up vm=true devnet=false funds=()
while (($#)); do
    case $1 in
        up | down) command=$1; shift ;;
        --devnet) devnet=true; shift ;;
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
cluster=localnet
# Keys, server IDs, and the gateway token; devnet keeps its own because its
# deployment and registrations persist across runs.
data=$state
if $devnet; then
    rpc=${RPC_URL:-https://api.devnet.solana.com}
    cluster=devnet
    data=$state/devnet
fi
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

# Points VM $1's daemon at server ID $2, the cluster, and the gateway.
wire_vm() {
    local n=$1 server_id=$2 guest_rpc=http://127.0.0.1:8899 forward_rpc=true clock_sync=
    if $devnet; then
        # The guest reaches devnet's HTTPS RPC directly. Finalized devnet block
        # times lag 13-20 s, close to the daemon's 30 s freshness limit, so
        # keep the guest clock synchronized.
        guest_rpc=$rpc forward_rpc=false
        clock_sync='dpkg -s systemd-timesyncd >/dev/null 2>&1 || apt-get install -y -q systemd-timesyncd
timedatectl set-ntp true'
    fi
    # 10.0.2.2 is the host under QEMU user networking. The daemon's test mode
    # only accepts loopback HTTP, so forward guest loopback ports.
    guest "$n" <<EOF
set -e
date -u -s @$(date +%s) >/dev/null
$clock_sync
systemctl disable --now solana-test-services
systemctl stop solana-live-rpc solana-live-gateway 2>/dev/null || true
if $forward_rpc; then
    systemd-run --quiet --collect --unit=solana-live-rpc \
        socat TCP-LISTEN:8899,bind=127.0.0.1,fork,reuseaddr TCP:10.0.2.2:8899
fi
systemd-run --quiet --collect --unit=solana-live-gateway \
    socat TCP-LISTEN:8080,bind=127.0.0.1,fork,reuseaddr TCP:10.0.2.2:$GATEWAY_PORT
cat > /etc/solana-auth/server.toml <<'TOML'
cluster = "$cluster"
rpc_url = "$guest_rpc"
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
    $guest_rpc | grep -q '"ok"'
curl -fsS -o /dev/null http://127.0.0.1:8080/
EOF
}

start_validator() {
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
}

lamports() {
    solana balance "$1" --lamports --url "$rpc" --keypair "$data/provider.json" | cut -d' ' -f1
}

# Exits with faucet instructions unless the provider holds at least $1 lamports.
need_lamports() {
    (($(lamports "$provider") >= $1)) && return
    solana airdrop 2 "$provider" --url "$rpc" --keypair "$data/provider.json" >/dev/null 2>&1 || true
    local balance
    balance=$(lamports "$provider")
    ((balance >= $1)) ||
        die "the provider key $provider holds $balance lamports and needs $1; get devnet SOL for it at https://faucet.solana.com, then rerun"
}

# Deploys the program to devnet, or upgrades it when the local build differs.
deploy_program() {
    local so=programs/target/deploy/billing_access.so keypair=programs/target/deploy/billing_access-keypair.json
    local size rent dump program copies
    size=$(stat -c %s "$so")
    if solana program show "$program_id" --url "$rpc" --keypair "$data/provider.json" >/dev/null 2>&1; then
        dump=$(mktemp)
        solana program dump "$program_id" "$dump" --url "$rpc" --keypair "$data/provider.json" >/dev/null
        # The program account may be longer than the build; the rest is zeros.
        if cmp -s -n "$size" "$so" "$dump" && [[ -z $(tail -c +"$((size + 1))" "$dump" | tr -d '\0') ]]; then
            rm -f "$dump"
            step "Program $program_id is already deployed on devnet"
            return
        fi
        rm -f "$dump"
        step "Upgrade program $program_id on devnet"
        program=$program_id copies=1
    else
        [[ $(solana-keygen pubkey "$keypair") == "$program_id" ]] ||
            die "$keypair is not the keypair of program $program_id; restore it from your backup, such as $data/billing_access-keypair.json"
        step "Deploy program $program_id to devnet"
        # The deploy buffer holds a second copy until the program account takes it over.
        program=$keypair copies=2
    fi
    # Reclaims the rent of buffers that an interrupted deploy left behind.
    solana program close --buffers --url "$rpc" --keypair "$data/provider.json" >/dev/null
    rent=$(solana rent "$((size + 45))" --lamports --url "$rpc" --keypair "$data/provider.json" | awk 'NF { print $(NF - 1) }')
    need_lamports "$((copies * rent + 100000000))"
    # Buffer writes go to the leaders directly: the public RPC rate-limits them.
    solana program deploy "$so" --program-id "$program" --keypair "$data/provider.json" \
        --url "$rpc" --with-compute-unit-price 10000 --max-sign-attempts 50
}

# Prints server $1's record address, and "registered" when it exists.
server_state() {
    programs/scripts/provider.sh show --url "$rpc" --keypair "$data/provider.json" --server-id "$1" |
        node -e 'const s = JSON.parse(require("fs").readFileSync(0, "utf8"));
            console.log(s.server, s.record ? "registered" : "")'
}

up() {
    local tools=(node npm anchor solana solana-keygen docker)
    $devnet || tools+=(solana-test-validator)
    $vm && tools+=(qemu-system-x86_64)
    for tool in "${tools[@]}"; do
        command -v "$tool" >/dev/null || die "required command not found: $tool"
    done
    local wallet_key=
    if ! $devnet && ((${#funds[@]} == 0)) && [[ -f $state/owner.json ]]; then
        funds=("$(solana-keygen pubkey "$state/owner.json")")
        wallet_key=$state/owner.private-key.txt
    fi
    $devnet || ((${#funds[@]})) || die "pass --fund WALLET or create .run/owner.json, so a wallet can pay; see --help"
    for wallet in "${funds[@]}"; do
        [[ $wallet =~ ^[1-9A-HJ-NP-Za-km-z]{32,44}$ ]] || die "not a Solana address: $wallet"
    done
    local fund_sol=${FUND_SOL:-1}
    [[ $fund_sol =~ ^[0-9]+(\.[0-9]+)?$ ]] || die "FUND_SOL must be an amount of SOL, such as 0.5"
    if $vm && [[ ! -f tests/debian-13-nocloud-amd64.qcow2 ]]; then
        die "missing tests/debian-13-nocloud-amd64.qcow2; see tests/README.md, or use --no-vm"
    fi

    step "Build the billing program"
    [[ -d programs/node_modules/@solana/kit ]] ||
        npm --prefix programs ci --ignore-scripts --no-audit --no-fund
    npm --prefix programs run compile

    program_id=$(node -p "require('./shared/billing-access/billing_access.json').address")
    umask 077
    mkdir -p "$data"
    [[ -f $data/provider.json ]] ||
        solana-keygen new --no-bip39-passphrase --silent --outfile "$data/provider.json"
    [[ -f $data/gateway_token ]] || od -An -tx1 -N32 /dev/urandom | tr -d ' \n' >"$data/gateway_token"
    provider=$(solana-keygen pubkey "$data/provider.json")
    token=$(<"$data/gateway_token")
    # Before the slow steps, so an unfunded provider key stops the run early.
    if $devnet; then
        deploy_program
    fi
    umask 022

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
    $devnet || start_validator

    step "Register ${#servers[@]} servers for sale"
    umask 077
    local price=${PRICE_LAMPORTS:-100000000} periods=() server_ids=() n shown registered server
    for n in "${servers[@]}"; do
        periods[n]=${PERIOD_SECONDS:-2592000}
    done
    if $devnet; then
        price=${PRICE_LAMPORTS:-10000000}
        periods[2]=${PERIOD_SECONDS:-600}
        # Registration rent, transaction fees, and the transfers below.
        need_lamports "$(awk -v sol="$fund_sol" -v n="${#funds[@]}" 'BEGIN { printf "%d", (sol * n + 0.05) * 1e9 }')"
    else
        solana airdrop 10 "$provider" --url "$rpc" --keypair "$data/provider.json" >/dev/null
        for wallet in "${funds[@]}"; do
            solana airdrop 10 "$wallet" --url "$rpc" --keypair "$data/provider.json" >/dev/null
        done
    fi
    for n in "${servers[@]}"; do
        [[ -f $data/server-$n.id ]] || od -An -tx1 -N32 /dev/urandom | tr -d ' \n' >"$data/server-$n.id"
        server_ids[n]=$(<"$data/server-$n.id")
        if $devnet; then
            shown=$(server_state "${server_ids[n]}")
            read -r server registered <<<"$shown"
            if [[ -n $registered ]]; then
                echo "Server $n is already registered: $server"
                continue
            fi
        fi
        registered=$(programs/scripts/provider.sh register --url "$rpc" --keypair "$data/provider.json" \
            --server-id "${server_ids[n]}" --treasury "$provider" --yes \
            --price-lamports "$price" --period-seconds "${periods[n]}")
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
    if $devnet; then
        for wallet in "${funds[@]}"; do
            solana transfer --allow-unfunded-recipient "$wallet" "$fund_sol" \
                --url "$rpc" --keypair "$data/provider.json" >/dev/null
        done
    fi

    step "Start the gateway and frontend"
    umask 022
    {
        printf '{\n  "cluster": "%s",\n  "rpc_url": "%s",\n  "program_id": "%s",\n  "provider_pubkey": "%s",\n  "servers": [\n' \
            "$cluster" "$rpc" "$program_id" "$provider"
        for n in "${servers[@]}"; do
            printf '    {"name": "Server %s", "server_id": "%s", "unix_user": "ubuntu", "ssh_host": "%s", "ssh_port": 2222}%s\n' \
                "$n" "${server_ids[n]}" "$(vm_host "$n")" "$( ((n == ${servers[-1]})) || echo ,)"
        done
        printf '  ]\n}\n'
    } >"$data/dashboard.json"
    SOLANA_GATEWAY_TOKEN=$token DASHBOARD_CONFIG=$data/dashboard.json docker compose up -d --wait

    if $vm; then
        for n in "${servers[@]}"; do
            step "Point VM $n's daemon at server $n, $cluster, and the gateway"
            wire_vm "$n" "${server_ids[n]}"
        done
    fi

    local network="localnet (http://127.0.0.1:8899)" funded="10 SOL each"
    if $devnet; then
        network="devnet; program $program_id"
        funded="$fund_sol SOL each from the provider key"
    fi
    cat <<EOF

Ready for manual testing.
  Dashboard:  http://127.0.0.1:$GATEWAY_PORT
  Wallet:     set your wallet's network to $network
              ${#servers[@]} servers are for sale: buy either in the dashboard with any wallet
EOF
    if ((${#funds[@]})); then
        echo "              $funded: ${funds[*]}"
    fi
    if [[ -n $wallet_key ]]; then
        echo "              (from .run/owner.json; import $wallet_key into your wallet)"
    fi
    if $vm; then
        for n in "${servers[@]}"; do
            echo "  SSH:        server $n: ssh -p 2222 ubuntu@$(vm_host "$n")"
        done
        echo "              open the printed link at 127.0.0.1:$GATEWAY_PORT, sign, then press Enter"
    fi
    local logs=
    $devnet || logs="$ledger/validator.log, "
    cat <<EOF
  Logs:       ${logs}docker compose logs gateway$($vm && echo ", SOLANA_VM_INSTANCE=N npm --prefix ssh run vm -- exec journalctl -u solana-authd")
  Stop:       ./run.sh down
EOF
}

"$command"

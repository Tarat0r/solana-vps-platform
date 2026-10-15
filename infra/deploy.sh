#!/usr/bin/env bash
# Deploys the system to public Ubuntu 26.04 servers: the gateway and dashboard
# behind nginx with a Let's Encrypt certificate on the backend server, and
# wallet-only SSH for `ubuntu` on each server for sale. root keeps SSH-key
# access everywhere. Settings come from infra/deploy.env.
set -euo pipefail

usage() {
    cat <<'EOF'
Usage:
  infra/deploy.sh build      build the daemon, PAM module, and gateway for Ubuntu 26.04, and the frontend
  infra/deploy.sh cert       get or renew the backend's HTTPS certificate; shows a DNS TXT record to add
  infra/deploy.sh backend    install the gateway, dashboard, and nginx on the backend server
  infra/deploy.sh server N   install wallet-only SSH for ubuntu on server N (1, 2, ...)
  infra/deploy.sh status     show the services on every server

Run build, cert, backend, then server 1, server 2, ... Settings come from
infra/deploy.env (see infra/deploy.env.example). The program, provider, and
server registrations come from ./run.sh --devnet (.run/devnet/); the gateway
token is generated once in .deploy/. Requires Docker, Node, and npm.

cert uses a DNS-01 challenge, because Let's Encrypt cannot reach the backend on
ports 80 or 443: add the TXT record it shows at your DNS provider, and it
continues once the domain's name servers serve it. The certificate lasts about
90 days; rerun cert in its last 30 days.

server changes sshd and PAM behind a 10-minute timer that restores the previous
configuration, and cancels the timer only after a new root key login succeeds.
EOF
}

die() {
    echo "deploy.sh: $*" >&2
    exit 2
}

step() {
    printf '\n==> %s\n' "$*"
}

cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.."
[[ -f infra/deploy.env ]] || die "missing infra/deploy.env; copy infra/deploy.env.example and edit it"
# shellcheck source=infra/deploy.env.example
. infra/deploy.env
out=.deploy
devnet=.run/devnet
ubuntu_image=ubuntu:26.04

# Runs a command as root on the server at SSH port $1.
remote() {
    local port=$1
    shift
    ssh -o BatchMode=yes -o IdentitiesOnly=yes -i "$SSH_KEY" -o StrictHostKeyChecking=accept-new \
        -o ConnectTimeout=15 -p "$port" "root@$SSH_HOST" "$@"
}

# Copies the contents of local directory $2 to a fresh /root/solana-deploy on port $1.
upload() {
    tar -C "$2" -czf - . | remote "$1" 'rm -rf /root/solana-deploy && install -d -m 700 /root/solana-deploy && tar -C /root/solana-deploy -xzf -'
}

# Creates the daemons' shared gateway token once.
gateway_token() {
    [[ -f $out/gateway_token ]] || (umask 077 && od -An -tx1 -N32 /dev/urandom | tr -d ' \n' >"$out/gateway_token")
    cat "$out/gateway_token"
}

# Reads the program and provider of the devnet registrations.
load_identity() {
    [[ -f $devnet/provider.json ]] || die "no devnet provider key; run ./run.sh --devnet first"
    program_id=$(node -p "require('./shared/billing-access/billing_access.json').address")
    provider=$(solana-keygen pubkey "$devnet/provider.json")
}

build() {
    step "Build the daemon, PAM module, and gateway for Ubuntu 26.04"
    mkdir -p "$out"
    docker run --rm -v "$PWD:/src" -v wallet-ssh-cargo:/root/.cargo/registry -w /src \
        -e CARGO_TARGET_DIR=/src/$out/target "$ubuntu_image" bash -ec '
        export DEBIAN_FRONTEND=noninteractive
        apt-get update -q >/dev/null
        apt-get install -y -q cargo rustc libpam0g-dev pkg-config build-essential >/dev/null
        cargo build --locked --release --manifest-path ssh/Cargo.toml -p solana-authd -p pam-solana
        cargo build --locked --release --manifest-path backend/Cargo.toml'
    install -m 755 "$out"/target/release/{solana-authd,libpam_solana.so,solana-auth-gateway} "$out/"

    step "Build the frontend"
    [[ -d frontend/node_modules/vite ]] || npm --prefix frontend ci --ignore-scripts --no-audit --no-fund
    npm --prefix frontend run build
}

cert() {
    step "Request the certificate for $DOMAIN"
    remote "$BACKEND_SSH_PORT" bash -s <<EOF
set -e
export DEBIAN_FRONTEND=noninteractive
if ! command -v certbot >/dev/null || ! command -v dig >/dev/null; then
    apt-get update -q >/dev/null
    apt-get install -y -q certbot bind9-dnsutils >/dev/null
fi
# Renewal needs a new TXT record from the operator, so it is never unattended.
systemctl disable --now certbot.timer 2>/dev/null || true
cat >/usr/local/sbin/solana-acme-dns-hook <<'HOOK'
#!/bin/sh
# certbot --manual-auth-hook: shows the DNS-01 TXT record for the operator to
# add, then waits until every name server of the domain's zone serves it.
set -eu
zone=\${CERTBOT_DOMAIN#*.}
record=_acme-challenge.\$CERTBOT_DOMAIN
printf 'Type:  TXT\nHost:  %s\nValue: %s\n' "\${record%.\$zone}" "\$CERTBOT_VALIDATION" >/run/solana-acme-challenge
servers=\$(dig +short NS "\$zone")
[ -n "\$servers" ] || { echo "no name servers found for \$zone" >&2; exit 1; }
end=\$((\$(date +%s) + 3600))
while [ "\$(date +%s)" -lt "\$end" ]; do
    served=yes
    for server in \$servers; do
        dig +short TXT "\$record" @"\$server" | grep -qF "\"\$CERTBOT_VALIDATION\"" || served=no
    done
    if [ \$served = yes ]; then
        rm -f /run/solana-acme-challenge
        exit 0
    fi
    sleep 15
done
echo "the TXT record did not appear within an hour" >&2
exit 1
HOOK
chmod 755 /usr/local/sbin/solana-acme-dns-hook
rm -f /run/solana-acme-challenge
systemctl reset-failed solana-acme 2>/dev/null || true
systemd-run --quiet --unit=solana-acme certbot certonly --non-interactive --agree-tos \
    --register-unsafely-without-email --manual --preferred-challenges dns \
    --manual-auth-hook /usr/local/sbin/solana-acme-dns-hook --keep-until-expiring \
    --deploy-hook 'systemctl reload nginx 2>/dev/null || true' -d $DOMAIN
while systemctl is-active --quiet solana-acme && [ ! -s /run/solana-acme-challenge ]; do sleep 1; done
if [ -s /run/solana-acme-challenge ]; then
    printf '\nAdd this record in the DNS zone of %s:\n\n' "${DOMAIN#*.}"
    cat /run/solana-acme-challenge
    printf '\nWaiting until the name servers serve it (checked every 15 s, for up to an hour)...\n'
fi
while systemctl is-active --quiet solana-acme; do sleep 5; done
if systemctl is-failed --quiet solana-acme; then
    journalctl -u solana-acme -n 25 --no-pager -o cat >&2
    exit 1
fi
openssl x509 -noout -enddate -in /etc/letsencrypt/live/$DOMAIN/fullchain.pem
EOF
}

backend() {
    [[ -x $out/solana-auth-gateway && -f frontend/dist/index.html ]] || die "run infra/deploy.sh build first"
    load_identity
    local stage=$out/stage-backend n
    rm -rf "$stage"
    mkdir -p "$stage"
    cp "$out/solana-auth-gateway" "$stage/"
    cp -r frontend/dist "$stage/frontend"
    (umask 077 && printf 'SOLANA_GATEWAY_TOKEN=%s\n' "$(gateway_token)" >"$stage/gateway.env")
    {
        printf '{\n  "cluster": "devnet",\n  "rpc_url": "https://api.devnet.solana.com",\n  "program_id": "%s",\n  "provider_pubkey": "%s",\n  "servers": [\n' \
            "$program_id" "$provider"
        for n in "${!SERVER_SSH_PORTS[@]}"; do
            printf '    {"name": "%s", "server_id": "%s", "unix_user": "ubuntu", "ssh_host": "%s", "ssh_port": %s}%s\n' \
                "${SERVER_NAMES[n]}" "$(<"$devnet/server-$((n + 1)).id")" "$DOMAIN" "${SERVER_SSH_PORTS[n]}" \
                "$( ((n + 1 == ${#SERVER_SSH_PORTS[@]})) || echo ,)"
        done
        printf '  ]\n}\n'
    } >"$stage/dashboard.json"

    step "Upload the gateway and frontend to the backend"
    upload "$BACKEND_SSH_PORT" "$stage"
    rm -rf "$stage"

    step "Install the gateway and nginx"
    remote "$BACKEND_SSH_PORT" bash -s <<EOF
set -e
cd /root/solana-deploy
test -f /etc/letsencrypt/live/$DOMAIN/fullchain.pem || { echo "no certificate for $DOMAIN; run infra/deploy.sh cert first" >&2; exit 1; }
export DEBIAN_FRONTEND=noninteractive
command -v nginx >/dev/null || { apt-get update -q >/dev/null; apt-get install -y -q nginx >/dev/null; }
install -m 755 solana-auth-gateway /usr/local/bin/
rm -rf /opt/solana-frontend
cp -r frontend /opt/solana-frontend
chmod -R a+rX /opt/solana-frontend
install -d -m 755 /etc/solana-gateway
install -m 644 dashboard.json /etc/solana-gateway/
install -m 600 gateway.env /etc/solana-gateway/
cat >/etc/systemd/system/solana-auth-gateway.service <<'UNIT'
[Unit]
Description=Solana wallet SSH authentication gateway
Wants=network-online.target
After=network-online.target

[Service]
EnvironmentFile=/etc/solana-gateway/gateway.env
Environment=SOLANA_GATEWAY_BIND=127.0.0.1:3000
Environment=SOLANA_FRONTEND_DIR=/opt/solana-frontend
Environment=SOLANA_DASHBOARD_CONFIG=/etc/solana-gateway/dashboard.json
ExecStart=/usr/local/bin/solana-auth-gateway
Restart=on-failure
RestartSec=2
DynamicUser=yes
NoNewPrivileges=yes
ProtectSystem=strict
ProtectHome=yes
PrivateTmp=yes
PrivateDevices=yes
ProtectKernelTunables=yes
ProtectKernelModules=yes
ProtectControlGroups=yes
RestrictAddressFamilies=AF_INET AF_INET6
CapabilityBoundingSet=
MemoryMax=128M

[Install]
WantedBy=multi-user.target
UNIT
cat >/etc/nginx/sites-available/solana-gateway <<'SITE'
# TLS for the gateway on port 8080, which the provider forwards from public
# port $PUBLIC_PORT; the servers' daemons reach it on the private network.
server {
    listen 8080 ssl;
    listen [::]:8080 ssl;
    server_name $DOMAIN;
    ssl_certificate /etc/letsencrypt/live/$DOMAIN/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/$DOMAIN/privkey.pem;
    server_tokens off;
    # Request paths contain signing-session IDs.
    access_log off;
    # Plain HTTP sent to the TLS port.
    error_page 497 =301 https://$DOMAIN:$PUBLIC_PORT\$request_uri;
    location / {
        proxy_pass http://127.0.0.1:3000;
        proxy_set_header Host \$host;
        proxy_set_header X-Forwarded-For \$proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto https;
    }
}
server {
    listen 80 default_server;
    listen [::]:80 default_server;
    server_tokens off;
    access_log off;
    return 301 https://$DOMAIN:$PUBLIC_PORT\$request_uri;
}
SITE
ln -sf /etc/nginx/sites-available/solana-gateway /etc/nginx/sites-enabled/solana-gateway
rm -f /etc/nginx/sites-enabled/default
nginx -t -q
systemctl daemon-reload
systemctl enable --quiet --now solana-auth-gateway
systemctl restart solana-auth-gateway
systemctl enable --quiet nginx
systemctl reload-or-restart nginx
for _ in \$(seq 20); do curl -fsS -o /dev/null http://127.0.0.1:3000/v1/dashboard && break; sleep 0.5; done
curl -fsS -o /dev/null --resolve $DOMAIN:8080:127.0.0.1 https://$DOMAIN:8080/v1/dashboard
rm -rf /root/solana-deploy
EOF
    curl -fsS -o /dev/null "https://$DOMAIN:$PUBLIC_PORT/v1/dashboard" ||
        die "the backend works locally, but https://$DOMAIN:$PUBLIC_PORT is unreachable; check the port forward"
    echo "Dashboard: https://$DOMAIN:$PUBLIC_PORT"
}

server() {
    local n=${1:-}
    if [[ ! $n =~ ^[1-9][0-9]*$ ]] || ((n > ${#SERVER_SSH_PORTS[@]})); then
        die "server needs a number from 1 to ${#SERVER_SSH_PORTS[@]}"
    fi
    [[ -x $out/solana-authd && -f $out/libpam_solana.so ]] || die "run infra/deploy.sh build first"
    load_identity
    local port=${SERVER_SSH_PORTS[n - 1]} server_id stage=$out/stage-server denied
    [[ -f $devnet/server-$n.id ]] || die "no devnet registration $devnet/server-$n.id; run ./run.sh --devnet first"
    server_id=$(<"$devnet/server-$n.id")
    rm -rf "$stage"
    mkdir -p "$stage"
    cp "$out/solana-authd" "$out/libpam_solana.so" ssh/deploy/solana-authd.service "$stage/"
    (
        umask 077
        cat >"$stage/server.toml" <<EOF
cluster = "devnet"
rpc_url = "https://api.devnet.solana.com"
program_id = "$program_id"
provider_pubkey = "$provider"
server_id = "$server_id"
unix_user = "ubuntu"
auth_gateway = "https://$DOMAIN:8080"
auth_origin = "https://$DOMAIN:$PUBLIC_PORT"
gateway_token = "$(gateway_token)"
commitment = "finalized"
challenge_ttl_seconds = 300
local_test = false
socket_path = "/run/solana-authd.sock"
EOF
    )
    # Based on ssh/deploy/sshd-wallet.conf, which allows only ubuntu.
    cat >"$stage/sshd-wallet.conf" <<'EOF'
# Wallet-only SSH for ubuntu; root keeps key-only access for administration.
UsePAM yes
KbdInteractiveAuthentication yes
PasswordAuthentication no
PermitRootLogin prohibit-password
PermitEmptyPasswords no
LoginGraceTime 320
AllowUsers root ubuntu

Match User ubuntu
    AuthenticationMethods keyboard-interactive:pam
    PubkeyAuthentication no
    PasswordAuthentication no
    MaxAuthTries 2
Match User root
    AuthenticationMethods publickey
Match all
EOF

    step "Upload the daemon and PAM module to server $n (SSH port $port)"
    upload "$port" "$stage"
    rm -rf "$stage"

    step "Install the daemon on server $n"
    remote "$port" bash -s <<EOF
set -e
cd /root/solana-deploy
id ubuntu >/dev/null 2>&1 || useradd -m -s /bin/bash ubuntu
# A non-locked shadow entry permits PAM account checks; no password method is enabled.
usermod -p "\$(openssl passwd -6 "\$(head -c 32 /dev/urandom | base64)")" ubuntu
install -m 755 solana-authd /usr/local/sbin/
install -m 644 libpam_solana.so /usr/lib/x86_64-linux-gnu/security/pam_solana.so
install -m 644 solana-authd.service /etc/systemd/system/
install -d -m 700 /etc/solana-auth
install -m 600 server.toml /etc/solana-auth/
# The public address does not loop back to the backend inside the provider network.
sed -i '/[[:space:]]$DOMAIN\$/d' /etc/hosts
echo "$BACKEND_PRIVATE_IP $DOMAIN" >>/etc/hosts
curl -fsS -o /dev/null https://$DOMAIN:8080/v1/dashboard
systemctl daemon-reload
systemctl enable --quiet solana-authd
systemctl restart solana-authd
for _ in \$(seq 30); do test -S /run/solana-authd.sock && break; sleep 1; done
test -S /run/solana-authd.sock
EOF

    step "Enable wallet-only SSH for ubuntu on server $n (reverts in 10 minutes unless confirmed)"
    remote "$port" bash -s <<'EOF'
set -e
cd /root/solana-deploy
test -f /etc/pam.d/sshd.before-solana || cp -a /etc/pam.d/sshd /etc/pam.d/sshd.before-solana
cat >/usr/local/sbin/solana-ssh-revert <<'REVERT'
#!/bin/sh
# Restores the SSH authentication that preceded wallet login.
cp -a /etc/pam.d/sshd.before-solana /etc/pam.d/sshd
rm -f /etc/ssh/sshd_config.d/00-solana-wallet.conf
systemctl restart ssh
REVERT
chmod 755 /usr/local/sbin/solana-ssh-revert
systemctl stop solana-ssh-revert.timer 2>/dev/null || true
systemd-run --quiet --on-active=10min --unit=solana-ssh-revert /usr/local/sbin/solana-ssh-revert
install -m 644 sshd-wallet.conf /etc/ssh/sshd_config.d/00-solana-wallet.conf
# Keep Ubuntu's account/session handling while replacing its authentication stack.
awk '!/^@include common-auth/ && !/^auth[[:space:]]/' /etc/pam.d/sshd.before-solana >/etc/pam.d/sshd
sed -i '1i auth requisite pam_solana.so' /etc/pam.d/sshd
if ! sshd -t ||
    ! sshd -T -C user=root,host=localhost,addr=127.0.0.1 | grep -qx 'authenticationmethods publickey' ||
    ! sshd -T -C user=ubuntu,host=localhost,addr=127.0.0.1 | grep -qx 'authenticationmethods keyboard-interactive:pam'; then
    /usr/local/sbin/solana-ssh-revert
    systemctl stop solana-ssh-revert.timer
    echo "the new SSH configuration is invalid; restored the previous one" >&2
    exit 1
fi
systemctl restart ssh
rm -rf /root/solana-deploy
EOF

    step "Confirm root key login on server $n with a new connection"
    remote "$port" 'systemctl stop solana-ssh-revert.timer && echo "root login works; the revert timer is cancelled"' ||
        die "root login failed; server $n restores its previous SSH configuration within 10 minutes"
    denied=$(ssh -o BatchMode=yes -o StrictHostKeyChecking=accept-new -o ConnectTimeout=15 -p "$port" "ubuntu@$SSH_HOST" true 2>&1 || true)
    [[ $denied == *"Permission denied (keyboard-interactive)"* ]] ||
        die "ubuntu does not get wallet-only authentication: $denied"
    echo "ubuntu now signs in with a wallet: ssh -p $port ubuntu@$DOMAIN"
}

status() {
    local n
    step "backend (SSH port $BACKEND_SSH_PORT)"
    remote "$BACKEND_SSH_PORT" "systemctl is-active solana-auth-gateway nginx | paste -sd ' '; openssl x509 -noout -enddate -in /etc/letsencrypt/live/$DOMAIN/fullchain.pem 2>/dev/null || echo 'no certificate'" || true
    for n in "${!SERVER_SSH_PORTS[@]}"; do
        step "server $((n + 1)) (SSH port ${SERVER_SSH_PORTS[n]})"
        remote "${SERVER_SSH_PORTS[n]}" 'systemctl is-active solana-authd ssh | paste -sd " "; grep -c pam_solana /etc/pam.d/sshd | sed "s/^/pam_solana lines: /"; journalctl -u solana-authd -n 3 --no-pager -o cat' || true
    done
}

case ${1:-} in
    build | cert | backend | status) "$1" ;;
    server) server "${2:-}" ;;
    -h | --help) usage ;;
    *) usage >&2; exit 2 ;;
esac

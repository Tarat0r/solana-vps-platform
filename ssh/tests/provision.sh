#!/bin/bash
set -euo pipefail
export DEBIAN_FRONTEND=noninteractive
if ! getent ahostsv4 deb.debian.org >/dev/null; then
    # Some host DNS servers reject QEMU's DNS relay. Override only the guest.
    guest_interface=$(ip -4 route show default | awk '{print $5; exit}')
    resolvectl dns "$guest_interface" "${SOLANA_VM_DNS:-1.1.1.1}"
    resolvectl flush-caches
fi
printf 'Installing Debian build and SSH dependencies\n'
apt-get update -q -o APT::Update::Error-Mode=any
apt-get install -y -q cloud-guest-utils
root_device=$(findmnt -n -o SOURCE /)
root_disk="/dev/$(lsblk -n -o PKNAME "$root_device")"
root_partition=$(cat "/sys/class/block/$(basename "$root_device")/partition")
growpart "$root_disk" "$root_partition" || test "$(lsblk -b -n -o SIZE "$root_device")" -gt 10000000000
resize2fs "$root_device"
apt-get install -y -q openssh-server libpam0g-dev pkg-config build-essential cargo rustc rustfmt rust-clippy ca-certificates curl socat
install -d /opt/solana-ssh
tar -C /mnt/source --exclude=./target --exclude=./.vm --exclude=./.cache --exclude=./node_modules -cf - . | tar -C /opt/solana-ssh -xf -
cd /opt/solana-ssh
export CARGO_BUILD_JOBS=2
printf 'Building Rust components inside Debian\n'
cargo build --locked --workspace
cargo test --locked --workspace
cargo fmt --all -- --check
cargo clippy --locked --workspace --all-targets -- -D warnings
install -m 755 target/debug/solana-authd /usr/local/sbin/solana-authd
install -m 755 target/debug/test-services /usr/local/sbin/solana-test-services
install -m 755 target/debug/libpam_solana.so /usr/lib/x86_64-linux-gnu/security/pam_solana.so
set -a
source /etc/solana-auth/test.env
set +a
solana-test-services config > /etc/solana-auth/server.toml
chmod 600 /etc/solana-auth/server.toml
id ubuntu >/dev/null 2>&1 || useradd -m -s /bin/bash ubuntu
install -d -m 700 -o ubuntu -g ubuntu /home/ubuntu/.ssh
install -m 600 -o ubuntu -g ubuntu /mnt/source/.vm/bypass_key.pub /home/ubuntu/.ssh/authorized_keys
# A non-locked shadow entry permits PAM account checks; no password method is enabled.
usermod -p "$(openssl passwd -6 "$(head -c 32 /dev/urandom | base64)")" ubuntu
install -m 644 /mnt/source/deploy/solana-authd.service /etc/systemd/system/
install -m 644 /mnt/source/tests/solana-test-services.service /etc/systemd/system/
install -m 644 /mnt/source/deploy/sshd-wallet.conf /etc/ssh/sshd_config.d/00-solana-wallet.conf
if ! test -f /etc/pam.d/sshd.before-solana; then cp -a /etc/pam.d/sshd /etc/pam.d/sshd.before-solana; fi
# Retain Debian's account/session handling while replacing its authentication stack.
awk '!/^@include common-auth/ && !/^auth[[:space:]]/' /etc/pam.d/sshd.before-solana > /etc/pam.d/sshd
sed -i '1i auth requisite pam_solana.so' /etc/pam.d/sshd
ssh-keygen -A
install -d /run/sshd
sshd -t
sshd -T -C user=ubuntu,host=localhost,addr=127.0.0.1 | grep -E '^(usepam|authenticationmethods|passwordauthentication|pubkeyauthentication|kbdinteractiveauthentication|permitrootlogin) '
systemctl daemon-reload
systemctl enable --now solana-test-services
systemctl restart solana-test-services
systemctl enable --now solana-authd
systemctl restart solana-authd
systemctl enable --now ssh
systemctl restart ssh
for attempt in $(seq 1 30); do
    if test -S /run/solana-authd.sock; then break; fi
    sleep 1
done
test -S /run/solana-authd.sock
curl -fsS -H "Authorization: Bearer $SOLANA_TEST_TOKEN" http://127.0.0.1:8080/_test/status >/dev/null
printf 'SOLANA_VM_PROVISIONED\n'

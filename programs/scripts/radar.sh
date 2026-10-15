#!/usr/bin/env bash
# Scans the billing program with Radar (https://github.com/Auditware/radar), a
# static analyzer for Anchor programs, in the containers of radar/compose.yaml.
set -euo pipefail

usage() {
    cat <<'EOF'
Usage: radar.sh [--fail-on critical|high|medium|low|none]

Runs every built-in Radar template on billing-access/src and prints each finding
with its location. Exits 1 if a finding is at or above --fail-on (default: low,
so any finding fails) and 2 if Radar itself fails. The SARIF report is written
to target/radar.sarif.

To accept a finding, add `// radar-disable-next-line <Template_Name>` above it,
with a comment saying why. Needs Docker; the first run pulls about 2 GB of images.
EOF
}

die() {
    echo "radar.sh: $*" >&2
    exit 2
}

fail_on=low
while (($#)); do
    case $1 in
        --fail-on) fail_on=${2:?}; shift 2 ;;
        -h | --help) usage; exit 0 ;;
        *) usage >&2; exit 2 ;;
    esac
done
case $fail_on in
    critical | high | medium | low | none) ;;
    *) die "--fail-on must be critical, high, medium, low, or none" ;;
esac
command -v docker >/dev/null || die "required command not found: docker"

programs=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)
compose=(docker compose --file "$programs/radar/compose.yaml")

# Throwaway credentials for the scan's own database, broker, and API; nothing
# outside these containers can reach them.
secret() { od -An -tx1 -N24 /dev/urandom | tr -d ' \n'; }
RADAR_DB_PASSWORD=$(secret) RADAR_ADMIN_PASSWORD=$(secret)
RADAR_SECRET_KEY=$(secret) RADAR_BROKER_PASSWORD=$(secret)
export RADAR_DB_PASSWORD RADAR_ADMIN_PASSWORD RADAR_SECRET_KEY RADAR_BROKER_PASSWORD

# Removes only this project's containers, network, and volumes.
remove_stack() {
    "${compose[@]}" down --volumes --remove-orphans --timeout 10 >/dev/null 2>&1
}
remove_stack || true
trap 'remove_stack || true' EXIT

echo "Starting Radar..."
# The API queues one task per template; the Celery worker runs them.
if ! "${compose[@]}" up --detach --wait --quiet-pull api celeryworker >/dev/null 2>&1; then
    "${compose[@]}" logs --tail 40 api celeryworker >&2 || true
    die "the Radar API did not start"
fi

status=0
"${compose[@]}" run --rm --no-deps -T controller \
    --path "$programs" --container-path /contract --output radar.sarif --fail-on "$fail_on" ||
    status=$?

# The controller writes its report into the shared volume, read through the API container.
mkdir -p "$programs/target"
"${compose[@]}" cp api:/radar_data/output.sarif "$programs/target/radar.sarif" >/dev/null 2>&1 ||
    echo "radar.sh: no SARIF report was written" >&2
exit "$status"

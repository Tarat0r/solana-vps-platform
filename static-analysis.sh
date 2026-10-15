#!/usr/bin/env bash
# Runs every static check in the repository. Needs no VM or validator, so it
# also runs first in test-all.sh.
set -euo pipefail

usage() {
    cat <<'EOF'
Usage: ./static-analysis.sh

Runs every static check, cheapest first, and stops at the first failure:
  secrets     .run/, .env, and VM state stay git-ignored; gitleaks finds no
              secrets in git history or in the files git would commit
  shell       ShellCheck on every committable *.sh
  docker      hadolint on backend/Dockerfile; docker compose validates compose.yaml
  rust        backend/, ssh/, programs/: rustfmt, Clippy with the lints in each
              Cargo.toml, and cargo-deny with deny.toml
  program     Radar's Solana/Anchor templates on the billing program
              (programs/scripts/radar.sh)
  typescript  frontend/, ssh/, programs/: locked install, tsc, and npm audit;
              ESLint in frontend/

Requires Node 22.18+, Rust with Clippy and rustfmt, cargo-deny
(cargo install --locked cargo-deny), and Docker. ShellCheck, hadolint, and
gitleaks run from pinned Docker images unless they are installed locally;
Radar always runs in Docker (its first run pulls about 2 GB of images).
EOF
}

die() {
    echo "static-analysis.sh: $*" >&2
    exit 2
}

for arg in "$@"; do
    case $arg in
        -h | --help) usage; exit 0 ;;
        *) usage >&2; exit 2 ;;
    esac
done

cd -- "$(dirname -- "${BASH_SOURCE[0]}")"
for tool in git node npm cargo cargo-deny docker; do
    command -v "$tool" >/dev/null || die "required command not found: $tool"
done

shellcheck_image=koalaman/shellcheck:v0.10.0
hadolint_image=hadolint/hadolint:v2.12.0
gitleaks_image=zricethezav/gitleaks:v8.24.0

# Local keys and tokens: run.sh writes .run/, compose reads .env, and the VM keeps ssh/.vm/.
ignored_state() {
    local path
    for path in .run/provider.json .env ssh/.vm/secrets.json; do
        git check-ignore -q "$path" || { echo "$path is not git-ignored" >&2; return 1; }
    done
}

gitleaks_history() {
    if command -v gitleaks >/dev/null; then
        gitleaks git --no-banner --redact --config .gitleaks.toml .
    else
        docker run --rm --user "$(id -u):$(id -g)" -v "$PWD:/repo:ro" -w /repo "$gitleaks_image" \
            git --no-banner --redact --config .gitleaks.toml .
    fi
}

# Tracked and untracked files that are not ignored, skipping tracked files deleted from the tree.
committable_files() {
    git ls-files -z --cached --others --exclude-standard | while IFS= read -r -d '' file; do
        if [[ -e $file || -L $file ]]; then printf '%s\0' "$file"; fi
    done
}

# Scans a copy of exactly the committable files, so ignored local state is never reported.
gitleaks_files() {
    if command -v gitleaks >/dev/null; then
        local tree status=0
        tree=$(mktemp -d)
        committable_files | tar --null --files-from=- -cf - | tar -xf - -C "$tree"
        (cd "$tree" && gitleaks dir --no-banner --redact --config .gitleaks.toml .) || status=$?
        rm -rf "$tree"
        return "$status"
    fi
    committable_files | tar --null --files-from=- -cf - |
        docker run --rm -i --user "$(id -u):$(id -g)" --entrypoint sh "$gitleaks_image" -c \
            'mkdir /tmp/tree && tar -xf - -C /tmp/tree && cd /tmp/tree && gitleaks dir --no-banner --redact --config .gitleaks.toml .'
}

shellcheck_scripts() {
    local scripts
    mapfile -t scripts < <(git ls-files --cached --others --exclude-standard '*.sh')
    if command -v shellcheck >/dev/null; then
        shellcheck -x "${scripts[@]}"
    else
        docker run --rm -v "$PWD:/mnt:ro" -w /mnt "$shellcheck_image" -x "${scripts[@]}"
    fi
}

hadolint_dockerfile() {
    if command -v hadolint >/dev/null; then
        hadolint backend/Dockerfile
    else
        docker run --rm -i "$hadolint_image" <backend/Dockerfile
    fi
}

# Validated with the example settings, so no real dashboard.json is needed.
compose_config() {
    DASHBOARD_CONFIG=backend/dashboard.json.example docker compose config --quiet
}

summary=()
stage() {
    local name=$1 started=$SECONDS
    shift
    printf '\n==> %s\n$ %s\n' "$name" "$*"
    if ! "$@"; then
        printf '\nstatic-analysis.sh: failed at "%s" after %ss\n' "$name" "$((SECONDS - started))" >&2
        exit 1
    fi
    summary+=("$(printf '%6ss  %s' "$((SECONDS - started))" "$name")")
}

stage "Keep local keys git-ignored" ignored_state
stage "Scan git history for secrets" gitleaks_history
stage "Scan committable files for secrets" gitleaks_files
stage "Check shell scripts" shellcheck_scripts
stage "Check the gateway Dockerfile" hadolint_dockerfile
stage "Validate compose.yaml" compose_config

for workspace in backend ssh programs; do
    manifest=$workspace/Cargo.toml
    stage "Check $workspace/ Rust formatting" cargo fmt --manifest-path "$manifest" --all -- --check
    stage "Lint $workspace/ Rust code" cargo clippy --manifest-path "$manifest" --locked --workspace --all-targets -- -D warnings
    stage "Audit $workspace/ Rust dependencies" cargo deny --manifest-path "$manifest" --config deny.toml check
done
stage "Scan the billing program with Radar" programs/scripts/radar.sh

for package in frontend ssh programs; do
    stage "Install $package/ locked dependencies" npm --prefix "$package" ci --ignore-scripts --no-audit --no-fund
    stage "Type-check $package/" npm --prefix "$package" run typecheck
    stage "Audit $package/ npm dependencies" npm --prefix "$package" audit --audit-level=low
done
stage "Lint frontend/" npm --prefix frontend run lint

printf '\nAll checks passed in %ss:\n' "$SECONDS"
printf '%s\n' "${summary[@]}"

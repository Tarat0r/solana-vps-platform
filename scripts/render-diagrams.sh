#!/usr/bin/env bash
set -euo pipefail

script_dir="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
repo_root="$(cd -- "$script_dir/.." && pwd)"
cd "$repo_root"

for command in plantuml dot; do
  if ! command -v "$command" >/dev/null 2>&1; then
    printf 'Required command not found: %s (install PlantUML and Graphviz).\n' "$command" >&2
    exit 1
  fi
done

mapfile -t diagram_names < <(
  sed -nE 's/.*\]\(docs\/diagrams\/([a-z0-9-]+)\.svg\).*/\1/p' Architecture.md
)
if ((${#diagram_names[@]} == 0)); then
  printf 'No diagram SVGs found in Architecture.md.\n' >&2
  exit 1
fi

render_tmp="$(mktemp -d)"
trap 'rm -rf -- "$render_tmp"' EXIT

# Render and validate all diagrams before replacing any existing SVGs.
for name in "${diagram_names[@]}"; do
  source_file="docs/diagrams/$name.puml"
  if [[ ! -s "$source_file" ]]; then
    printf 'Missing or empty PlantUML source: %s\n' "$source_file" >&2
    exit 1
  fi

  raw_svg="$render_tmp/$name.raw.svg"
  stderr_file="$render_tmp/$name.stderr"
  if ! JAVA_TOOL_OPTIONS="${JAVA_TOOL_OPTIONS:+$JAVA_TOOL_OPTIONS }-Djava.awt.headless=true" \
    plantuml -tsvg -pipe -charset UTF-8 -failfast2 \
      < "$source_file" > "$raw_svg" 2> "$stderr_file"; then
    cat "$stderr_file" >&2
    printf 'Failed to render %s.\n' "$source_file" >&2
    exit 1
  fi
  if ! grep -q '<svg' "$raw_svg"; then
    cat "$stderr_file" >&2
    printf 'PlantUML did not produce an SVG for %s.\n' "$source_file" >&2
    exit 1
  fi

  sed '0,/<svg/{s|<svg[^>]*>|&<rect width="100%" height="100%" fill="#FFFFFF"/>|;}' \
    "$raw_svg" > "$render_tmp/$name.svg"
done

for name in "${diagram_names[@]}"; do
  cp -- "$render_tmp/$name.svg" "docs/diagrams/$name.svg"
  printf 'Rendered docs/diagrams/%s.svg\n' "$name"
done

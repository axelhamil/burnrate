#!/usr/bin/env bash
set -euo pipefail

root="$(cd "$(dirname "$0")/.." && pwd)"
out="$root/docs/snapshots"
log="$(mktemp)"
trap 'trash "$log" 2>/dev/null || unlink "$log"' EXIT

claude plugin test "$root" > "$log" 2>&1 || { cat "$log"; exit 1; }

mkdir -p "$out"
awk -v out="$out" '
  /^<<<snapshot / { file = out "/" $2; printf "" > file; next }
  /^>>>snapshot/ { close(file); file = ""; next }
  file != "" { print >> file }
' "$log"

ls "$out"

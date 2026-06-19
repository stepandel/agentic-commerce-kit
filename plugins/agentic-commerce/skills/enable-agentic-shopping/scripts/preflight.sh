#!/usr/bin/env bash
# preflight.sh — verify prerequisites for enabling agentic shopping in a store.
# Read-only: it inspects and reports, and only OFFERS to generate MPP_SECRET_KEY.
#
# Usage: preflight.sh [store-path]   (defaults to current directory)

set -uo pipefail
STORE="${1:-.}"
ok=0; warn=0; fail=0
pass() { printf '  \033[32m✓\033[0m %s\n' "$1"; ok=$((ok+1)); }
note() { printf '  \033[33m!\033[0m %s\n' "$1"; warn=$((warn+1)); }
bad()  { printf '  \033[31m✗\033[0m %s\n' "$1"; fail=$((fail+1)); }

echo "Preflight for agentic shopping in: $STORE"

# --- Runtime + package manager ---------------------------------------------
echo "Runtime & package manager:"
if   command -v bun  >/dev/null 2>&1; then pass "bun $(bun --version)"; fi
if   command -v node >/dev/null 2>&1; then pass "node $(node --version)"; else bad "node not found"; fi
PM="npm"
[ -f "$STORE/bun.lock" ] || [ -f "$STORE/bun.lockb" ] && PM="bun"
[ -f "$STORE/pnpm-lock.yaml" ] && PM="pnpm"
[ -f "$STORE/yarn.lock" ] && PM="yarn"
pass "package manager: $PM"

# --- package.json + deps ----------------------------------------------------
echo "Project:"
if [ -f "$STORE/package.json" ]; then
  pass "package.json found"
  grep -q '"mppx"'   "$STORE/package.json" && pass "mppx already a dependency"   || note "mppx not installed yet (will add)"
  grep -q '"stripe"' "$STORE/package.json" && pass "stripe already a dependency" || note "stripe not installed yet (will add)"
else
  note "no package.json at store root — confirm the correct path / stack"
fi

# --- env values (read from .env / .env.local if present, else environment) ---
echo "Stripe & MPP prerequisites:"
ENV_BLOB=""
for f in "$STORE/.env" "$STORE/.env.local"; do
  [ -f "$f" ] && ENV_BLOB="$ENV_BLOB"$'\n'"$(cat "$f")"
done
getenv() { # name -> value from env files first, then process env
  local v; v="$(printf '%s\n' "$ENV_BLOB" | grep -E "^$1=" | tail -1 | cut -d= -f2- | tr -d '"'"'"' ')"
  [ -n "$v" ] && { printf '%s' "$v"; return; }
  printf '%s' "${!1:-}"
}

SK="$(getenv STRIPE_SECRET_KEY)"
if   [ -z "$SK" ];                  then bad  "STRIPE_SECRET_KEY missing (see references/stripe-prerequisites.md)"
elif [[ "$SK" == sk_live_* ]];      then pass "STRIPE_SECRET_KEY present (live)"
elif [[ "$SK" == sk_test_* ]];      then note "STRIPE_SECRET_KEY is a TEST key — ok for dev, must be sk_live_ for production"
else                                     bad  "STRIPE_SECRET_KEY has unexpected shape (expected sk_live_/sk_test_)"; fi

PID="$(getenv STRIPE_PROFILE_ID)"
if   [ -z "$PID" ];                 then bad  "STRIPE_PROFILE_ID missing (create a Stripe SPT profile)"
elif [[ "$PID" == profile_test_* ]];then note "STRIPE_PROFILE_ID is a TEST profile — must be profile_ (live) for production"
elif [[ "$PID" == profile_* ]];     then pass "STRIPE_PROFILE_ID present (live)"
else                                     bad  "STRIPE_PROFILE_ID has unexpected shape (expected profile_...)"; fi

MK="$(getenv MPP_SECRET_KEY)"
if [ -z "$MK" ]; then
  note "MPP_SECRET_KEY missing — generate one with: openssl rand -base64 32"
  if command -v openssl >/dev/null 2>&1; then
    echo "      suggested: MPP_SECRET_KEY=$(openssl rand -base64 32)"
  fi
else
  pass "MPP_SECRET_KEY present"
fi

echo
echo "Summary: $ok ok, $warn warnings, $fail blocking."
if [ "$fail" -gt 0 ]; then
  echo "Resolve the ✗ items before agents can pay. They are forks for the user —"
  echo "see references/stripe-prerequisites.md and ask before proceeding."
  exit 1
fi
exit 0

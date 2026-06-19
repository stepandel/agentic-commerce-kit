#!/usr/bin/env bash
# preflight.sh — verify prerequisites for enabling agentic shopping in a store.
# Language-aware: detects the store's language (JS/TS, Python, Go, Rust, Ruby) and
# checks the matching runtime + MPP SDK. The Stripe/MPP secret checks are the same
# for every language. Read-only: it inspects and reports, and only OFFERS to
# generate MPP_SECRET_KEY.
#
# Usage: preflight.sh [store-path]   (defaults to current directory)

set -uo pipefail
STORE="${1:-.}"
ok=0; warn=0; fail=0
pass() { printf '    \033[32m✓\033[0m %s\n' "$1"; ok=$((ok+1)); }
note() { printf '    \033[33m!\033[0m %s\n' "$1"; warn=$((warn+1)); }
bad()  { printf '    \033[31m✗\033[0m %s\n' "$1"; fail=$((fail+1)); }
have() { command -v "$1" >/dev/null 2>&1; }
indeps() { grep -RqiE "$1" $2 2>/dev/null; }  # pattern, files

echo "Preflight for agentic shopping in: $STORE"

# --- Language / runtime detection ------------------------------------------
echo "Language & runtime:"
LANGS=""
[ -f "$STORE/package.json" ] && LANGS="$LANGS js"
{ [ -f "$STORE/pyproject.toml" ] || [ -f "$STORE/requirements.txt" ] || [ -f "$STORE/setup.py" ]; } && LANGS="$LANGS python"
[ -f "$STORE/go.mod" ] && LANGS="$LANGS go"
[ -f "$STORE/Cargo.toml" ] && LANGS="$LANGS rust"
[ -f "$STORE/Gemfile" ] && LANGS="$LANGS ruby"
LANGS="$(echo "$LANGS" | xargs)"
if [ -z "$LANGS" ]; then
  note "no recognized manifest (package.json / pyproject.toml / go.mod / Cargo.toml / Gemfile) at $STORE — confirm the path/stack"
else
  pass "detected: $LANGS"
fi

check_js() {
  if have node; then pass "node $(node --version)"
  elif have bun; then pass "bun $(bun --version)"
  else note "no JS runtime (node/bun) found"; fi
  PM="npm"; { [ -f "$STORE/bun.lock" ] || [ -f "$STORE/bun.lockb" ]; } && PM="bun"
  [ -f "$STORE/pnpm-lock.yaml" ] && PM="pnpm"; [ -f "$STORE/yarn.lock" ] && PM="yarn"
  pass "package manager: $PM"
  indeps '"mppx"'   "$STORE/package.json" && pass "mppx dependency present"   || note "mppx not installed yet (npm i mppx)"
  indeps '"stripe"' "$STORE/package.json" && pass "stripe dependency present" || note "stripe not installed yet (npm i stripe)"
}
check_python() {
  have python3 && pass "python $(python3 --version 2>&1 | awk '{print $2}')" || note "python3 not found"
  indeps 'pympp' "$STORE/pyproject.toml $STORE/requirements.txt" && pass "pympp dependency present" || note "pympp not installed yet (pip install pympp)"
  indeps '(^|[^a-z])stripe' "$STORE/pyproject.toml $STORE/requirements.txt" && pass "stripe dependency present" || note "stripe SDK not listed (pip install stripe)"
}
check_go() {
  have go && pass "go $(go version 2>/dev/null | awk '{print $3}')" || note "go not found"
  indeps 'tempoxyz/mpp-go' "$STORE/go.mod" && pass "mpp-go dependency present" || note "mpp-go not installed yet (go get github.com/tempoxyz/mpp-go)"
  bad "Go MPP SDK has no Stripe method yet — Stripe SPT is a HARD FORK for Go stores (raw-HTTP Stripe or a TS sidecar; see references/sdks-and-languages.md)"
}
check_rust() {
  have cargo && pass "cargo $(cargo --version 2>/dev/null | awk '{print $2}')" || note "cargo not found"
  indeps '^[[:space:]]*mpp[[:space:]]*=' "$STORE/Cargo.toml" && pass "mpp crate present" || note "mpp crate not added yet (cargo add mpp --features client,server)"
}
check_ruby() {
  have ruby && pass "ruby $(ruby --version 2>/dev/null | awk '{print $2}')" || note "ruby not found"
  indeps 'mpp-rb' "$STORE/Gemfile" && pass "mpp-rb gem present" || note "mpp-rb not installed yet (gem install mpp-rb)"
  indeps "['\"]stripe['\"]" "$STORE/Gemfile" && pass "stripe gem present" || note "stripe gem not listed (gem install stripe)"
}

if [ -n "$LANGS" ]; then
  echo "Project & MPP SDK:"
  for L in $LANGS; do
    echo "  [$L]"
    case "$L" in
      js) check_js ;; python) check_python ;; go) check_go ;; rust) check_rust ;; ruby) check_ruby ;;
    esac
  done
fi

# --- Stripe & MPP prerequisites (language-agnostic) -------------------------
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
  have openssl && echo "      suggested: MPP_SECRET_KEY=$(openssl rand -base64 32)"
else
  pass "MPP_SECRET_KEY present"
fi

echo
echo "Summary: $ok ok, $warn warnings, $fail blocking."
if [ "$fail" -gt 0 ]; then
  echo "Resolve the ✗ items before agents can pay. They are forks for the user —"
  echo "see references/stripe-prerequisites.md and references/sdks-and-languages.md, and ask before proceeding."
  exit 1
fi
exit 0

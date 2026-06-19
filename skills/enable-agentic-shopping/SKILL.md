---
name: enable-agentic-shopping
description: Add agentic shopping (AI-agent checkout) to an existing store or website. Wires up MPP (Machine Payments Protocol) checkout over Stripe Shared Payment Tokens plus the agent discovery layer (llms.txt, agent-storefront manifest, OpenAPI). Use when the user wants agents/LLMs to be able to discover, price, pay for, and buy from their store. Verifies Stripe prerequisites, installs code, and confirms the 402 payment flow works.
argument-hint: [path-to-target-store]
---

# Enable Agentic Shopping

Turn an existing store into one that AI agents can shop: discover products, get a
quote, pay with a Stripe Shared Payment Token over the Machine Payments Protocol
(MPP), and receive fulfillment — all without a human browser checkout.

This skill is **Stripe-SPT-only** for now, and works against any store regardless of
language. MPP is an HTTP-native protocol (`402` + `WWW-Authenticate: Payment` /
`Authorization: Payment` / `Payment-Receipt`) with official SDKs in **TypeScript,
Python, Rust, Go, and Ruby**, so the same flow can be implemented in any of them — or
directly over raw HTTP where no SDK fits.

The bundled `templates/` are **TypeScript** (the deepest, proven path, built on the
`mppx` SDK and web-standard `Request`/`Response`, mounting on Next.js, Hono, Bun,
Deno, Express, etc.). For a non-JS store, use that language's official MPP SDK
following the identical protocol — see `references/sdks-and-languages.md`. One sharp
edge: **the Go SDK does not support Stripe yet**, so a Go store is a hard fork
(Step 3).

## What gets added to the store

1. **Agent discovery layer** (read-only, no payment):
   - `GET /llms.txt` — terse operating instructions for agents
   - `GET /.well-known/agent-storefront.json` — machine-readable manifest
   - `GET /openapi.json` — OpenAPI 3.1 spec
2. **MPP checkout layer** — the `402 Payment Required` → SPT → settle flow:
   - `POST /api/agent/orders/validate` — preflight quote, no payment, no fulfillment
   - `POST /api/agent/orders` — create+pay; `402` with `WWW-Authenticate` challenge
     when no credential, `202` with the settled order when paid
   - `GET /api/agent/orders/{order_id}` — poll payment/fulfillment status
3. **Store hooks** — the store-specific glue (catalog, pricing, fulfillment,
   order persistence) the operator must supply. These are the forks.

See `references/mpp-payment-flow.md` for the protocol details and `templates/` for
the code that gets copied in.

## The prime directive: resolve forks WITH the user

Every store is different. Whenever a decision is **ambiguous, irreversible, or
store-specific**, STOP and ask the user with `AskUserQuestion` — never guess.
The forks that must be resolved by the user are enumerated in Step 3. Defaults are
offered only for genuinely reversible, conventional choices, and even then you
state the default you took.

## Workflow

Run these steps in order. Track them with TaskCreate/TaskUpdate so the user can
see progress.

### Step 1 — Locate and profile the target store

1. Resolve the target store path (the skill argument, else ask the user).
2. Detect the **language/runtime first**, then the framework, so you know which MPP
   SDK and adapter to use and where routes live:
   - Language: look for `package.json` (JS/TS), `pyproject.toml`/`requirements.txt`
     (Python), `go.mod` (Go), `Cargo.toml` (Rust), `Gemfile` (Ruby). Map it to the
     official SDK in `references/sdks-and-languages.md`.
   - JS/TS: package manager via lockfile (`bun.lock`→bun, `pnpm-lock.yaml`→pnpm,
     `yarn.lock`→yarn, else npm); framework (Next.js, Hono, Express, Fastify, Nuxt,
     SvelteKit, Remix, or a bare Node/Bun/Deno server). Other languages: identify the
     web framework (FastAPI/Flask/Django, net/http/Gin, axum/actix, Rails/Sinatra).
   - Find where HTTP routes/handlers are defined and how env/secrets are loaded.
   - Find the existing product catalog and any existing (human) checkout, so the
     agent endpoints can reuse pricing and coexist with browser checkout.
3. Summarize findings to the user in 3–5 lines before changing anything.
4. If the repo has uncommitted changes or no VCS, say so; offer to proceed anyway.

### Step 2 — Verify prerequisites

Run the bundled preflight check (or do the checks inline). The bundled resources
(`scripts/`, `references/`, `templates/`) live alongside this SKILL.md — resolve
them relative to **this skill's own directory**, whatever agent loaded it (e.g.
`<skill-dir>/scripts/preflight.sh <store-path>`). On Claude Code that directory is
`${CLAUDE_PLUGIN_ROOT}/skills/enable-agentic-shopping/`; on other agents it is the
skill folder under their skills directory (`~/.codex/skills/…`, `~/.cursor/skills/…`,
etc.). The preflight verifies:

- **Language, runtime + package manager** (it detects JS/TS, Python, Go, Rust, or
  Ruby and checks the matching toolchain).
- **The matching MPP SDK** is installed or installable (`mppx`, `pympp`, `mpp` crate,
  `mpp-rb`, or `mpp-go`) plus `stripe` where applicable. For a Go store it flags the
  Stripe hard fork.
- **Stripe live secret key** is available (`STRIPE_SECRET_KEY=sk_live_…`). Test keys
  (`sk_test_…`) are flagged: production agentic checkout requires live credentials.
- **Stripe profile id** for SPT (`STRIPE_PROFILE_ID=profile_…`, NOT `profile_test_…`).
  This is the SPT network id agents mint tokens against.
- **`MPP_SECRET_KEY`** (HMAC secret binding challenges to orders). If absent, generate
  one with `openssl rand -base64 32` and add it to the store's env.

If any Stripe prerequisite is missing, this is a **hard fork** — STOP and walk the
user through obtaining it. See `references/stripe-prerequisites.md` for the exact
Dashboard/CLI steps and how to validate each value. Do not fabricate keys or proceed
with test credentials toward a production setup.

### Step 3 — Resolve integration forks (ask the user)

Use `AskUserQuestion`. These decisions change the generated code; do not assume them:

1. **Language & MPP SDK** — confirm the store's language and the implementation path:
   its official MPP SDK (`mppx` for JS/TS, `pympp` for Python, `mpp` crate for Rust,
   `mpp-rb` for Ruby, `mpp-go` for Go), or raw HTTP if none fits. The bundled
   templates cover JS/TS directly; other languages reuse the SAME protocol via their
   SDK. **Go + Stripe is a hard fork** — Stripe SPT is not in the Go SDK yet, so a Go
   store must either implement the Stripe charge over raw HTTP or front checkout with
   a small JS/TS service. Surface this and let the user choose.
2. **Catalog source** — single product, a fixed list, or read from the store's
   existing catalog/DB? Determines `catalog`/`parse` in the hooks.
3. **Pricing / quote** — fixed price, computed (qty × unit, tiers, duration), or
   reuse the store's existing pricing function? Determines `quote`.
4. **Fulfillment** — what "delivery" means after payment: grant access / issue a
   license or token / create a DB order / call an existing fulfillment service /
   provision a resource. Determines `fulfill`. This is the most store-specific fork.
5. **Order persistence & idempotency store** — where orders live so a `request_id`
   replay resolves to the same order (existing DB, Redis/KV, or a simple table).
   Agentic checkout REQUIRES idempotent replay; pick a durable store for production.
6. **Mount path & framework adapter** — confirm the route base path and which
   adapter to use (`references/framework-adapters.md` for JS; the SDK's framework
   middleware for other languages, per `references/sdks-and-languages.md`).
7. **Coexistence** — keep the human/browser checkout untouched (default) and add the
   agent endpoints alongside it. Confirm there is no path collision.
8. **Deploy target & env** — where prod env vars are set (Vercel, Fly, Railway,
   container, etc.), so the handoff in Step 6 is accurate.

Record the answers; they drive Step 4–5.

### Step 4 — Install dependencies and code

**JS/TS stores** (the bundled templates apply directly):

1. Install deps with the detected package manager: `mppx` and `stripe`.
2. Copy the templates into the store, adapting names to its conventions:
   - `templates/config.ts` → loads + guards Stripe/MPP env (the prereqs in code).
   - `templates/mpp-core.ts` → the MPP composer + 402 handling + order-digest replay
     binding + the generic validate/create/status handlers.
   - `templates/store-hooks.ts` → **fill from the Step 3 answers**: `parse`, `quote`,
     `fulfill`, `findOrder`/`createOrder`, `catalog`. This is where store logic lives.
   - `templates/discovery.ts` → fill the `storefront` descriptor (name, products,
     pricing, paths, policy) to generate llms.txt / manifest / OpenAPI.
   - Mount handlers using the adapter snippet for the detected framework.
   - Merge `templates/env.example` into the store's `.env.example` (never overwrite
     real secrets; only add missing keys).

**Non-JS stores** (Python/Rust/Ruby/Go): install the language's MPP SDK from
`references/sdks-and-languages.md`, then build the same three endpoints + discovery
using the SDK's typed Challenge/Credential/Receipt primitives. Use the TS templates
as the behavioral spec — replicate the same logic: idempotent `order_id` derived from
`request_id`, the order-digest replay binding, the "rejected vs no credential"
distinction, fulfill only on a settled receipt, and the same discovery JSON. Keep the
same prerequisite guards (live Stripe key + profile, `MPP_SECRET_KEY`). The discovery
documents are language-independent JSON/text — port `discovery.ts` verbatim in shape.

3. Keep edits additive. Do not modify existing checkout logic beyond what's needed
   to share catalog/pricing.

### Step 5 — Verify it works

1. Typecheck / build the store.
2. Start the dev server and exercise the flow with curl (see
   `references/mpp-payment-flow.md` for exact commands):
   - `GET /llms.txt`, `/.well-known/agent-storefront.json`, `/openapi.json` return 200.
   - `POST …/orders/validate` returns a quote.
   - `POST …/orders` with NO credential returns **402** with a `WWW-Authenticate:
     Payment …` challenge and `{ order_id, status: "unpaid" }`.
   - Resending the identical body resolves to the same `order_id` (idempotency).
3. Report exactly what passed and what didn't — include real output, don't claim
   success you didn't observe. The full paid leg needs a live SPT (Stripe Link CLI);
   guide the user to run it rather than faking a charge.

### Step 6 — Hand off

Tell the user:
- Which files were added/changed and what each does.
- The env vars to set in their deploy target (from Step 3.8), and that test Stripe
  keys must be swapped for live before agents can pay for real.
- How to test the paid leg end-to-end with the Stripe Link CLI (see
  `references/mpp-payment-flow.md`).
- The security guardrails already enforced (live-key requirement, order-digest
  replay binding, idempotency, never logging tokens) and any follow-ups (durable
  order store, rate limiting).

## Bundled resources

- `references/sdks-and-languages.md` — the official MPP SDKs per language (package
  names, Stripe SPT support, the Go-Stripe gap) and the raw-HTTP wire contract for
  languages without an SDK. Read this first when the store isn't JS/TS.
- `references/mpp-payment-flow.md` — the 402/SPT protocol (language-neutral), the
  `mppx` server API as the TS reference, replay binding, the "rejected vs no
  credential" distinction, and curl test recipes.
- `references/stripe-prerequisites.md` — how to obtain and validate the live key,
  the SPT profile, and the MPP secret; production guardrails.
- `references/framework-adapters.md` — JS/TS adapters (Next.js / Hono / Bun / Deno /
  Express / Fastify). For other languages, use the SDK's framework middleware.
- `templates/` — the TS code copied into JS/TS stores (see Step 4).
- `scripts/preflight.sh` — prerequisite checks; safe to run read-only.

# Stripe prerequisites for agentic checkout

Three secrets must exist before agents can pay. Verify each; if any is missing, this
is a hard fork — stop and walk the user through it. Never fabricate values or
proceed toward production with test credentials.

## 1. Stripe live secret key — `STRIPE_SECRET_KEY=sk_live_…`

- Found in the Stripe Dashboard → Developers → API keys (with the account in **live**
  mode, not the "Test mode" toggle).
- Validate shape: must start with `sk_live_`. A `sk_test_…` key only works against
  Stripe test mode and sandbox tokens; production agentic checkout rejects it.
- For local development you MAY use a test key, but the code guards production: it
  refuses to compose payment unless the key is `sk_live_…`. Make the test-vs-live
  choice explicit with the user.

## 2. Stripe profile id (SPT network) — `STRIPE_PROFILE_ID=profile_…`

This is the network id agents mint their Shared Payment Token against. It is what
ties the MPP challenge to your Stripe account.

- Create a **live** Stripe profile in the Dashboard (the profiles / Shared Payment
  Token area) and copy its `profile_…` id.
- Validate shape: starts with `profile_` and is NOT `profile_test_…` (a test profile).
- The live key (#1) and live profile (#2) must belong to the same account.

If the user does not yet have SPT/profiles enabled on their account, that is the
blocker to resolve first — direct them to enable Shared Payment Tokens for their
Stripe account, then create a profile.

## 3. MPP HMAC secret — `MPP_SECRET_KEY=<base64>`

Signs and binds the 402 challenge `meta` (including the order digest) so a credential
cannot be replayed against a different order. Not a Stripe value — you generate it:

```bash
openssl rand -base64 32
```

Set it once and keep it stable per environment (rotating it invalidates outstanding
challenges, which is fine since they expire in ~10 minutes anyway). Store it as a
secret, never commit it.

## Optional / tunable

- `STRIPE_PAYMENT_METHOD_TYPES` — CSV of SPT-backed methods to advertise. Default
  `card,link`.
- `CURRENCY` — default `usd`. Keep consistent with the profile and your pricing.
- Pricing inputs (e.g. base fee, unit rate) are store-specific — surface them as env
  or read them from the store's existing catalog/pricing.

## Production guardrails the code enforces

The generated `config.ts` fails fast (throws a `MppConfigError` surfaced as HTTP 503,
not a 500) when, in production:

- `STRIPE_SECRET_KEY` is missing or not `sk_live_…`.
- `STRIPE_PROFILE_ID` is missing or is a `profile_test_…`.
- `MPP_SECRET_KEY` is missing.

This makes a misconfigured deploy refuse payment cleanly instead of charging against
the wrong account or leaking a stack trace. Keep these checks.

## Quick validation checklist

| Value | Present? | Shape ok? | Live (prod)? |
|-------|----------|-----------|--------------|
| `STRIPE_SECRET_KEY` | | `sk_live_…` / `sk_test_…` | must be `sk_live_` |
| `STRIPE_PROFILE_ID` | | `profile_…` | not `profile_test_` |
| `MPP_SECRET_KEY` | | base64, ~44 chars | any stable value |

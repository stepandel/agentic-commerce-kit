# MPP SDKs and languages

MPP is an **HTTP-native protocol**, not a library. The wire contract is the same in
every language; SDKs just give you typed `Challenge` / `Credential` / `Receipt`
primitives and payment-method helpers. A store in any language can support agentic
checkout — pick its official SDK, or implement the raw HTTP flow.

Maintained by Tempo Labs and Stripe. Protocol specs: <https://github.com/tempoxyz/mpp-specs>.
SDK docs: <https://mpp.dev/sdk>.

## Official SDKs

| Language | Install | Import / module | Stripe SPT (this skill) |
|----------|---------|-----------------|--------------------------|
| TypeScript / JS | `npm i mppx` | `mppx`, `mppx/server`, `mppx/client` | ✅ yes — **bundled templates** |
| Python | `pip install pympp` (`pympp[tempo]` for Tempo) | `from mpp import …`, `from mpp.server import Mpp` | ✅ yes |
| Rust | `cargo add mpp --features client,server` (`,tempo`) | crate `mpp` | ✅ yes |
| Ruby | `gem install mpp-rb` | gem `mpp-rb` (maintained by Stripe) | ✅ yes |
| Go | `go get github.com/tempoxyz/mpp-go` | `github.com/tempoxyz/mpp-go` | ❌ **not yet** |

Version-specific notes (verify against current docs before relying on them):
- Python & Ruby: MPP "session" intent not yet supported (this skill uses charge, fine).
- Go: Stripe method + event handling + session intent not yet supported.

## The Go + Stripe gap (hard fork)

This skill is Stripe-SPT-only, and the Go SDK has no Stripe method yet. For a Go
store, surface the choice to the user:
1. **Raw-HTTP Stripe** — implement the 402/charge against Stripe directly in Go
   (more work; you own the SPT verification and receipt).
2. **Sidecar** — front the agent checkout endpoint with a small TS service using the
   bundled templates, and have it call back into the Go app for catalog/fulfillment.
3. **Wait / non-Stripe method** — out of scope here (this skill is Stripe-only).

## Payment methods (for context)

MPP SDKs support multiple rails: **Tempo** (charge/session/subscription), **Stripe**
(Shared Payment Tokens), **EVM**, **Lightning**, **Solana**, **Stellar**, **Monad**,
**RedotPay**, and custom methods. This skill wires **Stripe SPT only** — see
`mpp-payment-flow.md`.

## The raw HTTP contract (any language, no SDK)

If no SDK fits, implement these directly. This is all MPP is on the wire:

- **Gate**: when a request to the paid endpoint has no acceptable credential, respond
  `402 Payment Required` with a `WWW-Authenticate: Payment …` header describing the
  accepted method(s) and parameters (for Stripe SPT: the network/profile id, amount,
  currency, and an expiry), plus your JSON body (`{ order_id, status: "unpaid" }`).
- **Pay**: the agent retries the identical request with `Authorization: Payment <credential>`.
- **Verify & settle**: validate the credential for the advertised method/amount and
  that it is bound to THIS order (the order digest you put in the challenge). Only on
  success do you fulfill, and you return a `Payment-Receipt` header.
- **Bind**: HMAC the challenge parameters (including the order digest) with your
  `MPP_SECRET_KEY` so a credential can't be replayed against a different order.

The framing, headers, and binding semantics are normative in the specs; replicate the
behavior of the TS templates exactly (idempotency, replay binding, rejected-vs-absent
credential, fulfill-only-on-settled). When in doubt, prefer the official SDK over a
hand-rolled implementation — Stripe SPT verification is easy to get subtly wrong.

## Discovery is language-independent

`/llms.txt`, `/.well-known/agent-storefront.json`, and `/openapi.json` are just
text/JSON. Port `templates/discovery.ts` by shape into any language — the contents
don't change with the runtime.

# MPP payment flow (Stripe SPT)

The Machine Payments Protocol (MPP) gates a resource behind HTTP `402 Payment
Required` using the ["Payment" HTTP Authentication scheme]. An agent reads the
challenge, mints a credential (here: a Stripe **Shared Payment Token**), and
retries the *identical* request with `Authorization: Payment <credential>`.

The flow below is **language-neutral** — it's the MPP wire protocol. The code samples
use the TypeScript `mppx` SDK (`mppx`, `mppx/server`) as the reference implementation;
the same flow is available in the Python/Rust/Ruby/Go SDKs or over raw HTTP. See
`sdks-and-languages.md` for per-language packages and the raw-HTTP contract. This
skill uses the server side only.

## The lifecycle

```
1. Agent: POST /api/agent/orders            (body includes request_id, no auth)
   Server: 402 Payment Required
           WWW-Authenticate: Payment <challenge for stripe network/profile>
           { "order_id": "order_…", "status": "unpaid" }

2. Agent: decodes challenge, mints a Stripe SPT for the advertised profile/amount

3. Agent: POST /api/agent/orders            (IDENTICAL body, Authorization: Payment …)
   Server: 202 Accepted
           Payment-Receipt: <receipt>
           { order_id, status: "settled", payment_status: "paid", is_paid: true,
             current_step, order_complete_url, <fulfillment payload> }

4. Agent: GET /api/agent/orders/{order_id}  (poll status, no auth)
```

A preflight `POST /api/agent/orders/validate` returns the quote + accepted methods
without composing payment or fulfilling — agents can price before committing.

## Why request_id matters (idempotency)

`request_id` (a UUID the agent generates) is the idempotency key. The server
derives `order_id` deterministically from it (`order_<sha256(request_id)[:24]>`).
Consequences you must preserve:

- The 402 retry MUST carry the **identical body** (same request_id, same line items)
  so the amount and the order digest match.
- A replayed paid call (network retried, agent retried) resolves to the **already
  fulfilled** order instead of charging or fulfilling twice. `findOrder(order_id)`
  is checked first in the create handler.

## Replay binding (security)

The Stripe SPT is minted for a specific amount, but amount alone is not unique — an
SPT minted for one order could otherwise be replayed against a *different* order of
the same price. To close this, the create handler folds the canonical order fields
into the challenge `meta` as an `order_digest` (via `mppx`'s `BodyDigest`). `mppx`
HMAC-binds `meta` with `MPP_SECRET_KEY`, so a credential is bound to one exact order.
Keep `digestFields()` in the hooks returning the price-determining fields.

## "Rejected" vs "no credential" (the subtle 402)

A retry can come back 402 for two very different reasons. Distinguish them so agents
don't loop blindly:

- **No credential attached** — the `Authorization: Payment` header never reached the
  function. Body is just `{ order_id, status: "unpaid" }`.
- **Credential attached but rejected** — bad/expired SPT, challenge not issued by us,
  Stripe declined, OR a freshly approved SPT that is not chargeable for a few seconds.
  The handler captures this via `payment.onPaymentFailed(...)` and adds
  `credential_status: "rejected"` + a `reason`. Agents should back off briefly and
  retry the SAME request_id (idempotency guarantees at most one charge).

Detect credential presence with `/^payment\b/i.test(authorizationHeader)`.

## The `mppx/server` API used

```ts
import { BodyDigest, Errors } from "mppx";
import { Mppx, stripe as mppStripe } from "mppx/server";

const checkout = Mppx.create({
  methods: [
    mppStripe.charge({
      client: new Stripe(secretKey, { apiVersion: "2026-05-27.dahlia" }),
      networkId: stripeProfileId,          // profile_…  (the SPT network)
      currency: "usd",
      decimals: 2,
      paymentMethodTypes: ["card", "link"],
    }),
  ],
  secretKey: MPP_SECRET_KEY,               // HMAC secret that binds challenge meta
});

checkout.onPaymentFailed((ctx) => { /* ctx.error?.message → rejection reason */ });

const payment = await checkout.compose(
  ["stripe/charge", {
    amount: "3.99",                        // DECIMAL/major units string, NOT cents
    description: "…",
    expires: new Date(Date.now() + 10*60*1000),
    meta: { order_digest, ...lineItemMeta },
    scope: "checkout:create-order",
  }],
)(request);

if (payment.status === 402) return payment.challenge;      // has .headers (WWW-Authenticate)
if (payment.status !== 200) /* unverified → 402, do NOT fulfill */;
return payment.withReceipt(Response.json(orderBody, { status: 202 }));
```

Gotchas:
- `amount` is a **decimal string in major units** (`"3.99"` = $3.99), not cents. The
  `stripe/charge` request schema converts it to minor units once via
  `parseUnits(amount, decimals)` (`decimals` = the currency's exponent, 2 for USD).
  So passing cents like `"399"` is read as 399 *whole units* → `parseUnits("399", 2)`
  = 39900 minor = **$399.00**, a 100× overcharge. Pass `(amountCents / 100).toFixed(2)`.
- Only `payment.status === 200` means settled. Never fulfill on any other status.
- `Errors.PaymentError` from `mppx` → return `error.toProblemDetails()` with
  `error.status`, never a 500. No fulfillment on payment failure.

## curl test recipes (Step 5)

```bash
BASE=http://localhost:3000
RID=$(uuidgen | tr 'A-Z' 'a-z')

# Discovery
curl -s $BASE/llms.txt | head
curl -s $BASE/.well-known/agent-storefront.json | jq .
curl -s $BASE/openapi.json | jq .info

# Preflight quote (no payment)
curl -s $BASE/api/agent/orders/validate -H 'content-type: application/json' \
  -d "{\"request_id\":\"$RID\", … order fields … }" | jq .

# Create with NO credential -> expect 402 + WWW-Authenticate + status:unpaid
curl -i $BASE/api/agent/orders -H 'content-type: application/json' \
  -d "{\"request_id\":\"$RID\", … }"

# Replay identical body -> same order_id (idempotency)
curl -s $BASE/api/agent/orders -H 'content-type: application/json' \
  -d "{\"request_id\":\"$RID\", … }" | jq .order_id
```

## Paid leg with the Stripe Link CLI (operator-run)

The full charge needs a live SPT. Have the operator run:

```bash
npx @stripe/link-cli mpp decode --challenge '<WWW-Authenticate Payment challenge>'
npx @stripe/link-cli payment-methods list
npx @stripe/link-cli spend-request create \
  --payment-method-id <pm_id> --credential-type shared_payment_token \
  --network-id <network_id_from_challenge> --amount <minor_units> --currency usd \
  --context '<100+ char purchase rationale shown to the owner>' \
  --line-item 'name:<item>,unit_amount:<minor>,quantity:1' \
  --total 'type:total,display_text:Total,amount:<minor>' --request-approval
npx @stripe/link-cli mpp pay $BASE/api/agent/orders \
  --spend-request-id <approved_id> --method POST \
  --header 'Content-Type: application/json' \
  --data '{"request_id":"<uuid>", … identical body … }'
```

Any MPP client that can mint a Stripe SPT for the advertised challenge and retry
with `Authorization: Payment …` works. Virtual cards / manual card entry / crypto
are not part of this SPT-only setup.

[ "Payment" HTTP Authentication scheme ]: https://datatracker.ietf.org/doc/draft-ryan-httpauth-payment/

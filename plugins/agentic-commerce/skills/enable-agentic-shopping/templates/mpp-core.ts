// mpp-core.ts — framework-agnostic MPP checkout core (Stripe SPT).
//
// Copy into your store (e.g. lib/mpp/core.ts). Built on `mppx` + Stripe Shared
// Payment Tokens. You should not need to edit this file — wire your store logic in
// store-hooks.ts and pass it to createMppHandlers(). See references/mpp-payment-flow.md.

import { createHash } from "node:crypto";
import Stripe from "stripe";
import { BodyDigest, Errors } from "mppx";
import { Mppx, stripe as mppStripe } from "mppx/server";
import { loadMppConfig, MppConfigError } from "./config";

const CHALLENGE_TTL_MS = 10 * 60 * 1000;

export class ValidationError extends Error {}

/** The store-specific glue. Implement in store-hooks.ts.
 *  `Order` = your parsed order type; `Rec` = your persisted order record type. */
export interface StoreHooks<Order = any, Rec = any> {
  /** Validate raw JSON → a parsed order. Throw ValidationError on bad input.
   *  Must set `requestId` (a UUID) when opts.requireRequestId is true. */
  parse(payload: unknown, opts: { requireRequestId: boolean }): Order & { requestId?: string };
  /** Price the order. `amount` MUST be a decimal/major-units string, e.g. "3.99". */
  quote(order: Order): Quote;
  /** Idempotency: return the existing order if one was already created for orderId. */
  findOrder(orderId: string): Promise<Rec | null>;
  /** Fulfill a settled order. Persist it keyed by orderId. Return the order body. */
  createOrder(order: Order, orderId: string, quote: Quote): Promise<Rec>;
  /** Price/identity-determining fields, folded into the challenge digest (replay binding). */
  digestFields(order: Order): Record<string, unknown>;
  /** Optional: shape the JSON returned for a created/looked-up order. Defaults to identity. */
  serializeOrder?(record: Rec, ctx: { orderId: string; serviceUrl: string; includeReceipt: boolean }): unknown;
  /** Product type advertised by validate (e.g. "ticket", "license", "machine_lease"). */
  productType: string;
}

export type Quote = {
  amount: string;            // decimal major units, e.g. "3.99"
  currency?: string;         // defaults to config currency
  description: string;
  meta?: Record<string, string>;
};

export type MppHandlers = {
  validate: (request: Request) => Promise<Response>;
  create: (request: Request) => Promise<Response>;
  status: (request: Request, orderId: string) => Promise<Response>;
};

/** Deterministically derive order_id from the agent's request_id (idempotency key). */
export function deriveOrderId(requestId: string): string {
  return `order_${createHash("sha256").update(requestId).digest("hex").slice(0, 24)}`;
}

function serviceUrlFrom(request: Request): string {
  if (process.env.NEXT_PUBLIC_STORE_URL) return process.env.NEXT_PUBLIC_STORE_URL;
  if (process.env.STORE_URL) return process.env.STORE_URL;
  const host = request.headers.get("x-forwarded-host") ?? request.headers.get("host");
  if (host) return `${request.headers.get("x-forwarded-proto") ?? "https"}://${host}`;
  if (process.env.VERCEL_URL) return `https://${process.env.VERCEL_URL}`;
  return "http://localhost:3000";
}

function jsonError(message: string, status: number) {
  return new Response(JSON.stringify({ error: message }), {
    status,
    headers: { "content-type": "application/json" },
  });
}

export function createMppHandlers(hooks: StoreHooks): MppHandlers {
  const serialize = hooks.serializeOrder ?? ((r: any) => r);

  // ---- POST /validate : preflight quote, no payment, no fulfillment ----------
  async function validate(request: Request): Promise<Response> {
    try {
      const order = hooks.parse(await request.json(), { requireRequestId: true });
      const quote = hooks.quote(order);
      return Response.json({
        protocol: "mpp",
        methods: ["stripe_spt"],
        product_type: hooks.productType,
        quote,
        request_id: order.requestId,
      });
    } catch (error) {
      return mapError(error);
    }
  }

  // ---- POST /orders : create + pay (the 402/SPT flow) ------------------------
  async function create(request: Request): Promise<Response> {
    try {
      const order = hooks.parse(await request.clone().json(), { requireRequestId: true });
      const orderId = deriveOrderId(order.requestId!);
      const serviceUrl = serviceUrlFrom(request);

      // Idempotent replay: order already fulfilled → return it without charging again.
      const existing = await hooks.findOrder(orderId);
      if (existing) {
        return Response.json(serialize(existing, { orderId, serviceUrl, includeReceipt: false }), { status: 202 });
      }

      const quote = hooks.quote(order);
      const config = loadMppConfig();

      const checkout = Mppx.create({
        methods: [
          mppStripe.charge({
            client: new Stripe(config.stripeSecretKey, { apiVersion: "2026-05-27.dahlia" }),
            networkId: config.stripeProfileId,
            currency: (quote.currency ?? config.currency) as string,
            decimals: config.decimals,
            paymentMethodTypes: config.paymentMethodTypes,
          }),
        ],
        secretKey: config.mppSecretKey,
      });

      // Distinguishes "credential attached but rejected" from "no credential".
      let rejection: string | undefined;
      checkout.onPaymentFailed((ctx: any) => {
        rejection = ctx.error?.message ?? "Payment credential was rejected.";
      });
      const credentialPresent = /^payment\b/i.test(request.headers.get("authorization") ?? "");

      // Replay binding: bind the credential to THIS exact order via the digest.
      const orderDigest = BodyDigest.compute(hooks.digestFields(order));
      const payment = await checkout.compose([
        "stripe/charge",
        {
          amount: quote.amount,                       // decimal major units
          description: quote.description,
          expires: new Date(Date.now() + CHALLENGE_TTL_MS),
          meta: { order_digest: orderDigest, ...(quote.meta ?? {}) },
          scope: "checkout:create-order",
        },
      ])(request);

      if (payment.status === 402) {
        const headers = new Headers(payment.challenge.headers);
        headers.set("content-type", "application/json");
        headers.delete("content-length");
        const body: Record<string, unknown> = { order_id: orderId, status: "unpaid" };
        if (credentialPresent) {
          body.credential_status = "rejected";
          body.reason = rejection ?? "Payment credential was not accepted.";
        }
        return new Response(JSON.stringify(body), { status: 402, headers });
      }
      if (payment.status !== 200) {
        return jsonError("Payment could not be verified.", 402);
      }

      const record = await hooks.createOrder(order, orderId, quote);
      return payment.withReceipt(
        Response.json(serialize(record, { orderId, serviceUrl, includeReceipt: true }), { status: 202 }),
      );
    } catch (error) {
      return mapError(error);
    }
  }

  // ---- GET /orders/{id} : poll status (no auth) -----------------------------
  async function status(request: Request, orderId: string): Promise<Response> {
    try {
      const record = await hooks.findOrder(orderId);
      if (!record) return jsonError("Order not found.", 404);
      return Response.json(serialize(record, { orderId, serviceUrl: serviceUrlFrom(request), includeReceipt: false }));
    } catch (error) {
      return mapError(error);
    }
  }

  return { validate, create, status };
}

function mapError(error: unknown): Response {
  if (error instanceof SyntaxError) return jsonError("Request body must be valid JSON.", 400);
  if (error instanceof ValidationError) return jsonError(error.message, 400);
  if (error instanceof MppConfigError) return jsonError(error.message, 503);
  if (error instanceof Errors.PaymentError) {
    // A payment that fails verification must surface as a payment error, never a 500.
    return Response.json(error.toProblemDetails(), { status: error.status });
  }
  throw error;
}

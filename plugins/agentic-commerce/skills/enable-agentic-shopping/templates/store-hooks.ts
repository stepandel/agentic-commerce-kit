// store-hooks.ts — THE STORE-SPECIFIC GLUE. This is where you (the operator) wire
// the skill's forks: catalog, pricing, fulfillment, and order persistence.
//
// Copy into your store (e.g. lib/mpp/hooks.ts), then replace each TODO with your
// real logic. The example below sells ONE product with a fixed price and an
// in-memory order store — swap both for your catalog/DB before production.

import { randomUUID } from "node:crypto";
import { ValidationError, type StoreHooks, type Quote } from "./core";

// ---------------------------------------------------------------------------
// Types — adapt to your domain.
// ---------------------------------------------------------------------------
type Order = {
  requestId: string;
  sku: string;
  quantity: number;
  // …add the fields your product needs (shipping address, seat, duration, etc.)
};

type OrderRecord = {
  order_id: string;
  status: "settled";
  payment_status: "paid";
  is_paid: true;
  current_step: string;
  order_complete_url?: string;
  // …add fulfillment results: access token, license key, tracking number, etc.
  fulfillment: unknown;
};

// ---------------------------------------------------------------------------
// FORK 1 — catalog. Replace with your real catalog lookup (DB, CMS, config).
// ---------------------------------------------------------------------------
const CATALOG: Record<string, { name: string; unitAmountMinor: number }> = {
  "example-sku": { name: "Example product", unitAmountMinor: 399 }, // $3.99
};

// ---------------------------------------------------------------------------
// FORK 2 — order store (idempotency). Replace the Map with your DB / Redis / KV.
// Production MUST be durable: a `request_id` replay has to resolve to the same order.
// ---------------------------------------------------------------------------
const orders = new Map<string, OrderRecord>();

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export const hooks: StoreHooks<Order, OrderRecord> = {
  productType: "example_product",

  // -------------------------------------------------------------------------
  // Validate the inbound JSON. Keep it strict — reject unknown shapes early.
  // -------------------------------------------------------------------------
  parse(payload, { requireRequestId }) {
    if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
      throw new ValidationError("Request body must be a JSON object.");
    }
    const b = payload as Record<string, unknown>;

    const requestId = typeof b.request_id === "string" ? b.request_id.trim() : "";
    if (requireRequestId && !UUID_RE.test(requestId)) {
      throw new ValidationError("request_id is required and must be a UUID.");
    }

    const sku = typeof b.sku === "string" ? b.sku : "";
    if (!CATALOG[sku]) throw new ValidationError("Unknown sku.");

    const quantity = b.quantity;
    if (typeof quantity !== "number" || !Number.isInteger(quantity) || quantity < 1) {
      throw new ValidationError("quantity must be a positive integer.");
    }

    return { requestId, sku, quantity };
  },

  // -------------------------------------------------------------------------
  // FORK 3 — pricing. `amount` is a DECIMAL/major-units string ("3.99").
  // Reuse your store's existing pricing function if you have one.
  // -------------------------------------------------------------------------
  quote(order) {
    const item = CATALOG[order.sku];
    const totalMinor = item.unitAmountMinor * order.quantity;
    return {
      amount: (totalMinor / 100).toFixed(2),
      currency: "usd",
      description: `${order.quantity} × ${item.name}`,
      meta: { sku: order.sku, quantity: String(order.quantity), amount_minor: String(totalMinor) },
    } satisfies Quote;
  },

  // -------------------------------------------------------------------------
  // Replay binding — fields that determine price/identity. Include request_id so
  // a credential minted for one order can't be replayed against another.
  // -------------------------------------------------------------------------
  digestFields(order) {
    return { request_id: order.requestId, sku: order.sku, quantity: order.quantity };
  },

  async findOrder(orderId) {
    return orders.get(orderId) ?? null;
  },

  // -------------------------------------------------------------------------
  // FORK 4 — fulfillment. Runs ONLY after payment settled (status 200). Persist
  // keyed by orderId and perform delivery: grant access, issue a license, create
  // a DB order, call your fulfillment service, provision a resource, etc.
  // -------------------------------------------------------------------------
  async createOrder(order, orderId, _quote) {
    // TODO: real fulfillment. Example issues an opaque access token.
    const accessToken = `acc_${randomUUID().replace(/-/g, "")}`;

    const record: OrderRecord = {
      order_id: orderId,
      status: "settled",
      payment_status: "paid",
      is_paid: true,
      current_step: "fulfilled",
      fulfillment: { access_token: accessToken },
    };
    orders.set(orderId, record); // TODO: persist durably
    return record;
  },

  // Optional: add order_complete_url, strip secrets from poll responses, etc.
  serializeOrder(record, { serviceUrl, includeReceipt }) {
    const complete_url = `${serviceUrl}/api/agent/orders/${record.order_id}`;
    if (includeReceipt) return { ...record, order_complete_url: complete_url };
    // On status polls, omit one-time secrets that were delivered on the 202.
    const { fulfillment, ...rest } = record;
    return { ...rest, order_complete_url: complete_url };
  },
};

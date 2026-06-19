// discovery.ts — the agent discovery layer: llms.txt, agent-storefront manifest,
// and OpenAPI. Copy into your store (e.g. lib/mpp/discovery.ts) and fill the
// `storefront` descriptor below. These are READ-ONLY and require no secrets, so
// they work before payment is configured.

// ---------------------------------------------------------------------------
// FILL THIS IN — describes your store to agents.
// ---------------------------------------------------------------------------
const storefront = {
  name: "Your Store",
  description: "What an agent can buy here, in one sentence.",
  version: "0.1.0",
  productType: "example_product", // must match hooks.productType
  basePath: "/api/agent/orders",
  // Advertise your products. Keep request_schema in sync with hooks.parse().
  products: [
    {
      sku: "example-sku",
      name: "Example product",
      description: "A thing an agent can buy.",
      price: { currency: "usd", unit_amount_cents: 399 },
    },
  ],
  // Plain-language rules. Agents read these.
  usagePolicy: {
    summary: "Use this store only for lawful, authorized purchases.",
    prohibited: ["fraud", "resale where prohibited", "abuse or platform-safety bypasses"],
  },
};

function serviceUrl(request?: Request): string {
  if (process.env.NEXT_PUBLIC_STORE_URL) return process.env.NEXT_PUBLIC_STORE_URL;
  if (process.env.STORE_URL) return process.env.STORE_URL;
  const host = request?.headers.get("x-forwarded-host") ?? request?.headers.get("host");
  if (host) return `${request?.headers.get("x-forwarded-proto") ?? "https"}://${host}`;
  if (process.env.VERCEL_URL) return `https://${process.env.VERCEL_URL}`;
  return "http://localhost:3000";
}

const checkoutGuidance = (base: string) => [
  "Generate a UUID request_id and include it in every body. It is the idempotency key: reuse it (with an identical body) across validate, create, and the paid retry so the same order resolves to the same challenge and order_id.",
  `Optional preflight: POST ${base}/validate to read the quote and accepted methods. No payment, no fulfillment.`,
  `POST ${base} without a credential returns HTTP 402 with MPP payment challenges (WWW-Authenticate) and { order_id, status: "unpaid" }. Inspect the challenge and retry the identical body with a Stripe Shared Payment Token (Authorization: Payment ...).`,
  'If the paid retry returns 402 with credential_status: "rejected", the credential reached the server but was not accepted (often a freshly approved SPT not yet chargeable). Read "reason", wait a few seconds, retry the same request_id; idempotency guarantees at most one charge. A 402 WITHOUT credential_status means no credential was attached.',
  `On success you receive HTTP 202 with the settled order and any fulfillment payload. Poll GET ${base}/{order_id} for status.`,
];

export function agentStorefrontManifest(request?: Request) {
  const url = serviceUrl(request);
  const base = storefront.basePath;
  return {
    name: storefront.name,
    description: storefront.description,
    version: storefront.version,
    service_url: url,
    llms_txt_url: "/llms.txt",
    openapi_url: "/openapi.json",
    products: storefront.products,
    payments: {
      protocol: "mpp",
      processor: "stripe",
      product_type: storefront.productType,
      validate_path: `${base}/validate`,
      checkout_path: base,
      order_status_path: `${base}/{order_id}`,
      challenge_status: 402,
      idempotency_key: "request_id",
      methods: ["stripe_spt"],
      environment: process.env.NODE_ENV === "production" ? "production" : "development",
    },
    checkout_guidance: checkoutGuidance(base),
    usage_policy: storefront.usagePolicy,
    endpoints: {
      validate: { method: "POST", path: `${base}/validate`, auth: "none" },
      checkout: { method: "POST", path: base, auth: "MPP payment" },
      order_status: { method: "GET", path: `${base}/{order_id}`, auth: "none" },
    },
  };
}

export function llmsText(request?: Request): string {
  const url = serviceUrl(request);
  const base = storefront.basePath;
  const products = storefront.products
    .map((p) => `- ${p.sku}: ${p.name} — ${p.description} (${p.price.currency} ${(p.price.unit_amount_cents / 100).toFixed(2)})`)
    .join("\n");
  return `# ${storefront.name}

${storefront.description}

Products:
${products}

Generate a UUID request_id and send it in every body. It is the idempotency key:
reuse it (with an identical body) across validate, create, and the paid retry.

Preflight (optional): POST ${base}/validate
Create + pay:        POST ${base}
Poll status:         GET  ${base}/{order_id}

${checkoutGuidance(base).map((g) => `- ${g}`).join("\n")}

Acceptable use:
- ${storefront.usagePolicy.summary}
${storefront.usagePolicy.prohibited.map((p) => `- Do not use this store for: ${p}`).join("\n")}

Machine-readable manifest: /.well-known/agent-storefront.json
OpenAPI spec: /openapi.json
Service URL: ${url}
`;
}

export function openApiDocument(request?: Request) {
  const base = storefront.basePath;
  return {
    openapi: "3.1.0",
    info: { title: `${storefront.name} Agent API`, version: storefront.version, description: storefront.description },
    servers: [{ url: serviceUrl(request) }],
    paths: {
      [`${base}/validate`]: {
        post: {
          operationId: "validateOrder",
          summary: "Preflight: validate an order and return its quote. No payment, no fulfillment.",
          requestBody: { required: true, content: { "application/json": { schema: { $ref: "#/components/schemas/OrderRequest" } } } },
          responses: {
            "200": { description: "Quote.", content: { "application/json": { schema: { $ref: "#/components/schemas/ValidateResponse" } } } },
            "400": { $ref: "#/components/responses/Error" },
          },
        },
      },
      [base]: {
        post: {
          operationId: "createOrder",
          summary: "Create an MPP order. Without a credential returns 402 with payment challenges; with Authorization: Payment returns 202 settled.",
          requestBody: { required: true, content: { "application/json": { schema: { $ref: "#/components/schemas/OrderRequest" } } } },
          responses: {
            "202": { description: "Order settled.", content: { "application/json": { schema: { $ref: "#/components/schemas/Order" } } } },
            "400": { $ref: "#/components/responses/Error" },
            "402": { description: "MPP payment required. Inspect WWW-Authenticate; body is { order_id, status: 'unpaid' }." },
          },
        },
      },
      [`${base}/{order_id}`]: {
        get: {
          operationId: "getOrder",
          summary: "Poll order status by order_id.",
          parameters: [{ name: "order_id", in: "path", required: true, schema: { type: "string" } }],
          responses: {
            "200": { description: "Order status.", content: { "application/json": { schema: { $ref: "#/components/schemas/Order" } } } },
            "404": { $ref: "#/components/responses/Error" },
          },
        },
      },
    },
    components: {
      responses: { Error: { description: "Error.", content: { "application/json": { schema: { $ref: "#/components/schemas/Error" } } } } },
      schemas: {
        // Keep OrderRequest in sync with hooks.parse().
        OrderRequest: {
          type: "object",
          required: ["request_id", "sku", "quantity"],
          additionalProperties: false,
          properties: {
            request_id: { type: "string", format: "uuid", description: "Idempotency key. Reuse across validate/create/retry." },
            sku: { type: "string" },
            quantity: { type: "integer", minimum: 1 },
          },
        },
        ValidateResponse: {
          type: "object",
          required: ["protocol", "methods", "product_type", "quote", "request_id"],
          properties: {
            protocol: { type: "string", const: "mpp" },
            methods: { type: "array", items: { type: "string" } },
            product_type: { type: "string" },
            quote: { type: "object" },
            request_id: { type: "string", format: "uuid" },
          },
        },
        Order: {
          type: "object",
          required: ["order_id", "status", "payment_status", "is_paid", "current_step"],
          properties: {
            order_id: { type: "string" },
            status: { type: "string", enum: ["unpaid", "settled"] },
            payment_status: { type: "string", enum: ["unpaid", "paid"] },
            is_paid: { type: "boolean" },
            current_step: { type: "string" },
            order_complete_url: { type: "string", format: "uri" },
          },
        },
        Error: { type: "object", required: ["error"], properties: { error: { type: "string" } } },
      },
    },
  };
}

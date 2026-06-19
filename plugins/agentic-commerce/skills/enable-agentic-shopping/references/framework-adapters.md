# Framework adapters

The MPP core (`templates/mpp-core.ts`) and discovery (`templates/discovery.ts`)
speak the web-standard `Request → Response` API. `createMppHandlers(hooks)` returns
three handlers — `validate`, `create`, `status` — each `(request: Request) =>
Promise<Response>`. Mount them with one of the snippets below. Discovery returns
plain values you wrap in a `Response`.

Recommended route base path: `/api/agent/orders`. Discovery paths are fixed by
convention: `/llms.txt`, `/.well-known/agent-storefront.json`, `/openapi.json`.

## Next.js (App Router)

Native — handlers ARE the route exports. `params` is async in Next 15+.

```ts
// app/api/agent/orders/route.ts
import { handlers } from "@/lib/mpp";          // = createMppHandlers(hooks)
export const runtime = "nodejs";
export const maxDuration = 180;                // allow time for fulfillment
export const POST = handlers.create;

// app/api/agent/orders/validate/route.ts
export const POST = handlers.validate;

// app/api/agent/orders/[id]/route.ts
export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  return handlers.status(req, (await params).id);
}

// app/llms.txt/route.ts
import { llmsText } from "@/lib/discovery";
export function GET(req: Request) {
  return new Response(llmsText(req), { headers: { "content-type": "text/plain; charset=utf-8" } });
}
// app/.well-known/agent-storefront.json/route.ts
import { agentStorefrontManifest } from "@/lib/discovery";
export function GET(req: Request) { return Response.json(agentStorefrontManifest(req)); }
// app/openapi.json/route.ts
import { openApiDocument } from "@/lib/discovery";
export function GET(req: Request) { return Response.json(openApiDocument(req)); }
```

## Hono (Bun / Deno / Node / edge)

```ts
import { Hono } from "hono";
import { handlers } from "./mpp";
import { llmsText, agentStorefrontManifest, openApiDocument } from "./discovery";

const app = new Hono();
app.post("/api/agent/orders/validate", (c) => handlers.validate(c.req.raw));
app.post("/api/agent/orders", (c) => handlers.create(c.req.raw));
app.get("/api/agent/orders/:id", (c) => handlers.status(c.req.raw, c.req.param("id")));
app.get("/llms.txt", (c) => c.text(llmsText(c.req.raw)));
app.get("/.well-known/agent-storefront.json", (c) => c.json(agentStorefrontManifest(c.req.raw)));
app.get("/openapi.json", (c) => c.json(openApiDocument(c.req.raw)));
export default app;
```

## Bun.serve / Deno.serve

```ts
const ROUTES = [
  ["POST", /^\/api\/agent\/orders\/validate$/, (r) => handlers.validate(r)],
  ["POST", /^\/api\/agent\/orders$/,           (r) => handlers.create(r)],
  ["GET",  /^\/api\/agent\/orders\/(.+)$/,      (r, m) => handlers.status(r, m[1])],
];
Bun.serve({ port: 3000, async fetch(req) {
  const url = new URL(req.url);
  for (const [method, re, fn] of ROUTES) {
    const m = url.pathname.match(re);
    if (req.method === method && m) return fn(req, m);
  }
  // …discovery routes…
  return new Response("Not found", { status: 404 });
}});
```

## Express / Fastify (Node `IncomingMessage`, not web `Request`)

Express/Fastify do not give you a web `Request`. Bridge with a small shim that
rebuilds a `Request` from the Node request, then write the web `Response` back.

```ts
import express from "express";
import { handlers } from "./mpp";

function toWebRequest(req: express.Request): Request {
  const url = `${req.protocol}://${req.get("host")}${req.originalUrl}`;
  const headers = new Headers();
  for (const [k, v] of Object.entries(req.headers)) if (v) headers.set(k, String(v));
  const hasBody = !["GET", "HEAD"].includes(req.method);
  return new Request(url, {
    method: req.method,
    headers,
    body: hasBody ? JSON.stringify(req.body) : undefined,   // requires express.json()
  });
}
async function send(res: express.Response, web: Response) {
  res.status(web.status);
  web.headers.forEach((v, k) => res.setHeader(k, v));        // preserves WWW-Authenticate
  res.send(await web.text());
}

const app = express();
app.use(express.json());
app.post("/api/agent/orders/validate", async (req, res) => send(res, await handlers.validate(toWebRequest(req))));
app.post("/api/agent/orders",          async (req, res) => send(res, await handlers.create(toWebRequest(req))));
app.get("/api/agent/orders/:id",       async (req, res) => send(res, await handlers.status(toWebRequest(req), req.params.id)));
```

Note: re-serializing the body changes raw bytes. The order digest in this skill is
computed from parsed canonical fields (not raw bytes), so JSON re-encoding is safe.
If you ever switch to raw-body binding, use a raw-body parser for these routes.

## After mounting

Whichever adapter you use, the discovery functions must advertise the **public**
URL. They resolve it from `NEXT_PUBLIC_STORE_URL` / `STORE_URL`, then forwarded
host headers, then platform vars, falling back to `http://localhost:3000`. Set the
explicit URL env in production so manifests never advertise localhost.

// config.ts — loads and GUARDS the agentic-checkout prerequisites.
//
// Copy into your store (e.g. lib/mpp/config.ts). This is the prerequisites-as-code
// layer: it fails fast with MppConfigError (surface as HTTP 503) when the Stripe /
// MPP secrets are missing or wrong-shaped, so a misconfigured deploy refuses payment
// cleanly instead of charging the wrong account.

export class MppConfigError extends Error {}

export type MppConfig = {
  stripeSecretKey: string;
  stripeProfileId: string;
  mppSecretKey: string;
  currency: string;
  paymentMethodTypes: string[];
  /** Decimal places for the currency (usd → 2). */
  decimals: number;
};

const isProd = process.env.NODE_ENV === "production";

/**
 * Load config for composing a payment. Throws MppConfigError if a prerequisite is
 * missing or, in production, not a live credential. Call this inside the create
 * handler (NOT at module load) so discovery/validate keep working before secrets
 * are set, and so a config error becomes a clean 503.
 */
export function loadMppConfig(): MppConfig {
  const stripeSecretKey = process.env.STRIPE_SECRET_KEY ?? "";
  const stripeProfileId = process.env.STRIPE_PROFILE_ID ?? "";
  const mppSecretKey = process.env.MPP_SECRET_KEY ?? "";

  if (!stripeSecretKey || !stripeProfileId) {
    throw new MppConfigError(
      "Configure STRIPE_SECRET_KEY=sk_live_... and STRIPE_PROFILE_ID=profile_... before agentic checkout can accept payments.",
    );
  }
  if (!mppSecretKey) {
    throw new MppConfigError(
      "MPP_SECRET_KEY is required before agentic checkout can sign payment challenges. Generate one with: openssl rand -base64 32",
    );
  }
  if (isProd) {
    if (!stripeSecretKey.startsWith("sk_live_")) {
      throw new MppConfigError("Production agentic checkout requires a live Stripe key: STRIPE_SECRET_KEY=sk_live_...");
    }
    if (stripeProfileId.startsWith("profile_test_") || !stripeProfileId.startsWith("profile_")) {
      throw new MppConfigError("Production agentic checkout requires a live Stripe profile: STRIPE_PROFILE_ID=profile_...");
    }
  }

  return {
    stripeSecretKey,
    stripeProfileId,
    mppSecretKey,
    currency: (process.env.CURRENCY ?? "usd").toLowerCase(),
    paymentMethodTypes: parseCsv(process.env.STRIPE_PAYMENT_METHOD_TYPES, ["card", "link"]),
    decimals: 2,
  };
}

function parseCsv(value: string | undefined, fallback: string[]): string[] {
  if (!value) return fallback;
  const parsed = value.split(",").map((s) => s.trim()).filter(Boolean);
  return parsed.length ? parsed : fallback;
}

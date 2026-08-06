// STEP 12 · Billing — payment provider seam (node runtime).
//
// `createCheckout` drives the full checkout lifecycle:
//   1. prepareCheckout   (mutation) — creates the pending top-up invoice
//   2. provider session  — Stripe Checkout, Midtrans Snap, or Xendit invoice
//   3. recordCheckout    (mutation) — persists the hosted pay URL + external id
//
// The provider is selected by env presence. Without keys the action falls back
// to a deterministic *simulated* session so the whole flow stays testable in
// development; the console's "Mark as paid" settles it like a webhook would.
//
//   STRIPE_SECRET_KEY          → Stripe Checkout Sessions (USD)
//   MIDTRANS_SERVER_KEY        → Midtrans Snap (IDR, QRIS / e-wallet / VA)
//   XENDIT_API_KEY             → Xendit Invoices (IDR)
//   VLY_INTEGRATION_KEY        → Freebuff payments gateway (any provider)
"use node";

import { FunctionReturnType } from "convex/server";
import { action } from "../_generated/server";
import { v } from "convex/values";
import { api } from "../_generated/api";
import {
  defaultMethod,
  isValidMethod,
  newCheckoutSession,
  providerById,
} from "./core";
import type { CheckoutMode } from "./core";

type PreparedCheckout = FunctionReturnType<typeof api.billing.prepareCheckout>;

interface CheckoutResult {
  sessionId: string;
  payUrl: string;
  mode: CheckoutMode;
  invoiceNumber: string;
  provider: string;
  method: string;
  amount: number;
  credits: number;
  currency: string;
  displayAmount: number;
  expiresAt: number;
}

interface ProviderSession {
  id: string;
  url: string;
}

function detectMode(provider: string): CheckoutMode {
  if (process.env.VLY_INTEGRATION_KEY) return "live";
  if (provider === "stripe" && process.env.STRIPE_SECRET_KEY) return "live";
  if (provider === "midtrans" && process.env.MIDTRANS_SERVER_KEY) {
    return process.env.MIDTRANS_IS_PRODUCTION === "true" ? "live" : "sandbox";
  }
  if (provider === "xendit" && process.env.XENDIT_API_KEY) return "live";
  return "simulated";
}

/** Simulated session — deterministic id + hosted pay URL. */
function simulatedSession(input: {
  invoiceNumber: string;
  provider: "stripe" | "midtrans" | "xendit";
  method: string;
  amountUsd: number;
  at: number;
}) {
  return newCheckoutSession({ ...input, mode: "simulated" });
}

async function stripeSession(args: {
  invoiceNumber: string;
  amountCents: number;
  email?: string;
}): Promise<{ id: string; url: string }> {
  const key = process.env.STRIPE_SECRET_KEY;
  if (!key) throw new Error("STRIPE_SECRET_KEY not configured");
  const body = new URLSearchParams({
    mode: "payment",
    success_url: "https://console.atelier.dev/billing?checkout=success",
    cancel_url: "https://console.atelier.dev/billing?checkout=cancelled",
    client_reference_id: args.invoiceNumber,
    "line_items[0][price_data][currency]": "usd",
    "line_items[0][price_data][unit_amount]": String(args.amountCents),
    "line_items[0][price_data][product_data][name]": `Atelier credits · ${args.invoiceNumber}`,
    "line_items[0][quantity]": "1",
  });
  const res = await fetch("https://api.stripe.com/v1/checkout/sessions", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${key}`,
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body,
  });
  if (!res.ok) throw new Error(`Stripe ${res.status}: ${await res.text()}`);
  const data = (await res.json()) as { id: string; url: string };
  return { id: data.id, url: data.url };
}

async function midtransSession(args: {
  invoiceNumber: string;
  amountIdr: number;
  method: string;
  customerName?: string;
}): Promise<{ id: string; url: string }> {
  const key = process.env.MIDTRANS_SERVER_KEY;
  if (!key) throw new Error("MIDTRANS_SERVER_KEY not configured");
  const prod = process.env.MIDTRANS_IS_PRODUCTION === "true";
  const base = prod ? "https://app.midtrans.com" : "https://app.sandbox.midtrans.com";
  const auth = `Basic ${Buffer.from(`${key}:`).toString("base64")}`;
  const body: Record<string, unknown> = {
    transaction_details: {
      order_id: args.invoiceNumber,
      gross_amount: args.amountIdr,
    },
    customer_details: { first_name: args.customerName ?? "Atelier" },
    enabled_payments: [args.method],
  };
  const res = await fetch(`${base}/snap/v1/transactions`, {
    method: "POST",
    headers: { Authorization: auth, "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`Midtrans ${res.status}: ${await res.text()}`);
  const data = (await res.json()) as { token: string; redirect_url?: string };
  return {
    id: data.token,
    url:
      data.redirect_url ??
      `${base}/snap/v2/vtweb/${data.token}?payment_type=${args.method}`,
  };
}

async function xenditSession(args: {
  invoiceNumber: string;
  amountIdr: number;
  method: string;
}): Promise<{ id: string; url: string }> {
  const key = process.env.XENDIT_API_KEY;
  if (!key) throw new Error("XENDIT_API_KEY not configured");
  const auth = `Basic ${Buffer.from(`${key}:`).toString("base64")}`;
  const body = {
    external_id: args.invoiceNumber,
    amount: args.amountIdr,
    description: `Atelier credits · ${args.invoiceNumber}`,
    payment_methods: [args.method.toUpperCase()],
    success_redirect_url: "https://console.atelier.dev/billing?checkout=success",
    failure_redirect_url: "https://console.atelier.dev/billing?checkout=cancelled",
  };
  const res = await fetch("https://api.xendit.co/v2/invoices", {
    method: "POST",
    headers: { Authorization: auth, "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`Xendit ${res.status}: ${await res.text()}`);
  const data = (await res.json()) as { id: string; invoice_url: string };
  return { id: data.id, url: data.invoice_url };
}

export const createCheckout = action({
  args: {
    packageId: v.string(),
    provider: v.string(),
    method: v.optional(v.string()),
  },
  handler: async (ctx, { packageId, provider, method }): Promise<CheckoutResult> => {
    const prov = providerById(provider);
    if (!prov) throw new Error("Unknown payment provider");
    const chosen = method && isValidMethod(prov, method) ? method : defaultMethod(prov);

    // 1. Pending top-up invoice on the ledger.
    const prepared: PreparedCheckout = await ctx.runMutation(api.billing.prepareCheckout, {
      packageId,
      provider,
      method: chosen,
    });

    // 2. Hosted session from the provider (or a simulated fallback).
    const mode = detectMode(provider);
    const at = Date.now();
    let external: ProviderSession;
    let finalMode = mode;

    if (mode !== "simulated") {
      try {
        if (provider === "stripe") {
          external = await stripeSession({
            invoiceNumber: prepared.invoiceNumber,
            amountCents: Math.round(prepared.amount * 100),
          });
        } else if (provider === "midtrans") {
          external = await midtransSession({
            invoiceNumber: prepared.invoiceNumber,
            amountIdr: prepared.displayAmount,
            method: chosen,
          });
        } else {
          external = await xenditSession({
            invoiceNumber: prepared.invoiceNumber,
            amountIdr: prepared.displayAmount,
            method: chosen,
          });
        }
      } catch {
        // Provider call failed (bad keys, sandbox offline) — degrade gracefully.
        finalMode = "simulated";
        const s = simulatedSession({
          invoiceNumber: prepared.invoiceNumber,
          provider: prov.id,
          method: chosen,
          amountUsd: prepared.amount,
          at,
        });
        external = { id: s.sessionId, url: s.payUrl };
      }
    } else {
      const s = simulatedSession({
        invoiceNumber: prepared.invoiceNumber,
        provider: prov.id,
        method: chosen,
        amountUsd: prepared.amount,
        at,
      });
      external = { id: s.sessionId, url: s.payUrl };
    }

    // 3. Persist the hosted session on the invoice.
    await ctx.runMutation(api.billing.recordCheckout, {
      invoiceNumber: prepared.invoiceNumber,
      provider,
      method: chosen,
      externalId: external.id,
      payUrl: external.url,
      mode: finalMode,
    });

    return {
      sessionId: external.id,
      payUrl: external.url,
      mode: finalMode,
      invoiceNumber: prepared.invoiceNumber,
      provider,
      method: chosen,
      amount: prepared.amount,
      credits: prepared.credits,
      currency: prepared.currency,
      displayAmount: prepared.displayAmount,
      expiresAt: at + 2 * 60 * 60 * 1000,
    };
  },
});

// STEP 12 · Billing — pure core.
//
// Credit accounting for the Atelier platform, kept free of server imports
// so it runs in the backend, in the browser (the Billing tab), and in unit
// tests. Real money flows through a payment provider (Stripe/Autumn) in
// Deployment; here every transaction is captured as a deterministic,
// inspectable ledger entry:
//
//   credit packages → top-up invoices · plan switches (prorated) →
//   plan invoices · completed gateway calls → usage invoices
//
// The Convex surface (./billing.ts) persists these invoices and adjusts
// balances; this module decides the numbers.
import { formatDollars, parsePriceDollars, round2 } from "../dashboard/core";

/* ------------------------------------------------------------------ */
/* Credit packages                                                     */
/* ------------------------------------------------------------------ */

export interface CreditPackage {
  id: string;
  credits: number;
  price: string; // "$5"
  note: string;
}

export const CREDIT_PACKAGES: CreditPackage[] = [
  { id: "pack_500", credits: 500, price: "$5", note: "For exploring" },
  { id: "pack_2000", credits: 2000, price: "$19", note: "Most popular" },
  { id: "pack_5000", credits: 5000, price: "$45", note: "For shipping" },
  { id: "pack_12000", credits: 12000, price: "$99", note: "Heavy volume" },
];

export function packageById(id: string): CreditPackage | undefined {
  return CREDIT_PACKAGES.find((p) => p.id === id);
}

export function packagePriceDollars(pkg: CreditPackage): number {
  return parsePriceDollars(pkg.price);
}

/* ------------------------------------------------------------------ */
/* Invoices                                                            */
/* ------------------------------------------------------------------ */

export type InvoiceKind = "plan" | "topup" | "usage" | "adjustment";
export type InvoiceStatus = "paid" | "pending" | "failed";

export interface InvoiceItem {
  label: string;
  credits: number; // positive = credit, negative = charge
  dollars: number;
}

export interface Invoice {
  number: string;
  kind: InvoiceKind;
  status: InvoiceStatus;
  description: string;
  items: InvoiceItem[];
  creditsDelta: number; // net credit movement on the balance
  amount: number; // dollars charged
  periodStart?: number;
  periodEnd?: number;
  planId?: string;
  paymentMethod?: string;
  createdAt: number;
  paidAt?: number;
}

/** `INV-202608-0007` — month-scoped, zero-padded sequence. */
export function invoiceNumber(seq: number, at: number): string {
  const d = new Date(at);
  const yyyymm = `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, "0")}`;
  return `INV-${yyyymm}-${String(Math.max(1, seq)).padStart(4, "0")}`;
}

interface InvoiceSeed {
  seq: number;
  at: number;
  kind: InvoiceKind;
  description: string;
  items: InvoiceItem[];
  creditsDelta: number;
  amount: number;
  periodStart?: number;
  periodEnd?: number;
  planId?: string;
  paymentMethod?: string;
}

export function newInvoice(seed: InvoiceSeed): Invoice {
  return {
    number: invoiceNumber(seed.seq, seed.at),
    kind: seed.kind,
    status: "paid",
    description: seed.description,
    items: seed.items,
    creditsDelta: seed.creditsDelta,
    amount: round2(seed.amount),
    periodStart: seed.periodStart,
    periodEnd: seed.periodEnd,
    planId: seed.planId,
    paymentMethod: seed.paymentMethod ?? "card •••• 4242",
    createdAt: seed.at,
    paidAt: seed.at,
  };
}

/** Buying a credit pack → instant paid top-up invoice. */
export function topupInvoice(input: { pkg: CreditPackage; seq: number; at: number }): Invoice {
  const { pkg, seq, at } = input;
  return newInvoice({
    seq,
    at,
    kind: "topup",
    description: `${pkg.credits.toLocaleString()} credit pack`,
    items: [{ label: `${pkg.credits.toLocaleString()} credits · ${pkg.price}`, credits: pkg.credits, dollars: packagePriceDollars(pkg) }],
    creditsDelta: pkg.credits,
    amount: packagePriceDollars(pkg),
  });
}

/** Monthly plan charge (the allowance is prorated on switches). */
export function planInvoice(input: {
  planName: string;
  planId: string;
  price: string;
  credits: number;
  periodStart: number;
  periodEnd: number;
  seq: number;
  at: number;
}): Invoice {
  const { planName, planId, price, credits, periodStart, periodEnd, seq, at } = input;
  return newInvoice({
    seq,
    at,
    kind: "plan",
    description: `${planName} plan · monthly cycle`,
    items: [{ label: `${planName} plan · ${price}/mo`, credits, dollars: parsePriceDollars(price) }],
    creditsDelta: credits,
    amount: parsePriceDollars(price),
    periodStart,
    periodEnd,
    planId,
  });
}

/** End-of-cycle usage statement from completed calls. */
export function usageInvoice(input: {
  monthLabel: string;
  creditsUsed: number;
  perCredit: number;
  periodStart: number;
  periodEnd: number;
  seq: number;
  at: number;
}): Invoice {
  const { monthLabel, creditsUsed, perCredit, periodStart, periodEnd, seq, at } = input;
  const amount = usageCost(creditsUsed, perCredit);
  return newInvoice({
    seq,
    at,
    kind: "usage",
    description: `Usage · ${monthLabel}`,
    items: [{ label: `${creditsUsed.toLocaleString()} credits used`, credits: -creditsUsed, dollars: amount }],
    creditsDelta: -creditsUsed,
    amount,
    periodStart,
    periodEnd,
  });
}

/* ------------------------------------------------------------------ */
/* Billing cycle (calendar-month cycles)                               */
/* ------------------------------------------------------------------ */

export interface CycleWindow {
  start: number;
  end: number;
  days: number;
}

/** Calendar-month billing window containing `at`. */
export function cycleFor(at: number): CycleWindow {
  const d = new Date(at);
  const start = new Date(d.getFullYear(), d.getMonth(), 1).getTime();
  const end = new Date(d.getFullYear(), d.getMonth() + 1, 1).getTime();
  return { start, end, days: Math.round((end - start) / 86_400_000) };
}

/** 0..1 — how far through the current cycle we are. */
export function cycleProgress(start: number, now: number, end: number): number {
  const total = Math.max(1, end - start);
  return Math.min(1, Math.max(0, (now - start) / total));
}

/** Timestamp of the next cycle start (handles month / year rollover). */
export function nextBillingDate(at: number): number {
  const d = new Date(at);
  return new Date(d.getFullYear(), d.getMonth() + 1, 1).getTime();
}

export function daysBetween(a: number, b: number): number {
  return Math.round((b - a) / 86_400_000);
}

/* ------------------------------------------------------------------ */
/* Prorated plan switches                                              */
/* ------------------------------------------------------------------ */

/**
 * The share of a plan's monthly allowance that is still "owed" for the
 * remainder of the current cycle, rounded to whole credits.
 */
export function proratedAllowance(
  planCredits: number,
  start: number,
  now: number,
  end: number,
): number {
  const total = Math.max(1, end - start);
  const elapsed = Math.max(0, Math.min(total, now - start));
  const remaining = total - elapsed;
  return Math.round((planCredits * remaining) / total);
}

export interface SwitchPlanResult {
  fromCredits: number; // prorated allowance of the old plan
  toCredits: number; // prorated allowance of the new plan
  creditDelta: number; // difference applied to the balance
  note: string;
}

/** Prorate switching between two plans mid-cycle. */
export function prorateSwitch(
  fromPlan: { credits: number },
  toPlan: { credits: number },
  start: number,
  now: number,
  end: number,
): SwitchPlanResult {
  const fromCredits = proratedAllowance(fromPlan.credits, start, now, end);
  const toCredits = proratedAllowance(toPlan.credits, start, now, end);
  const creditDelta = toCredits - fromCredits;
  const note =
    creditDelta >= 0
      ? `+${creditDelta} credits for the rest of this cycle`
      : `${creditDelta} credits for the rest of this cycle`;
  return { fromCredits, toCredits, creditDelta, note };
}

/* ------------------------------------------------------------------ */
/* Usage & statements                                                  */
/* ------------------------------------------------------------------ */

export function usageCost(creditsUsed: number, perCredit: number): number {
  return round2(creditsUsed * perCredit);
}

export interface StatementSummary {
  boughtCredits: number;
  usedCredits: number;
  balance: number;
  planPriceDollars: number;
  perCredit: number;
  boughtDollars: number;
  usedDollars: number;
  estimateDollars: number;
}

export function statementSummary(input: {
  boughtCredits: number;
  usedCredits: number;
  balance: number;
  planPriceDollars: number;
  perCredit: number;
}): StatementSummary {
  const { boughtCredits, usedCredits, balance, planPriceDollars, perCredit } = input;
  return {
    boughtCredits,
    usedCredits,
    balance,
    planPriceDollars,
    perCredit,
    boughtDollars: round2(boughtCredits * perCredit),
    usedDollars: round2(usedCredits * perCredit),
    estimateDollars: round2(balance * perCredit + planPriceDollars),
  };
}

/* ------------------------------------------------------------------ */
/* Payment providers — Stripe (global) · Midtrans · Xendit (Indonesia) */
/* ------------------------------------------------------------------ */

export type PaymentProviderId = "stripe" | "midtrans" | "xendit";
export type CheckoutMode = "live" | "sandbox" | "simulated";
export type CheckoutStatus = "open" | "paid" | "failed" | "expired";

export interface PaymentMethod {
  id: string;
  label: string;
  kind: "card" | "ewallet" | "qris" | "va" | "bank";
}

export interface PaymentProvider {
  id: PaymentProviderId;
  name: string;
  region: string; // "Global" | "Indonesia"
  currency: "usd" | "idr";
  feePct: number; // provider fee on gross
  blurb: string;
  methods: PaymentMethod[];
}

export const PAYMENT_PROVIDERS: PaymentProvider[] = [
  {
    id: "stripe",
    name: "Stripe",
    region: "Global",
    currency: "usd",
    feePct: 2.9,
    blurb: "Cards & wallets worldwide",
    methods: [
      { id: "card", label: "Credit / debit card", kind: "card" },
      { id: "apple_pay", label: "Apple Pay", kind: "ewallet" },
    ],
  },
  {
    id: "midtrans",
    name: "Midtrans",
    region: "Indonesia",
    currency: "idr",
    feePct: 2.8,
    blurb: "QRIS · e-wallet · bank transfer",
    methods: [
      { id: "qris", label: "QRIS", kind: "qris" },
      { id: "gopay", label: "GoPay", kind: "ewallet" },
      { id: "ovo", label: "OVO", kind: "ewallet" },
      { id: "dana", label: "DANA", kind: "ewallet" },
      { id: "credit_card", label: "Credit card", kind: "card" },
      { id: "bca_va", label: "BCA Virtual Account", kind: "va" },
      { id: "bni_va", label: "BNI Virtual Account", kind: "va" },
      { id: "mandiri_va", label: "Mandiri Virtual Account", kind: "va" },
    ],
  },
  {
    id: "xendit",
    name: "Xendit",
    region: "Indonesia",
    currency: "idr",
    feePct: 2.9,
    blurb: "QRIS · e-wallet · retail outlets",
    methods: [
      { id: "qris", label: "QRIS", kind: "qris" },
      { id: "dana", label: "DANA", kind: "ewallet" },
      { id: "ovo", label: "OVO", kind: "ewallet" },
      { id: "shopeepay", label: "ShopeePay", kind: "ewallet" },
      { id: "credit_card", label: "Credit card", kind: "card" },
      { id: "bca", label: "BCA Virtual Account", kind: "va" },
      { id: "echannel", label: "Mandiri e-Channel", kind: "bank" },
      { id: "alfamart", label: "Alfamart", kind: "bank" },
    ],
  },
];

export function providerById(id: string): PaymentProvider | undefined {
  return PAYMENT_PROVIDERS.find((p) => p.id === id);
}

export function isValidMethod(provider: PaymentProvider | undefined, method: string): boolean {
  if (!provider) return false;
  return provider.methods.some((m) => m.id === method);
}

export function defaultMethod(provider: PaymentProvider | undefined): string {
  return provider?.methods[0]?.id ?? "card";
}

/** Fixed demo IDR rate so currency math stays deterministic. */
export const IDR_RATE = 16_000;
export function usdToIdr(usd: number): number {
  return Math.round(usd * IDR_RATE);
}
export function formatIdr(amount: number): string {
  return `Rp ${Math.round(amount).toLocaleString("id-ID")}`;
}

/* ------------------------------------------------------------------ */
/* Checkout sessions                                                   */
/* ------------------------------------------------------------------ */

export interface CheckoutSession {
  sessionId: string;
  invoiceNumber: string;
  provider: PaymentProviderId;
  method: string;
  amount: number; // dollars charged (ledger currency)
  currency: "usd" | "idr";
  displayAmount: number; // amount in the provider currency
  mode: CheckoutMode;
  payUrl: string;
  status: CheckoutStatus;
  createdAt: number;
  expiresAt: number;
}

export const CHECKOUT_TTL_MS = 2 * 60 * 60 * 1000; // 2 hours

/** Deterministic session id + pay URL (simulated mode). */
export function newCheckoutSession(input: {
  invoiceNumber: string;
  provider: PaymentProviderId;
  method: string;
  amountUsd: number;
  at: number;
  mode?: CheckoutMode;
}): CheckoutSession {
  const { invoiceNumber, provider, method, amountUsd, at } = input;
  const mode = input.mode ?? "simulated";
  const currency = providerById(provider)?.currency ?? "usd";
  const displayAmount = currency === "idr" ? usdToIdr(amountUsd) : round2(amountUsd);
  const raw = `${invoiceNumber}:${provider}:${Math.floor(at / 60_000)}`;
  let hash = 0;
  for (let i = 0; i < raw.length; i++) hash = (hash * 31 + raw.charCodeAt(i)) >>> 0;
  const sessionId = `cs_${provider}_${invoiceNumber.toLowerCase().replace(/-/g, "")}_${hash.toString(36)}`;
  return {
    sessionId,
    invoiceNumber,
    provider,
    method,
    amount: round2(amountUsd),
    currency,
    displayAmount,
    mode,
    payUrl: `https://pay.atelier.dev/${provider}/${sessionId}`,
    status: "open",
    createdAt: at,
    expiresAt: at + CHECKOUT_TTL_MS,
  };
}

export function checkoutExpired(session: Pick<CheckoutSession, "expiresAt">, now: number): boolean {
  return now > session.expiresAt;
}

/* ------------------------------------------------------------------ */
/* Payment webhook normalization (Stripe · Midtrans · Xendit)          */
/* ------------------------------------------------------------------ */

export type PaymentEventStatus = "paid" | "failed" | "ignored";

export interface NormalizedPaymentEvent {
  provider: PaymentProviderId;
  externalId: string; // provider's session / order id
  event: string; // raw provider event name
  status: PaymentEventStatus;
  invoiceRef?: string; // our invoice number when embedded in the payload
  amount?: number; // dollars (converted for idr providers)
  method?: string;
}

const getStr = (body: Record<string, unknown>, k: string) =>
  typeof body[k] === "string" ? (body[k] as string) : undefined;
const getNum = (body: Record<string, unknown>, k: string) => {
  const n = body[k];
  if (typeof n === "number" && Number.isFinite(n)) return n as number;
  if (typeof n === "string" && n.trim() !== "" && !Number.isNaN(Number(n))) return Number(n);
  return undefined;
};

/**
 * Map a raw provider webhook payload to our normalized event. The demo
 * providers echo our invoice number in `invoice_number` / `order_id`.
 */
export function normalizePaymentEvent(
  provider: string,
  body: Record<string, unknown>,
): NormalizedPaymentEvent | null {
  if (provider === "stripe") {
    const type = getStr(body, "type");
    if (!type) return null;
    const obj =
      (body.data as { object?: Record<string, unknown> } | undefined)?.object ?? {};
    const externalId = typeof obj.id === "string" ? obj.id : getStr(body, "id");
    if (!externalId) return null;
    const paymentStatus = typeof obj.payment_status === "string" ? obj.payment_status : "";
    const isPaid = type === "checkout.session.completed" && paymentStatus === "paid";
    const isFailed =
      type === "checkout.session.expired" || type === "checkout.session.async_payment_failed";
    const amountTotal = getNum(obj, "amount_total");
    return {
      provider: "stripe",
      externalId,
      event: type,
      status: isPaid ? "paid" : isFailed ? "failed" : "ignored",
      invoiceRef:
        getStr(body, "invoice_number") ??
        (typeof obj.client_reference_id === "string" ? obj.client_reference_id : undefined),
      amount: amountTotal != null ? round2(amountTotal / 100) : undefined,
      method: "card",
    };
  }

  if (provider === "midtrans") {
    const orderId = getStr(body, "order_id");
    const transactionId = getStr(body, "transaction_id");
    if (!orderId || !transactionId) return null;
    const status = (getStr(body, "transaction_status") ?? "").toLowerCase();
    const isPaid = status === "settlement" || status === "capture";
    const isFailed = status === "deny" || status === "cancel" || status === "expire";
    const gross = getNum(body, "gross_amount");
    return {
      provider: "midtrans",
      externalId: transactionId,
      event: status,
      status: isPaid ? "paid" : isFailed ? "failed" : "ignored",
      invoiceRef: orderId,
      amount: gross != null ? round2(gross / IDR_RATE) : undefined,
      method: getStr(body, "payment_type") ?? "qris",
    };
  }

  if (provider === "xendit") {
    const id = getStr(body, "id");
    const externalId = getStr(body, "external_id");
    if (!id || !externalId) return null;
    const status = (getStr(body, "status") ?? "").toUpperCase();
    const isPaid = status === "PAID";
    const isFailed = status === "EXPIRED" || status === "FAILED";
    const amount = getNum(body, "amount");
    return {
      provider: "xendit",
      externalId: id,
      event: status,
      status: isPaid ? "paid" : isFailed ? "failed" : "ignored",
      invoiceRef: externalId,
      amount: amount != null ? round2(amount / IDR_RATE) : undefined,
      method: getStr(body, "payment_method") ?? "qris",
    };
  }

  return null;
}

/* Signature helpers (used by the webhook HTTP route). The demo digests are
 * deterministic; production deployments swap in the provider SDKs' HMAC. */

/** Constant-time string comparison. */
export function safeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

function digest64(input: string): string {
  let h1 = 0xdeadbeef;
  let h2 = 0x41c6ce57;
  for (let i = 0; i < input.length; i++) {
    const ch = input.charCodeAt(i);
    h1 = Math.imul(h1 ^ ch, 2654435761);
    h2 = Math.imul(h2 ^ ch, 1597334677);
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
  return (h2 >>> 0).toString(16).padStart(8, "0") + (h1 >>> 0).toString(16).padStart(8, "0");
}

export interface StripeSignatureHeader {
  timestamp: number;
  signatures: string[];
}

/** Parse a `Stripe-Signature` header into timestamp + v1 signatures. */
export function parseStripeHeader(header: string): StripeSignatureHeader | null {
  const parts = header.split(",");
  let timestamp = 0;
  const signatures: string[] = [];
  for (const part of parts) {
    const [k, v] = part.split("=", 2);
    if (!k || v === undefined) continue;
    if (k === "t") timestamp = Number(v);
    if (k === "v1") signatures.push(v);
  }
  if (!timestamp || signatures.length === 0) return null;
  return { timestamp, signatures };
}

/** Demo v1 signature over `timestamp.payload.secret`. */
export function stripeV1Signature(timestamp: number, payload: string, secret: string): string {
  return digest64(`${timestamp}.${payload}.${secret}`);
}

/** Midtrans `signature_key = sha512(order_id + status_code + gross_amount + server_key)`. */
export function midtransSignatureKey(
  orderId: string,
  statusCode: string,
  grossAmount: number | string,
  serverKey: string,
): string {
  return digest64(`${orderId}${statusCode}${grossAmount}${serverKey}`);
}

/* ------------------------------------------------------------------ */
/* Subscriptions                                                       */
/* ------------------------------------------------------------------ */

export type SubscriptionStatus =
  | "active"
  | "past_due"
  | "canceled"
  | "expired";

export interface SubscriptionView {
  planId: string;
  planName: string;
  price: string;
  status: SubscriptionStatus;
  currentPeriodStart: number;
  currentPeriodEnd: number;
  renewsAt: number;
  cancelAtPeriodEnd: boolean;
  daysLeft: number;
  nextAmount: number;
}

export function subscriptionStatusAt(input: {
  renewsAt: number;
  cancelAtPeriodEnd: boolean;
  now: number;
}): SubscriptionStatus {
  const { renewsAt, cancelAtPeriodEnd, now } = input;
  if (now >= renewsAt) return "expired"; // cycle rolled over without renewal
  if (cancelAtPeriodEnd) return "canceled";
  return "active";
}

export function renewalInfo(input: {
  planPrice: string;
  periodStart: number;
  now: number;
}): { renewsAt: number; daysLeft: number; nextAmount: number } {
  const { planPrice, periodStart, now } = input;
  const renewsAt = nextBillingDate(periodStart);
  return {
    renewsAt,
    daysLeft: Math.max(0, daysBetween(now, renewsAt)),
    nextAmount: parsePriceDollars(planPrice),
  };
}

/* ------------------------------------------------------------------ */
/* Revenue dashboard                                                   */
/* ------------------------------------------------------------------ */

export interface RevenuePoint {
  ts: number;
  label: string; // e.g. "Aug 1"
  gross: number;
  net: number;
  count: number;
}

export interface RevenueTotals {
  gross: number;
  fees: number;
  net: number;
  paidCount: number;
  byKind: { kind: InvoiceKind; gross: number; count: number }[];
  byProvider: { provider: string; gross: number; count: number }[];
  series: RevenuePoint[];
}

export interface RevenueInvoiceLike {
  createdAt: number;
  amount: number;
  kind: InvoiceKind;
  status: InvoiceStatus;
  paymentProvider?: string;
}

/** Provider fee (or a default 2.9%) on an invoice amount. */
export function feeForInvoice(amount: number, provider?: string): number {
  const feePct = providerById(provider ?? "")?.feePct ?? 2.9;
  return round2((amount * feePct) / 100);
}

/** 14-day gross/net revenue series + totals, from the paid invoice ledger. */
export function revenueTotals(
  invoices: RevenueInvoiceLike[],
  opts: { days?: number; now?: number } = {},
): RevenueTotals {
  const now = opts.now ?? Date.now();
  const days = opts.days ?? 14;
  const startTs = now - days * 86_400_000;
  const paid = invoices.filter((i) => i.status === "paid" && i.createdAt >= startTs && i.createdAt <= now);

  const gross = round2(paid.reduce((s, i) => s + i.amount, 0));
  const fees = round2(paid.reduce((s, i) => s + feeForInvoice(i.amount, i.paymentProvider), 0));
  const net = round2(gross - fees);

  const byKindMap = new Map<InvoiceKind, { kind: InvoiceKind; gross: number; count: number }>();
  const byProviderMap = new Map<string, { provider: string; gross: number; count: number }>();
  for (const i of paid) {
    const k = byKindMap.get(i.kind) ?? { kind: i.kind, gross: 0, count: 0 };
    k.gross = round2(k.gross + i.amount);
    k.count += 1;
    byKindMap.set(i.kind, k);
    const pKey = i.paymentProvider ?? "card";
    const p = byProviderMap.get(pKey) ?? { provider: pKey, gross: 0, count: 0 };
    p.gross = round2(p.gross + i.amount);
    p.count += 1;
    byProviderMap.set(pKey, p);
  }

  const series: RevenuePoint[] = [];
  for (let d = 0; d < days; d++) {
    const dayStart = startTs + d * 86_400_000;
    const dayEnd = dayStart + 86_400_000;
    const dayInvoices = paid.filter((i) => i.createdAt >= dayStart && i.createdAt < dayEnd);
    const dayGross = round2(dayInvoices.reduce((s, i) => s + i.amount, 0));
    const dayFees = round2(dayInvoices.reduce((s, i) => s + feeForInvoice(i.amount, i.paymentProvider), 0));
    const label = new Date(dayStart).toLocaleDateString("en-US", { month: "short", day: "numeric" });
    series.push({ ts: dayStart, label, gross: dayGross, net: round2(dayGross - dayFees), count: dayInvoices.length });
  }

  return {
    gross,
    fees,
    net,
    paidCount: paid.length,
    byKind: [...byKindMap.values()].sort((a, b) => b.gross - a.gross),
    byProvider: [...byProviderMap.values()].sort((a, b) => b.gross - a.gross),
    series,
  };
}

export { formatDollars, parsePriceDollars };

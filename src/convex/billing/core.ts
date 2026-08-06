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

export { formatDollars };

// STEP 12 · Billing core — unit tests for the pure ledger math.
import { describe, expect, it } from "vitest";
import {
  CREDIT_PACKAGES,
  IDR_RATE,
  PAYMENT_PROVIDERS,
  checkoutExpired,
  cycleFor,
  cycleProgress,
  daysBetween,
  defaultMethod,
  feeForInvoice,
  formatIdr,
  invoiceNumber,
  isValidMethod,
  midtransSignatureKey,
  newCheckoutSession,
  nextBillingDate,
  normalizePaymentEvent,
  packageById,
  packagePriceDollars,
  parseStripeHeader,
  planInvoice,
  providerById,
  proratedAllowance,
  prorateSwitch,
  renewalInfo,
  revenueTotals,
  safeEqual,
  statementSummary,
  stripeV1Signature,
  subscriptionStatusAt,
  topupInvoice,
  usdToIdr,
  usageCost,
  usageInvoice,
} from "./core";

const DAY = 86_400_000;
// Fixed August 2026 timestamps (local-time independent via Date.UTC → ms).
const AUG_1 = Date.UTC(2026, 7, 1);
const AUG_8 = Date.UTC(2026, 7, 8);
const AUG_10 = Date.UTC(2026, 7, 10);
const AUG_14 = Date.UTC(2026, 7, 14);
const AUG_16 = Date.UTC(2026, 7, 16);
const AUG_17 = Date.UTC(2026, 7, 17);
const AUG_20 = Date.UTC(2026, 7, 20);
const AUG_21 = Date.UTC(2026, 7, 21);
const SEP_1 = Date.UTC(2026, 8, 1);

describe("credit packages", () => {
  it("lists four tiers with derived prices", () => {
    expect(CREDIT_PACKAGES).toHaveLength(4);
    const large = packageById("pack_5000");
    expect(large?.credits).toBe(5000);
    expect(packagePriceDollars(large!)).toBe(45);
    expect(packageById("nope")).toBeUndefined();
  });
});

describe("invoiceNumber", () => {
  it("formats month-scoped, zero-padded numbers", () => {
    expect(invoiceNumber(7, AUG_16)).toBe("INV-202608-0007");
    expect(invoiceNumber(1, AUG_1)).toBe("INV-202608-0001");
    expect(invoiceNumber(0, AUG_16)).toBe("INV-202608-0001"); // clamped
  });
});

describe("topupInvoice", () => {
  it("credits the balance and charges the package price", () => {
    const inv = topupInvoice({ pkg: packageById("pack_2000")!, seq: 3, at: AUG_16 });
    expect(inv.kind).toBe("topup");
    expect(inv.status).toBe("paid");
    expect(inv.creditsDelta).toBe(2000);
    expect(inv.amount).toBe(19);
    expect(inv.number).toBe("INV-202608-0003");
    expect(inv.items[0].credits).toBe(2000);
  });
});

describe("planInvoice", () => {
  it("records a paid monthly plan charge", () => {
    const inv = planInvoice({
      planName: "Pro",
      planId: "pro",
      price: "$29",
      credits: 1032,
      periodStart: AUG_1,
      periodEnd: SEP_1,
      seq: 4,
      at: AUG_16,
    });
    expect(inv.kind).toBe("plan");
    expect(inv.amount).toBe(29);
    expect(inv.creditsDelta).toBe(1032);
    expect(inv.planId).toBe("pro");
  });
});

describe("usageInvoice", () => {
  it("charges the dollar value of used credits", () => {
    const inv = usageInvoice({
      monthLabel: "August 2026",
      creditsUsed: 1500,
      perCredit: 0.01,
      periodStart: AUG_1,
      periodEnd: SEP_1,
      seq: 5,
      at: SEP_1,
    });
    expect(inv.kind).toBe("usage");
    expect(inv.creditsDelta).toBe(-1500);
    expect(inv.amount).toBe(15);
    expect(inv.items[0].credits).toBe(-1500);
  });
});

describe("billing cycle", () => {
  it("finds the calendar-month window", () => {
    const c = cycleFor(AUG_16);
    expect(c.start).toBe(AUG_1);
    expect(c.end).toBe(SEP_1);
    expect(c.days).toBe(31);
  });

  it("progress is 0..1 across the cycle", () => {
    expect(cycleProgress(AUG_1, AUG_1, SEP_1)).toBe(0);
    expect(cycleProgress(AUG_1, AUG_16, SEP_1)).toBeCloseTo(15 / 31, 3);
    expect(cycleProgress(AUG_1, SEP_1, SEP_1)).toBe(1);
    expect(cycleProgress(AUG_1, AUG_1 - DAY, SEP_1)).toBe(0); // clamped
  });

  it("next billing date rolls over year boundary", () => {
    expect(nextBillingDate(AUG_16)).toBe(SEP_1);
    const dec15 = Date.UTC(2026, 11, 15);
    expect(nextBillingDate(dec15)).toBe(Date.UTC(2027, 0, 1));
  });

  it("daysBetween is exact", () => {
    expect(daysBetween(AUG_1, AUG_16)).toBe(15);
  });
});

describe("proration", () => {
  it("proratedAllowance scales by remaining days", () => {
    // 31-day month, 15 days elapsed → 16/31 of the allowance.
    expect(proratedAllowance(2000, AUG_1, AUG_16, SEP_1)).toBe(1032);
    expect(proratedAllowance(2000, AUG_1, AUG_1, SEP_1)).toBe(2000);
    expect(proratedAllowance(2000, AUG_1, SEP_1, SEP_1)).toBe(0);
  });

  it("upgrading mid-cycle grants the prorated difference", () => {
    const result = prorateSwitch({ credits: 100 }, { credits: 2000 }, AUG_1, AUG_16, SEP_1);
    expect(result.fromCredits).toBe(52); // 100 × 16/31
    expect(result.toCredits).toBe(1032); // 2000 × 16/31
    expect(result.creditDelta).toBe(980);
    expect(result.note).toBe("+980 credits for the rest of this cycle");
  });

  it("downgrading mid-cycle yields a negative delta", () => {
    const result = prorateSwitch({ credits: 2000 }, { credits: 100 }, AUG_1, AUG_16, SEP_1);
    expect(result.creditDelta).toBe(-980);
  });
});

describe("usage & statements", () => {
  it("usageCost rounds to cents", () => {
    expect(usageCost(1500, 0.01)).toBe(15);
    expect(usageCost(333, 0.01)).toBe(3.33);
  });

  it("statementSummary reconciles bought, used, and balance", () => {
    const s = statementSummary({
      boughtCredits: 2600,
      usedCredits: 900,
      balance: 1700,
      planPriceDollars: 29,
      perCredit: 0.01,
    });
    expect(s.boughtDollars).toBe(26);
    expect(s.usedDollars).toBe(9);
    expect(s.estimateDollars).toBe(46); // 1700 × $0.01 + $29
  });
});

describe("payment providers", () => {
  it("catalogs Stripe, Midtrans, and Xendit with local methods", () => {
    expect(PAYMENT_PROVIDERS.map((p) => p.id)).toEqual(["stripe", "midtrans", "xendit"]);
    expect(providerById("midtrans")?.currency).toBe("idr");
    expect(providerById("xendit")?.methods.some((m) => m.id === "qris")).toBe(true);
    expect(providerById("stripe")?.feePct).toBe(2.9);
    expect(providerById("nope")).toBeUndefined();
  });

  it("validates provider methods and picks a default", () => {
    const midtrans = providerById("midtrans");
    expect(isValidMethod(midtrans, "qris")).toBe(true);
    expect(isValidMethod(midtrans, "apple_pay")).toBe(false);
    expect(isValidMethod(undefined, "qris")).toBe(false);
    expect(defaultMethod(providerById("stripe"))).toBe("card");
    expect(defaultMethod(undefined)).toBe("card");
  });

  it("converts USD ↔ IDR with the fixed demo rate", () => {
    expect(IDR_RATE).toBe(16000);
    expect(usdToIdr(19)).toBe(304000);
    expect(formatIdr(304000)).toBe("Rp 304.000");
  });
});

describe("checkout sessions", () => {
  it("builds a deterministic session with a pay URL and TTL", () => {
    const s = newCheckoutSession({
      invoiceNumber: "INV-202608-0007",
      provider: "midtrans",
      method: "qris",
      amountUsd: 19,
      at: AUG_16,
    });
    expect(s.sessionId).toMatch(/^cs_midtrans_/);
    expect(s.status).toBe("open");
    expect(s.mode).toBe("simulated");
    expect(s.currency).toBe("idr");
    expect(s.displayAmount).toBe(usdToIdr(19));
    expect(s.amount).toBe(19);
    expect(s.payUrl).toContain(s.sessionId);
    expect(s.expiresAt - s.createdAt).toBe(2 * 60 * 60 * 1000);
  });

  it("same minute + invoice yields the same session id (deterministic)", () => {
    const a = newCheckoutSession({ invoiceNumber: "INV-1", provider: "stripe", method: "card", amountUsd: 5, at: AUG_16 });
    const b = newCheckoutSession({ invoiceNumber: "INV-1", provider: "stripe", method: "card", amountUsd: 5, at: AUG_16 + 1 });
    expect(a.sessionId).toBe(b.sessionId);
  });

  it("sessions expire after the TTL", () => {
    const s = newCheckoutSession({ invoiceNumber: "INV-1", provider: "stripe", method: "card", amountUsd: 5, at: AUG_16 });
    expect(checkoutExpired(s, s.expiresAt + 1)).toBe(true);
    expect(checkoutExpired(s, s.expiresAt - 1)).toBe(false);
  });
});

describe("webhook normalization", () => {
  it("stripe checkout.session.completed → paid", () => {
    const ev = normalizePaymentEvent("stripe", {
      type: "checkout.session.completed",
      invoice_number: "INV-202608-0007",
      data: { object: { id: "cs_test_1", payment_status: "paid", amount_total: 1900, client_reference_id: "INV-202608-0007" } },
    });
    expect(ev?.status).toBe("paid");
    expect(ev?.externalId).toBe("cs_test_1");
    expect(ev?.amount).toBe(19);
    expect(ev?.invoiceRef).toBe("INV-202608-0007");
  });

  it("stripe expired session → failed", () => {
    const ev = normalizePaymentEvent("stripe", {
      type: "checkout.session.expired",
      data: { object: { id: "cs_test_2" } },
    });
    expect(ev?.status).toBe("failed");
  });

  it("midtrans settlement → paid with IDR→USD conversion", () => {
    const ev = normalizePaymentEvent("midtrans", {
      order_id: "INV-202608-0007",
      transaction_id: "txn_1",
      transaction_status: "settlement",
      payment_type: "qris",
      gross_amount: 304000,
    });
    expect(ev?.status).toBe("paid");
    expect(ev?.amount).toBe(19);
    expect(ev?.method).toBe("qris");
  });

  it("midtrans cancel → failed", () => {
    const ev = normalizePaymentEvent("midtrans", {
      order_id: "INV-202608-0007",
      transaction_id: "txn_2",
      transaction_status: "cancel",
      gross_amount: 100,
    });
    expect(ev?.status).toBe("failed");
  });

  it("xendit PAID invoice → paid", () => {
    const ev = normalizePaymentEvent("xendit", {
      id: "inv_1",
      external_id: "INV-202608-0007",
      status: "PAID",
      amount: 304000,
      payment_method: "DANA",
    });
    expect(ev?.status).toBe("paid");
    expect(ev?.externalId).toBe("inv_1");
    expect(ev?.amount).toBe(19);
  });

  it("unknown provider or malformed payload → null", () => {
    expect(normalizePaymentEvent("paypal", { type: "x" })).toBeNull();
    expect(normalizePaymentEvent("stripe", {})).toBeNull();
    expect(normalizePaymentEvent("midtrans", { order_id: "x" })).toBeNull();
  });
});

describe("signature helpers", () => {
  it("safeEqual is constant-time-ish and correct", () => {
    expect(safeEqual("abc", "abc")).toBe(true);
    expect(safeEqual("abc", "abd")).toBe(false);
    expect(safeEqual("abc", "abcde")).toBe(false);
  });

  it("parses a Stripe-Signature header", () => {
    const parsed = parseStripeHeader("t=1492774577,v1=abc123,v0=old");
    expect(parsed?.timestamp).toBe(1492774577);
    expect(parsed?.signatures).toEqual(["abc123"]);
    expect(parseStripeHeader("garbage")).toBeNull();
  });

  it("v1 signature roundtrips deterministically", () => {
    const sig = stripeV1Signature(1492774577, "{\"x\":1}", "whsec_demo");
    expect(sig).toBe(stripeV1Signature(1492774577, "{\"x\":1}", "whsec_demo"));
    expect(sig).not.toBe(stripeV1Signature(1492774577, "{\"x\":2}", "whsec_demo"));
  });

  it("midtrans signature key is order+status+amount+key", () => {
    const sig = midtransSignatureKey("INV-1", "200", 1900, "server-key");
    expect(sig).toBe(midtransSignatureKey("INV-1", "200", 1900, "server-key"));
    expect(sig).not.toBe(midtransSignatureKey("INV-1", "201", 1900, "server-key"));
  });
});

describe("subscriptions", () => {
  it("derives active / canceled / expired status", () => {
    expect(subscriptionStatusAt({ renewsAt: SEP_1, cancelAtPeriodEnd: false, now: AUG_16 })).toBe("active");
    expect(subscriptionStatusAt({ renewsAt: SEP_1, cancelAtPeriodEnd: true, now: AUG_16 })).toBe("canceled");
    expect(subscriptionStatusAt({ renewsAt: SEP_1, cancelAtPeriodEnd: false, now: SEP_1 })).toBe("expired");
  });

  it("renewal info projects the next charge date", () => {
    const r = renewalInfo({ planPrice: "$29", periodStart: AUG_1, now: AUG_16 });
    expect(r.renewsAt).toBe(SEP_1);
    expect(r.daysLeft).toBe(16);
    expect(r.nextAmount).toBe(29);
  });
});

describe("revenue dashboard", () => {
  const paid = (num: string, kind: "plan" | "topup" | "usage", at: number, amount: number, provider?: string) => ({
    createdAt: at,
    amount,
    kind,
    status: "paid" as const,
    paymentProvider: provider,
    number: num,
  });

  it("totals gross, fees, and net from paid invoices in the window", () => {
    const r = revenueTotals(
      [
        paid("1", "topup", AUG_16, 19, "midtrans"),
        paid("2", "plan", AUG_8, 29, "stripe"),
        paid("3", "usage", AUG_10, 10),
        paid("4", "topup", AUG_20, 45, "xendit"),
      ],
      { now: AUG_21, days: 14 },
    );
    expect(r.gross).toBe(103);
    expect(r.fees).toBeCloseTo(19 * 0.028 + 29 * 0.029 + 10 * 0.029 + 45 * 0.029, 2);
    expect(r.net).toBeCloseTo(r.gross - r.fees, 2);
    expect(r.paidCount).toBe(4);
  });

  it("excludes invoices outside the window and unpaid ones", () => {
    const r = revenueTotals(
      [
        paid("old", "topup", AUG_1, 100), // before the 14-day window
        { ...paid("pend", "topup", AUG_16, 50), status: "pending" as const },
        paid("new", "plan", AUG_16, 29),
      ],
      { now: AUG_21, days: 14 },
    );
    expect(r.gross).toBe(29);
    expect(r.paidCount).toBe(1);
  });

  it("groups revenue by kind and by provider", () => {
    const r = revenueTotals(
      [
        paid("1", "topup", AUG_16, 19, "midtrans"),
        paid("2", "plan", AUG_16, 29, "stripe"),
        paid("3", "topup", AUG_17, 45, "midtrans"),
      ],
      { now: AUG_21, days: 14 },
    );
    const kind = r.byKind.find((k) => k.kind === "topup");
    expect(kind?.gross).toBe(64);
    expect(kind?.count).toBe(2);
    const prov = r.byProvider.find((p) => p.provider === "midtrans");
    expect(prov?.gross).toBe(64);
    expect(prov?.count).toBe(2);
  });

  it("builds a full series with zero-filled days", () => {
    const r = revenueTotals([paid("1", "topup", AUG_14, 19, "midtrans")], { now: AUG_16, days: 3 });
    expect(r.series).toHaveLength(3);
    expect(r.series[1].gross).toBe(19);
    expect(r.series[0].gross).toBe(0);
    expect(r.series[2].label).toBeTruthy();
  });

  it("feeForInvoice uses the provider fee or a default", () => {
    expect(feeForInvoice(100, "midtrans")).toBe(2.8);
    expect(feeForInvoice(100, "stripe")).toBe(2.9);
    expect(feeForInvoice(100)).toBe(2.9);
  });
});

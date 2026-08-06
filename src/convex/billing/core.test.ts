// STEP 12 · Billing core — unit tests for the pure ledger math.
import { describe, expect, it } from "vitest";
import {
  CREDIT_PACKAGES,
  cycleFor,
  cycleProgress,
  daysBetween,
  invoiceNumber,
  nextBillingDate,
  packageById,
  packagePriceDollars,
  planInvoice,
  proratedAllowance,
  prorateSwitch,
  statementSummary,
  topupInvoice,
  usageCost,
  usageInvoice,
} from "./core";

const DAY = 86_400_000;
// Fixed August 2026 timestamps (local-time independent via Date.UTC → ms).
const AUG_1 = Date.UTC(2026, 7, 1);
const AUG_16 = Date.UTC(2026, 7, 16);
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

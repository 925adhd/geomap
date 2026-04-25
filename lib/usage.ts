import { supabase } from "./supabase";

// Tracks Places API call volume per UTC month so we can enforce a hard
// cost cap in /api/places. Counter resets automatically on the first
// of each month — we just use the current "YYYY-MM" as the row key.
// One row per month in the `usage` table; missing row = zero calls.

// Per Google Maps Platform pricing (Places API New, Text Search):
// Essentials: 10,000 free/mo, then $5 per 1,000 (next tier kicks in at 100K).
// Enterprise: 1,000 free/mo, then $35 per 1,000.
// Cap math uses the first paid tier; if you ever exceed 100K Essentials in
// a month you'll want to revisit these constants.
const ESSENTIALS_FREE = 10_000;
const ESSENTIALS_RATE_PER_CALL = 5 / 1000;
const ENTERPRISE_FREE = 1_000;
const ENTERPRISE_RATE_PER_CALL = 35 / 1000;

// Per-scan cost estimate, ignoring the monthly free tier. Used to populate
// the per-scan cost column so each row reflects what the scan would cost
// a paying customer; the global usage counter handles real spend tracking.
export function costForCalls(
  essentialsCalls: number,
  enterpriseCalls: number
): number {
  return (
    essentialsCalls * ESSENTIALS_RATE_PER_CALL +
    enterpriseCalls * ENTERPRISE_RATE_PER_CALL
  );
}

type Usage = {
  month: string; // "YYYY-MM" UTC
  essentialsCalls: number;
  enterpriseCalls: number;
  lastUpdated: string;
};

function currentMonth(): string {
  const now = new Date();
  return `${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, "0")}`;
}

function freshUsage(): Usage {
  return {
    month: currentMonth(),
    essentialsCalls: 0,
    enterpriseCalls: 0,
    lastUpdated: new Date().toISOString(),
  };
}

async function readUsage(): Promise<Usage> {
  const month = currentMonth();
  const { data, error } = await supabase()
    .from("usage")
    .select("month, essentials_calls, enterprise_calls, last_updated")
    .eq("month", month)
    .maybeSingle();
  if (error || !data) return freshUsage();
  return {
    month: data.month,
    essentialsCalls: data.essentials_calls ?? 0,
    enterpriseCalls: data.enterprise_calls ?? 0,
    lastUpdated: data.last_updated ?? new Date().toISOString(),
  };
}

export async function recordPlacesCall(includeRatings: boolean) {
  const usage = await readUsage();
  if (includeRatings) usage.enterpriseCalls += 1;
  else usage.essentialsCalls += 1;
  usage.lastUpdated = new Date().toISOString();
  await supabase()
    .from("usage")
    .upsert(
      {
        month: usage.month,
        essentials_calls: usage.essentialsCalls,
        enterprise_calls: usage.enterpriseCalls,
        last_updated: usage.lastUpdated,
      },
      { onConflict: "month" }
    );
}

export async function getEstimatedCostUsd(): Promise<number> {
  const usage = await readUsage();
  const essentialsBilled = Math.max(0, usage.essentialsCalls - ESSENTIALS_FREE);
  const enterpriseBilled = Math.max(0, usage.enterpriseCalls - ENTERPRISE_FREE);
  return (
    essentialsBilled * ESSENTIALS_RATE_PER_CALL +
    enterpriseBilled * ENTERPRISE_RATE_PER_CALL
  );
}

export async function isOverBudget(maxUsd: number): Promise<boolean> {
  if (!Number.isFinite(maxUsd) || maxUsd <= 0) return false;
  const cost = await getEstimatedCostUsd();
  return cost >= maxUsd;
}

export async function getUsageSnapshot() {
  const usage = await readUsage();
  return { ...usage, estimatedCostUsd: await getEstimatedCostUsd() };
}

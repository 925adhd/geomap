import { supabase } from "./supabase";

// Tracks Places API call volume per UTC month so we can enforce a hard
// cost cap in /api/places. Counter resets automatically on the first
// of each month — we just use the current "YYYY-MM" as the row key.
// One row per month in the `usage` table; missing row = zero calls.

// Per Google Maps Platform pricing list (Places API New, Text Search):
//
//   Pro tier — 5,000 free/mo, then $32/1k
//     Triggered by field mask: id, displayName, formattedAddress, location
//     i.e. our default scan and resolve calls.
//
//   Enterprise + Atmosphere tier — 1,000 free/mo, then $40/1k
//     Triggered by adding `rating` / `userRatingCount` to the field mask
//     i.e. the admin business-picker call (includeRatings=true).
//
// Cap math uses the first paid tier; if you ever push past 100k Pro or
// 100k Enterprise+Atmosphere calls in a month you'll want to revisit
// these constants — Google's higher-volume tiers are cheaper.
const PRO_FREE = 5_000;
const PRO_RATE_PER_CALL = 32 / 1000;
const ENTERPRISE_ATMOSPHERE_FREE = 1_000;
const ENTERPRISE_ATMOSPHERE_RATE_PER_CALL = 40 / 1000;

type Usage = {
  month: string; // "YYYY-MM" UTC
  proCalls: number;
  enterpriseAtmosphereCalls: number;
  lastUpdated: string;
};

function currentMonth(): string {
  const now = new Date();
  return `${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, "0")}`;
}

function freshUsage(): Usage {
  return {
    month: currentMonth(),
    proCalls: 0,
    enterpriseAtmosphereCalls: 0,
    lastUpdated: new Date().toISOString(),
  };
}

async function readUsage(): Promise<Usage> {
  const month = currentMonth();
  const { data, error } = await supabase()
    .from("usage")
    .select("month, pro_calls, enterprise_atmosphere_calls, last_updated")
    .eq("month", month)
    .maybeSingle();
  if (error || !data) return freshUsage();
  return {
    month: data.month,
    proCalls: data.pro_calls ?? 0,
    enterpriseAtmosphereCalls: data.enterprise_atmosphere_calls ?? 0,
    lastUpdated: data.last_updated ?? new Date().toISOString(),
  };
}

export async function recordPlacesCall(includeRatings: boolean) {
  const usage = await readUsage();
  if (includeRatings) usage.enterpriseAtmosphereCalls += 1;
  else usage.proCalls += 1;
  usage.lastUpdated = new Date().toISOString();
  await supabase()
    .from("usage")
    .upsert(
      {
        month: usage.month,
        pro_calls: usage.proCalls,
        enterprise_atmosphere_calls: usage.enterpriseAtmosphereCalls,
        last_updated: usage.lastUpdated,
      },
      { onConflict: "month" }
    );
}

// Per-scan cost estimate, ignoring the monthly free tier. Used to populate
// the per-scan cost column so each row reflects what the scan would cost
// a paying customer; the global usage counter handles real spend tracking.
export function costForCalls(
  proCalls: number,
  enterpriseAtmosphereCalls: number
): number {
  return (
    proCalls * PRO_RATE_PER_CALL +
    enterpriseAtmosphereCalls * ENTERPRISE_ATMOSPHERE_RATE_PER_CALL
  );
}

export async function getEstimatedCostUsd(): Promise<number> {
  const usage = await readUsage();
  const proBilled = Math.max(0, usage.proCalls - PRO_FREE);
  const eaBilled = Math.max(
    0,
    usage.enterpriseAtmosphereCalls - ENTERPRISE_ATMOSPHERE_FREE
  );
  return (
    proBilled * PRO_RATE_PER_CALL +
    eaBilled * ENTERPRISE_ATMOSPHERE_RATE_PER_CALL
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

import fs from "fs/promises";
import path from "path";

// Tracks Places API call volume per UTC month so we can enforce a hard
// cost cap in /api/places. Counter resets automatically on the first
// of each month. Storage is the same JSON-file pattern used by leads
// and scans, so it works on a long-lived Node process (her desktop, a VPS).
// On serverless filesystems this would silently no-op on write — fine,
// just means the cap doesn't enforce. Don't deploy without persistent FS.

const DATA_DIR = path.join(process.cwd(), "data");
const USAGE_FILE = path.join(DATA_DIR, "usage.json");

// Per Google Maps Platform pricing (Places API New, Text Search):
// Essentials: 10,000 free/mo, then $5 per 1,000 (next tier kicks in at 100K).
// Enterprise: 1,000 free/mo, then $35 per 1,000.
// Cap math uses the first paid tier; if you ever exceed 100K Essentials in
// a month you'll want to revisit these constants.
const ESSENTIALS_FREE = 10_000;
const ESSENTIALS_RATE_PER_CALL = 5 / 1000;
const ENTERPRISE_FREE = 1_000;
const ENTERPRISE_RATE_PER_CALL = 35 / 1000;

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
  try {
    const contents = await fs.readFile(USAGE_FILE, "utf-8");
    const parsed = JSON.parse(contents) as Usage;
    if (parsed.month !== currentMonth()) return freshUsage();
    return parsed;
  } catch {
    return freshUsage();
  }
}

async function writeUsage(usage: Usage) {
  await fs.mkdir(DATA_DIR, { recursive: true });
  await fs.writeFile(USAGE_FILE, JSON.stringify(usage, null, 2), "utf-8");
}

export async function recordPlacesCall(includeRatings: boolean) {
  const usage = await readUsage();
  if (includeRatings) usage.enterpriseCalls += 1;
  else usage.essentialsCalls += 1;
  usage.lastUpdated = new Date().toISOString();
  await writeUsage(usage);
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

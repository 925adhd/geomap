import { NextRequest, NextResponse } from "next/server";
import { corsHeaders, preflight, rejectDisallowedOrigin } from "@/lib/cors";
import { supabase } from "@/lib/supabase";
import { generateGrid } from "@/lib/grid";
import { PlacesApiError, PlacesBudgetError, searchPlaces } from "@/lib/places";
import { costForCalls } from "@/lib/usage";
import type { PlaceResult, Scan, ScanPoint, TargetBusiness } from "@/lib/types";

// Public auto-audit endpoint. Two-phase to avoid scanning the wrong
// business when the visitor's typed name doesn't match Google's records:
//
//   1. step:"resolve" — look up Places for that name, return the top match
//      so the client can show a "Is this you?" confirmation card.
//   2. step:"scan" — run the 49-point grid scan with the confirmed target,
//      save the scan, return the report URL.
//
// The scan is intentionally lead-less. The visitor's email is collected
// later via /api/auto-scan/unlock when they unlock the locked report
// (see [report/[timestamp]/page.tsx]). That moves the email ask from the
// highest-friction moment (before any value) to the highest-intent moment
// (after they've seen a heatmap of their own town).

// Vercel Pro plan: 60s function ceiling. A 49-point scan with 5-way
// parallelism finishes in ~10s on a good day; 60s is the safety cap.
export const maxDuration = 60;

const GRAYSON_CENTER: [number, number] = [37.4789, -86.3408];
const GRID_ROWS = 7;
const GRID_COLS = 7;
const RADIUS_MILES = 15;
const SEARCH_RADIUS_M = 5000;
const MAX_RESULTS = 20;
// Concurrent in-flight Places calls. Google's documented Text Search QPS is
// well above this; 5 keeps us polite and predictable on Vercel's network.
const SCAN_CONCURRENCY = 5;

const MAX_BUSINESS = 200;
const MAX_KEYWORD = 200;

const IP_DAILY_WINDOW_MS = 24 * 60 * 60 * 1000;
// Combined cap: counts scans + unlocks from this IP in the last 24h.
// 2 lets a normal visitor recover from a typo or retry a different
// keyword without opening the door to free-tier abuse.
const IP_DAILY_LIMIT = 2;

type AutoScanBody = {
  step?: "resolve" | "scan";
  businessName?: string;
  keyword?: string;
  honeypot?: string;
  target?: TargetBusiness;
};

type FormFields = {
  businessName: string;
  keyword: string;
};

export function OPTIONS(req: NextRequest) {
  return preflight(req);
}

export async function POST(req: NextRequest) {
  const blocked = rejectDisallowedOrigin(req);
  if (blocked) return blocked;

  let body: AutoScanBody;
  try {
    body = await req.json();
  } catch {
    return jsonError(req, 400, "Invalid body");
  }

  // Honeypot — silently succeed without doing any work. Bots don't retry,
  // and the client treats this as a "we're done" signal.
  if (body.honeypot) {
    return NextResponse.json(
      { ok: true, reportPath: null },
      { headers: corsHeaders(req) }
    );
  }

  const fields = parseAndValidate(body);
  if ("error" in fields) {
    return jsonError(req, 400, fields.error);
  }

  const ip =
    req.headers.get("x-forwarded-for")?.split(",")[0].trim() ||
    req.headers.get("x-real-ip") ||
    undefined;

  if (body.step === "scan") {
    if (!body.target?.placeId) {
      return jsonError(req, 400, "Confirmed business is required to start the scan.");
    }
    return handleScan(req, fields, body.target, ip);
  }

  return handleResolve(req, fields, ip);
}

// --- Step 1: resolve ---------------------------------------------------------
async function handleResolve(
  req: NextRequest,
  fields: FormFields,
  ip: string | undefined
) {
  // Per-IP daily limit applied to resolve too. Without it, a bot can burn
  // the Places free tier by spamming resolve calls. Counts the unlocked
  // leads rows from this IP in the last 24h: a normal visitor produces
  // one and is unaffected.
  if (await isIpOverLimit(ip)) {
    console.warn("[auto-scan/resolve] IP rate limit fired:", ip);
    return rateLimitedError(req);
  }

  let target: TargetBusiness;
  try {
    target = await resolveBusiness(fields.businessName);
  } catch (e) {
    if (e instanceof PlacesBudgetError) return budgetError(req);
    if (e instanceof PlacesApiError) return jsonError(req, 502, e.message);
    if (e instanceof Error && e.message === "no_match") {
      return jsonError(
        req,
        404,
        "We couldn't find that business on Google. Make sure your Google Business Profile uses that exact name, then try again.",
        "no_match"
      );
    }
    console.error("[auto-scan/resolve] failed:", e);
    return jsonError(req, 500, "Couldn't look that business up. Try again.");
  }

  return NextResponse.json(
    { ok: true, target },
    { headers: corsHeaders(req) }
  );
}

// --- Step 2: scan ------------------------------------------------------------
async function handleScan(
  req: NextRequest,
  fields: FormFields,
  target: TargetBusiness,
  ip: string | undefined
) {
  if (await isIpOverLimit(ip)) {
    // Same vague message as budget_exceeded so abusers can't infer the
    // limit type or wait-out window. Internal logs still capture which
    // limit fired for ops visibility.
    console.warn("[auto-scan/scan] IP rate limit fired:", ip);
    return rateLimitedError(req);
  }

  // Run the 49-point grid scan in batches of SCAN_CONCURRENCY. Failures on
  // individual points are captured into the ScanPoint rather than aborting —
  // a sparse map is still a useful map. A budget error on any call aborts.
  const radiusKm = RADIUS_MILES * 1.609344;
  const scanCenter: [number, number] = target.location
    ? [target.location.latitude, target.location.longitude]
    : GRAYSON_CENTER;
  const grid = generateGrid(scanCenter, radiusKm, GRID_ROWS, GRID_COLS);

  let points: ScanPoint[];
  try {
    points = await runGridScan(grid, fields.keyword, target.placeId);
  } catch (e) {
    if (e instanceof PlacesBudgetError) return budgetError(req);
    console.error("[auto-scan/scan] grid scan failed:", e);
    return jsonError(req, 500, "Scan failed mid-run. Try again in a moment.");
  }

  const timestamp = new Date().toISOString();
  const scan: Scan = {
    timestamp,
    target,
    keyword: fields.keyword,
    gridRows: GRID_ROWS,
    gridCols: GRID_COLS,
    radiusMiles: RADIUS_MILES,
    center: scanCenter,
    points,
  };

  // Auto-scan call accounting: 1 Pro call for the resolve + one per grid
  // point that actually hit Google. PlacesBudgetError aborts before any
  // save happens, so we never reach here with an under-counted scan.
  const proCalls = 1 + grid.length;
  const enterpriseAtmosphereCalls = 0;
  const estimatedCostUsd = costForCalls(proCalls, enterpriseAtmosphereCalls);

  // Save the scan along with the visitor's IP. We need the IP on the scan
  // row so the unlock step can enforce rate limits against the same daily
  // window without requiring a second IP capture later.
  const { error: scanErr } = await supabase()
    .from("scans")
    .upsert(
      {
        timestamp,
        payload: scan,
        pro_calls: proCalls,
        enterprise_atmosphere_calls: enterpriseAtmosphereCalls,
        estimated_cost_usd: estimatedCostUsd,
        ip: ip ?? null,
      },
      { onConflict: "timestamp" }
    );
  if (scanErr) {
    console.error("[auto-scan/scan] scan save failed:", scanErr);
    return jsonError(req, 500, "Couldn't save scan.");
  }

  return NextResponse.json(
    { ok: true, reportPath: `/report/${encodeURIComponent(timestamp)}` },
    { headers: corsHeaders(req) }
  );
}

// --- helpers -----------------------------------------------------------------

function parseAndValidate(body: AutoScanBody): FormFields | { error: string } {
  const businessName = (body.businessName || "").trim().slice(0, MAX_BUSINESS);
  const keyword = (body.keyword || "").trim().slice(0, MAX_KEYWORD);
  if (!businessName || !keyword) {
    return { error: "Business name and keyword are required." };
  }
  return { businessName, keyword };
}

async function isIpOverLimit(ip: string | undefined): Promise<boolean> {
  if (!ip) return false;
  const ipWindowStart = new Date(Date.now() - IP_DAILY_WINDOW_MS).toISOString();
  // Count both lead rows (unlocks) AND scan rows from this IP, since
  // scans now happen without a lead. A single visitor running 3 scans
  // and never unlocking should still hit the cap.
  const [{ data: leadRows }, { data: scanRows }] = await Promise.all([
    supabase()
      .from("leads")
      .select("timestamp")
      .eq("ip", ip)
      .gte("timestamp", ipWindowStart),
    supabase()
      .from("scans")
      .select("timestamp")
      .eq("ip", ip)
      .gte("timestamp", ipWindowStart),
  ]);
  const total = (leadRows?.length ?? 0) + (scanRows?.length ?? 0);
  return total >= IP_DAILY_LIMIT;
}

async function resolveBusiness(businessName: string): Promise<TargetBusiness> {
  // Bias to Grayson County center with a generous radius so the search
  // reaches any business in the county. We don't need ratings here — the
  // confirmation card just needs name + address. Keeping this on Essentials
  // tier saves the Enterprise call.
  const results = await searchPlaces({
    textQuery: businessName,
    lat: GRAYSON_CENTER[0],
    lng: GRAYSON_CENTER[1],
    radius: 50_000,
    maxResults: 1,
    includeRatings: false,
  });
  const top = results[0];
  if (!top || !top.id) throw new Error("no_match");
  return {
    placeId: top.id,
    name: top.displayName?.text || businessName,
    address: top.formattedAddress || "",
    location: top.location
      ? { latitude: top.location.latitude, longitude: top.location.longitude }
      : null,
  };
}

async function runGridScan(
  grid: { lat: number; lng: number; row: number; col: number }[],
  keyword: string,
  targetPlaceId: string
): Promise<ScanPoint[]> {
  const results: ScanPoint[] = new Array(grid.length);
  for (let i = 0; i < grid.length; i += SCAN_CONCURRENCY) {
    const batch = grid.slice(i, i + SCAN_CONCURRENCY);
    const settled = await Promise.all(
      batch.map(async (pt) => {
        try {
          const places = await searchPlaces({
            textQuery: keyword,
            lat: pt.lat,
            lng: pt.lng,
            radius: SEARCH_RADIUS_M,
            maxResults: MAX_RESULTS,
            includeRatings: false,
          });
          const rank = findRank(places, targetPlaceId);
          const topResult = places[0]?.displayName?.text || null;
          const topThree = places
            .slice(0, 3)
            .map((p) => p.displayName?.text)
            .filter((n): n is string => !!n);
          return { ...pt, rank, topResult, topThree } as ScanPoint;
        } catch (e) {
          if (e instanceof PlacesBudgetError) throw e;
          return {
            ...pt,
            rank: null,
            error: (e as Error).message,
          } as ScanPoint;
        }
      })
    );
    settled.forEach((r, j) => (results[i + j] = r));
  }
  return results;
}

function findRank(places: PlaceResult[], targetPlaceId: string): number | null {
  for (let i = 0; i < places.length; i++) {
    if (places[i].id === targetPlaceId) return i + 1;
  }
  return null;
}

function jsonError(
  req: NextRequest,
  status: number,
  message: string,
  code?: string
) {
  return NextResponse.json(
    { error: message, ...(code ? { code } : {}) },
    { status, headers: corsHeaders(req) }
  );
}

function rateLimitedError(req: NextRequest) {
  // Per-IP daily cap fired. Distinct from the monthly budget cap — this
  // visitor specifically has already used their daily allowance, so the
  // honest message ("today's audits, try tomorrow") gives them a real
  // path forward instead of implying the whole tool is sold out.
  return jsonError(
    req,
    429,
    "You've already used today's free audits. Try again tomorrow, or email kara@studio925.design and I'll run yours sooner.",
    "rate_limited"
  );
}

function budgetError(req: NextRequest) {
  // Same wording as the IP rate-limit message — visitor sees one
  // unified "this isn't available, email me" fallback regardless of
  // which guard fired.
  return jsonError(
    req,
    503,
    "This month's free audits are all used up. Email kara@studio925.design with your business name and keyword and I'll run yours within the day.",
    "budget_exceeded"
  );
}

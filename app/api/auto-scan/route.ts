import { NextRequest, NextResponse } from "next/server";
import { corsHeaders, preflight, rejectDisallowedOrigin } from "@/lib/cors";
import { supabase } from "@/lib/supabase";
import { generateGrid } from "@/lib/grid";
import { PlacesApiError, PlacesBudgetError, searchPlaces } from "@/lib/places";
import type { PlaceResult, Scan, ScanPoint, TargetBusiness } from "@/lib/types";

// Public auto-audit endpoint. Replaces the old web3forms + manual scan flow.
// Visitor submits the audit form -> we resolve their business via Places ->
// run a 49-point scan -> save scan + lead -> return the report URL.
//
// Lifetime per-email cap: if the email already submitted once, we skip the
// scan entirely and return their existing report. This is the cost guard
// against bots and casual abuse — re-running a scan for the same email
// burns 49 Places calls every time.

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
const MAX_EMAIL = 254;
const MAX_PHONE = 40;
const MAX_KEYWORD = 200;
const MAX_NOTES = 1000;

const IP_DAILY_WINDOW_MS = 24 * 60 * 60 * 1000;
const IP_DAILY_LIMIT = 3;

type AutoScanBody = {
  businessName?: string;
  email?: string;
  phone?: string;
  keyword?: string;
  notes?: string;
  honeypot?: string;
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

  // Honeypot — silently succeed. Bots never see the result and don't retry.
  if (body.honeypot) {
    return NextResponse.json(
      { ok: true, reportPath: null },
      { headers: corsHeaders(req) }
    );
  }

  const businessName = (body.businessName || "").trim().slice(0, MAX_BUSINESS);
  const email = (body.email || "").trim().toLowerCase().slice(0, MAX_EMAIL);
  const phone = body.phone?.trim().slice(0, MAX_PHONE) || undefined;
  const keyword = (body.keyword || "").trim().slice(0, MAX_KEYWORD);
  const notes = body.notes?.trim().slice(0, MAX_NOTES) || undefined;

  if (!businessName || !email || !keyword) {
    return jsonError(req, 400, "Business name, email, and keyword are required.");
  }
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return jsonError(req, 400, "Invalid email.");
  }

  const ip =
    req.headers.get("x-forwarded-for")?.split(",")[0].trim() ||
    req.headers.get("x-real-ip") ||
    undefined;

  // Lifetime per-email cap. If we already have a lead for this email, return
  // the existing report instead of running a fresh scan. The lead and its
  // scan share the same `timestamp` (set when the lead was first created),
  // so one lookup is enough.
  const existingScan = await findExistingScanForEmail(email);
  if (existingScan) {
    return NextResponse.json(
      {
        ok: true,
        reportPath: `/report/${encodeURIComponent(existingScan.timestamp)}`,
        deduped: true,
      },
      { headers: corsHeaders(req) }
    );
  }

  // Per-IP daily limit — defends against rotating-email bot spam from one
  // network. Soft fail (log but proceed) on any DB error so a transient
  // Supabase blip doesn't block real customers.
  if (ip) {
    const ipWindowStart = new Date(Date.now() - IP_DAILY_WINDOW_MS).toISOString();
    const { data: ipRows } = await supabase()
      .from("leads")
      .select("timestamp")
      .eq("ip", ip)
      .gte("timestamp", ipWindowStart);
    if (ipRows && ipRows.length >= IP_DAILY_LIMIT) {
      return jsonError(
        req,
        429,
        "Too many requests from your network today. Please try again tomorrow.",
        "rate_limit_ip"
      );
    }
  }

  // Resolve the business. We bias the search to Grayson County and accept
  // the first result; if nothing matches, bail before burning the 49-call
  // grid scan. includeRatings=true upgrades this single call to Enterprise
  // tier ($35/1k, 1k free) to match the admin dashboard's picker behavior.
  let target: TargetBusiness;
  try {
    target = await resolveBusiness(businessName);
  } catch (e) {
    if (e instanceof PlacesBudgetError) return budgetError(req);
    if (e instanceof PlacesApiError) return jsonError(req, 502, e.message);
    if (e instanceof Error && e.message === "no_match") {
      return jsonError(
        req,
        404,
        "We couldn't find that business on Google. Make sure it has a Google Business Profile, then try again.",
        "no_match"
      );
    }
    console.error("[auto-scan] resolve failed:", e);
    return jsonError(req, 500, "Couldn't resolve business.");
  }

  // Run the 49-point grid scan in batches. Failures on individual points are
  // captured into the ScanPoint rather than aborting — a sparse map is still
  // a useful map. A budget error on any call aborts the whole scan.
  const radiusKm = RADIUS_MILES * 1.609344;
  const scanCenter: [number, number] = target.location
    ? [target.location.latitude, target.location.longitude]
    : GRAYSON_CENTER;
  const grid = generateGrid(scanCenter, radiusKm, GRID_ROWS, GRID_COLS);

  let points: ScanPoint[];
  try {
    points = await runGridScan(grid, keyword, target.placeId);
  } catch (e) {
    if (e instanceof PlacesBudgetError) return budgetError(req);
    console.error("[auto-scan] grid scan failed:", e);
    return jsonError(req, 500, "Scan failed mid-run. Try again in a moment.");
  }

  const timestamp = new Date().toISOString();
  const scan: Scan = {
    timestamp,
    target,
    keyword,
    gridRows: GRID_ROWS,
    gridCols: GRID_COLS,
    radiusMiles: RADIUS_MILES,
    center: scanCenter,
    points,
  };

  // Save scan first; if that fails the lead is useless to us (no report to
  // link to) so we'd rather surface the error than save an orphan lead.
  const { error: scanErr } = await supabase()
    .from("scans")
    .upsert({ timestamp, payload: scan }, { onConflict: "timestamp" });
  if (scanErr) {
    console.error("[auto-scan] scan save failed:", scanErr);
    return jsonError(req, 500, "Couldn't save scan.");
  }

  const { error: leadErr } = await supabase().from("leads").insert({
    timestamp,
    business_name: businessName,
    email,
    phone: phone ?? null,
    keyword,
    notes: notes ?? null,
    status: "scanned",
    ip: ip ?? null,
  });
  if (leadErr) {
    // Scan succeeded; lead insert failing is non-fatal for the visitor
    // (they get their report) but we want to know about it.
    console.error("[auto-scan] lead insert failed:", leadErr);
  }

  const reportPath = `/report/${encodeURIComponent(timestamp)}`;
  // Fire-and-forget email. Never block the response on Resend.
  notifyOnSuccess({
    timestamp,
    businessName,
    email,
    phone,
    keyword,
    notes,
    reportPath,
    req,
  }).catch((e) => console.warn("[auto-scan] notify failed:", (e as Error).message));

  return NextResponse.json(
    { ok: true, reportPath, deduped: false },
    { headers: corsHeaders(req) }
  );
}

async function findExistingScanForEmail(
  email: string
): Promise<{ timestamp: string } | null> {
  const { data } = await supabase()
    .from("leads")
    .select("timestamp")
    .eq("email", email)
    .order("timestamp", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (!data) return null;
  // Confirm a scan row actually exists for this lead. If the lead got
  // saved without its scan (rare — see save order above), we want to
  // re-run rather than send them to a 404.
  const { data: scanRow } = await supabase()
    .from("scans")
    .select("timestamp")
    .eq("timestamp", data.timestamp)
    .maybeSingle();
  if (!scanRow) return null;
  return { timestamp: data.timestamp };
}

async function resolveBusiness(businessName: string): Promise<TargetBusiness> {
  // Bias to Grayson County center with a generous radius so the search
  // reaches any business in the county. We need ratings here? No — the
  // picker UI uses ratings to disambiguate, but auto-scan trusts the top
  // hit. Keep this on Essentials tier to save the Enterprise call.
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

async function notifyOnSuccess(args: {
  timestamp: string;
  businessName: string;
  email: string;
  phone?: string;
  keyword: string;
  notes?: string;
  reportPath: string;
  req: NextRequest;
}) {
  const apiKey = process.env.RESEND_API_KEY;
  const to = process.env.LEADS_NOTIFY_EMAIL;
  const from = process.env.LEADS_FROM_EMAIL;
  if (!apiKey || !to || !from) return;

  const origin = args.req.headers.get("origin") || `https://${args.req.headers.get("host") || ""}`;
  const reportUrl = `${origin}${args.reportPath}`;
  const subject = `New auto-audit completed — ${args.businessName}`;
  const html = `
    <div style="font-family:system-ui,sans-serif;line-height:1.5;color:#14161a">
      <h2 style="margin:0 0 12px">New audit ran automatically</h2>
      <p style="margin:0 0 18px;color:#6a655a">${new Date(args.timestamp).toLocaleString()}</p>
      <table style="border-collapse:collapse;font-size:14px">
        <tr><td style="padding:4px 14px 4px 0;color:#6a655a;vertical-align:top">Business</td><td style="padding:4px 0"><strong>${escapeHtml(args.businessName)}</strong></td></tr>
        <tr><td style="padding:4px 14px 4px 0;color:#6a655a;vertical-align:top">Email</td><td style="padding:4px 0"><a href="mailto:${encodeURIComponent(args.email)}">${escapeHtml(args.email)}</a></td></tr>
        ${args.phone ? `<tr><td style="padding:4px 14px 4px 0;color:#6a655a;vertical-align:top">Phone</td><td style="padding:4px 0">${escapeHtml(args.phone)}</td></tr>` : ""}
        <tr><td style="padding:4px 14px 4px 0;color:#6a655a;vertical-align:top">Keyword</td><td style="padding:4px 0">${escapeHtml(args.keyword)}</td></tr>
        ${args.notes ? `<tr><td style="padding:4px 14px 4px 0;color:#6a655a;vertical-align:top">Notes</td><td style="padding:4px 0;white-space:pre-wrap">${escapeHtml(args.notes)}</td></tr>` : ""}
        <tr><td style="padding:4px 14px 4px 0;color:#6a655a;vertical-align:top">Report</td><td style="padding:4px 0"><a href="${reportUrl}">${reportUrl}</a></td></tr>
      </table>
    </div>
  `;
  await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      from,
      to,
      reply_to: args.email,
      subject,
      html,
    }),
  });
}

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!
  );
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

function budgetError(req: NextRequest) {
  return jsonError(
    req,
    503,
    "Free audits are paused until next month. Email kara@studio925.design and we'll get yours done manually.",
    "budget_exceeded"
  );
}

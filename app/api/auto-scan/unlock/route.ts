import { NextRequest, NextResponse } from "next/server";
import { corsHeaders, preflight, rejectDisallowedOrigin } from "@/lib/cors";
import { supabase } from "@/lib/supabase";
import { checkEmail } from "@/lib/email-check";
import type { Scan } from "@/lib/types";

// Unlocks the gated report page for a given scan timestamp. The visitor
// already saw the heatmap teaser; the full report (rivals, score,
// recommendation) only renders once `scans.unlocked_at` is set, which
// happens here.
//
// This is also where we capture the lead. business_name and keyword come
// from the scan payload — we don't trust the client to resend them — and
// the email/name are validated and normalized before insert.

const MAX_EMAIL = 254;
const MAX_NAME = 100;

type UnlockBody = {
  timestamp?: string;
  email?: string;
  name?: string;
};

export function OPTIONS(req: NextRequest) {
  return preflight(req);
}

export async function POST(req: NextRequest) {
  const blocked = rejectDisallowedOrigin(req);
  if (blocked) return blocked;

  let body: UnlockBody;
  try {
    body = await req.json();
  } catch {
    return jsonError(req, 400, "Invalid body");
  }

  const timestamp = (body.timestamp || "").trim();
  const rawEmail = (body.email || "").trim().toLowerCase().slice(0, MAX_EMAIL);
  const name = body.name?.trim().slice(0, MAX_NAME) || undefined;

  if (!timestamp) return jsonError(req, 400, "Missing scan timestamp.");
  if (!rawEmail) return jsonError(req, 400, "Email is required.");
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(rawEmail)) {
    return jsonError(req, 400, "Invalid email.");
  }

  // Disposable / dead-domain check + Gmail dot/plus normalization. Same
  // bar as the old form-time check, just moved to the unlock moment.
  const emailCheck = await checkEmail(rawEmail);
  if (!emailCheck.ok) return jsonError(req, 400, emailCheck.reason);
  const email = emailCheck.normalized;

  const { data: scanRow, error: scanReadErr } = await supabase()
    .from("scans")
    .select("timestamp, payload, unlocked_at, ip")
    .eq("timestamp", timestamp)
    .maybeSingle();

  if (scanReadErr) {
    console.error("[unlock] scan read failed:", scanReadErr);
    return jsonError(req, 500, "Couldn't load that report.");
  }
  if (!scanRow) return jsonError(req, 404, "Report not found.");

  // Idempotent: if already unlocked, just confirm so the client refreshes
  // into the full report. Don't insert a duplicate lead row.
  if (scanRow.unlocked_at) {
    return NextResponse.json(
      { ok: true, already: true },
      { headers: corsHeaders(req) }
    );
  }

  const scan = scanRow.payload as Scan;
  const ip =
    req.headers.get("x-forwarded-for")?.split(",")[0].trim() ||
    req.headers.get("x-real-ip") ||
    scanRow.ip ||
    null;

  const { error: leadErr } = await supabase().from("leads").insert({
    timestamp,
    business_name: scan.target?.name ?? "(unknown)",
    email,
    name: name ?? null,
    phone: null,
    keyword: scan.keyword ?? null,
    notes: null,
    status: "scanned",
    ip,
  });
  if (leadErr) {
    // Unique-constraint failure on (timestamp) means the lead already
    // exists. Treat it as success — unlock is the goal, not the insert.
    if (!isUniqueViolation(leadErr)) {
      console.error("[unlock] lead insert failed:", leadErr);
      return jsonError(req, 500, "Couldn't save your email. Try again.");
    }
  }

  const { error: updateErr } = await supabase()
    .from("scans")
    .update({ unlocked_at: new Date().toISOString() })
    .eq("timestamp", timestamp);
  if (updateErr) {
    console.error("[unlock] scan unlock update failed:", updateErr);
    return jsonError(req, 500, "Couldn't unlock the report.");
  }

  // Fire-and-forget notification email to Kara. Same shape as the old
  // post-scan email, just triggered at unlock time now.
  notifyUnlock({
    timestamp,
    businessName: scan.target?.name ?? "(unknown)",
    email,
    name,
    keyword: scan.keyword ?? "",
    req,
  }).catch((e) =>
    console.warn("[unlock] notify failed:", (e as Error).message)
  );

  return NextResponse.json(
    { ok: true, already: false },
    { headers: corsHeaders(req) }
  );
}

function isUniqueViolation(err: { code?: string }): boolean {
  return err?.code === "23505";
}

async function notifyUnlock(args: {
  timestamp: string;
  businessName: string;
  email: string;
  name?: string;
  keyword: string;
  req: NextRequest;
}) {
  const apiKey = process.env.RESEND_API_KEY;
  const to = process.env.LEADS_NOTIFY_EMAIL;
  const from = process.env.LEADS_FROM_EMAIL;
  if (!apiKey || !to || !from) return;

  const origin =
    args.req.headers.get("origin") ||
    `https://${args.req.headers.get("host") || ""}`;
  const reportUrl = `${origin}/report/${encodeURIComponent(args.timestamp)}`;
  const subject = `New audit unlocked — ${args.businessName}`;
  const html = `
    <div style="font-family:system-ui,sans-serif;line-height:1.5;color:#14161a">
      <h2 style="margin:0 0 12px">New audit unlocked</h2>
      <p style="margin:0 0 18px;color:#6a655a">${new Date(args.timestamp).toLocaleString()}</p>
      <table style="border-collapse:collapse;font-size:14px">
        <tr><td style="padding:4px 14px 4px 0;color:#6a655a;vertical-align:top">Business</td><td style="padding:4px 0"><strong>${escapeHtml(args.businessName)}</strong></td></tr>
        ${args.name ? `<tr><td style="padding:4px 14px 4px 0;color:#6a655a;vertical-align:top">Name</td><td style="padding:4px 0">${escapeHtml(args.name)}</td></tr>` : ""}
        <tr><td style="padding:4px 14px 4px 0;color:#6a655a;vertical-align:top">Email</td><td style="padding:4px 0"><a href="mailto:${encodeURIComponent(args.email)}">${escapeHtml(args.email)}</a></td></tr>
        <tr><td style="padding:4px 14px 4px 0;color:#6a655a;vertical-align:top">Keyword</td><td style="padding:4px 0">${escapeHtml(args.keyword)}</td></tr>
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

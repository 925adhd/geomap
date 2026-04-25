import { NextRequest, NextResponse } from "next/server";
import fs from "fs/promises";
import path from "path";
import { requireAdmin } from "@/lib/auth";
import { corsHeaders, preflight, rejectDisallowedOrigin } from "@/lib/cors";

const DATA_DIR = path.join(process.cwd(), "data");
const LEADS_FILE = path.join(DATA_DIR, "leads.json");

// Rate limits (defense against bots once this endpoint is public).
// Per-email: blocks repeat submissions within the window so we don't
// re-trigger a scan or re-email Kara for the same lead.
// Per-IP: blunts a single bot rotating fake emails from one network.
// If reading the leads file fails (read-only FS, corrupted JSON), we
// let the request through and rely on the budget cap in /api/places.
const EMAIL_DEDUP_WINDOW_MS = 30 * 24 * 60 * 60 * 1000;
const IP_DAILY_WINDOW_MS = 24 * 60 * 60 * 1000;
const IP_DAILY_LIMIT = 3;

// Length caps on free-text fields. Bots love submitting megabyte payloads
// to fill disks or run up Resend bills — keep everything bounded.
const MAX_BUSINESS = 200;
const MAX_EMAIL = 254;
const MAX_PHONE = 40;
const MAX_KEYWORD = 200;
const MAX_NOTES = 1000;

type Lead = {
  timestamp: string;
  businessName: string;
  email: string;
  phone?: string;
  keyword?: string;
  notes?: string;
  status: "new" | "contacted" | "scanned" | "closed";
  ip?: string;
};

async function readLeads(): Promise<Lead[]> {
  try {
    const contents = await fs.readFile(LEADS_FILE, "utf-8");
    return JSON.parse(contents) as Lead[];
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code === "ENOENT") return [];
    throw e;
  }
}

async function writeLeads(leads: Lead[]) {
  await fs.mkdir(DATA_DIR, { recursive: true });
  await fs.writeFile(LEADS_FILE, JSON.stringify(leads, null, 2), "utf-8");
}

async function emailLead(lead: Lead) {
  const apiKey = process.env.RESEND_API_KEY;
  const to = process.env.LEADS_NOTIFY_EMAIL;
  const from = process.env.LEADS_FROM_EMAIL;
  if (!apiKey || !to || !from) return { sent: false, reason: "not configured" };

  const subject = `New audit request — ${lead.businessName}`;
  const html = `
    <div style="font-family:system-ui,sans-serif;line-height:1.5;color:#14161a">
      <h2 style="margin:0 0 12px">New free audit request</h2>
      <p style="margin:0 0 18px;color:#6a655a">${new Date(lead.timestamp).toLocaleString()}</p>
      <table style="border-collapse:collapse;font-size:14px">
        <tr><td style="padding:4px 14px 4px 0;color:#6a655a;vertical-align:top">Business</td><td style="padding:4px 0"><strong>${escapeHtml(lead.businessName)}</strong></td></tr>
        <tr><td style="padding:4px 14px 4px 0;color:#6a655a;vertical-align:top">Email</td><td style="padding:4px 0"><a href="mailto:${encodeURIComponent(lead.email)}">${escapeHtml(lead.email)}</a></td></tr>
        ${lead.phone ? `<tr><td style="padding:4px 14px 4px 0;color:#6a655a;vertical-align:top">Phone</td><td style="padding:4px 0">${escapeHtml(lead.phone)}</td></tr>` : ""}
        ${lead.keyword ? `<tr><td style="padding:4px 14px 4px 0;color:#6a655a;vertical-align:top">Keyword</td><td style="padding:4px 0">${escapeHtml(lead.keyword)}</td></tr>` : ""}
        ${lead.notes ? `<tr><td style="padding:4px 14px 4px 0;color:#6a655a;vertical-align:top">Notes</td><td style="padding:4px 0;white-space:pre-wrap">${escapeHtml(lead.notes)}</td></tr>` : ""}
      </table>
    </div>
  `;

  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      from,
      to,
      reply_to: lead.email,
      subject,
      html,
    }),
  });
  if (!res.ok) {
    const body = await res.text();
    return { sent: false, reason: `Resend ${res.status}: ${body}` };
  }
  return { sent: true };
}

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!
  );
}

export function OPTIONS(req: NextRequest) {
  return preflight(req);
}

export async function GET(req: NextRequest) {
  const denied = requireAdmin(req);
  if (denied) return denied;
  const leads = await readLeads().catch(() => []);
  return NextResponse.json({ leads }, { headers: corsHeaders(req) });
}

export async function POST(req: NextRequest) {
  const blocked = rejectDisallowedOrigin(req);
  if (blocked) return blocked;

  let body: Partial<Lead> & { honeypot?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json(
      { error: "Invalid body" },
      { status: 400, headers: corsHeaders(req) }
    );
  }

  if (body.honeypot) {
    return NextResponse.json({ ok: true }, { headers: corsHeaders(req) });
  }

  const businessName = (body.businessName || "").trim().slice(0, MAX_BUSINESS);
  const email = (body.email || "").trim().toLowerCase().slice(0, MAX_EMAIL);
  const phone = body.phone?.trim().slice(0, MAX_PHONE) || undefined;
  const keyword = body.keyword?.trim().slice(0, MAX_KEYWORD) || undefined;
  const notes = body.notes?.trim().slice(0, MAX_NOTES) || undefined;

  if (!businessName || !email) {
    return NextResponse.json(
      { error: "Business name and email are required" },
      { status: 400, headers: corsHeaders(req) }
    );
  }
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return NextResponse.json(
      { error: "Invalid email" },
      { status: 400, headers: corsHeaders(req) }
    );
  }

  const ip =
    req.headers.get("x-forwarded-for")?.split(",")[0].trim() ||
    req.headers.get("x-real-ip") ||
    undefined;

  // Rate limits run BEFORE we email Kara or burn any spend. If reading
  // the leads file fails (cold start, read-only FS, corrupt JSON), let
  // the request through — the budget cap in /api/places is the second guard.
  const existingLeads = await readLeads().catch(() => null);
  if (existingLeads) {
    const dupByEmail = existingLeads.find(
      (l) =>
        l.email === email &&
        Date.now() - new Date(l.timestamp).getTime() < EMAIL_DEDUP_WINDOW_MS
    );
    if (dupByEmail) {
      return NextResponse.json(
        {
          error:
            "We already have a recent audit request for this email. Check your inbox, or message kara@studio925.design if it didn't arrive.",
          code: "duplicate_email",
        },
        { status: 429, headers: corsHeaders(req) }
      );
    }
    if (ip) {
      const sameIpToday = existingLeads.filter(
        (l) =>
          l.ip === ip &&
          Date.now() - new Date(l.timestamp).getTime() < IP_DAILY_WINDOW_MS
      );
      if (sameIpToday.length >= IP_DAILY_LIMIT) {
        return NextResponse.json(
          {
            error:
              "Too many requests from your network today. Please try again tomorrow.",
            code: "rate_limit_ip",
          },
          { status: 429, headers: corsHeaders(req) }
        );
      }
    }
  }

  const newLead: Lead = {
    timestamp: new Date().toISOString(),
    businessName,
    email,
    phone,
    keyword,
    notes,
    status: "new",
    ip,
  };

  const emailResult = await emailLead(newLead).catch((e) => ({
    sent: false,
    reason: (e as Error).message,
  }));

  if (existingLeads) {
    try {
      existingLeads.unshift(newLead);
      existingLeads.splice(2000);
      await writeLeads(existingLeads);
    } catch {
      // serverless FS might be read-only — that's fine if email went out
    }
  }

  if (!emailResult.sent && process.env.RESEND_API_KEY) {
    console.error("[leads] email failed:", emailResult.reason);
  }

  return NextResponse.json(
    { ok: true, emailed: emailResult.sent },
    { headers: corsHeaders(req) }
  );
}

export async function DELETE(req: NextRequest) {
  const denied = requireAdmin(req);
  if (denied) return denied;

  const timestamp = new URL(req.url).searchParams.get("timestamp");
  if (!timestamp) {
    return NextResponse.json(
      { error: "timestamp required" },
      { status: 400, headers: corsHeaders(req) }
    );
  }
  try {
    const leads = await readLeads();
    const filtered = leads.filter((l) => l.timestamp !== timestamp);
    await writeLeads(filtered);
    return NextResponse.json(
      { ok: true, count: filtered.length },
      { headers: corsHeaders(req) }
    );
  } catch {
    return NextResponse.json(
      { ok: true, count: 0 },
      { headers: corsHeaders(req) }
    );
  }
}

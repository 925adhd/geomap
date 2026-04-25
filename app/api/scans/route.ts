import { NextRequest, NextResponse } from "next/server";
import type { Scan } from "@/lib/types";
import { requireAdmin } from "@/lib/auth";
import { supabase } from "@/lib/supabase";
import { costForCalls } from "@/lib/usage";

type SaveBody =
  | Scan
  | {
      scan: Scan;
      essentialsCalls?: number;
      enterpriseCalls?: number;
    };

function unwrap(body: SaveBody): {
  scan: Scan;
  essentialsCalls: number;
  enterpriseCalls: number;
} {
  if ("scan" in body && body.scan) {
    return {
      scan: body.scan,
      essentialsCalls: Math.max(0, Math.floor(body.essentialsCalls ?? 0)),
      enterpriseCalls: Math.max(0, Math.floor(body.enterpriseCalls ?? 0)),
    };
  }
  // Legacy shape: bare Scan in the body. Cost columns get 0.
  return { scan: body as Scan, essentialsCalls: 0, enterpriseCalls: 0 };
}

// All scan-store endpoints are admin-only. The public /report/[timestamp]
// page reads from Supabase directly server-side (see app/report/[timestamp]/
// page.tsx), so locking down /api/scans doesn't break public report links.
export async function GET(req: NextRequest) {
  const denied = requireAdmin(req);
  if (denied) return denied;
  const { data, error } = await supabase()
    .from("scans")
    .select("payload")
    .order("timestamp", { ascending: false })
    .limit(500);
  if (error) {
    console.error("[scans] GET failed:", error);
    return NextResponse.json({ scans: [] });
  }
  const scans = (data as { payload: Scan }[]).map((r) => r.payload);
  return NextResponse.json({ scans });
}

export async function POST(req: NextRequest) {
  const denied = requireAdmin(req);
  if (denied) return denied;

  const body = (await req.json()) as SaveBody;
  const { scan, essentialsCalls, enterpriseCalls } = unwrap(body);
  if (!scan?.timestamp || !scan?.target?.placeId) {
    return NextResponse.json({ error: "Invalid scan payload" }, { status: 400 });
  }
  const estimatedCostUsd = costForCalls(essentialsCalls, enterpriseCalls);
  const { error } = await supabase().from("scans").upsert(
    {
      timestamp: scan.timestamp,
      payload: scan,
      essentials_calls: essentialsCalls,
      enterprise_calls: enterpriseCalls,
      estimated_cost_usd: estimatedCostUsd,
    },
    { onConflict: "timestamp" }
  );
  if (error) {
    console.error("[scans] POST failed:", error);
    return NextResponse.json({ error: "Save failed" }, { status: 500 });
  }
  return NextResponse.json({ ok: true });
}

export async function DELETE(req: NextRequest) {
  const denied = requireAdmin(req);
  if (denied) return denied;

  const timestamp = new URL(req.url).searchParams.get("timestamp");
  if (!timestamp) {
    return NextResponse.json({ error: "timestamp required" }, { status: 400 });
  }
  const { error } = await supabase().from("scans").delete().eq("timestamp", timestamp);
  if (error) {
    console.error("[scans] DELETE failed:", error);
  }
  return NextResponse.json({ ok: true });
}

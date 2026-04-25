import { NextRequest, NextResponse } from "next/server";
import fs from "fs/promises";
import path from "path";
import type { Scan } from "@/lib/types";
import { requireAdmin } from "@/lib/auth";

const DATA_DIR = path.join(process.cwd(), "data");
const SCANS_FILE = path.join(DATA_DIR, "scans.json");

async function readScans(): Promise<Scan[]> {
  try {
    const contents = await fs.readFile(SCANS_FILE, "utf-8");
    const parsed = JSON.parse(contents);
    return Array.isArray(parsed) ? parsed : [];
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code === "ENOENT") return [];
    throw e;
  }
}

async function writeScans(scans: Scan[]) {
  await fs.mkdir(DATA_DIR, { recursive: true });
  await fs.writeFile(SCANS_FILE, JSON.stringify(scans, null, 2), "utf-8");
}

// All scan-store endpoints are admin-only. The public /report/[timestamp]
// page reads scans.json directly server-side (see app/report/[timestamp]/
// page.tsx), so locking down /api/scans doesn't break public report links.
export async function GET(req: NextRequest) {
  const denied = requireAdmin(req);
  if (denied) return denied;
  const scans = await readScans();
  return NextResponse.json({ scans });
}

export async function POST(req: NextRequest) {
  const denied = requireAdmin(req);
  if (denied) return denied;

  const scan = (await req.json()) as Scan;
  if (!scan?.timestamp || !scan?.target?.placeId) {
    return NextResponse.json({ error: "Invalid scan payload" }, { status: 400 });
  }
  const scans = await readScans();
  const deduped = scans.filter((s) => s.timestamp !== scan.timestamp);
  deduped.unshift(scan);
  deduped.splice(500);
  await writeScans(deduped);
  return NextResponse.json({ ok: true, count: deduped.length });
}

export async function DELETE(req: NextRequest) {
  const denied = requireAdmin(req);
  if (denied) return denied;

  const timestamp = new URL(req.url).searchParams.get("timestamp");
  if (!timestamp) {
    return NextResponse.json({ error: "timestamp required" }, { status: 400 });
  }
  const scans = await readScans();
  const filtered = scans.filter((s) => s.timestamp !== timestamp);
  await writeScans(filtered);
  return NextResponse.json({ ok: true, count: filtered.length });
}

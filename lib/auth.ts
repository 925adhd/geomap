import { NextRequest, NextResponse } from "next/server";
import { timingSafeEqual } from "node:crypto";

// Admin auth for routes that mutate the lead/scan stores or expose the
// full lead/scan list. The token is set as ADMIN_TOKEN in the deployment
// environment and provided by the dashboard via an x-admin-token header.
// Public visitors won't have the token in localStorage so admin calls
// fail with 401 — they can still hit the public endpoints (/api/leads
// POST, /api/places POST) as expected.

function safeEqual(a: string, b: string): boolean {
  // timingSafeEqual throws on length mismatch, so guard first. The length
  // check itself is a tiny timing leak (token length), but the secret is
  // 32 random bytes and that length is non-sensitive.
  const ab = Buffer.from(a);
  const bb = Buffer.from(b);
  if (ab.length !== bb.length) return false;
  return timingSafeEqual(ab, bb);
}

export function requireAdmin(req: NextRequest): NextResponse | null {
  const expected = process.env.ADMIN_TOKEN;
  if (!expected) {
    return NextResponse.json(
      { error: "Server is missing ADMIN_TOKEN env var" },
      { status: 500 }
    );
  }
  const supplied = req.headers.get("x-admin-token");
  if (!supplied || !safeEqual(supplied, expected)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  return null;
}

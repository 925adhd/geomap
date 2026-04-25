import { NextRequest, NextResponse } from "next/server";
import { timingSafeEqual } from "node:crypto";

// Admin auth for routes that mutate the lead/scan stores or expose the
// full lead/scan list. In production these routes 404 unconditionally
// (the admin dashboard is dev-only — Kara runs it locally against the
// production Supabase project, so production has no need to expose
// admin endpoints at all). In development, the token is read from
// ADMIN_TOKEN and matched against an x-admin-token header.

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
  // Admin endpoints are dev-only. Kara runs the dashboard locally
  // against the production Supabase project; production deploys never
  // need /api/scans CRUD or /api/leads GET/DELETE. Returning 404 in
  // production removes the entire admin attack surface from the public
  // edge — even with a leaked ADMIN_TOKEN, an attacker hits a 404.
  if (process.env.NODE_ENV === "production") {
    return new NextResponse("Not found", { status: 404 });
  }
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

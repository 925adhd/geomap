import { NextRequest, NextResponse } from "next/server";

// Allow-list of origins permitted to call public POST endpoints
// (/api/leads, /api/places) cross-origin. Same-origin calls from the
// geomap dashboard itself never have an Origin header that needs
// validation here — these guards exist so a third-party site can't
// burn the Google Places budget by hitting /api/places from their page.
const ALLOWED_ORIGINS = new Set<string>([
  "https://studio925.design",
  "https://www.studio925.design",
  "https://geomap.studio925.design",
  "http://localhost:3000",
  "http://localhost:3001",
  "http://localhost:3002",
]);

export function isAllowedOrigin(origin: string | null): boolean {
  if (!origin) return true;
  return ALLOWED_ORIGINS.has(origin);
}

export function corsHeaders(req: NextRequest): Record<string, string> {
  const origin = req.headers.get("origin");
  if (!origin || !ALLOWED_ORIGINS.has(origin)) return {};
  return {
    "Access-Control-Allow-Origin": origin,
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, x-admin-token",
    Vary: "Origin",
  };
}

export function preflight(req: NextRequest): NextResponse {
  return new NextResponse(null, { status: 204, headers: corsHeaders(req) });
}

export function rejectDisallowedOrigin(
  req: NextRequest
): NextResponse | null {
  const origin = req.headers.get("origin");
  if (!origin) return null;
  if (ALLOWED_ORIGINS.has(origin)) return null;
  return NextResponse.json(
    { error: "Origin not allowed" },
    { status: 403 }
  );
}

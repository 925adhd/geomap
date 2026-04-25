import { NextRequest, NextResponse } from "next/server";

// Explicit cross-origin allow-list. Browsers POSTing from these origins
// can call /api/leads + /api/places. Anything else cross-origin is
// rejected so a third-party site can't burn the Google Places budget
// by hitting /api/places from their page.
//
// Same-origin requests (the geomap dashboard calling its own API on
// whatever Vercel domain it's deployed at) are always allowed — see
// isSameOrigin below. That covers geomap-delta.vercel.app, preview
// deploy URLs, geomap.studio925.design once DNS flips, and localhost.
const ALLOWED_ORIGINS = new Set<string>([
  "https://studio925.design",
  "https://www.studio925.design",
]);

function isSameOrigin(req: NextRequest, origin: string): boolean {
  try {
    const o = new URL(origin);
    const host = req.headers.get("host");
    return !!host && o.host === host;
  } catch {
    return false;
  }
}

function isAllowed(req: NextRequest, origin: string | null): boolean {
  if (!origin) return true;
  if (isSameOrigin(req, origin)) return true;
  return ALLOWED_ORIGINS.has(origin);
}

export function corsHeaders(req: NextRequest): Record<string, string> {
  const origin = req.headers.get("origin");
  if (!origin || !isAllowed(req, origin)) return {};
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
  if (isAllowed(req, origin)) return null;
  return NextResponse.json(
    { error: "Origin not allowed" },
    { status: 403 }
  );
}

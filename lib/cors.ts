import { NextRequest, NextResponse } from "next/server";

// Cross-origin allow-list, sourced from env so the trusted domain set
// isn't published in this repo. Format: comma-separated absolute
// origins, e.g. `https://example.com,https://www.example.com`.
// Same-origin requests are always allowed via isSameOrigin below, so
// the env var only needs to list trusted *external* callers.
const ALLOWED_ORIGINS = new Set<string>(
  (process.env.ALLOWED_ORIGINS || "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean)
);

function isSameOrigin(req: NextRequest, origin: string): boolean {
  try {
    const o = new URL(origin);
    const host = req.headers.get("host");
    return !!host && o.host === host;
  } catch {
    return false;
  }
}

// Browsers always send Origin on cross-origin POSTs, so a missing Origin
// on a state-changing request means a non-browser caller (curl, server-side
// script). Reject those — they'd otherwise sail past every CORS-based
// guard. Same-origin browser GETs sometimes omit Origin, but the GET
// endpoints that matter are admin-token-gated separately.
function isAllowed(req: NextRequest, origin: string | null): boolean {
  if (!origin) return false;
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

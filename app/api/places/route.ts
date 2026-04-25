import { NextRequest, NextResponse } from "next/server";
import { corsHeaders, preflight, rejectDisallowedOrigin } from "@/lib/cors";
import { PlacesApiError, PlacesBudgetError, searchPlaces } from "@/lib/places";

// Geofence: this endpoint is for the Grayson County dashboard only.
// Even with the CORS guard tightened, refusing wildly off-area requests
// stops anyone who slips through from using us as a free Places proxy
// for arbitrary worldwide queries. The box covers Grayson + the
// neighboring counties scans actually reach; admin findBusiness uses a
// 30km radius from Grayson center, the auto-scan grid spans ~24km, so
// 60km is generous headroom.
const GEOFENCE = {
  minLat: 36.8,
  maxLat: 38.2,
  minLng: -87.5,
  maxLng: -85.0,
  maxRadiusMeters: 60_000,
};

export function OPTIONS(req: NextRequest) {
  return preflight(req);
}

export async function POST(req: NextRequest) {
  const blocked = rejectDisallowedOrigin(req);
  if (blocked) return blocked;

  let body: {
    textQuery?: string;
    lat?: number;
    lng?: number;
    radius?: number;
    maxResults?: number;
    includeRatings?: boolean;
  };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json(
      { error: "Invalid JSON body" },
      { status: 400, headers: corsHeaders(req) }
    );
  }

  const { textQuery, lat, lng, radius, maxResults, includeRatings } = body;
  if (
    !textQuery ||
    typeof lat !== "number" ||
    typeof lng !== "number" ||
    typeof radius !== "number"
  ) {
    return NextResponse.json(
      { error: "Missing required fields: textQuery, lat, lng, radius" },
      { status: 400, headers: corsHeaders(req) }
    );
  }

  if (
    lat < GEOFENCE.minLat ||
    lat > GEOFENCE.maxLat ||
    lng < GEOFENCE.minLng ||
    lng > GEOFENCE.maxLng ||
    radius <= 0 ||
    radius > GEOFENCE.maxRadiusMeters
  ) {
    return NextResponse.json(
      { error: "Search location out of range" },
      { status: 400, headers: corsHeaders(req) }
    );
  }

  try {
    const places = await searchPlaces({
      textQuery,
      lat,
      lng,
      radius,
      maxResults,
      includeRatings,
    });
    return NextResponse.json({ places }, { headers: corsHeaders(req) });
  } catch (e) {
    if (e instanceof PlacesBudgetError) {
      console.warn("[places] over monthly budget, refusing call");
      return NextResponse.json(
        {
          error:
            "Monthly Places API budget reached. Audits are paused until next month.",
          code: "budget_exceeded",
        },
        { status: 503, headers: corsHeaders(req) }
      );
    }
    if (e instanceof PlacesApiError) {
      return NextResponse.json(
        { error: e.message },
        { status: e.status, headers: corsHeaders(req) }
      );
    }
    console.error("[places] unexpected error:", e);
    return NextResponse.json(
      { error: "Unexpected error" },
      { status: 500, headers: corsHeaders(req) }
    );
  }
}

import { NextRequest, NextResponse } from "next/server";
import { isOverBudget, recordPlacesCall } from "@/lib/usage";
import { corsHeaders, preflight, rejectDisallowedOrigin } from "@/lib/cors";

const PLACES_URL = "https://places.googleapis.com/v1/places:searchText";
// Hard monthly cost cap. Override with PLACES_MONTHLY_BUDGET_USD env var.
// Set to 0 to disable the cap (NOT recommended once exposed publicly).
const MAX_MONTHLY_USD = Number(process.env.PLACES_MONTHLY_BUDGET_USD ?? 25);
// Essentials-tier fields only. Including `rating` or `userRatingCount`
// upgrades the entire request to Enterprise tier ($35/1K, 1K free).
// Pass `includeRatings: true` from the caller to opt into Enterprise pricing
// when the rating data is actually needed (e.g. the business picker UI).
const FIELD_MASK_BASE =
  "places.id,places.displayName,places.formattedAddress,places.location";
const FIELD_MASK_RATINGS = ",places.rating,places.userRatingCount";
// Cap on free-text query length. Real keywords are short ("oil change near
// leitchfield ky" ~32 chars). 200 is generous; longer = junk or attack.
const MAX_QUERY = 200;

export function OPTIONS(req: NextRequest) {
  return preflight(req);
}

export async function POST(req: NextRequest) {
  const blocked = rejectDisallowedOrigin(req);
  if (blocked) return blocked;

  const apiKey = process.env.GOOGLE_PLACES_API_KEY;
  if (!apiKey) {
    return NextResponse.json(
      { error: "GOOGLE_PLACES_API_KEY is not set in .env.local" },
      { status: 500, headers: corsHeaders(req) }
    );
  }

  // Hard cost cap. Refuse calls if estimated month-to-date spend has hit
  // the budget. The counter resets on the first of each UTC month.
  if (await isOverBudget(MAX_MONTHLY_USD).catch(() => false)) {
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

  const { lat, lng, radius, maxResults, includeRatings } = body;
  const textQuery = (body.textQuery || "").trim().slice(0, MAX_QUERY);
  const fieldMask = includeRatings
    ? FIELD_MASK_BASE + FIELD_MASK_RATINGS
    : FIELD_MASK_BASE;
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

  console.log("[places] query:", textQuery, "@", lat, lng, "radius", radius);

  const googleRes = await fetch(PLACES_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Goog-Api-Key": apiKey,
      "X-Goog-FieldMask": fieldMask,
    },
    body: JSON.stringify({
      textQuery,
      locationBias: {
        circle: {
          center: { latitude: lat, longitude: lng },
          radius,
        },
      },
      maxResultCount: Math.min(Math.max(maxResults ?? 20, 1), 20),
    }),
  });

  console.log("[places] google status:", googleRes.status);

  if (!googleRes.ok) {
    let message = `Google API error: HTTP ${googleRes.status}`;
    try {
      const err = await googleRes.json();
      console.log("[places] google error body:", JSON.stringify(err));
      message = err?.error?.message || message;
    } catch {
      /* keep default */
    }
    return NextResponse.json(
      { error: message },
      { status: googleRes.status, headers: corsHeaders(req) }
    );
  }

  const data = await googleRes.json();
  console.log("[places] places returned:", (data.places || []).length);
  // Record usage for the cost cap. Don't block the response on write failure.
  recordPlacesCall(!!includeRatings).catch((e) => {
    console.warn("[places] failed to record usage:", (e as Error).message);
  });
  return NextResponse.json(
    { places: data.places || [] },
    { headers: corsHeaders(req) }
  );
}

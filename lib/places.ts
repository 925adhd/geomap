import type { PlaceResult } from "./types";
import { isOverBudget, recordPlacesCall } from "./usage";

// Server-side Google Places (New) Text Search wrapper. Used by both
// /api/places (called from the browser) and /api/auto-scan (called
// from another server route during the public auto-audit flow).
//
// Both callers need the same guarantees:
//   - hard monthly budget cap before the call
//   - usage recording after a successful call
//   - Essentials vs Enterprise field mask switching
// so the logic lives here once.

const PLACES_URL = "https://places.googleapis.com/v1/places:searchText";
const FIELD_MASK_BASE =
  "places.id,places.displayName,places.formattedAddress,places.location";
const FIELD_MASK_RATINGS = ",places.rating,places.userRatingCount";

const MAX_QUERY = 200;

export class PlacesBudgetError extends Error {
  constructor() {
    super("Monthly Places API budget reached.");
    this.name = "PlacesBudgetError";
  }
}

export class PlacesApiError extends Error {
  status: number;
  constructor(message: string, status: number) {
    super(message);
    this.name = "PlacesApiError";
    this.status = status;
  }
}

export type SearchPlacesArgs = {
  textQuery: string;
  lat: number;
  lng: number;
  radius: number;
  maxResults?: number;
  includeRatings?: boolean;
  /** Pre-checked budget cap (USD). Defaults to PLACES_MONTHLY_BUDGET_USD env. */
  maxMonthlyUsd?: number;
};

export async function searchPlaces(args: SearchPlacesArgs): Promise<PlaceResult[]> {
  const apiKey = process.env.GOOGLE_PLACES_API_KEY;
  if (!apiKey) {
    throw new PlacesApiError("GOOGLE_PLACES_API_KEY is not set", 500);
  }
  const maxUsd = args.maxMonthlyUsd ?? Number(process.env.PLACES_MONTHLY_BUDGET_USD ?? 25);
  // Fail closed: if we can't read usage, assume we're at the cap rather
  // than letting traffic through unaccounted. A transient Supabase outage
  // briefly disables Places calls instead of silently disabling the budget
  // guard — that's the trade-off we want when real money is on the line.
  let overBudget = true;
  try {
    overBudget = await isOverBudget(maxUsd);
  } catch (e) {
    console.error("[places] usage read failed, failing closed:", (e as Error).message);
  }
  if (overBudget) {
    throw new PlacesBudgetError();
  }

  const textQuery = (args.textQuery || "").trim().slice(0, MAX_QUERY);
  if (!textQuery) {
    throw new PlacesApiError("Missing textQuery", 400);
  }

  const fieldMask = args.includeRatings
    ? FIELD_MASK_BASE + FIELD_MASK_RATINGS
    : FIELD_MASK_BASE;

  const res = await fetch(PLACES_URL, {
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
          center: { latitude: args.lat, longitude: args.lng },
          radius: args.radius,
        },
      },
      maxResultCount: Math.min(Math.max(args.maxResults ?? 20, 1), 20),
    }),
  });

  if (!res.ok) {
    let message = `Google API error: HTTP ${res.status}`;
    try {
      const err = await res.json();
      message = err?.error?.message || message;
    } catch {
      /* keep default */
    }
    throw new PlacesApiError(message, res.status);
  }

  const data = await res.json();
  // Don't block on usage write — at worst the cost cap is slightly under-counted.
  recordPlacesCall(!!args.includeRatings).catch((e) => {
    console.warn("[places] failed to record usage:", (e as Error).message);
  });
  return (data.places || []) as PlaceResult[];
}

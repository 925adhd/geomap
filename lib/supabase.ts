import { createClient, type SupabaseClient } from "@supabase/supabase-js";

// Two server-only Supabase clients with different blast radii:
//
//   supabase()       — service_role, bypasses RLS, full read/write on
//                      every table. Used by admin routes and by writes
//                      from /api/auto-scan. Never reaches a browser.
//
//   supabasePublic() — anon role, respects RLS. The only policy in the
//                      project grants SELECT on `scans` to anon, so this
//                      client can read scans and nothing else. Used by
//                      the publicly-reachable /report/[timestamp] page.
//                      Limits the blast radius of any future bug in that
//                      code path to one already-public-by-timestamp table.
//
// Neither client should ever be imported into a "use client" file.

let cached: SupabaseClient | null = null;

export function supabase(): SupabaseClient {
  if (cached) return cached;
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) {
    throw new Error(
      "Supabase env vars missing. Set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY."
    );
  }
  cached = createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  return cached;
}

let cachedPublic: SupabaseClient | null = null;

export function supabasePublic(): SupabaseClient {
  if (cachedPublic) return cachedPublic;
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_ANON_KEY;
  if (!url || !key) {
    throw new Error(
      "Supabase env vars missing. Set SUPABASE_URL and SUPABASE_ANON_KEY."
    );
  }
  cachedPublic = createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  return cachedPublic;
}

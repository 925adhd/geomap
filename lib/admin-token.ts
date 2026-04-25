"use client";

// Client-side helper for the geomap dashboard. Reads the admin token
// from localStorage so admin fetches can include it as an x-admin-token
// header. First-time setup: visit /?adminToken=xxx — this captures the
// token, persists it to localStorage, and strips the param from the URL.
// After that, the bare URL works as a bookmark.

const KEY = "geomapAdminToken";

export function getAdminToken(): string | null {
  if (typeof window === "undefined") return null;
  try {
    const url = new URL(window.location.href);
    const fromUrl = url.searchParams.get("adminToken");
    if (fromUrl) {
      localStorage.setItem(KEY, fromUrl);
      url.searchParams.delete("adminToken");
      window.history.replaceState({}, "", url.toString());
      return fromUrl;
    }
    return localStorage.getItem(KEY);
  } catch {
    return null;
  }
}

export function adminHeaders(): Record<string, string> {
  const t = getAdminToken();
  return t ? { "x-admin-token": t } : {};
}

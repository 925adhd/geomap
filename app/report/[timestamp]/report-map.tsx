"use client";

import { useEffect, useRef } from "react";
import type * as LeafletNS from "leaflet";
import type { ScanPoint } from "@/lib/types";
import graysonGeometry from "@/lib/grayson-geometry.json";

type Props = {
  points: ScanPoint[];
  target: {
    name: string;
    location?: { latitude: number; longitude: number } | null;
  };
  bounds: { minLat: number; maxLat: number; minLng: number; maxLng: number };
};

function pinColor(p: ScanPoint): string {
  if (p.error) return "#8a8a8a";
  if (p.rank === null) return "#9a0f0f";
  if (p.rank <= 3) return "#1a5d2f";
  if (p.rank <= 10) return "#d4a017";
  return "#c96a12";
}

function buildTooltip(p: ScanPoint, targetName: string): string {
  if (p.error) {
    return `<strong>Scan failed</strong><br/><span class="rp-tt-muted">${esc(p.error)}</span>`;
  }
  const rankLine =
    p.rank === null
      ? `<strong>${esc(targetName)}</strong> not in top 20 here`
      : `<strong>${esc(targetName)}</strong> ranks <strong>#${p.rank}</strong> here`;
  const topLine = p.topResult
    ? `<div class="rp-tt-row"><span class="rp-tt-label">Top result</span> ${esc(p.topResult)}</div>`
    : "";
  const top3Line =
    p.topThree && p.topThree.length > 0
      ? `<div class="rp-tt-row"><span class="rp-tt-label">Top 3</span> ${p.topThree
          .map((n) => esc(n))
          .join(" · ")}</div>`
      : "";
  return `<div class="rp-tt"><div class="rp-tt-rank">${rankLine}</div>${topLine}${top3Line}</div>`;
}

function esc(s: string): string {
  return String(s).replace(
    /[&<>"']/g,
    (c) =>
      ({
        "&": "&amp;",
        "<": "&lt;",
        ">": "&gt;",
        '"': "&quot;",
        "'": "&#39;",
      })[c]!
  );
}

export function ReportMap({ points, target, bounds }: Props) {
  const el = useRef<HTMLDivElement>(null);
  const mapRef = useRef<LeafletNS.Map | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const L = await import("leaflet");
      if (cancelled || !el.current) return;

      const map = L.map(el.current, {
        zoomControl: false,
        scrollWheelZoom: false,
        dragging: false,
        doubleClickZoom: false,
        touchZoom: false,
        boxZoom: false,
        keyboard: false,
        attributionControl: true,
      });
      mapRef.current = map;

      L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
        attribution: "© OpenStreetMap contributors",
        maxZoom: 19,
      }).addTo(map);

      L.geoJSON(graysonGeometry as GeoJSON.GeometryObject, {
        style: {
          color: "#3b82f6",
          weight: 2,
          opacity: 0.8,
          fillColor: "#3b82f6",
          fillOpacity: 0.06,
        },
      }).addTo(map);

      map.fitBounds(
        [
          [bounds.minLat, bounds.minLng],
          [bounds.maxLat, bounds.maxLng],
        ],
        { padding: [8, 8] }
      );

      for (const p of points) {
        const color = pinColor(p);
        const label = p.error ? "!" : p.rank === null ? "20+" : String(p.rank);
        const marker = L.marker([p.lat, p.lng], {
          icon: L.divIcon({
            className: "rp-pin",
            html: `<div class="rp-pin-inner" style="background:${color}">${esc(label)}</div>`,
            iconSize: [30, 30],
            iconAnchor: [15, 15],
          }),
          // interactive=true so the tooltip fires on hover. The map itself
          // stays locked (no drag/zoom) — only the pins respond.
          interactive: true,
        }).addTo(map);
        marker.bindTooltip(buildTooltip(p, target.name), {
          direction: "top",
          offset: [0, -8],
          className: "rp-pin-tooltip no-print",
          opacity: 1,
        });
      }

      if (target.location) {
        L.marker([target.location.latitude, target.location.longitude], {
          icon: L.divIcon({
            className: "rp-target",
            html: `<svg viewBox="0 0 60 60" width="60" height="60" aria-hidden="true"><circle cx="30" cy="30" r="23" fill="none" stroke="white" stroke-width="5"/><circle cx="30" cy="30" r="23" fill="none" stroke="#1e3a5f" stroke-width="2.5"/><line x1="1" y1="30" x2="11" y2="30" stroke="#1e3a5f" stroke-width="2.5" stroke-linecap="round"/><line x1="49" y1="30" x2="59" y2="30" stroke="#1e3a5f" stroke-width="2.5" stroke-linecap="round"/><line x1="30" y1="1" x2="30" y2="11" stroke="#1e3a5f" stroke-width="2.5" stroke-linecap="round"/><line x1="30" y1="49" x2="30" y2="59" stroke="#1e3a5f" stroke-width="2.5" stroke-linecap="round"/></svg>`,
            iconSize: [60, 60],
            iconAnchor: [30, 30],
          }),
          interactive: false,
          zIndexOffset: 1000,
        }).addTo(map);
      }
    })();
    return () => {
      cancelled = true;
      mapRef.current?.remove();
      mapRef.current = null;
    };
  }, [points, target, bounds]);

  return <div ref={el} className="rp-realmap" />;
}

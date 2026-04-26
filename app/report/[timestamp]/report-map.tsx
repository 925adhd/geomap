"use client";

import { useEffect, useRef, useState } from "react";
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

// Pin number on the map already shows the owner where they rank, so the
// tooltip just needs to show who's actually winning #1/#2/#3 at that
// point. If the owner *is* in top 3 we mark that row "(you)" so they
// can pick out their own listing in the rivals list.
function buildTooltip(p: ScanPoint, targetName: string): string {
  if (p.error) {
    return `<span class="rp-tt-muted">Scan failed: ${esc(p.error)}</span>`;
  }
  const top3 = p.topThree ?? [];
  if (top3.length === 0) {
    return `<span class="rp-tt-muted">No top results captured here.</span>`;
  }
  const items = top3
    .map((name, i) => {
      const isYou = isSameBusiness(name, targetName);
      const cls = isYou ? ' class="is-you"' : "";
      const youTag = isYou
        ? ` <span class="rp-tt-you-tag">You</span>`
        : "";
      return `<li${cls}><span class="rp-tt-rk">${i + 1}</span><span class="rp-tt-nm">${esc(name)}${youTag}</span></li>`;
    })
    .join("");
  return `<ol class="rp-tt-list">${items}</ol>`;
}

function isSameBusiness(a: string, b: string): boolean {
  const norm = (s: string) =>
    s.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
  return norm(a) === norm(b);
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
  const [selected, setSelected] = useState<ScanPoint | null>(null);

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
        // In-map tooltip — fine on desktop hover. Hidden via CSS on
        // mobile because the leaflet-container clips at the map edges,
        // so edge pins lose half the tooltip. Mobile users get the
        // detail card below the map instead (driven by marker click).
        marker.bindTooltip(buildTooltip(p, target.name), {
          direction: "auto",
          offset: [0, -8],
          className: "rp-pin-tooltip no-print",
          opacity: 1,
        });
        marker.on("click", () => setSelected(p));
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

  // Compute the aspect ratio of the actual map bounds (with longitude
  // shrunk by cos(lat) so it matches projected meters, not raw degrees).
  // Setting this on the container means Leaflet's fit-bounds renders
  // tiles edge-to-edge — no empty space below the map for the leaflet
  // container's dark-navy background to bleed through in print.
  const avgLat = (bounds.minLat + bounds.maxLat) / 2;
  const lngScale = Math.cos((avgLat * Math.PI) / 180);
  const widthDeg = (bounds.maxLng - bounds.minLng) * lngScale;
  const heightDeg = bounds.maxLat - bounds.minLat;
  const aspect =
    heightDeg > 0 && widthDeg > 0 ? widthDeg / heightDeg : 4 / 3;

  return (
    <>
      <div
        ref={el}
        className="rp-realmap"
        style={{ aspectRatio: `${aspect.toFixed(3)}` }}
      />
      <PinDetail point={selected} targetName={target.name} />
    </>
  );
}

function PinDetail({
  point,
  targetName,
}: {
  point: ScanPoint | null;
  targetName: string;
}) {
  if (!point) {
    return (
      <div className="rp-pin-detail rp-pin-detail--empty no-print">
        Tap any pin to see who&rsquo;s ranking #1 there.
      </div>
    );
  }
  if (point.error) {
    return (
      <div className="rp-pin-detail no-print">
        <span className="rp-pin-detail-muted">
          Scan failed: {point.error}
        </span>
      </div>
    );
  }
  const top3 = point.topThree ?? [];
  if (top3.length === 0) {
    return (
      <div className="rp-pin-detail no-print">
        <span className="rp-pin-detail-muted">
          No top results captured here.
        </span>
      </div>
    );
  }
  return (
    <ol className="rp-pin-detail rp-pin-detail-list no-print">
      {top3.map((name, i) => {
        const isYou = isSameBusiness(name, targetName);
        return (
          <li key={i} className={isYou ? "is-you" : undefined}>
            <span className="rp-pin-detail-rk">{i + 1}</span>
            <span className="rp-pin-detail-nm">
              {name}
              {isYou && <span className="rp-pin-detail-you"> You</span>}
            </span>
          </li>
        );
      })}
    </ol>
  );
}

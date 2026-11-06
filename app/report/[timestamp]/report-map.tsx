"use client";

import { useEffect, useRef, useState } from "react";
import type * as LeafletNS from "leaflet";
import type { ScanPoint } from "@/lib/types";
import graysonGeometry from "@/lib/grayson-geometry.json";
import { mapsLink } from "@/lib/maps-link";

type Props = {
  points: ScanPoint[];
  target: {
    name: string;
    location?: { latitude: number; longitude: number } | null;
  };
  bounds: { minLat: number; maxLat: number; minLng: number; maxLng: number };
  /** Locked state suppresses everything that exposes rival names: tooltip on
   *  hover, click-to-detail card. The rank pin numbers themselves stay
   *  visible — that's the teaser. */
  locked?: boolean;
  /** Scan area, added to Google Maps links so the right business opens. */
  area?: string;
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
function buildTooltip(
  p: ScanPoint,
  targetName: string,
  area?: string
): string {
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
      const label = isYou
        ? esc(name)
        : `<a class="rp-tt-link" href="${esc(mapsLink(name, area))}" target="_blank" rel="noopener noreferrer">${esc(name)} <span aria-hidden="true">↗</span></a>`;
      return `<li${cls}><span class="rp-tt-rk">${i + 1}</span><span class="rp-tt-nm">${label}${youTag}</span></li>`;
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

export function ReportMap({
  points,
  target,
  bounds,
  locked = false,
  area,
}: Props) {
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

      // Shrink pins to fit the gap between scan points, so dense grids on
      // small screens don't pile up. 30px max (desktop), 16px min.
      const sizePins = () => {
        if (!el.current) return;
        const px = points.map((pt) => map.latLngToContainerPoint([pt.lat, pt.lng]));
        let gap = Infinity;
        for (let i = 0; i < px.length; i++) {
          for (let j = i + 1; j < px.length; j++) {
            const d = px[i].distanceTo(px[j]);
            if (d > 1 && d < gap) gap = d;
          }
        }
        const size = Number.isFinite(gap)
          ? Math.max(16, Math.min(30, Math.floor(gap - 2)))
          : 30;
        el.current.style.setProperty("--rp-pin", `${size}px`);
      };
      sizePins();
      map.on("resize", sizePins);

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
          // Non-interactive in locked mode so hover/click reveal nothing.
          // In unlocked mode pins stay interactive for the tooltip + click
          // detail card. The map itself is always drag/zoom locked.
          interactive: !locked,
        }).addTo(map);
        if (!locked) {
          // In-map tooltip — fine on desktop hover. Hidden via CSS on
          // mobile because the leaflet-container clips at the map edges,
          // so edge pins lose half the tooltip. Mobile users get the
          // detail card below the map instead (driven by marker click).
          // Desktop hover box is a Leaflet popup, not a tooltip, so the
          // mouse can move into it and click a competitor link. A short
          // close delay bridges the gap between pin and box. Hidden via CSS
          // on mobile, where the card under the map is used instead.
          marker.bindPopup(buildTooltip(p, target.name, area), {
            className: "rp-pin-pop no-print",
            closeButton: false,
            autoPan: false,
            offset: [0, -6],
            maxWidth: 360,
            minWidth: 280,
          });
          let closeTimer: ReturnType<typeof setTimeout> | undefined;
          const keepOpen = () => clearTimeout(closeTimer);
          const closeSoon = () => {
            clearTimeout(closeTimer);
            closeTimer = setTimeout(() => marker.closePopup(), 250);
          };
          marker.on("mouseover", () => {
            keepOpen();
            marker.openPopup();
          });
          marker.on("mouseout", closeSoon);
          marker.on("popupopen", (e) => {
            const node = (e as LeafletNS.PopupEvent).popup.getElement();
            if (!node || node.dataset.hoverBound) return;
            node.dataset.hoverBound = "1";
            node.addEventListener("mouseenter", keepOpen);
            node.addEventListener("mouseleave", closeSoon);
          });
          // bindPopup toggles on click; reopen so a click on desktop
          // doesn't close the hover box. Mobile uses the card below.
          marker.on("click", () => {
            setSelected(p);
            marker.openPopup();
          });
        }
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
  }, [points, target, bounds, locked]);

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
      <div className="rp-realmap-wrap">
        <div
          ref={el}
          className="rp-realmap"
          style={{ aspectRatio: `${aspect.toFixed(3)}` }}
        />
        {/* Brand watermark inside the map container. Survives screenshot
            crops of just the heatmap, which is the most-shared part of
            the report. Top-right so it doesn't fight Leaflet's bottom-right
            OSM attribution. */}
        <a
          href="https://studio925.design"
          target="_blank"
          rel="noopener noreferrer"
          className="rp-map-brand"
          aria-label="Local Geomap by Studio 925"
        >
          <span className="rp-map-brand-tool">Local Geomap</span>
          <span className="rp-map-brand-dot" aria-hidden>·</span>
          <span className="rp-map-brand-domain">studio925.design</span>
        </a>
      </div>
      {!locked && <PinDetail point={selected} targetName={target.name} area={area} />}
    </>
  );
}

function PinDetail({
  point,
  targetName,
  area,
}: {
  point: ScanPoint | null;
  targetName: string;
  area?: string;
}) {
  if (!point) {
    return (
      <div className="rp-pin-detail rp-pin-detail--empty no-print">
        Tap any pin to see who&rsquo;s ranking there, with links to their
        Google profiles.
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
              {isYou ? (
                name
              ) : (
                <a
                  href={mapsLink(name, area)}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="rp-pin-detail-link"
                >
                  {name}
                  <span aria-hidden="true"> ↗</span>
                </a>
              )}
              {isYou && <span className="rp-pin-detail-you"> You</span>}
            </span>
          </li>
        );
      })}
    </ol>
  );
}

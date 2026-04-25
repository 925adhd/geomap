"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import type * as LeafletNS from "leaflet";
import { generateGrid } from "@/lib/grid";
import graysonGeometry from "@/lib/grayson-geometry.json";
import { adminHeaders } from "@/lib/admin-token";
import {
  gridLabel,
  type PlaceResult,
  type TargetBusiness,
  type Scan,
  type ScanPoint,
} from "@/lib/types";

const GRAYSON_CENTER: [number, number] = [37.4789, -86.3408];
const STORAGE = {
  business: "gct_target_business",
};

async function searchPlaces(
  query: string,
  lat: number,
  lng: number,
  radiusMeters: number,
  maxResults: number,
  includeRatings = false
): Promise<PlaceResult[]> {
  const res = await fetch("/api/places", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      textQuery: query,
      lat,
      lng,
      radius: radiusMeters,
      maxResults,
      includeRatings,
    }),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.error || `HTTP ${res.status}`);
  }
  const data = await res.json();
  return data.places || [];
}

function findRank(places: PlaceResult[], targetPlaceId: string): number | null {
  for (let i = 0; i < places.length; i++) {
    if (places[i].id === targetPlaceId) return i + 1;
  }
  return null;
}

function rankColor(rank: number | null): string {
  if (rank === null) return "#dc2626";
  if (rank <= 3) return "#16a34a";
  if (rank <= 10) return "#eab308";
  return "#f97316";
}

function esc(s: string | null | undefined): string {
  if (s == null) return "";
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

export default function Page() {
  const mapEl = useRef<HTMLDivElement>(null);
  const mapRef = useRef<LeafletNS.Map | null>(null);
  const scanLayerRef = useRef<LeafletNS.LayerGroup | null>(null);
  const targetMarkerRef = useRef<LeafletNS.Marker | null>(null);
  const leafletRef = useRef<typeof LeafletNS | null>(null);

  const [target, setTarget] = useState<TargetBusiness | null>(null);
  const [candidates, setCandidates] = useState<PlaceResult[] | null>(null);
  const [businessQuery, setBusinessQuery] = useState("");
  const [keyword, setKeyword] = useState("");
  const [gridRows, setGridRows] = useState(7);
  const [gridCols, setGridCols] = useState(7);
  const [radiusMiles, setRadiusMiles] = useState(15);
  const [finding, setFinding] = useState(false);
  const [scanning, setScanning] = useState(false);
  const [progress, setProgress] = useState({ current: 0, total: 0, text: "" });
  const [lastScan, setLastScan] = useState<Scan | null>(null);
  const [allScans, setAllScans] = useState<Scan[]>([]);
  const [expandedBiz, setExpandedBiz] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const L = await import("leaflet");
      if (cancelled || !mapEl.current || mapRef.current) return;
      leafletRef.current = L;

      const map = L.map(mapEl.current, { zoomControl: true }).setView(
        GRAYSON_CENTER,
        11
      );
      L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
        attribution: "© OpenStreetMap",
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
      const scanLayer = L.layerGroup().addTo(map);

      mapRef.current = map;
      scanLayerRef.current = scanLayer;

      const storedBiz = localStorage.getItem(STORAGE.business);
      if (storedBiz) {
        const t: TargetBusiness = JSON.parse(storedBiz);
        setTarget(t);
        drawTargetMarker(t);
      }
      await migrateLocalStorageScans();
      try {
        const res = await fetch("/api/scans", { headers: adminHeaders() });
        if (res.ok) {
          const { scans } = await res.json();
          if (!cancelled) {
            setAllScans(scans || []);
            if (scans?.[0]) {
              setLastScan(scans[0]);
              renderScanPins(scans[0]);
              if (scans[0].target) drawTargetMarker(scans[0].target);
            }
          }
        }
      } catch {
        /* ignore load errors — empty state */
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  function drawTargetMarker(t: TargetBusiness) {
    const L = leafletRef.current;
    const map = mapRef.current;
    if (!L || !map || !t.location) return;
    if (targetMarkerRef.current) map.removeLayer(targetMarkerRef.current);
    targetMarkerRef.current = L.marker(
      [t.location.latitude, t.location.longitude],
      {
        icon: L.divIcon({
          className: "target-pin",
          html: '<div class="target-pin-inner"></div>',
          iconSize: [22, 22],
          iconAnchor: [11, 11],
        }),
        zIndexOffset: 1000,
      }
    )
      .addTo(map)
      .bindTooltip(t.name);
  }

  function addRankPin(pt: ScanPoint) {
    const L = leafletRef.current;
    const scanLayer = scanLayerRef.current;
    if (!L || !scanLayer) return;
    const errored = !!pt.error;
    const color = errored ? "#64748b" : rankColor(pt.rank);
    const label = errored ? "!" : pt.rank === null ? "20+" : String(pt.rank);
    const topList =
      pt.topThree && pt.topThree.length > 0
        ? pt.topThree
        : pt.topResult
          ? [pt.topResult]
          : [];
    const topBlock =
      topList.length > 0
        ? `<div class="tt-top">Top ${topList.length} here:</div>` +
          topList
            .map(
              (name, i) =>
                `<div class="tt-row"><span class="tt-rank">${i + 1}</span>${esc(name)}</div>`
            )
            .join("")
        : "";
    const tooltip = errored
      ? "Error: " + esc(pt.error)
      : `<div class="tt-head">Rank: ${pt.rank === null ? "Not found in top 20" : "#" + pt.rank}</div>` +
        topBlock;
    L.marker([pt.lat, pt.lng], {
      icon: L.divIcon({
        className: "rank-pin",
        html: `<div class="rank-pin-inner" style="background:${color}">${label}</div>`,
        iconSize: [30, 30],
        iconAnchor: [15, 15],
      }),
    })
      .addTo(scanLayer)
      .bindTooltip(tooltip);
  }

  function renderScanPins(scan: Scan) {
    const scanLayer = scanLayerRef.current;
    if (!scanLayer) return;
    scanLayer.clearLayers();
    scan.points.forEach(addRankPin);
  }

  async function findBusiness() {
    if (!businessQuery.trim()) return;
    setFinding(true);
    setCandidates(null);
    try {
      const places = await searchPlaces(
        businessQuery.trim(),
        GRAYSON_CENTER[0],
        GRAYSON_CENTER[1],
        30000,
        10,
        true
      );
      setCandidates(places);
    } catch (e) {
      alert("Search failed: " + (e as Error).message);
    } finally {
      setFinding(false);
    }
  }

  function lockBusiness(place: PlaceResult) {
    const t: TargetBusiness = {
      placeId: place.id,
      name: place.displayName?.text || "Unknown",
      address: place.formattedAddress || "",
      location: place.location || null,
    };
    localStorage.setItem(STORAGE.business, JSON.stringify(t));
    setTarget(t);
    setCandidates(null);
    setBusinessQuery("");
    drawTargetMarker(t);
  }

  function changeBusiness() {
    localStorage.removeItem(STORAGE.business);
    setTarget(null);
    const map = mapRef.current;
    if (map && targetMarkerRef.current) {
      map.removeLayer(targetMarkerRef.current);
      targetMarkerRef.current = null;
    }
  }

  async function runScan(override?: { rows: number; cols: number; miles: number }) {
    if (!target) return alert("Pick a business first.");
    if (!keyword.trim()) return alert("Enter a keyword.");

    const rows = override?.rows ?? gridRows;
    const cols = override?.cols ?? gridCols;
    const miles = override?.miles ?? radiusMiles;
    if (override) {
      setGridRows(rows);
      setGridCols(cols);
      setRadiusMiles(miles);
    }

    const radiusKm = miles * 1.609344;
    const scanCenter: [number, number] = target.location
      ? [target.location.latitude, target.location.longitude]
      : GRAYSON_CENTER;
    const points = generateGrid(scanCenter, radiusKm, rows, cols);
    setScanning(true);
    setProgress({ current: 0, total: points.length, text: "Starting…" });
    scanLayerRef.current?.clearLayers();

    const results: ScanPoint[] = [];
    for (let i = 0; i < points.length; i++) {
      const pt = points[i];
      setProgress({
        current: i,
        total: points.length,
        text: `Point ${i + 1}/${points.length}…`,
      });
      try {
        const places = await searchPlaces(
          keyword.trim(),
          pt.lat,
          pt.lng,
          5000,
          20
        );
        const rank = findRank(places, target.placeId);
        const topResult = places[0]?.displayName?.text || null;
        const topThree = places
          .slice(0, 3)
          .map((p) => p.displayName?.text)
          .filter((n): n is string => !!n);
        const result: ScanPoint = { ...pt, rank, topResult, topThree };
        results.push(result);
        addRankPin(result);
      } catch (e) {
        const msg = (e as Error).message;
        const result: ScanPoint = { ...pt, rank: null, error: msg };
        results.push(result);
        addRankPin(result);
        if (i === 0) {
          alert(
            "First scan call failed: " +
              msg +
              "\n\nCheck .env.local has the key, billing enabled, Places API (New) enabled."
          );
          setScanning(false);
          setProgress({
            current: i + 1,
            total: points.length,
            text: "Aborted.",
          });
          return;
        }
      }
      setProgress({
        current: i + 1,
        total: points.length,
        text: `Point ${i + 1}/${points.length}…`,
      });
    }

    const scan: Scan = {
      timestamp: new Date().toISOString(),
      target,
      keyword: keyword.trim(),
      gridRows: rows,
      gridCols: cols,
      radiusMiles: miles,
      center: scanCenter,
      points: results,
    };
    setLastScan(scan);
    await saveScanToServer(scan);
    drawTargetMarker(target);

    setProgress({
      current: points.length,
      total: points.length,
      text: `Done. ${results.length} points scanned.`,
    });
    setScanning(false);
  }

  async function saveScanToServer(scan: Scan) {
    try {
      const res = await fetch("/api/scans", {
        method: "POST",
        headers: { "Content-Type": "application/json", ...adminHeaders() },
        body: JSON.stringify(scan),
      });
      if (!res.ok) throw new Error("save failed");
    } catch (e) {
      alert(
        "Failed to save scan to server — it's still in memory for this session.\n" +
          (e as Error).message
      );
    }
    setAllScans((prev) => {
      const filtered = prev.filter((s) => s.timestamp !== scan.timestamp);
      return [scan, ...filtered];
    });
  }

  function loadScan(scan: Scan) {
    setLastScan(scan);
    renderScanPins(scan);
    if (scan.target) drawTargetMarker(scan.target);
  }

  async function deleteScan(timestamp: string) {
    try {
      await fetch(
        `/api/scans?timestamp=${encodeURIComponent(timestamp)}`,
        { method: "DELETE", headers: adminHeaders() }
      );
    } catch {
      /* still remove locally */
    }
    setAllScans((prev) => prev.filter((s) => s.timestamp !== timestamp));
    if (lastScan?.timestamp === timestamp) {
      setLastScan(null);
      scanLayerRef.current?.clearLayers();
    }
  }

  function exportLastScan() {
    if (!lastScan) return;
    const blob = new Blob([JSON.stringify(lastScan, null, 2)], {
      type: "application/json",
    });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    const slug = (lastScan.target.name || "scan")
      .replace(/[^a-z0-9]/gi, "-")
      .toLowerCase();
    a.download = `${slug}-${lastScan.timestamp.split("T")[0]}.json`;
    a.click();
    URL.revokeObjectURL(url);
  }

  const summary = lastScan ? computeSummary(lastScan) : null;

  return (
    <div className="app">
      <aside className="sidebar">
        <h1>
          Grayson County Geo Tracker
          <Link href="/help" className="help-icon" title="How does this work?" aria-label="Help">
            ?
          </Link>
        </h1>

        <section>
          <h2>Target Business</h2>
          {!target && (
            <>
              <input
                type="text"
                placeholder="e.g., Daughtertys Heating Cooling Leitchfield"
                value={businessQuery}
                onChange={(e) => setBusinessQuery(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") findBusiness();
                }}
              />
              <button onClick={findBusiness} disabled={finding}>
                {finding ? "Searching…" : "Find Business"}
              </button>
              {candidates && (
                <>
                  <small className="help" style={{ marginTop: 10 }}>
                    Pick the correct match:
                  </small>
                  <ul className="list">
                    {candidates.length === 0 && (
                      <li>
                        <small className="help">
                          No matches. Try a different query.
                        </small>
                      </li>
                    )}
                    {candidates.map((c) => (
                      <li key={c.id}>
                        <button onClick={() => lockBusiness(c)}>
                          <strong>{c.displayName?.text || "Unknown"}</strong>
                          <small>{c.formattedAddress || ""}</small>
                          <small>
                            {c.rating
                              ? `★ ${c.rating} (${c.userRatingCount || 0} reviews)`
                              : "No reviews"}
                          </small>
                        </button>
                      </li>
                    ))}
                  </ul>
                </>
              )}
            </>
          )}
          {target && (
            <>
              <div className="locked">
                <strong>{target.name}</strong>
                <span className="addr">{target.address}</span>
              </div>
              <button className="secondary" onClick={changeBusiness}>
                Change Business
              </button>
            </>
          )}
        </section>

        <section>
          <h2>Scan Settings</h2>
          <label>
            Keyword
            <input
              type="text"
              placeholder="e.g., hvac near me"
              value={keyword}
              onChange={(e) => setKeyword(e.target.value)}
            />
          </label>
          <div className="row">
            <label>
              Grid
              <select
                value={`${gridRows}x${gridCols}`}
                onChange={(e) => {
                  const [r, c] = e.target.value.split("x").map(Number);
                  setGridRows(r);
                  setGridCols(c);
                }}
              >
                <option value="5x7">5×7 — 35 pts</option>
                <option value="7x7">7×7 — 49 pts · audit</option>
                <option value="9x7">9×7 — 63 pts · paid</option>
              </select>
            </label>
            <label>
              Radius
              <select
                value={radiusMiles}
                onChange={(e) => setRadiusMiles(parseFloat(e.target.value))}
              >
                <option value={5}>Local — 5 mi</option>
                <option value={10}>County — 10 mi</option>
                <option value={15}>Audit — 15 mi</option>
                <option value={20}>Regional — 20 mi</option>
              </select>
            </label>
          </div>
          <small className="help">
            Radius is measured from the tracked business&rsquo;s location.
          </small>
          <button onClick={() => runScan()} disabled={scanning || !target}>
            {scanning ? "Scanning…" : "Run Scan"}
          </button>
          {(scanning || progress.total > 0) && (
            <div id="scan-progress">
              <progress value={progress.current} max={progress.total} />
              <p className="progress-text">{progress.text}</p>
            </div>
          )}
        </section>

        <section>
          <h2>Last Scan</h2>
          {!lastScan && (
            <small className="help">No scan yet.</small>
          )}
          {lastScan && summary && (
            <div className="summary">
              <p className="target">{lastScan.target.name}</p>
              <p className="meta">
                &quot;{lastScan.keyword}&quot; · {gridLabel(lastScan)} ·{" "}
                {new Date(lastScan.timestamp).toLocaleString()}
              </p>
              <div className="stat-grid">
                <div className="stat">
                  <div className="label">Visibility</div>
                  <div className={`value ${summary.scoreClass}`}>
                    {summary.score}
                  </div>
                </div>
                <div className="stat">
                  <div className="label">Avg rank</div>
                  <div className="value">{summary.avgRank}</div>
                </div>
                <div className="stat">
                  <div className="label">Top 3</div>
                  <div className="value">
                    {summary.top3}/{summary.valid}
                  </div>
                </div>
                <div className="stat">
                  <div className="label">Top 10</div>
                  <div className="value">
                    {summary.top10}/{summary.valid}
                  </div>
                </div>
              </div>
              <div className="legend">
                <div className="legend-item">
                  <div
                    className="legend-dot"
                    style={{ background: "#16a34a" }}
                  />
                  1–3
                </div>
                <div className="legend-item">
                  <div
                    className="legend-dot"
                    style={{ background: "#eab308" }}
                  />
                  4–10
                </div>
                <div className="legend-item">
                  <div
                    className="legend-dot"
                    style={{ background: "#f97316" }}
                  />
                  11–20
                </div>
                <div className="legend-item">
                  <div
                    className="legend-dot"
                    style={{ background: "#dc2626" }}
                  />
                  20+
                </div>
              </div>
              {(() => {
                const rivals = computeTopCompetitors(lastScan);
                if (rivals.length === 0) return null;
                const max = rivals[0].steals;
                return (
                  <div className="rivals">
                    <div className="rivals-title">Top competitors stealing #1</div>
                    <ul className="rivals-list">
                      {rivals.map((r, i) => (
                        <li key={r.name} className="rivals-row">
                          <span className="rivals-rank">{i + 1}</span>
                          <div className="rivals-body">
                            <div className="rivals-name">{r.name}</div>
                            <div className="rivals-bar-wrap">
                              <div
                                className="rivals-bar"
                                style={{ width: `${(r.steals / max) * 100}%` }}
                              />
                            </div>
                          </div>
                          <span className="rivals-count">{r.steals}</span>
                        </li>
                      ))}
                    </ul>
                  </div>
                );
              })()}
              <a
                className="report-btn"
                href={`/report/${encodeURIComponent(lastScan.timestamp)}`}
                target="_blank"
                rel="noopener noreferrer"
              >
                Create Report →
              </a>
              <button className="secondary" onClick={exportLastScan}>
                Download JSON
              </button>
            </div>
          )}
        </section>

        <section>
          <h2>Businesses</h2>
          {allScans.length === 0 && (
            <small className="help">No scans yet.</small>
          )}
          {allScans.length > 0 && (
            <ul className="biz-list">
              {groupScansByBusiness(allScans).map((group) => {
                const isOpen = expandedBiz === group.placeId;
                return (
                  <li key={group.placeId} className="biz-group">
                    <button
                      className="biz-head"
                      onClick={() =>
                        setExpandedBiz(isOpen ? null : group.placeId)
                      }
                    >
                      <div className="biz-head-main">
                        <strong>{group.name}</strong>
                        <small>
                          {group.scans.length}{" "}
                          {group.scans.length === 1 ? "scan" : "scans"} · last{" "}
                          {new Date(group.latest).toLocaleDateString()}
                        </small>
                      </div>
                      <span className={`biz-caret ${isOpen ? "open" : ""}`}>
                        ▸
                      </span>
                    </button>
                    {isOpen && (
                      <ul className="biz-scans">
                        {group.scans.map((scan) => {
                          const active = lastScan?.timestamp === scan.timestamp;
                          return (
                            <li
                              key={scan.timestamp}
                              className={`biz-scan-row ${active ? "active" : ""}`}
                            >
                              <button
                                className="biz-scan-load"
                                onClick={() => loadScan(scan)}
                              >
                                <span className="biz-scan-kw">
                                  &ldquo;{scan.keyword}&rdquo;
                                </span>
                                <span className="biz-scan-meta">
                                  {new Date(scan.timestamp).toLocaleString()} ·{" "}
                                  {gridLabel(scan)}
                                </span>
                              </button>
                              <button
                                className="biz-scan-delete"
                                title="Delete scan"
                                aria-label="Delete scan"
                                onClick={() => deleteScan(scan.timestamp)}
                              >
                                ×
                              </button>
                            </li>
                          );
                        })}
                      </ul>
                    )}
                  </li>
                );
              })}
            </ul>
          )}
        </section>
      </aside>

      <div ref={mapEl} className="map-wrap" />
    </div>
  );
}

async function migrateLocalStorageScans() {
  if (typeof window === "undefined") return;
  if (localStorage.getItem("gct_migrated_v1")) return;

  const collected: Scan[] = [];
  const seen = new Set<string>();

  const historyRaw = localStorage.getItem("gct_scan_history");
  if (historyRaw) {
    try {
      const entries = JSON.parse(historyRaw) as Array<{ full?: Scan }>;
      for (const e of entries) {
        if (e?.full?.timestamp && !seen.has(e.full.timestamp)) {
          collected.push(e.full);
          seen.add(e.full.timestamp);
        }
      }
    } catch {
      /* ignore parse errors */
    }
  }

  const lastRaw = localStorage.getItem("gct_last_scan");
  if (lastRaw) {
    try {
      const s = JSON.parse(lastRaw) as Scan;
      if (s?.timestamp && !seen.has(s.timestamp)) {
        collected.push(s);
        seen.add(s.timestamp);
      }
    } catch {
      /* ignore */
    }
  }

  if (collected.length === 0) {
    localStorage.setItem("gct_migrated_v1", "1");
    return;
  }

  let migrated = 0;
  for (const scan of collected) {
    try {
      const res = await fetch("/api/scans", {
        method: "POST",
        headers: { "Content-Type": "application/json", ...adminHeaders() },
        body: JSON.stringify(scan),
      });
      if (res.ok) migrated++;
    } catch {
      /* keep going */
    }
  }

  if (migrated > 0) {
    console.log(`Migrated ${migrated} scan(s) from localStorage to server.`);
    localStorage.setItem("gct_migrated_v1", "1");
    localStorage.removeItem("gct_scan_history");
    localStorage.removeItem("gct_last_scan");
  }
}

function computeTopCompetitors(scan: Scan) {
  const counts = new Map<string, number>();
  for (const p of scan.points) {
    if (!p.topResult) continue;
    if (p.rank === 1) continue;
    counts.set(p.topResult, (counts.get(p.topResult) ?? 0) + 1);
  }
  return Array.from(counts.entries())
    .map(([name, steals]) => ({ name, steals }))
    .sort((a, b) => b.steals - a.steals)
    .slice(0, 3);
}

function groupScansByBusiness(scans: Scan[]) {
  const byBiz = new Map<
    string,
    { placeId: string; name: string; scans: Scan[]; latest: string }
  >();
  for (const scan of scans) {
    const key = scan.target.placeId;
    const existing = byBiz.get(key);
    if (existing) {
      existing.scans.push(scan);
      if (scan.timestamp > existing.latest) existing.latest = scan.timestamp;
    } else {
      byBiz.set(key, {
        placeId: key,
        name: scan.target.name,
        scans: [scan],
        latest: scan.timestamp,
      });
    }
  }
  return Array.from(byBiz.values())
    .map((g) => ({
      ...g,
      scans: g.scans.sort((a, b) => b.timestamp.localeCompare(a.timestamp)),
    }))
    .sort((a, b) => b.latest.localeCompare(a.latest));
}

function computeSummary(scan: Scan) {
  const valid = scan.points.filter((p) => !p.error);
  const found = valid.filter((p) => p.rank !== null);
  const top3 = valid.filter((p) => p.rank !== null && (p.rank || 0) <= 3);
  const top10 = valid.filter((p) => p.rank !== null && (p.rank || 0) <= 10);
  const avgRank =
    found.length > 0
      ? (found.reduce((s, p) => s + (p.rank || 0), 0) / found.length).toFixed(1)
      : "—";
  const score =
    valid.length > 0
      ? Math.round(
          valid.reduce((s, p) => {
            if (p.rank === null) return s;
            return s + Math.max(0, 100 - ((p.rank || 0) - 1) * 5);
          }, 0) / valid.length
        )
      : 0;
  const scoreClass = score >= 60 ? "good" : score >= 30 ? "mid" : "bad";
  return {
    valid: valid.length,
    found: found.length,
    top3: top3.length,
    top10: top10.length,
    avgRank,
    score,
    scoreClass,
  };
}

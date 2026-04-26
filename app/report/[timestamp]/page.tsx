
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { Fraunces, IBM_Plex_Sans } from "next/font/google";
import { gridLabel, type Scan } from "@/lib/types";
import graysonGeometry from "@/lib/grayson-geometry.json";
import { supabasePublic } from "@/lib/supabase";
import { PrintButton } from "./print-button";
import { ReportMap } from "./report-map";

// Reports are reachable by timestamp alone — anyone with the URL can
// read them. Keep them out of search engines so a customer's audit
// doesn't surface in a "site:studio925.design" query.
export const metadata: Metadata = {
  robots: { index: false, follow: false },
};

type Ring = number[][];
type Polygon = { type: "Polygon"; coordinates: Ring[] };
type MultiPolygon = { type: "MultiPolygon"; coordinates: Ring[][] };

function countyRings(): Ring[] {
  const g = graysonGeometry as unknown as Polygon | MultiPolygon;
  if (g.type === "Polygon") return g.coordinates;
  return g.coordinates.flat();
}

function countyBounds() {
  const rings = countyRings();
  let minLat = Infinity,
    maxLat = -Infinity,
    minLng = Infinity,
    maxLng = -Infinity;
  for (const ring of rings) {
    for (const [lng, lat] of ring) {
      if (lat < minLat) minLat = lat;
      if (lat > maxLat) maxLat = lat;
      if (lng < minLng) minLng = lng;
      if (lng > maxLng) maxLng = lng;
    }
  }
  return { minLat, maxLat, minLng, maxLng };
}

const fraunces = Fraunces({
  subsets: ["latin"],
  variable: "--rp-display",
  display: "swap",
});
const plex = IBM_Plex_Sans({
  subsets: ["latin"],
  weight: ["300", "400", "500", "600", "700"],
  variable: "--rp-body",
  display: "swap",
});

async function getScan(timestamp: string): Promise<Scan | null> {
  // Use the anon-key client here, not service_role. RLS on `scans`
  // grants public SELECT, so this still works; but the credential's
  // blast radius is one read-only table instead of the whole project.
  const { data, error } = await supabasePublic()
    .from("scans")
    .select("payload")
    .eq("timestamp", timestamp)
    .maybeSingle();
  if (error || !data) return null;
  return (data as { payload: Scan }).payload;
}

// CTR weights for ranks 1–10. Normalized so rank-1 = 100. The curve is
// intentionally steep — for local "near me" searches the map pack (top
// 3) absorbs the great majority of clicks; ranks 4-10 sit below the
// pack and most users never scroll past it. Anything 11+ or not-found
// scores 0. The score is "% of customer attention captured vs. a
// competitor that ranks #1 at every point".
const CTR_WEIGHT: Record<number, number> = {
  1: 100,
  2: 55,
  3: 35,
  4: 18,
  5: 12,
  6: 8,
  7: 5,
  8: 3,
  9: 2,
  10: 1,
};
function ctrWeight(rank: number | null): number {
  if (rank === null) return 0;
  return CTR_WEIGHT[rank] ?? 0;
}

function buildRecommendation(args: {
  score: number;
  top3Count: number;
  top10Count: number;
  missingCount: number;
  validCount: number;
  rivals: { name: string; steals: number }[];
}): string {
  const { score, top3Count, top10Count, missingCount, validCount, rivals } =
    args;
  const top3Pct = validCount > 0 ? (top3Count / validCount) * 100 : 0;
  const top10Pct = validCount > 0 ? (top10Count / validCount) * 100 : 0;
  const missingPct = validCount > 0 ? (missingCount / validCount) * 100 : 0;

  const topRival = rivals[0];
  const totalCaptures = rivals.reduce((s, r) => s + r.steals, 0);
  const rivalDominance =
    topRival && totalCaptures > 0 ? topRival.steals / totalCaptures : 0;

  // Each rule leads with the ACTION (verb-first), then names the
  // situation as supporting evidence. The pullquote already carries the
  // gut-punch; this section's job is to tell the owner what to do.

  // Rule 1: mostly invisible in the map pack — GBP basics are the bottleneck.
  if (score < 10 || missingPct > 50) {
    return `Fill out every single field on your Google Business Profile, add 10 or more recent photos, and double-check your service categories. Most local searches in Grayson County aren't finding you in the map pack at all, and the GBP fix is the cheapest, fastest first move.`;
  }

  // Rule 2: one clearly dominant rival — point at them specifically.
  if (topRival && topRival.steals >= 5 && rivalDominance > 0.4) {
    return `Open ${topRival.name}'s Google Business Profile in another tab and compare their review count, photo count, and service categories to yours. They're ranking #1 in ${topRival.steals} of the searches where you should be the obvious choice. That gap is almost always fixable.`;
  }

  // Rule 3: strong center but missing edges — needs service-area pages.
  if (score >= 35 && missingPct > 20) {
    return `Add location-specific service pages, one for each town you serve but don't currently rank in. You hold the middle of the county, but there are ${missingCount} outer spots where you don't show up at all. Service pages tell Google your area is bigger than it currently thinks.`;
  }

  // Rule 4: visible everywhere but rarely top 3 — reviews are usually the gap.
  if (top10Pct > 60 && top3Pct < 25) {
    const rivalLine = topRival
      ? ` ${topRival.name} is ranking #1 in ${topRival.steals} of those top spots, and reviews are usually how.`
      : ` Reviews are typically how the top 3 stay in the top 3.`;
    return `Count your top competitors' Google reviews next to yours and start closing that gap. You're showing up almost everywhere, but you're stuck behind the top 3 results where the clicks go.${rivalLine}`;
  }

  // Default: audit GBP first.
  return `Audit your Google Business Profile first. Every empty field, every old photo, every wrong service category is a small leak. At score ${score}/100 there's clear room to fix on the cheapest lever before touching anything else.`;
}

export default async function ReportPage({
  params,
}: {
  params: Promise<{ timestamp: string }>;
}) {
  const { timestamp } = await params;
  const scan = await getScan(decodeURIComponent(timestamp));
  if (!scan) notFound();

  const valid = scan.points.filter((p) => !p.error);
  const found = valid.filter((p) => p.rank !== null);
  const top3 = valid.filter((p) => p.rank !== null && (p.rank || 0) <= 3);
  const top10 = valid.filter((p) => p.rank !== null && (p.rank || 0) <= 10);
  const missing = valid.filter((p) => p.rank === null);
  const avgRank =
    found.length > 0
      ? (found.reduce((s, p) => s + (p.rank || 0), 0) / found.length).toFixed(1)
      : "-";
  const score =
    valid.length > 0
      ? Math.round(
          valid.reduce((s, p) => s + ctrWeight(p.rank), 0) / valid.length
        )
      : 0;

  const rivalCounts = new Map<string, number>();
  for (const p of scan.points) {
    if (!p.topResult || p.rank === 1) continue;
    rivalCounts.set(p.topResult, (rivalCounts.get(p.topResult) ?? 0) + 1);
  }
  const rivals = Array.from(rivalCounts.entries())
    .map(([name, steals]) => ({ name, steals }))
    .sort((a, b) => b.steals - a.steals)
    .slice(0, 5);
  const maxSteals = rivals[0]?.steals ?? 1;

  const county = countyBounds();
  const pointLats = scan.points.map((p) => p.lat);
  const pointLngs = scan.points.map((p) => p.lng);
  const mapBounds = {
    minLat: Math.min(county.minLat, ...pointLats),
    maxLat: Math.max(county.maxLat, ...pointLats),
    minLng: Math.min(county.minLng, ...pointLngs),
    maxLng: Math.max(county.maxLng, ...pointLngs),
  };

  const recommendation =
    scan.recommendation ??
    buildRecommendation({
      score,
      top3Count: top3.length,
      top10Count: top10.length,
      missingCount: missing.length,
      validCount: valid.length,
      rivals,
    });

  const dateStr = new Date(scan.timestamp).toLocaleDateString("en-US", {
    year: "numeric",
    month: "long",
    day: "numeric",
  });

  return (
    <div className={`${fraunces.variable} ${plex.variable} rp`}>
      <div className="rp-toolbar no-print">
        <PrintButton />
      </div>

      <article className="rp-doc">
        <header className="rp-head">
          <div className="rp-brand">LOCAL GEOMAP</div>
          <div className="rp-meta">{dateStr}</div>
        </header>

        <h1 className="rp-title">Local Search Visibility Report</h1>

        <section className="rp-subject">
          <h2 className="rp-biz">{scan.target.name}</h2>
          <div className="rp-subject-meta">
            <div>
              <span>Keyword tracked</span>&ldquo;{scan.keyword}&rdquo;
            </div>
            <div>
              <span>Business address</span>
              {scan.target.address || "-"}
            </div>
            <div>
              <span>Scan area</span>Grayson County, Kentucky
            </div>
            <div>
              <span>Scan points</span>
              {scan.points.length} ({gridLabel(scan)} grid ·{" "}
              {Math.round((scan.radiusMiles * Math.SQRT2) / 5) * 5}-mile
              radius)
            </div>
          </div>
        </section>

        <section className="rp-summary">
          <div className="rp-score-block">
            <div
              className={`rp-score-num ${
                score >= 50 ? "good" : score >= 20 ? "mid" : "bad"
              }`}
            >
              {score}
            </div>
            <div className="rp-score-unit">
              <span>VISIBILITY</span>
              <span>SCORE</span>
              <small>out of 100</small>
            </div>
          </div>
          <blockquote className="rp-pullquote">
            Out of every 100 customers searching nearby, you&rsquo;re
            capturing about <strong>{score}</strong>.{" "}
            {score >= 50
              ? "You're winning most of the local race."
              : score >= 20
                ? `The other ${100 - score} are going to competitors.`
                : `The other ${100 - score} are going to competitors. Most never even see you.`}
          </blockquote>
        </section>

        {(() => {
          const r = parseFloat(avgRank);
          const rankClass = isNaN(r)
            ? ""
            : r <= 3
              ? "rp-stat-good"
              : r <= 7
                ? "rp-stat-mid"
                : "rp-stat-bad";
          const top3Pct = (top3.length / valid.length) * 100;
          const top3Class =
            top3Pct >= 50
              ? "rp-stat-good"
              : top3Pct >= 25
                ? "rp-stat-mid"
                : "rp-stat-bad";
          const top10Pct = (top10.length / valid.length) * 100;
          const top10Class =
            top10Pct >= 75
              ? "rp-stat-good"
              : top10Pct >= 40
                ? "rp-stat-mid"
                : "rp-stat-bad";
          const missPct = (missing.length / valid.length) * 100;
          const missClass =
            missPct <= 10
              ? "rp-stat-good"
              : missPct <= 25
                ? "rp-stat-mid"
                : "rp-stat-bad";
          return (
            <section className="rp-stats">
              <div className="rp-stat">
                <div className="rp-stat-label">AVG RANK</div>
                <div className={`rp-stat-val ${rankClass}`}>{avgRank}</div>
                <div className="rp-stat-sub">
                  {isNaN(r)
                    ? "-"
                    : r <= 3
                      ? "top of Google pg 1"
                      : r <= 7
                        ? "mid Google pg 1"
                        : r <= 10
                          ? "bottom Google pg 1"
                          : r <= 15
                            ? "top Google pg 2"
                            : "deep Google pg 2+"}
                </div>
              </div>
              <div className="rp-stat">
                <div className="rp-stat-label">TOP 3</div>
                <div className={`rp-stat-val ${top3Class}`}>
                  {top3.length}
                  <span>/{valid.length}</span>
                </div>
                <div className="rp-stat-sub">
                  {Math.round(top3Pct)}% of points
                </div>
              </div>
              <div className="rp-stat">
                <div className="rp-stat-label">TOP 10</div>
                <div className={`rp-stat-val ${top10Class}`}>
                  {top10.length}
                  <span>/{valid.length}</span>
                </div>
                <div className="rp-stat-sub">
                  {Math.round(top10Pct)}% of points
                </div>
              </div>
              <div className="rp-stat">
                <div className="rp-stat-label">NOT FOUND</div>
                <div className={`rp-stat-val ${missClass}`}>
                  {missing.length}
                  <span>/{valid.length}</span>
                </div>
                <div className="rp-stat-sub">fully invisible</div>
              </div>
            </section>
          );
        })()}

        <aside className="rp-context-note">
          <strong>Why this matters:</strong> the <strong>map pack</strong>{" "}
          is the 3 businesses Google shows on a map at the top of local
          searches. Those 3 spots take about{" "}
          <strong>two-thirds of all local clicks</strong>.
        </aside>

        <section className="rp-map-section">
          <h3 className="rp-h3">Geographic visibility</h3>
          <p className="rp-caption">
            Each point represents a &ldquo;{scan.keyword}&rdquo; search from
            that exact GPS location. The number inside each pin is the
            business&rsquo;s rank in Google&rsquo;s results from that point.
          </p>
          <ReportMap
            points={scan.points}
            target={scan.target}
            bounds={mapBounds}
          />
          <div className="rp-map-legend">
            <span>
              <svg
                className="rp-legend-crosshair"
                viewBox="0 0 20 20"
                width="18"
                height="18"
                aria-hidden
              >
                <circle
                  cx="10"
                  cy="10"
                  r="6"
                  fill="none"
                  stroke="#1e3a5f"
                  strokeWidth="1.8"
                />
                <line x1="0" y1="10" x2="3" y2="10" stroke="#1e3a5f" strokeWidth="1.8" strokeLinecap="round" />
                <line x1="17" y1="10" x2="20" y2="10" stroke="#1e3a5f" strokeWidth="1.8" strokeLinecap="round" />
                <line x1="10" y1="0" x2="10" y2="3" stroke="#1e3a5f" strokeWidth="1.8" strokeLinecap="round" />
                <line x1="10" y1="17" x2="10" y2="20" stroke="#1e3a5f" strokeWidth="1.8" strokeLinecap="round" />
              </svg>
              {scan.target.name}
            </span>
            <span>
              <i style={{ background: "#1a5d2f" }} /> Top 3
            </span>
            <span>
              <i style={{ background: "#d4a017" }} /> 4–10
            </span>
            <span>
              <i style={{ background: "#c96a12" }} /> 11–20
            </span>
            <span>
              <i style={{ background: "#9a0f0f" }} /> Not found
            </span>
          </div>
        </section>

        {rivals.length > 0 && (
          <section className="rp-rivals-section">
            <h3 className="rp-h3">Top competitors capturing #1</h3>
            <p className="rp-caption">
              Businesses that ranked first in the most scan points where you
              were not #1.
            </p>
            <ul className="rp-rivals">
              {rivals.map((r, i) => (
                <li key={r.name}>
                  <span className="rp-rival-rank">
                    {String(i + 1).padStart(2, "0")}
                  </span>
                  <span className="rp-rival-name">{r.name}</span>
                  <span className="rp-rival-bar-wrap">
                    <span
                      className="rp-rival-bar"
                      style={{ width: `${(r.steals / maxSteals) * 100}%` }}
                    />
                  </span>
                  <span className="rp-rival-count">
                    {r.steals} {r.steals === 1 ? "capture" : "captures"}
                  </span>
                </li>
              ))}
            </ul>
          </section>
        )}

        <aside className="rp-recommendation">
          <div className="rp-recommendation-tag">WHERE TO START</div>
          <p>{recommendation}</p>
          <div className="rp-recommendation-sig">Kara · Studio 925</div>
        </aside>

        <section className="rp-cta">
          <div className="rp-cta-header">
            <div className="rp-cta-tag">THE FIX</div>
            <h3>Studio 925 builds the websites that close these gaps.</h3>
            <p>
              Local visibility is a stack: a modern website with clear
              service pages is the foundation; the Google Business
              Profile and directory citations compound on top of it.
              Most owners patch the GBP and stop short of the website,
              which is the one thing Google actually reads to decide
              you&rsquo;re real.
            </p>
          </div>

          <div className="rp-cta-offers">
            <div className="rp-cta-offer">
              <div className="rp-cta-price">
                <span>$</span>900<span className="rp-cta-per"> and up</span>
              </div>
              <div className="rp-cta-offer-label">WEBSITE BUILD · 3 TIERS</div>
              <ul>
                <li>Custom design, 48-hour first draft</li>
                <li>Live in about a week</li>
                <li>Google-ready SEO from day one</li>
                <li>You own everything after final payment</li>
              </ul>
            </div>
            <div className="rp-cta-offer rp-cta-feature">
              <div className="rp-cta-price">
                <span>$</span>49<span className="rp-cta-per">/mo</span>
              </div>
              <div className="rp-cta-offer-label">FULL SUPPORT HOSTING</div>
              <ul>
                <li>Free custom domain + SSL</li>
                <li>Ongoing SEO handled monthly</li>
                <li>Denser 63-point monthly rescans</li>
                <li>Market exclusivity in your niche</li>
              </ul>
            </div>
          </div>

          <div className="rp-cta-contact">
            <div>
              <div className="rp-cta-contact-label">CALL</div>
              <a href="tel:+12705512210" className="rp-cta-contact-value">
                (270) 551-2210
              </a>
              <a
                href="sms:+12705512210?body=Hi%2C%20I%20just%20got%20my%20Geomap%20audit"
                className="rp-cta-contact-sub"
              >
                or send a text →
              </a>
            </div>
            <div>
              <div className="rp-cta-contact-label">EMAIL</div>
              <a
                href="mailto:kara@studio925.design"
                className="rp-cta-contact-value"
              >
                kara@studio925.design
              </a>
            </div>
            <div>
              <div className="rp-cta-contact-label">ONLINE</div>
              <a
                href="https://studio925.design"
                target="_blank"
                rel="noopener noreferrer"
                className="rp-cta-contact-value"
              >
                studio925.design
              </a>
              <a
                href="https://studio925.design/#pricing"
                target="_blank"
                rel="noopener noreferrer"
                className="rp-cta-contact-sub"
              >
                see full pricing →
              </a>
            </div>
          </div>
        </section>

        <footer className="rp-foot">
          <div>
            Powered by Google · Generated {dateStr}
          </div>
          <div>LOCAL GEOMAP · BY STUDIO 925</div>
        </footer>
      </article>
    </div>
  );
}

import Link from "next/link";

function Pin({
  rank,
  size = 40,
}: {
  rank: number | "20+" | "!";
  size?: number;
}) {
  const color =
    rank === "!"
      ? "#64748b"
      : rank === "20+"
        ? "#dc2626"
        : typeof rank === "number" && rank <= 3
          ? "#16a34a"
          : typeof rank === "number" && rank <= 10
            ? "#eab308"
            : "#f97316";
  const fontSize = rank === "20+" ? size * 0.32 : size * 0.4;
  return (
    <div
      className="hp-pin"
      style={{ width: size, height: size, background: color, fontSize }}
    >
      {rank}
    </div>
  );
}

function Callout({ n }: { n: number }) {
  return <span className="hp-dot">{n}</span>;
}

export default function HelpPage() {
  return (
    <div className="hp">
      <div className="hp-topbar">
        <Link href="/" className="hp-back">
          ← Back to app
        </Link>
      </div>

      <header className="hp-header">
        <h1>How every piece works</h1>
        <p>
          Each section shows an actual piece of the app with numbered markers
          and a <strong>Takeaway</strong> at the bottom — the one thing to
          remember.
        </p>
        <nav className="hp-toc">
          <a href="#pins" className="hp-toc-link blue">① Pin colors</a>
          <a href="#point" className="hp-toc-link yellow">② A single scan point</a>
          <a href="#stats" className="hp-toc-link green">③ The four scores</a>
          <a href="#form" className="hp-toc-link purple">④ The scan form</a>
          <a href="#map" className="hp-toc-link orange">⑤ Reading the map</a>
          <a href="#faq" className="hp-toc-link slate">⑥ Common questions</a>
        </nav>
      </header>

      {/* =================== PINS =================== */}
      <section id="pins" className="hp-section hp-accent-blue">
        <div className="hp-section-head">
          <div className="hp-section-num">01</div>
          <h2>Pin colors</h2>
          <p>Every pin on the map is one of five colors. Color = your rank range.</p>
        </div>

        <div className="hp-pin-strip">
          <div className="hp-pin-card">
            <Pin rank={1} size={56} />
            <div className="hp-pin-label">Green</div>
            <div className="hp-pin-meta">Rank 1–3</div>
            <p>Top three results. This is where phone calls come from.</p>
          </div>
          <div className="hp-pin-card">
            <Pin rank={7} size={56} />
            <div className="hp-pin-label">Yellow</div>
            <div className="hp-pin-meta">Rank 4–10</div>
            <p>First page, below the top. Seen but usually not called.</p>
          </div>
          <div className="hp-pin-card">
            <Pin rank={15} size={56} />
            <div className="hp-pin-label">Orange</div>
            <div className="hp-pin-meta">Rank 11–20</div>
            <p>In the list but almost nobody scrolls here.</p>
          </div>
          <div className="hp-pin-card">
            <Pin rank="20+" size={56} />
            <div className="hp-pin-label">Red</div>
            <div className="hp-pin-meta">Not found</div>
            <p>You don&rsquo;t appear. Every call from here goes elsewhere.</p>
          </div>
          <div className="hp-pin-card">
            <Pin rank="!" size={56} />
            <div className="hp-pin-label">Gray</div>
            <div className="hp-pin-meta">Error</div>
            <p>API call failed. Rare — hover the pin to see why.</p>
          </div>
        </div>

        <div className="hp-takeaway">
          <span className="hp-takeaway-label">Takeaway</span>
          <p>
            <strong className="hp-good">Green = winning.</strong>{" "}
            <strong className="hp-bad">Red = losing every call from that spot.</strong>{" "}
            Your job is to turn red and orange into green.
          </p>
        </div>
      </section>

      {/* =================== SINGLE POINT =================== */}
      <section id="point" className="hp-section hp-accent-yellow">
        <div className="hp-section-head">
          <div className="hp-section-num">02</div>
          <h2>A single scan point</h2>
          <p>Hover a pin on the map, you see this. Here&rsquo;s what each part means.</p>
        </div>

        <div className="hp-mockup-row">
          <div className="hp-mockup">
            <div className="hp-point-demo">
              <div className="hp-point-pin-wrap">
                <Callout n={1} />
                <Pin rank={2} size={56} />
              </div>
              <div className="hp-tooltip">
                <div className="hp-tooltip-row">
                  <Callout n={2} />
                  <strong>Rank: #2</strong>
                </div>
                <div className="hp-tooltip-row">
                  <Callout n={3} />
                  <span className="hp-tooltip-small">
                    Top: Abner&rsquo;s Heating and Cooling
                  </span>
                </div>
              </div>
            </div>
          </div>

          <div className="hp-legend">
            <div className="hp-legend-row">
              <Callout n={1} />
              <div>
                <h4>The pin itself</h4>
                <p>
                  Color = your rank range. Number inside = your exact rank. A
                  green &ldquo;2&rdquo; means you&rsquo;re #2 here (top 3, so
                  green).
                </p>
              </div>
            </div>
            <div className="hp-legend-row">
              <Callout n={2} />
              <div>
                <h4>Rank</h4>
                <p>
                  Your position in Google&rsquo;s results at this point. Lower
                  = better. &ldquo;Not found in top 20&rdquo; means Google
                  returned 20 results and you weren&rsquo;t one of them.
                </p>
              </div>
            </div>
            <div className="hp-legend-row">
              <Callout n={3} />
              <div>
                <h4>Who&rsquo;s beating you</h4>
                <p>
                  The #1 result at this point. If you see the same competitor
                  name on lots of pins nearby, that&rsquo;s your real rival in
                  that part of the county.
                </p>
              </div>
            </div>
          </div>
        </div>

        <div className="hp-takeaway">
          <span className="hp-takeaway-label">Takeaway</span>
          <p>
            A pin isn&rsquo;t just &ldquo;you.&rdquo; It tells you{" "}
            <strong>your rank</strong> and{" "}
            <strong>who&rsquo;s beating you there</strong>. The &ldquo;Top:
            ___&rdquo; line is gold — it names your actual competitor in each
            neighborhood.
          </p>
        </div>
      </section>

      {/* =================== STATS =================== */}
      <section id="stats" className="hp-section hp-accent-green">
        <div className="hp-section-head">
          <div className="hp-section-num">03</div>
          <h2>The four scores</h2>
          <p>After a scan, the sidebar shows these four numbers. Here&rsquo;s what each one is saying.</p>
        </div>

        <div className="hp-mockup-row">
          <div className="hp-mockup">
            <div className="hp-stat-grid">
              <div className="hp-stat">
                <Callout n={1} />
                <div className="hp-stat-label">Visibility</div>
                <div className="hp-stat-value good">70</div>
              </div>
              <div className="hp-stat">
                <Callout n={2} />
                <div className="hp-stat-label">Avg rank</div>
                <div className="hp-stat-value">6.5</div>
              </div>
              <div className="hp-stat">
                <Callout n={3} />
                <div className="hp-stat-label">Top 3</div>
                <div className="hp-stat-value">17/49</div>
              </div>
              <div className="hp-stat">
                <Callout n={4} />
                <div className="hp-stat-label">Top 10</div>
                <div className="hp-stat-value">36/49</div>
              </div>
            </div>
          </div>

          <div className="hp-legend">
            <div className="hp-legend-row">
              <Callout n={1} />
              <div>
                <h4>Visibility (0–100)</h4>
                <p>
                  One number for the whole scan. 100 = #1 everywhere, 0 =
                  invisible. <span className="hp-good">70+ strong</span>,{" "}
                  <span className="hp-mid">30–70 decent</span>,{" "}
                  <span className="hp-bad">under 30 needs work</span>.
                </p>
              </div>
            </div>
            <div className="hp-legend-row">
              <Callout n={2} />
              <div>
                <h4>Avg rank</h4>
                <p>
                  Your average position where you showed up. <strong>Lower is
                  better.</strong> Avg 2 = near the top. Avg 15 = buried.
                </p>
              </div>
            </div>
            <div className="hp-legend-row">
              <Callout n={3} />
              <div>
                <h4>Top 3</h4>
                <p>
                  How many of the 49 spots put you in the top 3 results. This
                  is the number that maps to <em>actual phone calls</em>.
                </p>
              </div>
            </div>
            <div className="hp-legend-row">
              <Callout n={4} />
              <div>
                <h4>Top 10</h4>
                <p>
                  How many spots put you on the first page. High Top 10 + low
                  Top 3 = &ldquo;they find you, then call someone else.&rdquo;
                </p>
              </div>
            </div>
          </div>
        </div>

        <div className="hp-score-guide">
          <div className="hp-score-guide-row">
            <span className="hp-pill good">Visibility 70+</span>
            <span className="hp-pill mid">30–70</span>
            <span className="hp-pill bad">under 30</span>
            <span className="hp-score-guide-text">interpret visibility this way</span>
          </div>
        </div>

        <div className="hp-takeaway">
          <span className="hp-takeaway-label">Takeaway</span>
          <p>
            Watch <strong>Top 3</strong> and <strong>Visibility</strong>. Top 3
            maps to real phone calls. A visibility under 30 means a
            prospect&rsquo;s business is invisible to most of the county —{" "}
            <strong className="hp-bad">that&rsquo;s your pitch</strong>.
          </p>
        </div>
      </section>

      {/* =================== FORM =================== */}
      <section id="form" className="hp-section hp-accent-purple">
        <div className="hp-section-head">
          <div className="hp-section-num">04</div>
          <h2>The scan form</h2>
          <p>These four fields live in the sidebar. Here&rsquo;s what to put in each.</p>
        </div>

        <div className="hp-mockup-row">
          <div className="hp-mockup">
            <div className="hp-form">
              <div className="hp-form-group">
                <Callout n={1} />
                <label>Target Business</label>
                <div className="hp-form-locked">
                  <strong>Simon&rsquo;s Heating &amp; Cooling Inc</strong>
                  <small>220 Commerce Dr, Leitchfield, KY 42754</small>
                </div>
              </div>
              <div className="hp-form-group">
                <Callout n={2} />
                <label>Keyword</label>
                <div className="hp-form-input">hvac near me</div>
              </div>
              <div className="hp-form-group hp-form-row">
                <div>
                  <Callout n={3} />
                  <label>Grid</label>
                  <div className="hp-form-input">7×7 — 49 pts ($1.57)</div>
                </div>
                <div>
                  <Callout n={4} />
                  <label>Radius</label>
                  <div className="hp-form-input">County — 14 mi</div>
                </div>
              </div>
              <div className="hp-form-group">
                <Callout n={5} />
                <button className="hp-form-btn">Run Scan</button>
              </div>
            </div>
          </div>

          <div className="hp-legend">
            <div className="hp-legend-row">
              <Callout n={1} />
              <div>
                <h4>Target Business</h4>
                <p>
                  Click <strong>Find Business</strong>, type a name, pick the
                  right match. Locks in Google&rsquo;s exact Place ID so typos
                  don&rsquo;t matter in future scans.
                </p>
              </div>
            </div>
            <div className="hp-legend-row">
              <Callout n={2} />
              <div>
                <h4>Keyword</h4>
                <p>
                  The search you want to watch. Type it the way a real customer
                  would: <code>hvac near me</code>,{" "}
                  <code>plumber leitchfield</code>, <code>roof repair</code>.
                </p>
              </div>
            </div>
            <div className="hp-legend-row">
              <Callout n={3} />
              <div>
                <h4>Grid</h4>
                <p>
                  Number of scan points. <strong>5×5</strong> is cheap and
                  rough ($0.80). <strong>7×7</strong> is the recommended
                  default ($1.57) — enough detail to see real patterns.
                </p>
              </div>
            </div>
            <div className="hp-legend-row">
              <Callout n={4} />
              <div>
                <h4>Radius</h4>
                <p>
                  How far the grid spreads from the county center.{" "}
                  <strong>County (14 mi)</strong> covers all of Grayson.{" "}
                  <strong>Tight (3 mi)</strong> is just Leitchfield.{" "}
                  <strong>Regional (25 mi)</strong> reaches neighboring
                  counties.
                </p>
              </div>
            </div>
            <div className="hp-legend-row">
              <Callout n={5} />
              <div>
                <h4>Run Scan</h4>
                <p>
                  Fires it off. About 30 seconds for a 7×7. Pins drop onto the
                  map live as each point finishes.
                </p>
              </div>
            </div>
          </div>
        </div>

        <div className="hp-takeaway">
          <span className="hp-takeaway-label">Takeaway</span>
          <p>
            Default every prospect scan to <strong>7×7 + County (14 mi)</strong>.
            Only change the radius if the business explicitly serves a tighter
            or wider area.
          </p>
        </div>
      </section>

      {/* =================== MAP =================== */}
      <section id="map" className="hp-section hp-accent-orange">
        <div className="hp-section-head">
          <div className="hp-section-num">05</div>
          <h2>Reading the map</h2>
          <p>Three patterns to look for when a scan finishes.</p>
        </div>

        <div className="hp-mockup-row">
          <div className="hp-mockup">
            <svg className="hp-map" viewBox="0 0 360 280" xmlns="http://www.w3.org/2000/svg">
              {/* county outline */}
              <path
                d="M40 80 L90 50 L190 40 L290 60 L320 110 L310 210 L260 250 L130 240 L60 210 L30 150 Z"
                fill="#334155"
                stroke="#3b82f6"
                strokeWidth="2"
                opacity="0.3"
              />
              {/* grid of pins — annotated regions */}
              {/* green dominance center */}
              {[
                { cx: 120, cy: 120, color: "#16a34a", rank: "1" },
                { cx: 160, cy: 120, color: "#16a34a", rank: "1" },
                { cx: 200, cy: 120, color: "#16a34a", rank: "2" },
                { cx: 120, cy: 155, color: "#16a34a", rank: "2" },
                { cx: 160, cy: 155, color: "#16a34a", rank: "1" },
                { cx: 200, cy: 155, color: "#16a34a", rank: "1" },
                { cx: 160, cy: 190, color: "#16a34a", rank: "3" },
                { cx: 200, cy: 190, color: "#eab308", rank: "5" },
                // yellow outer
                { cx: 80, cy: 120, color: "#eab308", rank: "6" },
                { cx: 80, cy: 155, color: "#eab308", rank: "7" },
                { cx: 240, cy: 120, color: "#eab308", rank: "4" },
                { cx: 240, cy: 155, color: "#eab308", rank: "8" },
                { cx: 120, cy: 85, color: "#eab308", rank: "9" },
                { cx: 160, cy: 85, color: "#eab308", rank: "5" },
                { cx: 200, cy: 85, color: "#eab308", rank: "7" },
                // orange edges
                { cx: 80, cy: 90, color: "#f97316", rank: "14" },
                { cx: 260, cy: 90, color: "#f97316", rank: "12" },
                { cx: 80, cy: 210, color: "#f97316", rank: "16" },
                { cx: 240, cy: 210, color: "#f97316", rank: "15" },
                // red dead zone NE
                { cx: 290, cy: 100, color: "#dc2626", rank: "20+" },
                { cx: 300, cy: 140, color: "#dc2626", rank: "20+" },
                { cx: 285, cy: 180, color: "#dc2626", rank: "20+" },
              ].map((p, i) => (
                <g key={i}>
                  <circle
                    cx={p.cx}
                    cy={p.cy}
                    r="13"
                    fill={p.color}
                    stroke="white"
                    strokeWidth="2"
                  />
                  <text
                    x={p.cx}
                    y={p.cy + 4}
                    textAnchor="middle"
                    fontSize="11"
                    fontWeight="700"
                    fill="white"
                  >
                    {p.rank}
                  </text>
                </g>
              ))}
              {/* annotated zones */}
              <g>
                <circle
                  cx="160"
                  cy="155"
                  r="62"
                  fill="none"
                  stroke="#16a34a"
                  strokeWidth="1.5"
                  strokeDasharray="4 3"
                  opacity="0.8"
                />
                <foreignObject x="100" y="225" width="130" height="22">
                  <div className="hp-map-tag green">① DOMINANT AREA</div>
                </foreignObject>
              </g>
              <g>
                <ellipse
                  cx="290"
                  cy="140"
                  rx="30"
                  ry="55"
                  fill="none"
                  stroke="#dc2626"
                  strokeWidth="1.5"
                  strokeDasharray="4 3"
                  opacity="0.8"
                />
                <foreignObject x="250" y="200" width="110" height="22">
                  <div className="hp-map-tag red">② DEAD ZONE</div>
                </foreignObject>
              </g>
              <g>
                <foreignObject x="18" y="48" width="100" height="22">
                  <div className="hp-map-tag blue">③ COUNTY EDGE</div>
                </foreignObject>
                <line
                  x1="60"
                  y1="70"
                  x2="58"
                  y2="80"
                  stroke="#3b82f6"
                  strokeWidth="1.5"
                />
              </g>
            </svg>
          </div>

          <div className="hp-legend">
            <div className="hp-legend-row">
              <span className="hp-dot green-dot">①</span>
              <div>
                <h4>Dominant area</h4>
                <p>
                  Tight cluster of green = you&rsquo;re winning here. Normal
                  pattern: ring of green around the business address, fading
                  to yellow at the edges.
                </p>
              </div>
            </div>
            <div className="hp-legend-row">
              <span className="hp-dot red-dot">②</span>
              <div>
                <h4>Dead zone</h4>
                <p>
                  Cluster of orange/red = neighborhood where you&rsquo;re
                  losing every call. <strong>This is the pitch hook</strong> —
                  &ldquo;you&rsquo;re invisible in [area].&rdquo;
                </p>
              </div>
            </div>
            <div className="hp-legend-row">
              <span className="hp-dot blue-dot">③</span>
              <div>
                <h4>County edge</h4>
                <p>
                  Ranks usually drop fast past the county line — you&rsquo;re
                  competing against businesses in the next county. Normal;
                  not usually worth pitching.
                </p>
              </div>
            </div>
          </div>
        </div>

        <div className="hp-takeaway">
          <span className="hp-takeaway-label">Takeaway</span>
          <p>
            The story is always{" "}
            <strong className="hp-bad">where they&rsquo;re losing</strong> +{" "}
            <strong>who&rsquo;s taking those calls</strong>. Point to a dead
            zone, name the competitor stealing it, and the pitch writes
            itself.
          </p>
        </div>
      </section>

      {/* =================== FAQ =================== */}
      <section id="faq" className="hp-section hp-accent-slate">
        <div className="hp-section-head">
          <div className="hp-section-num">06</div>
          <h2>Common questions</h2>
        </div>

        <div className="hp-faq-list">
          <details open>
            <summary>Why does the same zip code give different results?</summary>
            <p>
              Google ignores zip codes and uses GPS. Two people in the same zip
              but three miles apart see different top 3s because Google ranks
              by physical distance to each business from each searcher&rsquo;s
              exact location.
            </p>
          </details>
          <details>
            <summary>What if the searcher has location services off?</summary>
            <p>
              Google falls back to IP address or Google account history. Less
              precise but still location-based — the proximity rule still
              applies, just from a rougher point.
            </p>
          </details>
          <details>
            <summary>Does this work for businesses without a website?</summary>
            <p>
              Yes. As long as they have a Google Business Profile, it tracks.
              A missing website is actually a selling point — they&rsquo;re
              ranking on GBP alone.
            </p>
          </details>
          <details>
            <summary>Why can&rsquo;t I find my target business?</summary>
            <p>
              Small listings with few reviews sometimes don&rsquo;t surface in
              the Places API. Try a broader search like{" "}
              <code>hvac leitchfield</code> — if it appears there, click it.
            </p>
          </details>
          <details>
            <summary>How much does each scan cost?</summary>
            <p>
              7×7 scan = 49 calls × $0.032 = <strong>$1.57 per scan</strong>.
              Google gives $200/month free credit, so you pay $0 until you run
              127+ scans a month.
            </p>
          </details>
          <details>
            <summary>Why don&rsquo;t I see my usage in Google Cloud yet?</summary>
            <p>
              Billing reports lag by 6–24 hours. The Metrics page (APIs &amp;
              Services → Metrics) updates within about an hour. Quotas update
              near real-time.
            </p>
          </details>
          <details>
            <summary>Is my API key safe?</summary>
            <p>
              It lives in <code>.env.local</code> on your machine, never sent
              to the browser, never committed to git. Only Google sees it.
              Add a <strong>$5 hard billing cap</strong> in Google Cloud for
              extra safety.
            </p>
          </details>
        </div>
      </section>

      <footer className="hp-footer">
        <Link href="/" className="hp-back-btn">
          ← Back to the map
        </Link>
      </footer>
    </div>
  );
}

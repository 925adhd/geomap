"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Playfair_Display, Inter } from "next/font/google";
import "./audit.css";

const playfair = Playfair_Display({
  subsets: ["latin"],
  variable: "--font-playfair",
  display: "swap",
});
const inter = Inter({
  subsets: ["latin"],
  weight: ["300", "400", "500", "600", "700"],
  variable: "--font-inter",
  display: "swap",
});

type Status =
  | "idle"
  | "resolving"
  | "confirming"
  | "scanning"
  | "redirecting"
  | "error";

type ResolvedTarget = {
  placeId: string;
  name: string;
  address: string;
  location: { latitude: number; longitude: number } | null;
};

// The grid is 49 calls; the server runs them with 5-way concurrency and
// usually finishes in 5–15s. The progress bar here is decorative — it
// asymptotes to ~92% so we never look "stuck at 100" before the server
// actually returns.
const PROGRESS_DURATION_MS = 22_000;

// Render an error string with any email address inside it linkified
// as a mailto. Lets the budget/rate-limit message ("...email
// kara@studio925.design...") give the user a one-click contact path
// without us hand-crafting JSX in every callsite.
const EMAIL_RE = /([\w.+-]+@[\w-]+\.[\w.-]+)/;
function renderErrorWithMailto(text: string) {
  return text.split(EMAIL_RE).map((part, i) =>
    EMAIL_RE.test(part) ? (
      <a key={i} href={`mailto:${part}`} className="au-error-link">
        {part}
      </a>
    ) : (
      part
    )
  );
}

function MapMockup() {
  return (
    <figure
      className="fl-mockup"
      aria-label="Sample local rank heatmap report for a Grayson County, Kentucky car dealership"
    >
      <div className="fl-mockup-intro">
        Real heatmap from a car dealership right here in Leitchfield, KY.
      </div>
      <img
        src="/audit-sample-heatmap.webp"
        alt="Sample local rank heatmap showing a Leitchfield car dealership ranking #2 at its own location with surrounding points ranging from top 3 to not found"
        width={810}
        height={600}
        loading="eager"
        fetchPriority="high"
        className="fl-mockup-image"
      />
      <figcaption className="fl-mockup-caption fl-mockup-caption--attr-only">
        Map © OpenStreetMap contributors. Ranking data powered by Google.
      </figcaption>
    </figure>
  );
}

export default function AuditPage() {
  const router = useRouter();
  const [businessName, setBusinessName] = useState("");
  const [keyword, setKeyword] = useState("");
  const [honeypot, setHoneypot] = useState("");
  const [status, setStatus] = useState<Status>("idle");
  const [error, setError] = useState<string | null>(null);
  const [progress, setProgress] = useState(0);
  const [target, setTarget] = useState<ResolvedTarget | null>(null);
  const startedAt = useRef<number>(0);

  useEffect(() => {
    if (status !== "scanning") return;
    startedAt.current = Date.now();
    const id = setInterval(() => {
      const elapsed = Date.now() - startedAt.current;
      const pct = 92 * (1 - Math.exp(-elapsed / (PROGRESS_DURATION_MS / 3)));
      setProgress(pct);
    }, 200);
    return () => clearInterval(id);
  }, [status]);

  // Scroll to top whenever the page swaps to a different view (confirm
  // card, scanning panel). Without this, React replaces the form with
  // the new content but the browser keeps its scroll position, so a
  // visitor who'd scrolled down to fill out the form never sees the
  // new view appear above them.
  useEffect(() => {
    if (status === "confirming" || status === "scanning") {
      window.scrollTo({ top: 0, behavior: "smooth" });
    }
  }, [status]);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (status === "resolving" || status === "scanning" || status === "redirecting") return;
    setError(null);

    if (honeypot) {
      // Honeypot tripped: pretend success silently. Bots never get a report.
      setStatus("redirecting");
      return;
    }

    if (!keyword.trim()) {
      setError("Please add the keyword you want tracked (e.g. 'plumber near me').");
      return;
    }

    setStatus("resolving");

    try {
      const res = await fetch("/api/auto-scan", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          step: "resolve",
          businessName,
          keyword,
          honeypot: honeypot || undefined,
        }),
      });

      let data: {
        reportPath?: string;
        target?: ResolvedTarget;
        error?: string;
        code?: string;
        deduped?: boolean;
      } = {};
      try {
        data = await res.json();
      } catch {
        /* ignore parse failures */
      }

      if (!res.ok) {
        // Trust the server's user-facing message — it already names the
        // "email kara" path. Generic fallback only fires when the server
        // returned non-ok without a JSON body (rare, network-edge case).
        const msg =
          data.error ||
          "Something went wrong on our end. Please try again in a moment.";
        setStatus("error");
        setError(msg);
        return;
      }

      // Already-scanned-this-email: server returned the existing report path
      // so we just bounce them straight there.
      if (data.reportPath) {
        setProgress(100);
        setStatus("redirecting");
        router.push(data.reportPath);
        return;
      }

      if (!data.target) {
        setStatus("error");
        setError("Couldn't look up that business. Please try again.");
        return;
      }

      setTarget(data.target);
      setStatus("confirming");
    } catch (err) {
      setStatus("error");
      setError((err as Error).message || "Network error. Please try again.");
    }
  }

  async function confirmAndScan() {
    if (!target) return;
    setError(null);
    setStatus("scanning");
    setProgress(2);

    try {
      const res = await fetch("/api/auto-scan", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          step: "scan",
          businessName,
          keyword,
          target,
        }),
      });

      let data: { reportPath?: string; error?: string; code?: string } = {};
      try {
        data = await res.json();
      } catch {
        /* ignore parse failures */
      }

      if (!res.ok || !data.reportPath) {
        const msg =
          data.error ||
          "Something went wrong on our end. Please try again in a moment.";
        setStatus("error");
        setError(msg);
        return;
      }

      setProgress(100);
      setStatus("redirecting");
      router.push(data.reportPath);
    } catch (err) {
      setStatus("error");
      setError((err as Error).message || "Network error. Please try again.");
    }
  }

  function rejectMatch() {
    setTarget(null);
    setStatus("idle");
    setError(null);
  }

  const isBusy =
    status === "resolving" ||
    status === "scanning" ||
    status === "redirecting";
  const showForm = status === "idle" || status === "error" || status === "resolving";
  const showScanning = status === "scanning" || status === "redirecting";

  return (
    <div className={`${playfair.variable} ${inter.variable} fl`}>
      <header className="fl-site-header">
        <div className="fl-site-header-inner">
          <a href="https://studio925.design" className="fl-site-logo">
            <img
              src="/logo.webp"
              alt="Studio 925, Custom Web Design in Kentucky"
              width={162}
              height={56}
              className="fl-site-logo-img"
            />
            <span className="fl-site-tagline">Custom Web Design</span>
          </a>
          <a
            href="https://studio925.design/#contact"
            className="fl-site-cta"
          >
            Contact Kara <span aria-hidden>→</span>
          </a>
        </div>
      </header>

      <main className="fl-main">
        <article className="fl-doc">
          {showForm && (
            <>
              <section className="fl-hero">
                <p className="fl-eyebrow">
                  Free ranking audit · Grayson County, KY
                </p>
                <h1 className="fl-hero-title">
                  Find out <em>exactly</em> where you rank on Google.
                </h1>
                <p className="fl-hero-sub">
                  A block-by-block map of your service area.
                </p>
              </section>

              <div className="fl-problem-map">
                <MapMockup />

                <section className="fl-problem">
                  <div className="fl-problem-ink">THE PROBLEM</div>
                  <p>
                    When a customer Googles &ldquo;car dealership near
                    me,&rdquo; the top results change based on where
                    they&rsquo;re standing. Someone three miles north of
                    you sees a different list than someone three miles
                    south. You&rsquo;re losing customers in parts of town
                    you don&rsquo;t even know about.
                  </p>
                </section>
              </div>

              <section className="fl-what">
                <h2>
                  What you&rsquo;ll <em>get</em>
                </h2>
                <div className="fl-bullets">
                  <div className="fl-bullet">
                    <div className="fl-bullet-num">01</div>
                    <h3>A real map</h3>
                    <p>
                      <span className="fl-desktop-only">
                        49 scan points across a 20-mile radius around your
                        business, each showing your exact rank for the
                        keyword customers are typing.
                      </span>
                      <span className="fl-mobile-only">
                        Local heatmap of your business showing your rank in
                        that exact area for the keyword customers are
                        typing.
                      </span>
                    </p>
                  </div>
                  <div className="fl-bullet">
                    <div className="fl-bullet-num">02</div>
                    <h3>A real number</h3>
                    <p>
                      How many times you show up first, where you don&rsquo;t,
                      and how many customers are picking someone else.
                    </p>
                  </div>
                  <div className="fl-bullet">
                    <div className="fl-bullet-num">03</div>
                    <h3>Real rivals</h3>
                    <p>
                      The exact businesses winning your customers, block by
                      block.
                    </p>
                  </div>
                </div>
              </section>

              <section className="fl-why-free">
                <div className="fl-why-free-tag">WHY IT&rsquo;S FREE</div>
                <p>
                  I&rsquo;d rather show you the problem than sell you one. If
                  you want it fixed, that&rsquo;s what I do. If not, the map
                  and report are yours.
                </p>
                <p>
                  Most weak spots aren&rsquo;t because your business is bad.
                  They mean your website isn&rsquo;t doing its job. Customers
                  pick what shows up first, not who&rsquo;s best.
                </p>
                <p className="fl-why-free-lead">Studio 925 fixes that.</p>
                <p>
                  You run the business. I keep customers <em>coming</em>.
                </p>
              </section>

              <form className="au-form-inline" onSubmit={submit} noValidate>
                <div className="au-form-label">GET YOUR FREE AUDIT</div>

                <label>
                  Business name
                  <input
                    type="text"
                    required
                    value={businessName}
                    onChange={(e) => setBusinessName(e.target.value)}
                    placeholder="Your business name"
                    autoComplete="organization"
                    disabled={isBusy}
                  />
                </label>

                <label>
                  Keyword to track
                  <input
                    type="text"
                    required
                    value={keyword}
                    onChange={(e) => setKeyword(e.target.value)}
                    placeholder="e.g., hvac near me"
                    disabled={isBusy}
                  />
                </label>

                <label className="au-honey" aria-hidden>
                  Leave blank
                  <input
                    type="text"
                    tabIndex={-1}
                    autoComplete="off"
                    value={honeypot}
                    onChange={(e) => setHoneypot(e.target.value)}
                  />
                </label>

                <button
                  type="submit"
                  className="au-submit"
                  disabled={isBusy}
                >
                  {status === "resolving" ? "Looking you up…" : "Run my free audit →"}
                </button>

                {error && (
                  <div className="au-error">
                    {renderErrorWithMailto(error)}
                  </div>
                )}

                <p className="au-fine">
                  <strong>
                    Your business must have a Google Business Profile.
                  </strong>{" "}
                  Brand-new or unlisted businesses won&rsquo;t produce
                  useful data yet.{" "}
                  {/* GBP link gets its own line on mobile via .au-fine-gbp
                      so it doesn't dangle as orphaned text after a wrap. */}
                  <span className="au-fine-gbp">
                    <a
                      href="https://business.google.com"
                      target="_blank"
                      rel="noopener noreferrer"
                    >
                      Create one here
                    </a>
                    .
                  </span>
                </p>
              </form>
            </>
          )}

          {status === "confirming" && target && (
            <section className="au-confirm" aria-live="polite">
              <div className="au-confirm-tag">CHECK BEFORE WE SCAN</div>
              <h1>Is this you?</h1>
              <div className="au-confirm-card">
                <div className="au-confirm-card-name">{target.name}</div>
                {target.address && (
                  <div className="au-confirm-card-addr">{target.address}</div>
                )}
              </div>
              <p>
                We&rsquo;ll run the 49-point scan against this Google
                Business Profile and the keyword{" "}
                <em>&ldquo;{keyword}&rdquo;</em>. Make sure it&rsquo;s
                yours, since your audit will be tied to this match.
              </p>
              <div className="au-confirm-actions">
                <button
                  type="button"
                  className="au-submit"
                  onClick={confirmAndScan}
                >
                  Yes, that&rsquo;s me. Start the scan →
                </button>
                <button
                  type="button"
                  className="au-confirm-back"
                  onClick={rejectMatch}
                >
                  No, let me try a different name
                </button>
              </div>
            </section>
          )}

          {showScanning && (
            <section className="au-thanks" aria-live="polite">
              <h1>
                {status === "redirecting"
                  ? "Map ready. Opening it now…"
                  : "Scanning Grayson County for you…"}
              </h1>
              <p>
                We&rsquo;re checking{" "}
                <strong>{businessName || "your business"}</strong> against{" "}
                <em>&ldquo;{keyword}&rdquo;</em> at 49 points across a
                20-mile radius. This usually takes about 30 seconds.
              </p>
              <div
                className="au-progress"
                role="progressbar"
                aria-valuemin={0}
                aria-valuemax={100}
                aria-valuenow={Math.round(progress)}
              >
                <div
                  className="au-progress-fill"
                  style={{ width: `${progress}%` }}
                />
              </div>
              <p className="au-thanks-sub">
                Don&rsquo;t close this tab. Your report opens automatically
                when the scan finishes.
              </p>
            </section>
          )}
        </article>
      </main>

      <footer className="fl-site-footer">
        <div className="fl-site-footer-inner">
          <div className="fl-site-footer-brand">
            <img
              src="/logo.webp"
              alt="Studio 925, Custom Web Design in Kentucky"
              width={162}
              height={56}
              loading="lazy"
              className="fl-site-footer-logo"
            />
            <p className="fl-site-footer-tag">
              Your website should work{" "}
              <em>as hard as you&nbsp;do.</em>
            </p>
            <p className="fl-site-footer-loc">
              Custom websites built right.
              <br />
              Web designer in Leitchfield, KY.
            </p>
            <a
              href="https://www.facebook.com/studio925design"
              target="_blank"
              rel="noopener noreferrer"
              className="fl-site-footer-fb"
              aria-label="Studio 925 on Facebook"
            >
              <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor" aria-hidden>
                <path d="M24 12.073c0-6.627-5.373-12-12-12s-12 5.373-12 12c0 5.99 4.388 10.954 10.125 11.854v-8.385H7.078v-3.47h3.047V9.43c0-3.007 1.792-4.669 4.533-4.669 1.312 0 2.686.235 2.686.235v2.953H15.83c-1.491 0-1.956.925-1.956 1.874v2.25h3.328l-.532 3.47h-2.796v8.385C19.612 23.027 24 18.062 24 12.073z" />
              </svg>
              Facebook
            </a>
            <div className="fl-site-footer-badges">
              <a
                href="https://pagespeed.web.dev/analysis?url=https%3A%2F%2Fstudio925.design"
                target="_blank"
                rel="noopener noreferrer"
                aria-label="Verify Studio 925's Google PageSpeed score in a new tab"
                className="fl-site-footer-badge-pagespeed"
              >
                <img
                  src="/badge-pagespeed-99.svg"
                  alt="90+ Google PageSpeed Performance Score"
                  width={120}
                  height={140}
                  loading="lazy"
                />
                <span>Test it yourself →</span>
              </a>
              <img
                src="/badge-stripe.svg"
                alt="Powered by Stripe"
                width={150}
                height={34}
                loading="lazy"
                className="fl-site-footer-badge-stripe"
              />
            </div>
          </div>

          <div className="fl-site-footer-legal">
            <p className="fl-site-footer-disclaimer">
              Studio 925 builds websites designed to improve online
              visibility and help businesses attract customers. Results
              such as search rankings, traffic, leads, and revenue are
              not guaranteed.{" "}
              <a
                href="https://studio925.design/disclaimer"
                target="_blank"
                rel="noopener noreferrer"
              >
                Read our full disclaimer
              </a>
              .
            </p>
            <ul className="fl-site-footer-links">
              <li>
                <a
                  href="https://studio925.design/privacy-policy"
                  target="_blank"
                  rel="noopener noreferrer"
                >
                  Privacy Policy
                </a>
              </li>
              <li>
                <a
                  href="https://studio925.design/terms-of-service"
                  target="_blank"
                  rel="noopener noreferrer"
                >
                  Terms of Service
                </a>
              </li>
              <li>
                <a
                  href="https://studio925.design/cookie-policy"
                  target="_blank"
                  rel="noopener noreferrer"
                >
                  Cookie Policy
                </a>
              </li>
              <li>
                <a
                  href="https://studio925.design/disclaimer"
                  target="_blank"
                  rel="noopener noreferrer"
                >
                  Disclaimer
                </a>
              </li>
            </ul>
            <p className="fl-site-footer-copy">
              © {new Date().getFullYear()} Studio 925 Web Design. A
              service operated by 925 ADHD LLC. All rights reserved.
            </p>
          </div>
        </div>
      </footer>
    </div>
  );
}

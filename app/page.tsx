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
        alt="Sample local rank heatmap showing a Leitchfield car dealership ranking #2 at its own location with surrounding points ranging from top 3 to not found, plus a top competitors breakdown"
        width={810}
        height={970}
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
  const [email, setEmail] = useState("");
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [keyword, setKeyword] = useState("");
  const [notes, setNotes] = useState("");
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
          email,
          name: name || undefined,
          phone: phone || undefined,
          keyword,
          notes: notes || undefined,
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
        // Trust the server's user-facing message (it's already vague enough
        // to not leak which limit fired). Generic fallback only if the
        // server didn't include one.
        const msg =
          data.error ||
          "Free audits aren't available right now. Email kara@studio925.design and I'll set one up for you.";
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
          email,
          name: name || undefined,
          phone: phone || undefined,
          keyword,
          notes: notes || undefined,
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
          "Free audits aren't available right now. Email kara@studio925.design and I'll set one up for you.";
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
      <main>
        <article className="fl-doc">
          {showForm && (
            <>
              <section className="fl-hero">
                <p className="fl-eyebrow">
                  Free for Grayson County, KY · Local Geomap Audit
                </p>
                <h1 className="fl-hero-title">
                  Find out <em>exactly</em> where you rank on Google.
                </h1>
                <p className="fl-hero-sub">
                  A free block-by-block map of how your business shows up
                  when nearby customers search. No subscription, no catch.
                </p>
              </section>

              <section className="fl-problem">
                <div className="fl-problem-ink">THE PROBLEM</div>
                <p>
                  When a customer Googles &ldquo;plumber near me,&rdquo; the
                  top results change based on where they&rsquo;re standing.
                  Someone three miles north of you sees a different list
                  than someone three miles south. You&rsquo;re losing calls
                  in parts of town you didn&rsquo;t even know you were
                  losing.
                </p>
              </section>

              <MapMockup />

              <section className="fl-what">
                <h2>
                  What you&rsquo;ll <em>get</em>
                </h2>
                <div className="fl-bullets">
                  <div className="fl-bullet">
                    <div className="fl-bullet-num">01</div>
                    <h3>A real map</h3>
                    <p>
                      49 scan points across a 20-mile radius around your
                      business, each showing your exact rank for the
                      keyword customers are typing.
                    </p>
                  </div>
                  <div className="fl-bullet">
                    <div className="fl-bullet-num">02</div>
                    <h3>A real number</h3>
                    <p>
                      Visibility score from 0 to 100, average rank, top-3
                      percentage. The same metrics paid rank trackers
                      charge $25/month for.
                    </p>
                  </div>
                  <div className="fl-bullet">
                    <div className="fl-bullet-num">03</div>
                    <h3>Real rivals</h3>
                    <p>
                      Names of the businesses taking the calls you should
                      be getting, neighborhood by neighborhood.
                    </p>
                  </div>
                </div>
              </section>

              <section className="fl-why-free">
                <div className="fl-why-free-tag">WHY IT&rsquo;S FREE</div>
                <p>
                  If you like the map, fixing it is what I do. The report
                  is yours to keep.
                </p>
                <p>
                  Most weak spots aren&rsquo;t a sign your business is bad.
                  They mean your website isn&rsquo;t doing its job, so
                  calls go to people who aren&rsquo;t even better than
                  you.
                </p>
                <p className="fl-why-free-lead">Studio 925 fixes that:</p>
                <ul className="fl-why-free-list">
                  <li>
                    Foundation site, <strong>$900</strong>, fast and
                    Google-ready
                  </li>
                  <li>
                    Growth, <strong>$1,800</strong>, adds dedicated service
                    pages, hands-on SEO audit, and lead tracking
                  </li>
                  <li>
                    <em>You own everything the day it launches</em>
                  </li>
                  <li>No retainers, no monthly packages, no learning curve</li>
                </ul>
                <p>
                  Stay on{" "}
                  <a
                    href="https://studio925.design/hosting-support"
                    target="_blank"
                    rel="noopener noreferrer"
                    className="fl-upsell"
                  >
                    Full Support hosting
                  </a>{" "}
                  after launch and I keep showing up. A new service page or
                  two blog posts each month on the keywords you&rsquo;re
                  losing, plus a 63-point rescan to track progress. You run
                  the business. I keep the phone <em>ringing</em>.
                </p>
                <p className="fl-why-free-cta">
                  Get the audit first. Decide after.
                </p>
              </section>

              <form className="au-form-inline" onSubmit={submit} noValidate>
                <div className="au-form-label">GET YOUR FREE AUDIT</div>
                <p className="au-form-sub">
                  Fill this out. Your map appears in about 30 seconds.
                </p>

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
                  Your email
                  <input
                    type="email"
                    required
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    placeholder="you@yourbusiness.com"
                    autoComplete="email"
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

                <div className="au-row">
                  <label>
                    Your name <span className="au-opt">(optional)</span>
                    <input
                      type="text"
                      value={name}
                      onChange={(e) => setName(e.target.value)}
                      placeholder="First name"
                      autoComplete="given-name"
                      disabled={isBusy}
                    />
                  </label>

                  <label>
                    Phone <span className="au-opt">(optional)</span>
                    <input
                      type="tel"
                      value={phone}
                      onChange={(e) => setPhone(e.target.value)}
                      placeholder="(270) 555-0000"
                      autoComplete="tel"
                      disabled={isBusy}
                    />
                  </label>
                </div>

                <label>
                  Anything else? <span className="au-opt">(optional)</span>
                  <textarea
                    rows={3}
                    value={notes}
                    onChange={(e) => setNotes(e.target.value)}
                    placeholder="Service area, specific competitors, goals…"
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

                {error && <div className="au-error">{error}</div>}

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
                yours — your audit will be tied to this match.
              </p>
              <div className="au-confirm-actions">
                <button
                  type="button"
                  className="au-submit"
                  onClick={confirmAndScan}
                >
                  Yes, that&rsquo;s me — start the scan →
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
                  ? "Map ready — opening it now…"
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
                Don&rsquo;t close this tab — your report opens automatically
                when the scan finishes.
              </p>
            </section>
          )}
        </article>
      </main>
    </div>
  );
}

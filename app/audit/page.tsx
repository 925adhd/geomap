"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Fraunces, IBM_Plex_Sans } from "next/font/google";

const fraunces = Fraunces({
  subsets: ["latin"],
  variable: "--fl-display",
  display: "swap",
});
const plex = IBM_Plex_Sans({
  subsets: ["latin"],
  weight: ["300", "400", "500", "600", "700"],
  variable: "--fl-body",
  display: "swap",
});

type Status = "idle" | "scanning" | "redirecting" | "error";

// The grid is 49 calls. With 5-way concurrency on the server it finishes
// in 5–15 seconds; we still show a fake-ish progress curve here because
// silent buttons feel broken. The bar isn't a real percentage, just a
// reassuring "we're working on it" indicator that never reaches 100%
// before the server actually returns.
const PROGRESS_DURATION_MS = 22_000;

export default function AuditPage() {
  const router = useRouter();
  const [businessName, setBusinessName] = useState("");
  const [email, setEmail] = useState("");
  const [phone, setPhone] = useState("");
  const [keyword, setKeyword] = useState("");
  const [notes, setNotes] = useState("");
  const [honeypot, setHoneypot] = useState("");
  const [status, setStatus] = useState<Status>("idle");
  const [error, setError] = useState<string | null>(null);
  const [progress, setProgress] = useState(0);
  const startedAt = useRef<number>(0);

  useEffect(() => {
    if (status !== "scanning") return;
    startedAt.current = Date.now();
    const id = setInterval(() => {
      const elapsed = Date.now() - startedAt.current;
      // Asymptote at ~92% so we never look "stuck at 100".
      const pct = 92 * (1 - Math.exp(-elapsed / (PROGRESS_DURATION_MS / 3)));
      setProgress(pct);
    }, 200);
    return () => clearInterval(id);
  }, [status]);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (status === "scanning") return;
    setError(null);

    if (honeypot) {
      // Pretend success silently; bots don't get an actual report.
      setStatus("redirecting");
      return;
    }

    if (!keyword.trim()) {
      setError("Please tell us the keyword you want tracked (e.g. 'plumber near me').");
      return;
    }

    setStatus("scanning");
    setProgress(2);

    try {
      const res = await fetch("/api/auto-scan", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          businessName,
          email,
          phone: phone || undefined,
          keyword,
          notes: notes || undefined,
          honeypot: honeypot || undefined,
        }),
      });

      let data: { reportPath?: string; error?: string; code?: string } = {};
      try {
        data = await res.json();
      } catch {
        /* keep empty */
      }

      if (!res.ok || !data.reportPath) {
        const msg =
          data.error ||
          (res.status === 429
            ? "Too many requests. Please try again later."
            : `Something went wrong (HTTP ${res.status}). Please try again.`);
        setStatus("error");
        setError(msg);
        return;
      }

      setProgress(100);
      setStatus("redirecting");
      router.push(data.reportPath);
    } catch (e) {
      setStatus("error");
      setError((e as Error).message || "Network error. Please try again.");
    }
  }

  const isBusy = status === "scanning" || status === "redirecting";

  return (
    <div className={`${fraunces.variable} ${plex.variable} fl`}>
      <article className="fl-doc">
        <header className="fl-head">
          <div className="fl-brand">GEOMAP LOCAL</div>
          <div className="fl-kicker">GRAYSON COUNTY, KY · 2026</div>
        </header>

        {status !== "scanning" && status !== "redirecting" && (
          <>
            <section className="fl-hero">
              <div className="fl-hero-tag">
                FREE FOR GRAYSON COUNTY BUSINESSES
              </div>
              <h1 className="fl-hero-title">
                Find out <em>exactly</em>
                <br />
                where you rank on Google.
              </h1>
              <p className="fl-hero-sub">
                A free block-by-block map of how your business shows up when
                nearby customers search — no subscription, no catch.
              </p>
            </section>

            <section className="fl-problem">
              <div className="fl-problem-ink">THE PROBLEM</div>
              <p>
                When a customer Googles &ldquo;plumber near me,&rdquo; the top
                results change based on where they&rsquo;re standing. Someone
                three miles north of you sees a different list than someone
                three miles south. You&rsquo;re losing calls in parts of town
                you didn&rsquo;t even know you were losing.
              </p>
            </section>

            <section className="fl-what">
              <h2>What you&rsquo;ll get</h2>
              <div className="fl-bullets">
                <div className="fl-bullet">
                  <div className="fl-bullet-num">01</div>
                  <h3>A real map</h3>
                  <p>
                    49 scan points across a 15-mile radius around your
                    business, each showing your exact rank for the keyword
                    customers are typing.
                  </p>
                </div>
                <div className="fl-bullet">
                  <div className="fl-bullet-num">02</div>
                  <h3>A real number</h3>
                  <p>
                    Visibility score from 0 to 100, average rank, top-3
                    percentage — the same metrics paid rank trackers charge
                    $25/month for.
                  </p>
                </div>
                <div className="fl-bullet">
                  <div className="fl-bullet-num">03</div>
                  <h3>Real rivals</h3>
                  <p>
                    Names of the businesses taking the calls you should be
                    getting, neighborhood by neighborhood.
                  </p>
                </div>
              </div>
            </section>

            <section className="fl-why-free">
              <div className="fl-why-free-tag">WHY IT&rsquo;S FREE</div>
              <p>
                The map shows you where you&rsquo;re losing calls. Studio 925
                builds or rebuilds your site — fast, mobile-first, and{" "}
                <em>built to rank</em> — flat $900 starting price, live in
                about a week.
              </p>
              <p>
                Stay on{" "}
                <strong className="fl-upsell">Full Support hosting</strong>{" "}
                and you have me on your team as an ongoing SEO partner — new
                service pages, blog posts, meta tags, and Google indexing
                handled every month. Plus denser 63-point rescans with a
                detailed competitor breakdown at every single point of your
                map.
              </p>
              <p className="fl-why-free-cta">
                Get the audit first. Decide after.
              </p>
            </section>

            <form className="au-form-inline" onSubmit={submit} noValidate>
              <div className="au-form-label">GET YOUR FREE AUDIT</div>
              <p className="au-form-sub">
                Fill this out. Your map will appear in about 30 seconds.
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

              <div className="au-row">
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
                {isBusy ? "Running your scan…" : "Run my free audit →"}
              </button>

              {error && <div className="au-error">{error}</div>}

              <p className="au-fine">
                No credit card. No subscription. One free audit per email.
                <br />
                <strong>
                  Your business must have a Google Business Profile
                </strong>{" "}
                — ideally with a handful of reviews. Brand-new or unlisted
                businesses won&rsquo;t produce useful data yet.{" "}
                <a
                  href="https://business.google.com"
                  target="_blank"
                  rel="noopener noreferrer"
                  style={{
                    color: "var(--fl-blue)",
                    textDecoration: "underline",
                  }}
                >
                  Create one here
                </a>
                .
              </p>
            </form>

          </>
        )}

        {(status === "scanning" || status === "redirecting") && (
          <section className="au-thanks" aria-live="polite">
            <h1>
              {status === "redirecting"
                ? "Map ready — opening it now…"
                : "Scanning Grayson County for you…"}
            </h1>
            <p>
              We&rsquo;re checking <strong>{businessName || "your business"}</strong>{" "}
              against <em>&ldquo;{keyword}&rdquo;</em> at 49 points across a
              15-mile radius. This usually takes about 30 seconds.
            </p>
            <div
              role="progressbar"
              aria-valuemin={0}
              aria-valuemax={100}
              aria-valuenow={Math.round(progress)}
              style={{
                width: "100%",
                maxWidth: 480,
                margin: "32px auto",
                height: 8,
                background: "rgba(20,22,26,0.08)",
                borderRadius: 999,
                overflow: "hidden",
              }}
            >
              <div
                style={{
                  width: `${progress}%`,
                  height: "100%",
                  background: "var(--fl-blue, #1e3a5f)",
                  transition: "width 250ms ease-out",
                }}
              />
            </div>
            <p className="au-thanks-sub">
              Don&rsquo;t close this tab — your report opens automatically when
              the scan finishes.
            </p>
          </section>
        )}

        <footer className="fl-foot">
          <div>Powered by Google</div>
          <div>GEOMAP LOCAL · BY STUDIO 925</div>
        </footer>
      </article>
    </div>
  );
}

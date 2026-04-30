"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

type Props = {
  timestamp: string;
  businessName: string;
};

export function UnlockForm({ timestamp, businessName }: Props) {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [name, setName] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (submitting) return;
    setError(null);

    if (!email.trim()) {
      setError("Please enter your email.");
      return;
    }

    setSubmitting(true);
    try {
      const res = await fetch("/api/auto-scan/unlock", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          timestamp,
          email: email.trim(),
          name: name.trim() || undefined,
        }),
      });
      let data: { error?: string } = {};
      try {
        data = await res.json();
      } catch {
        /* ignore parse failures */
      }
      if (!res.ok) {
        setError(
          data.error ||
            "Something went wrong on our end. Please try again in a moment."
        );
        setSubmitting(false);
        return;
      }
      // Server-rendered page; refresh to re-fetch the now-unlocked scan
      // and render the full report. Scroll to top first so the visitor
      // sees the full report from the start, not the pricing CTA that
      // replaced the unlock form they were sitting on.
      window.scrollTo({ top: 0, behavior: "smooth" });
      router.refresh();
    } catch (err) {
      setError((err as Error).message || "Network error. Please try again.");
      setSubmitting(false);
    }
  }

  return (
    <form className="rp-unlock" onSubmit={submit} noValidate>
      <div className="rp-unlock-tag">UNLOCK THE FULL REPORT</div>
      <h2 className="rp-unlock-headline">
        See <em>who&rsquo;s</em> beating {businessName}, and how to fix it.
      </h2>
      <p className="rp-unlock-sub">
        Enter your email to unlock your visibility score, the rivals capturing
        your customers, and where to start. Free, no spam.
      </p>

      <div className="rp-unlock-fields">
        <label className="rp-unlock-label">
          <span>Your email</span>
          <input
            type="email"
            required
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="you@yourbusiness.com"
            autoComplete="email"
            disabled={submitting}
          />
        </label>
        <label className="rp-unlock-label">
          <span>
            First name <em className="rp-unlock-opt">(optional)</em>
          </span>
          <input
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="First name"
            autoComplete="given-name"
            disabled={submitting}
          />
        </label>
      </div>

      <button type="submit" className="rp-unlock-submit" disabled={submitting}>
        {submitting ? "Unlocking…" : "Unlock my full report →"}
      </button>

      {error && <div className="rp-unlock-error">{error}</div>}

      <p className="rp-unlock-fine">
        I&rsquo;ll only use this to send your report and the occasional
        follow-up. Unsubscribe anytime.
      </p>
    </form>
  );
}

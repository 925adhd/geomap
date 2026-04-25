import { resolveMx } from "node:dns/promises";

// Anti-abuse email validation for the public audit form. Layered checks:
//   1. Normalize  — collapse `foo+tag@gmail.com` and `f.o.o@gmail.com`
//                   variants to one canonical form, so the lifetime
//                   per-email dedup catches all of them.
//   2. Disposable — reject the obvious throwaway providers (mailinator,
//                   10minutemail, etc) by domain.
//   3. MX check   — verify the email's domain has at least one MX record,
//                   so `asdf@notarealdomain.zzz` and similar fail before
//                   we burn a Places call on them.
//
// All three combined raise the bar enough that drive-by abuse usually
// moves on. They don't catch a determined attacker who buys a domain
// and runs their own mail server — that's what email-confirmation flows
// are for, but those add real UX friction. This file is the cheap layer.

// Curated list of the most common disposable / temporary inbox services.
// Keep small and maintainable; longer lists exist on GitHub if abuse
// patterns ever require it.
const DISPOSABLE_DOMAINS = new Set<string>([
  "10minutemail.com",
  "10minutemail.net",
  "20minutemail.com",
  "anonbox.net",
  "burnermail.io",
  "discard.email",
  "discardmail.com",
  "dispostable.com",
  "emailondeck.com",
  "fakeinbox.com",
  "fakemail.net",
  "fake-mail.com",
  "getairmail.com",
  "getnada.com",
  "grr.la",
  "guerrillamail.biz",
  "guerrillamail.com",
  "guerrillamail.de",
  "guerrillamail.info",
  "guerrillamail.net",
  "guerrillamail.org",
  "inboxbear.com",
  "inboxkitten.com",
  "mailcatch.com",
  "maildrop.cc",
  "mailinater.com",
  "mailinator.com",
  "mailnesia.com",
  "mintemail.com",
  "moakt.cc",
  "moakt.com",
  "mohmal.com",
  "mt2014.com",
  "mvrht.com",
  "nada.email",
  "sharklasers.com",
  "spam4.me",
  "spambox.us",
  "spambox.xyz",
  "tempemail.com",
  "tempemail.net",
  "tempmail.com",
  "tempmail.io",
  "tempmail.net",
  "temp-mail.org",
  "tempr.email",
  "throwaway-mail.com",
  "throwawaymail.com",
  "tmail.ws",
  "trashmail.com",
  "trashmail.de",
  "trashmail.net",
  "yopmail.com",
  "yopmail.fr",
  "yopmail.net",
]);

export function normalizeEmail(email: string): string {
  const lower = email.trim().toLowerCase();
  const at = lower.indexOf("@");
  if (at === -1) return lower;
  let local = lower.slice(0, at);
  const domain = lower.slice(at + 1);
  // Strip `+tag` suffix — used by Gmail, Outlook, FastMail, ProtonMail,
  // and most other providers as sub-addressing. `foo+anything@x.com`
  // routes to `foo@x.com`, so they're the same person for our purposes.
  const plus = local.indexOf("+");
  if (plus !== -1) local = local.slice(0, plus);
  // Gmail / Googlemail also ignore dots in the local part:
  // `f.o.o@gmail.com` and `foo@gmail.com` are the same inbox.
  if (domain === "gmail.com" || domain === "googlemail.com") {
    local = local.replace(/\./g, "");
  }
  return `${local}@${domain}`;
}

export function isDisposableDomain(email: string): boolean {
  const domain = email.split("@")[1]?.toLowerCase();
  return !!domain && DISPOSABLE_DOMAINS.has(domain);
}

export async function hasValidMx(email: string): Promise<boolean> {
  const domain = email.split("@")[1];
  if (!domain) return false;
  try {
    const records = await resolveMx(domain);
    return records.length > 0;
  } catch {
    // NXDOMAIN, no MX, network blip — all treated as "not valid."
    // Better to false-reject a transient lookup failure than burn a
    // Places call on a domain that can't actually receive mail.
    return false;
  }
}

export type EmailCheck =
  | { ok: true; normalized: string }
  | { ok: false; reason: string };

export async function checkEmail(email: string): Promise<EmailCheck> {
  if (isDisposableDomain(email)) {
    return {
      ok: false,
      reason:
        "Please use a permanent email address. Disposable inboxes aren't accepted for the free audit.",
    };
  }
  if (!(await hasValidMx(email))) {
    return {
      ok: false,
      reason:
        "That email's domain doesn't appear to accept mail. Please double-check the address.",
    };
  }
  return { ok: true, normalized: normalizeEmail(email) };
}

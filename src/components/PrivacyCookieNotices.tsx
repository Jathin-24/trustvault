"use client";

import Link from "next/link";
import { useEffect, useState } from "react";

type CookieChoice = { necessary: true; analytics: boolean; marketing: boolean; savedAt: string; version: 1 };
const COOKIE_KEY = "trustvault-cookie-preferences-v1";
const PRIVACY_NOTICE_KEY = "trustvault-privacy-notice-seen-v1";

function readChoice(): CookieChoice | null {
  try {
    const raw = window.localStorage.getItem(COOKIE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as CookieChoice;
    if (parsed.version !== 1 || parsed.necessary !== true || typeof parsed.analytics !== "boolean" || typeof parsed.marketing !== "boolean") return null;
    return parsed;
  } catch { return null; }
}

export default function PrivacyCookieNotices() {
  const [privacyOpen, setPrivacyOpen] = useState(false);
  const [cookieOpen, setCookieOpen] = useState(false);
  const [hasChoice, setHasChoice] = useState(false);
  const [analytics, setAnalytics] = useState(false);
  const [marketing, setMarketing] = useState(false);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    const choice = readChoice();
    setHasChoice(Boolean(choice));
    if (choice) { setAnalytics(choice.analytics); setMarketing(choice.marketing); }
    try {
      if (!window.localStorage.getItem(PRIVACY_NOTICE_KEY)) setPrivacyOpen(true);
    } catch { setPrivacyOpen(true); }
    setReady(true);
    const openSettings = () => setCookieOpen(true);
    window.addEventListener("trustvault:open-cookie-settings", openSettings);
    return () => window.removeEventListener("trustvault:open-cookie-settings", openSettings);
  }, []);

  function saveChoice(nextAnalytics: boolean, nextMarketing: boolean) {
    const choice: CookieChoice = { necessary: true, analytics: nextAnalytics, marketing: nextMarketing, savedAt: new Date().toISOString(), version: 1 };
    try { window.localStorage.setItem(COOKIE_KEY, JSON.stringify(choice)); } catch { /* Preferences remain usable for this visit if storage is unavailable. */ }
    setAnalytics(nextAnalytics); setMarketing(nextMarketing); setHasChoice(true); setCookieOpen(false);
  }

  function closePrivacyNotice() {
    try { window.localStorage.setItem(PRIVACY_NOTICE_KEY, "seen"); } catch { /* Do not block the site if storage is disabled. */ }
    setPrivacyOpen(false);
  }

  if (!ready) return null;
  return <>
    {privacyOpen && <div className="notice-backdrop" role="presentation"><section className="notice-dialog" role="dialog" aria-modal="true" aria-labelledby="privacy-notice-title"><div className="notice-symbol">⌑</div><p className="notice-eyebrow">A NOTE ON PRIVACY</p><h2 id="privacy-notice-title">Your documents are personal. Your data is, too.</h2><p className="notice-copy">TrustVault processes account information and the files you choose to upload to provide document management, sharing, permissions, and audit features. Access depends on your account permissions and the service configuration.</p><div className="notice-detail"><strong>What to know before you continue</strong><ul><li>Only upload documents you are authorized to store and share.</li><li>Authorized service operators may process data to operate, secure, and support the service.</li><li>Cookie preferences are separate from document permissions.</li></ul></div><p className="notice-small">Read the <Link href="/privacy-policy" onClick={closePrivacyNotice}>Privacy Policy</Link> for details about data use, retention, security, and deletion requests.</p><button className="notice-primary" onClick={closePrivacyNotice}>Continue to TrustVault <span aria-hidden="true">→</span></button><button className="notice-text-button" onClick={() => { closePrivacyNotice(); setCookieOpen(true); }}>Review cookie choices</button></section></div>}

    {!hasChoice && !cookieOpen && <aside className="cookie-banner" aria-label="Cookie notice"><div className="cookie-banner-copy"><div className="cookie-icon">◌</div><div><strong>Your privacy, your choice.</strong><p>We use essential browser storage to remember basic preferences. Optional analytics and marketing cookies are off unless you choose to enable them. See our <Link href="/privacy-policy">Privacy Policy</Link>.</p></div></div><div className="cookie-banner-actions"><button className="cookie-secondary" onClick={() => saveChoice(false, false)}>Reject optional</button><button className="cookie-secondary" onClick={() => setCookieOpen(true)}>Customize</button><button className="cookie-primary" onClick={() => saveChoice(true, true)}>Accept all</button></div></aside>}

    {cookieOpen && <div className="notice-backdrop cookie-backdrop" role="presentation"><section className="notice-dialog cookie-dialog" role="dialog" aria-modal="true" aria-labelledby="cookie-settings-title"><button className="dialog-close" aria-label="Close cookie settings" onClick={() => setCookieOpen(false)}>×</button><div className="notice-symbol">◌</div><p className="notice-eyebrow">COOKIE PREFERENCES</p><h2 id="cookie-settings-title">Choose what you are comfortable with.</h2><p className="notice-copy">Essential storage is always on because it supports basic site functionality and remembering your choices. Optional categories stay off unless you enable them.</p><div className="cookie-option"><div><strong>Essential storage</strong><p>Required for basic functionality and saving your cookie choice.</p></div><span className="always-on">Always on</span></div><div className="cookie-option"><div><strong>Analytics</strong><p>Would help us understand how the site is used. Not enabled by this preference alone.</p></div><label className="switch-label"><input type="checkbox" checked={analytics} onChange={(event) => setAnalytics(event.target.checked)} /><span className="switch-ui"/><span className="sr-only">Allow analytics cookies</span></label></div><div className="cookie-option"><div><strong>Marketing</strong><p>Would allow marketing-related storage if such tools are added.</p></div><label className="switch-label"><input type="checkbox" checked={marketing} onChange={(event) => setMarketing(event.target.checked)} /><span className="switch-ui"/><span className="sr-only">Allow marketing cookies</span></label></div><p className="notice-small">Important: this preference panel stores your selection, but it does not install or block third-party trackers by itself. No analytics or marketing tool should be added until it is wired to these preferences.</p><button className="notice-primary" onClick={() => saveChoice(analytics, marketing)}>Save my choices</button><button className="notice-text-button" onClick={() => saveChoice(false, false)}>Reject optional cookies</button><p className="notice-small policy-link"><Link href="/privacy-policy">Read the Privacy Policy</Link></p></section></div>}
  </>;
}

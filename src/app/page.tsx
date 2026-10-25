import Link from "next/link";
import CookieSettingsLink from "@/components/CookieSettingsLink";

const features = [
  { number: "01", title: "Access on your terms", body: "Give each recipient document-specific permissions and revoke access when it is no longer needed.", icon: "⌁" },
  { number: "02", title: "A record of activity", body: "Review recorded document events so important access actions are easier to investigate.", icon: "↗" },
  { number: "03", title: "Sensitive by design", body: "Keep contracts, salary letters, and business files in a workspace built around controlled access.", icon: "◇" },
];

export default function Home() {
  return (
    <main className="landing-page">
      <nav className="landing-nav page-width" aria-label="Main navigation">
        <Link href="/" className="brand"><span className="brand-mark">T</span><span>TrustVault</span></Link>
        <div className="landing-nav-links"><a href="#security">Security</a><a href="#how-it-works">How it works</a><Link href="/privacy-policy">Privacy</Link></div>
        <div className="landing-nav-actions"><Link className="nav-signin" href="/sign-in">Sign in</Link><Link className="button button-dark button-small" href="/sign-up">Get started <span aria-hidden="true">↗</span></Link></div>
      </nav>

      <section className="hero page-width">
        <div className="hero-copy">
          <div className="eyebrow"><span className="status-dot" /> PRIVATE DOCUMENT SHARING</div>
          <h1>Your documents.<br /><span>Your control.</span></h1>
          <p className="hero-description">Share sensitive files with the right people, control who can access them, and keep a clear record of important activity.</p>
          <div className="hero-actions"><Link className="button button-dark" href="/sign-up">Get started <span aria-hidden="true">→</span></Link><a className="button button-light" href="#how-it-works">See how it works</a></div>
          <p className="hero-footnote"><span aria-hidden="true">⌑</span> Built for documents that deserve care.</p>
        </div>
        <div className="preview-wrap" aria-label="Illustration of a secure document workspace">
          <div className="preview-window">
            <div className="preview-top"><div className="window-dots"><i /><i /><i /></div><span>SECURE WORKSPACE</span><span className="preview-lock">⌑ ENCRYPTED IN TRANSIT</span></div>
            <div className="preview-content"><div className="preview-heading"><div><p className="micro-label">YOUR WORKSPACE</p><h2>Documents</h2></div><span className="avatar">JD</span></div>
              <div className="mock-document"><span className="file-icon">PDF</span><div className="mock-file-name"><strong>Project Agreement.pdf</strong><small>Updated recently · PDF document</small></div><span className="access-pill">Private</span><span className="more">···</span></div>
              <div className="mock-document"><span className="file-icon file-icon-alt">PDF</span><div className="mock-file-name"><strong>Salary Letter.pdf</strong><small>Shared with 1 recipient</small></div><span className="access-pill access-shared">Shared</span><span className="more">···</span></div>
              <div className="activity-card"><div className="activity-title"><span>RECENT ACTIVITY</span><span>Illustrative preview</span></div><div className="activity-row"><span className="activity-check">✓</span><div><strong>Access permission updated</strong><small>Recorded event · Project Agreement.pdf</small></div><span className="activity-time">Just now</span></div><div className="activity-row"><span className="activity-check">✓</span><div><strong>Document uploaded</strong><small>Recorded event · Salary Letter.pdf</small></div><span className="activity-time">Earlier</span></div></div>
            </div>
          </div>
          <div className="floating-note"><span className="floating-icon">✓</span><div><strong>Access with intention</strong><small>Permissions you control</small></div></div>
        </div>
      </section>

      <section className="trust-strip" id="security"><div className="page-width trust-strip-inner"><span>MADE FOR CONFIDENTIAL FILES</span><div><span>◇</span> Document-level permissions</div><div><span>↻</span> Revocable access</div><div><span>≡</span> Auditable activity</div></div></section>

      <section className="features-section page-width" id="how-it-works"><div className="section-intro"><p className="eyebrow">LESS EXPOSURE. MORE CONTROL.</p><h2>Sharing files should not mean<br className="desktop-break" /> giving up control.</h2><p>Keep the process simple. Make access deliberate. Know where to look when you need an activity record.</p></div><div className="feature-grid">{features.map((feature) => <article className="feature-card" key={feature.number}><div className="feature-card-top"><span className="feature-icon">{feature.icon}</span><span className="feature-number">{feature.number}</span></div><h3>{feature.title}</h3><p>{feature.body}</p></article>)}</div></section>

      <section className="closing-cta page-width"><div><p className="eyebrow">TRUST STARTS WITH CONTROL</p><h2>Give important documents<br />a more thoughtful home.</h2></div><Link className="button button-white" href="/sign-up">Create your account <span aria-hidden="true">→</span></Link></section>
      <footer className="landing-footer page-width"><Link href="/" className="brand"><span className="brand-mark">T</span><span>TrustVault</span></Link><p>Private document sharing with accountability.</p><div><Link href="/privacy-policy">Privacy Policy</Link><CookieSettingsLink /><Link href="/sign-in">Sign in</Link></div><small>© {new Date().getFullYear()} TrustVault. Product capabilities depend on your configured deployment.</small></footer>
    </main>
  );
}

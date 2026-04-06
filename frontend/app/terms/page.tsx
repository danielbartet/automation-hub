export default function TermsPage() {
  return (
    <div style={{ maxWidth: 720, margin: "0 auto", padding: "48px 24px", fontFamily: "sans-serif", color: "#f9fafb", lineHeight: 1.7 }}>
      <h1 style={{ fontSize: 28, fontWeight: 700, marginBottom: 8 }}>Terms of Service</h1>
      <p style={{ color: "#9ca3af", marginBottom: 32 }}>Last updated: April 6, 2025</p>

      <p>
        By accessing or using the Automation Hub platform operated by Quantoria Labs, you agree to be bound
        by these Terms of Service. If you do not agree, do not use this platform.
      </p>

      <h2 style={{ fontSize: 18, fontWeight: 600, marginTop: 32 }}>1. Use of the platform</h2>
      <p>
        Automation Hub is an internal tool for managing social media content and Meta advertising campaigns.
        Access is granted only to authorized users. You are responsible for keeping your login credentials
        confidential and for all activity under your account.
      </p>

      <h2 style={{ fontSize: 18, fontWeight: 600, marginTop: 32 }}>2. Meta platform integration</h2>
      <p>
        This platform integrates with Meta's Marketing API to create and manage advertising campaigns on your
        behalf. By using this integration, you authorize Quantoria Labs to act on your Meta ad account as
        configured. You remain responsible for all ad spend, campaign settings, and compliance with{" "}
        <a href="https://www.facebook.com/policies/ads/" style={{ color: "#60a5fa" }} target="_blank" rel="noopener noreferrer">
          Meta's Advertising Policies
        </a>.
      </p>

      <h2 style={{ fontSize: 18, fontWeight: 600, marginTop: 32 }}>3. Content and intellectual property</h2>
      <p>
        AI-generated content (copy, concepts, captions) produced by this platform is provided as-is for your
        review and use. You are responsible for reviewing all content before publishing and ensuring it complies
        with applicable laws and platform policies.
      </p>

      <h2 style={{ fontSize: 18, fontWeight: 600, marginTop: 32 }}>4. Limitation of liability</h2>
      <p>
        Quantoria Labs is not liable for any advertising spend, campaign outcomes, rejected ads, account
        suspensions, or other consequences arising from the use of this platform. The service is provided
        without warranties of any kind.
      </p>

      <h2 style={{ fontSize: 18, fontWeight: 600, marginTop: 32 }}>5. Changes to these terms</h2>
      <p>
        We may update these terms at any time. Continued use of the platform after changes are posted
        constitutes acceptance of the new terms.
      </p>

      <h2 style={{ fontSize: 18, fontWeight: 600, marginTop: 32 }}>6. Contact</h2>
      <p>
        Quantoria Labs<br />
        <a href="mailto:daniel@quantorialabs.com" style={{ color: "#60a5fa" }}>daniel@quantorialabs.com</a><br />
        <a href="https://hub.quantorialabs.com" style={{ color: "#60a5fa" }}>hub.quantorialabs.com</a>
      </p>
    </div>
  );
}

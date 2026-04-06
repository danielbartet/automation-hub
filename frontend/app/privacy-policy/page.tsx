export default function PrivacyPolicyPage() {
  return (
    <div style={{ maxWidth: 720, margin: "0 auto", padding: "48px 24px", fontFamily: "sans-serif", color: "#1a1a1a", lineHeight: 1.7 }}>
      <h1 style={{ fontSize: 28, fontWeight: 700, marginBottom: 8 }}>Privacy Policy</h1>
      <p style={{ color: "#6b7280", marginBottom: 32 }}>Last updated: April 6, 2025</p>

      <h2 style={{ fontSize: 18, fontWeight: 600, marginTop: 32 }}>1. Who we are</h2>
      <p>
        Quantoria Labs operates the Automation Hub platform, a content automation and advertising management tool
        used internally to manage social media and Meta Ads campaigns. This policy applies to users who log in to
        the dashboard and to data processed through our Meta app integration.
      </p>

      <h2 style={{ fontSize: 18, fontWeight: 600, marginTop: 32 }}>2. Data we collect</h2>
      <p>We collect and process the following data:</p>
      <ul style={{ paddingLeft: 20 }}>
        <li>Account credentials (email and hashed password) for dashboard login</li>
        <li>Meta Ads account data (campaigns, ad sets, creatives, spend, insights) via the Meta Marketing API</li>
        <li>Instagram and Facebook Page content data for scheduling and publishing</li>
        <li>Usage logs for internal monitoring and debugging</li>
      </ul>

      <h2 style={{ fontSize: 18, fontWeight: 600, marginTop: 32 }}>3. How we use your data</h2>
      <p>Data is used exclusively to:</p>
      <ul style={{ paddingLeft: 20 }}>
        <li>Operate and display the Automation Hub dashboard</li>
        <li>Create, manage, and optimize Meta advertising campaigns on your behalf</li>
        <li>Schedule and publish content to connected social media accounts</li>
        <li>Generate AI-assisted content and ad copy recommendations</li>
      </ul>

      <h2 style={{ fontSize: 18, fontWeight: 600, marginTop: 32 }}>4. Data sharing</h2>
      <p>
        We do not sell or share your personal data with third parties. Data is shared with Meta Platforms, Inc.
        only to the extent required to operate the Meta Marketing API integration (campaign creation, insights
        retrieval, content publishing).
      </p>

      <h2 style={{ fontSize: 18, fontWeight: 600, marginTop: 32 }}>5. Data retention</h2>
      <p>
        Account data is retained as long as the account is active. Meta API tokens and campaign data are stored
        in an encrypted database on our servers. You may request deletion at any time (see section 7).
      </p>

      <h2 style={{ fontSize: 18, fontWeight: 600, marginTop: 32 }}>6. Security</h2>
      <p>
        All data is transmitted over HTTPS. Passwords are stored using strong one-way hashing. Access tokens
        are encrypted at rest. Access to the dashboard requires authenticated login.
      </p>

      <h2 style={{ fontSize: 18, fontWeight: 600, marginTop: 32 }}>7. Your rights & data deletion</h2>
      <p>
        You have the right to access, correct, or delete your personal data at any time. To request data deletion,
        visit our <a href="/data-deletion" style={{ color: "#2563eb" }}>Data Deletion page</a> or contact us at{" "}
        <a href="mailto:hola@quantorialabs.com" style={{ color: "#2563eb" }}>hola@quantorialabs.com</a>.
      </p>

      <h2 style={{ fontSize: 18, fontWeight: 600, marginTop: 32 }}>8. Contact</h2>
      <p>
        Quantoria Labs<br />
        <a href="mailto:hola@quantorialabs.com" style={{ color: "#2563eb" }}>hola@quantorialabs.com</a><br />
        <a href="https://hub.quantorialabs.com" style={{ color: "#2563eb" }}>hub.quantorialabs.com</a>
      </p>
    </div>
  );
}

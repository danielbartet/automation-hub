export default function DataDeletionPage() {
  return (
    <div style={{ maxWidth: 720, margin: "0 auto", padding: "48px 24px", fontFamily: "sans-serif", color: "#f9fafb", lineHeight: 1.7 }}>
      <h1 style={{ fontSize: 28, fontWeight: 700, marginBottom: 8 }}>Data Deletion Instructions</h1>
      <p style={{ color: "#9ca3af", marginBottom: 32 }}>Last updated: April 6, 2025</p>

      <p>
        If you have connected your Facebook or Instagram account to Quantoria Labs via our Meta app integration
        and wish to have your data removed, you can request deletion by following the steps below.
      </p>

      <h2 style={{ fontSize: 18, fontWeight: 600, marginTop: 32 }}>How to request data deletion</h2>
      <ol style={{ paddingLeft: 20 }}>
        <li style={{ marginBottom: 12 }}>
          <strong>Revoke app access via Facebook:</strong> Go to{" "}
          <a href="https://www.facebook.com/settings?tab=applications" style={{ color: "#2563eb" }} target="_blank" rel="noopener noreferrer">
            Facebook Settings &rarr; Apps and Websites
          </a>
          , find <em>quantoria-automation</em>, and click <strong>Remove</strong>.
          This immediately revokes our access token and disconnects the integration.
        </li>
        <li style={{ marginBottom: 12 }}>
          <strong>Request full data deletion:</strong> Send an email to{" "}
          <a href="mailto:daniel@quantorialabs.com" style={{ color: "#2563eb" }}>daniel@quantorialabs.com</a>{" "}
          with the subject line <em>"Data Deletion Request"</em>. Include the Facebook account email or Page name
          associated with the integration. We will delete all associated data from our systems within 30 days
          and send you a confirmation.
        </li>
      </ol>

      <h2 style={{ fontSize: 18, fontWeight: 600, marginTop: 32 }}>What gets deleted</h2>
      <ul style={{ paddingLeft: 20 }}>
        <li>Your Meta access token stored in our database</li>
        <li>Any campaign, ad set, and creative data we have stored locally</li>
        <li>Your dashboard account and all associated content posts</li>
      </ul>

      <p style={{ marginTop: 32, color: "#9ca3af" }}>
        Note: Revoking access via Facebook or deleting your data from our systems does not affect any campaigns
        or posts already created on your Meta ad account. Those remain under your direct control in Meta Ads Manager.
      </p>

      <h2 style={{ fontSize: 18, fontWeight: 600, marginTop: 32 }}>Contact</h2>
      <p>
        Quantoria Labs<br />
        <a href="mailto:daniel@quantorialabs.com" style={{ color: "#2563eb" }}>daniel@quantorialabs.com</a>
      </p>
    </div>
  );
}

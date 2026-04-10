export default function TermsPage() {
  const h2Style: React.CSSProperties = { fontSize: 18, fontWeight: 600, marginTop: 40, marginBottom: 8 };
  const h3Style: React.CSSProperties = { fontSize: 15, fontWeight: 600, marginTop: 24, marginBottom: 4 };
  const linkStyle: React.CSSProperties = { color: "#60a5fa" };
  const badgeStyle: React.CSSProperties = {
    display: "inline-block",
    background: "#1e3a5f",
    color: "#93c5fd",
    fontSize: 11,
    fontWeight: 700,
    letterSpacing: "0.05em",
    padding: "2px 8px",
    borderRadius: 4,
    marginLeft: 8,
    verticalAlign: "middle",
  };

  return (
    <div style={{ maxWidth: 760, margin: "0 auto", padding: "48px 24px", fontFamily: "sans-serif", color: "#f9fafb", lineHeight: 1.75 }}>
      <h1 style={{ fontSize: 28, fontWeight: 700, marginBottom: 8 }}>Terms of Service</h1>
      <p style={{ color: "#9ca3af", marginBottom: 8 }}>Last updated: April 9, 2026</p>
      <p style={{ color: "#9ca3af", marginBottom: 32, fontSize: 14 }}>
        Operated by <strong style={{ color: "#d1d5db" }}>Syncminds LLC</strong> — Automation Hub SaaS platform
      </p>

      <p>
        By accessing or using the Automation Hub platform (&ldquo;Platform&rdquo;) operated by{" "}
        <strong>Syncminds LLC</strong> (&ldquo;we&rdquo;, &ldquo;us&rdquo;, or &ldquo;Company&rdquo;), you
        (&ldquo;User&rdquo; or &ldquo;you&rdquo;) agree to be bound by these Terms of Service. If you do not
        agree to all of the terms below, do not access or use the Platform.
      </p>

      {/* ─── 1. USE OF THE PLATFORM ─── */}
      <h2 style={h2Style}>1. Use of the Platform</h2>
      <p>
        Automation Hub is a SaaS dashboard that provides tools for managing social media content and Meta
        advertising campaigns. Access is granted only to authorized users. You are responsible for keeping your
        login credentials confidential and for all activity that occurs under your account.
      </p>

      {/* ─── 2. PLATFORM AS A TOOL — NOT AN ADVERTISING AGENCY ─── */}
      <h2 style={h2Style}>
        2. Platform as a Tool — Not an Advertising Agency
        <span style={badgeStyle}>KEY</span>
      </h2>
      <p>
        <strong>Syncminds LLC provides a technical software tool, not advertising services, consulting, or
        agency management.</strong> The Platform enables you to connect your own Meta accounts, create content,
        and manage campaigns through an interface. All strategic decisions — including which campaigns to run,
        what budgets to set, what audiences to target, and what creative to publish — are made solely by you.
      </p>
      <p style={{ marginTop: 12 }}>
        Syncminds LLC does not act as your advertising agency, media buyer, or representative. We are not
        responsible for the performance, outcomes, or compliance of your advertising campaigns. You are the
        advertiser of record on all Meta accounts connected to the Platform.
      </p>

      {/* ─── 3. META PLATFORM INTEGRATION ─── */}
      <h2 style={h2Style}>3. Meta Platform Integration and Third-Party Dependency</h2>
      <p>
        The Platform integrates with Meta&apos;s Marketing API to allow you to create and manage advertising
        campaigns and publish content to Facebook and Instagram on your behalf. By using this integration, you
        authorize Syncminds LLC to make API calls to Meta on your instruction.
      </p>

      <h3 style={h3Style}>3.1 Meta Policy Compliance</h3>
      <p>
        <strong>You are solely responsible for ensuring that all content, targeting parameters, audience
        selections, and advertising practices comply with{" "}
        <a href="https://www.facebook.com/policies/ads/" style={linkStyle} target="_blank" rel="noopener noreferrer">
          Meta&apos;s Advertising Policies
        </a>,{" "}
        <a href="https://www.facebook.com/communitystandards/" style={linkStyle} target="_blank" rel="noopener noreferrer">
          Community Standards
        </a>, and all applicable laws.</strong>
      </p>
      <p style={{ marginTop: 12 }}>
        Syncminds LLC is not liable for any ad disapprovals, account restrictions, ad account suspensions, or
        permanent bans imposed by Meta as a result of your content, targeting choices, or advertising behavior.
        Meta&apos;s enforcement decisions are entirely outside our control and are not subject to appeal through
        the Platform.
      </p>

      <h3 style={h3Style}>3.2 Third-Party Platform Dependency and Availability</h3>
      <p>
        The Platform depends on Meta&apos;s API infrastructure, which is operated and controlled entirely by
        Meta Platforms, Inc. Syncminds LLC has no control over Meta&apos;s API availability, rate limits,
        policy changes, or service outages. We do not guarantee uninterrupted access to Meta services through
        the Platform.
      </p>
      <p style={{ marginTop: 12 }}>
        Specifically, we are not liable for failures or delays caused by:
      </p>
      <ul style={{ paddingLeft: 24, marginTop: 8 }}>
        <li>Meta API downtime or outages</li>
        <li>Meta API rate limiting that prevents publishing or data retrieval</li>
        <li>Changes to Meta&apos;s API that break Platform functionality</li>
        <li>Meta policy changes that affect your account or campaigns</li>
        <li>Expired, revoked, or disconnected access tokens that prevent scheduled actions</li>
      </ul>
      <p style={{ marginTop: 12 }}>
        <strong>No Service Level Agreement (SLA) is guaranteed for any Meta-dependent functionality.</strong>{" "}
        You are responsible for monitoring the connection status of your Meta accounts and refreshing tokens
        when required. Missed publications or failed ad actions caused by token expiry or OAuth disconnection
        are not the responsibility of Syncminds LLC.
      </p>

      {/* ─── 4. AUTOMATED OPTIMIZATION FEATURES ─── */}
      <h2 style={h2Style}>
        4. Automated Optimization Features (Andromeda)
        <span style={badgeStyle}>KEY</span>
      </h2>
      <p>
        The Platform includes an AI-powered campaign optimization feature (&ldquo;Andromeda&rdquo;) that
        analyzes your campaign performance data and generates recommendations such as scaling budgets, pausing
        campaigns, or modifying creative.
      </p>
      <p style={{ marginTop: 12 }}>
        <strong>
          No optimization action is ever executed automatically. Every recommendation — including budget
          increases (SCALE), campaign pauses (PAUSE), or any other suggested change — requires your explicit
          manual approval through the Platform dashboard before any action is taken.
        </strong>
      </p>
      <p style={{ marginTop: 12 }}>
        By approving a recommended action, you accept full responsibility for that decision and its consequences,
        including any resulting changes to ad spend, campaign reach, or campaign status. Syncminds LLC is not
        liable for outcomes — including financial losses or account restrictions — arising from actions you
        approved through the optimization feature.
      </p>
      <p style={{ marginTop: 12 }}>
        Optimization recommendations are based on available data at the time of analysis and do not constitute
        financial or advertising advice. Past performance patterns used to generate recommendations do not
        guarantee future results.
      </p>

      {/* ─── 5. CONTENT AND INTELLECTUAL PROPERTY ─── */}
      <h2 style={h2Style}>5. Content and Intellectual Property</h2>
      <p>
        AI-generated content (copy, concepts, captions, carousel slides) produced by the Platform is provided
        as-is for your review. <strong>You are responsible for reviewing all content before approving it for
        publication</strong> and for ensuring it complies with applicable laws, Meta&apos;s policies, and any
        third-party intellectual property rights. Syncminds LLC is not liable for content that violates Meta
        policies or applicable law once you have approved it for publication.
      </p>
      <p style={{ marginTop: 12 }}>
        You retain ownership of any original content you upload or provide. You grant Syncminds LLC a limited
        license to store and process that content solely for the purpose of delivering the Platform&apos;s
        services to you.
      </p>

      {/* ─── 6. DATA AND STORAGE ─── */}
      <h2 style={h2Style}>6. Data Storage and Backup</h2>
      <p>
        The Platform stores data using standard database and cloud storage infrastructure. While we take
        reasonable measures to protect your data, <strong>we do not guarantee that data will never be lost,
        corrupted, or unavailable.</strong> You are encouraged to maintain your own records of critical campaign
        data. Syncminds LLC is not liable for any loss of data, including campaign histories, content drafts,
        or performance logs.
      </p>

      {/* ─── 7. NO GUARANTEE OF RESULTS ─── */}
      <h2 style={h2Style}>7. No Guarantee of Results</h2>
      <p>
        Syncminds LLC makes no representations or warranties that use of the Platform will result in any
        particular advertising performance, reach, impressions, conversions, revenue, or business outcome. Ad
        performance is determined by many factors outside our control, including Meta&apos;s ad auction, your
        creative quality, your offer, and market conditions. The Platform is a tool — results depend entirely
        on how you use it.
      </p>

      {/* ─── 8. LIMITATION OF LIABILITY ─── */}
      <h2 style={h2Style}>
        8. Limitation of Liability
        <span style={badgeStyle}>KEY</span>
      </h2>
      <p>
        To the maximum extent permitted by applicable law, <strong>Syncminds LLC&apos;s total liability to you
        for any claim arising from or related to the Platform is limited to the total amount you paid for the
        service in the three (3) months immediately preceding the event giving rise to the claim.</strong>
      </p>
      <p style={{ marginTop: 12 }}>
        <strong>Under no circumstances will Syncminds LLC be liable for:</strong>
      </p>
      <ul style={{ paddingLeft: 24, marginTop: 8 }}>
        <li>Lost ad spend or wasted advertising budget</li>
        <li>Lost revenue, lost profits, or lost business opportunities</li>
        <li>Meta ad account suspensions, bans, or restrictions</li>
        <li>Missed content publications due to API failures or token expiry</li>
        <li>Consequential, indirect, incidental, punitive, or special damages of any kind</li>
        <li>Actions taken based on Platform recommendations that you approved</li>
        <li>Data loss or corruption</li>
      </ul>
      <p style={{ marginTop: 12 }}>
        These limitations apply regardless of the legal theory under which a claim is brought (contract, tort,
        negligence, or otherwise) and even if Syncminds LLC has been advised of the possibility of such damages.
      </p>
      <p style={{ marginTop: 12 }}>
        The Platform is provided &ldquo;as is&rdquo; and &ldquo;as available&rdquo; without warranties of any
        kind, express or implied, including but not limited to implied warranties of merchantability, fitness for
        a particular purpose, or non-infringement.
      </p>

      {/* ─── 9. INDEMNIFICATION ─── */}
      <h2 style={h2Style}>
        9. Indemnification
        <span style={badgeStyle}>KEY</span>
      </h2>
      <p>
        You agree to indemnify, defend, and hold harmless Syncminds LLC, its officers, directors, employees,
        contractors, and agents from and against any and all claims, damages, losses, costs, and expenses
        (including reasonable attorneys&apos; fees) arising out of or related to:
      </p>
      <ul style={{ paddingLeft: 24, marginTop: 8 }}>
        <li>Your use of the Platform</li>
        <li>Content you publish or attempt to publish through the Platform</li>
        <li>Your violation of Meta&apos;s Advertising Policies or Community Standards</li>
        <li>Your violation of any applicable law or regulation</li>
        <li>Actions you approved through the optimization feature</li>
        <li>Your breach of these Terms of Service</li>
      </ul>
      <p style={{ marginTop: 12 }}>
        This indemnification obligation survives termination of your use of the Platform.
      </p>

      {/* ─── 10. CHANGES TO TERMS ─── */}
      <h2 style={h2Style}>10. Changes to These Terms</h2>
      <p>
        We may update these Terms of Service at any time. When we do, we will update the &ldquo;Last
        updated&rdquo; date at the top of this page. Continued use of the Platform after changes are posted
        constitutes your acceptance of the revised terms. If you do not agree to the revised terms, you must
        stop using the Platform.
      </p>

      {/* ─── 11. GOVERNING LAW ─── */}
      <h2 style={h2Style}>11. Governing Law</h2>
      <p>
        These Terms of Service are governed by and construed in accordance with the laws of the United States.
        Any disputes arising from these terms or your use of the Platform shall be resolved through binding
        arbitration or in the courts of competent jurisdiction, as determined by Syncminds LLC.
      </p>

      {/* ─── 12. CONTACT ─── */}
      <h2 style={h2Style}>12. Contact</h2>
      <p>
        If you have questions about these Terms of Service, contact us at:
      </p>
      <p style={{ marginTop: 8 }}>
        <strong>Syncminds LLC</strong><br />
        <a href="mailto:daniel@quantorialabs.com" style={linkStyle}>daniel@quantorialabs.com</a><br />
        <a href="https://hub.quantorialabs.com" style={linkStyle}>hub.quantorialabs.com</a>
      </p>
    </div>
  );
}

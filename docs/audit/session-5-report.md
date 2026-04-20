# Audit Report — Session 5: Next.js Frontend Security

**Date:** 2026-04-19
**Scope:** `frontend/` — localStorage, URL params, NextAuth v5 session, third-party data rendering, NEXT_PUBLIC_ vars

## Summary

| Severity | Count |
|---|---|
| CRITICAL | 1 |
| HIGH | 1 |
| MEDIUM | 3 |
| LOW | 3 |
| INFORMATIONAL | 1 |

## CRITICAL

### F1. JWT access token inlined into `<a href>` query string
**File:** `frontend/components/settings/MetaTokenSection.tsx:60-61, 151`
**Severity:** CRITICAL
**Category:** session leak

**Current code (lines 55-65):**
```tsx
      .then((data: MetaTokenStatus) => setStatus(data))
      .catch(() => setError(t.settings_meta_error))
      .finally(() => setLoading(false));
  }, [session]);

  const rawToken = (session as any)?.accessToken as string | undefined;
  const connectUrl = `${API_BASE}/api/v1/auth/meta/start?mode=user${rawToken ? `&jwt=${encodeURIComponent(rawToken)}` : ""}`;

  const expired = status?.connected && isExpired(status.expires_at ?? null);
  const connected = status?.connected && !expired;
```

**Current code (anchor render around 151):**
```tsx
      {/* Connect / Reconnect button */}
      {!loading && !error && (
        <div>
          <a
            href={connectUrl}
            className="inline-flex items-center px-4 py-2 rounded-md text-sm font-medium text-white transition-colors"
            style={{ backgroundColor: "#7c3aed" }}
            onMouseEnter={(e) =>
              ((e.currentTarget as HTMLAnchorElement).style.backgroundColor = "#6d28d9")
            }
```

**Why it's risky:** The NextAuth JWT access token is inlined into an `<a href>` pointing at `api.quantorialabs.com`. On click, the full token lands in:
- Browser history, bookmarks, tab title
- `Referer:` header to every Meta OAuth URL in the redirect chain (Facebook, Instagram)
- Traefik / FastAPI access logs under `/api/v1/auth/meta/start?...`
- `document.links` (readable by any script on same origin)
- Shared cleartext if user copies the link

NextAuth JWT strategy is long-lived (30-day default). Token grants full API access under user's role.

**Recommended fix:** Replace with a client-side fetch + redirect:
```tsx
const handleConnect = async () => {
  const r = await fetch(`${API_BASE}/api/v1/auth/meta/start?mode=user`, {
    headers: { Authorization: `Bearer ${rawToken}` },
  });
  const { oauth_url } = await r.json();
  window.location.assign(oauth_url);
};
```
Or issue a short-lived (<60s) single-use state token server-side and pass that instead of the JWT.

## HIGH

### F2. `action_url` from backend flows into `window.location.href` and `<a href>` without scheme validation
**File:** `frontend/components/notifications/NotificationPanel.tsx:327, 494-500`
**Severity:** HIGH
**Category:** open redirect / XSS

**Current code (around 320-330):**
```tsx
    } catch { /* ignore */ }
    finally { setActionLoading(null); }
  };

  const handleNotifClick = async (notif: NotifItem) => {
    if (!notif.is_read && token) {
      await markNotificationRead(token, notif.id);
      setItems(prev => prev.map(n => n.id === notif.id ? { ...n, is_read: true } : n));
    }
    if (notif.action_url) window.location.href = notif.action_url;
  };
```

**Current code (around 490-505):**
```tsx
                        {/* Campaign detail link for optimizer/fatigue notifications */}
                        {(notif.type === "optimizer_scale" || notif.type === "optimizer_pause" || notif.type === "optimizer_modify" || notif.type === "campaign_fatigued") && (
                          <a
                            href={
                              notif.action_data?.campaign_id
                                ? `/dashboard/ads/${notif.action_data.campaign_id}`
                                : notif.action_url
                            }
                            className="mt-2 block text-sm text-blue-400 hover:text-blue-300 hover:underline transition-colors"
                          >
                            {t.notif_view_campaign}
                          </a>
                        )}
```

**Why it's risky:** `action_url` is a string stored in the `Notification` DB row, returned verbatim. No validation that it's same-origin or an http(s) scheme. Any backend job that writes `javascript:alert(document.cookie)` into `action_url` becomes an XSS gadget. Off-origin `action_url` is a credential-harvesting open redirect (user trusts the in-app link). `rel="noopener noreferrer"` does NOT block `javascript:` URIs.

**Recommended fix:**
```ts
function safeActionUrl(u?: string) {
  if (!u) return undefined;
  if (u.startsWith("/") && !u.startsWith("//")) return u;
  return undefined;
}
// Use at both sites (line 327 and 494-500)
```

## MEDIUM

### F3. base64(JSON) URL param deserialized into React state without validation
**File:** `frontend/app/(protected)/dashboard/projects/page.tsx:111-124`
**Severity:** MEDIUM
**Category:** URL param / open-ended JSON deserialization

**Current code:**
```tsx
    } else if (metaSelect === "true") {
      const slug = searchParams.get("slug");
      const assetsParam = searchParams.get("assets");
      if (slug && assetsParam) {
        try {
          const decoded = JSON.parse(atob(decodeURIComponent(assetsParam))) as MetaAssetsPayload;
          setMetaSelectSlug(slug);
          setMetaSelectAssets(decoded);
        } catch {
          setToast({ type: "error", message: t.projects_toast_meta_error_parse });
        }
      }
      router.replace("/dashboard/projects");
    }
  }, [searchParams, router]);
```

**Why it's risky:** `assets` query param is base64-decoded and JSON-parsed with `as MetaAssetsPayload` — TypeScript casts are erased at runtime. Attacker-crafted link (phishing) forces arbitrary shapes into state. On confirm click, victim calls `POST /api/v1/projects/{slug}/meta-assets` binding their project to attacker-controlled Meta asset IDs.

**Recommended fix:**
```ts
const decoded = JSON.parse(atob(decodeURIComponent(assetsParam)));
if (!decoded || typeof decoded !== "object") throw new Error("bad shape");
const { pages, ad_accounts, instagram_accounts } = decoded;
if (!Array.isArray(pages) || !Array.isArray(ad_accounts) || !Array.isArray(instagram_accounts)) {
  throw new Error("bad shape");
}
// plus: each id should match /^\d+$/
```
Better: drop base64-in-URL pattern — have OAuth callback store discovered assets server-side keyed by a short-lived token, client fetches via `GET /api/v1/projects/{slug}/meta-assets/discover` (already exists).

### F6. Third-party competitor ad URLs rendered as `href`/`src` without scheme validation
**File:** `frontend/components/dashboard/InspirationTab.tsx:117-122, 46-49, 191-199`
**Severity:** MEDIUM
**Category:** third-party data rendered as attributes

**Current code (around 117-125):**
```tsx
      {/* Ad creative image */}
      {ad.image_url && (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={ad.image_url}
          alt="Ad creative"
          className="w-full rounded-lg object-cover max-h-40"
        />
      )}
```

**Current code (around 46-49):**
```tsx
        {ad.page_avatar ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={ad.page_avatar}
            alt={ad.page_name}
            className="rounded-full w-8 h-8 object-cover flex-shrink-0"
          />
```

**Current code (around 191-199):**
```tsx
        {ad.snapshot_url && (
          <Link
            href={ad.snapshot_url}
            target="_blank"
            rel="noopener noreferrer"
            className="text-xs transition-colors"
            style={{ color: "#60a5fa" }}
          >
            {t.ads_inspiration_see_original}
          </Link>
        )}
```

**Why it's risky:** `ad.snapshot_url`, `ad.image_url`, `ad.page_avatar` come from Apify Meta Ad Library scrape — competitor-controlled strings. `<Link href="javascript:...">` or `<a href="javascript:...">` is an XSS sink in every browser. `<img src="javascript:...">` is blocked by modern browsers but `data:` / malformed URIs can still leak referers or trigger CSP violations. `rel="noopener noreferrer"` only hardens `target="_blank"` against tabnabbing — does NOT block `javascript:` URIs.

**Recommended fix:**
```ts
function safeHttpUrl(u?: string): string | undefined {
  if (!u) return undefined;
  try {
    const parsed = new URL(u);
    if (parsed.protocol === "http:" || parsed.protocol === "https:") return parsed.toString();
  } catch {}
  return undefined;
}
<Link href={safeHttpUrl(ad.snapshot_url) ?? "#"} ...>
<img src={safeHttpUrl(ad.image_url)} ...>
```
Apply also to campaign-detail rendering at `app/(protected)/dashboard/ads/[campaign_id]/page.tsx:985`.

### F8. `frontend/.env` committed to repo with placeholder secrets
**File:** `frontend/.env:3, 9-10` and `frontend/.env.example:3, 9-10`
**Severity:** MEDIUM
**Category:** credential exposure

**Current code (`.env` around lines 1-12):**
```
# NextAuth
NEXTAUTH_URL=http://localhost:3000
NEXTAUTH_SECRET=change-me-in-production

# API
NEXT_PUBLIC_API_URL=http://localhost:8000

# Admin credentials (dev only)
ADMIN_USERNAME=admin
ADMIN_PASSWORD=admin
```

**Current code (`.env.example` around lines 1-12):**
```
# NextAuth
NEXTAUTH_URL=http://localhost:3000
NEXTAUTH_SECRET=change-me-in-production

# API
NEXT_PUBLIC_API_URL=http://localhost:8000

# Admin credentials (dev only)
ADMIN_USERNAME=admin
ADMIN_PASSWORD=admin
```

**Why it's risky:** `frontend/.env` is committed (not just `.env.example`). `Dockerfile.prod:22` does `COPY . .` into builder image, so `.env` is copied. Next.js build args DO take precedence over `.env` files so production is likely safe — but (a) verify; (b) `admin/admin` default in seed script must be reset in prod.

**Recommended fix:**
1. Remove `frontend/.env` from the repo
2. Add `frontend/.env` to `.gitignore` if not already
3. Set `.env.example` secret to a placeholder like `<generate with: openssl rand -base64 32>`
4. Remove `ADMIN_USERNAME`/`ADMIN_PASSWORD` from `.env.example` entirely
5. Confirm prod admin password is rotated

## LOW

### F4. Raw OAuth error URL params rendered as toast text
**File:** `frontend/app/(protected)/dashboard/projects/page.tsx:102-110`
**Severity:** LOW
**Category:** URL param phishing (React auto-escapes → no XSS)

**Current code:**
```tsx
    if (pinterestConnected === "true") {
      setToast({ type: "success", message: "Pinterest account connected successfully" });
      router.replace("/dashboard/projects");
    } else if (pinterestError) {
      setToast({ type: "error", message: pinterestError });
      router.replace("/dashboard/projects");
    } else if (connected === "true") {
      setToast({ type: "success", message: "Meta account connected successfully" });
      router.replace("/dashboard/projects");
    } else if (metaError) {
      setToast({ type: "error", message: metaError });
      router.replace("/dashboard/projects");
```

**Why it's risky:** Attacker-crafted link `/dashboard/projects?pinterest_error=Your+session+was+compromised.+Log+in+at+evil.com` renders arbitrary text in an official-looking toast. No XSS (React auto-escapes) but social-engineering vector.

**Recommended fix:** Map to known error codes — `pinterest_error=oauth_denied` → translated canonical string. Never echo raw param.

### F5. localStorage project slug — defense-in-depth note (not a bug)
**File:** `frontend/lib/project-context.tsx:30-64`
**Severity:** LOW
**Category:** localStorage trust boundary

**Current code:**
```tsx
const STORAGE_KEY = "hub_selected_project_slug";

export function ProjectProvider({ children }: { children: React.ReactNode }) {
  const { data: session } = useSession();
  const [projects, setProjects] = useState<Project[]>([]);
  const [selectedSlug, setSelectedSlugState] = useState<string>("");
  const [loading, setLoading] = useState(true);

  const setSelectedSlug = useCallback((slug: string) => {
    setSelectedSlugState(slug);
    if (typeof window !== "undefined") {
      localStorage.setItem(STORAGE_KEY, slug);
    }
  }, []);

  useEffect(() => {
    const token = (session as { accessToken?: string } | null)?.accessToken;
    if (!token) return;

    fetchProjects(token)
      .then((list: Project[]) => {
        const arr = Array.isArray(list) ? list : [];
        setProjects(arr);
        if (arr.length === 0) return;

        const stored =
          typeof window !== "undefined"
            ? localStorage.getItem(STORAGE_KEY)
            : null;
        const valid = stored && arr.some((p) => p.slug === stored);
        setSelectedSlugState(valid ? stored! : arr[0].slug);
      })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, [session]);
```

**Observations (this is defensively coded):**
- Only slug string stored (not full object) — good
- On load, `fetchProjects` returns allow-list, stored slug only accepted if `.some((p) => p.slug === stored)` — good
- Attacker-set localStorage value fails validation and is replaced with `arr[0].slug` — good
- No periodic re-validation, but every subsequent 401/403 triggers signout via providers.tsx

**Residual concerns:**
1. Slug not URL-encoded at fetch sites in `lib/api.ts` — fine today since slugs come from backend
2. No refresh on mid-session UserProject revocation — backend 403s will handle it

**Recommended fix (nice to have):** On 403 to `/{projectSlug}/...`, clear `localStorage[STORAGE_KEY]` and refetch `fetchProjects`. Not critical.

### F7. No CSP header; minimal image domain allow-list
**File:** `frontend/next.config.mjs:1-10`
**Severity:** LOW
**Category:** config / defense-in-depth

**Current code:**
```js
/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  output: "standalone",
  images: {
    domains: ["localhost"],
  },
};

export default nextConfig;
```

**Why it's risky:** No `Content-Security-Policy` header anywhere (frontend or Traefik). CSP would block most of the vectors above by default. `next/image` is bypassed via `<img>` with eslint-disable — `images.domains` allow-list is inert. `dangerouslyAllowSVG` is not enabled — good.

**Recommended fix:** Add CSP via Traefik middleware or `next.config.mjs` `headers()`:
```
default-src 'self';
img-src 'self' https://quantoria-static.s3.amazonaws.com data:;
script-src 'self' 'unsafe-inline';
object-src 'none';
base-uri 'self';
frame-ancestors 'none'
```

## INFORMATIONAL

### F9. `console.error(e)` on calendar page — noted for completeness, safe
**File:** `frontend/app/(protected)/dashboard/calendar/page.tsx:124`
**Severity:** INFORMATIONAL

**Current code:**
```tsx
        token
      );
      setPosts(data.items || []);
    } catch (e) {
      console.error(e);
    } finally {
      setLoading(false);
    }
  };
```

**Why it's safe:** Error object from `catch (e)` on an API call. Does not contain session or token. No action needed.

## Positive findings (verified clean)

- **Zero `dangerouslySetInnerHTML`** anywhere in the app. All competitor/Meta ad fields (`body`, `headline`, `page_name`, `caption`, `hook_analysis`) rendered as React text children → auto-escaped. Verified across: `NotificationPanel.tsx`, `InspirationTab.tsx`, `ConceptsGrid.tsx`, `EditContentModal.tsx`, `PlanContentModal.tsx`, `CreativeUploadModal.tsx`, `InstagramPostPreview.tsx`.
- **Zero `eval(`, `new Function(`, `setTimeout("string")`** outside `node_modules`.
- **Zero `innerHTML` / `outerHTML` assignments** outside `node_modules`.
- **No `console.log(session)`, `console.log(token)`, JSON.stringify-of-session in the rendered UI.**
- **No `credentials: "include"` fetches** — app uses bearer tokens; CSRF-via-cookies N/A.
- **`middleware.ts` correctly gates** all non-`/login`, non-`/api`, non-`/_next` routes behind `req.auth`.
- **NextAuth v5 (`lib/auth.ts`)** uses `trustHost: true`, `session.strategy: "jwt"`. No refresh token issued by credentials provider.
- **`providers.tsx`** does a post-mount probe to `/api/v1/notifications/count`, signs out on 401.
- **`router.push` call sites** all static or derived from internal state. No untrusted data flows into router.push.
- **`URLSearchParams` in `lib/api.ts`** built from trusted params (period, dates, pages).
- **localStorage usage scoped to:** selected project slug (validated), language preference (validated `"es"|"en"`), chat response cache (trivially shaped), ad concepts draft (cleared on mount).

## NEXT_PUBLIC_ variables

Only ONE found: `NEXT_PUBLIC_API_URL = https://api.quantorialabs.com`.

| Variable | Files | Value in prod | Safe to expose? |
|---|---|---|---|
| `NEXT_PUBLIC_API_URL` | `lib/auth.ts:4`, `lib/api.ts:1,803`, `app/providers.tsx:14`, `components/settings/MetaTokenSection.tsx:9`, `components/dashboard/ProjectFormDialog.tsx:128,143,155,584`, `components/dashboard/ImageUploadZone.tsx:44`, `components/dashboard/CreateCampaignModal.tsx:995`, `components/dashboard/CreateAudienceModal.tsx:8`, `app/(protected)/dashboard/content/page.tsx:16`, `app/(protected)/dashboard/pinterest/page.tsx:11`, `app/(protected)/dashboard/pinterest/generate/page.tsx:11`, `app/(protected)/dashboard/ads/AuditScoreCard.tsx:74`, `app/(protected)/dashboard/ads/AuditCheckList.tsx:7`, `app/(protected)/dashboard/ads/audiences/page.tsx:11`, `Dockerfile.prod:7,11`, `docker-compose.prod.yml:26`, `.env.example:6` | `https://api.quantorialabs.com` | **YES** — public API URL is fine |

No API keys (Anthropic, Meta, Apify, Pinterest, OpenAI), database URLs, or signing secrets are exposed via NEXT_PUBLIC_. Verified: `NEXTAUTH_SECRET`, `INTERNAL_API_URL`, and all third-party tokens handled server-side only.

## Appendix: Priority fix order

1. **F1** — JWT-in-URL in MetaTokenSection — single-file fix, highest impact
2. **F2** — validate `action_url` scheme in NotificationPanel — single-file fix
3. **F8** — remove `frontend/.env` from git, add to .gitignore, rotate admin password in prod
4. **F3, F6** — add schema and URL-scheme validation helpers for attacker-controlled inputs
5. **F7** — add CSP header (defense-in-depth covering most of the above)
6. **F4, F5** — cleanups; non-urgent

## Appendix: Files requiring changes

- `frontend/components/settings/MetaTokenSection.tsx` — F1
- `frontend/components/notifications/NotificationPanel.tsx` — F2
- `frontend/app/(protected)/dashboard/projects/page.tsx` — F3, F4
- `frontend/components/dashboard/InspirationTab.tsx` — F6
- `frontend/app/(protected)/dashboard/ads/[campaign_id]/page.tsx` — F6 (related)
- `frontend/.env`, `frontend/.env.example`, `.gitignore`, `frontend/Dockerfile.prod` — F8
- `frontend/next.config.mjs` or Traefik middleware — F7
- `frontend/lib/project-context.tsx` — F5 (nice-to-have)

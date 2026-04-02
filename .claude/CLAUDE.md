# Automation Hub — Project Context for Claude Code

## What this project is
A multi-project content automation and Meta Ads management platform.
Generic architecture — any niche is supported by inserting one DB row.
First project: Quantoria Labs (tech education for LATAM developers).
Owner: Daniel Bartet — execution-focused, prefers automation over manual work.

## Production URLs
- Dashboard: https://hub.quantorialabs.com
- API: https://api.quantorialabs.com
- EC2: 44.194.116.2 (SSH: ssh -i ~/.ssh/quantoria-key.pem ubuntu@44.194.116.2)

## Tech stack
- Backend: FastAPI (Python 3.12) + SQLAlchemy async + SQLite
- Frontend: Next.js 14 (App Router) + NextAuth v5 + Tailwind CSS + shadcn/ui
- Infrastructure: Docker Compose + Traefik v3.3 (file provider) + Let's Encrypt SSL
- CI/CD: GitHub Actions to EC2 (push to main = auto deploy)
- Storage: AWS S3 bucket quantoria-static (us-east-1), AWS profile chatbot-daniel (local only)
- Package managers: uv (Python), pnpm (Node)

## Infrastructure — key IDs and credentials
- Meta System User: n8n-automation (ID: 61580762415010)
- Meta App: quantoria-automation
- Facebook Page ID: 1010286398835015
- Instagram Account ID: 17841449394293930
- Ad Account: act_1337773745049119
- Meta Pixel: 2337199813441200
- S3 bucket: quantoria-static (us-east-1)
- Secrets on server: /home/ubuntu/.secrets/automation-hub/.env.production
- Traefik config: /home/ubuntu/.openclaw/workspace/traefik-n8n/traefik/dynamic/
- App on server: /home/ubuntu/automation-hub/

## Project structure
automation-hub/
├── .claude/
│   ├── CLAUDE.md              # This file — loaded every session
│   └── skills/                # Custom skills (ssh-server, n8n-api, meta-ads-api, etc.)
├── .github/workflows/
│   └── deploy.yml             # GitHub Actions CI/CD
├── backend/                   # FastAPI — port 8000
│   ├── app/
│   │   ├── api/v1/            # auth, projects, content, ads, dashboard, notifications, users, upload
│   │   ├── models/            # Project, ContentPost, ContentBatch, AdCampaign, CampaignOptimizationLog, User, UserProject, Notification
│   │   ├── services/          # claude/, meta/, storage/, notifications.py
│   │   └── skills/            # BaseSkill abstract class pattern
│   ├── alembic/               # DB migrations
│   ├── Dockerfile.dev
│   └── Dockerfile.prod
└── frontend/                  # Next.js — port 3000
    ├── app/
    │   ├── (auth)/login/
    │   └── (protected)/dashboard/
    │       ├── page.tsx              # KPIs overview
    │       ├── projects/             # Project management + ProjectFormDialog
    │       ├── content/              # Content list + GenerateContentModal (auto/manual)
    │       ├── calendar/             # Week/month calendar + PlanContentModal + BatchPreviewPanel
    │       ├── ads/                  # Campaigns list + CreateCampaignModal
    │       │   └── [campaign_id]/    # Campaign detail: KPI cards, charts, optimizer log
    │       └── settings/users/       # User management (admin only)
    ├── components/
    │   ├── layout/
    │   │   ├── Sidebar.tsx           # Nav + project switcher + NotificationBell
    │   │   └── Header.tsx
    │   ├── notifications/
    │   │   ├── NotificationBell.tsx  # Polling 30s, unread count badge
    │   │   └── NotificationPanel.tsx # Slide-in panel, inline approve/reject
    │   └── dashboard/
    │       ├── KPICard.tsx
    │       ├── CampaignKPICard.tsx   # Adapts metrics by campaign objective
    │       ├── AdsChart.tsx
    │       ├── ContentCalendar.tsx
    │       └── ImageUploadZone.tsx   # Drag & drop to S3
    ├── Dockerfile.dev
    └── Dockerfile.prod

## Key patterns — how the system works

### Content generation flow
1. POST /api/v1/content/generate/{project_slug}
2. ClaudeService reads project.content_config → builds system prompt
3. Claude API generates carousel JSON (6 slides + caption + hashtags)
4. HTMLSlideRenderer → Playwright renders 6 PNG slides → uploads to S3
5. ContentPost saved with status="pending_approval" and slide_images array
6. User reviews and approves from the dashboard
7. Backend calls Meta Graph API directly → publishes to Instagram + Facebook
8. ContentPost status updated to "published"

Note: n8n and Telegram are no longer part of the content flow.
n8n credential IDs are kept in the DB for reference but not used.
TELEGRAM_NOTIFICATIONS_ENABLED=false in .env.production

### Batch content flow
1. POST /api/v1/content/batch/{project_slug} with period + count + schedule
2. Generates N posts, all status draft, scheduled_at set, batch_id linked
3. Returns BatchPreview for user to review and edit each post
4. POST /api/v1/content/batch/{batch_id}/approve-all publishes each post directly to Meta

### Ads optimizer (Andromeda rules)
- APScheduler runs every 3 days per campaign
- Claude analyzes Meta Ads insights: CTR, frequency, CPA, ROAS
- Decisions: SCALE (+20% budget) | PAUSE | MODIFY (text recommendations) | KEEP
- SCALE and PAUSE: creates dashboard notification with inline approve/reject
- Never executes SCALE/PAUSE without explicit user approval from dashboard
- Rules: min 7 days running, min $50 spent, frequency below 2.5 to scale
- Fatigue: CTR drops 30% in 7 days OR frequency above 3.0 triggers PAUSE recommendation

### Multi-project architecture
- All brand and content config lives in Project.content_config (JSON field)
- Zero hardcoded project values in service code
- Adding a new project = one API call to POST /api/v1/projects with content_config
- Same endpoints work for any slug: /content/generate/mas-que-futbol

### Roles and access
- admin: full access, all projects, user management, system costs
- operator: assigned projects only (via UserProject), can approve content and ads
- client: read-only, assigned project KPIs only, no action buttons

### Notifications
- Bell icon in header, polls GET /api/v1/notifications/count every 30 seconds
- Types: content_pending | optimizer_scale | optimizer_pause | campaign_fatigued | post_published | post_failed
- SCALE/PAUSE notifications have inline Confirm/Cancel buttons in the panel
- Approving from panel calls POST /api/v1/ads/optimizer/approve with approval_token

## Make commands (local dev)
make dev              # docker compose up (hot reload both services)
make build            # docker compose build
make stop             # docker compose down
make logs             # docker compose logs -f
make logs-backend     # backend logs only
make logs-frontend    # frontend logs only
make migrate          # alembic upgrade head inside container
make migrate-create name="description"  # create new migration
make shell-backend    # bash inside backend container
make shell-frontend   # sh inside frontend container
make test             # pytest inside backend container
make clean            # docker compose down -v --remove-orphans

## Production deploy
- Repo: git@github.com:danielbartet/automation-hub.git
- Branch: main (push to main = auto deploy via GitHub Actions)
- GitHub secrets required: EC2_SSH_KEY_STAGING, EC2_HOST (44.194.116.2), EC2_USER (ubuntu)
- Deploy flow: SSH to EC2, git pull, copy .env.production, docker compose up --build, copy Traefik configs, restart Traefik, health check
- Health check: docker exec automation-hub-backend python3 -c "import urllib.request; urllib.request.urlopen('http://localhost:8000/health')"

## Known gotchas — read before making changes
- NEXT_PUBLIC_* variables bake at build time — pass as build args in docker-compose.prod.yml, NOT as runtime env vars
- NextAuth v5 requires trustHost: true in auth.ts or it rejects production domains
- NEXTAUTH_SECRET must come from env_file only — if duplicated in environment block, Docker Compose overrides with empty string
- S3Service uses lazy init — boto3.Session(profile_name="chatbot-daniel") only works locally. In production use IAM role or env vars, never hardcode the profile name
- Health checks use Python urllib — curl is not available in python:3.12-slim containers
- Always add production domain to FastAPI allow_origins: ["http://localhost:3000", "https://hub.quantorialabs.com"]
- Traefik uses file provider not Docker labels — routing files go in /home/ubuntu/.openclaw/workspace/traefik-n8n/traefik/dynamic/
- Containers use expose not ports — health checks must use docker exec, not curl localhost
- Meta token from System User n8n-automation is stored encrypted in Project.meta_access_token in DB. Always verify accessible ad accounts with /me/adaccounts before using a new token

## Seed production DB (first time only)
Run inside the backend container on EC2:
docker exec automation-hub-backend uv run python3 app/scripts/seed_projects.py
This creates: admin user (admin@automation-hub.com / admin) and Quantoria Labs project with full content_config

## Content config structure (for adding new projects)
{
  "language": "es",
  "brand_name": "Project Name",
  "tone": "description of brand voice",
  "core_message": "main brand message",
  "target_audience": "who they are and what they fear or want",
  "content_categories": ["category 1", "category 2", "category 3", "category 4"],
  "output_format": "carousel_6_slides",
  "slide_count": 6,
  "additional_rules": ["rule 1", "rule 2"]
}

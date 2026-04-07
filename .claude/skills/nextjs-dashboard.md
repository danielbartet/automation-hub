---
name: nextjs-dashboard
description: "ALWAYS use this skill when working on the frontend dashboard. Load it whenever: creating pages, adding components, connecting to the API, styling with Tailwind, or working in the frontend/ directory. Use it even for small UI changes — it contains routing conventions and auth patterns."
---

# Next.js Dashboard Skill

## Project structure
frontend/app/(auth)/login/            - Login page
frontend/app/(protected)/dashboard/  - Protected routes
frontend/app/(protected)/dashboard/page.tsx     - KPI overview
frontend/app/(protected)/dashboard/projects/    - Project management
frontend/app/(protected)/dashboard/content/     - Content history
frontend/app/(protected)/dashboard/ads/         - Ads performance
frontend/components/ui/              - shadcn/ui components
frontend/components/dashboard/       - KPI cards, charts, tables
frontend/components/layout/          - Sidebar, Header
frontend/lib/api.ts                  - Backend fetch wrapper
frontend/lib/auth.ts                 - NextAuth config
frontend/types/index.ts              - Shared TypeScript types

## Run locally via Docker
make dev            - Start all services
make logs-frontend  - View frontend logs
make shell-frontend - Shell into frontend container

## Backend API
const API_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:8000'

## Auth
All dashboard routes protected via (protected)/dashboard/layout.tsx
Login uses NextAuth credentials provider — admin/admin for local dev

## Adding a new page
1. Create app/(protected)/dashboard/your-page/page.tsx
2. Add link in components/layout/Sidebar.tsx
3. Add API call in lib/api.ts

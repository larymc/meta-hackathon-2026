# Relais — From Conversation to Code

**By Gaismas Inc.** (independent studio, Alberta, Canada) · Meta Global AI Developer Hackathon 2026 · Theme: *Build for Your World*

Clients report bugs and request features in plain language over a WhatsApp-style chat. Relais (Meta Muse) asks 1–2 clarifying questions, drafts a structured GitHub issue, and creates it **only after explicit customer approval**. AI translates and coordinates; humans keep engineering authority.

## Quick start (Demo mode — no credentials needed)

```bash
npm install            # root helper (concurrently)
npm run install:all    # server + client deps
npm run dev            # API :3001 + Web :5173
```

Open **http://localhost:5173** → click **Bug Report** (or **Feature Request**) → follow the chat → **Approve & create ticket**. Demo issues are labeled `relais_demo=1`; nothing leaves your machine.

Other commands: `npm test` (10 Vitest tests) · `npm run build` (type-check + production builds) · `npm run lint`

## Going live (optional)

Copy `.env.example` to `server/.env` and fill in what you have — each integration flips independently, and the header badge switches DEMO → LIVE:

| Variable | Enables |
|---|---|
| `MODEL_API_KEY` | Real Muse inference (`muse-spark-1.3`, `https://api.meta.ai/v1`) |
| `GITHUB_TOKEN` + `GITHUB_OWNER`/`GITHUB_REPO` | Real GitHub issues (fine-grained token, Issues RW on one repo) |
| `WHATSAPP_TOKEN` + `WHATSAPP_PHONE_NUMBER_ID` + `WHATSAPP_APP_SECRET` | WhatsApp Cloud webhooks at `/webhooks/whatsapp` (GET verify + HMAC-SHA256 POST) |

If a live AI call fails, the API returns a visible error — it never silently falls back to a simulated success.

## Layout

- `client/` — Vue 3 + TS + Vite + Tailwind chat simulator + AI Workbench
- `server/` — Fastify + TS API, SQLite (`node:sqlite`), Zod-validated drafts, provider adapters (`server/src/providers/`), workflow state machine (`server/src/shared/issue.ts`)
- `docs/` — architecture, 2-minute demo script, project description, capability list

See `docs/ARCHITECTURE.md` for the flow and safety boundaries.

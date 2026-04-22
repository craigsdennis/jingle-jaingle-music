# AGENTS.md — jingle jAIngle

This file tells an AI coding agent everything it needs to know to work in this repo safely and effectively.

---

## What this project is

A full-stack Cloudflare-native web app. Users upload a product photo; the app generates a 30-second commercial jingle using Google's Lyria 3 model on Replicate, stores everything on Cloudflare, and surfaces a voteable public leaderboard.

There is no framework beyond React + Vite on the frontend. The backend is a single Cloudflare Worker with no external dependencies — just the Workers runtime, R2, D1, and KV bindings.

---

## Repo structure

```
worker/index.ts          All API logic — one file, one default export
src/App.tsx              React app — upload, leaderboard, inline player, routing
src/About.tsx            How it works page with linked step-by-step explanation
src/App.css              All component styles
src/index.css            Global reset and body background
src/globals.d.ts         Module declarations and Window.turnstile type
migrations/              D1 SQL migrations — applied in order
wrangler.jsonc           Cloudflare Worker config — bindings, vars, assets
vite.config.ts           Vite config — dev proxy to Worker on :8787
tsconfig.json            References tsconfig.app.json + tsconfig.worker.json
tsconfig.app.json        Frontend TypeScript config
tsconfig.worker.json     Worker TypeScript config (lib: WebWorker, no emit)
.dev.vars.example        Template for local secrets
```

---

## How to run

```bash
npm install
cp .dev.vars.example .dev.vars   # fill in REPLICATE_API_TOKEN and REPLICATE_WEBHOOK_TOKEN
npx wrangler d1 migrations apply jingle-jaingle --local
npm run dev                       # Vite :5173 + Worker :8787 in parallel
```

The Vite dev server proxies `/api` and `/media` to the Worker. Never run `wrangler dev` on a different port than 8787 without also updating `vite.config.ts`.

---

## How to deploy

```bash
npx wrangler secret bulk .dev.vars
npx wrangler d1 migrations apply jingle-jaingle --remote
npm run deploy                    # tsc + vite build + wrangler deploy
```

---

## Key constraints an agent must respect

### Worker

- **One Worker file** — `worker/index.ts`. Do not split it into modules; the build pipeline is not set up for Worker bundling beyond what `wrangler` does natively.
- **No npm imports in the Worker** — the Worker uses only built-in APIs (`fetch`, `crypto`, `atob`/`btoa`, `URL`, `FormData`, `Response`, `Headers`). If you need a utility, write it inline.
- **Always add new DB columns via a migration** — create a new `.sql` file in `migrations/` and run `wrangler d1 migrations apply` both locally and remotely. Never `ALTER TABLE` directly in the Worker.
- **Always add `delete_token` to `SELECT` queries** — `findJingle` selects all columns explicitly; keep it in sync with the schema.
- **Rate limiter and Turnstile checks come first** in `createJingle` — before any R2 write or Replicate call. Do not reorder them.
- **NSFW check runs before R2 write** — `checkImageNsfw()` converts the image to a base64 data URI and calls `meta/llama-guard-4-12b` synchronously (`Prefer: wait=30`) before writing anything to R2 or D1. Unsafe images return a 422. The check fails open (`unknown`) so model errors don't block legitimate users.
- **`SITE_URL` is the canonical base for share links** — always use `serializeJingle(record, origin, votedIds, env.SITE_URL)`. Never hardcode the domain.
- **Webhook token is validated before any DB access** in `handleReplicateWebhook`. Keep it that way.
- **R2 object keys** follow the pattern `images/<uuid>.<ext>` and `audio/<uuid>.mp3`. Saved share videos now upload to Cloudflare Stream and cache their MP4 download URL in `video_key`; keep `getMediaAsset`, deletion logic, and Stream sync helpers aligned with that behavior.

### Frontend

- **No router library** — routing is hash-based (`#about` / `#`), implemented in `App.tsx` with a single `useState` + `hashchange` listener.
- **No hardcoded sitekey** — the Turnstile sitekey is fetched from `/api/config` at runtime so it can be rotated without a frontend redeploy.
- **Delete tokens live in `localStorage`** under the key `jj_delete_tokens` (JSON object, id → token). Always update this map atomically when adding or removing tokens.
- **Vote deduplication is cookie-based** — the `jj_votes` cookie is set by the Worker. The frontend reads `hasVoted` from the API response; it does not manage vote state independently.
- **The leaderboard is cursor-paginated** — `GET /api/jingles` returns `{ jingles, nextCursor }`. Always pass `nextCursor` as `?cursor=` on load-more requests. Do not fetch all jingles at once.
- **Kumo components only** — use `Button`, `Badge`, `Surface`, `Loader`, `ClipboardText` from `@cloudflare/kumo` for all interactive elements. Do not introduce other UI libraries.
- **Phosphor Icons only** — all icons come from `@phosphor-icons/react`. Do not add other icon sets.

### Styles

- All styles are in `src/App.css` (component styles) and `src/index.css` (global). There is no CSS-in-JS and no Tailwind. Keep it that way.
- CSS custom properties are defined at `:root` in `App.css`. Use them (`--ink`, `--ink-soft`, `--panel`, `--line`, `--citrus`, `--shadow-card`, `--shadow-panel`, `--radius-panel`, `--radius-card`) instead of hardcoded values.
- The board grid is `grid-template-columns: 1fr 1fr`. The selected card uses `grid-column: 1 / -1` to span full width. Do not break this layout.

### TypeScript

- The project has **two separate tsconfig files** — one for the app (`lib: DOM`) and one for the Worker (`lib: WebWorker`). Do not mix Worker-only globals (`R2Bucket`, `D1Database`, `KVNamespace`) into app code.
- Run `npm run build` (not just `tsc`) to validate both configs together. The build must pass with zero errors before committing.
- `npm run lint` must also pass clean.

---

## Cloudflare resource names (do not rename)

| Resource | Name / ID |
|---|---|
| Worker | `jingle-jaingle` |
| R2 bucket | `jingle-jaingle-media` |
| D1 database | `jingle-jaingle` |
| D1 database ID | `25d9dc92-54cd-4201-bef5-5fdf7ad31307` |
| KV namespace (rate limit) | `49d3961bf9174a098788c9873aff8205` |

---

## Environment variables

| Variable | `wrangler.jsonc` vars? | Secret? | Required in prod? |
|---|---|---|---|
| `CLOUDFLARE_ACCOUNT_ID` | Yes | No | Yes |
| `CLOUDFLARE_STREAM_API_TOKEN` | No | Yes | Yes |
| `SITE_URL` | Yes | No | Yes |
| `TURNSTILE_SITE_KEY` | Yes | No | Yes |
| `REPLICATE_API_TOKEN` | No | Yes | Yes |
| `REPLICATE_WEBHOOK_TOKEN` | No | Yes | Yes |
| `TURNSTILE_SECRET_KEY` | No | Yes | Yes |

`TURNSTILE_SECRET_KEY` being absent disables server-side Turnstile validation (useful in local dev). `CLOUDFLARE_STREAM_API_TOKEN` is required for saved share videos. All other secrets being absent will cause runtime errors.

---

## API surface (Worker routes)

| Method | Path | Auth |
|---|---|---|
| `GET` | `/api/config` | None |
| `GET` | `/api/jingles?cursor=` | None |
| `GET` | `/api/jingles/:id` | None |
| `POST` | `/api/jingles` | Turnstile token in form body |
| `POST` | `/api/jingles/:id/vote` | None (cookie dedup) |
| `DELETE` | `/api/jingles/:id` | `Authorization: Bearer <delete_token>` |
| `POST` | `/api/replicate/webhook?jingle=&token=` | `token` query param |
| `GET` | `/media/jingles/:id/image` | None |
| `GET` | `/media/jingles/:id/audio` | None |
| `GET` | `/share/:id` | None — returns HTML with OG meta, redirects humans to app |

---

## D1 schema

```sql
CREATE TABLE jingles (
  id                     TEXT PRIMARY KEY,
  status                 TEXT NOT NULL,              -- queued | processing | succeeded | failed
  image_key              TEXT NOT NULL,              -- R2 key: images/<uuid>.<ext>
  image_content_type     TEXT NOT NULL,
  audio_key              TEXT,                       -- R2 key: audio/<uuid>.mp3
  audio_content_type     TEXT,
  votes                  INTEGER NOT NULL DEFAULT 0,
  error_message          TEXT,
  replicate_prediction_id TEXT,
  replicate_output_url   TEXT,
  replicate_web_url      TEXT,
  delete_token           TEXT,                       -- UUID, returned once at creation
  created_at             TEXT NOT NULL,              -- ISO 8601
  updated_at             TEXT NOT NULL
);

CREATE INDEX jingles_votes_created_idx ON jingles (votes DESC, created_at DESC);
```

---

## Common tasks

### Add a new API route

1. Add the method + path match in the `fetch` handler in `worker/index.ts`.
2. Write the handler function in the same file.
3. If it needs a new DB column, add a migration.
4. Run `npm run build` and `npm run lint` before considering it done.

### Change the Lyria prompt styles

Edit the `COMMERCIAL_PROMPTS` array in `worker/index.ts`. Each entry is a standalone prompt string. `pickPrompt()` picks one at random per generation.

### Change rate limits

Edit `RATE_LIMIT_MAX` and `RATE_LIMIT_WINDOW_SECONDS` at the top of `worker/index.ts`. Redeploy.

### Add a new page

1. Add a new component file in `src/`.
2. Add a state value to the `page` union type in `App.tsx`.
3. Add a hash and `nav()` call.
4. Render it in the `page === '...'` conditional in the `App` return.

### Rotate the Turnstile widget

1. Create a new widget at dash.cloudflare.com → Turnstile.
2. Update `TURNSTILE_SITE_KEY` in `wrangler.jsonc`.
3. Update `TURNSTILE_SECRET_KEY` via `wrangler secret put TURNSTILE_SECRET_KEY`.
4. Redeploy with `npm run deploy`.

---

## What to check before opening a PR

- [ ] `npm run build` exits 0
- [ ] `npm run lint` exits 0
- [ ] No new npm packages added to the Worker (Worker must stay dependency-free)
- [ ] Any new D1 columns have a corresponding migration file
- [ ] `serializeJingle` does not expose `delete_token` to the client (it is internal only)
- [ ] Share URLs use `SITE_URL` not `request.url.origin`
- [ ] Rate limiter and Turnstile checks remain the first thing `createJingle` does

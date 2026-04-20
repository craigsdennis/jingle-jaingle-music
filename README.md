# jingle j**AI**ngle

Drop a product photo. Get a 30-second commercial jingle made with Google's Lyria 3 on Replicate, hosted entirely on Cloudflare.

---

## What it does

1. You upload a product photo — that is the **only** user-controlled input.
2. A Cloudflare Worker stores the image in R2 and kicks off a Replicate prediction using `google/lyria-3`.
3. The model picks a random commercial style (pop jingle, lo-fi, orchestral, 80s synth-pop, country, soul, kids, or luxury minimalist) and generates a 30-second 48 kHz stereo MP3.
4. When the Replicate webhook fires, the audio is backed up to R2 and the jingle appears on a public leaderboard.
5. Anyone can listen, vote, and share. The uploader gets a delete button (token stored in `localStorage`).
6. A protected `/admin` page can review recent jingles and delete them.

---

## Stack

| Layer | Technology |
|---|---|
| Frontend | React 19 + Vite, [Kumo](https://github.com/cloudflare/kumo) components, Phosphor Icons |
| Runtime | Cloudflare Worker (TypeScript) |
| Bot protection | Cloudflare Turnstile — invisible challenge on every upload |
| Rate limiting | Cloudflare KV — 5 generations per IP per hour |
| Media storage | Cloudflare R2 — product images and generated audio |
| Database | Cloudflare D1 (SQLite) — jingle metadata, vote counts, delete tokens |
| AI model | [google/lyria-3](https://replicate.com/google/lyria-3) via Replicate |
| Static assets | Cloudflare Workers Assets |
| Admin access | Cloudflare Access — protects `/admin` and `/api/admin/*` |
| Social sharing | Dynamic Open Graph + Twitter Card meta served from `/share/:id` |

---

## Project layout

```
jingle-jaingle/
├── worker/
│   └── index.ts          # Cloudflare Worker — all API routes
 ├── src/
 │   ├── App.tsx            # Main React app (upload, leaderboard, inline player)
 │   ├── Admin.tsx          # Admin review/delete page
 │   ├── About.tsx          # How it works page
 │   ├── main.tsx
 │   ├── App.css
│   ├── index.css
│   └── globals.d.ts
├── migrations/
│   ├── 0001_initial.sql   # jingles table + index
│   └── 0002_delete_token.sql
├── wrangler.jsonc
├── vite.config.ts
└── .dev.vars.example
```

---

## Local setup

### 1. Install dependencies

```bash
npm install
```

### 2. Configure secrets

```bash
cp .dev.vars.example .dev.vars
```

Open `.dev.vars` and fill in:

```
REPLICATE_API_TOKEN=r8_...          # from replicate.com/account/api-tokens
REPLICATE_WEBHOOK_TOKEN=some-long-random-string
SITE_URL=http://localhost:5173
TURNSTILE_SITE_KEY=                 # optional locally, leave blank to skip bot check
TURNSTILE_SECRET_KEY=               # optional locally
```

`REPLICATE_WEBHOOK_TOKEN` can be any random string — it is compared against the `?token=` query param on incoming webhooks to prevent spoofing.

### 3. Provision Cloudflare resources (first time only)

```bash
npx wrangler r2 bucket create jingle-jaingle-media
npx wrangler d1 create jingle-jaingle
```

Copy the `database_id` printed by `d1 create` into `wrangler.jsonc` if Wrangler does not fill it automatically.

### 4. Apply the database schema

```bash
npx wrangler d1 migrations apply jingle-jaingle --local
```

### 5. Run the dev server

```bash
npm run dev
```

Vite runs on `http://localhost:5173`. The Worker runs on `http://localhost:8787`. Vite proxies `/api` and `/media` to the Worker automatically.

> **Webhook note:** Replicate cannot reach `localhost`, so generated jingles will stay in `queued` state locally. You can either use a tunnel (`cloudflared tunnel --url http://localhost:8787`) or test the webhook manually with a tool like `curl`.

---

## Deploying to Cloudflare

### 1. Push secrets

```bash
npx wrangler secret bulk .dev.vars
```

Or set them individually:

```bash
npx wrangler secret put REPLICATE_API_TOKEN
npx wrangler secret put REPLICATE_WEBHOOK_TOKEN
npx wrangler secret put TURNSTILE_SECRET_KEY
```

### 2. Apply remote migrations

```bash
npx wrangler d1 migrations apply jingle-jaingle --remote
```

### 3. Deploy

```bash
npm run deploy
```

This runs `tsc -b && vite build` then `wrangler deploy`.

---

## API reference

All routes are handled by the single Worker in `worker/index.ts`.

| Method | Path | Description |
|---|---|---|
| `GET` | `/api/config` | Returns `{ turnstilesitekey }` for the frontend |
| `GET` | `/api/jingles` | Paginated leaderboard (`?cursor=` for next page, 12 per page) |
| `GET` | `/api/jingles/:id` | Single jingle |
| `POST` | `/api/jingles` | Create — multipart form with `image` + `cf-turnstile-response` |
| `POST` | `/api/jingles/:id/vote` | Vote (cookie-deduplicated) |
| `DELETE` | `/api/jingles/:id` | Delete — requires `Authorization: Bearer <delete_token>` |
| `GET` | `/api/admin/jingles` | Admin list of jingles |
| `DELETE` | `/api/admin/jingles/:id` | Admin delete route |
| `POST` | `/api/replicate/webhook` | Replicate completion callback |
| `GET` | `/media/jingles/:id/image` | Serve product image from R2 |
| `GET` | `/media/jingles/:id/audio` | Serve generated audio from R2 |
| `GET` | `/share/:id` | Dynamic OG meta page for social sharing |

---

## Environment variables

| Variable | Where set | Description |
|---|---|---|
| `SITE_URL` | `wrangler.jsonc` vars | Production base URL for share links |
| `TURNSTILE_SITE_KEY` | `wrangler.jsonc` vars | Public Turnstile key (safe to commit) |
| `REPLICATE_API_TOKEN` | Wrangler secret | Replicate API key |
| `REPLICATE_WEBHOOK_TOKEN` | Wrangler secret | Shared secret for webhook verification |
| `TURNSTILE_SECRET_KEY` | Wrangler secret | Turnstile server-side key |

---

## Rate limiting

The generate endpoint (`POST /api/jingles`) is rate-limited to **5 requests per IP per hour** using Cloudflare KV. The limit and window are set at the top of `worker/index.ts`:

```ts
const RATE_LIMIT_MAX = 5
const RATE_LIMIT_WINDOW_SECONDS = 3600
```

Adjust as needed before deploying.

---

## Admin

The app includes an admin page at `/admin` for reviewing uploaded jingles and deleting them.

In production, protect both of these with Cloudflare Access:

- `/admin`
- `/api/admin/*`

Local dev does not enforce admin auth on its own. The intended production setup is Access in front of the Worker, not an application-level `ADMIN_TOKEN` check.

---

## Turnstile (bot protection)

Create a widget at [dash.cloudflare.com → Turnstile](https://dash.cloudflare.com/?to=/:account/turnstile). Use **Invisible** mode and add your deployment hostname. Set `TURNSTILE_SITE_KEY` in `wrangler.jsonc` vars and `TURNSTILE_SECRET_KEY` as a Wrangler secret.

If `TURNSTILE_SECRET_KEY` is absent (e.g. local dev without the secret) the server-side check is skipped gracefully.

---

## Scripts

```bash
npm run dev          # Vite + Worker in parallel
npm run dev:ui       # Vite only
npm run dev:worker   # Worker only
npm run build        # TypeScript + Vite production build
npm run deploy       # build + wrangler deploy
npm run lint         # ESLint
npm run cf-typegen   # Regenerate Worker TypeScript types from wrangler.jsonc
```

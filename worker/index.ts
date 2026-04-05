type JingleStatus = 'queued' | 'processing' | 'succeeded' | 'failed'

type Env = {
  ASSETS: Fetcher
  DB: D1Database
  RATE_LIMIT: KVNamespace
  MEDIA_BUCKET: R2Bucket
  REPLICATE_API_TOKEN: string
  REPLICATE_WEBHOOK_TOKEN: string
  SITE_URL: string
  TURNSTILE_SITE_KEY: string
  TURNSTILE_SECRET_KEY: string
  ADMIN_TOKEN: string
}

const PAGE_SIZE = 12
// Rate limit: max generations per IP per window
const RATE_LIMIT_MAX = 5
const RATE_LIMIT_WINDOW_SECONDS = 3600 // 1 hour

type DbJingle = {
  id: string
  status: JingleStatus
  image_key: string
  image_content_type: string
  audio_key: string | null
  audio_content_type: string | null
  votes: number
  created_at: string
  updated_at: string
  error_message: string | null
  replicate_prediction_id: string | null
  replicate_output_url: string | null
  replicate_web_url: string | null
  delete_token: string | null
  video_key: string | null
  video_content_type: string | null
  video_status: string | null
  video_error: string | null
  video_replicate_id: string | null
}

const WAN_MODEL_VERSION = '828436fb90dcc167bc1566ba13c294d98c68fdbfbdcdd7a095149c98c7a9e668'

type ReplicatePrediction = {
  id?: string
  status?: string
  error?: string | null
  output?: string | string[] | null
  urls?: {
    web?: string
  }
}

// Each entry is a distinct creative direction. One is picked at random per generation
// so the output varies in genre, voice, mood, and instrumentation.
const COMMERCIAL_PROMPTS = [
  // Upbeat pop jingle — the classic ad spot
  '[Verse] Upbeat, punchy TV commercial jingle inspired by the product in the image. Bright, hooky melody, enthusiastic male and female vocal duo, hand claps, driving snare, key change into the final chorus. Sung slogan that names the product. [Chorus] Catchy, memorable, positive energy, ends with a triumphant sting.',

  // Lo-fi chill / lifestyle
  '[Intro] Warm lo-fi hip-hop commercial for the product in the image. Mellow guitar loop, soft vinyl crackle, laid-back female vocal, dreamy reverb, gentle bass. Relaxed lifestyle vibe. [Hook] Simple sung tagline. [Outro] Fades on a muted chord.',

  // Big orchestral / cinematic spot
  '[Intro] Epic cinematic commercial fanfare for the product in the image. Full orchestra — soaring strings, bold brass stabs, snare rolls. Heroic male baritone voice-over style singing. Builds to a massive final chord. Inspirational and grand.',

  // Retro 80s synth-pop
  '[Verse] Retro 1980s synth-pop jingle for the product in the image. Pulsing Juno-style synth bass, gated reverb snare, bright arpeggiated leads, catchy falsetto chorus with harmonies. Neon-and-chrome energy. [Chorus] Sing-along hook with call-and-response backing vocals.',

  // Country twang
  '[Intro] Friendly country-style TV commercial jingle for the product in the image. Acoustic guitar strum, fiddle, warm male tenor vocal, light banjo picking. Folksy, honest, community-feel. [Chorus] Simple singalong hook. [Outro] Pedal steel resolve.',

  // Funky soul / R&B
  '[Intro] Funky soul commercial for the product in the image. Tight rhythm section, wah-wah guitar, punchy horn section, soulful female lead vocal with gospel-style backing chorus. Irresistible groove. [Hook] Catchy call-and-response lyric about the product. [Outro] Big band finish.',

  // Kids / playful / animated
  '[Intro] Bright, playful children\'s TV jingle for the product in the image. Ukulele, glockenspiel, bouncy xylophone, enthusiastic children\'s choir, cartoon sound effects. Joyful and energetic. [Chorus] Simple, repetitive sung tagline kids can sing along to.',

  // Luxury / premium / minimalist
  '[Intro] Elegant, minimal luxury brand spot for the product in the image. Solo piano, soft strings, breathy intimate female vocal. Sophisticated, understated, aspirational. No drums. [Hook] Single sung line — refined and memorable. [Outro] Dissolves on a single piano note.',
]

function pickPrompt(): string {
  const idx = Math.floor(Math.random() * COMMERCIAL_PROMPTS.length)
  return COMMERCIAL_PROMPTS[idx]
}

const JSON_HEADERS = {
  'content-type': 'application/json; charset=utf-8',
}

const worker: ExportedHandler<Env> = {
  async fetch(request: Request, env: Env): Promise<Response> {
    try {
      const url = new URL(request.url)

      if (request.method === 'GET' && url.pathname === '/api/config') {
        return json({ turnstilesitekey: env.TURNSTILE_SITE_KEY ?? '' })
      }

      if (request.method === 'GET' && url.pathname === '/api/jingles') {
        return listJingles(request, env)
      }

      const jingleRoute = url.pathname.match(/^\/api\/jingles\/([0-9a-f-]+)$/)
      if (request.method === 'GET' && jingleRoute) {
        return getJingle(request, env, jingleRoute[1])
      }

      const voteRoute = url.pathname.match(/^\/api\/jingles\/([0-9a-f-]+)\/vote$/)
      if (request.method === 'POST' && voteRoute) {
        return voteForJingle(request, env, voteRoute[1])
      }

      const deleteRoute = url.pathname.match(/^\/api\/jingles\/([0-9a-f-]+)$/)
      if (request.method === 'DELETE' && deleteRoute) {
        return deleteJingle(request, env, deleteRoute[1])
      }

      if (request.method === 'POST' && url.pathname === '/api/jingles') {
        return createJingle(request, env)
      }

      if (request.method === 'POST' && url.pathname === '/api/replicate/webhook') {
        return handleReplicateWebhook(request, env)
      }

      if (request.method === 'POST' && url.pathname === '/api/replicate/video-webhook') {
        return handleVideoWebhook(request, env)
      }

      if (request.method === 'POST' && url.pathname === '/api/admin/video') {
        return handleAdminGenerateVideo(request, env)
      }

      if (request.method === 'GET' && url.pathname === '/api/admin/status') {
        return handleAdminStatus(request, env)
      }

      const mediaRoute = url.pathname.match(/^\/media\/jingles\/([0-9a-f-]+)\/(image|audio|video)$/)
      if (request.method === 'GET' && mediaRoute) {
        return getMediaAsset(env, mediaRoute[1], mediaRoute[2])
      }

      // Dynamic OG share page — /share/:id returns a minimal HTML page with
      // correct Open Graph and Twitter Card tags so social crawlers pick them up.
      const shareRoute = url.pathname.match(/^\/share\/([0-9a-f-]+)$/)
      if (request.method === 'GET' && shareRoute) {
        return getSharePage(request, env, shareRoute[1])
      }

      return env.ASSETS.fetch(request)
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unexpected worker error'
      return json({ error: message }, 500)
    }
  },
}

export default worker

async function listJingles(request: Request, env: Env) {
  const origin = new URL(request.url).origin
  const url = new URL(request.url)
  const votedIds = readVotedIds(request.headers.get('cookie'))

  // cursor = "votes:created_at:id" of the last seen row, opaque to the client
  const cursorParam = url.searchParams.get('cursor')
  let cursorVotes: number | null = null
  let cursorCreated: string | null = null
  let cursorId: string | null = null

  if (cursorParam) {
    try {
      const decoded = atob(cursorParam)
      const [v, c, i] = decoded.split('|')
      cursorVotes = parseInt(v, 10)
      cursorCreated = c
      cursorId = i
    } catch {
      // ignore bad cursor, start from beginning
    }
  }

  const limit = PAGE_SIZE + 1 // fetch one extra to know if there's a next page

  const result = cursorVotes === null
    ? await env.DB.prepare(
        `SELECT id, status, image_key, image_content_type, audio_key, audio_content_type,
                votes, created_at, updated_at, error_message,
                replicate_prediction_id, replicate_output_url, replicate_web_url
         FROM jingles
         ORDER BY votes DESC, created_at DESC
         LIMIT ?1`,
      ).bind(limit).all<DbJingle>()
    : await env.DB.prepare(
        `SELECT id, status, image_key, image_content_type, audio_key, audio_content_type,
                votes, created_at, updated_at, error_message,
                replicate_prediction_id, replicate_output_url, replicate_web_url
         FROM jingles
         WHERE (votes < ?1)
            OR (votes = ?1 AND created_at < ?2)
            OR (votes = ?1 AND created_at = ?2 AND id < ?3)
         ORDER BY votes DESC, created_at DESC
         LIMIT ?4`,
      ).bind(cursorVotes, cursorCreated, cursorId, limit).all<DbJingle>()

  const rows = result.results
  const hasMore = rows.length > PAGE_SIZE
  const page = hasMore ? rows.slice(0, PAGE_SIZE) : rows

  let nextCursor: string | null = null
  if (hasMore) {
    const last = page[page.length - 1]
    nextCursor = btoa(`${last.votes}|${last.created_at}|${last.id}`)
  }

  return json({
    jingles: page.map((jingle) => serializeJingle(jingle, origin, votedIds, env.SITE_URL)),
    nextCursor,
  })
}

async function getJingle(request: Request, env: Env, id: string) {
  const record = await findJingle(env, id)

  if (!record) {
    return json({ error: 'Jingle not found.' }, 404)
  }

  return json({
    jingle: serializeJingle(record, new URL(request.url).origin, readVotedIds(request.headers.get('cookie')), env.SITE_URL),
  })
}

async function createJingle(request: Request, env: Env) {
  ensureReplicateConfig(env)

  const formData = await request.formData()

  // Verify Turnstile token when a secret key is configured.
  if (env.TURNSTILE_SECRET_KEY) {
    const token = formData.get('cf-turnstile-response')
    if (!token || typeof token !== 'string') {
      return json({ error: 'Missing Turnstile token. Please try again.' }, 400)
    }
    const ip = request.headers.get('CF-Connecting-IP') ?? undefined
    const ok = await verifyTurnstile(token, env.TURNSTILE_SECRET_KEY, ip)
    if (!ok) {
      return json({ error: 'Bot check failed. Please try again.' }, 403)
    }
  }

  // IP-based rate limit: max RATE_LIMIT_MAX generations per RATE_LIMIT_WINDOW_SECONDS
  if (env.RATE_LIMIT) {
    const ip = request.headers.get('CF-Connecting-IP') ?? 'unknown'
    const window = Math.floor(Date.now() / (RATE_LIMIT_WINDOW_SECONDS * 1000))
    const key = `rl:${ip}:${window}`
    const current = parseInt((await env.RATE_LIMIT.get(key)) ?? '0', 10)
    if (current >= RATE_LIMIT_MAX) {
      return json(
        { error: `Limit reached — max ${RATE_LIMIT_MAX} jingles per hour per IP. Come back later.` },
        429,
      )
    }
    await env.RATE_LIMIT.put(key, String(current + 1), { expirationTtl: RATE_LIMIT_WINDOW_SECONDS * 2 })
  }

  const image = formData.get('image')

  if (!(image instanceof File)) {
    return json({ error: 'Upload a single image file as the product prompt.' }, 400)
  }

  if (!image.type.startsWith('image/')) {
    return json({ error: 'Only image uploads are supported.' }, 400)
  }

  if (image.size > 10 * 1024 * 1024) {
    return json({ error: 'Keep uploads under 10MB.' }, 400)
  }

  const id = crypto.randomUUID()
  const deleteToken = crypto.randomUUID()
  const now = new Date().toISOString()
  const extension = extensionFor(image.type)
  const imageKey = `images/${id}${extension}`

  await env.MEDIA_BUCKET.put(imageKey, await image.arrayBuffer(), {
    httpMetadata: {
      contentType: image.type,
      cacheControl: 'public, max-age=31536000, immutable',
    },
  })

  await env.DB.prepare(
    `INSERT INTO jingles (
      id,
      status,
      image_key,
      image_content_type,
      votes,
      delete_token,
      created_at,
      updated_at
    ) VALUES (?1, 'queued', ?2, ?3, 0, ?4, ?5, ?5)`,
  )
    .bind(id, imageKey, image.type, deleteToken, now)
    .run()

  const origin = new URL(request.url).origin
  const webhookUrl = `${origin}/api/replicate/webhook?jingle=${encodeURIComponent(id)}&token=${encodeURIComponent(env.REPLICATE_WEBHOOK_TOKEN)}`
  const imageUrl = `${origin}/media/jingles/${id}/image`

  const replicateResponse = await fetch('https://api.replicate.com/v1/predictions', {
    method: 'POST',
    headers: {
      authorization: `Bearer ${env.REPLICATE_API_TOKEN}`,
      'content-type': 'application/json',
    },
    body: JSON.stringify({
      version: 'google/lyria-3',
      input: {
        prompt: pickPrompt(),
        images: [imageUrl],
      },
      webhook: webhookUrl,
      webhook_events_filter: ['completed'],
    }),
  })

  const prediction = (await replicateResponse.json()) as ReplicatePrediction & { detail?: string }

  if (!replicateResponse.ok) {
    const message = prediction.detail || prediction.error || 'Replicate rejected the request.'

    await env.DB.prepare(
      'UPDATE jingles SET status = ?2, error_message = ?3, updated_at = ?4 WHERE id = ?1',
    )
      .bind(id, 'failed', message, now)
      .run()

    return json({ error: message }, 502)
  }

  await env.DB.prepare(
    `UPDATE jingles
      SET status = ?2,
          replicate_prediction_id = ?3,
          replicate_web_url = ?4,
          updated_at = ?5
      WHERE id = ?1`,
  )
    .bind(id, mapReplicateStatus(prediction.status), prediction.id ?? null, prediction.urls?.web ?? null, now)
    .run()

  if (prediction.status === 'succeeded') {
    await storeCompletedPrediction(env, id, prediction)
  }

  const stored = await findJingle(env, id)

  if (!stored) {
    return json({ error: 'Jingle was created but could not be reloaded.' }, 500)
  }

  return json({ jingle: serializeJingle(stored, origin, new Set(), env.SITE_URL), deleteToken }, 201)
}

async function voteForJingle(request: Request, env: Env, id: string) {
  const record = await findJingle(env, id)

  if (!record) {
    return json({ error: 'Jingle not found.' }, 404)
  }

  if (record.status !== 'succeeded') {
    return json({ error: 'Only finished jingles can receive votes.' }, 409)
  }

  const votedIds = readVotedIds(request.headers.get('cookie'))
  if (votedIds.has(id)) {
    return json(
      {
        error: 'This browser already voted for that jingle.',
        jingle: serializeJingle(record, new URL(request.url).origin, votedIds, env.SITE_URL),
      },
      409,
    )
  }

  await env.DB.prepare('UPDATE jingles SET votes = votes + 1, updated_at = ?2 WHERE id = ?1')
    .bind(id, new Date().toISOString())
    .run()

  const updated = await findJingle(env, id)

  if (!updated) {
    return json({ error: 'Vote counted, but the row could not be reloaded.' }, 500)
  }

  const nextVotedIds = new Set(votedIds)
  nextVotedIds.add(id)

  return json(
    {
      jingle: serializeJingle(updated, new URL(request.url).origin, nextVotedIds, env.SITE_URL),
    },
    200,
    {
      'set-cookie': buildVoteCookie(nextVotedIds),
    },
  )
}

async function handleReplicateWebhook(request: Request, env: Env) {
  ensureReplicateConfig(env)

  const url = new URL(request.url)
  if (url.searchParams.get('token') !== env.REPLICATE_WEBHOOK_TOKEN) {
    return json({ error: 'Invalid webhook token.' }, 401)
  }

  const jingleId = url.searchParams.get('jingle')
  if (!jingleId) {
    return json({ error: 'Missing jingle id.' }, 400)
  }

  const prediction = (await request.json()) as ReplicatePrediction

  const record = await findJingle(env, jingleId)
  if (!record) {
    return json({ error: 'Jingle not found.' }, 404)
  }

  if (record.replicate_prediction_id && prediction.id && record.replicate_prediction_id !== prediction.id) {
    return json({ error: 'Prediction id does not match this jingle.' }, 409)
  }

  if (prediction.status === 'succeeded') {
    await storeCompletedPrediction(env, jingleId, prediction)
    return json({ ok: true })
  }

  if (prediction.status === 'failed' || prediction.status === 'canceled') {
    await env.DB.prepare(
      `UPDATE jingles
        SET status = 'failed',
            error_message = ?2,
            updated_at = ?3
        WHERE id = ?1`,
    )
      .bind(jingleId, prediction.error || 'Replicate failed to produce audio for this image.', new Date().toISOString())
      .run()
  }

  return json({ ok: true })
}

async function storeCompletedPrediction(env: Env, jingleId: string, prediction: ReplicatePrediction) {
  const outputUrl = normalizeOutputUrl(prediction.output)

  if (!outputUrl) {
    await env.DB.prepare(
      `UPDATE jingles
        SET status = 'failed',
            error_message = ?2,
            updated_at = ?3
        WHERE id = ?1`,
    )
      .bind(jingleId, 'Replicate returned no audio output URL.', new Date().toISOString())
      .run()
    return
  }

  const audioResponse = await fetch(outputUrl, {
    headers: {
      authorization: `Bearer ${env.REPLICATE_API_TOKEN}`,
    },
  })

  if (!audioResponse.ok) {
    await env.DB.prepare(
      `UPDATE jingles
        SET status = 'failed',
            error_message = ?2,
            updated_at = ?3
        WHERE id = ?1`,
    )
      .bind(jingleId, `Could not fetch generated audio (${audioResponse.status}).`, new Date().toISOString())
      .run()
    return
  }

  const audioKey = `audio/${jingleId}.mp3`
  const audioType = audioResponse.headers.get('content-type') || 'audio/mpeg'

  await env.MEDIA_BUCKET.put(audioKey, await audioResponse.arrayBuffer(), {
    httpMetadata: {
      contentType: audioType,
      cacheControl: 'public, max-age=31536000, immutable',
    },
  })

  await env.DB.prepare(
    `UPDATE jingles
      SET status = 'succeeded',
          audio_key = ?2,
          audio_content_type = ?3,
          replicate_output_url = ?4,
          replicate_web_url = COALESCE(?5, replicate_web_url),
          error_message = NULL,
          updated_at = ?6
      WHERE id = ?1`,
  )
    .bind(
      jingleId,
      audioKey,
      audioType,
      outputUrl,
      prediction.urls?.web ?? null,
      new Date().toISOString(),
    )
    .run()
}

async function getMediaAsset(env: Env, jingleId: string, kind: string) {
  const record = await findJingle(env, jingleId)

  if (!record) {
    return new Response('Not found', { status: 404 })
  }

  const key = kind === 'image' ? record.image_key
    : kind === 'audio' ? record.audio_key
    : record.video_key
  if (!key) {
    return new Response('Not found', { status: 404 })
  }

  const object = await env.MEDIA_BUCKET.get(key)
  if (!object) {
    return new Response('Not found', { status: 404 })
  }

  const headers = new Headers()
  object.writeHttpMetadata(headers)
  headers.set('etag', object.httpEtag)
  headers.set('cache-control', 'public, max-age=31536000, immutable')

  return new Response(object.body, { headers })
}

async function findJingle(env: Env, id: string) {
  return env.DB.prepare(
    `SELECT
      id,
      status,
      image_key,
      image_content_type,
      audio_key,
      audio_content_type,
      votes,
      created_at,
      updated_at,
      error_message,
      replicate_prediction_id,
      replicate_output_url,
      replicate_web_url,
      delete_token,
      video_key,
      video_content_type,
      video_status,
      video_error,
      video_replicate_id
    FROM jingles
    WHERE id = ?1`,
  )
    .bind(id)
    .first<DbJingle>()
}

async function deleteJingle(request: Request, env: Env, id: string) {
  const record = await findJingle(env, id)

  if (!record) {
    return json({ error: 'Jingle not found.' }, 404)
  }

  // Token comes in the Authorization header as "Bearer <token>"
  const authHeader = request.headers.get('authorization') ?? ''
  const token = authHeader.startsWith('Bearer ') ? authHeader.slice(7).trim() : ''

  if (!token || !record.delete_token || token !== record.delete_token) {
    return json({ error: 'Invalid or missing delete token.' }, 403)
  }

  // Delete R2 objects — best effort, don't fail if already gone
  const keysToDelete = [record.image_key, record.audio_key].filter(Boolean) as string[]
  await Promise.allSettled(keysToDelete.map((key) => env.MEDIA_BUCKET.delete(key)))

  await env.DB.prepare('DELETE FROM jingles WHERE id = ?1').bind(id).run()

  return json({ ok: true })
}

async function getSharePage(request: Request, env: Env, id: string) {
  const record = await findJingle(env, id)
  const origin = new URL(request.url).origin
  const base = env.SITE_URL ? env.SITE_URL.replace(/\/$/, '') : origin

  const title = record
    ? `jingle jAIngle — Commercial Cut #${id.slice(0, 6)}`
    : 'jingle jAIngle'
  const description = record
    ? `A product jingle made with Google's Lyria 3 on Replicate, hosted on Cloudflare. ${record.votes} vote${record.votes === 1 ? '' : 's'} so far.`
    : 'Drop a product photo. Get a 30-second jingle made with Google\'s Lyria 3 on Replicate, hosted on Cloudflare.'
  const imageUrl = record ? `${origin}/media/jingles/${id}/image` : `${base}/favicon.svg`
  const pageUrl = `${base}/share/${id}`
  const appUrl = record ? `${base}/?jingle=${id}` : base

  const html = `<!doctype html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>${escapeHtml(title)}</title>
  <meta name="description" content="${escapeHtml(description)}" />

  <!-- Open Graph -->
  <meta property="og:type" content="website" />
  <meta property="og:url" content="${escapeHtml(pageUrl)}" />
  <meta property="og:title" content="${escapeHtml(title)}" />
  <meta property="og:description" content="${escapeHtml(description)}" />
  <meta property="og:image" content="${escapeHtml(imageUrl)}" />
  <meta property="og:image:width" content="1200" />
  <meta property="og:image:height" content="630" />
  <meta property="og:site_name" content="jingle jAIngle" />

  <!-- Twitter / X Card -->
  <meta name="twitter:card" content="summary_large_image" />
  <meta name="twitter:title" content="${escapeHtml(title)}" />
  <meta name="twitter:description" content="${escapeHtml(description)}" />
  <meta name="twitter:image" content="${escapeHtml(imageUrl)}" />

  <!-- Immediately redirect humans to the app -->
  <meta http-equiv="refresh" content="0; url=${escapeHtml(appUrl)}" />
  <link rel="canonical" href="${escapeHtml(appUrl)}" />
</head>
<body>
  <p>Redirecting… <a href="${escapeHtml(appUrl)}">Click here if it doesn't happen automatically.</a></p>
</body>
</html>`

  return new Response(html, {
    headers: { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'public, max-age=60' },
  })
}

// ── Admin helpers ─────────────────────────────────────────────────────────────

function requireAdminToken(request: Request, env: Env) {
  const auth = request.headers.get('authorization') ?? ''
  const token = auth.startsWith('Bearer ') ? auth.slice(7).trim() : ''
  if (!env.ADMIN_TOKEN || token !== env.ADMIN_TOKEN) {
    return json({ error: 'Unauthorized.' }, 401)
  }
  return null
}

async function handleAdminStatus(request: Request, env: Env) {
  const denied = requireAdminToken(request, env)
  if (denied) return denied

  const origin = new URL(request.url).origin

  // Top succeeded jingle by votes
  const top = await env.DB.prepare(
    `SELECT
      id, status, votes, image_key, audio_key,
      video_key, video_status, video_error, video_replicate_id,
      created_at, updated_at, error_message,
      replicate_prediction_id, replicate_output_url, replicate_web_url,
      image_content_type, audio_content_type, video_content_type, delete_token
    FROM jingles
    WHERE status = 'succeeded'
    ORDER BY votes DESC, created_at DESC
    LIMIT 1`,
  ).first<DbJingle>()

  return json({
    topJingle: top ? serializeJingle(top, origin, new Set(), env.SITE_URL) : null,
    topJingleRaw: top ? {
      id: top.id,
      votes: top.votes,
      imageKey: top.image_key,
      audioKey: top.audio_key,
      videoKey: top.video_key,
      videoStatus: top.video_status,
      videoError: top.video_error,
    } : null,
  })
}

async function handleAdminGenerateVideo(request: Request, env: Env) {
  const denied = requireAdminToken(request, env)
  if (denied) return denied

  ensureReplicateConfig(env)

  const origin = new URL(request.url).origin

  // Accept optional explicit jingle id in body, otherwise use top-voted
  let jingleId: string | null = null
  try {
    const body = (await request.json()) as { jingleId?: string }
    jingleId = body.jingleId ?? null
  } catch { /* no body is fine */ }

  const record = jingleId
    ? await findJingle(env, jingleId)
    : await env.DB.prepare(
        `SELECT
          id, status, votes, image_key, audio_key,
          video_key, video_status, video_error, video_replicate_id,
          created_at, updated_at, error_message,
          replicate_prediction_id, replicate_output_url, replicate_web_url,
          image_content_type, audio_content_type, video_content_type, delete_token
        FROM jingles
        WHERE status = 'succeeded' AND audio_key IS NOT NULL
        ORDER BY votes DESC, created_at DESC
        LIMIT 1`,
      ).first<DbJingle>()

  if (!record) {
    return json({ error: 'No eligible jingle found.' }, 404)
  }

  if (record.status !== 'succeeded' || !record.audio_key) {
    return json({ error: 'Jingle is not yet succeeded or has no audio.' }, 409)
  }

  // Already has a good video — skip unless forced
  if (record.video_status === 'succeeded') {
    return json({ error: 'This jingle already has a video. Pass a different jingle id to regenerate.', jingleId: record.id }, 409)
  }

  const audioUrl = `${origin}/media/jingles/${record.id}/audio`
  const imageUrl = `${origin}/media/jingles/${record.id}/image`
  const webhookUrl = `${origin}/api/replicate/video-webhook?jingle=${encodeURIComponent(record.id)}&token=${encodeURIComponent(env.REPLICATE_WEBHOOK_TOKEN)}`

  const replicateRes = await fetch('https://api.replicate.com/v1/predictions', {
    method: 'POST',
    headers: {
      authorization: `Bearer ${env.REPLICATE_API_TOKEN}`,
      'content-type': 'application/json',
    },
    body: JSON.stringify({
      version: WAN_MODEL_VERSION,
      input: {
        first_frame: imageUrl,
        audio: audioUrl,
        prompt: 'A dynamic product commercial advertisement. The product animates with energy and motion in sync with the music. Professional studio lighting. Cinematic camera movement.',
        duration: 5,
        resolution: '720p',
        enable_prompt_expansion: false,
      },
      webhook: webhookUrl,
      webhook_events_filter: ['completed'],
    }),
  })

  const prediction = (await replicateRes.json()) as ReplicatePrediction & { detail?: string; id?: string }

  if (!replicateRes.ok) {
    return json({ error: prediction.detail || prediction.error || 'Replicate rejected the video request.' }, 502)
  }

  await env.DB.prepare(
    `UPDATE jingles
     SET video_status = 'queued',
         video_replicate_id = ?2,
         video_error = NULL,
         updated_at = ?3
     WHERE id = ?1`,
  ).bind(record.id, prediction.id ?? null, new Date().toISOString()).run()

  return json({ ok: true, jingleId: record.id, predictionId: prediction.id })
}

async function handleVideoWebhook(request: Request, env: Env) {
  ensureReplicateConfig(env)

  const url = new URL(request.url)
  if (url.searchParams.get('token') !== env.REPLICATE_WEBHOOK_TOKEN) {
    return json({ error: 'Invalid webhook token.' }, 401)
  }

  const jingleId = url.searchParams.get('jingle')
  if (!jingleId) return json({ error: 'Missing jingle id.' }, 400)

  const prediction = (await request.json()) as ReplicatePrediction

  if (prediction.status === 'failed' || prediction.status === 'canceled') {
    await env.DB.prepare(
      `UPDATE jingles
       SET video_status = 'failed',
           video_error = ?2,
           updated_at = ?3
       WHERE id = ?1`,
    ).bind(jingleId, prediction.error || 'Video generation failed.', new Date().toISOString()).run()
    return json({ ok: true })
  }

  if (prediction.status !== 'succeeded') {
    return json({ ok: true })
  }

  const outputUrl = normalizeOutputUrl(prediction.output)
  if (!outputUrl) {
    await env.DB.prepare(
      `UPDATE jingles SET video_status = 'failed', video_error = ?2, updated_at = ?3 WHERE id = ?1`,
    ).bind(jingleId, 'Wan returned no video output URL.', new Date().toISOString()).run()
    return json({ ok: true })
  }

  const videoRes = await fetch(outputUrl, {
    headers: { authorization: `Bearer ${env.REPLICATE_API_TOKEN}` },
  })

  if (!videoRes.ok) {
    await env.DB.prepare(
      `UPDATE jingles SET video_status = 'failed', video_error = ?2, updated_at = ?3 WHERE id = ?1`,
    ).bind(jingleId, `Could not fetch video (${videoRes.status}).`, new Date().toISOString()).run()
    return json({ ok: true })
  }

  const videoKey = `video/${jingleId}.mp4`
  const videoType = videoRes.headers.get('content-type') || 'video/mp4'

  await env.MEDIA_BUCKET.put(videoKey, await videoRes.arrayBuffer(), {
    httpMetadata: {
      contentType: videoType,
      cacheControl: 'public, max-age=31536000, immutable',
    },
  })

  await env.DB.prepare(
    `UPDATE jingles
     SET video_status = 'succeeded',
         video_key = ?2,
         video_content_type = ?3,
         video_error = NULL,
         updated_at = ?4
     WHERE id = ?1`,
  ).bind(jingleId, videoKey, videoType, new Date().toISOString()).run()

  return json({ ok: true })
}

async function verifyTurnstile(token: string, secret: string, ip?: string) {
  const body = new FormData()
  body.append('secret', secret)
  body.append('response', token)
  if (ip) body.append('remoteip', ip)

  try {
    const res = await fetch('https://challenges.cloudflare.com/turnstile/v0/siteverify', {
      method: 'POST',
      body,
    })
    const data = (await res.json()) as { success: boolean }
    return data.success === true
  } catch {
    return false
  }
}

function escapeHtml(str: string) {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

function serializeJingle(record: DbJingle, origin: string, votedIds: Set<string>, siteUrl?: string) {
  const base = siteUrl ? siteUrl.replace(/\/$/, '') : origin
  return {
    id: record.id,
    status: record.status,
    votes: record.votes,
    imageUrl: `${origin}/media/jingles/${record.id}/image`,
    audioUrl: record.audio_key ? `${origin}/media/jingles/${record.id}/audio` : null,
    videoUrl: record.video_key ? `${origin}/media/jingles/${record.id}/video` : null,
    videoStatus: record.video_status ?? null,
    shareUrl: `${base}/share/${record.id}`,
    hasVoted: votedIds.has(record.id),
    errorMessage: record.error_message,
    replicateUrl: record.replicate_web_url,
    createdAt: record.created_at,
    updatedAt: record.updated_at,
  }
}

function mapReplicateStatus(status?: string): JingleStatus {
  switch (status) {
    case 'starting':
    case 'processing':
      return 'processing'
    case 'succeeded':
      return 'succeeded'
    case 'failed':
    case 'canceled':
      return 'failed'
    default:
      return 'queued'
  }
}

function normalizeOutputUrl(output: ReplicatePrediction['output']) {
  if (typeof output === 'string') {
    return output
  }

  if (Array.isArray(output)) {
    const [first] = output
    return typeof first === 'string' ? first : null
  }

  return null
}

function ensureReplicateConfig(env: Env) {
  if (!env.REPLICATE_API_TOKEN || !env.REPLICATE_WEBHOOK_TOKEN) {
    throw new Error('REPLICATE_API_TOKEN and REPLICATE_WEBHOOK_TOKEN must both be configured.')
  }
}

function extensionFor(contentType: string) {
  switch (contentType) {
    case 'image/jpeg':
      return '.jpg'
    case 'image/png':
      return '.png'
    case 'image/webp':
      return '.webp'
    case 'image/gif':
      return '.gif'
    default:
      return ''
  }
}

function readVotedIds(cookieHeader: string | null) {
  const votes = new Set<string>()
  if (!cookieHeader) {
    return votes
  }

  const cookie = cookieHeader
    .split(';')
    .map((part) => part.trim())
    .find((part) => part.startsWith('jj_votes='))

  if (!cookie) {
    return votes
  }

  const decoded = decodeURIComponent(cookie.slice('jj_votes='.length))

  for (const id of decoded.split(',')) {
    if (id) {
      votes.add(id)
    }
  }

  return votes
}

function buildVoteCookie(votedIds: Set<string>) {
  return `jj_votes=${encodeURIComponent(Array.from(votedIds).join(','))}; Path=/; Max-Age=31536000; SameSite=Lax`
}

function json(payload: unknown, status = 200, headers?: Record<string, string>) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: {
      ...JSON_HEADERS,
      ...headers,
    },
  })
}

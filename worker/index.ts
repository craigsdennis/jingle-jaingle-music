type JingleStatus = 'queued' | 'processing' | 'succeeded' | 'failed'
type VideoStatus = 'queued' | 'processing' | 'succeeded' | 'failed'

type Env = {
  ASSETS: Fetcher
  CLOUDFLARE_ACCOUNT_ID: string
  CLOUDFLARE_STREAM_API_TOKEN: string
  DB: D1Database
  RATE_LIMIT: KVNamespace
  MEDIA_BUCKET: R2Bucket
  REPLICATE_API_TOKEN: string
  REPLICATE_WEBHOOK_TOKEN: string
  SITE_URL: string
  TURNSTILE_SITE_KEY: string
  TURNSTILE_SECRET_KEY: string
}

const PAGE_SIZE = 12
// Rate limit: max generations per IP per window
const RATE_LIMIT_MAX = 5
const RATE_LIMIT_WINDOW_SECONDS = 3600 // 1 hour
const MAX_VIDEO_UPLOAD_BYTES = 200 * 1024 * 1024

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
  video_status: VideoStatus | null
  video_error: string | null
  video_replicate_id: string | null
}

type ReplicatePrediction = {
  id?: string
  status?: string
  error?: string | null
  output?: string | string[] | null
  urls?: {
    web?: string
  }
}

// Lyria 3 reads the product image and decides the right commercial tone itself.
const COMMERCIAL_PROMPT =
  'A 30-second commercial jingle for the product shown in the image.\n\n'
  + 'First, read the product carefully — its category, visual style, colour palette, and the kind of person who would buy it. '
  + 'Let those cues decide the genre, tempo, instrumentation, and vocal tone. '
  + 'A children\'s toy should feel like a Saturday-morning ad. '
  + 'A luxury skincare line should feel like a prestige spot. '
  + 'A hot sauce should feel bold and fun. '
  + 'A power tool should feel confident and capable. '
  + 'Trust the product to set the brief.\n\n'
  + 'Whatever style you choose, the output must be structured like a real finished commercial:\n'
  + '- A short punchy intro that hooks the listener immediately\n'
  + '- A verse that sells the product\'s core benefit or feeling\n'
  + '- A chorus built around a short, singable tagline derived from what you see in the image\n'
  + '- A closing button — a crisp 2–4 bar sting that ends the spot cleanly\n\n'
  + 'The result should sound like something a real brand would actually run — produced, confident, and memorable. '
  + 'The tagline should be the kind of thing someone is still humming an hour later.'

function pickPrompt(): string {
  return COMMERCIAL_PROMPT
}

const JSON_HEADERS = {
  'content-type': 'application/json; charset=utf-8',
}

const worker: ExportedHandler<Env> = {
  async fetch(request: Request, env: Env): Promise<Response> {
    try {
      const url = new URL(request.url)

      if (request.method === 'GET' && url.pathname === '/api/config') {
        return json({ turnstilesitekey: turnstileSiteKeyForRequest(request, env) })
      }

      if (request.method === 'GET' && url.pathname === '/api/jingles') {
        return listJingles(request, env)
      }

      if (request.method === 'GET' && url.pathname === '/api/admin/jingles') {
        return listAdminJingles(request, env)
      }

      const adminDeleteRoute = url.pathname.match(/^\/api\/admin\/jingles\/([0-9a-f-]+)$/)
      if (request.method === 'DELETE' && adminDeleteRoute) {
        return deleteAdminJingle(env, adminDeleteRoute[1])
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

      // Matches with or without extension — extension ignored, kind drives the lookup
      const mediaRoute = url.pathname.match(/^\/media\/jingles\/([0-9a-f-]+)\/(image|audio|video)(?:\.\w+)?$/)
      if (request.method === 'GET' && mediaRoute) {
        return getMediaAsset(env, mediaRoute[1], mediaRoute[2])
      }

      const videoUploadRoute = url.pathname.match(/^\/api\/jingles\/([0-9a-f-]+)\/video$/)
      if (request.method === 'POST' && videoUploadRoute) {
        return handleVideoUpload(request, env, videoUploadRoute[1])
      }

      // Dynamic OG share page — /share/:id returns a minimal HTML page with
      // correct Open Graph and Twitter Card tags so social crawlers pick them up.
      const shareRoute = url.pathname.match(/^\/share\/([0-9a-f-]+)$/)
      if (request.method === 'GET' && shareRoute) {
        return getSharePage(request, env, shareRoute[1])
      }

      if ((request.method === 'GET' || request.method === 'HEAD') && (url.pathname === '/admin' || url.pathname === '/admin/')) {
        const assetUrl = new URL('/', request.url)
        return env.ASSETS.fetch(new Request(assetUrl.toString(), request))
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
                replicate_prediction_id, replicate_output_url, replicate_web_url,
                delete_token, video_key, video_content_type, video_status,
                video_error, video_replicate_id
         FROM jingles
         ORDER BY votes DESC, created_at DESC
         LIMIT ?1`,
      ).bind(limit).all<DbJingle>()
    : await env.DB.prepare(
        `SELECT id, status, image_key, image_content_type, audio_key, audio_content_type,
                votes, created_at, updated_at, error_message,
                replicate_prediction_id, replicate_output_url, replicate_web_url,
                delete_token, video_key, video_content_type, video_status,
                video_error, video_replicate_id
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

  const hydratedPage = await Promise.all(page.map((jingle) => syncStreamVideoIfNeeded(env, jingle)))

  return json({
    jingles: hydratedPage.map((jingle) => serializeJingle(jingle, origin, votedIds, env.SITE_URL)),
    nextCursor,
  })
}

async function getJingle(request: Request, env: Env, id: string) {
  const found = await findJingle(env, id)
  const record = found ? await syncStreamVideoIfNeeded(env, found) : null

  if (!record) {
    return json({ error: 'Jingle not found.' }, 404)
  }

  return json({
    jingle: serializeJingle(record, new URL(request.url).origin, readVotedIds(request.headers.get('cookie')), env.SITE_URL),
  })
}

async function listAdminJingles(request: Request, env: Env) {
  const origin = new URL(request.url).origin

  const result = await env.DB.prepare(
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
    ORDER BY created_at DESC
    LIMIT 100`,
  ).all<DbJingle>()

  return json({
    jingles: result.results.map((jingle) => serializeJingle(jingle, origin, new Set(), env.SITE_URL)),
  })
}

async function deleteAdminJingle(env: Env, id: string) {
  const record = await findJingle(env, id)

  if (!record) {
    return json({ error: 'Jingle not found.' }, 404)
  }

  await deleteStoredVideo(env, record)
  const assetKeys = [record.image_key, record.audio_key].filter(Boolean) as string[]
  await Promise.allSettled(assetKeys.map((key) => env.MEDIA_BUCKET.delete(key)))

  await env.DB.prepare('DELETE FROM jingles WHERE id = ?1').bind(id).run()

  return json({ ok: true })
}

async function createJingle(request: Request, env: Env) {
  ensureReplicateConfig(env)

  const formData = await request.formData()

  // Verify Turnstile token when a secret key is configured.
  if (shouldVerifyTurnstile(request, env)) {
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

  // ── NSFW check ──────────────────────────────────────────────────────────────
  // Convert image to base64 data URI and run it through Llama Guard 4 before
  // writing anything to R2 or D1. Uses Prefer: wait for a synchronous result.
  const imageBytes = await image.arrayBuffer()
  // btoa(String.fromCharCode(...bytes)) crashes on large images because spread
  // exhausts the call stack. Chunk it instead.
  const bytes = new Uint8Array(imageBytes)
  let binary = ''
  const CHUNK = 8192
  for (let i = 0; i < bytes.length; i += CHUNK) {
    binary += String.fromCharCode(...bytes.subarray(i, i + CHUNK))
  }
  const base64 = btoa(binary)
  const dataUri = `data:${image.type};base64,${base64}`

  const nsfwResult = await checkImageNsfw(dataUri, env.REPLICATE_API_TOKEN)
  // TEST MODE: force unsafe to verify rejection path — remove before shipping
  // const nsfwResult = 'unsafe'
  if (nsfwResult === 'unsafe') {
    return json({ error: 'This image was flagged as inappropriate and cannot be used.' }, 422)
  }
  // If the check itself failed (model error / timeout) we allow the upload
  // through rather than blocking legitimate users — fail open here.

  const id = crypto.randomUUID()
  const deleteToken = crypto.randomUUID()
  const now = new Date().toISOString()
  const extension = extensionFor(image.type)
  const imageKey = `images/${id}${extension}`

  await env.MEDIA_BUCKET.put(imageKey, imageBytes, {
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
  const found = await findJingle(env, jingleId)
  const record = found ? await syncStreamVideoIfNeeded(env, found) : null

  if (!record) {
    return new Response('Not found', { status: 404 })
  }

  if (kind === 'video' && record.video_key && isExternalUrl(record.video_key)) {
    return Response.redirect(record.video_key, 302)
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

  await deleteStoredVideo(env, record)
  const assetKeys = [record.image_key, record.audio_key].filter(Boolean) as string[]
  await Promise.allSettled(assetKeys.map((key) => env.MEDIA_BUCKET.delete(key)))

  await env.DB.prepare('DELETE FROM jingles WHERE id = ?1').bind(id).run()

  return json({ ok: true })
}

async function getSharePage(request: Request, env: Env, id: string) {
  const found = await findJingle(env, id)
  const record = found ? await syncStreamVideoIfNeeded(env, found) : null
  const origin = new URL(request.url).origin
  const base = env.SITE_URL ? env.SITE_URL.replace(/\/$/, '') : origin

  const title = record
    ? `jingle jAIngle — Commercial Cut #${id.slice(0, 6)}`
    : 'jingle jAIngle'
  const description = record
    ? `A product jingle made with Google's Lyria 3 on Replicate, hosted on Cloudflare. ${record.votes} vote${record.votes === 1 ? '' : 's'} so far.`
    : 'Drop a product photo. Get a 30-second jingle made with Google\'s Lyria 3 on Replicate, hosted on Cloudflare.'
  const imageUrl = record ? `${origin}/media/jingles/${id}/image` : `${base}/favicon.svg`
  const videoUrl = record ? serializedVideoUrl(record, origin) : null
  const videoType = record?.video_content_type ?? 'video/mp4'
  const pageUrl = `${base}/share/${id}`
  const appUrl = record ? `${base}/?jingle=${id}` : base

  // When a share video exists, switch to og:video — this gives proper video
  // cards on Slack, iMessage, Discord, LinkedIn, and Telegram. X is unreliable
  // with og:video but falls back gracefully to the image card.
  const html = `<!doctype html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>${escapeHtml(title)}</title>
  <meta name="description" content="${escapeHtml(description)}" />

  <!-- Open Graph -->
  <meta property="og:type" content="${videoUrl ? 'video.other' : 'website'}" />
  <meta property="og:url" content="${escapeHtml(pageUrl)}" />
  <meta property="og:title" content="${escapeHtml(title)}" />
  <meta property="og:description" content="${escapeHtml(description)}" />
  <meta property="og:image" content="${escapeHtml(imageUrl)}" />
  <meta property="og:image:width" content="1200" />
  <meta property="og:image:height" content="630" />
  <meta property="og:site_name" content="jingle jAIngle" />${videoUrl ? `
  <meta property="og:video" content="${escapeHtml(videoUrl)}" />
  <meta property="og:video:secure_url" content="${escapeHtml(videoUrl)}" />
  <meta property="og:video:type" content="${escapeHtml(videoType)}" />
  <meta property="og:video:width" content="1080" />
  <meta property="og:video:height" content="1080" />` : ''}

  <!-- Twitter / X Card -->
  <meta name="twitter:card" content="${videoUrl ? 'player' : 'summary_large_image'}" />
  <meta name="twitter:title" content="${escapeHtml(title)}" />
  <meta name="twitter:description" content="${escapeHtml(description)}" />
  <meta name="twitter:image" content="${escapeHtml(imageUrl)}" />${videoUrl ? `
  <meta name="twitter:player" content="${escapeHtml(videoUrl)}" />
  <meta name="twitter:player:width" content="1080" />
  <meta name="twitter:player:height" content="1080" />` : ''}

  <!-- Immediately redirect humans to the app -->
  <meta http-equiv="refresh" content="0; url=${escapeHtml(appUrl)}" />
  <link rel="canonical" href="${escapeHtml(appUrl)}" />
</head>
<body>
  <p>Redirecting… <a href="${escapeHtml(appUrl)}">Click here if it doesn't happen automatically.</a></p>
</body>
</html>`

  // Shorter cache when no video yet — so the card upgrades quickly after upload
  const cacheControl = videoUrl ? 'public, max-age=3600' : 'public, max-age=30'

  return new Response(html, {
    headers: { 'content-type': 'text/html; charset=utf-8', 'cache-control': cacheControl },
  })
}


async function handleVideoUpload(request: Request, env: Env, jingleId: string) {
  ensureStreamConfig(env)

  const record = await findJingle(env, jingleId)
  if (!record) return json({ error: 'Jingle not found.' }, 404)
  if (record.status !== 'succeeded') return json({ error: 'Only succeeded jingles can have a share video.' }, 409)

  const contentType = request.headers.get('content-type') || 'video/webm'
  const contentLength = Number.parseInt(request.headers.get('content-length') ?? '', 10)

  if (!contentType.startsWith('video/')) {
    return json({ error: 'Only video uploads are accepted.' }, 400)
  }

  if (!Number.isFinite(contentLength) || contentLength <= 0) {
    return json({ error: 'Missing video size for upload.' }, 400)
  }

  if (contentLength > MAX_VIDEO_UPLOAD_BYTES) {
    return json({ error: 'Video too large. Maximum 200MB.' }, 413)
  }

  const body = await request.arrayBuffer()

  if (body.byteLength === 0) {
    return json({ error: 'Could not read uploaded video.' }, 400)
  }

  try {
    const streamBody = new FormData()
    streamBody.append('file', new File([body], `jingle-${jingleId.slice(0, 8)}.webm`, { type: contentType }))

    const upload = await streamApi<{ uid?: string }>(env, '', {
      method: 'POST',
      body: streamBody,
    })

    const videoId = upload.result?.uid
    if (!videoId) {
      throw new Error('Cloudflare Stream did not return a video id.')
    }

    await deleteStoredVideo(env, record)

    await env.DB.prepare(
      `UPDATE jingles
        SET video_key = ?2,
            video_content_type = ?3,
            video_status = 'processing',
            video_error = NULL,
            video_replicate_id = ?4,
            updated_at = ?5
        WHERE id = ?1`,
    )
      .bind(jingleId, null, null, videoId, new Date().toISOString())
      .run()

    return json({ videoStatus: 'processing', videoUrl: null }, 201)
  } catch (error) {
    const message = error instanceof Error
      ? `Could not upload the video to Cloudflare Stream: ${error.message}`
      : 'Could not upload the video to Cloudflare Stream.'

    return json({ error: message }, 502)
  }
}

async function checkImageNsfw(dataUri: string, replicateToken: string): Promise<'safe' | 'unsafe' | 'unknown'> {
  try {
    const res = await fetch('https://api.replicate.com/v1/predictions', {
      method: 'POST',
      headers: {
        authorization: `Bearer ${replicateToken}`,
        'content-type': 'application/json',
        'prefer': 'wait=60',
      },
      body: JSON.stringify({
        version: 'b04f49b037b3a1476128f1c7434cf64385ccec6dc7d7d344647df0fc2103892c',
        input: {
          prompt: '<image>You are a content moderator for a family-friendly product jingle app. Does this image contain any of the following: nudity or sexual content, graphic violence or gore, blood or injury, offensive gestures, hate symbols, or anything else inappropriate for a public-facing commercial product? Reply with only the single word "safe" or "unsafe".',
          image_input: [dataUri],
          max_completion_tokens: 16,
          temperature: 0,
        },
      }),
    })

    if (!res.ok) return 'unknown'

    const prediction = (await res.json()) as { id?: string; status?: string; output?: string[]; urls?: { get?: string } }

    // If Prefer: wait returned before completion, poll until done (max ~30s)
    if (prediction.status === 'starting' || prediction.status === 'processing') {
      const getUrl = prediction.urls?.get
      if (!getUrl) return 'unknown'

      for (let i = 0; i < 10; i++) {
        await new Promise((r) => setTimeout(r, 3000))
        const pollRes = await fetch(getUrl, {
          headers: { authorization: `Bearer ${replicateToken}` },
        })
        if (!pollRes.ok) return 'unknown'
        const polled = (await pollRes.json()) as { status?: string; output?: string[] }
        if (polled.status === 'succeeded') {
          const text = polled.output?.join('').trim().toLowerCase() ?? ''
          if (text.startsWith('unsafe')) return 'unsafe'
          if (text.startsWith('safe')) return 'safe'
          return 'unknown'
        }
        if (polled.status === 'failed' || polled.status === 'canceled') return 'unknown'
      }
      return 'unknown' // timed out — fail open
    }

    if (prediction.status !== 'succeeded' || !prediction.output) return 'unknown'

    const text = prediction.output.join('').trim().toLowerCase()
    if (text.startsWith('unsafe')) return 'unsafe'
    if (text.startsWith('safe')) return 'safe'
    return 'unknown'
  } catch {
    return 'unknown'
  }
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
    videoUrl: serializedVideoUrl(record, origin),
    videoStatus: record.video_status ?? null,
    shareUrl: `${base}/share/${record.id}`,
    hasVoted: votedIds.has(record.id),
    errorMessage: record.error_message,
    videoError: record.video_error,
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

function ensureStreamConfig(env: Env) {
  if (!env.CLOUDFLARE_ACCOUNT_ID || !env.CLOUDFLARE_STREAM_API_TOKEN) {
    throw new Error('CLOUDFLARE_ACCOUNT_ID and CLOUDFLARE_STREAM_API_TOKEN must both be configured.')
  }
}

function hasStreamConfig(env: Env) {
  return Boolean(env.CLOUDFLARE_ACCOUNT_ID && env.CLOUDFLARE_STREAM_API_TOKEN)
}

async function syncStreamVideoIfNeeded(env: Env, record: DbJingle) {
  if (!record.video_replicate_id) {
    return record
  }

  if (!hasStreamConfig(env)) {
    return record
  }

  if (record.video_status === 'failed') {
    return record
  }

  if (record.video_status === 'succeeded' && record.video_key) {
    return record
  }

  try {
    const video = await streamApi<{
      readyToStream?: boolean
      status?: {
        state?: string
        errorReasonText?: string
      }
    }>(env, `/${record.video_replicate_id}`)
    const details = video.result

    if (details?.status?.state === 'error') {
      return updateVideoRecord(env, record, {
        video_error: details.status.errorReasonText || 'Cloudflare Stream could not process this upload.',
        video_key: null,
        video_content_type: null,
        video_status: 'failed',
      })
    }

    if (!details?.readyToStream) {
      if (record.video_status === 'processing') {
        return record
      }

      return updateVideoRecord(env, record, {
        video_error: null,
        video_key: null,
        video_content_type: null,
        video_status: 'processing',
      })
    }

    let downloads = await streamApi<{
      default?: {
        status?: 'ready' | 'inprogress' | 'error'
        url?: string
      }
    }>(env, `/${record.video_replicate_id}/downloads`)

    if (!downloads.result?.default) {
      downloads = await streamApi<{
        default?: {
          status?: 'ready' | 'inprogress' | 'error'
          url?: string
        }
      }>(env, `/${record.video_replicate_id}/downloads`, { method: 'POST' })
    }

    const mp4 = downloads.result?.default

    if (!mp4) {
      return updateVideoRecord(env, record, {
        video_error: null,
        video_key: null,
        video_content_type: null,
        video_status: 'processing',
      })
    }

    if (mp4.status === 'error') {
      return updateVideoRecord(env, record, {
        video_error: 'Cloudflare Stream could not generate the MP4 download.',
        video_key: null,
        video_content_type: null,
        video_status: 'failed',
      })
    }

    if (mp4.status !== 'ready' || !mp4.url) {
      return updateVideoRecord(env, record, {
        video_error: null,
        video_key: null,
        video_content_type: null,
        video_status: 'processing',
      })
    }

    return updateVideoRecord(env, record, {
      video_error: null,
      video_key: mp4.url,
      video_content_type: 'video/mp4',
      video_status: 'succeeded',
    })
  } catch {
    return record
  }
}

async function updateVideoRecord(env: Env, record: DbJingle, next: {
  video_error: string | null
  video_key: string | null
  video_content_type: string | null
  video_status: VideoStatus
}) {
  const now = new Date().toISOString()

  await env.DB.prepare(
    `UPDATE jingles
      SET video_key = ?2,
          video_content_type = ?3,
          video_status = ?4,
          video_error = ?5,
          updated_at = ?6
      WHERE id = ?1`,
  )
    .bind(record.id, next.video_key, next.video_content_type, next.video_status, next.video_error, now)
    .run()

  return {
    ...record,
    ...next,
    updated_at: now,
  }
}

async function deleteStoredVideo(env: Env, record: DbJingle) {
  const tasks: Array<Promise<unknown>> = []

  if (record.video_key && !isExternalUrl(record.video_key)) {
    tasks.push(env.MEDIA_BUCKET.delete(record.video_key))
  }

  if (record.video_replicate_id) {
    if (hasStreamConfig(env)) {
      tasks.push(streamApi(env, `/${record.video_replicate_id}`, { method: 'DELETE' }))
    }
  }

  if (tasks.length > 0) {
    await Promise.allSettled(tasks)
  }
}

function serializedVideoUrl(record: DbJingle, origin: string) {
  if (record.video_status !== 'succeeded' || !record.video_key) {
    return null
  }

  return isExternalUrl(record.video_key)
    ? record.video_key
    : `${origin}/media/jingles/${record.id}/video`
}

function isExternalUrl(value: string | null) {
  return Boolean(value && /^https?:\/\//.test(value))
}

function turnstileSiteKeyForRequest(request: Request, env: Env) {
  return shouldVerifyTurnstile(request, env) ? (env.TURNSTILE_SITE_KEY ?? '') : ''
}

async function streamApi<T>(env: Env, path: string, init?: RequestInit) {
  const response = await fetch(`https://api.cloudflare.com/client/v4/accounts/${env.CLOUDFLARE_ACCOUNT_ID}/stream${path}`, {
    ...init,
    headers: {
      authorization: `Bearer ${env.CLOUDFLARE_STREAM_API_TOKEN}`,
      ...(init?.headers ?? {}),
    },
  })

  const payload = await response.json() as {
    success?: boolean
    result?: T
    errors?: Array<{ message?: string }>
  }

  if (!response.ok || payload.success === false) {
    const message = payload.errors?.[0]?.message || `Cloudflare Stream API request failed (${response.status}).`
    throw new Error(message)
  }

  return payload
}

function shouldVerifyTurnstile(request: Request, env: Env) {
  if (!env.TURNSTILE_SECRET_KEY) {
    return false
  }

  const hostname = new URL(request.url).hostname
  return hostname !== 'localhost' && hostname !== '127.0.0.1' && hostname !== '::1'
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

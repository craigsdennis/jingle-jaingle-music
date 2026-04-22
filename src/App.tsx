import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Badge, Button, Loader, Surface } from '@cloudflare/kumo'
import {
  FilmStrip,
  HandsClapping,
  ImageSquare,
  Info,
  Link,
  MusicNotes,
  ShareNetwork,
  SpeakerHigh,
  Sparkle,
  Trash,
  XLogo,
} from '@phosphor-icons/react'
import { AboutPage } from './About'
import { AdminPage } from './Admin'
import { VideoComposerModal } from './VideoComposer'
import './App.css'

type JingleStatus = 'queued' | 'processing' | 'succeeded' | 'failed'

type Jingle = {
  id: string
  status: JingleStatus
  votes: number
  imageUrl: string
  audioUrl: string | null
  videoUrl: string | null
  videoStatus: string | null
  shareUrl: string
  hasVoted: boolean
  errorMessage: string | null
  replicateUrl: string | null
  createdAt: string
  updatedAt: string
}

type JingleListResponse = { jingles: Jingle[]; nextCursor: string | null }
type JingleResponse = { jingle: Jingle; deleteToken?: string }
type ApiError = { error?: string }

const POLL_INTERVAL_MS = 6000

type Page = 'home' | 'about' | 'admin'

function readPageFromLocation(): Page {
  if (window.location.pathname === '/admin' || window.location.pathname === '/admin/') {
    return 'admin'
  }

  return window.location.hash === '#about' ? 'about' : 'home'
}

function formatRelativeTime(value: string) {
  const date = new Date(value)
  const diffSeconds = Math.round((date.getTime() - Date.now()) / 1000)
  const rtf = new Intl.RelativeTimeFormat('en', { numeric: 'auto' })
  const ranges: Array<[Intl.RelativeTimeFormatUnit, number]> = [
    ['year', 60 * 60 * 24 * 365],
    ['month', 60 * 60 * 24 * 30],
    ['week', 60 * 60 * 24 * 7],
    ['day', 60 * 60 * 24],
    ['hour', 60 * 60],
    ['minute', 60],
  ]
  for (const [unit, seconds] of ranges) {
    if (Math.abs(diffSeconds) >= seconds) return rtf.format(Math.round(diffSeconds / seconds), unit)
  }
  return rtf.format(diffSeconds, 'second')
}

function statusLabel(status: JingleStatus) {
  switch (status) {
    case 'queued': return 'Queued'
    case 'processing': return 'Composing'
    case 'succeeded': return 'Ready'
    case 'failed': return 'Failed'
  }
}

function readApiError(payload: unknown, fallback: string) {
  if (payload && typeof payload === 'object' && 'error' in payload) {
    const c = (payload as ApiError).error
    if (typeof c === 'string' && c.trim()) return c
  }
  return fallback
}

function CopyLinkRow({ url }: { url: string }) {
  const [copied, setCopied] = useState(false)

  async function copy() {
    try {
      await navigator.clipboard.writeText(url)
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    } catch { /* ignore */ }
  }

  // Show only the path portion to keep it short
  const display = url.replace(/^https?:\/\/[^/]+/, '')

  return (
    <button className="copy-link-row" onClick={() => void copy()}>
      <Link size={13} />
      <span className="copy-link-url">{display}</span>
      <span className="copy-link-badge">{copied ? 'Copied!' : 'Copy'}</span>
    </button>
  )
}

export default function App() {
  const [page, setPage] = useState<Page>(() => readPageFromLocation())

  useEffect(() => {
    const syncPage = () => setPage(readPageFromLocation())
    window.addEventListener('hashchange', syncPage)
    window.addEventListener('popstate', syncPage)
    return () => {
      window.removeEventListener('hashchange', syncPage)
      window.removeEventListener('popstate', syncPage)
    }
  }, [])

  function nav(to: Page) {
    const next = new URL(window.location.href)

    if (to === 'admin') {
      next.pathname = '/admin'
      next.hash = ''
    } else {
      next.pathname = '/'
      next.hash = to === 'about' ? '#about' : ''
    }

    window.history.pushState({}, '', next)
    setPage(to)
  }

  return (
    <div className="page-shell">
      <nav className="topnav">
        <button className="brand-btn" onClick={() => nav('home')}>
          jingle j<span className="brand-ai">AI</span>ngle
        </button>
        <div className="topnav-links">
          <button
            className={`nav-link${page === 'home' ? ' is-active' : ''}`}
            onClick={() => nav('home')}
          >
            Studio
          </button>
          <button
            className={`nav-link${page === 'about' ? ' is-active' : ''}`}
            onClick={() => nav('about')}
          >
            <Info size={15} />
            How it works
          </button>
          <a
            className="nav-link"
            href="https://github.com/craigsdennis/jingle-jaingle-music"
            target="_blank"
            rel="noreferrer"
          >
            👀 Code
          </a>
        </div>
      </nav>

      {page === 'about' ? (
        <AboutPage onBack={() => nav('home')} />
      ) : page === 'admin' ? (
        <AdminPage onBack={() => nav('home')} />
      ) : (
        <HomePage />
      )}
    </div>
  )
}

function HomePage() {
  const [jingles, setJingles] = useState<Jingle[]>([])
  const [isLoading, setIsLoading] = useState(true)
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const [selectedFile, setSelectedFile] = useState<File | null>(null)
  const [previewUrl, setPreviewUrl] = useState<string | null>(null)
  const [isDragOver, setIsDragOver] = useState(false)
  const [selectedId, setSelectedId] = useState<string | null>(() =>
    new URLSearchParams(window.location.search).get('jingle')
  )
  const [nextCursor, setNextCursor] = useState<string | null>(null)
  const [isLoadingMore, setIsLoadingMore] = useState(false)
  const [composingJingle, setComposingJingle] = useState<Jingle | null>(null)
  // Map of jingle id -> delete token, persisted in localStorage
  const [deleteTokens, setDeleteTokens] = useState<Record<string, string>>(() => {
    try {
      return JSON.parse(localStorage.getItem('jj_delete_tokens') ?? '{}') as Record<string, string>
    } catch {
      return {}
    }
  })

  // Turnstile
  const [turnstilesitekey, setTurnstilesitekey] = useState<string | null>(null)
  const turnstileContainer = useRef<HTMLDivElement>(null)
  const widgetId = useRef<string | null>(null)
  const pendingToken = useRef<string | null>(null)

  const loadJingles = useCallback(async (silent = false) => {
    if (!silent) setIsLoading(true)
    const res = await fetch('/api/jingles')
    const payload = (await res.json()) as JingleListResponse | ApiError
    if (!res.ok) throw new Error(readApiError(payload, 'Could not load the jingle board.'))
    const data = payload as JingleListResponse
    setJingles(data.jingles)
    setNextCursor(data.nextCursor)
    setSelectedId((cur) => {
      if (cur && data.jingles.some((j) => j.id === cur)) return cur
      return data.jingles[0]?.id ?? null
    })
  }, [])

  const loadMore = useCallback(async () => {
    if (!nextCursor || isLoadingMore) return
    setIsLoadingMore(true)
    try {
      const res = await fetch(`/api/jingles?cursor=${encodeURIComponent(nextCursor)}`)
      const payload = (await res.json()) as JingleListResponse | ApiError
      if (!res.ok) throw new Error(readApiError(payload, 'Could not load more jingles.'))
      const data = payload as JingleListResponse
      setJingles((cur) => {
        const existingIds = new Set(cur.map((j) => j.id))
        return [...cur, ...data.jingles.filter((j) => !existingIds.has(j.id))]
      })
      setNextCursor(data.nextCursor)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not load more jingles.')
    } finally {
      setIsLoadingMore(false)
    }
  }, [nextCursor, isLoadingMore])

  useEffect(() => {
    void loadJingles().catch((e) =>
      setError(e instanceof Error ? e.message : 'Could not load the jingle board.')
    ).finally(() => setIsLoading(false))
  }, [loadJingles])

  // Fetch the sitekey from the worker so we never hardcode it in the bundle.
  useEffect(() => {
    void fetch('/api/config')
      .then((r) => r.json())
      .then((d) => {
        const key = (d as { turnstilesitekey?: string }).turnstilesitekey
        if (key) setTurnstilesitekey(key)
      })
      .catch(() => { /* best-effort; generate will still work without Turnstile */ })
  }, [])

  // Inject the Turnstile script once we have a sitekey.
  useEffect(() => {
    if (!turnstilesitekey) return
    if (document.querySelector('script[data-turnstile]')) return
    const script = document.createElement('script')
    script.src = 'https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit'
    script.async = true
    script.defer = true
    script.dataset.turnstile = 'true'
    document.head.appendChild(script)
  }, [turnstilesitekey])

  // Mount the invisible widget once the script has loaded and the container is ready.
  useEffect(() => {
    if (!turnstilesitekey || !turnstileContainer.current) return

    const mount = () => {
      if (!window.turnstile || !turnstileContainer.current) return
      if (widgetId.current) return // already mounted
      widgetId.current = window.turnstile.render(turnstileContainer.current, {
        sitekey: turnstilesitekey,
        size: 'invisible',
        callback: (token) => { pendingToken.current = token },
        'expired-callback': () => { pendingToken.current = null },
        'error-callback': () => { pendingToken.current = null },
      })
    }

    if (window.turnstile) {
      mount()
    } else {
      const script = document.querySelector('script[data-turnstile]')
      script?.addEventListener('load', mount)
      return () => script?.removeEventListener('load', mount)
    }
  }, [turnstilesitekey])

  useEffect(() => {
    if (!selectedFile) { setPreviewUrl(null); return }
    const url = URL.createObjectURL(selectedFile)
    setPreviewUrl(url)
    return () => URL.revokeObjectURL(url)
  }, [selectedFile])

  useEffect(() => {
    const url = new URL(window.location.href)
    if (selectedId) url.searchParams.set('jingle', selectedId)
    else url.searchParams.delete('jingle')
    window.history.replaceState({}, '', url)
  }, [selectedId])

  const hasPending = jingles.some((j) => j.status === 'queued' || j.status === 'processing')

  useEffect(() => {
    if (!hasPending) return
    const t = window.setInterval(() => {
      void loadJingles(true).catch(() => {})
    }, POLL_INTERVAL_MS)
    return () => window.clearInterval(t)
  }, [hasPending, loadJingles])

  const selectedJingle = useMemo(
    () => jingles.find((j) => j.id === selectedId) ?? jingles[0] ?? null,
    [jingles, selectedId]
  )

  function handleFileChange(file: File | null) {
    setNotice(null); setError(null)
    if (!file) { setSelectedFile(null); return }
    if (!file.type.startsWith('image/')) { setError('Upload an image file.'); return }
    setSelectedFile(file)
  }

  async function handleSubmit() {
    if (!selectedFile) { setError('Pick a product image first.'); return }
    setIsSubmitting(true); setError(null); setNotice(null)

    // Get a fresh Turnstile token. If the widget hasn't fired its callback yet
    // (e.g. invisible challenge still running) we reset it and wait up to 10s.
    let turnstileToken = pendingToken.current
    if (turnstilesitekey && !turnstileToken) {
      window.turnstile?.reset(widgetId.current ?? undefined)
      turnstileToken = await new Promise<string | null>((resolve) => {
        const deadline = Date.now() + 10_000
        const check = () => {
          if (pendingToken.current) { resolve(pendingToken.current); return }
          if (Date.now() > deadline) { resolve(null); return }
          setTimeout(check, 200)
        }
        check()
      })
    }

    const form = new FormData()
    form.append('image', selectedFile)
    if (turnstileToken) form.append('cf-turnstile-response', turnstileToken)

    // Reset so the next submission gets a fresh token.
    pendingToken.current = null
    window.turnstile?.reset(widgetId.current ?? undefined)

    try {
      const res = await fetch('/api/jingles', { method: 'POST', body: form })
      const payload = (await res.json()) as JingleResponse | ApiError
      if (!res.ok) throw new Error(readApiError(payload, 'Could not start the jingle run.'))
      const { jingle: next, deleteToken } = payload as JingleResponse
      if (deleteToken) {
        setDeleteTokens((cur) => {
          const updated = { ...cur, [next.id]: deleteToken }
          localStorage.setItem('jj_delete_tokens', JSON.stringify(updated))
          return updated
        })
      }
      setJingles((cur) => [next, ...cur.filter((j) => j.id !== next.id)])
      setSelectedId(next.id)
      setSelectedFile(null)
      setNotice('Queued! The track will land shortly.')
      await loadJingles(true)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not start the jingle run.')
    } finally {
      setIsSubmitting(false)
    }
  }

  async function handleVote(id: string) {
    setError(null); setNotice(null)
    try {
      const res = await fetch(`/api/jingles/${id}/vote`, { method: 'POST' })
      const payload = (await res.json()) as JingleResponse | ApiError
      if (res.status === 409) {
        setNotice(readApiError(payload, 'Already voted.'))
        await loadJingles(true)
        return
      }
      if (!res.ok) throw new Error(readApiError(payload, 'Could not submit your vote.'))
      const next = (payload as JingleResponse).jingle
      setJingles((cur) =>
        cur
          .map((j) => (j.id === next.id ? next : j))
          .sort((a, b) => b.votes - a.votes || b.createdAt.localeCompare(a.createdAt))
      )
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not submit your vote.')
    }
  }

  async function handleShare(jingle: Jingle) {
    setError(null); setNotice(null)
    try {
      if (navigator.share) {
        await navigator.share({
          title: 'jingle jAIngle',
          text: 'A product jingle made with Google\'s Lyria 3 on Replicate, hosted on Cloudflare.',
          url: jingle.shareUrl,
        })
        return
      }
      await navigator.clipboard.writeText(jingle.shareUrl)
      setNotice('Link copied.')
    } catch {
      setNotice('Link is available below.')
    }
  }

  async function handleDelete(jingle: Jingle) {
    const token = deleteTokens[jingle.id]
    if (!token) return
    if (!window.confirm('Delete this jingle? This cannot be undone.')) return

    setError(null); setNotice(null)
    try {
      const res = await fetch(`/api/jingles/${jingle.id}`, {
        method: 'DELETE',
        headers: { authorization: `Bearer ${token}` },
      })
      if (!res.ok) {
        const payload = (await res.json()) as ApiError
        throw new Error(readApiError(payload, 'Could not delete the jingle.'))
      }
      // Remove token from localStorage
      setDeleteTokens((cur) => {
        const updated = { ...cur }
        delete updated[jingle.id]
        localStorage.setItem('jj_delete_tokens', JSON.stringify(updated))
        return updated
      })
      setJingles((cur) => cur.filter((j) => j.id !== jingle.id))
      setSelectedId((cur) => (cur === jingle.id ? null : cur))
      setNotice('Jingle deleted.')
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not delete the jingle.')
    }
  }

  function handleShareX(jingle: Jingle) {
    const text = encodeURIComponent('Check out this product jingle made with Google\'s Lyria 3 on Replicate, hosted on Cloudflare. #jingleJAIngle')
    // If a share video exists, link directly to the video file so X shows it inline
    const url = encodeURIComponent(jingle.videoUrl ?? jingle.shareUrl)
    window.open(`https://x.com/intent/tweet?text=${text}&url=${url}`, '_blank', 'noopener,noreferrer')
  }

  return (
    <>
      {(error || notice) && (
        <div className="message-strip" role={error ? 'alert' : 'status'}>
          {error ?? notice}
        </div>
      )}

      <main className="content-grid">
        {/* ── Left column: upload ── */}
        <section className="studio-column">
          <div className="studio-sticky">
            <Surface className="panel">
              {/* Hidden Turnstile widget container */}
              <div ref={turnstileContainer} className="sr-only" aria-hidden="true" />

              <p className="studio-kicker">New jingle</p>

              <label
                className={`upload-well${isDragOver ? ' is-dragover' : ''}`}
                htmlFor="product-upload"
                onDragOver={(e) => { e.preventDefault(); setIsDragOver(true) }}
                onDragLeave={(e) => { e.preventDefault(); setIsDragOver(false) }}
                onDrop={(e) => {
                  e.preventDefault(); setIsDragOver(false)
                  const file = e.dataTransfer.files[0]
                  if (file) handleFileChange(file)
                }}
              >
                {previewUrl ? (
                  <img className="upload-preview" src={previewUrl} alt="Product preview" />
                ) : (
                  <div className="upload-placeholder">
                    <ImageSquare size={40} weight="duotone" />
                    <strong>Drop a product photo here</strong>
                    <span>or click to browse — photo only, no text prompt</span>
                  </div>
                )}
              </label>

              <input
                id="product-upload"
                className="sr-only"
                type="file"
                accept="image/*"
                onChange={(e) => handleFileChange(e.target.files?.[0] ?? null)}
              />

              <div className="upload-footer">
                {selectedFile && (
                  <span className="file-name">{selectedFile.name}</span>
                )}
                <Button
                  variant="primary"
                  size="lg"
                  icon={MusicNotes}
                  loading={isSubmitting}
                  disabled={!selectedFile}
                  onClick={() => void handleSubmit()}
                >
                  Generate jingle
                </Button>
              </div>
            </Surface>

            <div className="studio-hint">
              <div className="hint-row">
                <span className="hint-num">01</span>
                <span>Upload a product photo</span>
              </div>
              <div className="hint-row">
                <span className="hint-num">02</span>
                <span>Lyria 3 writes a 30-second commercial jingle from the image</span>
              </div>
              <div className="hint-row">
                <span className="hint-num">03</span>
                <span>Vote, share, and climb the leaderboard</span>
              </div>
            </div>
          </div>
        </section>

        {/* ── Right column: leaderboard ── */}
        <section className="board-column">
          <div className="board-header">
            <h2>Leaderboard</h2>
            <Button variant="ghost" size="sm" icon={Sparkle} onClick={() => void loadJingles(true).catch(() => {})}>
              Refresh
            </Button>
          </div>

          {isLoading && jingles.length === 0 && (
            <div className="empty-state"><Loader size="lg" /></div>
          )}

          <div className="board-grid">
            {jingles.map((jingle, index) => {
              const isSelected = selectedJingle?.id === jingle.id
              return (
                <article key={jingle.id} className={`jingle-card${isSelected ? ' is-selected' : ''}`}>
                  <button
                    className="card-select"
                    type="button"
                    onClick={() => setSelectedId(isSelected ? null : jingle.id)}
                  >
                    <img src={jingle.imageUrl} alt="Product thumbnail" />
                    <div className="card-overlay">
                      <span className="card-rank">#{index + 1}</span>
                      <Badge>{statusLabel(jingle.status)}</Badge>
                    </div>
                  </button>

                  {/* Inline expanded player — only shown on the selected card */}
                  {isSelected && (
                    <div className="card-expanded">
                      <div className="card-expanded-inner">
                        <img className="card-expanded-img" src={jingle.imageUrl} alt="Product" />

                        <div className="card-expanded-right">
                          {jingle.status === 'succeeded' && jingle.audioUrl ? (
                            <audio className="audio-player" controls autoPlay preload="auto" src={jingle.audioUrl} />
                          ) : jingle.status === 'failed' ? (
                            <div className="status-panel status-failed">
                              <SpeakerHigh size={20} />
                              <p>{jingle.errorMessage ?? 'This take failed. Try a different photo.'}</p>
                            </div>
                          ) : (
                            <div className="status-panel">
                              <Loader size="sm" />
                              <p>Composing&hellip;</p>
                            </div>
                          )}

                          <div className="card-expanded-actions">
                            <Button
                              variant={jingle.hasVoted ? 'outline' : 'secondary'}
                              size="sm"
                              icon={HandsClapping}
                              disabled={jingle.status !== 'succeeded'}
                              onClick={() => void handleVote(jingle.id)}
                            >
                              {jingle.votes} {jingle.hasVoted ? '· voted' : ''}
                            </Button>
                            <div className="card-expanded-secondary">
                              {jingle.status === 'succeeded' && (
                                <Button
                                  variant="ghost"
                                  size="sm"
                                  icon={FilmStrip}
                                  onClick={() => setComposingJingle(jingle)}
                                >
                                  Create video
                                </Button>
                              )}
                              <Button variant="ghost" size="sm" icon={ShareNetwork} onClick={() => void handleShare(jingle)}>
                                Share
                              </Button>
                              {jingle.status === 'succeeded' && (
                                <Button variant="ghost" size="sm" icon={XLogo} onClick={() => handleShareX(jingle)}>
                                  Post
                                </Button>
                              )}
                              {deleteTokens[jingle.id] && (
                                <Button
                                  variant="ghost"
                                  size="sm"
                                  icon={Trash}
                                  className="delete-btn"
                                  onClick={() => void handleDelete(jingle)}
                                >
                                  Delete
                                </Button>
                              )}
                            </div>
                          </div>

                          <CopyLinkRow url={jingle.shareUrl} />
                        </div>
                      </div>
                    </div>
                  )}

                  {/* Collapsed footer — only shown when not selected */}
                  {!isSelected && (
                    <div className="card-footer">
                      <span className="card-time">{formatRelativeTime(jingle.createdAt)}</span>
                      <div className="card-actions">
                        <Button
                          variant={jingle.hasVoted ? 'outline' : 'ghost'}
                          size="sm"
                          shape="square"
                          icon={HandsClapping}
                          aria-label={`Vote for cut ${index + 1}`}
                          disabled={jingle.status !== 'succeeded'}
                          onClick={() => void handleVote(jingle.id)}
                        />
                        <span className="vote-count">{jingle.votes}</span>
                        <Button
                          variant="ghost"
                          size="sm"
                          shape="square"
                          icon={ShareNetwork}
                          aria-label={`Share cut ${index + 1}`}
                          onClick={() => void handleShare(jingle)}
                        />
                        {deleteTokens[jingle.id] && (
                          <Button
                            variant="ghost"
                            size="sm"
                            shape="square"
                            icon={Trash}
                            aria-label={`Delete cut ${index + 1}`}
                            className="delete-btn"
                            onClick={() => void handleDelete(jingle)}
                          />
                        )}
                      </div>
                    </div>
                  )}
                </article>
              )
            })}

            {!isLoading && jingles.length === 0 && (
              <div className="empty-board">
                <MusicNotes size={32} />
                <p>No jingles yet.</p>
              </div>
            )}
          </div>

          {nextCursor && (
            <Button
              variant="secondary"
              size="sm"
              loading={isLoadingMore}
              onClick={() => void loadMore()}
              className="load-more-btn"
            >
              Load more
            </Button>
          )}
        </section>
      </main>

      {composingJingle && (
        <VideoComposerModal
          jingle={composingJingle}
          onClose={() => setComposingJingle(null)}
          onUploaded={(videoUrl, videoStatus) => {
            setJingles((cur) =>
              cur.map((j) =>
                j.id === composingJingle.id
                  ? { ...j, videoUrl, videoStatus }
                  : j
              )
            )
          }}
        />
      )}
    </>
  )
}

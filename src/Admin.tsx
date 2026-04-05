import { useState, useEffect, useCallback } from 'react'
import { Button, Loader, Surface, Badge } from '@cloudflare/kumo'
import { ArrowLeft, FilmStrip, MusicNotes, Sparkle, Trophy } from '@phosphor-icons/react'

type Props = { onBack: () => void }

type AdminStatus = {
  topJingle: {
    id: string
    votes: number
    imageUrl: string
    audioUrl: string | null
    videoUrl: string | null
    videoStatus: string | null
    createdAt: string
  } | null
}

type ApiError = { error?: string }

function readError(payload: unknown, fallback: string) {
  if (payload && typeof payload === 'object' && 'error' in payload) {
    const c = (payload as ApiError).error
    if (typeof c === 'string' && c.trim()) return c
  }
  return fallback
}

export function AdminPage({ onBack }: Props) {
  const [adminToken, setAdminToken] = useState(() =>
    localStorage.getItem('jj_admin_token') ?? ''
  )
  const [tokenInput, setTokenInput] = useState('')
  const [status, setStatus] = useState<AdminStatus | null>(null)
  const [isLoading, setIsLoading] = useState(false)
  const [isGenerating, setIsGenerating] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)

  const fetchStatus = useCallback(async (token: string) => {
    setIsLoading(true)
    setError(null)
    try {
      const res = await fetch('/api/admin/status', {
        headers: { authorization: `Bearer ${token}` },
      })
      const payload = await res.json() as AdminStatus | ApiError
      if (!res.ok) {
        throw new Error(readError(payload, 'Could not fetch admin status.'))
      }
      setStatus(payload as AdminStatus)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not fetch admin status.')
    } finally {
      setIsLoading(false)
    }
  }, [])

  useEffect(() => {
    if (adminToken) void fetchStatus(adminToken)
  }, [adminToken, fetchStatus])

  // Poll while video is processing
  useEffect(() => {
    const vs = status?.topJingle?.videoStatus
    if (vs !== 'queued' && vs !== 'processing') return
    const t = window.setInterval(() => void fetchStatus(adminToken), 6000)
    return () => window.clearInterval(t)
  }, [status?.topJingle?.videoStatus, adminToken, fetchStatus])

  function handleTokenSubmit() {
    const t = tokenInput.trim()
    if (!t) return
    localStorage.setItem('jj_admin_token', t)
    setAdminToken(t)
    setTokenInput('')
  }

  async function handleGenerateVideo(jingleId?: string) {
    setIsGenerating(true)
    setError(null)
    setNotice(null)
    try {
      const res = await fetch('/api/admin/video', {
        method: 'POST',
        headers: {
          authorization: `Bearer ${adminToken}`,
          'content-type': 'application/json',
        },
        body: JSON.stringify(jingleId ? { jingleId } : {}),
      })
      const payload = await res.json() as { ok?: boolean; jingleId?: string; predictionId?: string } | ApiError
      if (!res.ok) {
        throw new Error(readError(payload, 'Could not start video generation.'))
      }
      setNotice(`Video queued for jingle ${(payload as { jingleId?: string }).jingleId ?? ''}. Polling for results...`)
      await fetchStatus(adminToken)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not start video generation.')
    } finally {
      setIsGenerating(false)
    }
  }

  const jingle = status?.topJingle
  const videoStatus = jingle?.videoStatus

  function videoStatusLabel(s: string | null | undefined) {
    switch (s) {
      case 'queued': return 'Queued'
      case 'processing': return 'Rendering'
      case 'succeeded': return 'Ready'
      case 'failed': return 'Failed'
      default: return 'No video'
    }
  }

  return (
    <div className="about-page">
      <div className="about-header">
        <Button variant="ghost" size="sm" icon={ArrowLeft} onClick={onBack}>
          Back to studio
        </Button>
        <h1 className="about-title">Admin</h1>
        <p className="about-lead">Generate a commercial video for the top-rated jingle using Wan 2.7 image-to-video.</p>
      </div>

      {/* Token gate */}
      {!adminToken && (
        <Surface className="panel">
          <p className="small-label" style={{ marginBottom: '0.75rem' }}>Admin token</p>
          <div style={{ display: 'flex', gap: '0.75rem' }}>
            <input
              className="token-input"
              type="password"
              placeholder="Enter your ADMIN_TOKEN"
              value={tokenInput}
              onChange={(e) => setTokenInput(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && handleTokenSubmit()}
            />
            <Button variant="primary" onClick={handleTokenSubmit}>
              Unlock
            </Button>
          </div>
        </Surface>
      )}

      {adminToken && (
        <>
          {(error || notice) && (
            <div className="message-strip" role={error ? 'alert' : 'status'}>
              {error ?? notice}
            </div>
          )}

          <Surface className="panel">
            <div className="panel-heading-row">
              <div style={{ display: 'flex', alignItems: 'center', gap: '0.6rem' }}>
                <Trophy size={20} weight="fill" />
                <h2 className="admin-section-title">Top jingle</h2>
              </div>
              <Button
                variant="ghost"
                size="sm"
                icon={Sparkle}
                onClick={() => void fetchStatus(adminToken)}
              >
                Refresh
              </Button>
            </div>

            {isLoading && !jingle ? (
              <div className="empty-state"><Loader size="lg" /></div>
            ) : jingle ? (
              <div className="admin-jingle">
                <img className="admin-img" src={jingle.imageUrl} alt="Top jingle product" />

                <div className="admin-meta">
                  <div className="admin-meta-row">
                    <span>ID</span>
                    <code>{jingle.id.slice(0, 8)}…</code>
                  </div>
                  <div className="admin-meta-row">
                    <span>Votes</span>
                    <strong>{jingle.votes}</strong>
                  </div>
                  <div className="admin-meta-row">
                    <span>Audio</span>
                    <Badge>{jingle.audioUrl ? 'Ready' : 'Missing'}</Badge>
                  </div>
                  <div className="admin-meta-row">
                    <span>Video</span>
                    <Badge>{videoStatusLabel(videoStatus)}</Badge>
                  </div>
                </div>

                {jingle.audioUrl && (
                  <div className="admin-audio">
                    <p className="small-label">Jingle audio</p>
                    <audio className="audio-player" controls preload="none" src={jingle.audioUrl} />
                  </div>
                )}

                {videoStatus === 'succeeded' && jingle.videoUrl ? (
                  <div className="admin-video">
                    <p className="small-label">Generated commercial video</p>
                    <video
                      className="admin-video-player"
                      controls
                      preload="none"
                      src={jingle.videoUrl}
                    />
                  </div>
                ) : (videoStatus === 'queued' || videoStatus === 'processing') ? (
                  <div className="status-panel">
                    <Loader size="sm" />
                    <p>Wan 2.7 is rendering the video — checking every 6 seconds&hellip;</p>
                  </div>
                ) : null}

                <div className="admin-actions">
                  <Button
                    variant="primary"
                    icon={FilmStrip}
                    loading={isGenerating}
                    disabled={!jingle.audioUrl}
                    onClick={() => void handleGenerateVideo(jingle.id)}
                  >
                    {videoStatus === 'succeeded' ? 'Regenerate video' : 'Generate commercial video'}
                  </Button>
                </div>

                {!jingle.audioUrl && (
                  <p className="small-copy" style={{ color: 'var(--ink-soft)', marginTop: '0.5rem' }}>
                    This jingle has no audio yet — wait for Lyria to finish before generating video.
                  </p>
                )}
              </div>
            ) : (
              <div className="empty-state">
                <MusicNotes size={32} />
                <p>No succeeded jingles yet. Generate some first.</p>
              </div>
            )}
          </Surface>

          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'flex-end' }}>
            <Button
              variant="ghost"
              size="sm"
              onClick={() => {
                localStorage.removeItem('jj_admin_token')
                setAdminToken('')
                setStatus(null)
              }}
            >
              Clear token
            </Button>
          </div>
        </>
      )}
    </div>
  )
}

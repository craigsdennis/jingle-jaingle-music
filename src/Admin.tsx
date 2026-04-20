import { useCallback, useEffect, useState } from 'react'
import { Badge, Button, Loader, Surface } from '@cloudflare/kumo'
import { ArrowLeft, MusicNotes, Sparkle, Trash } from '@phosphor-icons/react'

type Props = { onBack: () => void }

type JingleStatus = 'queued' | 'processing' | 'succeeded' | 'failed'

type AdminJingle = {
  id: string
  status: JingleStatus
  votes: number
  imageUrl: string
  audioUrl: string | null
  videoUrl: string | null
  videoStatus: string | null
  errorMessage: string | null
  createdAt: string
  updatedAt: string
}

type AdminResponse = {
  jingles: AdminJingle[]
}

type ApiError = { error?: string }

function readError(payload: unknown, fallback: string) {
  if (payload && typeof payload === 'object' && 'error' in payload) {
    const candidate = (payload as ApiError).error
    if (typeof candidate === 'string' && candidate.trim()) return candidate
  }
  return fallback
}

function statusLabel(status: JingleStatus) {
  switch (status) {
    case 'queued': return 'Queued'
    case 'processing': return 'Processing'
    case 'succeeded': return 'Ready'
    case 'failed': return 'Failed'
  }
}

function formatDate(value: string) {
  return new Intl.DateTimeFormat('en', {
    dateStyle: 'medium',
    timeStyle: 'short',
  }).format(new Date(value))
}

export function AdminPage({ onBack }: Props) {
  const [jingles, setJingles] = useState<AdminJingle[]>([])
  const [isLoading, setIsLoading] = useState(false)
  const [deletingId, setDeletingId] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)

  const loadJingles = useCallback(async () => {
    setIsLoading(true)
    setError(null)
    try {
      const res = await fetch('/api/admin/jingles')
      const payload = await res.json() as AdminResponse | ApiError
      if (!res.ok) {
        throw new Error(readError(payload, 'Could not load admin jingles.'))
      }
      setJingles((payload as AdminResponse).jingles)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not load admin jingles.')
    } finally {
      setIsLoading(false)
    }
  }, [])

  useEffect(() => {
    void loadJingles()
  }, [loadJingles])

  async function handleDelete(jingle: AdminJingle) {
    const confirmed = window.confirm(`Delete jingle ${jingle.id.slice(0, 8)}? This cannot be undone.`)
    if (!confirmed) return

    setDeletingId(jingle.id)
    setError(null)
    setNotice(null)

    try {
      const res = await fetch(`/api/admin/jingles/${jingle.id}`, { method: 'DELETE' })
      const payload = await res.json() as { ok?: boolean } | ApiError
      if (!res.ok) {
        throw new Error(readError(payload, 'Could not delete jingle.'))
      }

      setJingles((current) => current.filter((item) => item.id !== jingle.id))
      setNotice(`Deleted jingle ${jingle.id.slice(0, 8)}.`)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not delete jingle.')
    } finally {
      setDeletingId(null)
    }
  }

  return (
    <div className="about-page">
      <div className="about-header">
        <Button variant="ghost" size="sm" icon={ArrowLeft} onClick={onBack}>
          Back to studio
        </Button>
        <h1 className="about-title">Admin</h1>
        <p className="about-lead">
          Review uploaded jingles and delete them. Protect <code>/admin</code> and <code>/api/admin/*</code> with Cloudflare Access.
        </p>
      </div>

      {(error || notice) && (
        <div className="message-strip" role={error ? 'alert' : 'status'}>
          {error ?? notice}
        </div>
      )}

      <Surface className="panel">
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '0.75rem', marginBottom: '1rem' }}>
          <h2 style={{ margin: 0, fontSize: '1rem' }}>Jingles</h2>
          <Button variant="ghost" size="sm" icon={Sparkle} onClick={() => void loadJingles()}>
            Refresh
          </Button>
        </div>

        {isLoading ? (
          <div className="empty-state">
            <Loader size="lg" />
          </div>
        ) : jingles.length === 0 ? (
          <div className="empty-state">
            <MusicNotes size={32} />
            <p>No jingles found.</p>
          </div>
        ) : (
          <div style={{ display: 'grid', gap: '1rem' }}>
            {jingles.map((jingle) => (
              <article
                key={jingle.id}
                style={{
                  display: 'grid',
                  gap: '1rem',
                  padding: '1rem',
                  border: '1px solid var(--line)',
                  borderRadius: '1rem',
                  background: 'rgba(255, 255, 255, 0.6)',
                }}
              >
                <div style={{ display: 'grid', gridTemplateColumns: '140px minmax(0, 1fr)', gap: '1rem', alignItems: 'start' }}>
                  <img
                    src={jingle.imageUrl}
                    alt="Uploaded product"
                    style={{
                      width: '100%',
                      aspectRatio: '1',
                      objectFit: 'contain',
                      objectPosition: 'center',
                      borderRadius: '0.85rem',
                      border: '1px solid var(--line)',
                      background: 'rgba(255, 255, 255, 0.8)',
                    }}
                  />

                  <div style={{ display: 'grid', gap: '0.7rem' }}>
                    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '0.75rem', flexWrap: 'wrap' }}>
                      <code>{jingle.id}</code>
                      <Badge>{statusLabel(jingle.status)}</Badge>
                    </div>

                    <div style={{ display: 'flex', gap: '1rem', flexWrap: 'wrap', fontSize: '0.88rem', color: 'var(--ink-soft)' }}>
                      <span>{jingle.votes} vote{jingle.votes === 1 ? '' : 's'}</span>
                      <span>Created {formatDate(jingle.createdAt)}</span>
                      <span>Updated {formatDate(jingle.updatedAt)}</span>
                    </div>

                    {jingle.audioUrl && (
                      <audio className="audio-player" controls preload="none" src={jingle.audioUrl} />
                    )}

                    {jingle.errorMessage && (
                      <div className="status-panel status-failed">
                        <p>{jingle.errorMessage}</p>
                      </div>
                    )}
                  </div>
                </div>

                <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
                  <Button
                    variant="ghost"
                    size="sm"
                    icon={Trash}
                    className="delete-btn"
                    loading={deletingId === jingle.id}
                    onClick={() => void handleDelete(jingle)}
                  >
                    Delete
                  </Button>
                </div>
              </article>
            ))}
          </div>
        )}
      </Surface>
    </div>
  )
}

import { useEffect, useRef, useState } from 'react'
import { Button, Loader } from '@cloudflare/kumo'
import { ArrowClockwise, DownloadSimple, FilmStrip, X, CloudArrowUp } from '@phosphor-icons/react'
import { useVideoComposer } from './useVideoComposer'

type Jingle = {
  id: string
  imageUrl: string
  audioUrl: string | null
  shareUrl: string
}

type Props = {
  jingle: Jingle
  onClose: () => void
  onUploaded: (videoUrl: string) => void
}

export function VideoComposerModal({ jingle, onClose, onUploaded }: Props) {
  const { state, compose, reset } = useVideoComposer()
  const videoRef = useRef<HTMLVideoElement>(null)
  const [isUploading, setIsUploading] = useState(false)
  const [uploadError, setUploadError] = useState<string | null>(null)
  const [uploadedUrl, setUploadedUrl] = useState<string | null>(null)
  const hasStarted = useRef(false)

  // Auto-start composition on mount
  useEffect(() => {
    if (hasStarted.current || !jingle.audioUrl) return
    hasStarted.current = true
    void compose(jingle.imageUrl, jingle.audioUrl)
  }, [jingle, compose])

  // Set video src when done
  useEffect(() => {
    if (state.phase === 'done' && videoRef.current) {
      videoRef.current.src = state.url
    }
  }, [state])

  // Cleanup blob URL on unmount
  useEffect(() => {
    return () => reset()
  }, [reset])

  function handleDownload() {
    if (state.phase !== 'done') return
    const a = document.createElement('a')
    a.href = uploadedUrl ?? state.url
    a.download = `jingle-${jingle.id.slice(0, 8)}.${uploadedUrl ? 'mp4' : 'webm'}`
    a.click()
  }

  async function handleUpload() {
    if (state.phase !== 'done') return
    setIsUploading(true)
    setUploadError(null)

    try {
      const res = await fetch(`/api/jingles/${jingle.id}/video`, {
        method: 'POST',
        headers: { 'content-type': state.blob.type },
        body: state.blob,
      })

      if (!res.ok) {
        const payload = await res.json() as { error?: string }
        throw new Error(payload.error ?? 'Upload failed.')
      }

      const { videoUrl } = await res.json() as { videoUrl: string }
      setUploadedUrl(videoUrl)
      onUploaded(videoUrl)
    } catch (err) {
      setUploadError(err instanceof Error ? err.message : 'Upload failed.')
    } finally {
      setIsUploading(false)
    }
  }

  function handleRetry() {
    reset()
    hasStarted.current = false
    setUploadError(null)
    setUploadedUrl(null)
    if (jingle.audioUrl) {
      void compose(jingle.imageUrl, jingle.audioUrl)
      hasStarted.current = true
    }
  }

  return (
    <div className="vc-backdrop" onClick={(e) => { if (e.target === e.currentTarget) onClose() }}>
      <div className="vc-modal" role="dialog" aria-label="Share video composer">
        <div className="vc-header">
          <div className="vc-title">
            <FilmStrip size={18} weight="fill" />
            <span>Share video</span>
          </div>
          <button className="vc-close" onClick={onClose} aria-label="Close">
            <X size={18} />
          </button>
        </div>

        <div className="vc-body">
          {/* Progress / loading state */}
          {(state.phase === 'loading' || state.phase === 'recording') && (
            <div className="vc-progress-wrap">
              <div className="vc-preview-placeholder">
                <Loader size="lg" />
                <p>
                  {state.phase === 'loading'
                    ? 'Loading audio and image…'
                    : `Composing video… ${Math.round(state.progress * 100)}%`}
                </p>
                {state.phase === 'recording' && (
                  <div className="vc-progress-bar">
                    <div className="vc-progress-fill" style={{ width: `${state.progress * 100}%` }} />
                  </div>
                )}
              </div>
              <p className="vc-hint">
                The video is being composed in your browser — audio will play briefly while recording.
              </p>
            </div>
          )}

          {/* Error state */}
          {state.phase === 'error' && (
            <div className="vc-error">
              <p>{state.message}</p>
              <Button variant="secondary" size="sm" icon={ArrowClockwise} onClick={handleRetry}>
                Try again
              </Button>
            </div>
          )}

          {/* Done state */}
          {state.phase === 'done' && (
            <>
              <video
                ref={videoRef}
                className="vc-preview"
                controls
                playsInline
                preload="auto"
              />

              <div className="vc-actions">
                <Button
                  variant="primary"
                  icon={DownloadSimple}
                  onClick={handleDownload}
                >
                  {uploadedUrl ? 'Download MP4' : 'Download source'}
                </Button>

                {!uploadedUrl ? (
                  <Button
                    variant="secondary"
                    icon={CloudArrowUp}
                    loading={isUploading}
                    onClick={() => void handleUpload()}
                  >
                    Save MP4 to jingle jAIngle
                  </Button>
                ) : (
                  <Button
                    variant="ghost"
                    icon={FilmStrip}
                    onClick={() => window.open(uploadedUrl, '_blank')}
                  >
                    Open saved MP4
                  </Button>
                )}

                <Button variant="ghost" size="sm" icon={ArrowClockwise} onClick={handleRetry}>
                  Recompose
                </Button>
              </div>

              {uploadError && (
                <p className="vc-upload-error">{uploadError}</p>
              )}

              {uploadedUrl && (
                <p className="vc-upload-success">
                  Saved as MP4. Share or download this link:{' '}
                  <a href={uploadedUrl} target="_blank" rel="noreferrer">{uploadedUrl}</a>
                </p>
              )}

              <p className="vc-hint">
                {uploadedUrl
                  ? 'Square 1080×1080 MP4 saved through Cloudflare Stream.'
                  : `Square 1080×1080 WebM source · ${Math.round(state.blob.size / 1024)}KB · Upload to convert it to an Instagram-friendly MP4`}
              </p>
            </>
          )}
        </div>
      </div>
    </div>
  )
}

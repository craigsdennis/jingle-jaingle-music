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
  onUploaded: (videoUrl: string | null, videoStatus: string | null) => void
}

type VideoUploadResponse = {
  error?: string
  videoUrl?: string | null
  videoStatus?: string | null
}

type VideoPollResponse = {
  error?: string
  jingle?: {
    videoUrl: string | null
    videoStatus: string | null
    errorMessage: string | null
    videoError?: string | null
  }
}

async function readApiPayload(response: Response) {
  const contentType = response.headers.get('content-type') ?? ''

  if (contentType.includes('application/json')) {
    return response.json() as Promise<{ error?: string; videoUrl?: string }>
  }

  const text = await response.text()
  throw new Error(text.slice(0, 200) || `Upload failed with status ${response.status}.`)
}

export function VideoComposerModal({ jingle, onClose, onUploaded }: Props) {
  const { state, compose, reset } = useVideoComposer()
  const videoRef = useRef<HTMLVideoElement>(null)
  const [isUploading, setIsUploading] = useState(false)
  const [isProcessingRemote, setIsProcessingRemote] = useState(false)
  const [uploadError, setUploadError] = useState<string | null>(null)
  const [uploadNotice, setUploadNotice] = useState<string | null>(null)
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
    setUploadNotice(null)

    try {
      const uploadRes = await fetch(`/api/jingles/${jingle.id}/video`, {
        method: 'POST',
        headers: { 'content-type': state.blob.type },
        body: state.blob,
      })
      const uploadPayload = await readApiPayload(uploadRes) as VideoUploadResponse

      if (!uploadRes.ok) {
        throw new Error(uploadPayload.error ?? 'Could not upload the video to Cloudflare Stream.')
      }

      onUploaded(uploadPayload.videoUrl ?? null, uploadPayload.videoStatus ?? 'processing')
      setIsProcessingRemote(true)
      setUploadNotice('Uploaded to jingle jAIngle. Cloudflare Stream is generating the MP4 now…')

      const deadline = Date.now() + 180_000
      while (Date.now() < deadline) {
        await new Promise((resolve) => setTimeout(resolve, 4000))

        const pollRes = await fetch(`/api/jingles/${jingle.id}`)
        const pollPayload = await readApiPayload(pollRes) as VideoPollResponse
        if (!pollRes.ok) {
          throw new Error(pollPayload.error ?? 'Could not refresh the saved video.')
        }

        const next = pollPayload.jingle
        if (!next) {
          throw new Error('Could not refresh the saved video.')
        }

        onUploaded(next.videoUrl, next.videoStatus)

        if (next.videoStatus === 'failed') {
          throw new Error(next.videoError ?? next.errorMessage ?? 'Cloudflare Stream could not finish the MP4.')
        }

        if (next.videoStatus === 'succeeded' && next.videoUrl) {
          setUploadedUrl(next.videoUrl)
          setUploadNotice('Saved as MP4. Share or download this link:')
          setIsProcessingRemote(false)
          return
        }
      }

      setUploadNotice('Uploaded to jingle jAIngle. The MP4 is still processing. Refresh in a minute.')
    } catch (err) {
      setUploadError(err instanceof Error ? err.message : 'Upload failed.')
    } finally {
      setIsUploading(false)
      setIsProcessingRemote(false)
    }
  }

  function handleRetry() {
    reset()
    hasStarted.current = false
    setUploadError(null)
    setUploadNotice(null)
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
                    loading={isUploading || isProcessingRemote}
                    disabled={isProcessingRemote}
                    onClick={() => void handleUpload()}
                  >
                    {isProcessingRemote ? 'Processing in Stream…' : 'Save MP4 to jingle jAIngle'}
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

              {uploadNotice && (
                <p className="vc-upload-success">
                  {uploadNotice}{uploadedUrl ? ' ' : ''}
                  {uploadedUrl && (
                    <a href={uploadedUrl} target="_blank" rel="noreferrer">{uploadedUrl}</a>
                  )}
                </p>
              )}

              <p className="vc-hint">
                {uploadedUrl
                  ? 'Square 1080×1080 MP4 saved through Cloudflare Stream.'
                  : `Square 1080×1080 WebM source · ${Math.round(state.blob.size / 1024)}KB · Upload it to Cloudflare Stream to generate an Instagram-friendly MP4`}
              </p>
            </>
          )}
        </div>
      </div>
    </div>
  )
}

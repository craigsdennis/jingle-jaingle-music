import { useCallback, useRef, useState } from 'react'
import QRCode from 'qrcode'

export type VideoComposerState =
  | { phase: 'idle' }
  | { phase: 'loading' }
  | { phase: 'recording'; progress: number } // 0–1
  | { phase: 'done'; blob: Blob; url: string }
  | { phase: 'error'; message: string }

const CANVAS_SIZE = 1080          // square — best for IG Reels / X
const END_CARD_DURATION_MS = 2500 // branded end card at the close
const FRAME_RATE = 30
const QR_URL = 'https://shrty.dev/jingle-vid'

// Brand palette
const CITRUS = '#d8ff2e'
const INK = '#0e0d14'
const INK_SOFT = 'rgba(14,13,20,0.55)'
// Cloudflare orange — exact value from workers.cloudflare.com
const CF_ORANGE = 'rgb(255, 72, 1)'
const CF_ORANGE_DIM = 'rgba(255, 72, 1, 0.15)'
// Workers light-mode background — exact value from workers.cloudflare.com
const WORKERS_BG = 'rgb(255, 253, 251)'

function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image()
    img.crossOrigin = 'anonymous'
    img.onload = () => resolve(img)
    img.onerror = reject
    img.src = src
  })
}

function drawBrandBadge(ctx: CanvasRenderingContext2D, x: number, y: number) {
  ctx.save()

  // Pill background
  const text = 'jingle jAIngle'
  ctx.font = 'bold 22px "Bungee", sans-serif'
  const measured = ctx.measureText(text)
  const pw = measured.width + 28
  const ph = 36
  const pr = 10

  ctx.fillStyle = 'rgba(14,13,20,0.82)'
  ctx.beginPath()
  ctx.roundRect(x, y, pw, ph, pr)
  ctx.fill()

  // Text — "jingle j" in white, "AI" in citrus, "ngle" in white
  ctx.textBaseline = 'middle'
  const cy = y + ph / 2 + 1

  const parts = [
    { text: 'jingle j', color: '#ffffff' },
    { text: 'AI', color: CITRUS },
    { text: 'ngle', color: '#ffffff' },
  ]

  let cx = x + 14
  for (const part of parts) {
    ctx.fillStyle = part.color
    ctx.fillText(part.text, cx, cy)
    cx += ctx.measureText(part.text).width
  }

  ctx.restore()
}

function drawWaveform(
  ctx: CanvasRenderingContext2D,
  analyser: AnalyserNode,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  dataArray: any,
  canvasW: number,
  canvasH: number,
) {
  analyser.getByteFrequencyData(dataArray as Uint8Array<ArrayBuffer>)

  const barCount = 64
  const barGap = 3
  const totalWidth = canvasW * 0.7
  const barW = (totalWidth - barGap * (barCount - 1)) / barCount
  const maxBarH = 72
  const startX = (canvasW - totalWidth) / 2
  const baseY = canvasH - 56

  for (let i = 0; i < barCount; i++) {
    const value = dataArray[Math.floor((i / barCount) * dataArray.length)]
    const barH = Math.max(4, (value / 255) * maxBarH)
    const x = startX + i * (barW + barGap)
    const y = baseY - barH

    // Gradient bar: Cloudflare orange at top fading to a dim glow at base
    const grad = ctx.createLinearGradient(x, y, x, baseY)
    grad.addColorStop(0, CF_ORANGE)
    grad.addColorStop(1, CF_ORANGE_DIM)

    ctx.fillStyle = grad
    ctx.beginPath()
    ctx.roundRect(x, y, barW, barH, 2)
    ctx.fill()
  }
}

function drawMainFrame(
  ctx: CanvasRenderingContext2D,
  productImg: HTMLImageElement,
  analyser: AnalyserNode,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  dataArray: any,
  w: number,
  h: number,
) {
  // Background
  ctx.fillStyle = INK
  ctx.fillRect(0, 0, w, h)

  // Product image — centred, letterboxed, leaving room for waveform
  const imageArea = h - 160 // reserve bottom for waveform + padding
  const scale = Math.min(w / productImg.width, imageArea / productImg.height) * 0.85
  const iw = productImg.width * scale
  const ih = productImg.height * scale
  const ix = (w - iw) / 2
  const iy = (imageArea - ih) / 2 + 24

  // Soft shadow behind product
  ctx.save()
  ctx.shadowColor = 'rgba(255,72,1,0.18)'
  ctx.shadowBlur = 60
  ctx.drawImage(productImg, ix, iy, iw, ih)
  ctx.restore()

  // Waveform
  drawWaveform(ctx, analyser, dataArray, w, h)

  // Brand badge top-left
  drawBrandBadge(ctx, 24, 24)

  // Subtle bottom gradient so waveform reads cleanly
  const grad = ctx.createLinearGradient(0, h - 120, 0, h)
  grad.addColorStop(0, 'rgba(14,13,20,0)')
  grad.addColorStop(1, 'rgba(14,13,20,0.7)')
  ctx.fillStyle = grad
  ctx.fillRect(0, h - 120, w, 120)
}

function drawEndCard(
  ctx: CanvasRenderingContext2D,
  qrImg: HTMLImageElement,
  w: number,
  h: number,
  progress: number, // 0–1, for fade-in animation
) {
  // Workers light-mode background — warm near-white
  ctx.fillStyle = WORKERS_BG
  ctx.fillRect(0, 0, w, h)

  // Subtle orange radial glow top-centre — matches the Workers hero feel
  const glow = ctx.createRadialGradient(w / 2, 0, 0, w / 2, 0, w * 0.7)
  glow.addColorStop(0, 'rgba(255,72,1,0.18)')
  glow.addColorStop(0.5, 'rgba(255,72,1,0.06)')
  glow.addColorStop(1, 'rgba(255,72,1,0)')
  ctx.fillStyle = glow
  ctx.fillRect(0, 0, w, h)

  ctx.globalAlpha = progress

  // ── Brand name ──────────────────────────────────────────
  const fontSize = Math.floor(w * 0.088)
  ctx.font = `bold ${fontSize}px "Bungee", sans-serif`

  const bigParts = [
    { text: 'jingle j', color: INK },
    { text: 'AI', color: CF_ORANGE },
    { text: 'ngle', color: INK },
  ]

  let totalW = 0
  const widths: number[] = []
  for (const p of bigParts) {
    const mw = ctx.measureText(p.text).width
    widths.push(mw)
    totalW += mw
  }

  // Layout: brand | gap | "make your own" | gap | QR | gap | tagline
  const ctaSize = Math.floor(w * 0.026)
  const qrSize = Math.floor(w * 0.26)
  const tagSize = Math.floor(w * 0.022)
  const pad = 20
  const totalContentH = fontSize + ctaSize * 2 + qrSize + pad * 2 + tagSize * 2
  const startY = (h - totalContentH) / 2

  // Brand name
  const brandY = startY + fontSize
  let curX = w / 2 - totalW / 2
  ctx.textAlign = 'left'
  ctx.textBaseline = 'alphabetic'
  for (let i = 0; i < bigParts.length; i++) {
    ctx.fillStyle = bigParts[i].color
    ctx.fillText(bigParts[i].text, curX, brandY)
    curX += widths[i]
  }

  // "Make your own" label
  ctx.font = `600 ${ctaSize}px "IBM Plex Sans", sans-serif`
  ctx.textAlign = 'center'
  ctx.fillStyle = INK_SOFT
  const ctaY = brandY + ctaSize * 1.6
  ctx.fillText('Make your own', w / 2, ctaY)

  // QR code — light background card with orange shadow
  const qrX = (w - qrSize) / 2
  const qrY = ctaY + ctaSize * 0.8
  const r = 20

  // Card shadow
  ctx.save()
  ctx.shadowColor = 'rgba(255,72,1,0.18)'
  ctx.shadowBlur = 32
  ctx.fillStyle = '#ffffff'
  ctx.beginPath()
  ctx.roundRect(qrX - pad, qrY - pad, qrSize + pad * 2, qrSize + pad * 2, r)
  ctx.fill()
  ctx.restore()

  // Orange border ring
  ctx.strokeStyle = CF_ORANGE
  ctx.lineWidth = 3
  ctx.beginPath()
  ctx.roundRect(qrX - pad, qrY - pad, qrSize + pad * 2, qrSize + pad * 2, r)
  ctx.stroke()

  ctx.drawImage(qrImg, qrX, qrY, qrSize, qrSize)

  // ── Tagline below QR ────────────────────────────────────
  const tagY = qrY + qrSize + pad * 2 + tagSize
  ctx.font = `500 ${tagSize}px "IBM Plex Sans", sans-serif`
  ctx.textAlign = 'center'
  ctx.fillStyle = INK_SOFT
  ctx.fillText('Built with 🧡 on Cloudflare & Replicate', w / 2, tagY)

  ctx.globalAlpha = 1
  ctx.textAlign = 'left'
}

export function useVideoComposer() {
  const [state, setState] = useState<VideoComposerState>({ phase: 'idle' })
  const abortRef = useRef(false)

  const compose = useCallback(async (imageUrl: string, audioUrl: string) => {
    abortRef.current = false
    setState({ phase: 'loading' })

    if (!window.MediaRecorder) {
      setState({ phase: 'error', message: 'Video recording is not supported in this browser. Try Chrome or Edge.' })
      return
    }

    try {
      // Load the product image and generate QR code in parallel with audio fetch
      const [productImg, qrDataUrl, audioResp] = await Promise.all([
        loadImage(imageUrl),
        QRCode.toDataURL(QR_URL, {
          width: 512,
          margin: 1,
          color: { dark: '#0e0d14', light: '#ffffff' },
          errorCorrectionLevel: 'M',
        }),
        fetch(audioUrl),
      ])
      const qrImg = await loadImage(qrDataUrl)

      const audioBuffer = await audioResp.arrayBuffer()

      // Decode to get the real duration
      const audioCtx = new AudioContext()
      const decoded = await audioCtx.decodeAudioData(audioBuffer.slice(0))
      const audioDurationMs = decoded.duration * 1000
      await audioCtx.close()

      if (abortRef.current) return

      // Set up canvas
      const canvas = document.createElement('canvas')
      canvas.width = CANVAS_SIZE
      canvas.height = CANVAS_SIZE
      const ctx = canvas.getContext('2d')!

      // Set up a fresh AudioContext for playback + analysis
      const playCtx = new AudioContext()
      const source = playCtx.createBufferSource()
      const analyser = playCtx.createAnalyser()
  analyser.fftSize = 256
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const dataArray: any = new Uint8Array(analyser.frequencyBinCount)

      const playBuffer = await playCtx.decodeAudioData(audioBuffer.slice(0))
      source.buffer = playBuffer
      source.connect(analyser)
      analyser.connect(playCtx.destination)

      // MediaRecorder from canvas stream + audio stream
      const canvasStream = canvas.captureStream(FRAME_RATE)
      const audioDestination = playCtx.createMediaStreamDestination()
      analyser.connect(audioDestination)
      const audioTrack = audioDestination.stream.getAudioTracks()[0]
      canvasStream.addTrack(audioTrack)

      const mimeType = MediaRecorder.isTypeSupported('video/webm;codecs=vp9,opus')
        ? 'video/webm;codecs=vp9,opus'
        : MediaRecorder.isTypeSupported('video/webm;codecs=vp8,opus')
          ? 'video/webm;codecs=vp8,opus'
          : 'video/webm'

      const recorder = new MediaRecorder(canvasStream, { mimeType, videoBitsPerSecond: 4_000_000 })
      const chunks: BlobPart[] = []
      recorder.ondataavailable = (e) => { if (e.data.size > 0) chunks.push(e.data) }

      const totalDurationMs = audioDurationMs + END_CARD_DURATION_MS
      const startTime = performance.now()

      setState({ phase: 'recording', progress: 0 })

      await new Promise<void>((resolve, reject) => {
        recorder.onerror = (e) => reject(new Error(`MediaRecorder error: ${String(e)}`))

        recorder.onstop = () => resolve()

        recorder.start(100) // collect chunks every 100ms
        source.start(0)

        let endCardStarted = false

        function drawFrame() {
          if (abortRef.current) {
            recorder.stop()
            source.stop()
            void playCtx.close()
            return
          }

          const elapsed = performance.now() - startTime
          const progress = Math.min(elapsed / totalDurationMs, 1)
          setState({ phase: 'recording', progress })

          if (elapsed < audioDurationMs) {
            // Main frame with waveform
            drawMainFrame(ctx, productImg, analyser, dataArray, CANVAS_SIZE, CANVAS_SIZE)
          } else {
            // End card
            if (!endCardStarted) {
              endCardStarted = true
            }
            const endProgress = Math.min((elapsed - audioDurationMs) / END_CARD_DURATION_MS, 1)
            // First frame of end card: draw main frame underneath then crossfade
            drawMainFrame(ctx, productImg, analyser, dataArray, CANVAS_SIZE, CANVAS_SIZE)
            drawEndCard(ctx, qrImg, CANVAS_SIZE, CANVAS_SIZE, endProgress)
          }

          if (elapsed >= totalDurationMs) {
            recorder.stop()
            source.stop()
            void playCtx.close()
            return
          }

          requestAnimationFrame(drawFrame)
        }

        requestAnimationFrame(drawFrame)
      })

      if (abortRef.current) {
        setState({ phase: 'idle' })
        return
      }

      const blob = new Blob(chunks, { type: mimeType })
      const url = URL.createObjectURL(blob)
      setState({ phase: 'done', blob, url })

    } catch (err) {
      console.error('Video composer error:', err)
      setState({
        phase: 'error',
        message: err instanceof Error ? err.message : 'Video composition failed.',
      })
    }
  }, [])

  const reset = useCallback(() => {
    abortRef.current = true
    setState((prev) => {
      if (prev.phase === 'done') URL.revokeObjectURL(prev.url)
      return { phase: 'idle' }
    })
  }, [])

  return { state, compose, reset }
}

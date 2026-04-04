import { Button } from '@cloudflare/kumo'
import {
  ArrowLeft,
  CloudArrowUp,
  Database,
  MusicNotes,
  Ranking,
  ShareNetwork,
  ShieldCheck,
  Sparkle,
} from '@phosphor-icons/react'

type Props = { onBack: () => void }

type Step = {
  icon: React.ReactNode
  title: string
  body: React.ReactNode
}

const steps: Step[] = [
  {
    icon: <CloudArrowUp size={28} weight="duotone" />,
    title: 'You drop a product photo',
    body: (
      <>
        The image is the only input — no text prompt, no genre selector. Before the upload even
        leaves your browser, an invisible{' '}
        <a href="https://developers.cloudflare.com/turnstile/" target="_blank" rel="noreferrer">
          Cloudflare Turnstile
        </a>{' '}
        challenge runs silently in the background. It produces a short-lived token that the Worker
        checks before touching anything else, keeping bots from burning through the API budget.
      </>
    ),
  },
  {
    icon: <ShieldCheck size={28} weight="duotone" />,
    title: 'Turnstile verifies the request server-side',
    body: (
      <>
        The photo and the Turnstile token arrive together as a multipart form POST to the{' '}
        <a href="https://developers.cloudflare.com/workers/" target="_blank" rel="noreferrer">
          Cloudflare Worker
        </a>
        . The Worker calls Cloudflare&apos;s{' '}
        <a
          href="https://developers.cloudflare.com/turnstile/get-started/server-side-validation/"
          target="_blank"
          rel="noreferrer"
        >
          siteverify API
        </a>{' '}
        to confirm the token is genuine and hasn&apos;t already been used. A missing or invalid
        token gets a 403 — the upload stops there.
      </>
    ),
  },
  {
    icon: <Database size={28} weight="duotone" />,
    title: 'The Worker stores the image in R2',
    body: (
      <>
        Once verified, the Worker writes the raw image bytes into a{' '}
        <a href="https://developers.cloudflare.com/r2/" target="_blank" rel="noreferrer">
          Cloudflare R2
        </a>{' '}
        bucket with immutable cache headers, and records the jingle entry in a{' '}
        <a href="https://developers.cloudflare.com/d1/" target="_blank" rel="noreferrer">
          D1 SQLite database
        </a>{' '}
        with a status of &ldquo;queued&rdquo;. The image URL is then served back through the Worker
        so Replicate can reach it.
      </>
    ),
  },
  {
    icon: <MusicNotes size={28} weight="duotone" />,
    title: "Google's Lyria 3 on Replicate composes the jingle",
    body: (
      <>
        The Worker calls the{' '}
        <a href="https://replicate.com/google/lyria-3" target="_blank" rel="noreferrer">
          Replicate API
        </a>{' '}
        with{' '}
        <a href="https://deepmind.google/models/lyria/" target="_blank" rel="noreferrer">
          Google&apos;s Lyria 3
        </a>{' '}
        — an image-conditioned music generation model. It passes the product image URL alongside a
        randomly-selected commercial-style prompt (pop jingle, lo-fi, orchestral, 80s synth, country,
        soul, kids, or luxury — picked fresh each run). Lyria 3 generates a 30-second 48kHz stereo
        MP3. A webhook is included so Replicate notifies the Worker the moment the track is ready.
      </>
    ),
  },
  {
    icon: <CloudArrowUp size={28} weight="duotone" />,
    title: 'The finished audio is backed up to R2',
    body: (
      <>
        When the webhook fires, the Worker fetches the generated MP3 from Replicate&apos;s CDN
        (output URLs expire after one hour) and stores it permanently in{' '}
        <a href="https://developers.cloudflare.com/r2/" target="_blank" rel="noreferrer">
          R2
        </a>
        , then flips the jingle&apos;s status to &ldquo;succeeded&rdquo; in{' '}
        <a href="https://developers.cloudflare.com/d1/" target="_blank" rel="noreferrer">
          D1
        </a>
        . The front end polls every six seconds for any pending jingles and lights up the audio
        player automatically.
      </>
    ),
  },
  {
    icon: <Ranking size={28} weight="duotone" />,
    title: 'The leaderboard ranks by votes',
    body: (
      <>
        Every completed jingle appears on the public leaderboard sorted by vote count. Votes are
        recorded in{' '}
        <a href="https://developers.cloudflare.com/d1/" target="_blank" rel="noreferrer">
          D1
        </a>
        . Deduplication is cookie-based per browser — lightweight, no login required.
      </>
    ),
  },
  {
    icon: <ShareNetwork size={28} weight="duotone" />,
    title: 'Anyone can share a direct link',
    body: (
      <>
        Each jingle gets a stable{' '}
        <code>/share/:id</code> URL served by the Worker. That page carries full{' '}
        <a href="https://ogp.me/" target="_blank" rel="noreferrer">
          Open Graph
        </a>{' '}
        and Twitter Card meta tags — title, description, and the product image — so social platforms
        render a proper card. Humans are immediately redirected into the app. The Web Share API is
        used on mobile; clipboard copy is the fallback on desktop.
      </>
    ),
  },
]

type StackRow = {
  label: string
  detail: string
  href: string
}

const stack: StackRow[] = [
  {
    label: 'Frontend',
    detail: 'React + Vite, Kumo component library, Phosphor Icons',
    href: 'https://github.com/cloudflare/kumo',
  },
  {
    label: 'Runtime',
    detail: 'Cloudflare Workers — API routing and media delivery',
    href: 'https://developers.cloudflare.com/workers/',
  },
  {
    label: 'Bot protection',
    detail: 'Cloudflare Turnstile — invisible challenge on every upload',
    href: 'https://developers.cloudflare.com/turnstile/',
  },
  {
    label: 'Media storage',
    detail: 'Cloudflare R2 — product images and generated audio',
    href: 'https://developers.cloudflare.com/r2/',
  },
  {
    label: 'Database',
    detail: 'Cloudflare D1 (SQLite) — jingle metadata and vote counts',
    href: 'https://developers.cloudflare.com/d1/',
  },
  {
    label: 'AI model',
    detail: "Google's Lyria 3 via Replicate — image-conditioned music generation",
    href: 'https://replicate.com/google/lyria-3',
  },
  {
    label: 'Delivery',
    detail: 'Cloudflare Workers Assets — frontend served at the edge',
    href: 'https://developers.cloudflare.com/workers/static-assets/',
  },
  {
    label: 'Social sharing',
    detail: 'Dynamic Open Graph + Twitter Card meta per jingle',
    href: 'https://ogp.me/',
  },
]

export function AboutPage({ onBack }: Props) {
  return (
    <div className="about-page">
      <div className="about-header">
        <Button variant="ghost" size="sm" icon={ArrowLeft} onClick={onBack}>
          Back to studio
        </Button>
        <h1 className="about-title">
          How jingle j<span className="brand-ai">AI</span>ngle works
        </h1>
        <p className="about-lead">
          Drop a product photo. Get a commercial jingle. Here&apos;s what happens between those two
          moments — and what&apos;s keeping the bots out.
        </p>
      </div>

      <ol className="steps-list">
        {steps.map((step, i) => (
          <li key={i} className="step-item">
            <div className="step-icon">{step.icon}</div>
            <div className="step-body">
              <h3 className="step-title">{step.title}</h3>
              <p className="step-detail">{step.body}</p>
            </div>
          </li>
        ))}
      </ol>

      <div className="stack-section">
        <h2 className="stack-heading">
          <Sparkle size={20} weight="fill" />
          Stack
        </h2>
        <dl className="stack-grid">
          {stack.map((item) => (
            <div key={item.label} className="stack-row">
              <dt>{item.label}</dt>
              <dd>
                <a href={item.href} target="_blank" rel="noreferrer">
                  {item.detail}
                </a>
              </dd>
            </div>
          ))}
        </dl>
      </div>
    </div>
  )
}

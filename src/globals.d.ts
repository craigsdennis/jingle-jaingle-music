declare module '@cloudflare/kumo/styles'

interface Window {
  turnstile?: {
    render: (
      container: string | HTMLElement,
      options: {
        sitekey: string
        callback: (token: string) => void
        'error-callback'?: () => void
        'expired-callback'?: () => void
        size?: 'invisible' | 'normal' | 'compact'
        theme?: 'light' | 'dark' | 'auto'
        action?: string
      }
    ) => string
    reset: (widgetId?: string) => void
    remove: (widgetId?: string) => void
    getResponse: (widgetId?: string) => string | undefined
  }
}

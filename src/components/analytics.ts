/**
 * Visit counting with Google Analytics 4, decided 2026-10-29 with strict
 * limits (see README, "Privacy and keys"):
 *
 * - The measurement id comes from the build-time variable
 *   `VITE_GA_MEASUREMENT_ID`. When it is unset (local dev, forks, tests)
 *   nothing is loaded and no request leaves the browser.
 * - gtag is loaded from the landing view only, once, and sends a single
 *   `page_view`. No custom events; never a file name, document id,
 *   annotation or transcript.
 * - Consent defaults deny analytics and ad storage and every ad signal, so
 *   GA4 sets no cookies and counts the visit with a cookieless ping.
 */

const GTAG_SRC = 'https://www.googletagmanager.com/gtag/js?id='

/** Denies every storage and ad signal; GA4 then counts with a cookieless ping. */
export const CONSENT_DEFAULT = {
  analytics_storage: 'denied',
  ad_storage: 'denied',
  ad_user_data: 'denied',
  ad_personalization: 'denied',
} as const

/** One page view, no Google signals, no ad personalization. */
export const CONFIG = {
  send_page_view: true,
  allow_google_signals: false,
  allow_ad_personalization_signals: false,
} as const

/** Loaded script tags are marked with this attribute so a remount is a no-op. */
export const GTAG_SCRIPT_ATTRIBUTE = 'data-voxnote-gtag'

declare global {
  interface Window {
    // gtag.js reads `arguments` objects, not arrays, from the data layer.
    dataLayer?: IArguments[]
  }
}

function gtag(..._args: unknown[]): void {
  window.dataLayer ??= []
  // oxlint-disable-next-line prefer-rest-params
  window.dataLayer.push(arguments)
}

/**
 * Injects gtag.js for `measurementId` and queues one cookieless page view.
 * Returns true when the script was added, false when the id is empty or
 * the script is already on the page.
 */
export function loadAnalytics(measurementId: string | undefined): boolean {
  if (!measurementId) return false
  if (document.querySelector(`script[${GTAG_SCRIPT_ATTRIBUTE}]`)) return false

  // Order matters: consent must be queued before the config call.
  gtag('consent', 'default', CONSENT_DEFAULT)
  gtag('js', new Date())
  gtag('config', measurementId, CONFIG)

  const script = document.createElement('script')
  script.async = true
  script.src = `${GTAG_SRC}${encodeURIComponent(measurementId)}`
  script.setAttribute(GTAG_SCRIPT_ATTRIBUTE, measurementId)
  document.head.appendChild(script)
  return true
}

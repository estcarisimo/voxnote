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
 * - Analytics storage is granted and ad storage and every ad signal are
 *   denied, changed 2026-11-10. With analytics storage denied (the setting
 *   from 2026-10-29 to 2026-11-10) GA4 sends only cookieless pings, which
 *   Google keeps for behavioral modeling and does not show in reports
 *   unless a property has enough denied traffic to model: the live site
 *   counted nothing visible. GA4 now sets its first-party `_ga` and
 *   `_ga_<id>` cookies on this origin; no ad cookie, no Google signals.
 */

const GTAG_SRC = 'https://www.googletagmanager.com/gtag/js?id='

/**
 * Grants analytics storage only, so a visit is counted in GA4's reports;
 * ad storage and every ad signal stay denied.
 */
export const CONSENT_DEFAULT = {
  analytics_storage: 'granted',
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
 * Injects gtag.js for `measurementId` and queues one page view.
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

import { useEffect, useRef } from 'react'

/**
 * Chromium reports a ResizeObserver that could not deliver every
 * notification in one frame as a window error. It is a scheduling notice,
 * not a failure: nothing was lost and the next frame delivers the rest.
 */
const BENIGN =
  /^ResizeObserver loop (limit exceeded|completed with undelivered notifications)/

/** The text to show for an uncaught error or rejection, or null to ignore. */
export function describeWindowError(
  reason: unknown,
  fallback: string,
): string | null {
  const message =
    reason instanceof Error
      ? reason.message
      : typeof reason === 'string'
        ? reason
        : reason === undefined || reason === null
          ? fallback
          : String(reason)
  if (BENIGN.test(message)) return null
  return `Unexpected error: ${message}`
}

/**
 * Surfaces uncaught errors and unhandled promise rejections in the app's
 * error banner instead of letting them die in the console.
 */
export function useWindowErrors(onError: (message: string) => void): void {
  const report = useRef(onError)
  useEffect(() => {
    report.current = onError
  })
  useEffect(() => {
    const onWindowError = (event: ErrorEvent) => {
      const text = describeWindowError(
        event.error ?? event.message,
        'an unknown error',
      )
      if (text) report.current(text)
    }
    const onRejection = (event: PromiseRejectionEvent) => {
      const text = describeWindowError(event.reason, 'a promise was rejected')
      if (text) report.current(text)
    }
    window.addEventListener('error', onWindowError)
    window.addEventListener('unhandledrejection', onRejection)
    return () => {
      window.removeEventListener('error', onWindowError)
      window.removeEventListener('unhandledrejection', onRejection)
    }
  }, [])
}

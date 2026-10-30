interface AiKeysButtonProps {
  /** True while the AI keys dialog is open. */
  pressed: boolean
  onClick: () => void
}

/**
 * The header button that opens the AI keys dialog: a key icon and the words
 * "AI keys", so a reviewer who has never heard of a "provider" knows what
 * it is for. The icon is inline SVG; no asset to load.
 */
export function AiKeysButton({ pressed, onClick }: AiKeysButtonProps) {
  return (
    <button
      type="button"
      className="app-keys"
      aria-pressed={pressed}
      onClick={onClick}
    >
      <svg
        aria-hidden="true"
        width="18"
        height="18"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      >
        <circle cx="7.5" cy="15.5" r="4.5" />
        <path d="M10.7 12.3 21 2" />
        <path d="m16 7 3 3" />
        <path d="m13 10 2 2" />
      </svg>
      AI keys
    </button>
  )
}

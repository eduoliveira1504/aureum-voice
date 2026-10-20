import type { ReactNode } from 'react'

/** The official logo (docs/design/brand/logo.svg) in the current text color. For 32px and up;
 * logo-small.svg is the version for 16–24px. */
export function Logo({ size, className }: { size: number; className?: string }): ReactNode {
  return (
    <svg viewBox="0 0 96 96" width={size} height={size} className={className} aria-hidden>
      <polygon
        points="48,8 82.6,28 82.6,68 48,88 13.4,68 13.4,28"
        fill="none"
        stroke="currentColor"
        strokeWidth={8}
        strokeLinejoin="round"
      />
      <path d="M48 26 L66 70 H56 L48 50 L40 70 H30 Z" fill="currentColor" />
    </svg>
  )
}

import { useEffect, type ButtonHTMLAttributes, type ReactNode } from 'react'

export function Modal({
  title,
  subtitle,
  onClose,
  wide = false,
  children
}: {
  title: string
  subtitle?: string
  onClose(): void
  wide?: boolean
  children: ReactNode
}): ReactNode {
  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-6" onMouseDown={onClose}>
      <div
        role="dialog"
        aria-modal="true"
        aria-label={title}
        className={`w-full ${wide ? 'max-w-[760px]' : 'max-w-[440px]'} rounded-md bg-surface-2 p-6 shadow-2xl`}
        onMouseDown={(e) => e.stopPropagation()}
      >
        <h2 className="text-center text-xl font-semibold">{title}</h2>
        {subtitle && <p className="mt-2 text-center text-sm text-fg-muted">{subtitle}</p>}
        <div className="mt-5">{children}</div>
      </div>
    </div>
  )
}

export function SecondaryButton({
  children,
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement>): ReactNode {
  return (
    <button
      {...props}
      className="w-full rounded-[3px] bg-surface-3 px-4 py-2.5 text-[15px] font-medium text-fg hover:bg-surface-3/70 disabled:opacity-60"
    >
      {children}
    </button>
  )
}

export function DangerButton({ children, ...props }: ButtonHTMLAttributes<HTMLButtonElement>): ReactNode {
  return (
    <button
      {...props}
      className="w-full rounded-[3px] bg-danger px-4 py-2.5 text-[15px] font-semibold text-white hover:bg-danger/85 disabled:opacity-60"
    >
      {children}
    </button>
  )
}

export function FormError({ message }: { message?: string | null }): ReactNode {
  if (!message) return null
  return (
    <div role="alert" className="rounded-[3px] border border-danger/50 bg-danger/10 px-3 py-2 text-sm">
      {message}
    </div>
  )
}

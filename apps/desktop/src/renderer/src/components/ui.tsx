import type { ButtonHTMLAttributes, InputHTMLAttributes, ReactNode } from 'react'

export function Field({
  label,
  error,
  hint,
  ...props
}: InputHTMLAttributes<HTMLInputElement> & { label: string; error?: string; hint?: string }): ReactNode {
  return (
    <label className="block">
      <span className={`mb-2 block text-xs font-bold uppercase tracking-wide ${error ? 'text-danger' : 'text-fg-muted'}`}>
        {label}
        {error && <span className="font-normal normal-case tracking-normal"> — {error}</span>}
      </span>
      <input
        {...props}
        className="w-full rounded-[3px] bg-surface-0 px-3 py-2.5 text-[15px] text-fg outline-none ring-accent/60 placeholder:text-fg-subtle focus:ring-2"
      />
      {hint && !error && <span className="mt-1.5 block text-xs text-fg-subtle">{hint}</span>}
    </label>
  )
}

export function PrimaryButton({ children, ...props }: ButtonHTMLAttributes<HTMLButtonElement>): ReactNode {
  return (
    <button
      {...props}
      className="w-full rounded-[3px] bg-accent px-4 py-2.5 text-[15px] font-semibold text-accent-fg transition-colors hover:bg-accent-hover disabled:cursor-not-allowed disabled:opacity-60"
    >
      {children}
    </button>
  )
}

export function Avatar({ name, url, size = 32 }: { name: string; url?: string | null; size?: number }): ReactNode {
  const style = { width: size, height: size }
  if (url) return <img src={url} alt="" style={style} className="shrink-0 rounded-full object-cover" />
  return (
    <div
      style={{ ...style, fontSize: size * 0.42 }}
      className="flex shrink-0 items-center justify-center rounded-full bg-accent font-semibold text-accent-fg"
    >
      {name.slice(0, 1).toUpperCase()}
    </div>
  )
}

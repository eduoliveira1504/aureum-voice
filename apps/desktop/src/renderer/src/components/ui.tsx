import type { LucideIcon } from 'lucide-react'
import type { ButtonHTMLAttributes, InputHTMLAttributes, ReactNode } from 'react'

import { mediaUrl } from '../lib/api'

export function Field({
  label,
  error,
  hint,
  ...props
}: InputHTMLAttributes<HTMLInputElement> & { label: string; error?: string; hint?: string }): ReactNode {
  return (
    <label className="block">
      <span className={`${LABEL_BASE} ${error ? 'text-danger' : 'text-fg-muted'}`}>
        {label}
        {error && <span className="font-normal normal-case tracking-normal"> — {error}</span>}
      </span>
      <input {...props} className={inputClass} />
      {hint && !error && <span className="mt-1.5 block text-xs text-fg-subtle">{hint}</span>}
    </label>
  )
}

/** Shared look of text inputs, textareas and selects. */
export const inputClass =
  'w-full rounded-control border border-line bg-main px-3 py-2.5 text-[15px] text-fg outline-none transition-colors placeholder:text-fg-subtle focus:border-accent focus:ring-2 focus:ring-accent/25'

const LABEL_BASE = 'mb-2 block text-xs font-semibold uppercase tracking-wide'

/** Small uppercase label above a form control. */
export const labelClass = `${LABEL_BASE} text-fg-muted`

export function PrimaryButton({ children, ...props }: ButtonHTMLAttributes<HTMLButtonElement>): ReactNode {
  return (
    <button
      {...props}
      className="w-full rounded-control bg-accent px-4 py-2.5 text-[15px] font-semibold text-on-accent transition-colors hover:bg-accent-hover disabled:cursor-not-allowed disabled:opacity-60"
    >
      {children}
    </button>
  )
}

/** A row of mutually exclusive options (tabs inside a modal, theme picker...). */
export function Segmented<T extends string>({
  options,
  value,
  onChange
}: {
  options: readonly { value: T; label: string; icon?: LucideIcon }[]
  value: T
  onChange(value: T): void
}): ReactNode {
  return (
    <div
      role="radiogroup"
      className="grid gap-1 rounded-control border border-line bg-main p-1 text-sm"
      style={{ gridTemplateColumns: `repeat(${options.length}, minmax(0, 1fr))` }}
    >
      {options.map(({ value: v, label, icon: Icon }) => (
        <button
          key={v}
          type="button"
          role="radio"
          aria-checked={value === v}
          onClick={() => onChange(v)}
          className={`flex items-center justify-center gap-2 rounded-item py-1.5 font-medium transition-colors ${
            value === v ? 'bg-elevated text-fg shadow-sm' : 'text-fg-muted hover:text-fg'
          }`}
        >
          {Icon && <Icon size={16} />}
          {label}
        </button>
      ))}
    </div>
  )
}

/** On/off row with a title and a description. */
export function ToggleRow({
  title,
  description,
  checked,
  onChange
}: {
  title: string
  description: string
  checked: boolean
  onChange(checked: boolean): void
}): ReactNode {
  return (
    <label className="flex cursor-pointer items-center justify-between gap-4 rounded-control border border-line bg-main px-3 py-2.5">
      <span>
        <span className="block font-medium">{title}</span>
        <span className="block text-xs text-fg-subtle">{description}</span>
      </span>
      <input type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)} className="h-5 w-5 shrink-0 accent-accent" />
    </label>
  )
}

export function Avatar({ name, url, size = 32 }: { name: string; url?: string | null; size?: number }): ReactNode {
  const style = { width: size, height: size }
  if (url) return <img src={mediaUrl(url)} alt="" style={style} className="shrink-0 rounded-full object-cover" />
  return (
    <div
      style={{ ...style, fontSize: size * 0.42 }}
      className="flex shrink-0 items-center justify-center rounded-full bg-accent font-semibold text-on-accent"
    >
      {name.slice(0, 1).toUpperCase()}
    </div>
  )
}

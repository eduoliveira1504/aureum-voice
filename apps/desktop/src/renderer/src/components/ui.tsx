import type { LucideIcon } from 'lucide-react'
import { useEffect, type ButtonHTMLAttributes, type InputHTMLAttributes, type ReactNode, type RefObject } from 'react'

import { mediaUrl, type Presence } from '../lib/api'

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

export function Avatar({
  name,
  url,
  size = 32,
  shape = 'circle'
}: {
  name: string
  url?: string | null
  size?: number
  /** 'rounded' is a rounded square (chat). */
  shape?: 'circle' | 'rounded'
}): ReactNode {
  const style = { width: size, height: size }
  const radius = shape === 'circle' ? 'rounded-full' : 'rounded-item'
  if (url) return <img src={mediaUrl(url)} alt="" style={style} className={`shrink-0 object-cover ${radius}`} />
  return (
    <div
      style={{ ...style, fontSize: size * 0.42 }}
      className={`flex shrink-0 items-center justify-center bg-accent font-semibold text-on-accent ${radius}`}
    >
      {name.slice(0, 1).toUpperCase()}
    </div>
  )
}

/** Closes a popover on a click outside `ref` or on Escape. */
export function useDismiss(ref: RefObject<HTMLElement | null>, open: boolean, close: () => void): void {
  useEffect(() => {
    if (!open) return
    const onDown = (e: MouseEvent): void => {
      if (!ref.current?.contains(e.target as Node)) close()
    }
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') close()
    }
    window.addEventListener('mousedown', onDown)
    window.addEventListener('keydown', onKey)
    return () => {
      window.removeEventListener('mousedown', onDown)
      window.removeEventListener('keydown', onKey)
    }
  }, [ref, open, close])
}

/** Look of dropdown menus and small popovers. */
export const menuClass = 'z-40 rounded-control border border-line bg-main p-1.5 shadow-xl'

export function MenuItem({
  icon: Icon,
  label,
  hint,
  danger = false,
  disabled = false,
  onClick
}: {
  icon?: LucideIcon
  label: string
  hint?: string
  danger?: boolean
  disabled?: boolean
  onClick?(): void
}): ReactNode {
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={onClick}
      className={`flex w-full items-center gap-2.5 rounded-item px-2 py-1.5 text-left text-sm disabled:cursor-not-allowed disabled:opacity-50 ${
        danger ? 'text-danger enabled:hover:bg-danger enabled:hover:text-on-danger' : 'text-fg-muted enabled:hover:bg-accent enabled:hover:text-on-accent'
      }`}
    >
      {Icon && <Icon size={16} className="shrink-0" />}
      <span className="flex-1 truncate">{label}</span>
      {hint && <span className="shrink-0 text-xs opacity-70">{hint}</span>}
    </button>
  )
}

/** Small pill with a count (unread messages, mentions, pending requests). */
export function CountBadge({ count, tone = 'accent' }: { count: number; tone?: 'accent' | 'danger' }): ReactNode {
  if (count <= 0) return null
  return (
    <span
      className={`inline-flex h-[18px] min-w-[18px] shrink-0 items-center justify-center rounded-full px-1.5 text-[11px] font-bold leading-none ${
        tone === 'danger' ? 'bg-danger text-on-danger' : 'bg-accent text-on-accent'
      }`}
    >
      {count > 99 ? '99+' : count}
    </span>
  )
}

/** Server icon, or its initials. */
export function ServerIcon({ name, url, size = 32 }: { name: string; url: string | null; size?: number }): ReactNode {
  const style = { width: size, height: size, fontSize: size * 0.36 }
  if (url) return <img src={mediaUrl(url)} alt="" style={style} className="shrink-0 rounded-item object-cover" />
  const words = name.trim().split(/\s+/)
  const initials = (words.length > 1 ? words[0][0] + words[1][0] : name.slice(0, 2)).toUpperCase()
  return (
    <span style={style} className="flex shrink-0 items-center justify-center rounded-item bg-elevated font-display font-semibold text-fg">
      {initials}
    </span>
  )
}

export const PRESENCE_LABEL: Record<Presence, string> = {
  online: 'Online',
  idle: 'Ausente',
  dnd: 'Não perturbe',
  offline: 'Offline'
}

const PRESENCE_TONE: Record<Presence, string> = {
  online: 'bg-success',
  idle: 'bg-idle',
  dnd: 'bg-dnd',
  offline: 'bg-fg-subtle'
}

/** Presence dot. `border` is the color around it (the surface it sits on). */
export function StatusDot({
  status,
  size = 12,
  border = 'border-panel',
  className = ''
}: {
  status: Presence
  size?: number
  border?: string
  className?: string
}): ReactNode {
  return (
    <span
      title={PRESENCE_LABEL[status]}
      style={{ width: size, height: size }}
      className={`block shrink-0 rounded-full border-2 ${border} ${PRESENCE_TONE[status]} ${className}`}
    />
  )
}

/** Avatar with a presence dot on its corner. */
export function PresenceAvatar({
  name,
  url,
  status,
  size = 32,
  border = 'border-panel'
}: {
  name: string
  url?: string | null
  status?: Presence
  size?: number
  border?: string
}): ReactNode {
  const dot = Math.max(10, Math.round(size * 0.38))
  return (
    <span className="relative shrink-0">
      <Avatar name={name} url={url} size={size} />
      {status && <StatusDot status={status} size={dot} border={border} className="absolute -bottom-0.5 -right-0.5" />}
    </span>
  )
}

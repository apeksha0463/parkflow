import { forwardRef, useId, type InputHTMLAttributes, type ReactNode } from 'react'
import { AlertTriangle, RefreshCw } from 'lucide-react'
import { cn } from '../../lib/cn'
import { Button } from './Button'

export function Skeleton({ className }: { className?: string }) {
  return <div className={cn('animate-pulse rounded-md bg-ink-100', className)} aria-hidden />
}

export function Card({ className, children }: { className?: string; children: ReactNode }) {
  return <div className={cn('rounded-lg border border-ink-100 bg-white shadow-card', className)}>{children}</div>
}

export function EmptyState({ icon, title, children, action }: { icon?: ReactNode; title: string; children?: ReactNode; action?: ReactNode }) {
  return (
    <div className="flex flex-col items-center px-6 py-10 text-center">
      {icon && <div className="mb-3 grid size-10 place-items-center rounded-full bg-ink-50 text-ink-400">{icon}</div>}
      <p className="font-medium text-ink-800">{title}</p>
      {children && <p className="mt-1 max-w-sm text-sm text-ink-500">{children}</p>}
      {action && <div className="mt-4">{action}</div>}
    </div>
  )
}

export function ErrorState({ message, onRetry }: { message: string; onRetry?: () => void }) {
  return (
    <div role="alert" className="flex flex-col items-center px-6 py-10 text-center">
      <div className="mb-3 grid size-10 place-items-center rounded-full bg-status-full-bg text-status-full">
        <AlertTriangle className="size-5" />
      </div>
      <p className="font-medium text-ink-800">{message}</p>
      {onRetry && (
        <Button variant="secondary" size="sm" className="mt-4" onClick={onRetry}>
          <RefreshCw className="size-3.5" /> Try again
        </Button>
      )}
    </div>
  )
}

interface FieldProps extends InputHTMLAttributes<HTMLInputElement> {
  label: string
  error?: string
  hint?: string
}

export const Field = forwardRef<HTMLInputElement, FieldProps>(function Field({ label, error, hint, className, ...rest }, ref) {
  const id = useId()
  const describedBy = error ? `${id}-err` : hint ? `${id}-hint` : undefined
  return (
    <div className={className}>
      <label htmlFor={id} className="mb-1.5 block text-sm font-medium text-ink-700">
        {label}
      </label>
      <input
        ref={ref}
        id={id}
        aria-invalid={!!error || undefined}
        aria-describedby={describedBy}
        className={cn(
          'h-10 w-full rounded-md border bg-white px-3 text-sm text-ink-900 placeholder:text-ink-400 transition-colors',
          'focus:border-brand-500 focus:outline-none focus:ring-3 focus:ring-brand-100',
          error ? 'border-status-full' : 'border-ink-200',
        )}
        {...rest}
      />
      {error ? (
        <p id={`${id}-err`} className="mt-1.5 text-xs text-status-full">
          {error}
        </p>
      ) : hint ? (
        <p id={`${id}-hint`} className="mt-1.5 text-xs text-ink-500">
          {hint}
        </p>
      ) : null}
    </div>
  )
})

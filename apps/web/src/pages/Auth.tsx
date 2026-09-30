import { useState, type FormEvent } from 'react'
import { Link, Navigate, useNavigate, useSearchParams } from 'react-router-dom'
import { toast } from 'sonner'
import { useAuth } from '../auth/AuthContext'
import { Logo } from '../components/layout/AppShell'
import { Button } from '../components/ui/Button'
import { Field } from '../components/ui/primitives'
import { ApiError, errorMessage } from '../lib/api'

/** Only allow same-site relative redirects. */
function safeNext(raw: string | null): string {
  return raw && raw.startsWith('/') && !raw.startsWith('//') ? raw : '/'
}

function AuthLayout({ title, subtitle, children }: { title: string; subtitle: React.ReactNode; children: React.ReactNode }) {
  return (
    <div className="grid min-h-dvh bg-ink-25 lg:grid-cols-2">
      <div className="flex flex-col px-6 py-8 sm:px-12">
        <Logo />
        <div className="mx-auto flex w-full max-w-sm flex-1 flex-col justify-center py-12">
          <h1 className="text-2xl font-semibold tracking-tight text-ink-900">{title}</h1>
          <p className="mt-1.5 text-sm text-ink-500">{subtitle}</p>
          <div className="mt-8">{children}</div>
        </div>
      </div>
      <div className="hidden flex-col justify-end bg-ink-900 p-12 text-white lg:flex">
        <p className="max-w-md text-2xl leading-snug font-medium">“Where is parking available now — and where is pressure likely to build next?”</p>
        <p className="mt-4 max-w-md text-sm text-ink-300">ParkFlow forecasts parking-pressure spillover across neighbouring Melbourne sensor zones, with every value’s source shown.</p>
      </div>
    </div>
  )
}

export function LoginPage() {
  const { user, login } = useAuth()
  const [params] = useSearchParams()
  const navigate = useNavigate()
  const next = safeNext(params.get('next'))
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  if (user) return <Navigate to={next} replace />

  const submit = async (e: FormEvent) => {
    e.preventDefault()
    setError(null)
    setBusy(true)
    try {
      const u = await login({ email, password })
      toast.success(`Welcome back, ${u.name}`)
      navigate(next, { replace: true })
    } catch (err) {
      setError(errorMessage(err))
    } finally {
      setBusy(false)
    }
  }

  return (
    <AuthLayout
      title="Sign in"
      subtitle={
        <>
          New to ParkFlow?{' '}
          <Link to={`/register?next=${encodeURIComponent(next)}`} className="font-medium text-brand-600 hover:text-brand-700">
            Create an account
          </Link>
        </>
      }
    >
      <form onSubmit={submit} className="space-y-4" noValidate>
        {error && (
          <p role="alert" className="rounded-md bg-status-full-bg px-3 py-2 text-sm text-status-full">
            {error}
          </p>
        )}
        <Field label="Email" type="email" autoComplete="email" required value={email} onChange={(e) => setEmail(e.target.value)} />
        <Field label="Password" type="password" autoComplete="current-password" required value={password} onChange={(e) => setPassword(e.target.value)} />
        <Button type="submit" className="w-full" loading={busy} disabled={!email || !password}>
          Sign in
        </Button>
      </form>
    </AuthLayout>
  )
}

export function RegisterPage() {
  const { user, register } = useAuth()
  const [params] = useSearchParams()
  const navigate = useNavigate()
  const next = safeNext(params.get('next'))
  const [form, setForm] = useState({ name: '', email: '', password: '' })
  const [errors, setErrors] = useState<Record<string, string>>({})
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  if (user) return <Navigate to={next} replace />

  const submit = async (e: FormEvent) => {
    e.preventDefault()
    const local: Record<string, string> = {}
    if (!form.name.trim()) local.name = 'Enter your name'
    if (!/^\S+@\S+\.\S+$/.test(form.email)) local.email = 'Enter a valid email address'
    if (form.password.length < 8) local.password = 'Use at least 8 characters'
    setErrors(local)
    setError(null)
    if (Object.keys(local).length) return
    setBusy(true)
    try {
      await register(form)
      toast.success('Account created')
      navigate(next, { replace: true })
    } catch (err) {
      if (err instanceof ApiError && err.code === 'EMAIL_IN_USE') setErrors({ email: err.message })
      else if (err instanceof ApiError && err.details && typeof err.details === 'object') {
        setErrors(Object.fromEntries(Object.entries(err.details as Record<string, string[]>).map(([k, v]) => [k, v[0]])))
      } else setError(errorMessage(err))
    } finally {
      setBusy(false)
    }
  }

  const set = (k: keyof typeof form) => (e: React.ChangeEvent<HTMLInputElement>) => setForm((f) => ({ ...f, [k]: e.target.value }))

  return (
    <AuthLayout
      title="Create your account"
      subtitle={
        <>
          Already have one?{' '}
          <Link to={`/login?next=${encodeURIComponent(next)}`} className="font-medium text-brand-600 hover:text-brand-700">
            Sign in
          </Link>
        </>
      }
    >
      <form onSubmit={submit} className="space-y-4" noValidate>
        {error && (
          <p role="alert" className="rounded-md bg-status-full-bg px-3 py-2 text-sm text-status-full">
            {error}
          </p>
        )}
        <Field label="Name" autoComplete="name" value={form.name} onChange={set('name')} error={errors.name} />
        <Field label="Email" type="email" autoComplete="email" value={form.email} onChange={set('email')} error={errors.email} />
        <Field label="Password" type="password" autoComplete="new-password" value={form.password} onChange={set('password')} error={errors.password} hint="At least 8 characters" />
        <Button type="submit" className="w-full" loading={busy}>
          Create account
        </Button>
      </form>
    </AuthLayout>
  )
}

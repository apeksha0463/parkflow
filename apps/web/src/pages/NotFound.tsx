import { Link } from 'react-router-dom'

export default function NotFound() {
  return (
    <main className="mx-auto flex min-h-dvh max-w-md flex-col items-center justify-center px-6 text-center">
      <p className="font-mono text-sm text-brand-600">404</p>
      <h1 className="mt-2 text-2xl font-semibold text-ink-900">Page not found</h1>
      <p className="mt-2 text-ink-500">The page you are looking for doesn’t exist or has moved.</p>
      <Link to="/" className="mt-6 text-sm font-medium text-brand-600 hover:text-brand-700">
        Back to ParkFlow
      </Link>
    </main>
  )
}

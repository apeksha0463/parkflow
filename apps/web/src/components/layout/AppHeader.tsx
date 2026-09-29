import { useEffect, useRef, useState } from 'react'
import { Link, NavLink, useLocation, useNavigate } from 'react-router-dom'
import { ChevronDown, LogOut, Menu, User as UserIcon, X } from 'lucide-react'
import { toast } from 'sonner'
import { useAuth } from '../../auth/AuthContext'
import { cn } from '../../lib/cn'
import { buttonClass } from '../ui/Button'

export function Logo({ className }: { className?: string }) {
  return (
    <Link to="/" className={cn('flex items-center gap-2 font-semibold tracking-tight text-ink-900', className)} aria-label="ParkFlow home">
      <span className="grid size-7 place-items-center rounded-md bg-brand-600 text-sm font-bold text-white">P</span>
      <span>ParkFlow</span>
    </Link>
  )
}

const NAV = [{ to: '/explore', label: 'Explore parking' }]

export function AppHeader({ variant = 'solid' }: { variant?: 'solid' | 'transparent' }) {
  const { user, logout } = useAuth()
  const [menuOpen, setMenuOpen] = useState(false)
  const [mobileOpen, setMobileOpen] = useState(false)
  const menuRef = useRef<HTMLDivElement>(null)
  const navigate = useNavigate()
  const location = useLocation()

  useEffect(() => {
    const onDoc = (e: MouseEvent) => {
      if (!menuRef.current?.contains(e.target as Node)) setMenuOpen(false)
    }
    document.addEventListener('mousedown', onDoc)
    return () => document.removeEventListener('mousedown', onDoc)
  }, [])

  const signOut = async () => {
    setMenuOpen(false)
    setMobileOpen(false)
    try {
      await logout()
      toast.success('Signed out')
      navigate('/')
    } catch {
      toast.error('Could not sign out. Please try again.')
    }
  }

  const next = encodeURIComponent(location.pathname + location.search)

  return (
    <header className={cn('sticky top-0 z-[1100] border-b', variant === 'solid' ? 'border-ink-100 bg-white/95 backdrop-blur' : 'border-transparent bg-ink-25/80 backdrop-blur')}>
      <div className="mx-auto flex h-14 max-w-7xl items-center gap-6 px-4 sm:px-6">
        <Logo />
        <nav className="hidden items-center gap-1 md:flex" aria-label="Main">
          {NAV.map((n) => (
            <NavLink
              key={n.to}
              to={n.to}
              className={({ isActive }) =>
                cn('rounded-md px-3 py-1.5 text-sm font-medium transition-colors', isActive ? 'bg-ink-100 text-ink-900' : 'text-ink-600 hover:text-ink-900')
              }
            >
              {n.label}
            </NavLink>
          ))}
        </nav>

        <div className="ml-auto hidden items-center gap-2 md:flex">
          {user ? (
            <div className="relative" ref={menuRef}>
              <button
                onClick={() => setMenuOpen((o) => !o)}
                aria-expanded={menuOpen}
                aria-haspopup="menu"
                className="flex items-center gap-2 rounded-md py-1 pr-2 pl-1 text-sm font-medium text-ink-700 hover:bg-ink-100"
              >
                <span className="grid size-7 place-items-center rounded-full bg-brand-100 text-xs font-semibold text-brand-700">{user.name.slice(0, 1).toUpperCase()}</span>
                <span className="max-w-32 truncate">{user.name}</span>
                <ChevronDown className="size-3.5 text-ink-400" />
              </button>
              {menuOpen && (
                <div role="menu" className="absolute right-0 mt-1.5 w-56 overflow-hidden rounded-lg border border-ink-100 bg-white py-1 shadow-pop">
                  <div className="border-b border-ink-100 px-3 py-2">
                    <p className="truncate text-sm font-medium text-ink-900">{user.name}</p>
                    <p className="truncate text-xs text-ink-500">{user.email}</p>
                  </div>
                  <button role="menuitem" onClick={signOut} className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm text-ink-700 hover:bg-ink-50">
                    <LogOut className="size-4" /> Sign out
                  </button>
                </div>
              )}
            </div>
          ) : (
            <>
              <Link to={`/login?next=${next}`} className="rounded-md px-3 py-1.5 text-sm font-medium text-ink-700 hover:bg-ink-100">
                Sign in
              </Link>
              <Link to={`/register?next=${next}`} className={buttonClass('primary', 'sm')}>
                Create account
              </Link>
            </>
          )}
        </div>

        <button className="ml-auto rounded-md p-2 text-ink-600 hover:bg-ink-100 md:hidden" aria-label={mobileOpen ? 'Close menu' : 'Open menu'} aria-expanded={mobileOpen} onClick={() => setMobileOpen((o) => !o)}>
          {mobileOpen ? <X className="size-5" /> : <Menu className="size-5" />}
        </button>
      </div>

      {mobileOpen && (
        // Any link click inside the mobile menu closes it.
        <div className="border-t border-ink-100 bg-white px-4 py-3 md:hidden" onClickCapture={(e) => (e.target as HTMLElement).closest('a') && setMobileOpen(false)}>
          {NAV.map((n) => (
            <NavLink key={n.to} to={n.to} className="block rounded-md px-3 py-2 text-sm font-medium text-ink-700 hover:bg-ink-50">
              {n.label}
            </NavLink>
          ))}
          <div className="mt-2 border-t border-ink-100 pt-2">
            {user ? (
              <>
                <p className="flex items-center gap-2 px-3 py-2 text-sm text-ink-500">
                  <UserIcon className="size-4" /> {user.email}
                </p>
                <button onClick={signOut} className="flex w-full items-center gap-2 rounded-md px-3 py-2 text-sm font-medium text-ink-700 hover:bg-ink-50">
                  <LogOut className="size-4" /> Sign out
                </button>
              </>
            ) : (
              <div className="flex gap-2 px-3 py-2">
                <Link to={`/login?next=${next}`} className={buttonClass('secondary', 'md', 'flex-1')}>
                  Sign in
                </Link>
                <Link to={`/register?next=${next}`} className={buttonClass('primary', 'md', 'flex-1')}>
                  Create account
                </Link>
              </div>
            )}
          </div>
        </div>
      )}
    </header>
  )
}

export function AppFooter() {
  return (
    <footer className="border-t border-ink-100 bg-white">
      <div className="mx-auto flex max-w-7xl flex-col gap-4 px-4 py-8 text-sm text-ink-500 sm:px-6 md:flex-row md:items-start md:justify-between">
        <div className="max-w-md">
          <Logo />
          <p className="mt-3 text-xs leading-relaxed">
            Parking locations: © OpenStreetMap contributors (ODbL). Availability is shown only where a real source exists. Predictions are estimates, not guarantees.
            Simulated data is always labelled.
          </p>
        </div>
        <div className="flex gap-10">
          <div>
            <p className="mb-2 text-xs font-semibold tracking-wide text-ink-400 uppercase">Product</p>
            <Link to="/explore" className="block py-0.5 hover:text-ink-800">
              Explore parking
            </Link>
          </div>
          <div>
            <p className="mb-2 text-xs font-semibold tracking-wide text-ink-400 uppercase">Data</p>
            <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noreferrer" className="block py-0.5 hover:text-ink-800">
              OpenStreetMap licence
            </a>
          </div>
        </div>
      </div>
    </footer>
  )
}

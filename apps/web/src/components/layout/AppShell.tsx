import { useState, type ReactNode } from 'react'
import { Link, NavLink } from 'react-router-dom'
import { Menu, X } from 'lucide-react'
import { cn } from '../../lib/cn'
import { ReplayBar } from '../replay/ReplayBar'

export const NAV = [
  { to: '/', label: 'Overview', end: true },
  { to: '/map', label: 'Parking Map' },
  { to: '/spillover', label: 'Spillover Intelligence' },
  { to: '/research', label: 'Research & Models' },
] as const

export function Logo({ className, inverted }: { className?: string; inverted?: boolean }) {
  return (
    <Link to="/" className={cn('flex items-center gap-2.5', className)} aria-label="ParkFlow home">
      <span className={cn('grid size-8 place-items-center rounded-md', inverted ? 'bg-white text-ink-900' : 'bg-ink-900 text-white')} aria-hidden>
        <svg viewBox="0 0 24 24" className="size-5" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M7 20V5h6a4 4 0 0 1 0 8H7" />
          <path d="M15.5 17.5c1.5-.8 3-.8 4.5 0" className="opacity-70" />
        </svg>
      </span>
      <span className="leading-none">
        <span className={cn('block text-[15px] font-semibold tracking-[0.12em]', inverted ? 'text-white' : 'text-ink-900')}>PARKFLOW</span>
        <span className={cn('mt-0.5 hidden text-2xs sm:block', inverted ? 'text-ink-300' : 'text-ink-500')}>Melbourne Parking Intelligence</span>
      </span>
    </Link>
  )
}

function Header() {
  const [open, setOpen] = useState(false)

  return (
    <header className="sticky top-0 z-[1100] border-b border-ink-100 bg-white/95 backdrop-blur">
      <div className="mx-auto flex h-14 max-w-[1440px] items-center gap-6 px-4 sm:px-6">
        <Logo />
        <nav aria-label="Main" className="ml-4 hidden h-full items-stretch gap-1 lg:flex">
          {NAV.map((n) => (
            <NavLink
              key={n.to}
              to={n.to}
              end={'end' in n}
              className={({ isActive }) =>
                cn(
                  'relative flex items-center px-3 text-sm font-medium transition-colors',
                  isActive ? 'text-ink-900 after:absolute after:inset-x-3 after:bottom-0 after:h-0.5 after:rounded-full after:bg-brand-600' : 'text-ink-500 hover:text-ink-900',
                )
              }
            >
              {n.label}
            </NavLink>
          ))}
        </nav>
        <button
          type="button"
          className="ml-auto grid size-9 place-items-center rounded-md text-ink-700 hover:bg-ink-50 lg:hidden"
          aria-label={open ? 'Close menu' : 'Open menu'}
          aria-expanded={open}
          aria-controls="mobile-nav"
          onClick={() => setOpen((o) => !o)}
        >
          {open ? <X className="size-5" /> : <Menu className="size-5" />}
        </button>
      </div>
      {open && (
        <nav id="mobile-nav" aria-label="Main" className="animate-fade-in border-t border-ink-100 bg-white px-4 py-2 lg:hidden">
          {NAV.map((n) => (
            <NavLink
              key={n.to}
              to={n.to}
              end={'end' in n}
              onClick={() => setOpen(false)}
              className={({ isActive }) => cn('block rounded-md px-3 py-2.5 text-sm font-medium', isActive ? 'bg-ink-50 text-ink-900' : 'text-ink-600 hover:bg-ink-50')}
            >
              {n.label}
            </NavLink>
          ))}
        </nav>
      )}
      <ReplayBar />
    </header>
  )
}

/** App frame: header with navigation and the historical-replay bar. `fill` pages (maps) take the remaining height. */
export function AppShell({ children, fill }: { children: ReactNode; fill?: boolean }) {
  return (
    <div className={cn('flex min-h-dvh flex-col', fill && 'lg:h-dvh')}>
      <a href="#main" className="sr-only focus:not-sr-only focus:absolute focus:left-2 focus:top-2 focus:z-[2000] focus:rounded focus:bg-white focus:px-3 focus:py-2">
        Skip to content
      </a>
      <Header />
      <main id="main" className={cn('flex-1', fill && 'flex min-h-0 flex-col')}>
        {children}
      </main>
    </div>
  )
}

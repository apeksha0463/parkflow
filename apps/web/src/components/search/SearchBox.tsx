import { useEffect, useId, useRef, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Loader2, MapPin, Navigation, Search, X } from 'lucide-react'
import { api } from '../../lib/api'
import { cn } from '../../lib/cn'
import { useDebounced } from '../../lib/hooks'
import type { SearchResult } from '../../lib/types'

interface Props {
  onSelect: (r: SearchResult) => void
  initialValue?: string
  placeholder?: string
  size?: 'md' | 'lg'
  autoFocus?: boolean
  className?: string
}

type GeocodeResponse = { results: SearchResult[]; geocoder: 'ok' | 'unavailable' | 'not_used' }

/**
 * Location search combobox.
 * Typing suggests matching sensor zones (City of Melbourne street blocks). Pressing Enter runs a full search
 * (OpenStreetMap geocoder bounded to Greater Melbourne + zones) — the geocoder is never called per keystroke.
 */
export function SearchBox({ onSelect, initialValue = '', placeholder = 'Search a street, landmark or place in Melbourne', size = 'md', autoFocus, className }: Props) {
  const [text, setText] = useState(initialValue)
  const [open, setOpen] = useState(false)
  const [active, setActive] = useState(-1)
  const [fullQuery, setFullQuery] = useState<string | null>(null)
  const listId = useId()
  const rootRef = useRef<HTMLDivElement>(null)
  const debounced = useDebounced(text.trim(), 200)


  const suggest = useQuery({
    queryKey: ['geocode', 'suggest', debounced],
    queryFn: ({ signal }) => api<GeocodeResponse>('/api/search/geocode', { query: { q: debounced, mode: 'suggest' }, signal }),
    enabled: open && debounced.length >= 2 && fullQuery === null,
    staleTime: 5 * 60_000,
  })
  const full = useQuery({
    queryKey: ['geocode', 'full', fullQuery],
    queryFn: () => api<GeocodeResponse>('/api/search/geocode', { query: { q: fullQuery!, mode: 'full' } }),
    enabled: fullQuery !== null,
    staleTime: 30 * 60_000,
  })

  const current = fullQuery !== null ? full : suggest
  const results = current.data?.results ?? []

  useEffect(() => {
    const onDoc = (e: MouseEvent) => {
      if (!rootRef.current?.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', onDoc)
    return () => document.removeEventListener('mousedown', onDoc)
  }, [])

  const choose = (r: SearchResult) => {
    setText(r.label)
    setOpen(false)
    setActive(-1)
    setFullQuery(null)
    onSelect(r)
  }

  const onKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'ArrowDown') {
      e.preventDefault()
      setOpen(true)
      setActive((i) => Math.min(results.length - 1, i + 1))
    } else if (e.key === 'ArrowUp') {
      e.preventDefault()
      setActive((i) => Math.max(-1, i - 1))
    } else if (e.key === 'Enter') {
      e.preventDefault()
      if (active >= 0 && results[active]) choose(results[active])
      else if (text.trim().length >= 2) {
        setFullQuery(text.trim())
        setOpen(true)
        setActive(-1)
      }
    } else if (e.key === 'Escape') {
      setOpen(false)
    }
  }

  const showPanel = open && text.trim().length >= 2
  const lg = size === 'lg'

  return (
    <div ref={rootRef} className={cn('relative', className)}>
      <div
        className={cn(
          'flex items-center gap-2 rounded-lg border border-ink-200 bg-white shadow-card transition-shadow focus-within:border-brand-500 focus-within:ring-3 focus-within:ring-brand-100',
          lg ? 'h-14 px-4' : 'h-11 px-3',
        )}
      >
        <Search className={cn('shrink-0 text-ink-400', lg ? 'size-5' : 'size-4')} aria-hidden />
        <input
          role="combobox"
          aria-expanded={showPanel}
          aria-controls={listId}
          aria-autocomplete="list"
          aria-activedescendant={active >= 0 ? `${listId}-${active}` : undefined}
          aria-label="Search location"
          autoFocus={autoFocus}
          value={text}
          placeholder={placeholder}
          onChange={(e) => {
            setText(e.target.value)
            setOpen(true)
            setActive(-1)
            setFullQuery(null)
          }}
          onFocus={() => setOpen(true)}
          onKeyDown={onKeyDown}
          className={cn('min-w-0 flex-1 bg-transparent text-ink-900 placeholder:text-ink-400 focus:outline-none', lg ? 'text-base' : 'text-sm')}
        />
        {current.isFetching && <Loader2 className="size-4 animate-spin text-ink-400" aria-label="Searching" />}
        {text && !current.isFetching && (
          <button
            type="button"
            aria-label="Clear search"
            onClick={() => {
              setText('')
              setFullQuery(null)
            }}
            className="rounded p-1 text-ink-400 hover:bg-ink-100 hover:text-ink-600"
          >
            <X className="size-4" />
          </button>
        )}
      </div>

      {showPanel && (
        <div className="absolute inset-x-0 top-full z-[1000] mt-1.5 overflow-hidden rounded-lg border border-ink-100 bg-white shadow-pop">
          <ul id={listId} role="listbox" aria-label="Locations" className="max-h-80 overflow-y-auto py-1">
            {results.map((r, i) => (
              <li
                key={r.id}
                id={`${listId}-${i}`}
                role="option"
                aria-selected={i === active}
                onMouseDown={(e) => {
                  e.preventDefault()
                  choose(r)
                }}
                onMouseEnter={() => setActive(i)}
                className={cn('flex cursor-pointer items-start gap-3 px-3 py-2.5', i === active && 'bg-brand-50')}
              >
                {r.kind === 'zone' ? (
                  <MapPin className="mt-0.5 size-4 shrink-0 text-brand-600" aria-hidden />
                ) : (
                  <Navigation className="mt-0.5 size-4 shrink-0 text-ink-400" aria-hidden />
                )}
                <span className="min-w-0">
                  <span className="block truncate text-sm font-medium text-ink-900">{r.label}</span>
                  {r.sublabel && <span className="block truncate text-xs text-ink-500">{r.sublabel}</span>}
                </span>
              </li>
            ))}
          </ul>
          {!current.isFetching && results.length === 0 && current.isSuccess && (
            <p className="px-3 py-3 text-sm text-ink-500">
              {fullQuery !== null ? 'No places found in Melbourne for this search.' : 'No matching sensor zones. Press Enter to search streets and landmarks.'}
            </p>
          )}
          {current.isError && <p className="px-3 py-3 text-sm text-pressure-saturated">Search is unavailable right now. Please try again.</p>}
          <div className="flex items-center justify-between border-t border-ink-100 bg-ink-25 px-3 py-1.5 text-2xs text-ink-500">
            <span>{fullQuery === null ? 'Sensor zones · press Enter to search streets & landmarks' : full.data?.geocoder === 'unavailable' ? 'Street search unavailable — showing sensor zones only' : 'Places & sensor zones'}</span>
            <span>© OpenStreetMap</span>
          </div>
        </div>
      )}
    </div>
  )
}

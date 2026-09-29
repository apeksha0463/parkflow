import { useEffect, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { api } from './api'
import { DEFAULT_THRESHOLDS, type StatusThresholds } from './status'
import type { PublicConfig } from './types'

/** Server-configured thresholds so badge colours match the server's saturation logic. */
export function useThresholds(): StatusThresholds {
  const { data } = useQuery({
    queryKey: ['config'],
    queryFn: () => api<PublicConfig>('/api/config'),
    staleTime: 10 * 60_000,
  })
  return data ? { moderate: DEFAULT_THRESHOLDS.moderate, saturation: data.saturationThreshold } : DEFAULT_THRESHOLDS
}

export function useDebounced<T>(value: T, ms: number): T {
  const [v, setV] = useState(value)
  useEffect(() => {
    const t = setTimeout(() => setV(value), ms)
    return () => clearTimeout(t)
  }, [value, ms])
  return v
}

export function useMediaQuery(query: string): boolean {
  const get = () => typeof window !== 'undefined' && typeof window.matchMedia === 'function' && window.matchMedia(query).matches
  const [matches, setMatches] = useState(get)
  useEffect(() => {
    if (typeof window.matchMedia !== 'function') return
    const mq = window.matchMedia(query)
    const on = () => setMatches(mq.matches)
    mq.addEventListener('change', on)
    return () => mq.removeEventListener('change', on)
  }, [query])
  return matches
}

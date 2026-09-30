import { useEffect, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { api } from './api'
import { MODERATE_DISPLAY_BAND, type Thresholds } from './pressure'
import type { MapZone, OverviewStats, PublicConfig, ReplayClock } from './types'

/** Server-configured thresholds so colours match the server's saturation logic. null until loaded. */
export function useThresholds(): Thresholds | null {
  const { data } = useQuery({
    queryKey: ['config'],
    queryFn: () => api<PublicConfig>('/api/config'),
    staleTime: 10 * 60_000,
  })
  return data ? { moderate: MODERATE_DISPLAY_BAND, approaching: data.approachingThreshold, saturation: data.saturationThreshold } : null
}

/** The server replay clock. Data queries include `now` in their key, so they refetch when it moves. */
export function useReplay() {
  return useQuery({
    queryKey: ['replay'],
    queryFn: () => api<ReplayClock>('/api/replay'),
    refetchInterval: (q) => (q.state.data?.playing ? 15_000 : false),
    staleTime: 5_000,
  })
}

/** Seek / play / pause the shared replay clock. */
export function useReplayControl() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (patch: { at?: string; playing?: boolean; speed?: number }) => api<ReplayClock>('/api/replay', { method: 'POST', body: patch }),
    onSuccess: (clock) => qc.setQueryData(['replay'], clock),
  })
}

export function useStats() {
  return useQuery({ queryKey: ['stats'], queryFn: () => api<OverviewStats>('/api/stats'), staleTime: 5 * 60_000 })
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

/** Every monitored zone with its state at the replay time (for the maps). */
export function useMapZones() {
  const stats = useStats()
  const now = useReplay().data?.now ?? null
  const b = stats.data?.bounds
  const zones = useQuery({
    queryKey: ['map-zones', now, b],
    queryFn: () => api<{ items: MapZone[]; at: string }>('/api/parking/map', { query: { bbox: [b!.west - 0.01, b!.south - 0.01, b!.east + 0.01, b!.north + 0.01].join(',') } }),
    enabled: !!b && !!now,
    placeholderData: (prev) => prev,
  })
  return { stats, zones }
}

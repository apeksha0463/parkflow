const BASE = (import.meta.env.VITE_API_URL ?? '').replace(/\/$/, '')

export class ApiError extends Error {
  status: number
  code: string
  details?: unknown

  constructor(status: number, code: string, message: string, details?: unknown) {
    super(message)
    this.status = status
    this.code = code
    this.details = details
  }
}

type Query = Record<string, string | number | boolean | undefined | null | string[]>

function toQueryString(query?: Query): string {
  if (!query) return ''
  const params = new URLSearchParams()
  for (const [k, v] of Object.entries(query)) {
    if (v == null || v === '' || (Array.isArray(v) && v.length === 0)) continue
    params.set(k, Array.isArray(v) ? v.join(',') : String(v))
  }
  const s = params.toString()
  return s ? `?${s}` : ''
}

export async function api<T>(path: string, opts: { method?: string; body?: unknown; query?: Query; signal?: AbortSignal } = {}): Promise<T> {
  let res: Response
  try {
    res = await fetch(`${BASE}${path}${toQueryString(opts.query)}`, {
      method: opts.method ?? 'GET',
      credentials: 'include',
      signal: opts.signal,
      headers: {
        Accept: 'application/json',
        // Required by the API's CSRF check for state-changing requests.
        'X-Requested-With': 'ParkFlow',
        ...(opts.body !== undefined ? { 'Content-Type': 'application/json' } : {}),
      },
      body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
    })
  } catch (err) {
    if ((err as Error).name === 'AbortError') throw err
    throw new ApiError(0, 'NETWORK_ERROR', 'Can’t reach ParkFlow right now. Check your connection and try again.')
  }

  if (res.status === 204) return undefined as T
  const data = await res.json().catch(() => null)
  if (!res.ok) {
    const e = data?.error
    if (res.status >= 500 && !e) throw new ApiError(res.status, 'SERVICE_UNAVAILABLE', 'ParkFlow is temporarily unavailable. Please try again shortly.')
    throw new ApiError(res.status, e?.code ?? 'ERROR', e?.message ?? 'Something went wrong.', e?.details)
  }
  return data as T
}

export function errorMessage(err: unknown): string {
  if (err instanceof ApiError) return err.message
  return 'Something went wrong. Please try again.'
}

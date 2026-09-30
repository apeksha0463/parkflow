/**
 * Hex mirrors of design tokens for places where CSS variables can't be used (Leaflet paths, chart
 * libraries). Keep in sync with index.css. Chart series colours were checked with the dataviz palette
 * validator (lightness band, chroma, CVD and normal-vision separation, contrast on the light surface).
 */
export const TOKENS = {
  brand500: '#2563eb',
  brand600: '#1d4fd8',
  ink100: '#e2e8f0',
  ink200: '#cbd5e1',
  ink300: '#94a3b8',
  ink400: '#7b8799',
  ink500: '#5b6678',
  ink700: '#334155',
  ink900: '#0f172a',
  predicted: '#6d28d9',
  warning: '#b45309',
  data: '#0e7490',
} as const

/** Chart series: identity follows the entity, never the rank. */
export const SERIES = {
  actual: TOKENS.ink900,
  modelA: '#2a78d6',
  modelB: '#eb6834',
  persistence: TOKENS.ink400,
} as const

/**
 * Hex mirrors of design tokens in index.css, for places where CSS variables can't be used
 * (SVG presentation attributes written by Leaflet, chart libraries). Keep in sync with index.css.
 */
export const TOKENS = {
  brand500: '#2f5bea',
  brand600: '#2349d1',
  ink400: '#8793a3',
  ink500: '#5f6b7c',
  ink600: '#455061',
  available: '#15935a',
  moderate: '#b7791f',
  nearlyFull: '#d9580d',
  full: '#cf2e3a',
  predicted: '#6d45d6',
  simulated: '#0f7c8c',
} as const

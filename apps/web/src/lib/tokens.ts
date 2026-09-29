/**
 * Hex mirrors of design tokens in index.css, for places where CSS variables can't be used
 * (SVG presentation attributes written by Leaflet, chart libraries). Keep in sync with index.css.
 */
export const TOKENS = {
  brand500: '#2f5bea',
  brand600: '#2349d1',
  ink100: '#e9edf2',
  ink200: '#d7dde5',
  ink300: '#b6c0cc',
  ink400: '#8793a3',
  ink500: '#5f6b7c',
  ink600: '#455061',
  ink700: '#2f3846',
  available: '#15935a',
  moderate: '#b7791f',
  nearlyFull: '#d9580d',
  full: '#cf2e3a',
  predicted: '#6d45d6',
  simulated: '#0f7c8c',
} as const

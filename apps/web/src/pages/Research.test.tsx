import { screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import App from '../App'
import { mockApi, renderApp } from '../test/utils'
import type { Evaluation } from '../lib/types'

// Test fixtures only — the page reads results.json through the API.
const metric = (model: string, feature_set: string, horizon_min: number, mae: number, rmse: number, r2: number, subset = 'all') => ({ model, feature_set, horizon_min, subset, n: 1234, mae, rmse, r2 })
const cmp = (h: number, a: number, b: number) => ({
  horizon_min: h, model: 'hgb', subset: 'all', n: 1234, mae_temporal: a, mae_spatial_temporal: b, mae_reduction_pct: ((a - b) / a) * 100,
  bootstrap: { days: 42, mae_diff_mean: a - b, ci95: [0.0001, 0.0002] as [number, number] },
})

function evaluation(persistMae5: number): Evaluation {
  return {
    generated_at: '2026-01-01T00:00:00Z',
    config: { dataset: 'test-dataset', bucket_minutes: 5, horizons_minutes: [5, 30], saturation_threshold: 0.9, neighbour_radius_m: 250, experiment_hours: [7, 22], features: { temporal: ['a'], spatial_temporal: ['a', 'b', 'c'] } },
    splits: { train: { range: ['2019-01-01', '2019-08-31'], samples: 10 }, validation: { range: ['2019-09-01', '2019-10-31'], samples: 5 }, test: { range: ['2019-11-01', '2019-12-31'], samples: 7777 } },
    zones_in_experiment: 111,
    zones_with_neighbours: 99,
    saturation_events: { events: 2222, zones_with_events: 88, median_duration_min: 15 },
    metrics: [
      metric('persistence', 'none', 5, persistMae5, 0.09, 0.8),
      metric('hgb', 'temporal', 5, 0.05, 0.08, 0.85),
      metric('hgb', 'spatial_temporal', 5, 0.049, 0.079, 0.86),
      metric('persistence', 'none', 30, 0.12, 0.2, 0.5),
      metric('hgb', 'temporal', 30, 0.1, 0.15, 0.7),
      metric('hgb', 'spatial_temporal', 30, 0.097, 0.148, 0.71),
    ],
    comparisons: [cmp(5, 0.05, 0.049), cmp(30, 0.1, 0.097)],
  }
}

const dataset = {
  dataset: 'test-dataset',
  ingest: { raw_rows: 1000, final_rows: 990, devices: 50, zones: 20, first_start: 'x', last_end: 'y' },
  occupancy: { grid_step_minutes: 5, zones_with_any_valid: 15, valid_fraction: 0.7, min_observed_bays: 4 },
  geo: { zones: 20, zones_located: 17, neighbour_radius_m: 250, neighbour_pairs: 30, neighbours_per_zone: { '50%': 3 } },
}

function setup(persistMae5: number) {
  mockApi((u) => {
    if (u.pathname === '/api/analytics/model-performance')
      return { body: { mlService: 'up', registry: { active: 'st-test', models: [] }, offline: evaluation(persistMae5), dataset, online: [] } }
  })
}

describe('research & models', () => {
  it('shows the research question and figures loaded from the evaluation and dataset reports', async () => {
    setup(0.04)
    renderApp(<App />, { route: '/research' })
    expect(await screen.findByText(/does incorporating neighbouring parking occupancy improve short-term prediction/i)).toBeInTheDocument()
    expect(await screen.findByText(/990 sensor records retained of 1,000/)).toBeInTheDocument()
    expect(screen.getByText(/17 of 20 blocks located/)).toBeInTheDocument()
    expect(screen.getByText(/111 blocks with enough data/)).toBeInTheDocument()
    expect(screen.getAllByText('4.90 pp').length).toBe(2) // Model B MAE at 5 min: results table + A-vs-B table
    expect(screen.getByText('2.00%')).toBeInTheDocument() // reduction at 5 min
  })

  it('derives findings from the data, including unfavourable ones', async () => {
    setup(0.04) // persistence beats Model B on MAE at 5 min
    renderApp(<App />, { route: '/research' })
    expect(await screen.findByText('Neighbour information (Model B) lowers MAE at every evaluated horizon.')).toBeInTheDocument()
    expect(screen.getByText('The persistence baseline has a lower MAE than Model B at 5 min.')).toBeInTheDocument()
    expect(screen.getByText('The improvement grows with the forecast horizon.')).toBeInTheDocument()
    expect(screen.getByText('Model B has lower RMSE and higher R² than persistence at every horizon.')).toBeInTheDocument()
  })

  it('changes the findings when the results change', async () => {
    setup(0.06) // now Model B beats persistence everywhere
    renderApp(<App />, { route: '/research' })
    expect(await screen.findByText('Model B has a lower MAE than the persistence baseline at every horizon.')).toBeInTheDocument()
  })

  it('shows no metrics rather than estimates when the evaluation is unavailable', async () => {
    mockApi((u) => {
      if (u.pathname === '/api/analytics/model-performance') return { body: { mlService: 'unavailable', registry: null, offline: null, dataset: null, online: [] } }
    })
    renderApp(<App />, { route: '/research' })
    expect(await screen.findByText(/no metrics are shown rather than estimates/i)).toBeInTheDocument()
  })
})

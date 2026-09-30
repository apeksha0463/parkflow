/**
 * Client for the Python ML service. The frontend never calls the ML service directly.
 * Any network/HTTP failure becomes MlUnavailableError so callers can degrade to
 * "Prediction temporarily unavailable" while the rest of the API keeps working.
 */
import { config } from '../config.js';

const TIMEOUT_MS = 5000;
const MODELS_TTL_MS = 60_000;

export class MlUnavailableError extends Error {}
/** The service answered but refused to predict (e.g. insufficient history). */
export class MlRefusedError extends Error {
  constructor(
    public code: string,
    message: string,
  ) {
    super(message);
  }
}

export interface ModelMeta {
  id: string;
  feature_set: 'temporal' | 'spatial_temporal';
  algorithm: string;
  training_dataset: string;
  trained_at: string;
  feature_version: string;
  features: string[];
  horizons_minutes: number[];
  test_metrics: unknown[];
  config: { neighbour_radius_m: number; bucket_minutes: number; saturation_threshold: number } & Record<string, unknown>;
}

export interface Registry {
  active: string;
  active_selected_by?: string;
  generated_at: string;
  models: ModelMeta[];
}

export interface MlPrediction {
  zoneId: string;
  generatedAt: string;
  modelVersion: string;
  featureSet: string;
  basedOn: string;
  currentOccupancy: number;
  currentState: string | null;
  neighboursUsed: number;
  predictions: { horizonMinutes: number; predictedOccupancy: number; pressureLevel: string | null }[];
}

export interface PredictRequest {
  zoneId: string;
  timestamp: string;
  history: (number | null)[];
  observedBays: number;
  neighbours: { distanceM: number; history: (number | null)[] }[];
  model?: string;
  threshold?: number;
}

async function call<T>(path: string, init?: RequestInit): Promise<T> {
  let res: Response;
  try {
    res = await fetch(new URL(path, config.ML_SERVICE_URL), { ...init, signal: AbortSignal.timeout(TIMEOUT_MS) });
  } catch {
    throw new MlUnavailableError('ML service unreachable');
  }
  const body = (await res.json().catch(() => null)) as (T & { detail?: { code?: string; message?: string } }) | null;
  if (res.status === 422 && body?.detail?.code) throw new MlRefusedError(body.detail.code, body.detail.message ?? 'Prediction refused');
  if (!res.ok || body == null) throw new MlUnavailableError(`ML service responded ${res.status}`);
  return body;
}

let modelsCache: { at: number; value: Registry } | null = null;

export async function getRegistry(): Promise<Registry> {
  if (modelsCache && Date.now() - modelsCache.at < MODELS_TTL_MS) return modelsCache.value;
  const value = await call<Registry>('/models');
  modelsCache = { at: Date.now(), value };
  return value;
}

export function clearRegistryCache() {
  modelsCache = null;
}

export async function getEvaluation(): Promise<unknown> {
  return call('/evaluation');
}

/** Processing reports of the research dataset (ingest / occupancy grid / geo), as written by the pipeline. */
export async function getDataset(): Promise<unknown> {
  return call('/dataset');
}

export async function predict(body: PredictRequest): Promise<MlPrediction> {
  return call<MlPrediction>('/predict', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
}

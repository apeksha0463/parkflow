import { Router } from 'express';
import { z } from 'zod';
import { HttpError } from '../lib/errors.js';
import { getReplayClock, setReplayClock, type ReplayClock } from '../services/replay.js';

export const replayRouter = Router();

function toDto(c: ReplayClock) {
  return {
    mode: c.configured ? 'HISTORICAL_REPLAY' : 'NOT_CONFIGURED',
    now: c.now.toISOString(),
    playing: c.playing,
    speed: c.speed,
    stepMinutes: 5,
    range: c.range,
  };
}

/** The server replay clock: which recorded 2019 instant every "current" value refers to. */
replayRouter.get('/', async (_req, res) => {
  res.json(toDto(await getReplayClock()));
});

const ClockPatch = z
  .object({
    at: z.coerce.date().optional(),
    playing: z.boolean().optional(),
    speed: z.number().int().min(1).max(600).optional(),
  })
  .strict();

/** Seek / play / pause the replay (shared by all viewers of this deployment). */
replayRouter.post('/', async (req, res) => {
  const patch = ClockPatch.parse(req.body);
  const clock = await getReplayClock();
  if (!clock.range) throw new HttpError(409, 'REPLAY_NOT_CONFIGURED', 'No historical replay has been loaded.');
  if (patch.at && (patch.at < new Date(clock.range.start) || patch.at > new Date(clock.range.end))) {
    throw new HttpError(400, 'VALIDATION_ERROR', 'Time is outside the replay range', { range: clock.range });
  }
  res.json(toDto(await setReplayClock(patch)));
});

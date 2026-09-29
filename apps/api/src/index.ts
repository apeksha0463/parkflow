import { config } from './config.js';
import { createApp } from './app.js';
import { startReplay } from './services/replay.js';

createApp().listen(config.PORT, () => {
  console.log(`ParkFlow API listening on :${config.PORT}`);
  startReplay().catch((err) => console.error('Simulation replay failed to start:', err instanceof Error ? err.message : err));
});

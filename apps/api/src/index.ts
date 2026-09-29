import { config } from './config.js';
import { createApp } from './app.js';

createApp().listen(config.PORT, () => {
  console.log(`ParkFlow API listening on :${config.PORT}`);
});

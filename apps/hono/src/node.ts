import { serve } from '@hono/node-server';
import { logger } from '@workspace/core/utils/logger';
import { PORT } from '@/core/constants/global.js';
import { app } from './app.js';

const server = serve({ ...app, port: PORT }, (info) => {
  logger.log(`Started development server: http://localhost:${info.port}`);
});

// graceful shutdown
process.on('SIGINT', () => {
  server.close();
  process.exit(0);
});
process.on('SIGTERM', () => {
  server.close((err) => {
    if (err) {
      logger.error(err.message);
      process.exit(1);
    }
    process.exit(0);
  });
});

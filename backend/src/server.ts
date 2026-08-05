import { app } from './app';
import { env } from './config/env';

const start = async () => {
  try {
    await app.listen({ port: parseInt(env.PORT), host: '0.0.0.0' });
    app.log.info(`Server is running on port ${env.PORT}`);
  } catch (err) {
    app.log.error(
      { errorName: err instanceof Error ? err.name : 'UnknownError' },
      'Server startup failed'
    );
    process.exit(1);
  }
};

start();

import { app } from './app';
import { env } from './config/env';

const start = async () => {
  try {
    await app.listen({ port: parseInt(env.PORT), host: '0.0.0.0' });
    app.log.info(`Server is running on port ${env.PORT}`);
  } catch (err) {
    app.log.error(err);
    process.exit(1);
  }
};

start();

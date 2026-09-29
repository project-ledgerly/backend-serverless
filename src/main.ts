// Prisma auto-loads DATABASE_URL/DIRECT_URL from .env on its own, but
// nothing else does — JWT_SECRET and the rest need this explicit load,
// same as prisma.config.ts already does for the CLI.
import 'dotenv/config';
import { createApp } from './create-app.js';

async function bootstrap() {
  const app = await createApp();
  await app.listen(process.env.PORT ?? 3000);
}
await bootstrap();

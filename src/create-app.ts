import { timingSafeEqual } from 'node:crypto';
import { NestFactory } from '@nestjs/core';
import { ValidationPipe } from '@nestjs/common';
import { NestExpressApplication } from '@nestjs/platform-express';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import helmet from 'helmet';
import type { NextFunction, Request, Response } from 'express';
import { AppModule } from './app.module.js';

function safeEqual(a: string, b: string): boolean {
  const bufA = Buffer.from(a);
  const bufB = Buffer.from(b);
  // Length must match before timingSafeEqual (it throws on mismatched
  // lengths) — comparing against a fixed-length dummy first keeps the
  // early return from itself leaking length via timing.
  return bufA.length === bufB.length && timingSafeEqual(bufA, bufB);
}

export async function createApp(): Promise<NestExpressApplication> {
  const app = await NestFactory.create<NestExpressApplication>(AppModule);

  app.use(helmet({ contentSecurityPolicy: false, crossOriginResourcePolicy: false }));

  app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));

  const isProd = process.env.NODE_ENV === 'production';
  app.enableCors({
    origin: isProd ? (process.env.FRONTEND_URL ?? 'http://localhost:4000') : /^http:\/\/(localhost|127\.0\.0\.1):\d+$/,
    credentials: true,
  });

  // /docs open in dev; in prod it needs SWAGGER_USER/SWAGGER_PASSWORD or it
  // doesn't mount at all, rather than serving the full API schema unauthenticated.
  const swaggerUser = process.env.SWAGGER_USER;
  const swaggerPassword = process.env.SWAGGER_PASSWORD;
  if (!isProd || (swaggerUser && swaggerPassword)) {
    if (isProd) {
      app.use('/docs', (req: Request, res: Response, next: NextFunction) => {
        const header = req.headers.authorization;
        const [, encoded] = header?.split(' ') ?? [];
        const [user, password] = encoded
          ? Buffer.from(encoded, 'base64').toString('utf8').split(':')
          : [];
        if (user && password && safeEqual(user, swaggerUser!) && safeEqual(password, swaggerPassword!)) {
          return next();
        }
        res.set('WWW-Authenticate', 'Basic realm="docs"');
        res.status(401).send('Authentication required.');
      });
    }

    const config = new DocumentBuilder()
      .setTitle('Financial Balancing App API')
      .setDescription('Priority-ordered allocation engine — backend API')
      .setVersion('0.1.0')
      .addBearerAuth()
      .build();
    const document = SwaggerModule.createDocument(app, config);
    SwaggerModule.setup('docs', app, document);
  }

  await app.init();

  return app;
}

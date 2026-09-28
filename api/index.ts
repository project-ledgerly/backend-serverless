import type { VercelRequest, VercelResponse } from '@vercel/node';
import type { Application } from 'express';
import { createApp } from '../src/create-app.js';

let expressAppPromise: Promise<Application> | undefined = undefined;

function getExpressApp(): Promise<Application> {
  if (expressAppPromise === undefined) {
    expressAppPromise = createApp().then((app) => app.getHttpAdapter().getInstance());
  }
  return expressAppPromise;
}

export default async function (req: VercelRequest, res: VercelResponse) {
  const expressApp = await getExpressApp();
  expressApp(req, res);
}

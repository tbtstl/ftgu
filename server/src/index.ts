// Starts the mentor server: `npm run server` (settings in server/.env).

import { serve } from '@hono/node-server';
import { createApp } from './app';
import { privyVerifier } from './auth';
import { config } from './config';
import { claudeModel } from './model';
import { payferPayments } from './payments';
import { openStore } from './store';

const app = createApp({
  enabled: config.enabled,
  store: openStore(config.databasePath),
  verify: privyVerifier(),
  payments: payferPayments(),
  payferPublishableKey: config.payferPublishableKey,
  model: claudeModel(),
  origins: config.siteOrigins,
});

const missing = [
  !config.privyAppId || !config.privyAppSecret ? 'PRIVY_APP_ID / PRIVY_APP_SECRET (sign-in)' : null,
  !config.payferSecretKey || !config.payferPublishableKey ? `the Payfer ${process.env.PAYFER_MODE === 'live' ? 'live' : 'test'} keys (paid messages)` : null,
  !process.env.ANTHROPIC_API_KEY ? 'ANTHROPIC_API_KEY (answers)' : null,
].filter(Boolean);

serve({ fetch: app.fetch, port: config.port }, ({ port }) => {
  console.log(`Mentor server on http://localhost:${port} using ${config.model} at ${config.effort} effort, Payfer in ${process.env.PAYFER_MODE === 'live' ? 'live' : 'test'} mode`);
  if (!config.enabled) console.log('The mentor is switched off (MENTOR_ENABLED isn’t true): /api answers 404.');
  if (missing.length) console.log(`Not set in server/.env yet: ${missing.join(', ')}`);
});

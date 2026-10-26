// Starts the mentor server: `npm run server` (settings in server/.env).

import { serve } from '@hono/node-server';
import { createApp } from './app';
import { privyVerifier } from './auth';
import { config } from './config';
import { claudeModel } from './model';
import { payferPayments } from './payments';
import { openStore } from './store';

const app = createApp({
  store: openStore(config.databasePath),
  verify: privyVerifier(),
  payments: payferPayments(),
  model: claudeModel(),
  origins: config.siteOrigins,
});

const missing = [
  !config.privyAppId || !config.privyAppSecret ? 'PRIVY_APP_ID / PRIVY_APP_SECRET (sign-in)' : null,
  !config.payferSecretKey ? 'PAYFER_SECRET_KEY (paid messages)' : null,
  !process.env.ANTHROPIC_API_KEY ? 'ANTHROPIC_API_KEY (answers)' : null,
].filter(Boolean);

serve({ fetch: app.fetch, port: config.port }, ({ port }) => {
  console.log(`Mentor server on http://localhost:${port} using ${config.model}`);
  if (missing.length) console.log(`Not set in server/.env yet: ${missing.join(', ')}`);
});

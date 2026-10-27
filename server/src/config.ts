// The server's settings, read from server/.env (npm run server loads it). Missing keys don't stop
// the server: whatever needs them answers 503 until they're set, so sign-in and free messages can
// be tried before Payfer is set up.

function value(name: string): string | null {
  const v = process.env[name]?.trim();
  return v ? v : null;
}

// Payfer keys come in pairs per mode; PAYFER_MODE picks one (test unless it says live), so the
// publishable key the browser gets always matches the secret key the server charges with.
const payferLive = value('PAYFER_MODE') === 'live';

export const config = {
  /** The feature flag: the API answers only when MENTOR_ENABLED=true; /health always does. */
  enabled: value('MENTOR_ENABLED') === 'true',
  port: Number(value('PORT') ?? 8787),
  /** Browser origins allowed to call the API, comma-separated. */
  siteOrigins: (value('SITE_ORIGIN') ?? 'http://localhost:5173').split(',').map((s) => s.trim()),
  databasePath: value('DATABASE_PATH') ?? 'server/data/mentor.db',
  model: value('MENTOR_MODEL') ?? 'claude-opus-5-5',
  privyAppId: value('PRIVY_APP_ID'),
  privyAppSecret: value('PRIVY_APP_SECRET'),
  payferSecretKey: value(payferLive ? 'PAYFER_LIVE_SK' : 'PAYFER_TEST_SK'),
  payferPublishableKey: value(payferLive ? 'PAYFER_LIVE_PK' : 'PAYFER_TEST_PK'),
};

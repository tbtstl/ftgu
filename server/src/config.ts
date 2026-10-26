// The server's settings, read from server/.env (npm run server loads it). Missing keys don't stop
// the server: whatever needs them answers 503 until they're set, so sign-in and free messages can
// be tried before Payfer is set up.

function value(name: string): string | null {
  const v = process.env[name]?.trim();
  return v ? v : null;
}

export const config = {
  port: Number(value('PORT') ?? 8787),
  /** Browser origins allowed to call the API, comma-separated. */
  siteOrigins: (value('SITE_ORIGIN') ?? 'http://localhost:5173').split(',').map((s) => s.trim()),
  databasePath: value('DATABASE_PATH') ?? 'server/data/mentor.db',
  model: value('MENTOR_MODEL') ?? 'claude-opus-5-5',
  privyAppId: value('PRIVY_APP_ID'),
  privyAppSecret: value('PRIVY_APP_SECRET'),
  payferSecretKey: value('PAYFER_SECRET_KEY'),
};

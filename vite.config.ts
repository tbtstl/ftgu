/// <reference types="vitest/config" />
import { defineConfig, type Plugin } from 'vite';
import react from '@vitejs/plugin-react';

// The footer's weather comes from an edge function (functions/api/weather.ts) that only runs
// on the host. In development, answer the same request with a fixed sample instead.
function sampleWeather(): Plugin {
  return {
    name: 'sample-weather',
    configureServer(server) {
      server.middlewares.use('/api/weather', (_req, res) => {
        res.setHeader('content-type', 'application/json');
        res.end(JSON.stringify({ place: 'Brooklyn', temperature: 58, unit: 'F', sky: 'cloudy', icon: 'cloud', daylightMinutes: 641 }));
      });
    },
  };
}

// Relative base so the built site works from any path (static hosting, artifacts).
export default defineConfig({
  base: './',
  plugins: [react(), sampleWeather()],
  test: {
    environment: 'jsdom',
    globals: true,
    include: ['tests/**/*.test.ts', 'tests/**/*.test.tsx'],
  },
});

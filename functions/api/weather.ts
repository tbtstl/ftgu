// GET /api/weather: today's weather near the reader, for the footer on the home and course pages.
//
// Runs as a Cloudflare Pages Function next to the static site. The place is Cloudflare's own
// estimate from the request (request.cf), so the reader is never asked for their location.
// Coordinates are rounded to about 10 km before anything else happens, nothing about the
// reader is logged or stored, and each rounded place is cached for 30 minutes, so most page
// views never reach Open-Meteo. Without an estimate the response is 204 and the footer hides.

interface Geo {
  latitude?: string;
  longitude?: string;
  city?: string;
  country?: string;
}

interface Context {
  request: Request & { cf?: Geo };
  waitUntil(promise: Promise<unknown>): void;
}

interface Forecast {
  current: { temperature_2m: number; weather_code: number; is_day: number };
  daily: { daylight_duration: number[] };
}

type Icon = 'sun' | 'moon' | 'cloud' | 'rain' | 'snow';

const FAHRENHEIT = new Set(['US', 'LR', 'MM']);
const TTL_SECONDS = 30 * 60;

export async function onRequestGet({ request, waitUntil }: Context): Promise<Response> {
  const geo = request.cf ?? {};
  const lat = Number(geo.latitude);
  const lon = Number(geo.longitude);
  if (!geo.city || !Number.isFinite(lat) || !Number.isFinite(lon)) return new Response(null, { status: 204 });

  const place = { lat: lat.toFixed(1), lon: lon.toFixed(1), city: geo.city };
  const unit = FAHRENHEIT.has(geo.country ?? '') ? 'F' : 'C';
  const cache = (caches as unknown as { default: Cache }).default;
  const key = new Request(new URL(`/api/weather/${place.lat},${place.lon},${unit},${encodeURIComponent(place.city)}`, request.url));

  const hit = await cache.match(key);
  if (hit) return forReader(await hit.text());

  const url =
    `https://api.open-meteo.com/v1/forecast?latitude=${place.lat}&longitude=${place.lon}` +
    '&current=temperature_2m,weather_code,is_day&daily=daylight_duration&forecast_days=1&timezone=auto' +
    (unit === 'F' ? '&temperature_unit=fahrenheit' : '');
  const upstream = await fetch(url);
  if (!upstream.ok) return new Response(null, { status: 204 });
  const data = (await upstream.json()) as Forecast;

  const body = JSON.stringify({
    place: place.city,
    temperature: Math.round(data.current.temperature_2m),
    unit,
    ...describe(data.current.weather_code, data.current.is_day === 1),
    daylightMinutes: Math.round((data.daily.daylight_duration[0] ?? 0) / 60),
  });
  waitUntil(cache.put(key, new Response(body, { headers: { 'content-type': 'application/json', 'cache-control': `public, max-age=${TTL_SECONDS}` } })));
  return forReader(body);
}

/** The reader's copy is private: it describes where they are, so shared caches mustn't keep it. */
function forReader(body: string): Response {
  return new Response(body, { headers: { 'content-type': 'application/json', 'cache-control': `private, max-age=${TTL_SECONDS}` } });
}

/** WMO weather code → a few words for the footer, and which little drawing goes with them. */
function describe(code: number, day: boolean): { sky: string; icon: Icon } {
  if (code === 0) return { sky: 'clear', icon: day ? 'sun' : 'moon' };
  if (code === 1) return { sky: 'mostly clear', icon: day ? 'sun' : 'moon' };
  if (code === 2) return { sky: 'partly cloudy', icon: 'cloud' };
  if (code === 3) return { sky: 'cloudy', icon: 'cloud' };
  if (code === 45 || code === 48) return { sky: 'foggy', icon: 'cloud' };
  if (code >= 51 && code <= 57) return { sky: 'drizzling', icon: 'rain' };
  if ((code >= 71 && code <= 77) || code === 85 || code === 86) return { sky: 'snowing', icon: 'snow' };
  if (code >= 95) return { sky: 'stormy', icon: 'rain' };
  return { sky: 'raining', icon: 'rain' };
}

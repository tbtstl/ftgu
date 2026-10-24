// The footer on the home and course pages: today's weather where the reader is.
//
// By default the place comes from the reader's time zone alone: America/New_York means New
// York, at the coordinates the time zone database gives for it. That needs no permission and
// no lookup. The small target beside the city asks the browser for the reader's actual
// location instead; it's rounded to about 10 km, kept in memory for this visit only, and never
// stored. The forecast comes straight from Open-Meteo. If anything fails, the footer hides.

import { useEffect, useState } from 'react';

type Icon = 'sun' | 'moon' | 'cloud' | 'rain' | 'snow';

interface Place {
  lat: number;
  lon: number;
  unit: 'F' | 'C';
  /** The time zone's city, or null for the reader's own location. */
  name: string | null;
}

interface Weather {
  temperature: number;
  /** "cloudy", "raining", "clear"… */
  sky: string;
  icon: Icon;
  daylightMinutes: number;
}

interface Forecast {
  current: { temperature_2m: number; weather_code: number; is_day: number };
  daily: { daylight_duration: number[] };
}

const FAHRENHEIT = new Set(['US', 'LR', 'MM']);

// Older names some browsers still report, mapped to the ones in the time zone table.
const ALIASES: Record<string, string> = {
  'America/Buenos_Aires': 'America/Argentina/Buenos_Aires',
  'America/Godthab': 'America/Nuuk',
  'America/Indianapolis': 'America/Indiana/Indianapolis',
  'America/Louisville': 'America/Kentucky/Louisville',
  'Asia/Calcutta': 'Asia/Kolkata',
  'Asia/Dacca': 'Asia/Dhaka',
  'Asia/Katmandu': 'Asia/Kathmandu',
  'Asia/Rangoon': 'Asia/Yangon',
  'Asia/Saigon': 'Asia/Ho_Chi_Minh',
  'Asia/Ulan_Bator': 'Asia/Ulaanbaatar',
  'Atlantic/Faeroe': 'Atlantic/Faroe',
  'Europe/Kiev': 'Europe/Kyiv',
  'Pacific/Ponape': 'Pacific/Pohnpei',
  'Pacific/Truk': 'Pacific/Chuuk',
};

// Shared by every footer during the visit, so moving between pages doesn't ask or fetch again.
let precise: Place | null = null;
const forecasts = new Map<string, Promise<Weather>>();

async function zonePlace(): Promise<Place | null> {
  const tz = Intl.DateTimeFormat().resolvedOptions().timeZone;
  const { ZONES } = await import('./zones');
  const key = ZONES[tz] ? tz : ALIASES[tz];
  const zone = key ? ZONES[key] : undefined;
  if (!zone) return null;
  const [lat, lon, country] = zone;
  return { lat, lon, unit: FAHRENHEIT.has(country) ? 'F' : 'C', name: key.split('/').pop()!.replace(/_/g, ' ') };
}

function forecast(place: Place): Promise<Weather> {
  const key = `${place.lat},${place.lon},${place.unit}`;
  let p = forecasts.get(key);
  if (!p) {
    const url =
      `https://api.open-meteo.com/v1/forecast?latitude=${place.lat}&longitude=${place.lon}` +
      '&current=temperature_2m,weather_code,is_day&daily=daylight_duration&forecast_days=1&timezone=auto' +
      (place.unit === 'F' ? '&temperature_unit=fahrenheit' : '');
    p = fetch(url)
      .then((r) => {
        if (!r.ok) throw new Error(`Open-Meteo: ${r.status}`);
        return r.json() as Promise<Forecast>;
      })
      .then((d) => ({
        temperature: Math.round(d.current.temperature_2m),
        ...describe(d.current.weather_code, d.current.is_day === 1),
        daylightMinutes: Math.round((d.daily.daylight_duration[0] ?? 0) / 60),
      }));
    p.catch(() => forecasts.delete(key));
    forecasts.set(key, p);
  }
  return p;
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

export function SiteFooter() {
  const [place, setPlace] = useState<Place | null>(precise);
  const [weather, setWeather] = useState<Weather | null>(null);
  const [locating, setLocating] = useState(false);

  useEffect(() => {
    if (place) return;
    let live = true;
    zonePlace()
      .then((p) => {
        if (live && p) setPlace(p);
      })
      .catch(() => {});
    return () => {
      live = false;
    };
  }, [place]);

  useEffect(() => {
    if (!place) return;
    let live = true;
    forecast(place)
      .then((w) => {
        if (live) setWeather(w);
      })
      .catch(() => {});
    return () => {
      live = false;
    };
  }, [place]);

  const locate = () => {
    if (!place || locating) return;
    setLocating(true);
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        precise = { lat: Math.round(pos.coords.latitude * 10) / 10, lon: Math.round(pos.coords.longitude * 10) / 10, unit: place.unit, name: null };
        setPlace(precise);
        setLocating(false);
      },
      () => setLocating(false),
      { enableHighAccuracy: false, maximumAge: 10 * 60 * 1000, timeout: 10000 },
    );
  };

  if (!place || !weather) return null;
  const h = Math.floor(weather.daylightMinutes / 60);
  const m = weather.daylightMinutes % 60;
  const canLocate = place.name !== null && typeof navigator !== 'undefined' && 'geolocation' in navigator;

  return (
    <footer className="sf">
      <p>
        <WeatherIcon icon={weather.icon} />
        <span>
          {weather.temperature}°{place.unit} and {weather.sky} {place.name ? 'in ' : ''}
          <a href="https://open-meteo.com/" target="_blank" rel="noopener" title="Weather by Open-Meteo">
            {place.name ?? 'near you'}
          </a>
        </span>
        {canLocate && (
          <button
            type="button"
            className={locating ? 'sf-locate busy' : 'sf-locate'}
            onClick={locate}
            aria-label="Use my location for the weather"
            title="Use my location"
            aria-busy={locating}
          >
            <svg width="14" height="14" viewBox="0 0 16 16" aria-hidden="true">
              <circle cx="8" cy="8" r="4.5" />
              <path d="M8 1v2.5M8 12.5V15M1 8h2.5M12.5 8H15" />
              <circle className="sf-dot" cx="8" cy="8" r="1" />
            </svg>
          </button>
        )}
        <span aria-hidden="true">·</span>
        <span>
          {h}h {m}m of daylight today
        </span>
      </p>
    </footer>
  );
}

const CLOUD = 'M7.5 18.5h9a3.5 3.5 0 0 0 .4-6.98 5 5 0 0 0-9.65-1.2A4.1 4.1 0 0 0 7.5 18.5z';

/** A small line drawing that moves a little: drifting cloud, falling rain, turning sun. */
function WeatherIcon({ icon }: { icon: Icon }) {
  return (
    <svg className="sf-icon" width="18" height="18" viewBox="0 0 24 24" aria-hidden="true">
      {icon === 'sun' && (
        <>
          <circle cx="12" cy="12" r="4" />
          <g className="sf-spin">
            <path d="M12 2.5v2.5M12 19v2.5M2.5 12H5M19 12h2.5M5.3 5.3l1.8 1.8M16.9 16.9l1.8 1.8M5.3 18.7l1.8-1.8M16.9 7.1l1.8-1.8" />
          </g>
        </>
      )}
      {icon === 'moon' && <path className="sf-drift" d="M19 14.5A7.5 7.5 0 1 1 9.5 5a6 6 0 0 0 9.5 9.5z" />}
      {icon === 'cloud' && (
        <g className="sf-drift">
          <path d={CLOUD} />
        </g>
      )}
      {(icon === 'rain' || icon === 'snow') && (
        <>
          <g transform="translate(0 -3)">
            <g className="sf-drift">
              <path d={CLOUD} />
            </g>
          </g>
          {[9, 12, 15].map((x, i) =>
            icon === 'rain' ? (
              <path key={x} className="sf-fall" style={{ animationDelay: `${i * 0.5}s` }} d={`M${x} 18.5v2`} />
            ) : (
              <circle key={x} className="sf-fall sf-flake" style={{ animationDelay: `${i * 0.55}s` }} cx={x} cy="19.5" r="0.9" />
            ),
          )}
        </>
      )}
    </svg>
  );
}

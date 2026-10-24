// The footer on the home and course pages: today's weather where the reader is. The site's
// edge function (functions/api/weather.ts) estimates the place from the request itself, so the
// reader is never asked for their location and nothing about them is stored. If there's no
// estimate, or the request fails, the footer simply isn't shown.

import { useEffect, useState } from 'react';

type Icon = 'sun' | 'moon' | 'cloud' | 'rain' | 'snow';

export interface Weather {
  place: string;
  temperature: number;
  unit: 'F' | 'C';
  /** "cloudy", "raining", "clear"… */
  sky: string;
  icon: Icon;
  daylightMinutes: number;
}

function isWeather(d: unknown): d is Weather {
  const w = d as Weather | null;
  return !!w && typeof w.place === 'string' && typeof w.temperature === 'number' && typeof w.sky === 'string' && typeof w.daylightMinutes === 'number';
}

export function SiteFooter() {
  const [weather, setWeather] = useState<Weather | null>(null);

  useEffect(() => {
    const ctrl = new AbortController();
    fetch('api/weather', { signal: ctrl.signal })
      .then((r) => (r.ok ? r.json() : null))
      .then((d: unknown) => {
        if (isWeather(d)) setWeather(d);
      })
      .catch(() => {});
    return () => ctrl.abort();
  }, []);

  if (!weather) return null;
  const h = Math.floor(weather.daylightMinutes / 60);
  const m = weather.daylightMinutes % 60;

  return (
    <footer className="sf">
      <p>
        <WeatherIcon icon={weather.icon} />
        <span>
          {Math.round(weather.temperature)}°{weather.unit} and {weather.sky} in{' '}
          <a href="https://open-meteo.com/" target="_blank" rel="noopener" title="Weather by Open-Meteo">
            {weather.place}
          </a>
        </span>
        <span aria-hidden="true">·</span>
        <span>
          {h}h {m}m of daylight
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

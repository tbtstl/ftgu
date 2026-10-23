// Number formatting used in readouts, labels and prose. Minus signs are typographic (−).

const MINUS = '−';

function sign(x: number, s: string): string {
  return x < 0 ? MINUS + s : s;
}

/** Fixed decimals with thousands separators: fmt(1234.5, 1) → "1,234.5". */
export function fmt(x: number, digits = 0): string {
  if (!Number.isFinite(x)) return '—';
  const s = Math.abs(x).toLocaleString('en-US', { minimumFractionDigits: digits, maximumFractionDigits: digits });
  return sign(Math.round(x * 10 ** digits) === 0 ? 0 : x, s);
}

/** Money: usd(1234) → "$1,234", usd(-5.5, 2) → "−$5.50". */
export function usd(x: number, digits = 0): string {
  if (!Number.isFinite(x)) return '—';
  const s = '$' + Math.abs(x).toLocaleString('en-US', { minimumFractionDigits: digits, maximumFractionDigits: digits });
  return sign(Math.round(x * 10 ** digits) === 0 ? 0 : x, s);
}

/** Price per MWh: price(46) → "$46/MWh". */
export function price(x: number, digits = 0): string {
  return usd(x, digits) + '/MWh';
}

/** Units: mw(1250) → "1,250 MW". */
export function mw(x: number, digits = 0): string {
  return fmt(x, digits) + ' MW';
}

export function mwh(x: number, digits = 0): string {
  return fmt(x, digits) + ' MWh';
}

export function kw(x: number, digits = 1): string {
  return fmt(x, digits) + ' kW';
}

export function kwh(x: number, digits = 1): string {
  return fmt(x, digits) + ' kWh';
}

export function pct(x: number, digits = 0): string {
  return fmt(x * 100, digits) + '%';
}

/** Signed with an explicit plus: signed(3) → "+3", signed(-3) → "−3". */
export function signed(x: number, digits = 0): string {
  const s = fmt(x, digits);
  return x > 0 && Math.round(x * 10 ** digits) !== 0 ? '+' + s : s;
}

/** Hour of day as "07:00"; fractional hours become minutes. */
export function hour(h: number): string {
  const hh = Math.floor(((h % 24) + 24) % 24);
  const mm = Math.round((h - Math.floor(h)) * 60);
  return String(hh).padStart(2, '0') + ':' + String(mm === 60 ? 0 : mm).padStart(2, '0');
}

/** Engineering-style SI formatting for physics lessons: si(0.0123, 'A') → "12.3 mA". */
export function si(x: number, unit: string, digits = 3): string {
  if (!Number.isFinite(x)) return '—';
  if (x === 0) return '0 ' + unit;
  const prefixes: Array<[number, string]> = [
    [1e9, 'G'],
    [1e6, 'M'],
    [1e3, 'k'],
    [1, ''],
    [1e-3, 'm'],
    [1e-6, 'µ'],
  ];
  const a = Math.abs(x);
  const [scale, p] = prefixes.find(([s]) => a >= s) ?? prefixes[prefixes.length - 1];
  const v = x / scale;
  const decimals = Math.max(0, digits - 1 - Math.floor(Math.log10(Math.abs(v)) + 1e-9));
  return fmt(v, Math.min(decimals, 3)) + ' ' + p + unit;
}

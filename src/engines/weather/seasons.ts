// The seasons: how Earth's tilted axis sets the Sun's noon height, the length of the day and the
// day's sunlight at each latitude through the year. The orbit is treated as a circle (its slight
// eccentricity, which makes early January's sunlight about 7% stronger than early July's, is
// ignored), and sunrise and sunset are taken when the Sun's center crosses a flat horizon.

/** Tilt of Earth's axis from upright to the plane of its orbit, degrees. */
export const AXIAL_TILT_DEG = 23.44;
/** Sunlight arriving at the top of the atmosphere, facing the Sun, W/m². */
export const SOLAR_CONSTANT = 1361;
/** Day of the year (0 = January 1) of the March equinox in this approximation; as in the station engine. */
const EQUINOX_DOY = 80;

const RAD = Math.PI / 180;

/** The Sun's declination: the latitude where it stands overhead at noon on a day of the year (0 = January 1), degrees. */
export function declination(doy: number, tilt = AXIAL_TILT_DEG): number {
  return tilt * Math.sin((2 * Math.PI * (doy - EQUINOX_DOY)) / 365);
}

/** Half the day's arc of the Sun, from noon to sunset, radians (0 in polar night, π in midnight sun). */
function halfDayAngle(latDeg: number, decDeg: number): number {
  const c = -Math.tan(latDeg * RAD) * Math.tan(decDeg * RAD);
  if (c >= 1) return 0;
  if (c <= -1) return Math.PI;
  return Math.acos(c);
}

/** Hours from sunrise to sunset at a latitude (degrees north) on a day of the year. */
export function dayLengthHours(latDeg: number, doy: number, tilt = AXIAL_TILT_DEG): number {
  return (24 * halfDayAngle(latDeg, declination(doy, tilt))) / Math.PI;
}

/** The noon Sun's height above the horizon, degrees (negative when it stays below the horizon all day). */
export function noonSunHeightDeg(latDeg: number, doy: number, tilt = AXIAL_TILT_DEG): number {
  return 90 - Math.abs(latDeg - declination(doy, tilt));
}

/**
 * Sunlight reaching the top of the atmosphere on a day, averaged over all 24 hours, W/m²:
 * (S/π)·(h₀·sin φ·sin δ + cos φ·cos δ·sin h₀), with h₀ the half-day angle.
 */
export function dailySunlight(latDeg: number, doy: number, tilt = AXIAL_TILT_DEG, solar = SOLAR_CONSTANT): number {
  const dec = declination(doy, tilt);
  const h0 = halfDayAngle(latDeg, dec);
  const p = latDeg * RAD;
  const d = dec * RAD;
  return Math.max(0, (solar / Math.PI) * (h0 * Math.sin(p) * Math.sin(d) + Math.cos(p) * Math.cos(d) * Math.sin(h0)));
}

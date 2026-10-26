// Planetary energy balance: a zero-dimensional planet with a single absorbing atmospheric layer,
// and a one-dimensional energy-balance model by latitude (after North, 1975) in which a diffusive
// heat transport carries the tropics' surplus toward the poles.

/** Stefan–Boltzmann constant, W m⁻² K⁻⁴. */
export const SIGMA = 5.670374419e-8;
/** Sunlight arriving at Earth's distance from the Sun, W/m². */
export const SOLAR_CONSTANT = 1361;
/** The share of sunlight Earth reflects. */
export const EARTH_ALBEDO = 0.3;
/** The single layer's longwave absorptivity that gives Earth's observed 288 K. */
export const EARTH_ABSORPTIVITY = 0.78;
export const EARTH_RADIUS_M = 6.371e6;
export const K0 = 273.15;

export interface PlanetInput {
  /** Sunlight at the planet's distance, W/m². */
  solar: number;
  /** Share of sunlight reflected, 0–1. */
  albedo: number;
  /** Share of the surface's infrared the atmosphere absorbs, 0–1. */
  absorptivity: number;
}

/** Every flux in the single-layer model, W/m² averaged over the whole sphere, and its temperatures. */
export interface PlanetBalance {
  /** Sunlight per square meter of the sphere: a quarter of the solar constant. */
  incoming: number;
  reflected: number;
  absorbed: number;
  /** Temperature a planet with no absorbing atmosphere would settle at, K. */
  effectiveK: number;
  surfaceK: number;
  atmosphereK: number;
  /** σT⁴ from the surface. */
  surfaceEmission: number;
  /** Infrared the atmosphere sends back down. */
  backRadiation: number;
  /** Surface infrared that passes straight through the atmosphere to space. */
  windowFlux: number;
  /** Infrared the atmosphere sends up. */
  atmosphereUp: number;
  /** Outgoing longwave radiation at the top: window plus atmosphere. Equals `absorbed` in equilibrium. */
  olr: number;
}

/** Temperature of a bare planet that absorbs `(1 − albedo) · solar / 4` and radiates as a black body, K. */
export function effectiveTemperature(solar: number, albedo: number): number {
  return Math.pow((solar * (1 - albedo)) / (4 * SIGMA), 0.25);
}

/**
 * The single-layer greenhouse in equilibrium. The atmosphere absorbs a share ε of the surface's
 * infrared and emits εσTa⁴ both up and down; balance at the top and in the layer gives
 * Ts⁴ = Te⁴ · 2 / (2 − ε) and Ta⁴ = Ts⁴ / 2.
 */
export function planetBalance(p: PlanetInput): PlanetBalance {
  const incoming = p.solar / 4;
  const reflected = incoming * p.albedo;
  const absorbed = incoming - reflected;
  const effectiveK = effectiveTemperature(p.solar, p.albedo);
  const e = Math.max(0, Math.min(1, p.absorptivity));
  const surfaceK = effectiveK * Math.pow(2 / (2 - e), 0.25);
  const atmosphereK = surfaceK / Math.pow(2, 0.25);
  const surfaceEmission = SIGMA * surfaceK ** 4;
  const atmosphereEmission = e * SIGMA * atmosphereK ** 4;
  const windowFlux = (1 - e) * surfaceEmission;
  return {
    incoming,
    reflected,
    absorbed,
    effectiveK,
    surfaceK,
    atmosphereK,
    surfaceEmission,
    backRadiation: atmosphereEmission,
    windowFlux,
    atmosphereUp: atmosphereEmission,
    olr: windowFlux + atmosphereEmission,
  };
}

/**
 * Energy imbalance at the top of the atmosphere if the surface is held at `surfaceK` while the
 * inputs change, W/m²: absorbed sunlight minus outgoing infrared. Positive means the planet is
 * gaining energy and will warm.
 */
export function imbalanceAt(p: PlanetInput, surfaceK: number): number {
  const absorbed = (p.solar / 4) * (1 - p.albedo);
  const olr = SIGMA * surfaceK ** 4 * (1 - p.absorptivity / 2);
  return absorbed - olr;
}

// ---------------------------------------------------------------------------
// Energy balance by latitude.

/** Annual-mean sunlight by latitude relative to the global mean: 1 + s₂P₂(sin φ), with s₂ = −0.482. */
export function insolationShape(x: number): number {
  return 1 - 0.482 * p2(x);
}

/** Albedo by latitude: brighter toward the poles, where snow, ice and low sun reflect more. */
export function albedoAt(x: number): number {
  return 0.354 + 0.25 * p2(x);
}

function p2(x: number) {
  return (3 * x * x - 1) / 2;
}

/** Outgoing infrared as a straight line in surface temperature: A + B·T (T in °C), W/m². */
export const OLR_B = 2.09;
/**
 * Chosen so the global mean comes out at 15 °C with today's sunlight, matching the single-layer
 * model's 288 K.
 */
export const OLR_A = (() => {
  const q = SOLAR_CONSTANT / 4;
  // Area-weighted mean of s(x)(1 − α(x)) over x = sin φ from 0 to 1.
  const n = 2000;
  let sum = 0;
  for (let i = 0; i < n; i++) {
    const x = (i + 0.5) / n;
    sum += insolationShape(x) * (1 - albedoAt(x));
  }
  return q * (sum / n) - OLR_B * 15;
})();

export interface LatitudeBalance {
  /** Band centers, degrees latitude (0 to 90). */
  lat: number[];
  /** Equilibrium surface temperature, °C. */
  temp: number[];
  /** Sunlight absorbed, W/m². */
  absorbed: number[];
  /** Infrared emitted, W/m². */
  olr: number[];
  /** Latitudes of the band edges where `transportPW` is given. */
  edgeLat: number[];
  /** Heat carried poleward across each latitude circle, petawatts (10¹⁵ W). */
  transportPW: number[];
  equatorC: number;
  poleC: number;
  globalMeanC: number;
  peakTransportPW: number;
  peakLat: number;
  /** Latitude where absorbed sunlight equals emitted infrared. */
  balanceLat: number;
}

/**
 * The diffusive energy-balance model in equilibrium:
 *   Q·s(x)·(1 − α(x)) − (A + B·T) + d/dx[D·(1 − x²)·dT/dx] = 0,  x = sin φ,
 * solved on one hemisphere with no flux across the equator or the pole. `transport` is D in
 * W m⁻² K⁻¹: 0 leaves each latitude to balance on its own.
 */
export function latitudeBalance(transport: number, solar = SOLAR_CONSTANT, bands = 90): LatitudeBalance {
  const q = solar / 4;
  const n = bands;
  const dx = 1 / n;
  const x = Array.from({ length: n }, (_, i) => (i + 0.5) * dx);
  const src = x.map((xi) => q * insolationShape(xi) * (1 - albedoAt(xi)));
  // Face diffusivities D(1 − x²) at x = i·dx, i = 0..n (zero flux at both ends).
  const face = Array.from({ length: n + 1 }, (_, i) => (i === 0 || i === n ? 0 : transport * (1 - (i * dx) ** 2)));
  // Tridiagonal system: −a_i T_{i−1} + b_i T_i − c_i T_{i+1} = src_i − A
  const a = new Float64Array(n);
  const b = new Float64Array(n);
  const c = new Float64Array(n);
  const d = new Float64Array(n);
  for (let i = 0; i < n; i++) {
    a[i] = face[i] / (dx * dx);
    c[i] = face[i + 1] / (dx * dx);
    b[i] = OLR_B + a[i] + c[i];
    d[i] = src[i] - OLR_A;
  }
  // Thomas algorithm.
  const cp = new Float64Array(n);
  const dp = new Float64Array(n);
  cp[0] = c[0] / b[0];
  dp[0] = d[0] / b[0];
  for (let i = 1; i < n; i++) {
    const m = b[i] - a[i] * cp[i - 1];
    cp[i] = c[i] / m;
    dp[i] = (d[i] + a[i] * dp[i - 1]) / m;
  }
  const T = new Array<number>(n);
  T[n - 1] = dp[n - 1];
  for (let i = n - 2; i >= 0; i--) T[i] = dp[i] + cp[i] * T[i + 1];

  const olr = T.map((t) => OLR_A + OLR_B * t);
  const lat = x.map((xi) => (Math.asin(xi) * 180) / Math.PI);
  // Poleward transport across each interior face, W: −2πR²·D(1 − x²)·dT/dx.
  const edgeLat: number[] = [];
  const transportPW: number[] = [];
  for (let i = 0; i <= n; i++) {
    const xf = i * dx;
    edgeLat.push((Math.asin(xf) * 180) / Math.PI);
    if (i === 0 || i === n) {
      transportPW.push(0);
      continue;
    }
    const grad = (T[i] - T[i - 1]) / dx;
    transportPW.push((-2 * Math.PI * EARTH_RADIUS_M ** 2 * face[i] * grad) / 1e15);
  }
  let peak = 0;
  for (let i = 1; i < transportPW.length; i++) if (transportPW[i] > transportPW[peak]) peak = i;
  const mean = T.reduce((s, t) => s + t, 0) / n;
  // Where the absorbed sunlight drops below the infrared emitted.
  let balanceLat = 90;
  for (let i = 1; i < n; i++) {
    const f0 = src[i - 1] - olr[i - 1];
    const f1 = src[i] - olr[i];
    if (f0 >= 0 && f1 < 0) {
      balanceLat = lat[i - 1] + ((lat[i] - lat[i - 1]) * f0) / (f0 - f1);
      break;
    }
  }
  return {
    lat,
    temp: T,
    absorbed: src,
    olr,
    edgeLat,
    transportPW,
    // The bands nearest the equator and the pole.
    equatorC: T[0],
    poleC: T[n - 1],
    globalMeanC: mean,
    peakTransportPW: transportPW[peak],
    peakLat: edgeLat[peak],
    balanceLat,
  };
}

/** A balance's temperature at any latitude, interpolated between band centers, °C. */
export function tempAtLatitude(bal: LatitudeBalance, latDeg: number): number {
  const n = bal.temp.length;
  const i = Math.sin((Math.abs(latDeg) * Math.PI) / 180) * n - 0.5;
  if (i <= 0) return bal.temp[0];
  if (i >= n - 1) return bal.temp[n - 1];
  const lo = Math.floor(i);
  return bal.temp[lo] + (bal.temp[lo + 1] - bal.temp[lo]) * (i - lo);
}

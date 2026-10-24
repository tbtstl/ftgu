// The shipping course's world map: real ports and chokepoints at their real positions, joined by
// stylized sea lanes. Distances are great-circle lengths along each lane's waypoints, so they come
// out close to published port-to-port distances (within a few percent) without claiming to be them.
//
// The map is an equirectangular projection from 100°W to 160°E and from 62°N to 46°S. The one lane
// that crosses the Pacific, Panama to Japan, leaves the map's left edge and re-enters on the right.

export const EARTH_NM = 3440.065;

export interface Place {
  id: string;
  name: string;
  /** Country or area, for labels. */
  area: string;
  lat: number;
  lon: number;
  /** A cargo port (true) or a waypoint on a lane (false). */
  port: boolean;
  /** Label placement on the map. */
  label?: 'n' | 's' | 'e' | 'w' | 'ne' | 'nw' | 'se' | 'sw';
}

export const PLACES: Place[] = [
  // Cargo ports.
  { id: 'TUB', name: 'Tubarão', area: 'Brazil', lat: -20.29, lon: -40.24, port: true, label: 'e' },
  { id: 'SAN', name: 'Santos', area: 'Brazil', lat: -23.98, lon: -46.3, port: true, label: 'sw' },
  { id: 'NOL', name: 'New Orleans', area: 'US Gulf', lat: 29.0, lon: -89.4, port: true, label: 'n' },
  { id: 'ROT', name: 'Rotterdam', area: 'Netherlands', lat: 51.95, lon: 4.05, port: true, label: 'ne' },
  { id: 'RBY', name: 'Richards Bay', area: 'South Africa', lat: -28.8, lon: 32.1, port: true, label: 'e' },
  { id: 'PHE', name: 'Port Hedland', area: 'Australia', lat: -20.3, lon: 118.6, port: true, label: 'sw' },
  { id: 'NEW', name: 'Newcastle', area: 'Australia', lat: -32.9, lon: 151.8, port: true, label: 'sw' },
  { id: 'SAM', name: 'Samarinda', area: 'Indonesia', lat: -0.5, lon: 117.2, port: true, label: 'e' },
  { id: 'PAR', name: 'Paradip', area: 'India', lat: 20.26, lon: 86.67, port: true, label: 'n' },
  { id: 'QIN', name: 'Qingdao', area: 'China', lat: 36.07, lon: 120.32, port: true, label: 'nw' },
  { id: 'RTA', name: 'Ras Tanura', area: 'Saudi Arabia', lat: 26.64, lon: 50.16, port: true, label: 'w' },
  { id: 'SIN', name: 'Singapore', area: 'Singapore', lat: 1.26, lon: 103.84, port: true, label: 's' },
  // Waypoints and chokepoints.
  { id: 'USH', name: 'Off Ushant', area: 'France', lat: 48.6, lon: -5.8, port: false },
  { id: 'FIN', name: 'Off Finisterre', area: 'Spain', lat: 43.0, lon: -9.9, port: false },
  { id: 'GIB', name: 'Strait of Gibraltar', area: '', lat: 35.95, lon: -5.6, port: false },
  { id: 'CVD', name: 'Off Cape Verde', area: 'Senegal', lat: 14.7, lon: -18.5, port: false },
  { id: 'SRQ', name: 'Off Cabo São Roque', area: 'Brazil', lat: -5.2, lon: -34.3, port: false },
  { id: 'FLS', name: 'Florida Strait', area: '', lat: 24.2, lon: -81.0, port: false },
  { id: 'ATL', name: 'Mid-Atlantic', area: '', lat: 33.0, lon: -60.0, port: false },
  { id: 'YUC', name: 'Yucatán Channel', area: '', lat: 21.8, lon: -85.8, port: false },
  { id: 'COL', name: 'Colón', area: 'Panama', lat: 9.4, lon: -79.9, port: false },
  { id: 'BAL', name: 'Balboa', area: 'Panama', lat: 8.9, lon: -79.5, port: false },
  { id: 'CGH', name: 'Cape of Good Hope', area: 'South Africa', lat: -35.3, lon: 18.5, port: false },
  { id: 'PSD', name: 'Port Said', area: 'Egypt', lat: 31.4, lon: 32.35, port: false },
  { id: 'SUZ', name: 'Suez', area: 'Egypt', lat: 29.9, lon: 32.55, port: false },
  { id: 'BAB', name: 'Bab el-Mandeb', area: '', lat: 12.6, lon: 43.4, port: false },
  { id: 'ADN', name: 'Gulf of Aden', area: '', lat: 12.3, lon: 51.5, port: false },
  { id: 'HRM', name: 'Strait of Hormuz', area: '', lat: 26.4, lon: 56.6, port: false },
  { id: 'ARB', name: 'Arabian Sea', area: '', lat: 14.0, lon: 62.0, port: false },
  { id: 'DON', name: 'Off Sri Lanka', area: 'Sri Lanka', lat: 5.6, lon: 80.6, port: false },
  { id: 'MAN', name: 'Malacca Strait, north', area: '', lat: 5.8, lon: 95.6, port: false },
  { id: 'SUN', name: 'Sunda Strait', area: 'Indonesia', lat: -6.0, lon: 105.8, port: false },
  { id: 'LOM', name: 'Lombok Strait', area: 'Indonesia', lat: -8.9, lon: 115.75, port: false },
  { id: 'JAV', name: 'Java Sea', area: '', lat: -5.0, lon: 111.0, port: false },
  { id: 'KAR', name: 'Karimata Strait', area: 'Indonesia', lat: -2.0, lon: 108.6, port: false },
  { id: 'MAK', name: 'Makassar Strait', area: 'Indonesia', lat: -2.6, lon: 118.0, port: false },
  { id: 'CEL', name: 'Celebes Sea', area: '', lat: 3.5, lon: 124.6, port: false },
  { id: 'PHS', name: 'Philippine Sea', area: '', lat: 12.0, lon: 127.0, port: false },
  { id: 'SCS', name: 'South China Sea', area: '', lat: 10.0, lon: 111.0, port: false },
  { id: 'TWS', name: 'Taiwan Strait', area: '', lat: 24.0, lon: 119.6, port: false },
  { id: 'ECS', name: 'East China Sea', area: '', lat: 31.0, lon: 124.0, port: false },
  { id: 'LUZ', name: 'East of Luzon', area: '', lat: 20.5, lon: 123.2, port: false },
  { id: 'KYU', name: 'South of Kyushu', area: 'Japan', lat: 30.5, lon: 131.0, port: false },
  { id: 'JPN', name: 'Off Tokyo Bay', area: 'Japan', lat: 34.0, lon: 140.5, port: false },
  { id: 'SOL', name: 'Coral Sea', area: '', lat: -15.0, lon: 156.0, port: false },
  { id: 'BIS', name: 'Bismarck Sea', area: '', lat: -2.0, lon: 150.5, port: false },
  { id: 'MIC', name: 'Western Pacific', area: '', lat: 7.0, lon: 137.0, port: false },
  { id: 'BAS', name: 'Off Bass Strait', area: 'Australia', lat: -39.8, lon: 148.5, port: false },
  { id: 'LEU', name: 'Off Cape Leeuwin', area: 'Australia', lat: -35.8, lon: 114.5, port: false },
  { id: 'SPA', name: 'South Pacific', area: '', lat: -20.0, lon: -120.0, port: false },
];

export const PLACE: Record<string, Place> = Object.fromEntries(PLACES.map((p) => [p.id, p]));

/** Chokepoints a lane can pass through; closing one closes every lane that uses it. */
export type Chokepoint = 'suez' | 'redsea' | 'panama' | 'malacca' | 'hormuz' | 'gibraltar' | 'sunda' | 'lombok';

export const CHOKEPOINTS: Record<Chokepoint, { name: string; at: string }> = {
  suez: { name: 'Suez Canal', at: 'SUZ' },
  redsea: { name: 'Bab el-Mandeb and the Red Sea', at: 'BAB' },
  panama: { name: 'Panama Canal', at: 'COL' },
  malacca: { name: 'Strait of Malacca', at: 'MAN' },
  hormuz: { name: 'Strait of Hormuz', at: 'HRM' },
  gibraltar: { name: 'Strait of Gibraltar', at: 'GIB' },
  sunda: { name: 'Sunda Strait', at: 'SUN' },
  lombok: { name: 'Lombok Strait', at: 'LOM' },
};

export interface Lane {
  id: string;
  from: string;
  to: string;
  /** Intermediate points to draw and measure through, [lat, lon]. */
  via?: Array<[number, number]>;
  /** The chokepoint this lane passes, if any. */
  choke?: Chokepoint;
  /** Extra days for a canal transit (including waiting in the anchorage). */
  canalDays?: number;
  /** Draft limit on this lane in its own water, m (for ships too deep to use it). */
  maxDraft?: number;
  /** Drawn across the map edge (the Pacific crossing). */
  wraps?: boolean;
}

export const LANES: Lane[] = [
  // North Atlantic and Europe
  { id: 'ROT-USH', from: 'ROT', to: 'USH', via: [[51.0, 1.5], [50.0, -2.0]] },
  { id: 'USH-FIN', from: 'USH', to: 'FIN' },
  { id: 'FIN-GIB', from: 'FIN', to: 'GIB', via: [[37.0, -9.3]], choke: 'gibraltar' },
  { id: 'FIN-CVD', from: 'FIN', to: 'CVD', via: [[28.0, -16.0]] },
  { id: 'GIB-PSD', from: 'GIB', to: 'PSD', via: [[37.3, 10.0], [34.0, 22.0]], choke: 'gibraltar' },
  { id: 'USH-ATL', from: 'USH', to: 'ATL' },
  { id: 'ATL-FLS', from: 'ATL', to: 'FLS' },
  { id: 'CVD-SRQ', from: 'CVD', to: 'SRQ' },
  { id: 'FLS-SRQ', from: 'FLS', to: 'SRQ', via: [[19.0, -64.0]] },
  { id: 'SRQ-TUB', from: 'SRQ', to: 'TUB', via: [[-13.0, -37.5]] },
  { id: 'TUB-SAN', from: 'TUB', to: 'SAN', via: [[-23.5, -42.0]] },
  { id: 'TUB-CGH', from: 'TUB', to: 'CGH' },
  { id: 'SAN-CGH', from: 'SAN', to: 'CGH' },
  { id: 'SRQ-CGH', from: 'SRQ', to: 'CGH' },
  { id: 'CVD-CGH', from: 'CVD', to: 'CGH', via: [[-5.0, 2.0]] },
  // Gulf of Mexico and Panama
  { id: 'NOL-FLS', from: 'NOL', to: 'FLS', via: [[26.0, -86.0]] },
  { id: 'NOL-YUC', from: 'NOL', to: 'YUC' },
  { id: 'FLS-YUC', from: 'FLS', to: 'YUC', via: [[23.6, -84.5]] },
  { id: 'YUC-COL', from: 'YUC', to: 'COL', via: [[16.0, -82.5]] },
  { id: 'COL-BAL', from: 'COL', to: 'BAL', choke: 'panama', canalDays: 1, maxDraft: 15.24 },
  { id: 'BAL-JPN', from: 'BAL', to: 'JPN', via: [[25.0, -125.0], [36.0, -170.0], [37.0, 165.0]], wraps: true },
  // Africa and the Indian Ocean
  { id: 'CGH-RBY', from: 'CGH', to: 'RBY', via: [[-34.5, 25.0], [-31.5, 30.5]] },
  { id: 'RBY-DON', from: 'RBY', to: 'DON', via: [[-12.0, 52.0]] },
  { id: 'CGH-SUN', from: 'CGH', to: 'SUN', via: [[-28.0, 60.0], [-14.0, 95.0]] },
  { id: 'CGH-LOM', from: 'CGH', to: 'LOM', via: [[-30.0, 60.0], [-18.0, 100.0]] },
  { id: 'RBY-SUN', from: 'RBY', to: 'SUN', via: [[-20.0, 60.0], [-12.0, 95.0]] },
  { id: 'RBY-LOM', from: 'RBY', to: 'LOM', via: [[-22.0, 60.0], [-15.0, 100.0]] },
  { id: 'PSD-SUZ', from: 'PSD', to: 'SUZ', choke: 'suez', canalDays: 1, maxDraft: 20.1 },
  { id: 'SUZ-BAB', from: 'SUZ', to: 'BAB', via: [[27.0, 34.5], [20.0, 38.5]], choke: 'redsea' },
  { id: 'BAB-ADN', from: 'BAB', to: 'ADN', choke: 'redsea' },
  { id: 'ADN-ARB', from: 'ADN', to: 'ARB' },
  { id: 'ADN-DON', from: 'ADN', to: 'DON', via: [[8.5, 66.0]] },
  { id: 'ARB-HRM', from: 'ARB', to: 'HRM', via: [[22.5, 60.5]] },
  { id: 'ADN-HRM', from: 'ADN', to: 'HRM', via: [[14.5, 54.5], [18.0, 57.5], [22.6, 60.0]] },
  { id: 'HRM-RTA', from: 'HRM', to: 'RTA', via: [[26.2, 54.0], [27.0, 51.5]], choke: 'hormuz' },
  { id: 'ARB-DON', from: 'ARB', to: 'DON' },
  { id: 'ARB-CGH', from: 'ARB', to: 'CGH', via: [[-5.0, 56.0], [-26.0, 37.0]] },
  { id: 'DON-PAR', from: 'DON', to: 'PAR', via: [[12.0, 83.5]] },
  { id: 'DON-MAN', from: 'DON', to: 'MAN' },
  { id: 'PAR-MAN', from: 'PAR', to: 'MAN', via: [[12.0, 90.0]] },
  { id: 'MAN-SIN', from: 'MAN', to: 'SIN', via: [[3.6, 99.5], [2.0, 102.0]], choke: 'malacca', maxDraft: 20.5 },
  { id: 'DON-SUN', from: 'DON', to: 'SUN', via: [[-2.0, 95.0]] },
  { id: 'DON-LOM', from: 'DON', to: 'LOM', via: [[-5.0, 100.0]] },
  { id: 'PHE-LOM', from: 'PHE', to: 'LOM', via: [[-15.0, 117.0]] },
  { id: 'PHE-SUN', from: 'PHE', to: 'SUN', via: [[-13.0, 110.0]] },
  // Indonesia and the South China Sea
  { id: 'SUN-KAR', from: 'SUN', to: 'KAR', via: [[-5.0, 106.5]], choke: 'sunda', maxDraft: 20 },
  { id: 'SUN-JAV', from: 'SUN', to: 'JAV', choke: 'sunda', maxDraft: 20 },
  { id: 'JAV-KAR', from: 'JAV', to: 'KAR', maxDraft: 20 },
  { id: 'JAV-MAK', from: 'JAV', to: 'MAK', via: [[-5.0, 116.5]] },
  { id: 'LOM-MAK', from: 'LOM', to: 'MAK', via: [[-6.0, 117.0]], choke: 'lombok' },
  { id: 'LOM-JAV', from: 'LOM', to: 'JAV', choke: 'lombok' },
  { id: 'KAR-SIN', from: 'KAR', to: 'SIN', via: [[0.5, 106.0]] },
  { id: 'KAR-SCS', from: 'KAR', to: 'SCS', via: [[3.0, 108.0]] },
  { id: 'SIN-SCS', from: 'SIN', to: 'SCS', via: [[4.5, 106.5]] },
  { id: 'MAK-SAM', from: 'MAK', to: 'SAM' },
  { id: 'SAM-CEL', from: 'SAM', to: 'CEL', via: [[1.5, 119.5]] },
  { id: 'MAK-CEL', from: 'MAK', to: 'CEL', via: [[0.5, 119.0]] },
  { id: 'SAM-TWS', from: 'SAM', to: 'TWS', via: [[1.5, 119.3], [5.0, 119.6], [8.5, 120.0], [12.5, 120.4], [17.0, 119.3]], maxDraft: 15 },
  { id: 'CEL-PHS', from: 'CEL', to: 'PHS', via: [[5.5, 126.6]] },
  { id: 'PHS-LUZ', from: 'PHS', to: 'LUZ' },
  { id: 'SCS-TWS', from: 'SCS', to: 'TWS', via: [[18.0, 115.5]] },
  { id: 'TWS-ECS', from: 'TWS', to: 'ECS', via: [[27.5, 122.0]] },
  { id: 'LUZ-ECS', from: 'LUZ', to: 'ECS', via: [[26.0, 125.0]] },
  { id: 'ECS-QIN', from: 'ECS', to: 'QIN', via: [[34.0, 123.0]] },
  { id: 'KYU-ECS', from: 'KYU', to: 'ECS' },
  { id: 'JPN-KYU', from: 'JPN', to: 'KYU', via: [[32.5, 135.0]] },
  { id: 'LUZ-JPN', from: 'LUZ', to: 'JPN', via: [[28.0, 134.0]] },
  // Western Pacific and eastern Australia
  { id: 'NEW-SOL', from: 'NEW', to: 'SOL', via: [[-26.0, 155.0]] },
  { id: 'SOL-BIS', from: 'SOL', to: 'BIS', via: [[-9.0, 153.5]] },
  { id: 'BIS-MIC', from: 'BIS', to: 'MIC' },
  { id: 'MIC-PHS', from: 'MIC', to: 'PHS' },
  { id: 'MIC-LUZ', from: 'MIC', to: 'LUZ' },
  { id: 'MIC-ECS', from: 'MIC', to: 'ECS', via: [[22.0, 129.0]] },
  // Southern Australia and the South Pacific
  { id: 'NEW-BAS', from: 'NEW', to: 'BAS', via: [[-36.5, 151.0]] },
  { id: 'BAS-LEU', from: 'BAS', to: 'LEU', via: [[-39.8, 143.0], [-37.5, 136.0], [-35.5, 125.0]] },
  { id: 'LEU-SUN', from: 'LEU', to: 'SUN', via: [[-25.0, 110.5]] },
  { id: 'LEU-LOM', from: 'LEU', to: 'LOM', via: [[-22.0, 112.5]] },
  { id: 'LEU-CGH', from: 'LEU', to: 'CGH', via: [[-37.0, 80.0], [-37.0, 40.0]] },
  { id: 'BAL-SPA', from: 'BAL', to: 'SPA' },
  { id: 'SPA-NEW', from: 'SPA', to: 'NEW', via: [[-28.0, -160.0], [-32.0, 175.0]], wraps: true },
];

// ---------------------------------------------------------------------------
// Geometry.

const RAD = Math.PI / 180;

/** Great-circle distance between two points, nautical miles. */
export function greatCircleNm(a: [number, number], b: [number, number]): number {
  const [la1, lo1] = [a[0] * RAD, a[1] * RAD];
  const [la2, lo2] = [b[0] * RAD, b[1] * RAD];
  const h = Math.sin((la2 - la1) / 2) ** 2 + Math.cos(la1) * Math.cos(la2) * Math.sin((lo2 - lo1) / 2) ** 2;
  return 2 * EARTH_NM * Math.asin(Math.min(1, Math.sqrt(h)));
}

/** The lane's points from end to end, [lat, lon]. */
export function lanePoints(l: Lane): Array<[number, number]> {
  const a = PLACE[l.from];
  const b = PLACE[l.to];
  return [[a.lat, a.lon], ...(l.via ?? []), [b.lat, b.lon]];
}

/** Length of a lane along its points, nautical miles. */
export function laneNm(l: Lane): number {
  const pts = lanePoints(l);
  let d = 0;
  for (let i = 1; i < pts.length; i++) d += greatCircleNm(pts[i - 1], pts[i]);
  return d;
}

// ---------------------------------------------------------------------------
// Map projection.

export const MAP = { lon0: -100, lon1: 160, lat0: 62, lat1: -46, width: 640 };
export const MAP_HEIGHT = (MAP.width * (MAP.lat0 - MAP.lat1)) / (MAP.lon1 - MAP.lon0);

/** Project [lat, lon] to map x, y (in a 640-wide box). */
export function project(lat: number, lon: number, width = MAP.width): [number, number] {
  const k = width / (MAP.lon1 - MAP.lon0);
  return [(lon - MAP.lon0) * k, (MAP.lat0 - lat) * k];
}

/** Coarse coastlines as [lon, lat] rings, enough to recognize the continents at this scale. */
export const LAND: Array<Array<[number, number]>> = [
  // North and Central America
  [
    [-130, 70], [-130, 55], [-124, 48], [-124, 40], [-118, 34], [-110, 23], [-105, 20], [-97, 16], [-92, 14.5], [-87, 13], [-83.5, 9.5], [-79.5, 8.6], [-77.3, 7.8],
    [-77.5, 9.2], [-79.6, 9.6], [-81.5, 9], [-83.5, 10.5], [-83.5, 15], [-88, 15.8], [-88.3, 18.5], [-87.3, 21.5], [-90.4, 21.2], [-91, 18.8], [-94.5, 18.2],
    [-97.2, 21.5], [-97.4, 26], [-96.6, 28.3], [-94.5, 29.4], [-91.5, 29.4], [-89.8, 29.2], [-89, 30.2], [-86.5, 30.4], [-84, 30], [-82.8, 28], [-81.7, 25.9],
    [-80.4, 25.2], [-80.1, 26.7], [-81.3, 30.5], [-80.6, 32.3], [-76.5, 34.7], [-76, 37], [-74, 40.5], [-70.2, 41.7], [-70, 43.7], [-66.9, 44.8], [-64, 46],
    [-60, 46.5], [-55.5, 51.5], [-60, 55.5], [-64.5, 60.5], [-70, 62.5], [-78, 63], [-82, 58], [-90, 57.5], [-95, 60], [-95, 70],
  ],
  // South America
  [
    [-77.3, 7.8], [-75.5, 10.6], [-72, 12], [-68, 10.5], [-63, 10.7], [-60, 8.5], [-56, 5.8], [-52, 4.8], [-50.5, 1.8], [-49, -0.5], [-44.5, -2.6], [-40, -2.8],
    [-37, -4.8], [-35.2, -5.5], [-34.8, -8], [-35.8, -9.8], [-38.5, -13], [-39, -17.5], [-40.3, -20.3], [-41, -22], [-44, -23], [-46.5, -24], [-48.5, -26],
    [-48.6, -28.5], [-50.5, -30.5], [-53, -33.7], [-56, -34.8], [-57.5, -38], [-62, -39], [-65, -41.5], [-67, -46], [-69, -51], [-68.5, -55], [-72, -54],
    [-75, -50], [-73.6, -42], [-71.6, -32], [-70.5, -23], [-70.2, -18.3], [-76, -14], [-81, -5.5], [-80, -2], [-80.1, 1], [-78.5, 3.5], [-77.5, 6.5],
  ],
  // Africa
  [
    [-17, 21], [-17.4, 14.7], [-15, 11], [-13.2, 8.5], [-10, 5.7], [-7.5, 4.4], [-3, 5], [1, 6], [5, 6], [8.5, 4.5], [9.6, 3], [9.4, 0.5], [11.8, -5],
    [12.3, -6], [13.4, -9], [12.6, -13], [11.8, -17], [14.5, -23], [15.2, -27], [16.5, -29], [18.4, -34.2], [20, -34.8], [22.5, -34], [25.6, -34], [28, -32.7],
    [30.5, -30.6], [32.4, -28.6], [32.9, -26], [35.5, -24], [35.2, -21.3], [36.5, -19], [40.5, -15], [40.5, -10.5], [39.5, -6.5], [39.2, -4.5], [41, -2],
    [43.5, 1], [46, 2.5], [49, 6], [51.2, 11.6], [48, 11.2], [45, 10.5], [43.3, 11.6], [42.5, 13], [41, 15], [39, 18], [37.3, 21.5], [35.5, 24], [33.8, 27.3],
    [32.6, 29.9], [32.3, 31.2], [30, 31.3], [25, 31.6], [20, 32], [19.5, 30.5], [15.5, 31.5], [11, 33.2], [10.2, 36.8], [8.5, 36.9], [3, 36.8], [-1, 35.7],
    [-5.6, 35.9], [-6.6, 34], [-9.5, 32], [-9.8, 29.5], [-13, 27.5], [-16, 24],
  ],
  // Madagascar
  [[49.3, -12], [50.5, -15.5], [49.5, -17.5], [47.5, -25], [45, -25.5], [43.5, -22], [44, -17], [47, -15], [48.3, -13.3]],
  // Europe and Asia
  [
    [-9, 43.2], [-9.3, 40], [-8.9, 37], [-6.3, 36.8], [-5.6, 36.1], [-2, 36.7], [0, 38.5], [3, 42], [3.2, 43.2], [6, 43], [8.5, 44.3], [10.5, 43], [12.5, 41.5],
    [15.6, 38], [16.5, 38.5], [18.5, 40.2], [16, 41.5], [13.5, 45.5], [19.5, 41.5], [20, 39.5], [22.5, 36.5], [24, 38], [26, 40], [29, 41], [36, 41.5],
    [41, 41], [36, 36.5], [35.1, 33], [34.3, 31.3], [32.7, 31.1], [32.7, 29.9], [34.2, 27.8], [35, 29.5], [35, 28], [39, 22], [42.5, 15], [43.5, 12.7],
    [45, 12.8], [52, 15.5], [57, 18.5], [59.8, 22.5], [56.4, 26.4], [56.1, 26], [54, 24.2], [51.6, 24.5], [51.2, 26.1], [50.2, 26.2], [49.7, 26.8],
    [48.2, 29.4], [50.1, 30.2], [51.5, 27.9], [54.5, 26.6], [56.8, 27.1], [57.4, 25.7], [61.5, 25.2], [66.5, 25.3], [68, 23.7], [70.5, 21], [72.8, 19],
    [73.5, 16], [74.5, 13], [76.5, 8.7], [77.5, 8], [78.2, 9], [79.8, 10.3], [80.3, 13], [81, 15.5], [82.3, 17], [85, 19.3], [86.7, 20.1], [87, 21.5],
    [88.5, 22], [90, 22], [91.5, 22.5], [92, 21], [94, 18.5], [94.5, 16], [97.5, 16.5], [98, 13], [98.5, 9], [98.3, 8], [100.3, 6], [100.4, 4], [101.3, 2.8],
    [103.4, 1.4], [104.2, 1.5], [103.5, 4], [102.5, 6], [101, 7], [100, 9], [99.2, 10.5], [100, 13.5], [101, 12.6], [103, 11], [105, 8.6], [106.8, 10.4],
    [109.2, 11.8], [109, 15], [107, 17], [106, 19.5], [107.8, 21.6], [110, 21], [111, 21.5], [113.5, 22.2], [116.5, 23], [119, 25.5], [120, 26.8],
    [121.5, 28.5], [122, 30.5], [120.8, 32.5], [119.3, 35], [120.5, 36.2], [122.5, 37], [119, 37.3], [118, 38.5], [121, 40.8], [122, 40.4], [121.4, 39],
    [124.3, 40], [125.2, 37.5], [126.5, 34.5], [129.3, 35.2], [129.5, 37.5], [128, 39], [130, 42.5], [133, 42.8], [138, 46], [140.5, 48.5], [141, 52],
    [137, 54], [135, 54.5], [142, 59], [155, 59.5], [163, 62], [180, 65], [180, 75], [5, 75], [5, 62], [6, 58], [8, 57], [8.3, 55.5], [8.5, 53.6], [5, 53.3],
    [4.5, 52], [3, 51.2], [1.5, 50], [-1.5, 48.7], [-4.7, 48], [-1.2, 46.2], [-1.5, 43.5],
  ],
  // Great Britain and Ireland
  [[-5.7, 50], [1.4, 51], [1.7, 52.7], [0, 53.5], [-0.5, 54.5], [-1.5, 55.5], [-2, 57], [-3, 58.6], [-5, 58.6], [-6, 56.5], [-5, 55], [-3, 54.5], [-3, 53.4], [-4.5, 53.3], [-4.2, 52.2], [-5, 51.7], [-3, 51.4], [-4.5, 51]],
  [[-6, 52], [-6, 53.8], [-6.2, 55.2], [-8.5, 55.2], [-10, 54], [-10, 51.6], [-8, 51.6]],
  // Caribbean islands
  [[-84.9, 21.9], [-81, 23.2], [-77, 22.5], [-74.2, 20.2], [-77.5, 19.9], [-80, 21.7], [-83, 21.5]],
  [[-74.4, 18.5], [-72, 19.9], [-68.4, 18.6], [-71, 17.6]],
  // Sri Lanka, Hainan, Taiwan, Japan, the Philippines
  [[79.8, 7], [80, 9.8], [81.8, 7.5], [81.2, 6.2], [80.1, 6]],
  [[108.6, 19], [110.5, 20.1], [111, 19.6], [109.7, 18.2]],
  [[120.1, 23], [120.7, 22], [121.8, 24.5], [121.5, 25.3], [120.2, 24.3]],
  [[130.2, 31.3], [131.5, 31.3], [132, 33.5], [135, 33.5], [136.8, 34.4], [139.8, 35], [140.9, 36], [141, 38.5], [142, 40], [141.5, 41.5], [140, 41.5], [139.8, 39.5], [139, 37.8], [136.8, 37.2], [135.5, 35.6], [132.5, 35.4], [130.9, 34], [129.6, 33.2]],
  [[141.5, 42], [143.5, 42], [145.5, 43.3], [144.5, 44.5], [141.8, 45.5], [140.3, 43.3]],
  [[120.5, 18.5], [122.3, 18.3], [122.2, 16], [124, 13.2], [123.2, 12.8], [121.5, 13.8], [120.6, 14.4], [119.8, 16.2], [120.3, 17]],
  [[122, 7], [126.5, 7], [126.4, 9.5], [125.5, 9.2], [123.5, 8.6]],
  [[122.4, 10.5], [125.8, 11.2], [125, 12.5], [123.5, 12.2], [121.9, 11.7]],
  // Indonesia, New Guinea and Australia
  [[109, 1.5], [109.5, -1], [110.3, -3], [114.5, -4], [116.3, -3.5], [116.6, -1.5], [117.6, 0.5], [118, 1], [119, 5], [117.3, 7], [116.5, 6.5], [115.5, 5], [113, 3.2], [111, 1.6], [109.6, 2]],
  [[95.3, 5.5], [97.5, 5.2], [100.3, 2.3], [103.6, -0.6], [105.8, -5.8], [104.5, -5.9], [102.3, -4], [100.5, -1], [98.5, 1.7], [96, 3.8]],
  [[105.2, -6.8], [106, -5.9], [108.3, -6.2], [110.5, -6.4], [112.5, -6.9], [114.6, -7.7], [114.4, -8.7], [111, -8.2], [108, -7.8], [106, -7.4]],
  [[115.1, -8.1], [115.6, -8.4], [115.2, -8.8], [114.7, -8.4]],
  [[116.1, -8.2], [116.7, -8.3], [116.5, -8.9], [116.0, -8.8]],
  [[119.4, -5.5], [119.5, -3.5], [118.8, -2.8], [119.8, 0], [120.5, 1], [124.5, 1.4], [124.5, 0.4], [121.5, 0.5], [123.5, -1], [122, -2.5], [122.5, -5], [121, -4.5], [120.5, -5.6]],
  [[131, -1], [134, -1], [138, -1.6], [141, -2.6], [145.5, -4.5], [147.5, -6.5], [150.5, -10.5], [147, -10], [144, -7.8], [141, -9], [138, -8.5], [137.5, -5.5], [134, -4], [132, -2.5]],
  [
    [113.5, -22], [114, -26], [115, -34], [117.5, -35], [123, -34], [129, -31.5], [132, -32], [135.5, -34.8], [138, -35.5], [140, -38], [144, -38.3], [146.5, -39],
    [150, -37.5], [151.3, -33.5], [153, -31], [153.5, -28], [153, -25], [150.5, -22.5], [149, -20.5], [146, -19], [145.5, -15], [143.5, -14], [142.5, -10.7],
    [141.6, -12.5], [141.5, -17], [140, -17.5], [137, -16], [136, -12], [132.5, -11.5], [130, -12.5], [129, -15], [126, -14], [124, -16.5], [122, -18], [121, -19.5],
    [118.6, -20.3], [116.5, -20.7], [114, -21.8],
  ],
];

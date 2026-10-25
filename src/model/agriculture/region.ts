// The agriculture course's fictional world: the Crane Valley, a corn-and-wheat region of five
// districts along the Crane River. Every chapter reuses it — the same soils, climates, farm,
// elevators, river terminal and ports — the way the electricity course reuses its six-node grid.
//
// Units are the ones the grain trade uses: acres, bushels, inches of water, and °C for weather.
// Climate normals are written as smooth day-of-year curves (src/model/agriculture/climate.ts).

export type DistrictId = 'north' | 'plains' | 'prairie' | 'ridge' | 'bottoms';
export type Crop = 'corn' | 'wheat';

export interface District {
  id: DistrictId;
  name: string;
  /** One line on what makes the district what it is. */
  note: string;
  // ---- Climate normals.
  /** Annual mean of the daily mean temperature, °C. */
  tAvg: number;
  /** Half the swing between the coldest and warmest days of a normal year, °C. */
  tAmp: number;
  /** Normal difference between the day's high and low, °C. */
  diurnal: number;
  /** Normal annual precipitation, inches. */
  rainIn: number;
  /** How strongly the rain is concentrated in late spring and early summer (0 = even through the year). */
  rainSeason: number;
  /** Extra sunshine on dry days relative to the valley average (fraction of a clear sky). */
  sun: number;
  // ---- Soil.
  /** Plant-available water the root zone holds when full, inches. */
  pawIn: number;
  /** Soil organic matter, percent. */
  om: number;
  /** Soil pH. */
  ph: number;
  /** How full the root zone normally is when corn is planted, fraction of pawIn. */
  springWater: number;
  /** GDD from planting to black layer of the corn hybrids farmers grow here, °C·days. */
  hybridGdd: number;
  // ---- Land use, thousands of acres planted in a typical year.
  cornKAc: number;
  wheatKAc: number;
  /** Of the corn, thousands of acres that are irrigated. */
  irrigatedKAc: number;
  // ---- Map.
  polygon: Array<[number, number]>;
  label: [number, number];
}

/** The five districts, west to east and north to south. Map coordinates are a 640 × 400 viewBox. */
export const DISTRICTS: District[] = [
  {
    id: 'north',
    name: 'North Tier',
    note: 'Cool and short-seasoned: early corn hybrids and wheat, and the first frost comes soonest.',
    tAvg: 7.5,
    tAmp: 15,
    diurnal: 12,
    rainIn: 28,
    rainSeason: 0.55,
    sun: 0,
    pawIn: 8,
    om: 4.0,
    ph: 6.6,
    springWater: 0.95,
    hybridGdd: 1250,
    cornKAc: 350,
    wheatKAc: 350,
    irrigatedKAc: 0,
    polygon: [
      [128, 26],
      [612, 26],
      [612, 118],
      [440, 124],
      [230, 118],
      [128, 122],
    ],
    label: [470, 62],
  },
  {
    id: 'plains',
    name: 'High Plains',
    note: 'Semi-arid wheat country. Deep soils but little rain; most of its corn is irrigated from wells.',
    tAvg: 12.5,
    tAmp: 14,
    diurnal: 13.5,
    rainIn: 22,
    rainSeason: 0.75,
    sun: 0.06,
    pawIn: 8,
    om: 2.0,
    ph: 7.6,
    springWater: 0.45,
    hybridGdd: 1500,
    cornKAc: 300,
    wheatKAc: 1500,
    irrigatedKAc: 260,
    polygon: [
      [22, 122],
      [128, 122],
      [230, 118],
      [226, 228],
      [214, 330],
      [196, 382],
      [22, 382],
    ],
    label: [96, 226],
  },
  {
    id: 'prairie',
    name: 'Black Prairie',
    note: 'Deep, dark, rich soils and reliable summer rain: the valley’s best corn ground.',
    tAvg: 10.5,
    tAmp: 14,
    diurnal: 11,
    rainIn: 35,
    rainSeason: 0.5,
    sun: 0,
    pawIn: 11,
    om: 4.5,
    ph: 6.4,
    springWater: 0.95,
    hybridGdd: 1500,
    cornKAc: 1300,
    wheatKAc: 1000,
    irrigatedKAc: 0,
    polygon: [
      [230, 118],
      [440, 124],
      [430, 214],
      [404, 270],
      [330, 284],
      [226, 228],
    ],
    label: [300, 168],
  },
  {
    id: 'ridge',
    name: 'Upland Ridge',
    note: 'Rolling, thinner soils over clay. Plenty of rain, but the root zone holds little of it.',
    tAvg: 11,
    tAmp: 14,
    diurnal: 11,
    rainIn: 34,
    rainSeason: 0.45,
    sun: 0,
    pawIn: 7.5,
    om: 2.5,
    ph: 5.8,
    springWater: 0.95,
    hybridGdd: 1500,
    cornKAc: 450,
    wheatKAc: 500,
    irrigatedKAc: 0,
    polygon: [
      [440, 124],
      [612, 118],
      [612, 252],
      [520, 262],
      [404, 270],
      [430, 214],
    ],
    label: [530, 176],
  },
  {
    id: 'bottoms',
    name: 'River Bottoms',
    note: 'Warm, deep alluvial soils along the Crane. The longest season, and the river terminal.',
    tAvg: 12,
    tAmp: 13.5,
    diurnal: 10,
    rainIn: 38,
    rainSeason: 0.4,
    sun: 0,
    pawIn: 11,
    om: 3.5,
    ph: 6.8,
    springWater: 1,
    hybridGdd: 1550,
    cornKAc: 700,
    wheatKAc: 400,
    irrigatedKAc: 0,
    polygon: [
      [226, 228],
      [330, 284],
      [404, 270],
      [520, 262],
      [612, 252],
      [612, 382],
      [196, 382],
      [214, 330],
    ],
    label: [300, 342],
  },
];

export const DISTRICT: Record<DistrictId, District> = Object.fromEntries(DISTRICTS.map((d) => [d.id, d])) as Record<DistrictId, District>;
export const DISTRICT_IDS: DistrictId[] = DISTRICTS.map((d) => d.id);

/** Total planted acres in a typical year, thousands. */
export const VALLEY_CORN_KAC = DISTRICTS.reduce((s, d) => s + d.cornKAc, 0);
export const VALLEY_WHEAT_KAC = DISTRICTS.reduce((s, d) => s + d.wheatKAc, 0);

// ---------------------------------------------------------------------------
// The farm we follow: Cedar Bend, on the Black Prairie a few miles from the Fairview elevator.

export const CEDAR_BEND = {
  name: 'Cedar Bend Farm',
  district: 'prairie' as DistrictId,
  acres: 1600,
  /** The usual split: corn on most fields, winter wheat on the rest in rotation. */
  cornAcres: 1000,
  wheatAcres: 600,
  /** The family owns most of the land and rents the rest from neighbors. */
  ownedAcres: 1000,
  rentedAcres: 600,
  /** Map position, near Fairview. */
  x: 282,
  y: 200,
};

// ---------------------------------------------------------------------------
// Places that handle grain: country elevators, the river terminal, processors and the ports.

export type PlaceKind = 'elevator' | 'terminal' | 'ethanol' | 'feedlot' | 'mill' | 'port';

export interface Place {
  id: string;
  name: string;
  kind: PlaceKind;
  district?: DistrictId;
  x: number;
  y: number;
}

export const PLACES: Place[] = [
  { id: 'halsted', name: 'Halsted', kind: 'elevator', district: 'north', x: 352, y: 74 },
  { id: 'dunmore', name: 'Dunmore', kind: 'elevator', district: 'plains', x: 112, y: 262 },
  { id: 'fairview', name: 'Fairview', kind: 'elevator', district: 'prairie', x: 318, y: 208 },
  { id: 'ashby', name: 'Ashby', kind: 'elevator', district: 'ridge', x: 528, y: 210 },
  { id: 'landing', name: 'Crane Landing', kind: 'terminal', district: 'bottoms', x: 470, y: 322 },
  { id: 'bluestem', name: 'Bluestem Ethanol', kind: 'ethanol', district: 'prairie', x: 372, y: 246 },
  { id: 'feedyards', name: 'Plains feedyards', kind: 'feedlot', district: 'plains', x: 150, y: 330 },
  { id: 'mill', name: 'Brackley flour mill', kind: 'mill', district: 'bottoms', x: 566, y: 346 },
  { id: 'sable', name: 'Port Sable', kind: 'port', x: 640, y: 380 },
  { id: 'westhaven', name: 'Westhaven', kind: 'port', x: 0, y: 200 },
];

export const PLACE: Record<string, Place> = Object.fromEntries(PLACES.map((p) => [p.id, p]));

/** The Crane River's course across the map, north-west to south-east. */
export const RIVER_PATH = 'M150 22 C 190 90, 250 170, 300 236 S 400 300, 470 322 S 590 352, 640 392';

/** The rail line west to Westhaven, through Fairview and Dunmore. */
export const RAIL_PATH = 'M528 210 L318 208 L112 262 L0 214';

// ---------------------------------------------------------------------------
// Grain units.

/** Pounds in a bushel of shelled corn, at the trade's standard 15.5% moisture. */
export const CORN_LB_PER_BU = 56;
/** Pounds in a bushel of wheat. */
export const WHEAT_LB_PER_BU = 60;
/** Square meters in an acre. */
export const M2_PER_ACRE = 4046.86;
/** Bushels of corn in a metric ton. */
export const CORN_BU_PER_TONNE = 1000 / (CORN_LB_PER_BU * 0.45359237);
/** Bushels of wheat in a metric ton. */
export const WHEAT_BU_PER_TONNE = 1000 / (WHEAT_LB_PER_BU * 0.45359237);
/** A futures contract, bushels. */
export const CONTRACT_BU = 5000;

/** Day of the year (0 = January 1) on which each month begins, in a 365-day year. */
export const MONTH_START = [0, 31, 59, 90, 120, 151, 181, 212, 243, 273, 304, 334];
export const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
export const MONTH_NAMES = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

/** "May 3" for a day of the year (0 = January 1). */
export function dateLabel(day: number, long = false): string {
  const d = ((Math.round(day) % 365) + 365) % 365;
  let m = 11;
  while (MONTH_START[m] > d) m--;
  return `${long ? MONTH_NAMES[m] : MONTHS[m]} ${d - MONTH_START[m] + 1}`;
}

/** Day of the year (0 = January 1) for a month (1–12) and day of month. */
export function dayOf(month: number, dom: number): number {
  return MONTH_START[month - 1] + dom - 1;
}

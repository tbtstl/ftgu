// The capstone's whole book, replayed winter by winter over the archive: the business's weather
// exposure, a hedge in the seasonal HDD strip sold on October 31, and a trading rule on the
// monthly HDD futures. Every decision uses only what was known on its date; every price is from
// the simulated market. Runs in the reader's region through the world knobs.

import { YEARS, type WorldKnobs } from '../../model/weather/archive';
import { UTILITY } from './degreeDays';
import { utilityWinters, windYears, farmYears } from './exposure';
import { MARKET, hedgeWinters, replay, type MarketModel, type Trade } from './market';
import { CME_TICK, WINTER_SEASON, monthContract, type ContractSpec } from './pricing';

export const SEASON_STRIP: ContractSpec = { kind: 'HDD', months: WINTER_SEASON, type: 'future', strike: 0, tick: CME_TICK };

/** Winters with a full season and a year before them for the market's history: 2–40. */
export const PORTFOLIO_WINTERS = Array.from({ length: YEARS - 2 }, (_, i) => i + 2);

export interface BookSettings {
  business: 'utility' | 'wind' | 'farm';
  scale: number;
  hedgeStrips: number;
  months: number[];
  lead: number;
  threshold: number;
  size: number;
}

export interface WinterBook {
  winter: number;
  /** The business's result against its average, $. */
  business: number;
  hedge: number;
  trading: number;
  total: number;
  trades: Trade[];
}

export interface BookResult {
  winters: WinterBook[];
  businessSd: number;
  hedgedSd: number;
  totalSd: number;
  /** Share of the business's variance the hedge removes. */
  effectiveness: number;
  tradingTotal: number;
  tradingMean: number;
  trades: number;
  worstTotal: number;
  meanTotal: number;
}

function sd(xs: number[]): number {
  const m = xs.reduce((s, v) => s + v, 0) / Math.max(1, xs.length);
  return Math.sqrt(xs.reduce((s, v) => s + (v - m) ** 2, 0) / Math.max(1, xs.length));
}

/**
 * Replay the book. The business result is its departure from its own average over the winters
 * (its budget). For the wind farm and the farm, which don't follow winter degree days, the "winter"
 * is the year starting that January; a heating-season hedge does little for them, by design.
 */
export function replayBook(b: BookSettings, knobs: WorldKnobs = {}, m: MarketModel = MARKET): BookResult {
  const winters = PORTFOLIO_WINTERS;
  let biz: number[];
  if (b.business === 'utility') {
    const all = utilityWinters(knobs, UTILITY);
    biz = winters.map((w) => all[w - 1].margin * b.scale);
  } else if (b.business === 'wind') {
    const all = windYears();
    biz = winters.map((w) => all[Math.min(all.length - 1, w)].revenue * b.scale);
  } else {
    // Marlow keeps its own climate; only the region's variability and trend carry over.
    const all = farmYears(0.02, { variability: knobs.variability, trend: knobs.trend });
    biz = winters.map((w) => all[Math.min(all.length - 1, w)].profit * b.scale);
  }
  const mean = biz.reduce((s, v) => s + v, 0) / biz.length;
  const hedge = hedgeWinters(SEASON_STRIP, winters, biz, b.hedgeStrips, 1, m, knobs);
  const tradesByWinter = new Map<number, Trade[]>();
  for (const month of b.months) {
    const spec = monthContract('HDD', month);
    // December belongs to the winter that starts that year; January–March to the one before.
    const years = winters.map((w) => (month >= 10 ? w : w + 1)).filter((y) => y <= YEARS);
    const trades = b.size > 0 ? replay(spec, years, b.lead, { threshold: b.threshold, size: b.size, view: { knobs } }, m, knobs) : [];
    for (const t of trades) {
      const w = month >= 10 ? t.year : t.year - 1;
      const list = tradesByWinter.get(w) ?? [];
      list.push(t);
      tradesByWinter.set(w, list);
    }
  }
  const rows: WinterBook[] = winters.map((w, i) => {
    const h = hedge.years[i].hedged - hedge.years[i].unhedged;
    const trades = tradesByWinter.get(w) ?? [];
    const trading = trades.reduce((s, t) => s + t.pnl, 0);
    const business = biz[i] - mean;
    return { winter: w, business, hedge: h, trading, total: business + h + trading, trades };
  });
  const allTrades = rows.flatMap((r) => r.trades);
  const tradingTotal = allTrades.reduce((s, t) => s + t.pnl, 0);
  const bsd = sd(rows.map((r) => r.business));
  const hsd = sd(rows.map((r) => r.business + r.hedge));
  return {
    winters: rows,
    businessSd: bsd,
    hedgedSd: hsd,
    totalSd: sd(rows.map((r) => r.total)),
    effectiveness: bsd > 0 ? 1 - (hsd * hsd) / (bsd * bsd) : 0,
    tradingTotal,
    tradingMean: allTrades.length ? tradingTotal / allTrades.length : 0,
    trades: allTrades.length,
    worstTotal: Math.min(...rows.map((r) => r.total)),
    meanTotal: rows.reduce((s, r) => s + r.total, 0) / rows.length,
  };
}

import { fmt } from '../format';
import { niceTicks } from './scale';
import { tint } from '../tokens';

export interface StackBlock {
  id: string;
  /** Left edge on the MW axis. */
  start: number;
  mw: number;
  /** Height: the offer, $/MWh. */
  price: number;
  /** Accepted MW (filled solid; the rest is drawn faded). */
  dispatched: number;
  color: string;
  /** Text above the block (defaults to "$price"). */
  label?: string;
  /** Outline and bold label, for "your" plant. */
  highlight?: boolean;
  /** Draw a dashed line across the block at this $/MWh (e.g. its true cost). */
  costMark?: number;
  /** Hatched margin between two prices over the dispatched part: green if gain, red if loss. */
  margin?: { from: number; to: number };
}

/**
 * A merit-order chart: blocks of capacity sorted by price, the demand line and the clearing price.
 * Blocks keep their identity across renders, so re-sorting animates them into place.
 */
export function SupplyStackChart({
  blocks,
  demand,
  price,
  xMax,
  yMax,
  ariaLabel,
  demandLabel = 'Demand',
  priceLabel,
}: {
  blocks: StackBlock[];
  demand?: number;
  price?: number;
  xMax: number;
  yMax: number;
  ariaLabel: string;
  demandLabel?: string;
  priceLabel?: string;
}) {
  const pct = (x: number) => `${((x / xMax) * 100).toFixed(3)}%`;
  const hp = (p: number) => `${((Math.max(0, Math.min(p, yMax)) / yMax) * 100).toFixed(3)}%`;
  const yTicks = niceTicks(0, yMax, 4).filter((t) => t <= yMax);
  const xTicks = niceTicks(0, xMax, 4).filter((t) => t <= xMax);
  return (
    <div className="mo" role="img" aria-label={ariaLabel}>
      <div className="mo-plot">
        {yTicks.map((t) => (
          <div key={'g' + t}>
            {t > 0 && <div className="mo-g" style={{ bottom: hp(t) }} />}
            <span className="mo-yl" style={{ bottom: hp(t) }}>
              ${fmt(t)}
            </span>
          </div>
        ))}
        {blocks.map((b) => {
          const h = hp(Math.max(b.price, yMax * 0.008));
          const m = b.margin;
          const lo = m ? Math.min(m.from, m.to) : 0;
          const hi = m ? Math.max(m.from, m.to) : 0;
          return (
            <div key={b.id} style={{ display: 'contents' }}>
              <div className={'mo-bar' + (b.highlight ? ' you' : '')} style={{ left: pct(b.start), width: pct(b.mw), height: h, background: tint(b.color, 0.3) }} />
              <div className="mo-bar" style={{ left: pct(b.start), width: pct(b.dispatched), height: h, background: b.color }} />
              {m && b.dispatched > 0 && hi > lo && (
                <div className={'mo-pr ' + (m.to >= m.from ? 'gain' : 'loss')} style={{ left: pct(b.start), width: pct(b.dispatched), bottom: hp(lo), height: hp(hi - lo) }} />
              )}
              {b.costMark !== undefined && <div className="mo-cost" style={{ left: pct(b.start), width: pct(b.mw), bottom: hp(b.costMark) }} />}
              <div className={'mo-lab' + (b.highlight ? ' you' : '')} style={{ left: pct(b.start), width: pct(b.mw), bottom: h }}>
                {b.label ?? '$' + fmt(b.price)}
              </div>
            </div>
          );
        })}
        {demand !== undefined && price !== undefined && (
          <div className="mo-price" style={{ width: pct(Math.min(demand, xMax)), bottom: hp(price) }}>
            <span>{priceLabel ?? '$' + fmt(price)}</span>
          </div>
        )}
        {demand !== undefined && (
          <div className="mo-dem" style={{ left: pct(Math.min(demand, xMax)) }}>
            <span className={demand / xMax > 0.8 ? 'r' : ''}>{demandLabel}</span>
          </div>
        )}
      </div>
      <div className="mo-x">
        {xTicks.map((t, i) => (
          <span key={t} className="mo-xl" style={{ left: pct(t) }}>
            {fmt(t)}
            {i === xTicks.length - 1 ? ' MW' : ''}
          </span>
        ))}
      </div>
    </div>
  );
}

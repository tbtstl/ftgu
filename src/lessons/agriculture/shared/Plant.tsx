// Drawings of a corn plant and a wheat plant at any point in their development, for the crop
// lifecycle figures. `dev` is development from 0 (planting, or January 1 for wheat) to 1 (maturity).

import { mix } from '../../../framework';
import { stageAt } from '../../../engines/agriculture/crop';

const GREEN = '#5f9a3a';
const DARK = '#3f7a1e';
const DRY = '#c9a85a';
const DEAD = '#9a8f7a';

function smooth(x: number) {
  const t = Math.max(0, Math.min(1, x));
  return t * t * (3 - 2 * t);
}

/** Leaf color: green while growing, yellowing through grain fill, brown when dead. */
function leafColor(dev: number, start: number, alive: boolean) {
  if (!alive) return DEAD;
  return mix(GREEN, DRY, smooth((dev - start) / (1 - start)));
}

/** A corn plant standing on the ground at (x, y), `height` pixels tall when grown. */
export function CornPlant({ dev, x, y, height = 200, alive = true }: { dev: number; x: number; y: number; height?: number; alive?: boolean }) {
  const ve = stageAt('corn', 'VE');
  const vt = stageAt('corn', 'VT');
  const r1 = stageAt('corn', 'R1');
  const r3 = stageAt('corn', 'R3');
  if (dev < ve) {
    // A seed in the soil, sprouting.
    const k = dev / ve;
    return (
      <g>
        <ellipse cx={x} cy={y + 14} rx={5} ry={3.5} fill="#e2b84a" stroke="#a88a30" />
        {k > 0.3 && <path d={`M${x} ${y + 11} Q ${x + 1} ${y + 11 - 10 * k} ${x} ${y + 12 - 14 * k}`} stroke={GREEN} strokeWidth={2} fill="none" />}
      </g>
    );
  }
  const lin = Math.min(1, (dev - ve) / (vt - ve));
  const g = smooth(lin);
  const h = 14 + (height - 14) * g;
  // Visible leaves: about 2 at emergence to 9 drawn on a grown plant (each drawn leaf stands for two).
  const leaves = Math.max(2, Math.round(2 + 7 * lin));
  const color = leafColor(dev, r3, alive);
  const stalk = alive ? mix(DARK, DRY, smooth((dev - r3) / (1 - r3))) : DEAD;
  const items = [];
  for (let i = 0; i < leaves; i++) {
    const at = (i + 0.6) / (leaves + 0.4);
    const ly = y - h * at;
    const side = i % 2 === 0 ? 1 : -1;
    // Leaves are longest in the middle of a grown plant, and the newest ones are still short.
    const shape = 0.45 + 0.55 * Math.sin(Math.PI * Math.min(1, 0.2 + 0.8 * at));
    const newest = i === leaves - 1 ? 0.6 : 1;
    const len = shape * newest * (0.3 + 0.7 * g) * height * 0.36;
    const rise = len * 0.35;
    const wid = Math.max(2.2, len * 0.09);
    const tipX = x + side * len;
    const tipY = ly - rise * 0.2 + len * 0.18;
    const cx = x + side * len * 0.45;
    const cy = ly - rise * 1.25;
    items.push(<path key={i} d={`M${x} ${ly} Q ${cx} ${cy - wid} ${tipX} ${tipY} Q ${cx} ${cy + wid * 1.6} ${x} ${ly + wid * 1.2} Z`} fill={color} stroke={mix(color, '#2f5a17', 0.25)} strokeWidth={0.6} />);
  }
  const earY = y - h * 0.48;
  const ear = dev >= r1;
  const fill = smooth((dev - r1) / (1 - r1));
  return (
    <g>
      <line x1={x} y1={y} x2={x} y2={y - h} stroke={stalk} strokeWidth={6} strokeLinecap="round" />
      {items}
      {dev >= vt - 0.02 && (
        <g stroke={alive ? mix('#b8a24a', DRY, fill) : DEAD} strokeWidth={2.5} strokeLinecap="round">
          <line x1={x} y1={y - h} x2={x} y2={y - h - 26} />
          <line x1={x} y1={y - h - 8} x2={x - 12} y2={y - h - 24} />
          <line x1={x} y1={y - h - 8} x2={x + 12} y2={y - h - 24} />
          <line x1={x} y1={y - h - 14} x2={x - 7} y2={y - h - 30} />
          <line x1={x} y1={y - h - 14} x2={x + 7} y2={y - h - 30} />
        </g>
      )}
      {ear && (
        <g>
          <ellipse
            cx={x + 9}
            cy={earY}
            rx={4 + 3.5 * fill}
            ry={13 + 5 * fill}
            transform={`rotate(18 ${x + 9} ${earY})`}
            fill={alive ? mix('#9cc46a', '#d9c27a', smooth((dev - r3) / (1 - r3))) : DEAD}
            stroke={alive ? mix(DARK, '#a58a40', fill) : '#7a705e'}
            strokeWidth={1.5}
          />
          {dev < r3 && (
            <path d={`M${x + 14} ${earY - 16} q 6 -8 3 -16 M${x + 15} ${earY - 15} q 9 -5 9 -13 M${x + 13} ${earY - 16} q 1 -9 -3 -14`} stroke="#c9875a" strokeWidth={1.4} fill="none" />
          )}
        </g>
      )}
    </g>
  );
}

/** A wheat plant (a clump of tillers) standing on the ground at (x, y). */
export function WheatPlant({ dev, x, y, height = 120, alive = true }: { dev: number; x: number; y: number; height?: number; alive?: boolean }) {
  const jointing = stageAt('wheat', 'J');
  const heading = stageAt('wheat', 'H');
  const milk = stageAt('wheat', 'M');
  const stem = smooth((dev - jointing) / (heading - jointing));
  const h = 18 + (height - 18) * stem;
  const color = leafColor(dev, milk, alive);
  const tillers = [-14, -6, 2, 10, 17];
  return (
    <g>
      {tillers.map((dx, i) => {
        const top = y - h * (0.88 + 0.12 * Math.sin(i * 1.7));
        const tx = x + dx * (0.6 + 0.6 * stem);
        const leafLen = 16 + 14 * Math.min(1, dev / heading);
        return (
          <g key={i}>
            <path d={`M${x + dx * 0.2} ${y} Q ${x + dx * 0.4} ${(y + top) / 2} ${tx} ${top}`} stroke={color} strokeWidth={2.4} fill="none" />
            <path
              d={`M${x + dx * 0.3} ${y - 6 - i * 2} q ${(i % 2 ? -1 : 1) * leafLen * 0.6} ${-leafLen * 0.5} ${(i % 2 ? -1 : 1) * leafLen} ${leafLen * 0.1}`}
              stroke={color}
              strokeWidth={3}
              strokeLinecap="round"
              fill="none"
            />
            {dev >= heading - 0.02 && (
              <g>
                <ellipse cx={tx} cy={top - 9} rx={3.6} ry={10} fill={alive ? mix('#8fb85a', '#d8b65a', smooth((dev - milk) / (1 - milk))) : DEAD} />
                <path d={`M${tx - 2} ${top - 16} l -3 -9 M${tx + 2} ${top - 16} l 3 -9 M${tx} ${top - 18} l 0 -10`} stroke={alive ? '#b39a52' : DEAD} strokeWidth={1} />
              </g>
            )}
          </g>
        );
      })}
    </g>
  );
}

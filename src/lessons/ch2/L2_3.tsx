import {
  Caption,
  Challenge,
  Controls,
  Eq,
  Figure,
  Frac,
  H2,
  K,
  Legend,
  LessonPage,
  Op,
  P,
  Readouts,
  Segmented,
  Slider,
  TimeChart,
  fmt,
  hour,
  lessonHref,
  mw,
  pct,
  useScenario,
} from '../../framework';
import { LOAD_KINDS, checkTransformers, circuitMVA, loadByKind, substationLoad, type LoadMix } from '../../engines/ops/substation';
import { LOAD_LABEL } from '../../model/profiles';
import type { LoadKind } from '../../model/types';

const LOAD_COLOR: Record<LoadKind, string> = {
  residential: '#7aa6d6',
  commercial: '#e3b25b',
  industrial: '#9b8f84',
  dataCenter: '#9f86c9',
};
const RANGE: Record<Exclude<LoadKind, 'dataCenter'>, number> = { residential: 25, commercial: 20, industrial: 15 };
const FEEDER_AMPS = 600;
type FeederKV = '4.16' | '13.8' | '34.5';

export interface SubstationState {
  residential: number;
  commercial: number;
  industrial: number;
  dataCenter: number;
  count: number;
  rating: number;
  outage: 'all' | 'one';
  feederKV: FeederKV;
}

export const SUBSTATION_DEFAULTS: SubstationState = {
  residential: 16,
  commercial: 12,
  industrial: 6,
  dataCenter: 0,
  count: 2,
  rating: 40,
  outage: 'all',
  feederKV: '13.8',
};
export const COUNT_RANGE = [1, 4] as const;
export const RATING_RANGE = [10, 60, 5] as const;
export const DATA_CENTER_MW = 20;

function peaks(s: SubstationState): LoadMix {
  return { residential: s.residential, commercial: s.commercial, industrial: s.industrial, dataCenter: s.dataCenter };
}

/** The smallest installed transformer capacity (count × rating on the sliders' grid) that passes N-1 for these loads. */
export function minimumInstalled(s: SubstationState): { installed: number; count: number; rating: number } | null {
  const load = substationLoad(peaks(s)).total;
  let best: { installed: number; count: number; rating: number } | null = null;
  for (let n = COUNT_RANGE[0]; n <= COUNT_RANGE[1]; n++) {
    for (let r = RATING_RANGE[0]; r <= RATING_RANGE[1]; r += RATING_RANGE[2]) {
      if (!checkTransformers(load, n, r).n1Secure) continue;
      if (!best || n * r < best.installed) best = { installed: n * r, count: n, rating: r };
    }
  }
  return best;
}

export function substationSolved(s: SubstationState): boolean {
  const load = substationLoad(peaks(s)).total;
  const chk = checkTransformers(load, s.count, s.rating);
  const best = minimumInstalled(s);
  return s.dataCenter === DATA_CENTER_MW && chk.n1Secure && best !== null && chk.installed === best.installed;
}

/** Transformer symbol (two overlapping circles, stacked vertically) centered at (x, y). */
function Xfmr({ x, y, out, fill }: { x: number; y: number; out: boolean; fill: string }) {
  return (
    <g fill={fill} stroke={out ? '#9a9a9a' : '#555'} strokeWidth={1.8} strokeDasharray={out ? '4 4' : undefined}>
      <circle cx={x} cy={y - 8} r={13} />
      <circle cx={x} cy={y + 8} r={13} />
    </g>
  );
}

function loadFill(u: number): string {
  if (u > 1.001) return '#f2b8b2';
  if (u >= 0.8) return '#f6d7bd';
  return '#fff';
}

export default function Lesson() {
  const sc = useScenario<SubstationState>('substation', SUBSTATION_DEFAULTS);
  const s = sc.state;

  // Figure 1: the existing customers only.
  const base = { residential: s.residential, commercial: s.commercial, industrial: s.industrial, dataCenter: 0 };
  const L1 = substationLoad(base);
  const by1 = loadByKind(base);
  const types1: LoadKind[] = ['residential', 'commercial', 'industrial'];

  // Figure 2: with the data center and the transformers.
  const all = peaks(s);
  const L2 = substationLoad(all);
  const by2 = loadByKind(all);
  const chk = checkTransformers(L2.total, s.count, s.rating);
  const inService = s.outage === 'one' ? Math.max(0, s.count - 1) : s.count;
  const capNow = inService * s.rating;
  const perXfmr = inService > 0 ? L2.peak / inService : Infinity;
  const uNow = inService > 0 ? perXfmr / s.rating : L2.peak > 0 ? Infinity : 0;
  const over = L2.total.map((v, h) => (v > capNow + 1e-9 ? h : -1)).filter((h) => h >= 0);
  const bands = over.map((h) => ({ from: h, to: h + 1, color: 'rgba(231, 91, 85, 0.14)' }));
  const feederMVA = circuitMVA(Number(s.feederKV), FEEDER_AMPS);
  const feeders = LOAD_KINDS.map((k) => {
    const pk = all[k];
    const n = pk > 0 ? Math.ceil(pk / feederMVA - 1e-9) : 0;
    return { k, n, u: n > 0 ? pk / (n * feederMVA) : 0 };
  });
  const totalFeeders = feeders.reduce((t, f) => t + f.n, 0);
  const best = minimumInstalled(s);
  const solved = substationSolved(s);

  const xs = Array.from({ length: s.count }, (_, i) => 320 + (i - (s.count - 1) / 2) * 92);
  const feederXs: Array<{ k: LoadKind; x: number }> = [];
  const groupX: Partial<Record<LoadKind, number>> = {};
  {
    // Each customer type gets a group wide enough for its label; feeders are spaced inside it.
    const shown = feeders.filter((f) => f.n > 0);
    const gap = 22;
    const widths = shown.map((f) => Math.max(128, (Math.min(f.n, 8) - 1) * gap + 24));
    let xx = 320 - (widths.reduce((t, w) => t + w, 0) + 12 * (shown.length - 1)) / 2;
    shown.forEach((f, gi) => {
      const mid = xx + widths[gi] / 2;
      groupX[f.k] = mid;
      const n = Math.min(f.n, 8);
      for (let i = 0; i < n; i++) feederXs.push({ k: f.k, x: mid + (i - (n - 1) / 2) * gap });
      xx += widths[gi] + 12;
    });
  }

  let cap2: string;
  if (s.outage === 'one' && s.count === 1) cap2 = 'With its only transformer out, the substation can’t supply anyone.';
  else if (over.length)
    cap2 = `${s.outage === 'one' ? 'With one transformer out, the' : 'The'} load exceeds the ${fmt(capNow)} MVA in service for ${over.length} hour${over.length > 1 ? 's' : ''} of the day, from ${hour(over[0])}.`;
  else cap2 = `${s.outage === 'one' ? 'With one transformer out, the' : 'The'} ${inService > 1 ? `${inService} transformers in service each carry` : 'transformer in service carries'} ${fmt(perXfmr, 1)} MVA at the ${hour(L2.peakHour)} peak — ${pct(uNow)} of ${inService > 1 ? 'their ratings' : 'its rating'}.`;

  return (
    <LessonPage id="2.3">
      <P>
        Every customer in the previous lesson hung from a feeder, and every feeder from a substation. A distribution substation is a fenced yard of equipment: a{' '}
        <b>bus</b> — a set of heavy conductors — at transmission voltage, the transformers that step the voltage down, a second bus at distribution voltage, and a circuit
        breaker for each feeder leaving the yard. Designing one comes down to a single question: how much transformer capacity does it need?
      </P>
      <P>
        The answer depends on the customers, and on <i>when</i> they use power. Homes use the most in the evening, when people are back from work. Offices and shops peak
        in the late morning and fade after closing time. Factories run around the clock with a daytime bulge, and data centers barely vary at all. Here is a substation in
        Metro serving homes, businesses and a little industry, each drawn with the course’s standard daily shape for its kind of customer. Change how much of each the
        substation serves:
      </P>

      <Figure name="Substation Designer" scenario={sc}>
        <Legend
          items={[
            ...types1.map((k) => ({ label: LOAD_LABEL[k], color: LOAD_COLOR[k] })),
            { label: 'Sum of each type’s own peak', color: '#333', kind: 'line' as const, dashed: true },
          ]}
        />
        <TimeChart
          ariaLabel={`Substation load over the day. Combined peak ${mw(L1.peak, 1)} at ${hour(L1.peakHour)}; the three customer types’ own peaks add up to ${mw(L1.sumOfPeaks)}.`}
          stack={types1.map((k) => ({ values: by1[k], color: LOAD_COLOR[k] }))}
          refLines={L1.sumOfPeaks > 0 ? [{ y: L1.sumOfPeaks, color: '#333', dash: '6 4', label: `sum of peaks ${mw(L1.sumOfPeaks)}` }] : []}
          yMin={0}
          yMax={60}
          yLabel="MW"
          height={240}
          cursor={L1.sumOfPeaks > 0 ? L1.peakHour : undefined}
        />
        <Controls columns={2}>
          {types1.map((k) => (
            <Slider
              key={k}
              label={`${LOAD_LABEL[k]} peak`}
              value={s[k as keyof typeof RANGE]}
              min={0}
              max={RANGE[k as keyof typeof RANGE]}
              onChange={(v) => sc.set({ [k]: v } as Partial<SubstationState>)}
              display={mw(s[k as keyof typeof RANGE])}
            />
          ))}
        </Controls>
        <Readouts
          items={[
            { label: `combined peak, at ${hour(L1.peakHour)}`, value: mw(L1.peak, 1), tone: 'red' },
            { label: 'sum of individual peaks', value: mw(L1.sumOfPeaks) },
            { label: 'diversity factor', value: L1.peak > 0 ? fmt(L1.diversityFactor, 2) : '—' },
            { label: 'load factor', value: L1.peak > 0 ? pct(L1.loadFactor) : '—' },
          ]}
        />
      </Figure>

      <P>
        Homes peak at 7 p.m., businesses in the late morning, and industry is busiest from mid-morning to mid-afternoon. Because they don’t peak together, the combined load
        peaks at 29.4 MW at 5 p.m., well below the 34 MW that the three peaks add up to. The ratio between the two is the <b>diversity factor</b>, 1.16 here, and it is one
        of the most useful numbers in distribution planning: the equipment has to be sized for the combined peak, not for the sum of everyone’s peaks. Set the substation to
        serve nothing but homes and the diversity factor drops to 1, because there’s nothing to offset their evening peak.
      </P>
      <P>
        The <b>load factor</b> — the average load divided by the peak — measures how hard the equipment works. Here it is 84%. A substation serving only homes would have
        a load factor of 68%, sitting well below its peak for most of the day; one serving only industry would reach 91%. Load factor matters for the same reason
        capacity factor did in <a href={lessonHref('2.1')}>Lesson 2.1</a>: a substation costs much the same whether it runs near its peak all day or only for an hour, so
        a higher load factor spreads that cost over more energy.
      </P>

      <H2>Transformers and the N-1 rule</H2>
      <P>
        Transformers are rated in megavolt-amperes, MVA, rather than megawatts. The volt-ampere counts all the current a transformer carries, including current that
        sloshes back and forth without delivering net power, and it is current that heats the windings. We’ll assume our loads draw no such current, so each megawatt of
        load uses one MVA of transformer capacity.
      </P>
      <P>
        Our substation has two 40 MVA transformers sharing the load. At the 5 p.m. peak each carries 14.7 MVA, only 37% of its rating. That looks wasteful until you ask
        what happens when one of them fails. A large transformer can take weeks or months to repair or replace, so planners insist that the substation must still carry its
        peak with any one transformer out of service. This is the <b>N-1 rule</b>: with N pieces of equipment, the system must work on N − 1 of them. With one transformer
        out, the other carries everything — 73% of its rating:
      </P>
      <Eq label="Loading with one transformer out">
        <span>N-1 loading</span>
        <Op>=</Op>
        <Frac top="peak load" bottom={<>(N − 1) × rating</>} />
        <Op>=</Op>
        <Frac top={mw(L2.peak, 1)} bottom={<>{Math.max(0, s.count - 1)} × {s.rating} MVA</>} />
        <Op>=</Op>
        <K tone={chk.n1Secure ? 'ink' : 'red'}>{Number.isFinite(chk.n1Utilization) ? pct(chk.n1Utilization) : '—'}</K>
      </Eq>
      <P>
        Now a developer asks to connect a 20 MW data center — modest, as data centers go, since the largest draw hundreds of megawatts. The demonstration below shows the
        whole substation, from the 138 kV bus at the top to the feeders at the bottom, with the data center added. Switch a transformer out to test the N-1 rule:
      </P>

      <Figure name="Substation Designer · transformers" scenario={sc}>
        <Segmented
          label="Transformers in service"
          value={s.outage}
          onChange={(v) => sc.set({ outage: v })}
          options={[
            { value: 'all', label: 'All in service' },
            { value: 'one', label: 'One transformer out' },
          ]}
        />
        <svg
          className="diagram"
          viewBox="0 0 640 274"
          role="img"
          aria-label={`Substation with ${s.count} transformers of ${s.rating} MVA${s.outage === 'one' ? ', one out of service' : ''}. Peak load ${mw(L2.peak, 1)}; ${inService > 0 ? `each transformer in service carries ${pct(uNow)} of its rating` : 'no transformer in service'}. ${totalFeeders} feeders at ${s.feederKV} kV.`}
        >
          <text className="ax" x={30} y={28}>
            138 kV bus
          </text>
          <line x1={30} y1={40} x2={610} y2={40} stroke="#555" strokeWidth={5} strokeLinecap="round" />
          {xs.map((x, i) => {
            const out = s.outage === 'one' && i === 0;
            const u = out ? 0 : uNow;
            return (
              <g key={i}>
                <line x1={x} y1={40} x2={x} y2={70} stroke={out ? '#d6d6d6' : '#9a9a9a'} strokeWidth={4} strokeDasharray={out ? '5 5' : undefined} />
                <Xfmr x={x} y={94} out={out} fill={out ? '#f1f1f1' : loadFill(u)} />
                <line x1={x} y1={118} x2={x} y2={150} stroke={out ? '#d6d6d6' : '#9a9a9a'} strokeWidth={4} strokeDasharray={out ? '5 5' : undefined} />
                <text className="lab" x={x + 22} y={88}>
                  {s.rating} MVA
                </text>
                <text x={x + 22} y={106} style={{ fontSize: 13, fontWeight: 500, fill: out ? '#6b6b6b' : u > 1.001 ? '#c4382f' : '#333' }}>
                  {out ? 'out' : Number.isFinite(u) ? pct(u) : '—'}
                </text>
              </g>
            );
          })}
          <text className="ax" x={30} y={142}>
            {s.feederKV} kV bus
          </text>
          <line x1={30} y1={150} x2={610} y2={150} stroke="#555" strokeWidth={5} strokeLinecap="round" />
          {feederXs.map((f, i) => (
            <g key={i}>
              <line x1={f.x} y1={150} x2={f.x} y2={226} stroke={LOAD_COLOR[f.k]} strokeWidth={5} />
              <path d={`M${f.x} 226 L${f.x - 6} 216 M${f.x} 226 L${f.x + 6} 216`} stroke={LOAD_COLOR[f.k]} strokeWidth={2.5} fill="none" />
              <rect x={f.x - 6} y={162} width={12} height={12} fill="#444" />
            </g>
          ))}
          {feeders.map((f) => {
            const mid = groupX[f.k];
            if (mid === undefined) return null;
            return (
              <g key={f.k}>
                <text className="lab" x={mid} y={248} textAnchor="middle">
                  {f.k === 'dataCenter' ? 'Data center' : LOAD_LABEL[f.k]}
                </text>
                <text className="ax ax-m" x={mid} y={266}>
                  {f.n} feeder{f.n > 1 ? 's' : ''}
                  {f.n > 8 ? ' (8 drawn)' : ''} · {pct(f.u)} at peak
                </text>
              </g>
            );
          })}
          <text className="ax ax-e" x={610} y={142}>
            each feeder rated {fmt(feederMVA, 1)} MVA
          </text>
        </svg>
        <Legend
          items={[
            ...LOAD_KINDS.filter((k) => all[k] > 0).map((k) => ({ label: k === 'dataCenter' ? 'Data center' : LOAD_LABEL[k], color: LOAD_COLOR[k] })),
            { label: 'Capacity, all in service', color: '#6b6b6b', kind: 'line' as const, dashed: true },
            { label: 'Capacity, one out', color: '#c4382f', kind: 'line' as const, dashed: true },
          ]}
        />
        <TimeChart
          ariaLabel={`Load over the day against ${fmt(capNow)} MVA of transformer capacity in service; ${over.length} hours over.`}
          stack={LOAD_KINDS.map((k) => ({ values: by2[k], color: LOAD_COLOR[k] }))}
          refLines={[
            ...(chk.installed <= 100 ? [{ y: chk.installed, color: '#6b6b6b', dash: '6 4', label: `all transformers ${fmt(chk.installed)} MVA` }] : []),
            ...(chk.firm <= 100 && chk.firm !== chk.installed ? [{ y: chk.firm, color: '#c4382f', dash: '3 4', label: `one out ${fmt(chk.firm)} MVA` }] : []),
          ]}
          bands={bands}
          yMin={0}
          yMax={100}
          yLabel="MW"
          height={220}
        />
        <Caption>{cap2}</Caption>
        <Controls columns={2}>
          <Slider label="Data center" value={s.dataCenter} min={0} max={40} step={5} onChange={(v) => sc.set({ dataCenter: v })} display={mw(s.dataCenter)} />
          <Slider label="Transformers" value={s.count} min={COUNT_RANGE[0]} max={COUNT_RANGE[1]} onChange={(v) => sc.set({ count: v })} display={String(s.count)} />
          <Slider
            label="Rating of each transformer"
            value={s.rating}
            min={RATING_RANGE[0]}
            max={RATING_RANGE[1]}
            step={RATING_RANGE[2]}
            onChange={(v) => sc.set({ rating: v })}
            display={`${s.rating} MVA`}
          />
        </Controls>
        <Segmented
          label="Distribution voltage"
          value={s.feederKV}
          onChange={(v) => sc.set({ feederKV: v })}
          options={(['4.16', '13.8', '34.5'] as FeederKV[]).map((v) => ({ value: v, label: `${v} kV feeders` }))}
        />
        <Readouts
          items={[
            { label: `peak load, at ${hour(L2.peakHour)}`, value: mw(L2.peak, 1) },
            { label: 'installed', value: `${fmt(chk.installed)} MVA` },
            { label: 'left with one out', value: `${fmt(chk.firm)} MVA`, tone: chk.n1Secure ? undefined : 'red' },
            { label: 'passes N-1', value: chk.n1Secure ? 'yes' : 'no', tone: chk.n1Secure ? 'green' : 'red' },
          ]}
        />
      </Figure>

      <P>
        The data center adds almost its full 20 MW to every hour, because it runs flat out day and night; diversity does nothing to soften it. The peak rises to 49.0 MW
        at 5 p.m., and with one of the two 40 MVA transformers out, the other would have to carry 122% of its rating. The substation fails the N-1 test.
      </P>
      <Challenge
        id="a"
        question={`Connect the ${DATA_CENTER_MW} MW data center, and choose the number and rating of the transformers so that the substation passes the N-1 test with as little installed transformer capacity as possible.`}
        solved={solved}
        status={
          s.dataCenter !== DATA_CENTER_MW
            ? `Set the data center to ${DATA_CENTER_MW} MW.`
            : chk.n1Secure
              ? `This design passes N-1 with ${fmt(chk.installed)} MVA installed. Can you do it with less?`
              : `With ${s.count} × ${s.rating} MVA, losing one transformer leaves ${fmt(chk.firm)} MVA for a ${mw(L2.peak, 1)} peak.`
        }
        success={
          best
            ? `Solved: ${best.count} transformers of ${best.rating} MVA, ${fmt(best.installed)} MVA in all. Losing one of three takes away only a third of the capacity, so three smaller transformers pass the N-1 test with less installed capacity than two large ones.`
            : 'Solved.'
        }
      />
      <P>
        More, smaller transformers make the N-1 rule cheaper to satisfy, though each one brings its own foundation, breakers and maintenance, and many substations have
        two or three. Planners have other ways to pass the test, too. A transformer can carry somewhat more than its nameplate rating for a few hours if it cools down
        afterwards, and part of the load can often be moved to a neighboring substation through feeder ties like the one in Lesson 2.2. The same logic shapes the feeders. Each feeder out of the substation can carry only so much current — we’ve assumed 600 A —
        so the feeders’ capacity in MVA depends on the distribution voltage. At 13.8 kV a feeder carries about 14 MVA, and the data center needs two of its own. Switch to
        4.16 kV and each feeder carries less than a third as much, so the same customers need more than twice as many feeders.
      </P>
      <P>
        Seen from the transmission grid, the whole yard is just a single number: its demand. Add up all of Metro’s substations and you get the 55% of the region’s
        demand that sits at the Metro node of our transmission map. In the next lesson we’ll stop following single paths and ask how power finds its way across
        that whole map, where — unlike on the radial feeders of <a href={lessonHref('2.2')}>Lesson 2.2</a> — it always has more than one way to go, and nobody gets
        to choose which.
      </P>
    </LessonPage>
  );
}

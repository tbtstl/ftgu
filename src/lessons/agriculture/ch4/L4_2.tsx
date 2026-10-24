import { useMemo } from 'react';
import {
  Challenge,
  FigRef,
  Figure,
  GRAPHIC,
  GridY,
  H2,
  K,
  Legend,
  LessonPage,
  P,
  Readouts,
  Segmented,
  Slider,
  TEXT,
  areaPath,
  fmt,
  lessonHref,
  linePath,
  mix,
  scale,
  useScenario,
} from '../../../framework';
import { EXPORT_PACE, MARKETING_MONTHS, inventoryYear, simulateBin, type BinResult } from '../../../engines/agriculture/storage';
import { REFERENCE_YEAR } from '../../../model/agriculture/climate';
import { MONTHS, MONTH_START, dateLabel, dayOf } from '../../../model/agriculture/region';
import { centsPlain } from '../shared/format';
import { CROP_LINE } from '../shared/tones';

const FILL = dayOf(10, 20);
const TO_JULY = 365 - FILL + dayOf(7, 15);
const MAX_DAYS = 365 - FILL + dayOf(8, 31);
const HARVEST_MOISTURE = 19;
const PRICE = 4.4;
const INTEREST = 0.07;
const COST = { farm: 0.02, elevator: 0.035 } as const;

interface BinState {
  dryTo: number;
  aeration: 'on' | 'off';
  days: number;
  where: 'farm' | 'elevator';
}

function run(st: BinState): BinResult {
  return simulateBin({
    year: REFERENCE_YEAR,
    district: 'prairie',
    fillDay: FILL,
    days: st.days,
    harvestMoisture: HARVEST_MOISTURE,
    dryTo: st.dryTo,
    aeration: st.aeration === 'on',
    price: PRICE,
    interest: INTEREST,
    perMonth: COST[st.where],
  });
}

/** The challenge: without aeration, held to July 15, the wettest corn (half-point steps) that doesn't spoil. */
export function wettestSolved(st: BinState): boolean {
  if (st.aeration !== 'off' || st.days !== TO_JULY) return false;
  const ok = (m: number) => run({ ...st, dryTo: m }).spoiledAt < 0;
  return ok(st.dryTo) && !ok(st.dryTo + 0.5);
}

/** Air and grain temperature through storage, with the spoilage index underneath. */
function BinChart({ r }: { r: BinResult }) {
  const n = MAX_DAYS;
  const x = scale(0, n, 60, 620);
  const yt = scale(-10, 30, 150, 24);
  const ys = scale(0, 1.5, 270, 180);
  const t = r.days.map((d) => d.t);
  const ticks = MONTH_START.map((m, i) => ({ m: MONTHS[i], t: (m - FILL + 365) % 365 })).filter((k) => k.t > 0 && k.t < n);
  const sp = r.days.map((d) => Math.min(1.5, d.spoilage));
  const last = r.days[r.days.length - 1];
  return (
    <svg
      className="chart"
      viewBox="0 0 640 300"
      role="img"
      aria-label={`Corn stored from ${dateLabel(FILL)} for ${r.days.length - 1} days: grain at ${fmt(last.grain, 1)} °C at the end, spoilage index ${fmt(last.spoilage * 100)}% of its allowable storage time${r.spoiledAt >= 0 ? `; it began to spoil on ${dateLabel((FILL + r.spoiledAt) % 365)}` : ''}.`}
    >
      <text className="ax" x={60} y={14}>
        Temperature, °C
      </text>
      <GridY y={yt} ticks={[-10, 0, 10, 20, 30]} x0={60} x1={620} format={(v) => fmt(v)} baseline={0} />
      <path d={linePath(t.map(x), r.days.map((d) => yt(Math.max(-10, Math.min(30, d.air)))))} fill="none" stroke="#aaa" strokeWidth={1.3} />
      <path d={linePath(t.map(x), r.days.map((d) => yt(Math.max(-10, Math.min(30, d.grain)))))} fill="none" stroke={GRAPHIC.red} strokeWidth={2.5} />
      <text className="ax" x={60} y={172}>
        Allowable storage time used
      </text>
      <GridY y={ys} ticks={[0, 0.5, 1, 1.5]} x0={60} x1={620} format={(v) => `${fmt(v * 100)}%`} baseline={0} />
      <path d={areaPath(t.map(x), sp.map(ys), sp.map(() => ys(0)))} fill={mix('#fcfcfb', CROP_LINE.corn, 0.5)} />
      <line x1={60} x2={620} y1={ys(1)} y2={ys(1)} stroke={GRAPHIC.red} strokeDasharray="5 4" />
      <text className="ax ax-e" x={618} y={ys(1) - 4} style={{ fill: TEXT.red }}>
        spoiling
      </text>
      {ticks.map((k) => (
        <text key={k.m} className="ax ax-m" x={x(k.t + 14)} y={290}>
          {k.m}
        </text>
      ))}
    </svg>
  );
}

function Bin({ r, aeration }: { r: BinResult; aeration: boolean }) {
  const last = r.days[r.days.length - 1];
  const temp = Math.max(-10, Math.min(30, last.grain));
  const color = mix('#b9d3ea', '#e9a07a', (temp + 10) / 40);
  return (
    <svg className="diagram" viewBox="0 0 640 120" role="img" aria-label={`A bin of corn at ${fmt(last.grain, 1)} °C, aeration fans ${aeration ? 'on' : 'off'}.`}>
      <path d="M260 40 L320 14 L380 40 Z" fill="#d9d4c8" />
      <rect x={260} y={40} width={120} height={70} fill="#ece7dc" stroke="#999" />
      <rect x={262} y={52} width={116} height={56} fill={color} />
      <text className="lab" x={320} y={84} textAnchor="middle">
        {fmt(last.grain, 1)} °C
      </text>
      <g transform="translate(400 96)">
        <circle r={10} fill="none" stroke={aeration ? GRAPHIC.blue : '#bbb'} strokeWidth={2} />
        <path d="M0 -8 L3 0 L0 8 M-8 0 L0 3 L8 0" stroke={aeration ? GRAPHIC.blue : '#bbb'} strokeWidth={2} fill="none" />
        <text className="ax" x={16} y={4}>
          fan {aeration ? 'on in cold weather' : 'off'}
        </text>
      </g>
    </svg>
  );
}

export default function Lesson() {
  const s = useScenario('silo', { dryTo: 15, aeration: 'on' as 'on' | 'off', days: TO_JULY, where: 'farm' as 'farm' | 'elevator' });
  const st = s.state;
  const r = useMemo(() => run(st), [st]);
  const solved = useMemo(() => wettestSolved(st), [st]);
  const last = r.days[r.days.length - 1];
  const sellDay = (FILL + st.days) % 365;

  const v = useScenario('inventory', { harvest: 506, exports: 290, pace: 'harvest' as 'harvest' | 'even', capacity: 450 });
  const inv = inventoryYear({ carryIn: 70, harvest: v.state.harvest, domesticPerMonth: 18, exports: v.state.exports, exportPace: EXPORT_PACE[v.state.pace], capacity: v.state.capacity });
  const peak = Math.max(...inv.map((m) => m.stocks));
  const overflowMonths = inv.filter((m) => m.overflow > 0).length;
  const carryOut = inv[inv.length - 1].stocks;

  return (
    <LessonPage id="agriculture/4.2">
      <P>
        Cedar Bend harvests its corn in a few weeks of October, but the corn will be eaten, distilled and shipped over a whole year. Somebody has to hold it in the
        meantime. <a href={lessonHref('agriculture/4.1')}>The previous lesson</a> showed that moisture costs money at the elevator; this one shows why it costs even
        more in a bin.
      </P>
      <P>
        A kernel of stored corn is still alive, and so are the molds and insects that live on it. They respire, burning the grain’s starch and giving off heat and
        water, slowly when the grain is cool and dry and much faster when it is warm and wet. Storage managers think in terms of an <K tone="red">allowable storage
        time</K>: how long grain at a given temperature and moisture keeps before it has lost about half a percent of its dry matter and begins to go out of
        condition. In our model it is 200 days for corn at 15% moisture and 15.6 °C (60 °F), and it roughly halves for every 5.6 °C warmer and every point and a
        half wetter. Two tools stretch it. <K tone="blue">Drying</K> takes the moisture down, at {centsPlain(0.035, 1)} a point. And <K tone="blue">aeration</K> fans
        push cold autumn and winter air through the bin to chill the grain, and are shut off in spring so that warm air doesn’t heat it again. In the next
        demonstration, Cedar Bend fills a bin on {dateLabel(FILL, true)} with corn harvested at {HARVEST_MOISTURE}% moisture. The red line is the grain’s
        temperature, the gray line the air’s; the gold area is the share of the allowable storage time used up. Choose how dry, whether to aerate and how long to
        hold:
      </P>

      <Figure name="Grain Silo" scenario={s}>
        <Bin r={r} aeration={st.aeration === 'on'} />
        <BinChart r={r} />
        <Legend
          items={[
            { label: 'Grain temperature', color: GRAPHIC.red, kind: 'line' },
            { label: 'Air temperature', color: '#aaa', kind: 'line' },
            { label: 'Allowable time used', color: mix('#fcfcfb', CROP_LINE.corn, 0.6) },
          ]}
        />
        <Readouts
          items={[
            { label: `condition on ${dateLabel(sellDay)}`, value: r.spoiledAt >= 0 ? `spoiling since ${dateLabel((FILL + r.spoiledAt) % 365)}` : `sound, ${fmt(last.spoilage * 100)}% used`, tone: r.spoiledAt >= 0 ? 'red' : 'green' },
            { label: 'drying, per bushel', value: centsPlain(r.costs.drying + r.costs.overdrying) },
            { label: 'storage', value: centsPlain(r.costs.storage) },
            { label: 'interest on the grain', value: centsPlain(r.costs.interest) },
            { label: 'total cost of holding', value: centsPlain(r.costs.total), tone: 'red' },
          ]}
        />
        <Segmented
          label="Aeration"
          value={st.aeration}
          onChange={(x) => s.set({ aeration: x })}
          options={[
            { value: 'on', label: 'Aeration fans' },
            { value: 'off', label: 'No aeration' },
          ]}
        />
        <Segmented
          label="Where it is stored"
          value={st.where}
          onChange={(x) => s.set({ where: x })}
          options={[
            { value: 'farm', label: 'Farm bin, 2¢ a month' },
            { value: 'elevator', label: 'Elevator, 3.5¢ a month' },
          ]}
        />
        <Slider label="Dry to" tone="blue" value={st.dryTo} min={13} max={19} step={0.5} onChange={(x) => s.set({ dryTo: x })} display={`${fmt(st.dryTo, 1)}% moisture`} />
        <Slider label="Hold until" value={st.days} min={30} max={MAX_DAYS} onChange={(x) => s.set({ days: x })} display={dateLabel(sellDay)} />
      </Figure>

      <P>
        Dried to 15% and aerated, the corn spends the winter frozen: the fans pull it below freezing by Christmas, and with the bin sealed in spring it warms only
        to about 6 °C by June while the air passes 25. By July 15 it has used a quarter of its allowable time. Without the fans the same corn stays near 7 °C all
        winter and 10 °C by June, and uses 60%. Now make it wetter. Without aeration, 16% corn just makes it to July 15; at 16.5% it starts spoiling in mid-June,
        and at 17% in April. With aeration, the same 17% corn is still sound in July.
      </P>

      <Challenge
        id="a"
        question="Switch the fans off and hold the corn until July 15. What is the wettest it can go into the bin, in half-point steps, without spoiling?"
        solved={solved}
        status={
          st.aeration !== 'off'
            ? 'Switch aeration off.'
            : st.days !== TO_JULY
              ? `The corn is held until ${dateLabel(sellDay)}. Hold it until July 15.`
              : r.spoiledAt >= 0
                ? `At ${fmt(st.dryTo, 1)}% the corn starts spoiling on ${dateLabel((FILL + r.spoiledAt) % 365)}.`
                : `At ${fmt(st.dryTo, 1)}% the corn is sound on July 15, with ${fmt(last.spoilage * 100)}% of its time used. Could it go in wetter?`
        }
        success={`Solved: without aeration, ${fmt(st.dryTo, 1)}% corn reaches July 15 with ${fmt(last.spoilage * 100)}% of its allowable time used; half a point wetter and it would spoil first. Fans let the same bin hold corn a point and a half wetter, saving about 5 cents a bushel of drying — which is why almost every bin built for long storage has them.`}
      />

      <P>
        Real bins are less uniform than our model’s. Grain near the warm south wall stays warmer than grain in the middle, and in autumn the moisture in a warm core
        migrates to the cold surface, where a crust can form and mold. Insects, which our model leaves out, multiply quickly in warm grain. Managers fight all of
        this with temperature cables that read the grain at many depths, with fans, and by moving grain from bin to bin. The model keeps only the main lesson: cool
        and dry keep; warm and wet don’t.
      </P>
      <P>
        Wheat runs the calendar the other way round. It comes out of the field in July, dry enough to store without a dryer, but into the hottest weeks of the year,
        when insects are most active; managers cool it with fans on the first cool nights of autumn. Its long storage season is the winter, when it keeps easily.
      </P>
      <P>
        Look too at what holding costs. Dried to 15%, stored on the farm and held to mid-July, the corn costs 14 cents a bushel to dry, about 18 cents in bins and
        fans, and about 23 cents in interest: at {Math.round(INTEREST * 100)}% a year, money tied up in $4.40 corn costs 2.6 cents a month. That is 54 cents a
        bushel. At a commercial elevator, at 3.5 cents a month, it is 67. Storage only pays if the grain is worth that much more in July than at harvest. Whether it
        is — whether the market pays to store — is the question of <a href={lessonHref('agriculture/5.2')}>Lesson 5.2</a>.
      </P>

      <H2>The valley’s inventory</H2>
      <P>
        Add up every bin and elevator in the Crane Valley and you get its inventory, and it follows the same calendar as a single bin. The harvest arrives in a
        rush; the corn leaves steadily, to ethanol plants and feedyards month by month and to ports at whatever pace exports run. In the next demonstration the bars
        are the valley’s corn stocks at the end of each month of the marketing year, which begins in September; the dashed line is the storage it has. Change the
        harvest and the exports:
      </P>

      <Figure name="Grain Silo · the valley’s inventory" scenario={v}>
        <InventoryBars months={inv} capacity={v.state.capacity} />
        <Readouts
          items={[
            { label: 'peak stocks, million bu', value: fmt(peak), tone: 'gold' },
            { label: 'months over capacity', value: fmt(overflowMonths), tone: overflowMonths ? 'red' : 'ink' },
            { label: 'carried out to next year', value: `${fmt(carryOut)} million bu` },
          ]}
        />
        <Segmented
          label="Export pace"
          value={v.state.pace}
          onChange={(x) => v.set({ pace: x })}
          options={[
            { value: 'harvest', label: 'Heavy after harvest' },
            { value: 'even', label: 'Even through the year' },
          ]}
        />
        <Slider label="Harvest" tone="gold" value={v.state.harvest} min={250} max={650} step={10} onChange={(x) => v.set({ harvest: x })} display={`${fmt(v.state.harvest)} million bu`} />
        <Slider label="Exports" tone="green" value={v.state.exports} min={100} max={400} step={10} onChange={(x) => v.set({ exports: x })} display={`${fmt(v.state.exports)} million bu`} />
        <Slider label="Storage capacity" value={v.state.capacity} min={300} max={600} step={10} onChange={(x) => v.set({ capacity: x })} display={`${fmt(v.state.capacity)} million bu`} />
      </Figure>

      <P>
        With an average harvest of 506 million bushels, 70 million carried in from the year before, 18 million used in the valley each month and 290 million
        exported — most of it in the months after harvest — stocks peak at 410 million bushels in November and fall to 70 million by the end of August, just what
        came in. A big harvest of 600 million fills the valley’s 450 million bushels of storage in November and leaves 49 million on the ground; spread the exports
        evenly through the year and the overflow lasts into January. When the bins are full, grain has to move at once, at whatever price will move it — and that
        harvest-time squeeze, like the cost of holding grain, will show up in the shape of prices. First, though, the grain has to be bought, sorted and shipped,
        which is the work of the elevator in the next lesson. In <FigRef to="Grain Silo">the bin</FigRef> we held one farm’s corn; the elevator holds everyone’s.
      </P>
    </LessonPage>
  );
}

function InventoryBars({ months, capacity }: { months: ReturnType<typeof inventoryYear>; capacity: number }) {
  const x = scale(0, 12, 60, 620);
  const y = scale(0, 650, 220, 24);
  const w = (x(1) - x(0)) * 0.7;
  return (
    <svg
      className="chart"
      viewBox="0 0 640 250"
      role="img"
      aria-label={`The valley’s corn stocks at the end of each month: ${months.map((m) => `${m.month} ${fmt(m.stocks)}`).join(', ')} million bushels, against ${fmt(capacity)} million of storage.`}
    >
      <text className="ax" x={60} y={14}>
        Corn in storage, million bushels
      </text>
      <GridY y={y} ticks={[0, 200, 400, 600]} x0={60} x1={620} format={(t) => fmt(t)} baseline={0} />
      {months.map((m, i) => {
        const cx = x(i + 0.5);
        const inside = Math.min(m.stocks, capacity);
        return (
          <g key={m.month}>
            <rect x={cx - w / 2} y={y(inside)} width={w} height={y(0) - y(inside)} fill={CROP_LINE.corn} opacity={0.75} />
            {m.overflow > 0 && <rect x={cx - w / 2} y={y(m.stocks)} width={w} height={y(inside) - y(m.stocks)} fill={GRAPHIC.red} opacity={0.7} />}
            <text className="ax ax-m" x={cx} y={238}>
              {MARKETING_MONTHS[i]}
            </text>
          </g>
        );
      })}
      <line x1={60} x2={620} y1={y(capacity)} y2={y(capacity)} stroke="#333" strokeDasharray="6 4" />
      <text className="ax ax-e" x={618} y={y(capacity) - 5}>
        storage capacity
      </text>
    </svg>
  );
}

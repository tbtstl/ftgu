import { useMemo } from 'react';
import { Caption, Challenge, FigRef, Figure, H2, K, Legend, LessonPage, P, Readouts, Segmented, Slider, fmt, lessonHref, pct, usd, useScenario } from '../../../framework';
import { crude } from '../../../engines/oil/assay';
import { COKER, COKE_HC, FCC_OPEX, FUEL_HC, carbonRejected, fccConversion, fccMargin, fccYields, hydrogenToUpgrade, type FccPrices } from '../../../engines/oil/refining';
import { CRUDE_SPECS } from '../../../model/oil/crudes';
import { CRUDE_PRICE, PRODUCT_PRICE } from '../../../model/oil/refinery';
import { XYChart } from '../shared/charts';

// ---------------------------------------------------------------------------
// The cracker: feed, temperature and prices.

export type Feed = 'ridgeback' | 'northfield' | 'coldwater';
const FEEDS: Feed[] = ['ridgeback', 'northfield', 'coldwater'];
const NAME: Record<Feed, string> = { ridgeback: 'Ridgeback', northfield: 'Northfield', coldwater: 'Coldwater' };

/** How aromatic each crude's gas oil is (its crude's aromaticity, 0–1): rings resist cracking. */
export const FEED_AROMATICITY: Record<Feed, number> = Object.fromEntries(FEEDS.map((f) => [f, CRUDE_SPECS.find((s) => s.id === f)!.aromaticity])) as Record<Feed, number>;

export const T_MIN = 490;
export const T_MAX = 550;
export const T_STEP = 1;

/** The lesson's reference prices, $/bbl (simulated): LCO as a diesel blendstock still to be treated, slurry as fuel oil. */
export const DEFAULT_PRICES: FccPrices = { gasoline: PRODUCT_PRICE.gasoline, lpg: PRODUCT_PRICE.lpg, lco: 88, slurry: 55, feed: 78 };

export function marginAt(feed: Feed, tempC: number, prices: FccPrices = DEFAULT_PRICES): number {
  return fccMargin(fccConversion(tempC, FEED_AROMATICITY[feed]), prices);
}

/** The riser temperature on the slider's grid that maximizes the cracker's margin. */
export function bestTemperature(feed: Feed, prices: FccPrices = DEFAULT_PRICES): number {
  let best = T_MIN;
  let bestM = -Infinity;
  for (let t = T_MIN; t <= T_MAX; t += T_STEP) {
    const m = marginAt(feed, t, prices);
    if (m > bestM + 1e-12) {
      bestM = m;
      best = t;
    }
  }
  return best;
}

/** Challenge a: at the reference prices, the riser temperature that earns the most for the chosen feed. */
export function bestTempSolved(feed: Feed, tempC: number, gasoline: number, lco: number): boolean {
  if (gasoline !== DEFAULT_PRICES.gasoline || lco !== DEFAULT_PRICES.lco) return false;
  return tempC === bestTemperature(feed);
}

// ---------------------------------------------------------------------------
// Hydrogen: carbon out, or hydrogen in.

export type Route = 'reject' | 'add';
export type HeavyFeed = 'gasOil' | 'residue';
/** Specific gravity of the feed for the hydrogen arithmetic. */
export const HEAVY_SG: Record<HeavyFeed, number> = { gasOil: 0.93, residue: 1.0 };
/** Challenge b: the hydrogen a hydrocracker can be given, scf per barrel. */
export const H2_SUPPLY = 1500;
export const HC_STEP = 0.01;

/** Challenge b: the lowest gas-oil H/C ratio (on the slider's 0.01 steps) a hydrocracker can upgrade with 1,500 scf/bbl. */
export function hydrogenLimitSolved(route: Route, feed: HeavyFeed, hc: number): boolean {
  if (route !== 'add' || feed !== 'gasOil') return false;
  const h = (r: number) => hydrogenToUpgrade(r, HEAVY_SG.gasOil);
  return h(hc) <= H2_SUPPLY && h(Math.round((hc - HC_STEP) * 100) / 100) > H2_SUPPLY;
}

const GASOLINE = '#ecc65a';
const LPG = '#9cc6e4';
const LCO = '#d97f3e';
const SLURRY = '#5d4637';
const HYDROGEN = '#2a9d90';

function scf(v: number): string {
  return `${fmt(Math.round(v / 10) * 10)} scf/bbl`;
}

/** Riser, reactor and regenerator, with catalyst circulating. */
function CrackerDiagram({ tempC, X }: { tempC: number; X: number }) {
  const loop = 'M150 196 L150 214 L330 214 L330 66 L392 92 L392 176 L232 150';
  return (
    <svg
      className="diagram"
      viewBox="0 0 640 240"
      role="img"
      aria-label={`A fluid catalytic cracker: hot catalyst from the regenerator meets gas oil at the bottom of the riser and cracks it at ${tempC} °C, converting ${pct(X)} of the feed; the coked catalyst returns to the regenerator, where air burns the coke off at about 700 °C.`}
    >
      {/* Regenerator */}
      <rect x={70} y={70} width={160} height={126} rx={14} fill="#f6e2d2" stroke="#9a9a9a" strokeWidth={2} />
      <text x={150} y={98} textAnchor="middle" style={{ fontSize: 13, fontWeight: 600, fill: '#333' }}>
        Regenerator
      </text>
      <text x={150} y={118} textAnchor="middle" className="ax">
        air burns the coke off
      </text>
      <text x={150} y={138} textAnchor="middle" style={{ fontSize: 13, fontWeight: 500, fill: '#c4382f' }}>
        about 700 °C
      </text>
      <line x1={150} y1={70} x2={150} y2={36} stroke="#b9b9b9" strokeWidth={6} />
      <text x={160} y={42} className="ax">
        flue gas
      </text>
      <line x1={40} y1={182} x2={70} y2={182} stroke="#9a9a9a" strokeWidth={2} markerEnd="url(#fccArrow)" />
      <text x={36} y={176} textAnchor="end" className="ax">
        air
      </text>
      {/* Reactor vessel and stripper */}
      <rect x={300} y={30} width={130} height={62} rx={12} fill="#eef2f6" stroke="#9a9a9a" strokeWidth={2} />
      <rect x={380} y={92} width={24} height={86} fill="#eef2f6" stroke="#9a9a9a" strokeWidth={2} />
      <text x={365} y={52} textAnchor="middle" style={{ fontSize: 12.5, fontWeight: 600, fill: '#333' }}>
        Reactor
      </text>
      {/* Riser */}
      <rect x={322} y={66} width={16} height={150} fill="#eef2f6" stroke="#9a9a9a" strokeWidth={2} />
      <text x={314} y={150} textAnchor="end" style={{ fontSize: 13, fontWeight: 600, fill: '#c4382f' }}>
        {tempC} °C
      </text>
      <text x={314} y={168} textAnchor="end" className="ax">
        riser · a few seconds
      </text>
      {/* Catalyst circulation */}
      <path d={loop} fill="none" stroke="#c9c9c4" strokeWidth={5} strokeLinejoin="round" />
      <path d={loop} className="flow-dots" fill="none" stroke="#6b5a4e" strokeWidth={5} strokeLinejoin="round" style={{ animationDuration: '2.4s' }} />
      <text x={238} y={230} textAnchor="middle" className="ax">
        hot catalyst
      </text>
      <text x={414} y={150} className="ax">
        coked catalyst
      </text>
      {/* Feed and products */}
      <line x1={478} y1={204} x2={342} y2={204} stroke="#a5603a" strokeWidth={3} markerEnd="url(#fccArrow)" />
      <text x={484} y={208} style={{ fontSize: 12, fill: '#333' }}>
        gas oil feed
      </text>
      <line x1={430} y1={46} x2={540} y2={46} stroke={GASOLINE} strokeWidth={5} markerEnd="url(#fccArrow)" />
      <text x={546} y={42} style={{ fontSize: 12, fill: '#333' }}>
        cracked vapors
      </text>
      <text x={546} y={58} className="ax">
        to a fractionator
      </text>
      <defs>
        <marker id="fccArrow" viewBox="0 0 10 10" refX={8} refY={5} markerWidth={6} markerHeight={6} orient="auto-start-reverse">
          <path d="M0 0 L10 5 L0 10 z" fill="#777" />
        </marker>
      </defs>
    </svg>
  );
}

/** Feed (100%) against the liquid products, which add up to more. */
function YieldBars({ X }: { X: number }) {
  const y = fccYields(X);
  const parts = [
    { id: 'gasoline', label: 'gasoline', v: y.gasoline, c: GASOLINE },
    { id: 'lpg', label: 'LPG', v: y.lpg, c: LPG },
    { id: 'lco', label: 'LCO', v: y.lco, c: LCO },
    { id: 'slurry', label: 'slurry', v: y.slurry, c: SLURRY },
  ];
  const total = parts.reduce((s, p) => s + p.v, 0);
  const X0 = 90;
  const W = 470; // pixels for 110%
  const s = (v: number) => (v / 1.1) * W;
  let acc = X0;
  return (
    <svg
      className="chart"
      viewBox="0 0 640 104"
      role="img"
      aria-label={`At ${pct(X)} conversion, a barrel of feed gives ${parts.map((p) => `${pct(p.v)} ${p.label}`).join(', ')}: ${pct(total)} by volume. Gas and coke take ${pct(y.gas + y.coke, 1)} of the feed by weight.`}
    >
      <text x={X0 - 8} y={28} textAnchor="end" style={{ fontSize: 12, fill: '#333' }}>
        Feed
      </text>
      <rect x={X0} y={14} width={s(1)} height={20} fill="#a5603a" opacity={0.75} />
      <text x={X0 + s(1) / 2} y={28} textAnchor="middle" style={{ fontSize: 12, fontWeight: 500, fill: '#fff' }}>
        1 barrel of gas oil
      </text>
      <text x={X0 - 8} y={62} textAnchor="end" style={{ fontSize: 12, fill: '#333' }}>
        Liquids
      </text>
      {parts.map((p) => {
        const x = acc;
        const w = s(p.v);
        acc += w;
        return (
          <g key={p.id}>
            <rect x={x} y={48} width={Math.max(0, w - 1)} height={20} fill={p.c} />
            {w > 46 && (
              <text x={x + w / 2} y={62} textAnchor="middle" style={{ fontSize: 11.5, fontWeight: 500, fill: p.id === 'slurry' ? '#fff' : '#2b2b2b' }}>
                {w > 92 ? `${p.label} ${pct(p.v)}` : pct(p.v)}
              </text>
            )}
          </g>
        );
      })}
      <line x1={X0 + s(1)} x2={X0 + s(1)} y1={10} y2={74} stroke="#333" strokeDasharray="3 3" />
      <text x={X0 + s(total) + 6} y={62} style={{ fontSize: 12, fontWeight: 600, fill: '#ad5310' }}>
        {pct(total)}
      </text>
      <text x={X0} y={92} className="ax">
        plus gas {pct(y.gas, 1)} and coke {pct(y.coke, 1)} of the feed by weight, burned as fuel · dashed line: the feed’s volume
      </text>
    </svg>
  );
}

/** A row of 20 carbon atoms, split into fuel and coke, or topped up with hydrogen. */
function AtomLedger({ route, hc }: { route: Route; hc: number }) {
  const N = 20;
  const share = carbonRejected(hc);
  const coke = Math.round(share * N);
  const h2 = ((FUEL_HC - hc) / 2) * N;
  const xs = Array.from({ length: N }, (_, i) => 70 + i * 26);
  return (
    <svg
      className="diagram"
      viewBox="0 0 640 112"
      role="img"
      aria-label={
        route === 'reject'
          ? `Twenty carbon atoms of feed carrying ${fmt(hc * N)} hydrogen atoms: ${coke} must leave as coke so the other ${N - coke} can carry ${FUEL_HC} hydrogens each.`
          : `Twenty carbon atoms of feed carrying ${fmt(hc * N)} hydrogen atoms need ${fmt(h2, 1)} more hydrogen molecules to reach ${FUEL_HC} hydrogens per carbon.`
      }
    >
      <text x={70} y={16} className="ax">
        20 carbon atoms of feed, with {fmt(hc * N)} hydrogen atoms between them
      </text>
      {xs.map((x, i) => {
        const isCoke = route === 'reject' && i >= N - coke;
        return <circle key={i} cx={x} cy={44} r={10} fill={isCoke ? '#3d3d3d' : '#d0702a'} opacity={isCoke ? 1 : 0.85} />;
      })}
      {route === 'add' &&
        Array.from({ length: Math.round(h2) }, (_, i) => (
          <g key={i}>
            <circle cx={70 + (i % 20) * 26 - 4} cy={74 + Math.floor(i / 20) * 14} r={4} fill={HYDROGEN} />
            <circle cx={70 + (i % 20) * 26 + 4} cy={74 + Math.floor(i / 20) * 14} r={4} fill={HYDROGEN} />
          </g>
        ))}
      <text x={70} y={104} className="ax">
        {route === 'reject'
          ? `${coke} of 20 leave as coke (${COKE_HC} H per C), so the other ${N - coke} can carry ${FUEL_HC} H per C as fuel`
          : `add ${fmt(h2, 1)} H₂ molecules (teal pairs) to bring all 20 up to ${FUEL_HC} H per C`}
      </text>
    </svg>
  );
}

export default function Lesson() {
  const s1 = useScenario('cracker', { feed: 'northfield' as Feed, temp: 530, gasoline: DEFAULT_PRICES.gasoline, lco: DEFAULT_PRICES.lco });
  const { feed, temp, gasoline, lco } = s1.state;
  const prices: FccPrices = { ...DEFAULT_PRICES, gasoline, lco };
  const X = fccConversion(temp, FEED_AROMATICITY[feed]);
  const y = fccYields(X);
  const margin = fccMargin(X, prices);
  const curve = useMemo(() => Array.from({ length: 81 }, (_, i) => 0.5 + i * 0.005).map((x) => [x, fccMargin(x, { ...DEFAULT_PRICES, gasoline, lco })] as [number, number]), [gasoline, lco]);
  const best = useMemo(() => bestTemperature(feed, { ...DEFAULT_PRICES, gasoline, lco }), [feed, gasoline, lco]);
  const bestX = fccConversion(best, FEED_AROMATICITY[feed]);
  const solvedA = bestTempSolved(feed, temp, gasoline, lco);
  const atDefaults = gasoline === DEFAULT_PRICES.gasoline && lco === DEFAULT_PRICES.lco;

  // Numbers for the prose, at the reference prices.
  const y75 = fccYields(0.75);
  const liquids75 = y75.gasoline + y75.lpg + y75.lco + y75.slurry;
  const refBest = useMemo(() => {
    let bx = 0.5;
    let bm = -Infinity;
    for (let i = 0; i <= 400; i++) {
      const x = 0.5 + i * 0.001;
      const m = fccMargin(x, DEFAULT_PRICES);
      if (m > bm) {
        bm = m;
        bx = x;
      }
    }
    return { X: bx, margin: bm };
  }, []);
  const bestT = useMemo(() => Object.fromEntries(FEEDS.map((f) => [f, bestTemperature(f)])) as Record<Feed, number>, []);
  const rbHighLco = useMemo(() => bestTemperature('ridgeback', { ...DEFAULT_PRICES, lco: 100 }), []);
  const rbLowLco = useMemo(() => bestTemperature('ridgeback', { ...DEFAULT_PRICES, lco: 70 }), []);
  const nf = crude('northfield');
  const cw = crude('coldwater');

  const s2 = useScenario('hydrogen', { route: 'reject' as Route, heavy: 'gasOil' as HeavyFeed, hc: 1.7 });
  const { route, heavy, hc } = s2.state;
  const rejected = carbonRejected(hc);
  const h2 = hydrogenToUpgrade(hc, HEAVY_SG[heavy]);
  const hcCurve = useMemo(
    () =>
      Array.from({ length: 56 }, (_, i) => 1.3 + i * 0.01).map((r) => [r, route === 'reject' ? carbonRejected(r) * 100 : hydrogenToUpgrade(r, HEAVY_SG[heavy])] as [number, number]),
    [route, heavy],
  );
  const solvedB = hydrogenLimitSolved(route, heavy, hc);

  return (
    <LessonPage id="oil/3.2">
      <P>
        <a href={lessonHref('oil/3.1')}>Lesson 3.1</a> split every barrel by boiling point. The light end — naphtha, kerosene, diesel — goes on to become fuel more or less
        as it is. The heavy end doesn’t. Northfield Sour is {pct(nf.yields[5])} vacuum gas oil and {pct(nf.yields[6])} vacuum residue, Coldwater Heavy{' '}
        {pct(cw.yields[5])} and {pct(cw.yields[6])}: about half of one barrel and nearly two-thirds of the other. A refinery that can only distill sells that heavy end as
        fuel oil, and fuel oil is cheap. In our model’s reference month, whose prices are simulated, it fetches {usd(PRODUCT_PRICE.hsfo)} a barrel, while Northfield Sour
        costs {usd(CRUDE_PRICE.northfield)} delivered to the refinery. Every barrel of heavy end sold as fuel oil gives back some of what the crude cost.
      </P>
      <P>
        The cure is to break big molecules into small ones. A chain of thirty or forty carbons, cut into pieces, becomes the eight-carbon molecules of gasoline and the
        fifteen-carbon molecules of diesel. This is called <b>conversion</b>, and the workhorse of conversion is the <b>fluid catalytic cracker</b>, or FCC.
      </P>
      <P>
        In an FCC, gas oil is sprayed into a stream of hot catalyst: a fine powder, made mostly of a porous mineral called a zeolite, that flows almost like a liquid when
        gas is blown through it. Together they rush up a tall pipe, the <b>riser</b>, at roughly 500–550 °C, and in a few seconds the catalyst breaks the molecules
        apart. At the top, the cracked vapors leave for a distillation column of their own, while the catalyst, now coated with coke, drops back to the{' '}
        <b>regenerator</b>, where air burns the coke off. That fire heats the catalyst, and the hot catalyst carries the heat back to the riser: the unit runs on the coke
        it makes. In the next demonstration, choose which crude’s gas oil to crack, and set the <K tone="red">riser temperature</K> and two prices:
      </P>

      <Figure name="Cracking Simulator" scenario={s1}>
        <Segmented label="Feed" value={feed} onChange={(v) => s1.set({ feed: v })} options={FEEDS.map((f) => ({ value: f, label: `${NAME[f]} gas oil` }))} />
        <CrackerDiagram tempC={temp} X={X} />
        <YieldBars X={X} />
        <XYChart
          ariaLabel={`The cracker’s margin per barrel of feed against conversion, at gasoline ${usd(gasoline)} and light cycle oil ${usd(lco)}. Now: ${pct(X, 1)} conversion and ${usd(margin, 2)} a barrel; the best riser temperature for this feed, ${best} °C, gives ${pct(bestX, 1)} and ${usd(marginAt(feed, best, prices), 2)}.`}
          height={190}
          x={[0.5, 0.9]}
          y={[-10, 20]}
          xTicks={[0.5, 0.6, 0.7, 0.8, 0.9]}
          yTicks={[-10, 0, 10, 20]}
          xFormat={(v) => pct(v)}
          yFormat={(v) => usd(v)}
          xLabel="conversion"
          yLabel="Margin, $ per barrel of feed"
          series={[{ points: curve, color: '#6d9c37', width: 2.5 }]}
          refs={[{ axis: 'x', at: X, cursor: true }]}
          markers={[{ x: X, y: margin, color: '#3f7a1e', r: 6 }]}
        />
        <Readouts
          items={[
            { label: 'conversion', value: pct(X, 1) },
            { label: <K tone="orange">gasoline yield</K>, value: pct(y.gasoline, 1), tone: 'orange' },
            { label: 'volume gain', value: pct(y.gasoline + y.lpg + y.lco + y.slurry - 1, 1) },
            { label: <K c="price">margin per barrel</K>, value: usd(margin, 2), tone: margin < 0 ? 'red' : 'green' },
          ]}
        />
        <Slider label="Riser temperature" tone="red" value={temp} min={T_MIN} max={T_MAX} step={T_STEP} onChange={(v) => s1.set({ temp: v })} display={`${temp} °C`} />
        <Slider label="Gasoline price" tone="green" value={gasoline} min={70} max={120} onChange={(v) => s1.set({ gasoline: v })} display={`${usd(gasoline)} per barrel`} />
        <Slider label="Light cycle oil value" tone="green" value={lco} min={60} max={110} onChange={(v) => s1.set({ lco: v })} display={`${usd(lco)} per barrel`} />
        <Caption>
          Feed gas oil costs {usd(DEFAULT_PRICES.feed)} a barrel, LPG sells for {usd(DEFAULT_PRICES.lpg)} and slurry for {usd(DEFAULT_PRICES.slurry)}; running the unit costs{' '}
          {usd(FCC_OPEX, 2)} a barrel. All prices are simulated.
        </Caption>
      </Figure>

      <P>
        The hotter the riser, the deeper the cracking. <b>Conversion</b> is the share of the feed that ends up as gasoline or lighter, and at 75% conversion a barrel of
        gas oil gives {pct(y75.gasoline)} of a barrel of gasoline, {pct(y75.lpg)} LPG, {pct(y75.lco)} light cycle oil and {pct(y75.slurry)} slurry oil:{' '}
        {pct(liquids75)} in all. Cracking makes more volume than it consumes, because the small molecules it produces are less dense than the big ones they came from.
        That is the refinery’s <b>volume gain</b>. What the barrel loses is weight: about {pct(y75.gas)} of it becomes gas and {pct(y75.coke, 1)} coke, which the unit
        burns.
      </P>
      <P>
        The products differ in quality as much as in boiling range. The gasoline is good: on the catalyst, molecules rearrange into branched chains and aromatics, the
        knock-resistant shapes of <a href={lessonHref('oil/1.1')}>Lesson 1.1</a>. The LPG is rich in propylene and butylenes — olefins, molecules with a double bond,
        which crude oil hardly contains and petrochemical plants want. The light cycle oil boils in the diesel range but is heavy with aromatics, so it ignites poorly
        and carries much of the feed’s sulfur; it has to be hydrotreated before it can go into diesel. The slurry, the heaviest leftover, goes to fuel oil.
      </P>

      <H2>How hard to crack</H2>
      <P>
        Raise the temperature and the gasoline yield climbs to a peak near 75% conversion; beyond it the cracker <b>overcracks</b>, breaking gasoline into LPG and gas.
        But the best conversion for the refinery isn’t the one with the most gasoline. Each step up in conversion turns light cycle oil, worth {usd(DEFAULT_PRICES.lco)}{' '}
        here as a diesel blendstock, into gasoline worth {usd(DEFAULT_PRICES.gasoline)}, LPG worth {usd(DEFAULT_PRICES.lpg)}, and gas and coke worth nothing. The margin
        chart weighs them all. At the reference prices it peaks at about {pct(refBest.X)} conversion, {usd(refBest.margin, 2)} per barrel of feed, against{' '}
        {usd(fccMargin(0.75, DEFAULT_PRICES), 2)} at 75%.
      </P>
      <P>
        The feed matters too. Aromatic rings are hard to crack, so the gas oils of the sourer, heavier crudes need a hotter riser to reach the same conversion. At the
        reference prices, the most profitable temperature is {bestT.ridgeback} °C for Ridgeback’s gas oil, {bestT.northfield} °C for Northfield’s and {bestT.coldwater} °C
        for Coldwater’s.
      </P>

      <Challenge
        id="a"
        question={`At the reference prices — gasoline ${usd(DEFAULT_PRICES.gasoline)}, light cycle oil ${usd(DEFAULT_PRICES.lco)} — find the riser temperature, to the nearest degree, that earns the most from ${NAME[feed]} gas oil.`}
        solved={solvedA}
        status={
          !atDefaults
            ? `Set the prices back to ${usd(DEFAULT_PRICES.gasoline)} for gasoline and ${usd(DEFAULT_PRICES.lco)} for light cycle oil.`
            : `At ${temp} °C, ${NAME[feed]} gas oil is ${pct(X, 1)} converted and earns ${usd(margin, 2)} a barrel.`
        }
        success={`Solved: ${temp} °C, ${pct(X, 1)} conversion and ${usd(margin, 2)} a barrel. A degree hotter or cooler earns less. Try another feed: the more aromatic the gas oil, the hotter its best riser.`}
      />

      <P>
        Now move the prices. When diesel is dear, light cycle oil is worth more, and the best conversion falls: with it at $100, Ridgeback’s gas oil is best cracked at{' '}
        {rbHighLco} °C, and at $70 the best temperature rises to {rbLowLco} °C. Refiners do shift their crackers this way, between running for gasoline and running for
        distillate, as the prices of the two move — one of the ways a refinery’s output answers the market, which we’ll return to in{' '}
        <a href={lessonHref('oil/5.3')}>Lesson 5.3</a>.
      </P>

      <H2>Carbon out, or hydrogen in</H2>
      <P>
        Why does cracking make coke at all? Count the hydrogen. <a href={lessonHref('oil/1.5')}>Lesson 1.5</a> placed fuels on a scale of{' '}
        <K tone="teal">hydrogen atoms per carbon atom</K>: gasoline, jet fuel and diesel sit near {FUEL_HC}. Gas oil and residue sit lower, around 1.5–1.6, because they
        are rich in the rings and aromatics of <a href={lessonHref('oil/1.2')}>Lesson 1.2</a>. Break a hydrogen-poor molecule into fuel-sized pieces and its hydrogen won’t
        stretch to cover them all. A refinery has two ways out. It can <b>reject carbon</b>: leave some of it behind as coke, which carries only about {COKE_HC} hydrogen
        per carbon, so the rest can be richer. The cracker does this a little; the coker does it wholesale. Or it can <b>add hydrogen</b>, in a hydrocracker: cracking
        under high hydrogen pressure, which turns gas oil mostly into diesel and jet fuel. In the next demonstration, choose a route and a feed, and set the feed’s
        hydrogen content:
      </P>

      <Figure name="Cracking Simulator · hydrogen" scenario={s2}>
        <Segmented
          label="Route"
          value={route}
          onChange={(v) => s2.set({ route: v })}
          options={[
            { value: 'reject', label: 'Reject carbon (coker, FCC)' },
            { value: 'add', label: 'Add hydrogen (hydrocracker)' },
          ]}
        />
        <Segmented
          label="Feed"
          value={heavy}
          onChange={(v) => s2.set({ heavy: v })}
          options={[
            { value: 'gasOil', label: `Gas oil (SG ${HEAVY_SG.gasOil})` },
            { value: 'residue', label: `Residue (SG ${fmt(HEAVY_SG.residue, 1)})` },
          ]}
        />
        <AtomLedger route={route} hc={hc} />
        <Legend
          items={
            route === 'reject'
              ? [
                  { label: 'Carbon kept as fuel', color: '#d0702a' },
                  { label: 'Carbon rejected as coke', color: '#3d3d3d' },
                ]
              : [
                  { label: 'Carbon', color: '#d0702a' },
                  { label: 'Hydrogen added', color: HYDROGEN },
                ]
          }
        />
        <XYChart
          ariaLabel={
            route === 'reject'
              ? `Share of the feed’s carbon that must leave as coke against the feed’s hydrogen-to-carbon ratio. At ${fmt(hc, 2)}: ${pct(rejected, 1)}.`
              : `Hydrogen needed per barrel of ${heavy === 'gasOil' ? 'gas oil' : 'residue'} against its hydrogen-to-carbon ratio. At ${fmt(hc, 2)}: ${scf(h2)}.`
          }
          height={190}
          x={[1.3, 1.85]}
          y={route === 'reject' ? [0, 45] : [0, 3000]}
          xTicks={[1.3, 1.4, 1.5, 1.6, 1.7, 1.8]}
          yTicks={route === 'reject' ? [0, 10, 20, 30, 40] : [0, 1000, 2000, 3000]}
          xFormat={(v) => fmt(v, 1)}
          yFormat={(v) => (route === 'reject' ? `${v}%` : fmt(v))}
          xLabel="hydrogen atoms per carbon in the feed"
          yLabel={route === 'reject' ? 'Carbon rejected as coke, %' : 'Hydrogen needed, scf per barrel'}
          series={[{ points: hcCurve, color: route === 'reject' ? '#3d3d3d' : HYDROGEN, width: 2.5 }]}
          refs={[
            { axis: 'x', at: hc, cursor: true },
            ...(route === 'add' ? [{ axis: 'y' as const, at: H2_SUPPLY, color: '#c4382f', label: `${fmt(H2_SUPPLY)} scf/bbl` }] : []),
          ]}
          markers={[{ x: hc, y: route === 'reject' ? rejected * 100 : h2, color: route === 'reject' ? '#3d3d3d' : HYDROGEN, r: 6 }]}
        />
        <Readouts
          items={
            route === 'reject'
              ? [
                  { label: 'carbon rejected as coke', value: pct(rejected, 1) },
                  { label: 'carbon kept as fuel', value: pct(1 - rejected, 1), tone: 'orange' },
                ]
              : [
                  { label: <K tone="teal">hydrogen needed</K>, value: scf(h2), tone: 'teal' },
                  { label: 'carbon kept as fuel', value: '100%', tone: 'orange' },
                ]
          }
        />
        <Slider
          label="Feed hydrogen per carbon"
          tone="teal"
          value={hc}
          min={1.3}
          max={1.85}
          step={HC_STEP}
          onChange={(v) => s2.set({ hc: Math.round(v * 100) / 100 })}
          display={fmt(hc, 2)}
        />
      </Figure>

      <P>
        Gas oil with {fmt(1.6, 1)} hydrogens per carbon must give up {pct(carbonRejected(1.6), 1)} of its carbon as coke to bring the rest up to {FUEL_HC}, or take on about{' '}
        {scf(hydrogenToUpgrade(1.6, HEAVY_SG.gasOil))} of hydrogen. Residue at 1.5 is worse: {pct(carbonRejected(1.5), 1)} of its carbon, or about{' '}
        {scf(hydrogenToUpgrade(1.5, HEAVY_SG.residue))}. Real hydrocrackers do consume well over a thousand standard cubic feet of hydrogen per barrel, and they’re among
        the most expensive units a refinery can build. The cracker gets away with rejecting only a few percent of its feed as coke because it doesn’t convert
        everything: it leaves the most hydrogen-poor part behind as light cycle oil and slurry.
      </P>
      <P>
        The <b>coker</b> is carbon rejection at its bluntest. Residue is heated to around 500 °C and run into a tall drum, where over many hours it cracks into vapors and a
        solid mass of petroleum coke; when one drum is full, the flow switches to its twin and the coke is cut out with jets of high-pressure water. In our model, each
        barrel of residue yields {pct(COKER.lpg)} LPG, {pct(COKER.naphtha)} naphtha and {pct(COKER.gasOil)} gas oil — which goes on to the cracker or the hydrotreater —
        and {fmt(COKER.cokeTonnes, 2)} tonnes of coke, sold as a solid fuel. That is how a refinery turns the {pct(cw.yields[6])} of Coldwater Heavy that is residue into
        something better than fuel oil.
      </P>

      <Challenge
        id="b"
        question={`Suppose a hydrocracker can be given ${fmt(H2_SUPPLY)} scf of hydrogen per barrel. What is the most hydrogen-poor gas oil it can bring up to ${FUEL_HC} hydrogens per carbon — the lowest ratio, to two decimal places?`}
        solved={solvedB}
        status={route !== 'add' || heavy !== 'gasOil' ? 'Choose the hydrocracker route and gas oil.' : `At ${fmt(hc, 2)} hydrogens per carbon, the gas oil needs ${scf(h2)}.`}
        success={`Solved: ${fmt(hc, 2)}, which needs ${scf(h2)}. One step poorer, ${fmt(hc - HC_STEP, 2)}, would need more than ${fmt(H2_SUPPLY)}. Every hundredth of a hydrogen per carbon the feed lacks costs about ${fmt(hydrogenToUpgrade(hc - HC_STEP, HEAVY_SG.gasOil) - h2)} scf a barrel.`}
      />

      <P>
        Either way, the heavy end of the barrel can be turned into fuel, at a price: carbon thrown away as cheap coke, or hydrogen made, usually from natural gas, and
        spent. You can return to <FigRef to="Cracking Simulator">the first demonstration</FigRef> to see how that trade shifts with the prices of gasoline and diesel.
      </P>
      <P>
        A refinery like Calder, without a hydrocracker, spends most of its hydrogen on a different job: taking sulfur out. The streams that need it most are the ones this
        lesson made — light cycle oil and coker gas oil — and the straight-run diesel of sour crudes like Northfield’s. The{' '}
        <a href={lessonHref('oil/3.3')}>next lesson</a> follows the sulfur out, and counts the hydrogen it takes.
      </P>
    </LessonPage>
  );
}


import { useMemo } from 'react';
import {
  Caption,
  Challenge,
  Eq,
  FigRef,
  Figure,
  Frac,
  GRAPHIC,
  H2,
  K,
  Legend,
  LessonPage,
  Op,
  P,
  Readouts,
  Segmented,
  Slider,
  TEXT,
  Tn,
  fmt,
  lessonHref,
  pct,
  usd,
  useScenario,
} from '../../../framework';
import { KESTREL } from '../../../model/shipping/vessels';
import { COMMISSION, annualCargo, ballastDraft, bestSpeed, ladenDraft, speedForDayValue, voyageEstimate, type VoyageSpec } from '../../../engines/shipping/voyage';
import { XYChart } from '../shared/XYChart';

const K_ = KESTREL;

/** The reference round voyage: 3,600 nm in ballast to a coal port, 75,000 t, 3,600 nm laden to China. */
export const VOYAGE = { ballastNm: 3600, ladenNm: 3600, cargo: 75_000, portDays: 5, portCosts: 120_000 } as const;
export const SPEED_MIN = 9;
export const SPEED_MAX = 15;

const LADEN_DRAFT = ladenDraft(K_, VOYAGE.cargo);
const BALLAST_DRAFT = ballastDraft(K_);
const EARNING_DAYS = 355;

const kn = (x: number) => `${fmt(x, 1)} kn`;
const perDay = (x: number) => `${usd(x)}/day`;
const t = (x: number) => `${fmt(x)} t`;

function spec(freight: number, bunkerPrice: number): Omit<VoyageSpec, 'ladenSpeed' | 'ballastSpeed'> {
  return { ...VOYAGE, freight, bunkerPrice };
}

/** The voyage at one speed, laden and ballast alike. */
export function voyageAt(speed: number, freight: number, bunkerPrice: number) {
  return voyageEstimate(K_, { ...spec(freight, bunkerPrice), ladenSpeed: speed, ballastSpeed: speed });
}

/** The best single speed and what it earns. */
export function bestAt(freight: number, bunkerPrice: number) {
  return bestSpeed(K_, spec(freight, bunkerPrice), SPEED_MIN, SPEED_MAX);
}

/** What Kestrel earns at her best speed with bunkers at $600 and freight at $14: the challenge's target. */
export const TARGET_TCE = bestAt(14, 600).result.tce;
export const CHALLENGE_BUNKER = 900;
export const FREIGHT_STEP = 0.5;

/**
 * The challenge: with bunkers at $900 a tonne, the lowest freight rate on the slider's half-dollar
 * grid at which some speed earns at least the old best TCE — and a speed that does.
 */
export function restoreSolved(speed: number, freight: number, bunkerPrice: number): boolean {
  if (Math.abs(bunkerPrice - CHALLENGE_BUNKER) > 1e-9) return false;
  const lower = Math.round((freight - FREIGHT_STEP) * 2) / 2;
  return voyageAt(speed, freight, bunkerPrice).tce >= TARGET_TCE - 1e-6 && bestAt(lower, bunkerPrice).result.tce < TARGET_TCE;
}

/** The lowest freight that restores the target, and its best speed (for the success text and tests). */
export const RESTORE_FREIGHT = (() => {
  for (let f = 8; f <= 25; f += FREIGHT_STEP) if (bestAt(f, CHALLENGE_BUNKER).result.tce >= TARGET_TCE) return f;
  return 25;
})();

// Demonstration 2: the slow-steaming rule across the value of a day.
const BUNKERS = [400, 600, 800] as const;
type Bunker = `${(typeof BUNKERS)[number]}`;
const DAY_VALUES = Array.from({ length: 46 }, (_, i) => 5_000 + i * 1_000);

/** Kestrel's cargo per year when each leg sails at the rule's speed for a day value. */
export function fleetPoint(dayValue: number, bunkerPrice: number) {
  const laden = speedForDayValue(K_, LADEN_DRAFT, dayValue, bunkerPrice);
  const ballast = speedForDayValue(K_, BALLAST_DRAFT, dayValue, bunkerPrice);
  const r = voyageEstimate(K_, { ...spec(0, bunkerPrice), ladenSpeed: laden, ballastSpeed: ballast });
  const voyages = EARNING_DAYS / r.days;
  return { laden, ballast, voyages, cargo: voyages * VOYAGE.cargo };
}

// Numbers quoted in the prose.
const AT14 = voyageAt(14, 14, 600);
const BEST = bestAt(14, 600);
const BEST12 = bestAt(12, 600);
const BEST20 = bestAt(20, 600);
const BEST_800 = bestAt(14, 800);
const RULE_LADEN = speedForDayValue(K_, LADEN_DRAFT, BEST.result.tce, 600);
const RULE_BALLAST = speedForDayValue(K_, BALLAST_DRAFT, BEST.result.tce, 600);
const CARGO11 = annualCargo(K_, { ...VOYAGE, bunkerPrice: 600 }, 11, EARNING_DAYS);
const CARGO14 = annualCargo(K_, { ...VOYAGE, bunkerPrice: 600 }, 14, EARNING_DAYS);
const RULE_15K = { laden: speedForDayValue(K_, LADEN_DRAFT, 15_000, 600), ballast: speedForDayValue(K_, BALLAST_DRAFT, 15_000, 600) };
const RULE_30K = speedForDayValue(K_, LADEN_DRAFT, 30_000, 600);
const RULE_15K_800 = speedForDayValue(K_, LADEN_DRAFT, 15_000, 800);
const RULE_15K_400 = speedForDayValue(K_, LADEN_DRAFT, 15_000, 400);
/** What sailing two tenths of a knot off the best speed costs a day, at the starting settings. */
const FLAT = Math.max(BEST.result.tce - voyageAt(BEST.speed - 0.2, 14, 600).tce, BEST.result.tce - voyageAt(BEST.speed + 0.2, 14, 600).tce);

const BUNKER_DASH: Record<Bunker, string | undefined> = { '400': '2 4', '600': undefined, '800': '7 4' };

export default function Lesson() {
  const opt = useScenario('optimizer', { speed: 14, freight: 14, bunker: 600 });
  const { speed, freight, bunker } = opt.state;
  const r = voyageAt(speed, freight, bunker);
  const best = useMemo(() => bestAt(freight, bunker), [freight, bunker]);
  const curve = useMemo(() => {
    const xs = Array.from({ length: (SPEED_MAX - SPEED_MIN) * 10 + 1 }, (_, i) => SPEED_MIN + i / 10);
    return { xs, ys: xs.map((s) => voyageAt(s, freight, bunker).tce) };
  }, [freight, bunker]);
  const solved = restoreSolved(speed, freight, bunker);
  const atBest = Math.abs(speed - best.speed) < 1e-9;

  const fl = useScenario('fleet', { dayValue: 15_000, bunker: '600' as Bunker });
  const flBunker = Number(fl.state.bunker);
  const sweep = useMemo(
    () =>
      Object.fromEntries(
        BUNKERS.map((b) => {
          const pts = DAY_VALUES.map((h) => fleetPoint(h, b));
          return [String(b), { laden: pts.map((p) => p.laden), ballast: pts.map((p) => p.ballast), cargo: pts.map((p) => p.cargo / 1e6) }];
        }),
      ) as Record<Bunker, { laden: number[]; ballast: number[]; cargo: number[] }>,
    [],
  );
  const now = fleetPoint(fl.state.dayValue, flBunker);
  const sel = sweep[fl.state.bunker];

  let status: string;
  if (Math.abs(bunker - CHALLENGE_BUNKER) > 1e-9) status = `Set bunkers to $${CHALLENGE_BUNKER} a tonne first; they’re at ${usd(bunker)}.`;
  else if (best.result.tce < TARGET_TCE) status = `At ${usd(freight, 2)} a tonne even the best speed, ${kn(best.speed)}, earns only ${perDay(best.result.tce)}.`;
  else if (r.tce < TARGET_TCE) status = `At ${usd(freight, 2)} a tonne Kestrel can earn ${perDay(TARGET_TCE)} or more, but not at ${kn(speed)}: she earns ${perDay(r.tce)}.`;
  else status = `At ${usd(freight, 2)} a tonne and ${kn(speed)} she earns ${perDay(r.tce)}. Would a lower freight rate still do?`;

  return (
    <LessonPage id="shipping/2.3">
      <P>
        In <a href={lessonHref('shipping/1.3')}>Lesson 1.3</a> slowing Kestrel down looked like pure gain. Fuel per day falls roughly with the cube of speed and
        the days at sea rise only in proportion, so every knot given up saves fuel over a voyage. But that lesson counted only fuel. A ship’s days are worth
        something too: every day she spends at sea on one cargo is a day she can’t spend carrying the next, and we saw in{' '}
        <a href={lessonHref('shipping/2.2')}>the previous lesson</a> how quickly days in port add up. So the real question is commercial. How fast should Kestrel
        sail?
      </P>
      <P>
        To answer it, owners turn every voyage into a single daily figure. Take the freight the voyage earns and subtract the brokers’ and charterer’s commissions
        and the <b>voyage costs</b> — bunkers (the industry’s word for ship’s fuel), port charges and any canal tolls. What’s left is what the voyage earned for
        the ship’s time. Divide by the days the voyage took, from the moment she set off empty toward the loading port to the moment the last of the cargo left
        her holds, and you have the <K tone="green">time-charter equivalent</K>, or TCE, in dollars a day. The name comes from the other way of employing a ship,
        hiring her out by the day, which we’ll meet in Chapter 4: the TCE is the daily hire that would have left the owner exactly as well off. It is the number
        that makes a short voyage and a long one, a cheap cargo and a dear one, comparable, and from here on it is the yardstick for almost every decision in this
        course. Commissions on dry bulk fixtures typically total about {pct(COMMISSION)} of the freight. All the prices in this lesson are illustrative.
      </P>
      <P>
        Our reference voyage is a common one for a ship of Kestrel’s size. She sails {fmt(VOYAGE.ballastNm)} nautical miles in ballast to a coal-loading port,
        takes on {t(VOYAGE.cargo)} of coal and carries it {fmt(VOYAGE.ladenNm)} miles to China, spending {VOYAGE.portDays} days in port at the two ends and{' '}
        {usd(VOYAGE.portCosts)} on port charges. She is paid a <K tone="green">freight rate</K> per tonne of coal delivered. In the next demonstration the curve is
        the voyage’s TCE at every speed from {SPEED_MIN} to {SPEED_MAX} knots, sailing laden and in ballast at the same speed. Set her speed, the freight rate and
        the price of bunkers:
      </P>

      <Figure name="Slow Steaming Optimizer" scenario={opt}>
        <XYChart
          ariaLabel={`Kestrel’s TCE on the reference voyage at every speed from ${SPEED_MIN} to ${SPEED_MAX} knots, with freight at ${usd(freight, 2)} a tonne and bunkers at ${usd(bunker)} a tonne. The best speed is ${kn(best.speed)}, earning ${perDay(best.result.tce)}; at ${kn(speed)} she earns ${perDay(r.tce)}.`}
          series={[{ xs: curve.xs, ys: curve.ys, color: GRAPHIC.green, width: 2.5 }]}
          xMin={SPEED_MIN}
          xMax={SPEED_MAX}
          xTicks={[9, 10, 11, 12, 13, 14, 15]}
          xFormat={(x) => `${x} kn`}
          yFormat={(y) => usd(y)}
          xLabel="Speed, laden and in ballast"
          yLabel="TCE, $ per day"
          left={64}
          cursor={speed}
          markers={[
            { x: best.speed, y: best.result.tce, color: TEXT.green, r: 6, label: `best: ${kn(best.speed)}`, anchor: best.speed > 13.5 ? 'end' : 'start', labelDy: -10 },
            ...(atBest ? [] : [{ x: speed, y: r.tce, color: TEXT.teal, r: 4.5 }]),
          ]}
          height={230}
        />
        <Readouts
          items={[
            { label: 'voyage days', value: fmt(r.days, 1), tone: 'teal' },
            { label: 'fuel burned', value: t(r.fuel), tone: 'gold' },
            { label: 'bunker cost', value: usd(r.bunkers), tone: 'green' },
            { label: 'net freight', value: usd(r.net), tone: 'green' },
            { label: 'TCE', value: perDay(r.tce), tone: 'green' },
          ]}
        />
        <Slider label="Speed" tone="teal" value={speed} min={SPEED_MIN} max={SPEED_MAX} step={0.1} onChange={(v) => opt.set({ speed: v })} display={kn(speed)} />
        <Slider label="Freight rate" tone="green" value={freight} min={8} max={25} step={FREIGHT_STEP} onChange={(v) => opt.set({ freight: v })} display={`${usd(freight, 2)}/t`} />
        <Slider label="Bunker price" tone="green" value={bunker} min={300} max={900} step={10} onChange={(v) => opt.set({ bunker: v })} display={`${usd(bunker)}/t`} />
        <Eq label={`TCE equals freight minus commissions minus bunkers minus port costs, divided by voyage days: ${perDay(r.tce)}`}>
          <K tone="green">TCE</K>
          <Op>=</Op>
          <Frac
            top={
              <span>
                <Tn tone="green">{usd(r.grossFreight)}</Tn> − {usd(r.commissions)} − <Tn tone="green">{usd(r.bunkers)}</Tn> − {usd(VOYAGE.portCosts)}
              </span>
            }
            bottom={<Tn tone="teal">{fmt(r.days, 2)} days</Tn>}
          />
          <Op>=</Op>
          <K tone="green">{perDay(r.tce)}</K>
        </Eq>
        <Caption>
          {atBest
            ? `${kn(speed)} is the best speed for this freight rate and bunker price.`
            : `Sailing at ${kn(best.speed)} instead would earn ${perDay(best.result.tce)}, ${usd(Math.abs(best.result.tce - r.tce))} a day more.`}
        </Caption>
      </Figure>

      <P>
        At the starting settings — {usd(14)} a tonne of freight, bunkers at {usd(600)} — Kestrel sailing at 14 knots completes the voyage in{' '}
        {fmt(AT14.days, 1)} days, burns {t(AT14.fuel)} of fuel and earns {perDay(AT14.tce)}. Her best speed is {kn(BEST.speed)}. Slowing to it adds{' '}
        {fmt(BEST.result.days - AT14.days, 1)} days to the voyage but saves {t(AT14.fuel - BEST.result.fuel)} of fuel, {usd(AT14.bunkers - BEST.result.bunkers)}{' '}
        worth, and lifts the TCE to {perDay(BEST.result.tce)}. Go slower still and the curve turns down: the fuel saved no longer pays for the days lost.
      </P>
      <P>
        Notice how flat the top of the curve is. Sailing two tenths of a knot faster or slower than the best speed costs Kestrel only about {usd(FLAT)} a day,
        which is one reason real ships often sail a little faster than a calculation like this suggests. Now move the freight rate. At {usd(12)} a tonne the best speed drops to{' '}
        {kn(BEST12.speed)}; at {usd(20)} it climbs to {kn(BEST20.speed)}. Raise the bunker price instead and it falls: at {usd(800)} a tonne, with freight back at{' '}
        {usd(14)}, the best speed is {kn(BEST_800.speed)}. Dear freight makes days valuable; dear fuel makes knots expensive.
      </P>

      <H2>What a day is worth</H2>
      <P>
        Why does the best speed land where it does? Going one knot faster saves some days, and each day saved is a day the ship can earn somewhere else. It also
        burns more fuel. Below the best speed, the days saved are worth more than the extra fuel; above it, less. At the best speed the two are equal: the extra
        fuel cost of going a little faster is exactly the value of the time it saves. That is the whole of the <b>slow-steaming rule</b>, and the value of a day is
        simply what the ship could earn in it — her TCE.
      </P>
      <P>
        The rule also says the two legs of the voyage deserve different speeds. In ballast Kestrel floats at {fmt(BALLAST_DRAFT, 2)} meters instead of{' '}
        {fmt(LADEN_DRAFT, 2)}, so each knot costs less fuel. Value her days at the {perDay(BEST.result.tce)} she earns at her best single speed, and the rule asks
        for {kn(RULE_LADEN)} laden and {kn(RULE_BALLAST)} in ballast. Her best single speed, {kn(BEST.speed)}, lies between them. Owners do the same in practice,
        quoting separate laden and ballast speeds and consumptions.
      </P>

      <Challenge
        id="a"
        figure="Slow Steaming Optimizer"
        question={
          <>
            Bunkers jump from {usd(600)} to {usd(CHALLENGE_BUNKER)} a tonne. What is the lowest freight rate, to the half dollar, at which Kestrel can still earn the{' '}
            {perDay(TARGET_TCE)} she made at her best speed with bunkers at {usd(600)} and freight at {usd(14)}? Set it in{' '}
            <FigRef to="Slow Steaming Optimizer">the first demonstration</FigRef>, with a speed that earns it.
          </>
        }
        solved={solved}
        status={status}
        success={`Solved. At ${usd(RESTORE_FREIGHT, 2)} a tonne her best speed is ${kn(bestAt(RESTORE_FREIGHT, CHALLENGE_BUNKER).speed)}, earning ${perDay(bestAt(RESTORE_FREIGHT, CHALLENGE_BUNKER).result.tce)}; half a dollar less, and even her best speed falls short. Notice that she doesn’t go back to ${kn(BEST.speed)}: with fuel half again as dear, she makes up some of the cost by sailing slower, and the charterer pays the rest through the freight.`}
      />

      <H2>Speed is supply</H2>
      <P>
        Look at the rule from the other side. When ships are earning well, their days are valuable and they sail fast; when earnings slump, they slow down. In the
        next demonstration, set the value of a ship’s day and the price of bunkers. The upper chart is the best laden speed for every day value from{' '}
        {usd(5_000)} to {usd(50_000)}, at three bunker prices, with the ballast speed dashed for the price you choose. The lower chart is how much coal
        Kestrel can carry in a year on our reference voyage, sailing each leg at those speeds for {EARNING_DAYS} earning days:
      </P>

      <Figure name="Slow Steaming Optimizer · the fleet" scenario={fl}>
        <Segmented
          label="Bunker price"
          value={fl.state.bunker}
          onChange={(v) => fl.set({ bunker: v })}
          options={BUNKERS.map((b) => ({ value: String(b) as Bunker, label: `Bunkers ${usd(b)}/t` }))}
        />
        <Legend
          items={[
            { label: `Laden, bunkers ${usd(flBunker)}/t`, color: GRAPHIC.teal, kind: 'line' },
            { label: 'In ballast', color: GRAPHIC.teal, kind: 'line', dashed: true },
            { label: `Laden at the other bunker prices`, color: '#a8a8a8', kind: 'line', dashed: true },
          ]}
        />
        <XYChart
          ariaLabel={`Best speed against the value of a ship’s day. With bunkers at ${usd(flBunker)} and days worth ${perDay(fl.state.dayValue)}, Kestrel should sail ${kn(now.laden)} laden and ${kn(now.ballast)} in ballast.`}
          series={[
            ...BUNKERS.filter((b) => String(b) !== fl.state.bunker).map((b) => ({
              xs: DAY_VALUES,
              ys: sweep[String(b) as Bunker].laden,
              color: '#a8a8a8',
              width: 1.5,
              dash: BUNKER_DASH[String(b) as Bunker],
            })),
            { xs: DAY_VALUES, ys: sel.ballast, color: GRAPHIC.teal, width: 1.5, dash: '5 4' },
            { xs: DAY_VALUES, ys: sel.laden, color: GRAPHIC.teal, width: 2.5 },
          ]}
          xMin={5_000}
          xMax={50_000}
          yMin={8}
          yMax={16}
          yTicks={[8, 10, 12, 14, 16]}
          xTicks={[10_000, 20_000, 30_000, 40_000, 50_000]}
          xFormat={(x) => `$${fmt(x / 1000)}k`}
          yFormat={(y) => `${y} kn`}
          yLabel="Best speed"
          cursor={fl.state.dayValue}
          markers={[
            { x: fl.state.dayValue, y: now.laden, color: TEXT.teal, label: kn(now.laden), anchor: fl.state.dayValue > 40_000 ? 'end' : 'start', labelDy: 18 },
            { x: fl.state.dayValue, y: now.ballast, color: TEXT.teal, r: 4 },
          ]}
          height={190}
        />
        <XYChart
          ariaLabel={`Kestrel’s coal carried per year against the value of a day, with bunkers at ${usd(flBunker)}: ${fmt(now.cargo / 1e6, 2)} million tonnes at ${perDay(fl.state.dayValue)}.`}
          series={[{ xs: DAY_VALUES, ys: sel.cargo, color: GRAPHIC.orange, width: 2.5 }]}
          xMin={5_000}
          xMax={50_000}
          yMin={0.6}
          yMax={1.1}
          yTicks={[0.6, 0.8, 1.0]}
          xTicks={[10_000, 20_000, 30_000, 40_000, 50_000]}
          xFormat={(x) => `$${fmt(x / 1000)}k`}
          yFormat={(y) => `${fmt(y, 1)}M t`}
          xLabel="Value of a ship’s day"
          yLabel="Cargo carried per year"
          cursor={fl.state.dayValue}
          markers={[{ x: fl.state.dayValue, y: now.cargo / 1e6, color: TEXT.orange, label: `${fmt(now.cargo / 1e6, 2)} million t`, anchor: fl.state.dayValue > 35_000 ? 'end' : 'start', labelDy: 18 }]}
          height={170}
        />
        <Readouts
          items={[
            { label: 'best laden speed', value: kn(now.laden), tone: 'teal' },
            { label: 'best ballast speed', value: kn(now.ballast), tone: 'teal' },
            { label: 'voyages a year', value: fmt(now.voyages, 1) },
            { label: 'coal carried a year', value: t(Math.round(now.cargo / 1000) * 1000), tone: 'orange' },
          ]}
        />
        <Slider
          label="Value of a ship’s day"
          tone="green"
          value={fl.state.dayValue}
          min={5_000}
          max={50_000}
          step={1_000}
          onChange={(v) => fl.set({ dayValue: v })}
          display={perDay(fl.state.dayValue)}
        />
      </Figure>

      <P>
        With bunkers at {usd(600)} and days worth {usd(15_000)}, Kestrel should sail {kn(RULE_15K.laden)} laden and {kn(RULE_15K.ballast)} in ballast. Double the
        value of her days to {usd(30_000)} and her laden speed rises to {kn(RULE_30K)}. Fuel pulls the other way: at {usd(15_000)} a day her laden speed is{' '}
        {kn(RULE_15K_400)} with bunkers at {usd(400)} and {kn(RULE_15K_800)} at {usd(800)}.
      </P>
      <P>
        The lower chart is the consequence. Sailing both legs at 14 knots, Kestrel carries {t(Math.round(CARGO14 / 1000) * 1000)} of coal a year on this route; at
        11 knots, {t(Math.round(CARGO11 / 1000) * 1000)}. That is {pct(CARGO14 / CARGO11 - 1)} more cargo from the same ship, with no change but the setting of her
        engine. Multiply by every ship afloat and speed becomes the fleet’s quickest way to change how much it can carry. Building ships takes years; speeding up
        takes a phone call. When earnings rise, the whole fleet speeds up and carries more; when they fall, it slows and carries less.
      </P>
      <P>
        That is exactly what happened after freight markets collapsed in 2008. With earnings low and fuel expensive for most of the years that followed, a day
        saved was worth little and a tonne of fuel a lot, and slow steaming spread through every corner of shipping. In Chapter 4 we’ll see how this response
        shapes freight rates themselves: a fleet that can speed up or slow down behaves very differently from one that can’t.
      </P>
      <P>
        One question remains. We have valued Kestrel’s days by what she can earn, but her owner also has to pay for every one of them — crew, insurance, repairs,
        and the loan that bought her — whether she is earning or not. In <a href={lessonHref('shipping/2.4')}>the next lesson</a> we’ll add up what a day of
        Kestrel’s life costs, and find the TCE she needs just to break even.
      </P>
    </LessonPage>
  );
}

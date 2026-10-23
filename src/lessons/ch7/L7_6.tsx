import { useMemo, type ReactNode } from 'react';
import {
  Caption,
  Challenge,
  DataTable,
  FUEL,
  Figure,
  H2,
  K,
  LessonPage,
  P,
  Readouts,
  Segmented,
  Slider,
  Tn,
  fmt,
  lessonHref,
  mw,
  usd,
  useScenario,
} from '../../framework';
import { fleetDay, generateFleet } from '../../engines/ops/der';
import {
  DER_RULES,
  ILLUSTRATIVE_PRICES,
  arbitrageValuePerMWday,
  dependableByGroup,
  evaluateAccess,
  indicativeRevenue,
  type AccessResult,
  type DependableByGroup,
  type DerRuleSet,
  type DerService,
} from '../../engines/market/derAccess';
import { standardHistory } from '../../model/history';
import { HOME_LOAD_KW, SOLAR_CF } from '../../model/profiles';

const MAX_HOMES = 10000;
const HOUR = 18;
const CHALLENGE_HOMES = 1000;

// The same seeded fleet as Lesson 7.2 (the first N homes), evaluated at 18:00 with 95% confidence.
const HOMES = generateFleet(MAX_HOMES, 7, 1);
const DAY = fleetDay(HOMES, HOME_LOAD_KW, SOLAR_CF);
const DEMAND = HOMES.map((h) => HOME_LOAD_KW[HOUR] * h.loadScale);

const groupCache = new Map<string, DependableByGroup>();
function groups(n: number, substations: number): DependableByGroup {
  const key = `${n}|${substations}`;
  let g = groupCache.get(key);
  if (!g) {
    g = dependableByGroup(HOMES, DAY, HOUR, substations, DEMAND, { count: n });
    if (groupCache.size > 120) groupCache.clear();
    groupCache.set(key, g);
  }
  return g;
}

// Energy value of storage at the course's prices: zonal (hub) or nodal (Metro), $/MW-day.
const HISTORY = standardHistory();
const ENERGY_VALUE = {
  zonal: arbitrageValuePerMWday(HISTORY.map((d) => d.da)),
  nodal: arbitrageValuePerMWday(HISTORY.map((d) => d.daMetro)),
};
const energyValue = (r: DerRuleSet) => (r.settlement === 'nodal' ? ENERGY_VALUE.nodal : ENERGY_VALUE.zonal);

const SERVICE_LABEL: Record<DerService, string> = { energy: 'Energy', reserves: 'Reserves', capacity: 'Capacity' };
const MARKETS = ['ERCOT', 'PJM', 'IESO'] as const;
type Market = (typeof MARKETS)[number];
const rulesFor = (m: Market, status: 'current' | 'proposed') => DER_RULES.find((r) => r.market === m && r.status === status)!;

function where(r: DerRuleSet): string {
  const parts = (Object.entries(r.services) as Array<[DerService, 'zone' | 'node']>).map(
    ([svc, b]) => `${SERVICE_LABEL[svc].toLowerCase()}: ${b === 'zone' ? 'anywhere in the zone' : 'one node or substation'}`,
  );
  return parts.join('; ');
}

function allQualify(g: DependableByGroup, r: DerRuleSet) {
  return g.nodes.every((n) => r.minMW === null || n.dependableMW >= r.minMW);
}

// Default fleet, for the prose: 2,000 homes over 4 substations.
const REF_G = groups(2000, 4);
const REF = Object.fromEntries(DER_RULES.map((r) => [r.id, evaluateAccess(r, REF_G)])) as Record<string, AccessResult>;
const REF_1000_4 = groups(CHALLENGE_HOMES, 4);

export default function Lesson() {
  const s = useScenario('access', { homes: 2000, substations: 4, market: 'ERCOT' as Market, status: 'current' as 'current' | 'proposed' });
  const { homes, substations, market, status } = s.state;
  const rules = rulesFor(market, status);
  const g = useMemo(() => groups(homes, substations), [homes, substations]);
  const result = evaluateAccess(rules, g);
  const revenue = indicativeRevenue(result, energyValue(rules));
  const services = Object.keys(rules.services) as DerService[];
  const nodeLevel = Object.values(rules.services).includes('node');

  const all = useMemo(() => DER_RULES.map((r) => ({ r, a: evaluateAccess(r, g) })), [g]);

  const adesr = rulesFor('ERCOT', 'proposed');
  const isAdesr = rules.id === adesr.id;
  const nextUp = useMemo(() => (isAdesr && homes === CHALLENGE_HOMES && substations < 12 ? groups(homes, substations + 1) : null), [isAdesr, homes, substations]);
  const qualifyingNow = g.nodes.filter((n) => adesr.minMW === null || n.dependableMW >= adesr.minMW).length;
  const solved = isAdesr && homes === CHALLENGE_HOMES && allQualify(g, adesr) && nextUp !== null && !allQualify(nextUp, adesr);

  const W = 600;
  const boxW = Math.min(110, (W - 40) / substations - 10);
  const gap = (W - 40 - boxW * substations) / Math.max(1, substations - 1 || 1);

  const ruleRows: Array<{ k: string; v: ReactNode }> = [
    { k: 'Status', v: <Tn tone={rules.status === 'current' ? 'green' : 'orange'}>{rules.statusLabel}</Tn> },
    {
      k: 'Smallest aggregation',
      v: rules.minMW === null ? 'Not modeled here' : `${mw(rules.minMW, 1)}${rules.maxMW !== null ? ` (largest ${mw(rules.maxMW)})` : ''}${rules.minNote ? ` — ${rules.minNote}` : ''}`,
    },
    { k: 'Where an aggregation must sit', v: where(rules) },
    { k: 'Batteries behind the meter', v: rules.behindMeter ? (rules.loadReductionOnly ? 'Yes, as demand response (load cuts only)' : 'Yes') : 'No — front-of-meter only' },
    { k: 'Program limits', v: rules.headroomMW ? Object.entries(rules.headroomMW).map(([k, v]) => `${k}: about ${fmt(v as number)} MW of room left`).join('; ') : 'None modeled' },
    { k: 'Energy settled at', v: rules.settlement === null ? '—' : rules.settlement === 'nodal' ? 'Nodal price (here, Metro)' : 'Zonal price (here, the hub)' },
    { k: 'Details', v: rules.notes },
    { k: 'Source', v: rules.source },
  ];

  return (
    <LessonPage id="7.6">
      <P>
        Over the last five lessons we built a virtual power plant: home batteries, aggregated into a fleet, controlled through a platform, placed where the grid needs
        them and scheduled against prices. All of that assumed the fleet could sell into the wholesale market. Whether it can is decided by the market’s rules — and those
        rules are being written right now. This lesson compares three grid operators that are writing them differently. Every rule below is labeled with its status, as
        we verified it on October 22, 2026, mostly from the operators’ own published documents.
      </P>
      <P>
        In the United States, the starting point is <b>FERC Order No. 2222</b>, issued by the Federal Energy Regulatory Commission in September 2020. It requires the
        regional grid operators under FERC’s jurisdiction to let aggregations of distributed energy resources sell energy, capacity and ancillary services in their
        markets, with a minimum aggregation size of no more than 100 kW. Each operator then had to design its own rules and file them for approval. <b>PJM</b>, the largest
        of them, is one. Two of the operators we’ll compare are outside the order entirely: <b>ERCOT</b>, whose Texas market is overseen by the state’s Public Utility
        Commission rather than FERC, and Ontario’s <b>IESO</b>, in Canada.
      </P>
      <P>
        The figure runs the fleet from <a href={lessonHref('7.2')}>Lesson 7.2</a> — the same homes, the same batteries — through each set of rules. What counts is the
        fleet’s dependable capacity at 18:00, with 95% confidence. The homes are spread over a number of distribution substations, because several rule sets care about
        where an aggregation sits:
      </P>

      <Figure name="Market Access Simulator" scenario={s}>
        <Segmented label="Grid operator" value={market} onChange={(v) => s.set({ market: v })} options={MARKETS.map((m) => ({ value: m, label: m }))} />
        <Segmented
          label="Rules"
          value={status}
          onChange={(v) => s.set({ status: v })}
          options={[
            { value: 'current', label: 'In force today' },
            { value: 'proposed', label: 'Proposed or approved' },
          ]}
        />
        <svg
          className="diagram"
          viewBox={`0 0 ${W} 150`}
          role="img"
          aria-label={`${fmt(homes)} homes over ${substations} substations. ${g.nodes.map((n) => `Substation ${n.substation + 1}: ${mw(n.dependableMW, 2)}`).join(', ')}. Whole fleet ${mw(g.zone.dependableMW, 2)}.`}
        >
          <rect x={12} y={8} width={W - 24} height={134} rx={10} fill="none" stroke={nodeLevel ? '#cfcfcf' : FUEL.battery} strokeWidth={nodeLevel ? 1.5 : 2.5} strokeDasharray={nodeLevel ? '5 5' : undefined} />
          <text x={24} y={26} className="ax">
            Whole fleet · {mw(g.zone.dependableMW, 2)} dependable{rules.loadReductionOnly ? ` · ${mw(g.zoneLoadReduction.dependableMW, 2)} as load cuts` : ''}
          </text>
          {g.nodes.map((n, i) => {
            const x = 20 + i * (boxW + gap);
            const ok = rules.behindMeter && (rules.minMW === null || n.dependableMW >= rules.minMW);
            const fill = !nodeLevel ? '#eef3e7' : ok ? '#dcebc9' : '#f3e1df';
            const stroke = !nodeLevel ? '#c9d6b8' : ok ? FUEL.battery : '#e75b55';
            return (
              <g key={i}>
                <rect x={x} y={40} width={boxW} height={90} rx={8} fill={fill} stroke={stroke} strokeWidth={1.5} />
                <text x={x + boxW / 2} y={62} textAnchor="middle" style={{ fontSize: 12, fontWeight: 600, fill: '#333' }}>
                  {substations > 6 ? `S${i + 1}` : `Substation ${i + 1}`}
                </text>
                <text x={x + boxW / 2} y={84} textAnchor="middle" style={{ fontFamily: 'var(--display)', fontSize: 16, fontWeight: 600, fill: '#222' }}>
                  {fmt(n.dependableMW, 2)}
                </text>
                <text x={x + boxW / 2} y={100} textAnchor="middle" className="ax">
                  MW
                </text>
                <text x={x + boxW / 2} y={119} textAnchor="middle" className="ax">
                  {fmt(n.homes)} homes
                </text>
              </g>
            );
          })}
        </svg>
        <Caption>
          {nodeLevel
            ? 'Each substation is a separate aggregation under these rules: green ones meet the minimum size, red ones don’t.'
            : 'Under these rules the whole fleet can form one aggregation.'}
        </Caption>
        <DataTable caption={`${rules.market} rules: ${rules.name}`} rows={ruleRows} rowKey={(r) => r.k} columns={[{ label: `${rules.market} · ${rules.name}`, cell: (r) => <b>{r.k}</b> }, { label: '', cell: (r) => r.v }]} />
        <Readouts
          items={services.map((svc) => ({
            label: `${SERVICE_LABEL[svc].toLowerCase()} · ${usd(revenue[svc] ?? 0)} a year`,
            value: mw(result.eligibleMW[svc] ?? 0, 1),
            tone: (result.eligibleMW[svc] ?? 0) > 0 ? ('green' as const) : ('red' as const),
          }))}
        />
        {result.reasons.length > 0 && <Caption>{result.reasons.join(' ')}</Caption>}
        <Slider label="Homes in the fleet" value={homes} min={500} max={MAX_HOMES} step={500} onChange={(v) => s.set({ homes: v })} display={fmt(homes)} />
        <Slider label="Substations the homes are spread over" value={substations} min={1} max={8} onChange={(v) => s.set({ substations: v })} display={String(substations)} />
        <Caption>
          Revenue is illustrative: energy is valued at what a battery earns from the course’s day-ahead prices ({usd(ENERGY_VALUE.zonal)} per MW-day at the hub,{' '}
          {usd(ENERGY_VALUE.nodal)} at Metro), reserves at ${ILLUSTRATIVE_PRICES.reservePerMWh} per MW-hour for {ILLUSTRATIVE_PRICES.reserveHours} hours a day, and capacity at $
          {ILLUSTRATIVE_PRICES.capacityPerMWday} per MW-day, in every market. The streams overlap, so they can’t simply be added.
        </Caption>
      </Figure>

      <P>
        Start with <b>ERCOT</b>. Its Aggregate Distributed Energy Resource (ADER) pilot began at the Public Utility Commission’s direction in 2022, and aggregations have taken
        part since 2023. As of ERCOT’s October 2026 updates, 293 MW was qualified across nine aggregations — growth driven largely by residential batteries — against a
        pilot-wide limit of 500 MW for energy and 100 MW for its Non-Spin and ECRS reserves, with ECRS already fully subscribed. An ADER is dispatched with load-zone shift
        factors and paid the load-zone price, so for our 2,000-home fleet the whole fleet counts as one aggregation: {mw(REF['ercot-ader'].eligibleMW.energy ?? 0, 1)} for
        energy and the same for reserves, and nothing in the rules we modeled ties the homes to particular substations.
      </P>
      <P>
        Switch to ERCOT’s proposal. Phase 4 of the pilot would add an aggregation type for distribution-connected storage — the Aggregate Distributed Energy Storage
        Resource — that is dispatched at its node, so that it can help relieve congestion, exactly as storage did in <a href={lessonHref('7.4')}>Lesson 7.4</a>. In
        exchange, each aggregation must sit behind a single substation transformer and offer at least 1 MW, it may not provide reserves, and it is still paid the zonal
        price. ERCOT’s Board is scheduled to vote on it on December 7, 2026. With four substations, each of our substations holds about{' '}
        {mw(REF_G.nodes[0].dependableMW, 1)}, so {mw(REF['ercot-adesr'].eligibleMW.energy ?? 0, 1)} qualifies — for energy only.
      </P>

      <Challenge
        id="a"
        question={`Under ERCOT’s proposed Phase 4 rules, spread a ${fmt(CHALLENGE_HOMES)}-home fleet over as many substations as possible while every substation still qualifies.`}
        solved={solved}
        status={
          isAdesr
            ? homes !== CHALLENGE_HOMES
              ? `Set the fleet to ${fmt(CHALLENGE_HOMES)} homes.`
              : `With ${substations} substation${substations > 1 ? 's' : ''}, ${qualifyingNow} of ${substations} hold at least 1 MW of dependable capacity.`
            : 'Choose ERCOT’s proposed rules.'
        }
        success={`Solved: ${substations} substations of about ${fmt(Math.round(CHALLENGE_HOMES / substations))} homes each just clear 1 MW; one more would leave substations short, even though the fleet’s total — ${mw(REF_1000_4.zone.dependableMW, 1)} — hasn’t changed.`}
      />

      <P>
        In <b>PJM</b>, the rules in force today reach only capacity. FERC approved PJM’s capacity-market provisions for distributed resources in 2023, and under them DER
        aggregations could first offer capacity in the auction for the 2028/2029 delivery year, whose results PJM published in July 2026 — though its report on that
        auction records that it received no offers from them. A capacity aggregation may span pricing nodes within a zone, so our whole fleet would count:{' '}
        {mw(REF['pjm-capacity'].eligibleMW.capacity ?? 0, 1)}. Energy and reserves under the new model come later. PJM had planned to
        start them in February 2026, then asked FERC to move the date, and FERC approved February 1, 2028; PJM’s current schedule opens enrollment in November 2027.
      </P>
      <P>
        Under those approved rules, each aggregation must normally sit at one pricing node, with a minimum of 100 kW. There are exceptions: aggregations that provide only
        reserves, up to 5 MW, may span nodes within one utility’s territory; and a limited multi-node option is capped at 167 MW across all of PJM. The local utility gets
        60 days to review each aggregation. In return, energy is priced at the aggregation’s own location — for our fleet, Metro — and in the course’s price history a
        megawatt of storage earns about {fmt(ENERGY_VALUE.nodal / ENERGY_VALUE.zonal, 1)} times as much at Metro as at the hub.
      </P>
      <P>
        Ontario’s <b>IESO</b> moved to nodal prices and a financially binding day-ahead market on May 1, 2025, when its Market Renewal Program went live. Its rules today
        offer our fleet one main route into the wholesale market: the annual Capacity Auction, which is open to demand response. As demand response, a home counts only the
        consumption it can cut — its exports don’t count — so the fleet qualifies for just {mw(REF['ieso-capacity'].eligibleMW.capacity ?? 0, 1)}, less than half of what
        its batteries could deliver. The IESO’s newest design proposal, presented in October 2026, would let aggregations of 1–20 MW sell energy and operating reserve at
        nodal prices — but only for resources connected in front of the customer’s meter, each with its own wholesale revenue meter. Home batteries behind the meter would
        need a separate model, which the IESO has said it will take up in a later engagement. Under the proposal as it stands, our fleet qualifies for nothing.
      </P>

      <H2>The same fleet, six ways</H2>
      <P>Here is the fleet you set up above, run through all six rule sets at once:</P>

      <Figure name="Market Access Simulator · side by side" scenario={s}>
        <DataTable
          caption="Eligible capacity and indicative revenue under each rule set"
          rows={all}
          rowKey={(x) => x.r.id}
          rowClass={(x) => (x.r.id === rules.id ? 'hl' : '')}
          columns={[
            {
              label: 'Rules',
              cell: (x) => (
                <>
                  <b>{x.r.market}</b> · {x.r.name}
                  <br />
                  <span style={{ fontSize: 12 }}>
                    <Tn tone={x.r.status === 'current' ? 'green' : 'orange'}>{x.r.statusLabel}</Tn>
                  </span>
                </>
              ),
            },
            ...(['energy', 'reserves', 'capacity'] as DerService[]).map((svc) => ({
              label: SERVICE_LABEL[svc],
              cell: (x: { r: DerRuleSet; a: AccessResult }) => {
                const v = x.a.eligibleMW[svc];
                if (v === undefined) return <span style={{ color: '#8a8a8a' }}>—</span>;
                const rev = indicativeRevenue(x.a, energyValue(x.r))[svc] ?? 0;
                return (
                  <>
                    {mw(v, 1)}
                    <br />
                    <span style={{ fontSize: 12, color: '#5f5f5f' }}>{usd(rev)}/yr</span>
                  </>
                );
              },
            })),
          ]}
        />
        <Slider label="Homes in the fleet" value={homes} min={500} max={MAX_HOMES} step={500} onChange={(v) => s.set({ homes: v })} display={fmt(homes)} />
        <Slider label="Substations the homes are spread over" value={substations} min={1} max={8} onChange={(v) => s.set({ substations: v })} display={String(substations)} />
        <Caption>A dash means the rules don’t offer that service to this kind of resource. Revenue figures are illustrative.</Caption>
      </Figure>

      <P>
        Three patterns stand out. First, <K>location rules</K> trade access for value: rules that dispatch an aggregation at a node can use it to relieve congestion and,
        in PJM’s case, pay it the nodal price, but they also split a dispersed fleet into small pieces that must each clear a minimum. Second, <K>metering and telemetry
        requirements</K> decide which resources count at all — the IESO proposal’s requirement for a wholesale meter on each front-of-meter resource rules out home
        batteries entirely, while ERCOT’s proposal relies on device-level telemetry and the utility’s existing interval meters. Third, <K>caps and scopes</K> such as
        ERCOT’s pilot limits, or the restriction to demand response in Ontario’s Capacity Auction, can shrink what’s eligible regardless of how good the fleet is.
      </P>
      <P>
        None of these rules is settled for long. ERCOT is working toward moving its aggregations from a pilot into its permanent market rules; PJM is still building the
        systems for 2028; and the IESO’s design is out for comment. The physics of the last five lessons — diversity, latency, congestion, constraints — won’t change. What
        a fleet of home batteries is allowed to do with them will. In the capstone chapter, we’ll put every piece of this course together and run a grid of our own.
      </P>
    </LessonPage>
  );
}

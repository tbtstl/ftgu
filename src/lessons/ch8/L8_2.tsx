import { useMemo, useState } from 'react';
import { Challenge, DataTable, Eq, Figure, H2, K, Legend, LessonPage, Op, P, Readouts, Segmented, Slider, Swatch, TimeChart, Tn, fmt, hour, mw, mwh, pct, signed } from '../../framework';
import { LOAD_LABEL, LOAD_SHAPE } from '../../model/profiles';
import type { LoadKind } from '../../model/types';
import { LOAD_KINDS, defaultDesign, nodeLoad, setNodeKind, updateCapstone, useCapstone, type WeatherId } from './capstone';
import { RESERVE_TARGET, WEATHER, WEATHER_IDS, argmax, checkSystem, kindDemand, nodeDemand, siteName, solarCF, systemDemand, systemOf } from './system';
import { EmptyNote, KIND_COLOR, NODE_COLOR, NodePicker, ResetGridButton } from './ui';

const KIND_TONE: Record<LoadKind, 'orange' | 'blue' | 'gray' | 'violet'> = { residential: 'orange', commercial: 'blue', industrial: 'gray', dataCenter: 'violet' };
const PEAK_BEFORE = 14;

const sum = (xs: number[]) => xs.reduce((s, x) => s + x, 0);

export default function Lesson() {
  const d = useCapstone();
  const [picked, setPicked] = useState('city');
  const node = d.nodes.includes(picked) ? picked : (d.nodes[0] ?? '');

  const loads = nodeDemand(d);
  const region = systemDemand(loads);
  const ph = argmax(region);
  const energy = sum(region);
  const lf = region[ph] > 0 ? energy / 24 / region[ph] : 0;

  const kinds = LOAD_KINDS.map((k) => ({ k, values: node ? kindDemand(d, node, k) : region.map(() => 0) }));
  const here = node ? loads[node] : region.map(() => 0);
  const hereH = argmax(here);
  const connected = node ? nodeLoad(d, node) : 0;
  const gap = connected - here[hereH];

  const start = useMemo(() => {
    const s = defaultDesign();
    return { energy: sum(systemDemand(nodeDemand(s))) };
  }, []);

  // Typical vs hot on the reader's grid, for the prose; and the chosen day's checks.
  const compare = useMemo(() => {
    const t = checkSystem(systemOf(d, 'base', 'typical'));
    const h = checkSystem(systemOf(d, 'base', 'hot'));
    return { t, h };
  }, [d]);
  const checks = d.weather === 'typical' ? compare.t : d.weather === 'hot' ? compare.h : checkSystem(systemOf(d, 'base', d.weather));

  const rows = d.nodes.map((n) => {
    const v = loads[n];
    const h = argmax(v);
    return { n, peak: v[h], h, energy: sum(v) };
  });
  const sumOfPeaks = rows.reduce((s, r) => s + r.peak, 0);

  const solved = d.nodes.length > 0 && ph < PEAK_BEFORE && energy >= start.energy - 0.5;
  const resPeak = argmax(LOAD_SHAPE.residential);
  const comPeak = argmax(LOAD_SHAPE.commercial);
  const indMin = Math.min(...LOAD_SHAPE.industrial);
  const dcMin = Math.min(...LOAD_SHAPE.dataCenter);
  const hot = WEATHER.hot;
  const calm = WEATHER.calm;

  return (
    <LessonPage id="8.2">
      <P>
        In the previous lesson every substation’s demand was a single number. Behind each number are thousands of customers — households, offices and shops, factories,
        server halls — and each kind of customer uses electricity on its own daily rhythm. Getting that rhythm right matters for everything that follows: it sets which
        plants run, when the lines fill up, and what power costs hour by hour.
      </P>
      <P>
        The engine in this lesson builds a day of <K c="demand">demand</K> from four customer types. Each has a normalized daily shape, and at each substation you set how
        large each type is at its own peak. The chart stacks the four for the substation you pick:
      </P>

      <Figure name="Demand Scenario Engine" actions={<ResetGridButton />}>
        {node ? (
          <>
            <NodePicker label="Substation" nodes={d.nodes} value={node} onChange={setPicked} />
            <Legend items={LOAD_KINDS.map((k) => ({ label: LOAD_LABEL[k], color: KIND_COLOR[k] }))} />
            <TimeChart
              ariaLabel={`Demand at ${siteName(node)} by customer type over the day. It peaks at ${fmt(here[hereH])} MW at ${hour(hereH)}; the customers’ own peaks add up to ${fmt(connected)} MW.`}
              stack={kinds.map((x) => ({ values: x.values, color: KIND_COLOR[x.k] }))}
              yLabel={`Demand at ${siteName(node)}, MW`}
              yMin={0}
              yMax={Math.max(100, Math.ceil((connected * 1.12 + 1) / 100) * 100)}
              yFormat={(v) => fmt(v)}
              refLines={connected > 0 ? [{ y: connected, color: '#6b6b6b', label: 'sum of customer peaks' }] : []}
              cursor={hereH}
            />
            {LOAD_KINDS.map((k) => (
              <Slider
                key={k}
                label={`${LOAD_LABEL[k]} at ${siteName(node)}`}
                tone={KIND_TONE[k]}
                value={d.loads[node]?.[k] ?? 0}
                min={0}
                max={1000}
                step={10}
                onChange={(v) => updateCapstone((x) => setNodeKind(x, node, k, v))}
                display={`${fmt(d.loads[node]?.[k] ?? 0)} MW peak`}
              />
            ))}
            <Readouts
              items={[
                { label: `${siteName(node)} peak, ${hour(hereH)}`, value: mw(here[hereH]) },
                { label: 'sum of its customers’ peaks', value: mw(connected) },
                { label: `region peak, ${hour(ph)}`, value: mw(region[ph]) },
                { label: 'region energy per day', value: mwh(energy), tone: 'gold' },
              ]}
            />
          </>
        ) : (
          <EmptyNote>Your grid has no substations. Build one in Lesson 8.1, or reset your grid.</EmptyNote>
        )}
      </Figure>

      <P>
        Each customer type’s demand in an hour is its peak times its shape for that hour, adjusted for the weather and for growth, and a substation’s demand is the sum
        of its four types.{node ? ` At ${siteName(node)} at ${hour(hereH)}, its busiest hour:` : ''}
      </P>
      {node && (
        <Eq label={`Demand at ${siteName(node)} at ${hour(hereH)} by customer type`}>
          <span>
            {siteName(node)}, {hour(hereH)}
          </span>
          <Op>=</Op>
          {kinds.map((x, i) => (
            <span key={x.k} style={{ display: 'contents' }}>
              {i > 0 && <Op>+</Op>}
              <Tn tone={KIND_TONE[x.k]}>{fmt(x.values[hereH])}</Tn>
            </span>
          ))}
          <Op>=</Op>
          <span>{mw(here[hereH])}</span>
        </Eq>
      )}
      <P>
        Real utilities build shapes like these from metered data — load-research samples and, now, smart meters on most homes — for dozens of customer classes rather
        than four, and for every day of the year rather than one. Ours are enough to show the pattern. Homes use the least in the small hours and the most in the evening, when people come home, cook, and switch on lights and air conditioning: the residential shape
        peaks at {hour(resPeak)}. Offices and shops follow the working day and peak at {hour(comPeak)}. Factories run around the clock and never drop below {pct(indMin)} of
        their peak, and data centers barely vary at all, never falling below {pct(dcMin)}.
      </P>
      <P>
        Because the types peak at different hours, a substation’s own peak is lower than the sum of its customers’ peaks, the dashed line.
        {node && connected > 0 ? ` At ${siteName(node)} the gap is ${mw(gap)}, or ${pct(gap / connected, 1)}.` : ''} The ratio of the two is called the{' '}
        <b>diversity factor</b>. It lets equipment that serves many customers be sized for the peak they reach together rather than the sum of their separate peaks.
        {sumOfPeaks > region[ph] * 1.01
          ? ` The same effect works between substations: yours peak at different hours, and their own peaks add up to ${mw(sumOfPeaks)}, against a region peak of ${mw(region[ph])}.`
          : ` Between your substations the effect is small: they all peak between ${hour(Math.min(...rows.map((r) => r.h)))} and ${hour(Math.max(...rows.map((r) => r.h)))}, so their own peaks add up to ${mw(sumOfPeaks)}, barely more than the region’s ${mw(region[ph])}.`}
      </P>

      <Challenge
        id="a"
        question={`Reshape the customer mix so the region’s peak arrives before ${hour(PEAK_BEFORE)}, without letting the day’s total energy fall below the starting design’s ${fmt(start.energy)} MWh.`}
        solved={solved}
        status={`Right now the region peaks at ${hour(ph)} with ${mw(region[ph])}, and uses ${mwh(energy)} a day.`}
        success={`Solved. With more offices and fewer homes, the region now peaks at ${hour(ph)} and uses ${mwh(energy)} a day. A region that peaks earlier in the day is a very different place to build solar: at ${hour(ph)} a solar farm on a clear day produces ${pct(solarCF('typical')[ph])} of its nameplate, against ${pct(solarCF('typical')[18])} at 18:00.`}
      />

      <P>
        The hour of the peak matters because the grid is built for it. Every plant, line and transformer has to be there for the hardest hour of the year, and what
        counts as firm capacity depends on when that hour falls. At an evening peak a solar farm is worth almost nothing; at a midday one, most of its nameplate. In
        regions with a lot of solar the peak that matters has already moved: demand minus solar output, the <b>net demand</b> the other plants must meet, now peaks after
        sunset, and California’s grid operator plans around the steep evening ramp it calls the duck curve. We’ll meet net demand again when we add solar in Lesson 8.4.
      </P>

      <H2>Weather and growth</H2>
      <P>
        On any given day, weather moves demand more than anything else. On a hot day, air conditioning adds load through the afternoon and evening; in our model it adds
        up to {pct(hot.heat.residential)} to residential demand and {pct(hot.heat.commercial)} to commercial between 15:00 and 19:00, with smaller effects on data centers,
        which have to be cooled, and on factories. The same weather changes supply. Our hot day is also still, with {pct(1 - hot.wind)} less wind than usual, and a calm,
        cloudy day loses {pct(1 - calm.wind)} of the wind and {pct(1 - calm.solar)} of the sunshine.
      </P>
      <P>
        Growth scales every customer at once. After roughly two decades of flat demand, many North American utilities now expect growth again, driven by data centers,
        electric vehicles and electric heating. Choose the weather for your grid’s day and the growth since today. The dashed line is the firm capacity of your grid at the
        peak hour, from Lesson 8.1:
      </P>

      <Figure name="Demand Scenario Engine · region" actions={<ResetGridButton />}>
        <Segmented<WeatherId>
          label="Weather"
          value={d.weather}
          onChange={(w) => updateCapstone((x) => ({ ...x, weather: w }))}
          options={WEATHER_IDS.map((w) => ({ value: w, label: WEATHER[w].label }))}
        />
        <Legend items={d.nodes.map((n) => ({ label: siteName(n), color: NODE_COLOR[n] ?? '#999' }))} />
        <TimeChart
          ariaLabel={`Region demand over the ${WEATHER[d.weather].label.toLowerCase()}, stacked by substation, with ${pct(d.growth)} growth. Peak ${fmt(region[ph])} MW at ${hour(ph)} against firm capacity of ${fmt(checks.capacity.firm)} MW.`}
          stack={d.nodes.map((n) => ({ values: loads[n], color: NODE_COLOR[n] ?? '#999' }))}
          yLabel="Region demand, MW"
          yMin={0}
          yMax={Math.max(500, Math.ceil((Math.max(region[ph], checks.capacity.firm) * 1.08) / 250) * 250)}
          yFormat={(v) => fmt(v)}
          refLines={[{ y: checks.capacity.firm, color: '#23776e', label: 'firm capacity at the peak' }]}
          cursor={ph}
        />
        <Slider
          label="Growth since today"
          value={Math.round(d.growth * 100)}
          min={0}
          max={40}
          onChange={(v) => updateCapstone((x) => ({ ...x, growth: v / 100 }))}
          display={signed(d.growth * 100) + '%'}
        />
        <Readouts
          items={[
            { label: `region peak, ${hour(ph)}`, value: mw(region[ph]) },
            { label: 'energy per day', value: mwh(energy), tone: 'gold' },
            { label: 'load factor', value: pct(lf) },
            { label: 'reserve margin at the peak', value: Number.isFinite(checks.capacity.margin) ? pct(checks.capacity.margin) : '—', tone: checks.capacity.ok ? 'green' : 'red' },
          ]}
        />
        <DataTable
          caption="Demand at each substation"
          rows={rows}
          rowKey={(r) => r.n}
          rowClass={(r) => (r.h === ph ? 'hl' : '')}
          columns={[
            {
              label: 'Substation',
              cell: (r) => (
                <>
                  <Swatch color={NODE_COLOR[r.n] ?? '#999'} />
                  {siteName(r.n)}
                </>
              ),
            },
            { label: 'Own peak', cell: (r) => mw(r.peak) },
            { label: 'At', cell: (r) => hour(r.h) },
            { label: 'Energy per day', cell: (r) => mwh(r.energy) },
            { label: 'Share', cell: (r) => (energy > 0 ? pct(r.energy / energy) : '—') },
          ]}
        />
      </Figure>

      <P>
        On your grid, a hot day raises the peak from {mw(compare.t.peakMW)} to {mw(compare.h.peakMW)}, {pct(compare.t.peakMW > 0 ? compare.h.peakMW / compare.t.peakMW - 1 : 0)}{' '}
        more, while firm capacity at the peak falls from {mw(compare.t.capacity.firm)} to {mw(compare.h.capacity.firm)} because there is less wind. The reserve margin goes
        from {pct(compare.t.capacity.margin)} to {pct(compare.h.capacity.margin)}
        {compare.h.capacity.ok ? `, still above the ${pct(RESERVE_TARGET)} target.` : `, below the ${pct(RESERVE_TARGET)} target: on a hot day your grid would fail the capacity check of Lesson 8.1.`}{' '}
        The <b>load factor</b> — average demand divided by the peak — measures how hard the grid’s capacity is used. Hot days lower it, because the extra demand comes only
        in the afternoon and evening, and steady customers such as data centers raise it.
      </P>
      <P>
        A real operator can’t set any of this; it has to forecast it, from weather forecasts, the calendar and years of history. A day ahead, forecasts for a large region
        are typically within a few percent of what happens, and the errors that remain are what the real-time market of Lesson 4.5 settles. Our engine skips the forecast
        and hands the market the day exactly as it will be.
      </P>
      <P>
        Whatever you set here — the customer mix, the weather and the growth — becomes your grid’s day for the next three lessons, and Lesson 8.6 will test the grid on all
        three kinds of day. We now know how much power every substation needs in every hour. The next lesson decides who supplies it, and at what price.
      </P>
    </LessonPage>
  );
}

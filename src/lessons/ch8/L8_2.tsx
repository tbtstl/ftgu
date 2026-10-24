import { useMemo, useState } from 'react';
import { Button, Challenge, DataTable, Eq, FigRef, Figure, H2, K, Legend, LessonPage, Op, P, Readouts, Segmented, Slider, Swatch, TimeChart, Tn, fmt, hour, lessonHref, mw, mwh, pct, signed, useScenario } from '../../framework';
import { LOAD_LABEL, LOAD_SHAPE } from '../../model/profiles';
import type { LoadKind } from '../../model/types';
import { LOAD_KINDS, nodeLoad, setNodeKind, shiftHomesToOffices, updateCapstone, useCapstone, type CapstoneDesign, type WeatherId } from './capstone';
import { PEAK_BEFORE, SHIFT_STEP, peakShiftSolved, shiftedPeakHour } from './challenges';
import { RESERVE_TARGET, WEATHER, WEATHER_IDS, argmax, checkSystem, kindDemand, nodeDemand, siteName, solarCF, systemDemand, systemOf } from './system';
import { EmptyNote, GridControls, GridStrip, KIND_COLOR, NODE_COLOR, NodePicker } from './ui';

const KIND_TONE: Record<LoadKind, 'orange' | 'blue' | 'gray' | 'violet'> = { residential: 'orange', commercial: 'blue', industrial: 'gray', dataCenter: 'violet' };

const edit = (fn: (d: CapstoneDesign) => CapstoneDesign, key?: string) => updateCapstone(fn, { lesson: '8.2', key });

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

  // The what-if: a scratch copy of the grid on a typical day, with some household demand behaving like offices.
  const w = useScenario('peak-shift', { share: 0 });
  const share = Math.max(0, Math.min(1, w.state.share / 100));
  const scratch = useMemo(() => {
    const x = shiftHomesToOffices(d, share);
    const byKind = LOAD_KINDS.map((k) => ({ k, values: systemDemand(Object.fromEntries(x.nodes.map((n) => [n, kindDemand(x, n, k, 'typical')]))) }));
    const total = systemDemand(nodeDemand(x, 'typical'));
    const moved = d.nodes.reduce((a, n) => a + (d.loads[n]?.residential ?? 0), 0) * share;
    return { byKind, total, peak: argmax(total), moved };
  }, [d, share]);
  const shiftSolved = peakShiftSolved(d, share);
  const prevPeak = share >= SHIFT_STEP / 2 ? shiftedPeakHour(d, share - SHIFT_STEP) : scratch.peak;
  const noShiftPeak = shiftedPeakHour(d, 0);

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

  const resPeak = argmax(LOAD_SHAPE.residential);
  const comPeak = argmax(LOAD_SHAPE.commercial);
  const indMin = Math.min(...LOAD_SHAPE.industrial);
  const dcMin = Math.min(...LOAD_SHAPE.dataCenter);
  const hot = WEATHER.hot;
  const calm = WEATHER.calm;

  return (
    <LessonPage id="8.2">
      <GridStrip d={d} lesson="8.2" />
      <P>
        In the previous lesson every substation’s demand was a single number. Behind each number are thousands of customers — households, offices and shops, factories,
        server halls — and each kind of customer uses electricity on its own daily rhythm. Getting that rhythm right matters for everything that follows: it sets which
        plants run, when the lines fill up, and what power costs hour by hour.
      </P>
      <P>
        The engine in this lesson builds a day of <K c="demand">demand</K> from four customer types. Each has a normalized daily shape, and at each substation you set how
        large each type is at its own peak; what you set here is saved in your grid. The chart stacks the four for the substation you pick:
      </P>

      <Figure name="Demand Scenario Engine" actions={<GridControls lesson="8.2" />}>
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
                onChange={(v) => edit((x) => setNodeKind(x, node, k, v), `kind:${node}:${k}`)}
                display={`${fmt(d.loads[node]?.[k] ?? 0)} MW peak`}
              />
            ))}
            <Readouts
              items={[
                { label: `${siteName(node)} peak, ${hour(hereH)}`, value: mw(here[hereH]) },
                { label: 'sum of its customers’ peaks', value: mw(connected) },
              ]}
            />
          </>
        ) : (
          <EmptyNote>
            Your grid has no substations. Build one in <a href={lessonHref('8.1')}>Lesson 8.1</a>, or reset your grid.
          </EmptyNote>
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
        These are the customer shapes of <a href={lessonHref('2.3')}>Lesson 2.3</a>, now at the scale of a whole substation. Homes peak at {hour(resPeak)}, offices and
        shops at {hour(comPeak)}; factories never drop below {pct(indMin)} of their peak, and data centers never below {pct(dcMin)}. Real utilities build shapes like
        these from metered data — load-research samples and, now, smart meters — for dozens of customer classes and every day of the year, rather than four classes and
        one day.
      </P>
      <P>
        Because the types peak at different hours, a substation’s own peak is lower than the sum of its customers’ peaks, the dashed line.
        {node && connected > 0 && here[hereH] > 0 ? (
          <>
            {' '}
            At {siteName(node)} the gap is {mw(gap)}, and the sum of the peaks divided by the combined peak — the diversity factor of{' '}
            <a href={lessonHref('2.3')}>Lesson 2.3</a> — is {fmt(connected / here[hereH], 2)}.
          </>
        ) : (
          <>
            {' '}
            Their ratio is the diversity factor of <a href={lessonHref('2.3')}>Lesson 2.3</a>.
          </>
        )}
        {sumOfPeaks > region[ph] * 1.01
          ? ` The same effect works between substations: yours peak at different hours, and their own peaks add up to ${mw(sumOfPeaks)}, against a region peak of ${mw(region[ph])}.`
          : ` Between your substations the effect is small: they all peak between ${hour(Math.min(...rows.map((r) => r.h)))} and ${hour(Math.max(...rows.map((r) => r.h)))}, so their own peaks add up to ${mw(sumOfPeaks)}, barely more than the region’s ${mw(region[ph])}.`}
      </P>
      <P>
        The hour of the peak matters because the grid is built for it. Every plant, line and transformer has to be there for the hardest hour of the year, and what
        counts as firm capacity depends on when that hour falls. At an evening peak a solar farm is worth almost nothing; at a midday one, most of its nameplate. In
        regions with a lot of solar the peak that matters has already moved: the net load of <a href={lessonHref('3.3')}>Lesson 3.3</a> — demand minus wind and solar
        output, what the other plants must meet — now peaks after sunset, and California’s grid operator plans around the steep evening ramp it calls the duck curve.
        We’ll add more solar to your grid in <a href={lessonHref('8.4')}>Lesson 8.4</a>.
      </P>

      <P>
        How much would the mix have to change to move the region’s peak? In the next demonstration, turn some of the region’s household demand into office and shop
        demand — the same megawatts at their own peaks, on the offices’ daily shape instead of the homes’ — and watch where the typical day’s peak lands. It works on a
        scratch copy of your grid, so nothing is saved unless you apply it:
      </P>

      <Figure
        name="Demand Scenario Engine · peak hour"
        scenario={w}
        actions={
          <Button
            onClick={() => {
              edit((x) => shiftHomesToOffices(x, share));
              w.set({ share: 0 });
            }}
            disabled={share <= 0 || !d.nodes.length}
          >
            Apply to my grid
          </Button>
        }
      >
        {d.nodes.length ? (
          <>
            <Legend items={LOAD_KINDS.map((k) => ({ label: LOAD_LABEL[k], color: KIND_COLOR[k] }))} />
            <TimeChart
              ariaLabel={`Region demand on a typical day by customer type, with ${pct(share)} of household demand behaving like offices. It peaks at ${fmt(scratch.total[scratch.peak])} MW at ${hour(scratch.peak)}.`}
              stack={scratch.byKind.map((x) => ({ values: x.values, color: KIND_COLOR[x.k] }))}
              yLabel="Region demand on a typical day, MW"
              yMin={0}
              yFormat={(v) => fmt(v)}
              cursor={scratch.peak}
            />
            <Slider
              label="Household demand that behaves like offices"
              tone="blue"
              value={Math.round(share * 100)}
              min={0}
              max={100}
              step={5}
              onChange={(v) => w.set({ share: v })}
              display={`${pct(share)} · ${mw(scratch.moved)}`}
            />
            <Readouts
              items={[
                { label: 'region peak', value: hour(scratch.peak), tone: scratch.peak < PEAK_BEFORE ? 'blue' : undefined },
                { label: 'demand then', value: mw(scratch.total[scratch.peak]) },
                { label: 'clear-sky solar then, of nameplate', value: pct(solarCF('typical')[scratch.peak]), tone: 'gold' },
              ]}
            />
          </>
        ) : (
          <EmptyNote>Your grid has no substations.</EmptyNote>
        )}
      </Figure>

      <Challenge
        id="a"
        question={`On a typical day, what is the smallest share of the region’s household demand, in steps of 5%, that would have to behave like offices for the region’s peak to arrive before ${hour(PEAK_BEFORE)}? Predict it from the two humps of the chart first.`}
        solved={shiftSolved}
        status={
          share <= 0
            ? `With the mix as it is, the typical day peaks at ${hour(noShiftPeak)}.`
            : scratch.peak < PEAK_BEFORE
              ? `At ${pct(share)} the region peaks at ${hour(scratch.peak)} — but it already did at ${pct(share - SHIFT_STEP)}.`
              : `At ${pct(share)} the region still peaks at ${hour(scratch.peak)}.`
        }
        success={
          noShiftPeak < PEAK_BEFORE
            ? `Solved: your grid already peaks at ${hour(noShiftPeak)}, before ${hour(PEAK_BEFORE)}, with nothing moved.`
            : `Solved: at ${pct(share)} the peak jumps from ${hour(prevPeak)} to ${hour(scratch.peak)}. It doesn’t slide through the afternoon: the day has two humps, the offices’ through the late morning and the homes’ in the evening, and the peak is whichever is higher. At ${hour(scratch.peak)} a solar farm on a clear day produces ${pct(solarCF('typical')[scratch.peak])} of its nameplate, against ${pct(solarCF('typical')[prevPeak])} at ${hour(prevPeak)}.`
        }
      />

      <P>
        Apply the change if you want your grid to keep it, and it becomes the day the next lessons run on; otherwise they use the mix you set in{' '}
        <FigRef to="Demand Scenario Engine">the first demonstration</FigRef>.
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
        peak hour, from <a href={lessonHref('8.1')}>Lesson 8.1</a>:
      </P>

      <Figure name="Demand Scenario Engine · region" actions={<GridControls lesson="8.2" />}>
        <Segmented<WeatherId>
          label="Weather"
          value={d.weather}
          onChange={(wx) => edit((x) => ({ ...x, weather: wx }))}
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
          onChange={(v) => edit((x) => ({ ...x, growth: v / 100 }), 'growth')}
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
          ]}
        />
      </Figure>

      <P>
        On your grid, a hot day raises the peak from {mw(compare.t.peakMW)} to {mw(compare.h.peakMW)}, {pct(compare.t.peakMW > 0 ? compare.h.peakMW / compare.t.peakMW - 1 : 0)}{' '}
        more, while firm capacity at the peak falls from {mw(compare.t.capacity.firm)} to {mw(compare.h.capacity.firm)} because there is less wind. The reserve margin goes
        from {pct(compare.t.capacity.margin)} to {pct(compare.h.capacity.margin)}
        {compare.h.capacity.ok ? (
          `, still above the ${pct(RESERVE_TARGET)} target.`
        ) : (
          <>
            , below the {pct(RESERVE_TARGET)} target: on a hot day your grid would fail the capacity check of <a href={lessonHref('8.1')}>Lesson 8.1</a>.
          </>
        )}{' '}
        The load factor of <a href={lessonHref('2.3')}>Lesson 2.3</a> — average demand divided by the peak — measures how hard the grid’s capacity is used. Hot days lower it, because the extra demand comes only
        in the afternoon and evening, and steady customers such as data centers raise it.
      </P>
      <P>
        A real operator can’t set any of this; it has to forecast it, from weather forecasts, the calendar and years of history. A day ahead, forecasts for a large region
        are typically within a few percent of what happens, and the errors that remain are what the real-time market of <a href={lessonHref('4.5')}>Lesson 4.5</a> settles. Our engine skips the forecast
        and hands the market the day exactly as it will be.
      </P>
      <P>
        Whatever you set here — the customer mix, the weather and the growth — becomes your grid’s day for the next three lessons, and <a href={lessonHref('8.6')}>Lesson 8.6</a> will test the grid on all
        three kinds of day. We now know how much power every substation needs in every hour. The next lesson decides who supplies it, and at what price.
      </P>
    </LessonPage>
  );
}

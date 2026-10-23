# Writing a lesson

Every lesson is one React component at `src/lessons/ch<N>/L<N>_<M>.tsx` (lesson 3.4 →
`src/lessons/ch3/L3_4.tsx`) with a default export whose root is `<LessonPage id="3.4">`. The
registry (`src/course/registry.ts`) already lists every lesson's title and sandbox name; the
file just has to exist for the lesson to appear.

Read these first — they're the reference implementations:

- `src/lessons/ch1/L1_1.tsx` — prose rhythm, a custom SVG diagram, live equations, a challenge.
- `src/lessons/ch1/L1_2.tsx` — an animated figure (`useAnimationFrame`, `usePlay`).
- `src/lessons/ch4/L4_4.tsx` — market figures (`SupplyStackChart`, `DataTable`, `Readouts`).
- `src/lessons/ch5/L5_3.tsx` — a network figure (`NetworkView`) driven by the optimizer.

## Voice and structure

The course reads like a long-form interactive essay: calm, precise, first-person plural ("we'll"),
no hype. Each lesson:

1. Opens with 1–3 paragraphs that connect to the previous lesson and pose the question.
2. Introduces **one** idea at a time, each through a demonstration the reader manipulates, with
   prose before ("Drag the slider to…:" ending in a colon) and after (what to notice, why).
3. Has 2 demonstrations (occasionally 1 or 3), each a `<Figure name="<Sandbox name>">`. The first
   figure's name is exactly the lesson's sandbox name from the registry; later ones add a suffix
   (`"Circuit Builder · two loads"`).
4. Has at least one `<Challenge>` the reader solves with a demonstration's controls; `solved` is
   computed live from that demonstration's state.
5. Uses `H2` section headings for the second half.
6. Ends with a paragraph that hands off to the next lesson.

Aim for ~900–1,600 words of prose. No filler, no bullet-point summaries, no "In this lesson you
will learn". Every number in prose must be true of the model (compute it, don't guess), and every
real-world claim must be accurate; if unsure, leave it out. American spelling. Use curly
apostrophes and quotes (’ “ ”) and an en dash for ranges, an em dash for asides — as in the
reference lessons.

## Color-coded terms

A concept keeps one color across the course (`src/framework/tokens.ts`):

| Concept | Tone | Use |
| --- | --- | --- |
| voltage | blue | `<K c="voltage">` |
| current | orange | `<K c="current">` |
| resistance, phase | violet | `<K c="resistance">` |
| power, losses | red | `<K c="power">` |
| energy | gold | `<K c="energy">` |
| price, money | green | `<K c="price">` |
| frequency | teal | `<K c="frequency">` |

Introduce a term with `<K>` the first time, and color the matching slider (`tone="blue"`), its
readout and the figure's mark the same way. Generation technologies use `FUEL` colors.

## The framework (`src/framework`, import from `'../../framework'`)

- Prose: `P`, `H2`, `List`, `K` (key term), `Tn` (colored text), `Eq` + `Op` + `Frac` + `Sub` + `Sup`.
- Figure shell: `Figure` (`name`, `scenario` → Save / saved list / Reset, `play`, `actions`).
- Controls: `Slider` (`tone`, `display`), `Segmented`, `Checkbox`, `Button`, `Controls` (2 columns).
- Output: `Readouts` (big numbers), `Caption` (live sentence), `Legend`, `DataTable`, `Swatch`.
- Charts: `TimeChart` (hourly stacked areas, lines, steps, bars, scrubbing), `SupplyStackChart`,
  `NetworkView` (nodes, lines, animated flow dots, loading colors), `GridY`/`AxisX`, `scale`,
  `linePath`, `areaPath`, `stepPath`, `niceTicks`.
- State: `useScenario(key, defaults)` → `{ state, set, reset, saved, save, load }`; pass it to
  `<Figure scenario={...}>`. Use one scenario per figure (shared if two figures show one model).
- Animation: `useAnimationFrame(cb, running)`, `usePlay()`, `useSimulation(init, step, running)`.
- Format: `fmt`, `usd`, `price`, `mw`, `mwh`, `kw`, `kwh`, `pct`, `signed`, `hour`, `si`.
- Colors: `TEXT`, `GRAPHIC`, `FUEL`, `PHASE`, `priceFill`, `tint`, `mix`.
- Links: `lessonHref('3.2')` → `#/3.2`.

Custom SVG is welcome when a figure needs it: give the `<svg>` `className="diagram"` (or
`"chart"`), a `viewBox` about 560–640 wide, `role="img"` and an `aria-label` that states the
current values. Use the `.ax`, `.lab`, `.gl`, `.base`, `.cur` classes for axis text and lines, and
`className="flow-dots"` on a path for moving dots (set `animationDuration` to `18 / speed` s).
Interactive SVG elements need keyboard access (`tabIndex`, `role="button"`, Enter/Space).

## The engines and the shared model

Simulation logic belongs in `src/engines`, not in components:

- `engines/physics`: `circuits`, `ac`, `machines` (generator emf, transformer), `losses`
  (line loss), `powerflow` (`computePtdf`, `dcPowerFlow`, `findIslands`).
- `engines/ops`: `dispatch` (`dispatchHour`, `dispatchDay`, `unitsFromFleet`), `frequency`
  (`simulateTrip`, `stepFrequency`, `DEFAULT_FREQUENCY`), `storage` (`stepBattery`, `runBattery`).
- `engines/market`: `lp` (`solveLP`), `opf` (`dcopf` — DC-OPF with LMPs, N-1, load shedding),
  `clearing` (`clearMeritOrder`, `supplyStack`, `settle`, `clearTwoSided`), `settlement`
  (`twoSettlement`, `virtualPnL`, `ftrPayoff`, `cfdPayoff`, `forwardPnL`), `ancillary`
  (`coOptimize`, `capacityAuction`).
- `engines/strategy`: `arbitrage` (`optimizeArbitrage`), `risk` (`summarize`, `maxDrawdown`,
  `walkForward`, `equityCurve`, `valueAtRisk`).

The shared world (`src/model`): `STANDARD_FLEET` (nine plants with costs, ramps, inertia, nodes),
`REGION` (six-node, eight-line network) and `REGION_LOAD_SHARE`, `THREE_NODE`, `SYSTEM_DEMAND`,
`WIND_CF`, `SOLAR_CF`, `LOAD_SHAPE`, `HOME_LOAD_KW`, `standardHistory()` (120 days of DA/RT hub
and nodal prices with demand, weather and outages), `rng(seed)`. From Chapter 2 on, use these
rather than inventing new plants or networks, so the reader meets the same Lakeside
combined-cycle plant in every chapter. Small illustrative numbers are fine in a figure that needs
them, as long as the prose says so.

If a lesson needs simulation code the engines don't have, add a **new** file under
`src/engines/<domain>/` (pure functions, typed, documented) and test it in `tests/ch<N>.test.ts`.
Don't edit existing shared files (framework, engines, model, registry, styles): other lessons are
being written against them at the same time. Use inline styles for one-off styling.

## Performance

Figures re-render on every slider move. Keep work per render under ~10 ms: memoize expensive
sweeps with `useMemo`, keep LPs small (the region network solves in about a millisecond), and
prefer CSS animations (`flow-dots`) over per-frame React state unless the figure is a simulation.

## Accessibility

Real `<button>`s and labelled inputs (the framework's controls handle this). Every chart has an
`aria-label` describing its current state. Don't rely on color alone: label lines and blocks.
Text colors come from `TEXT`/`K`, which meet 4.5:1 contrast.

## Checking your work

```bash
npx tsc --noEmit
npx vitest run tests/lessons.test.tsx -t "lessons 3\."
```

The lesson smoke test renders each lesson, checks the title, figures and challenge, and moves
every slider and segmented control to both ends.

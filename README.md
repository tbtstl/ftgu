# Ground Up

Interactive courses in how markets work, from the ground up. Each course starts with the
physical thing being traded and builds the market on top of it, one simulation at a time.

The first course, **Electricity Grids & Energy Markets**, goes from zero to energy markets: how
the electrical grid works, and how the markets that run it work. Every lesson is a long-form
explanation built around simulations you manipulate — circuits, generators, power flow,
frequency, dispatch, auctions, nodal prices, trading, storage and virtual power plants — ending
in a capstone where you build and operate a grid of your own. Courses on natural gas,
agricultural commodities, oil, weather derivatives, freight and compute capacity are planned.

## Running it

```bash
npm install
npm run dev
```

Then open http://localhost:5173. `npm run build` produces a static site in `dist/` that works
from any path (hash routing, relative assets).

```bash
npm test
```

runs the engine unit tests and a smoke test that renders every lesson and exercises its controls.

## Hosting

The site is a free, read-only resource and stores nothing about its readers: progress (solved
challenges and the last lesson opened) stays in the reader's own browser.

The footer on the home and course pages shows today's weather where the reader is. That comes
from `functions/api/weather.ts`, a Cloudflare Pages Function: deploy `dist/` to Cloudflare Pages
with the `functions/` directory alongside, and it estimates the place from the request, rounds
it to about 10 km, and asks [Open-Meteo](https://open-meteo.com/) for the forecast (cached for 30
minutes per place). Elsewhere, or if there's no estimate, the footer is simply hidden. In
development, `npm run dev` answers the same request with a fixed sample.

## How it's built

- **Course framework** (`src/framework`): page layout, prose and equation components, sliders,
  segmented controls, figures with saved scenarios, challenges with progress tracking, and charts
  (time series, supply stacks, network diagrams).
- **Simulation engines** (`src/engines`), pure TypeScript:
  - `physics` — circuits, AC and three-phase, generators, transformers, line losses, DC power flow.
  - `ops` — economic dispatch with ramp limits, frequency dynamics, batteries.
  - `market` — a simplex LP solver, DC optimal power flow with locational marginal prices and
    N-1 security, merit-order and two-sided clearing, reserves co-optimization, capacity auctions,
    settlement.
  - `strategy` — battery arbitrage by dynamic programming, P&L and risk statistics, walk-forward
    backtesting.
- **Shared grid model** (`src/model`): one fictional region — its power plants, six-node
  transmission network, demand and weather profiles, and 120 days of simulated market history —
  reused from Chapter 2 to the capstone so every lesson describes the same world.
- **Lessons** (`src/lessons/ch<N>/L<N>_<M>.tsx`), listed in `src/course/registry.ts`.

To write or edit a lesson, start with [docs/LESSON_GUIDE.md](docs/LESSON_GUIDE.md).

All prices, plants and market data are simulated for teaching; they are realistic in range but
don't describe any real market.

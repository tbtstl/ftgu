# From The Ground Up (FTGU)

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
challenges and the last lesson opened) and the logo's color stay in the reader's own browser.

The footer on the home and course pages shows today's weather where the reader is, without
asking: the browser's time zone names a city (`America/New_York` → New York), and
`src/pages/zones.ts`, generated from the time zone database's `zone.tab`, gives its coordinates.
A small target beside the city asks the browser for the reader's actual location instead,
rounded to about 10 km and kept only for the visit. The forecast comes straight from
[Open-Meteo](https://open-meteo.com/), so the site works on any static host.

## The mentor

Lessons can show a course mentor: a chat panel beside the lesson (a sheet on phones) that
keeps one conversation per reader per course. Selecting text in a lesson offers to ask about it
or have it explained. Readers sign in to use it, get a few free messages, then pay 1¢ a message
through [Payfer](https://payfer.me) against a monthly limit they choose. The lessons stay free
without an account.

The panel talks to a backend through one interface (`src/mentor/types.ts`). `npm run dev` runs it
against a practice backend in the browser (`src/mentor/mockBackend.ts`) that answers with
placeholders; production builds leave the mentor off. `VITE_MENTOR` (`mock`, `live` or `off`)
chooses.

The real backend is the mentor server in `server/`: a small Node app (Hono, SQLite) that
checks the reader's Privy token, keeps each course's conversation, charges each message through
Payfer (refunding it if no answer comes back) and streams the answer from Claude with the lesson
as context. To run the two together:

```bash
cp server/.env.example server/.env   # then fill in the Privy, Payfer and Claude keys
npm run server                       # http://localhost:8787
npm run dev:live                     # the site, with /api forwarded to the server
```

`npm run dev:live` reads `VITE_PRIVY_APP_ID` from `.env.live.local`; the Payfer publishable key
comes from the server, matching the test or live secret key that `PAYFER_MODE` picks. Both env
files are ignored by git. `MENTOR_MODEL` and `MENTOR_EFFORT` in `server/.env` pick the Claude model
and how much it thinks (Claude Haiku 5.5 at high effort by default, about 0.1¢ an answer).

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

// Shared pieces for the Chapter 8 figures: the capstone map, a site picker, check rows, the
// footer's Undo and Reset controls, the "Your grid" strip, and the 8.6 best-portfolio search.

import { useEffect, useState, type ReactNode } from 'react';
import { Button, FUEL, NetworkView, TEXT, fmt, lessonHref, type NetLine, type NetNode } from '../../framework';
import { REGION } from '../../model/networks';
import type { Generator, LoadKind } from '../../model/types';
import { CORRIDORS, LESSON_RESET, SITES, SITE, resetCapstone, resetLesson, undoCapstone, useUndoable, type CapstoneDesign, type EditingLesson } from './capstone';
import { WEATHER, argmax, nodeDemand, siteName, systemDemand } from './system';
import { bestSearch, planKey, type BestPortfolio } from './strategy';

export const KIND_COLOR: Record<LoadKind, string> = {
  residential: '#eb9b66',
  commercial: '#6f9fd8',
  industrial: '#9c8b7a',
  dataCenter: '#9a8fd8',
};

/** One color per site, for per-node lines in charts. */
export const NODE_COLOR: Record<string, string> = {
  north: '#4590ce',
  east: '#c99a1e',
  center: '#6d9c37',
  harbor: '#2a9d90',
  west: '#8d7b6a',
  city: '#e75b55',
  plains: '#ab70b6',
  lake: '#5aa9d6',
  tech: '#7c6fd0',
};

/** Fuels in merit order, for stacked generation charts. */
export const FUEL_ORDER = ['nuclear', 'coal', 'hydro', 'wind', 'solar', 'battery', 'gasCC', 'gasCT', 'oil'];

export const FUEL_NAME: Record<string, string> = {
  nuclear: 'Nuclear',
  coal: 'Coal',
  hydro: 'Hydro',
  wind: 'Wind',
  solar: 'Solar',
  battery: 'Batteries',
  gasCC: 'Gas CC',
  gasCT: 'Gas peaker',
  oil: 'Oil',
};

export const MAP_W = 600;
export const MAP_H = 410;
const R = 26;

/** A row of buttons for choosing a site; wraps when there are many. */
export function NodePicker({ label, nodes, value, onChange }: { label: string; nodes: string[]; value: string; onChange: (id: string) => void }) {
  if (!nodes.length) return null;
  return (
    <div>
      <div style={{ textAlign: 'center', fontSize: 14, color: '#5f5f5f', margin: '6px 0 4px' }} aria-hidden="true">
        {label}
      </div>
      <div className="seg" role="group" aria-label={label} style={{ flexWrap: 'wrap', maxWidth: 560 }}>
        {nodes.map((n) => (
          <button key={n} type="button" className={n === value ? 'on' : ''} aria-pressed={n === value} onClick={() => onChange(n)} style={{ flex: '1 0 auto', minWidth: 76, fontSize: 15 }}>
            {siteName(n)}
          </button>
        ))}
      </div>
    </div>
  );
}

/** A planning check with a pass/fail mark. */
export function CheckRow({ ok, title, children }: { ok: boolean; title: string; children: ReactNode }) {
  return (
    <div style={{ display: 'flex', gap: 10, alignItems: 'flex-start', maxWidth: 600, margin: '3px auto', fontSize: 15, lineHeight: 1.45 }}>
      <svg width="18" height="18" viewBox="0 0 18 18" aria-hidden="true" style={{ flex: 'none', marginTop: 3 }}>
        {ok ? (
          <path d="M3 9.5 L7.5 14 L15 4.5" fill="none" stroke="#3f6f1b" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" />
        ) : (
          <path d="M4 4 L14 14 M14 4 L4 14" fill="none" stroke="#c4382f" strokeWidth="2.4" strokeLinecap="round" />
        )}
      </svg>
      <span>
        <b style={{ fontWeight: 500, color: ok ? '#3f6f1b' : '#c4382f' }}>
          {title} {ok ? '— passes.' : '— fails.'}
        </b>{' '}
        {children}
      </span>
    </div>
  );
}

/**
 * The footer controls of a Chapter 8 figure: Undo (the lesson's own last change, or a reset of the
 * whole grid), Reset for the lesson's own part of the grid, and Reset for the whole grid. Both
 * resets ask first, inline.
 */
export function GridControls({ lesson }: { lesson: EditingLesson | '8.3' }) {
  const [ask, setAsk] = useState<'lesson' | 'grid' | null>(null);
  const undo = useUndoable(lesson);
  if (ask) {
    const text = ask === 'grid' ? 'Reset your whole grid? This clears everything you’ve built in 8.1–8.6.' : `Reset ${lesson}? ${LESSON_RESET[lesson as EditingLesson]}`;
    return (
      <span role="group" aria-label="Confirm reset" style={{ display: 'inline-flex', flexWrap: 'wrap', alignItems: 'center', gap: 8, color: '#444' }}>
        <span>{text}</span>
        <Button
          primary
          onClick={() => {
            if (ask === 'grid') resetCapstone();
            else resetLesson(lesson as EditingLesson);
            setAsk(null);
          }}
        >
          Reset
        </Button>
        <Button onClick={() => setAsk(null)}>Cancel</Button>
      </span>
    );
  }
  return (
    <>
      {undo !== 'none' && <Button onClick={() => undoCapstone(lesson)}>{undo === 'reset' ? 'Undo reset' : 'Undo'}</Button>}
      {lesson !== '8.3' && <Button onClick={() => setAsk('lesson')}>Reset {lesson}</Button>}
      <Button onClick={() => setAsk('grid')}>Reset grid</Button>
    </>
  );
}

const STRIP_STYLE = { fontSize: 15, lineHeight: 1.5, color: '#5f5f5f', borderTop: '1px solid #e2e2e2', borderBottom: '1px solid #e2e2e2', padding: '7px 0', margin: '0 0 1.2em' } as const;

function StripPart({ lesson, children }: { lesson: string; children: ReactNode }) {
  return (
    <span>
      <a href={lessonHref(lesson)} title={`Built in Lesson ${lesson}`}>
        {children}
      </a>{' '}
      <span style={{ color: TEXT.gray }}>({lesson})</span>
    </span>
  );
}

/** “Your grid so far”: one line at the top of 8.2–8.6 summing up what earlier lessons built, linked to each. */
export function GridStrip({ d, lesson }: { d: CapstoneDesign; lesson: '8.2' | '8.3' | '8.4' | '8.5' | '8.6' }) {
  const n = Number(lesson.split('.')[1]);
  const parts: ReactNode[] = [];
  const start = new Set(REGION.lines.map((l) => l.id));
  const fresh = d.lines.filter((l) => !start.has(l.id)).length;
  const plantMW = d.gens.reduce((a, g) => a + g.capacity, 0);
  parts.push(
    <StripPart key="8.1" lesson="8.1">
      {d.nodes.length
        ? `${d.nodes.length} substation${d.nodes.length === 1 ? '' : 's'}, ${d.lines.length} line${d.lines.length === 1 ? '' : 's'}${fresh ? ` (${fresh} new)` : ''} and ${fmt(plantMW)} MW of plants`
        : 'no substations yet'}
    </StripPart>,
  );
  if (n >= 3 && d.nodes.length) {
    const region = systemDemand(nodeDemand(d));
    const peak = region[argmax(region)] ?? 0;
    parts.push(
      <StripPart key="8.2" lesson="8.2">
        {`a ${WEATHER[d.weather].label.toLowerCase()}${d.growth > 0 ? ` with ${fmt(d.growth * 100)}% growth` : ''}, peaking at ${fmt(peak)} MW`}
      </StripPart>,
    );
  }
  if (n >= 5) {
    const t = d.transition;
    const built = new Set(d.nodes);
    const items = [
      t.windMW > 0 && built.has(t.windNode) && `${fmt(t.windMW)} MW of wind`,
      t.solarMW > 0 && built.has(t.solarNode) && `${fmt(t.solarMW)} MW of solar`,
      t.storageMW > 0 && built.has(t.storageNode) && `a ${fmt(t.storageMW)} MW battery`,
    ].filter(Boolean) as string[];
    parts.push(
      <StripPart key="8.4" lesson="8.4">
        {items.length ? (items.length > 1 ? `${items.slice(0, -1).join(', ')} and ${items[items.length - 1]}` : items[0]) : 'no new wind, solar or storage'}
      </StripPart>,
    );
  }
  if (n >= 6) {
    const homes = d.nodes.reduce((a, x) => a + (d.vpp.mw[x] ?? 0), 0);
    parts.push(
      <StripPart key="8.5" lesson="8.5">
        {`${fmt(homes)} MW of home batteries`}
      </StripPart>,
    );
  }
  return (
    <div style={STRIP_STYLE} role="note" aria-label="Your grid so far">
      <b style={{ fontWeight: 500, color: '#444' }}>Your grid so far:</b>{' '}
      {parts.map((p, i) => (
        <span key={i}>
          {i > 0 && ' · '}
          {p}
        </span>
      ))}
    </div>
  );
}

/** A short status line shown when a figure has nothing to draw. */
export function EmptyNote({ children }: { children: ReactNode }) {
  return <p className="cap" style={{ padding: '24px 0' }}>{children}</p>;
}

export interface GridMapProps {
  d: CapstoneDesign;
  ariaLabel: string;
  /** What to draw inside each built node. */
  nodeInfo?: (id: string) => { value?: string; sub?: string; fill?: string; dead?: boolean };
  /** Base-case flows on built lines, MW. */
  flows?: Record<string, number>;
  /** Line ratings, if different from the design (upgrades). */
  limits?: Record<string, number>;
  /** Label for a built line; '' hides it. */
  lineLabel?: (id: string, flow: number, limit: number) => string;
  /** Lines drawn as out of service. */
  outLines?: string[];
  /** Draw empty sites and unbuilt corridors (the builder). */
  showSites?: boolean;
  selectedNode?: string | null;
  selectedLine?: string | null;
  onNodeClick?: (id: string) => void;
  onLineClick?: (id: string) => void;
  /** What clicking a line does, for screen readers. */
  lineAction?: string;
  /** Plants to draw as small squares at their nodes. */
  plants?: Generator[];
  children?: ReactNode;
}

/** The reader's grid on the region map, drawn with NetworkView. */
export function GridMap({ d, ariaLabel, nodeInfo, flows = {}, limits = {}, lineLabel, outLines = [], showSites, selectedNode, selectedLine, onNodeClick, onLineClick, lineAction, plants, children }: GridMapProps) {
  const built = new Set(d.nodes);
  const sites = SITES.filter((s) => showSites || built.has(s.id));
  const nodes: NetNode[] = sites.map((s) => {
    const isBuilt = built.has(s.id);
    const info = isBuilt ? (nodeInfo?.(s.id) ?? {}) : {};
    return {
      id: s.id,
      x: s.x,
      y: s.y,
      r: R,
      label: s.name,
      labelPos: s.labelPos,
      labelColor: isBuilt ? '#444' : TEXT.gray,
      value: isBuilt ? info.value : '+',
      sub: isBuilt ? info.sub : undefined,
      fill: isBuilt ? (info.fill ?? '#fff') : '#f3f3f3',
      dead: !isBuilt || info.dead,
    };
  });
  const builtLines = new Map(d.lines.map((l) => [l.id, l.limit]));
  const lines: NetLine[] = [];
  for (const c of CORRIDORS) {
    const has = builtLines.has(c.id);
    if (!has && !(showSites && built.has(c.from) && built.has(c.to))) continue;
    if (has) {
      const limit = limits[c.id] ?? builtLines.get(c.id)!;
      const out = outLines.includes(c.id);
      const flow = out ? 0 : (flows[c.id] ?? 0);
      lines.push({ id: c.id, from: c.from, to: c.to, flow, limit, out, label: out ? 'out' : lineLabel ? lineLabel(c.id, flow, limit) : `${fmt(Math.abs(flow))}/${fmt(limit)}` });
    } else {
      lines.push({ id: c.id, from: c.from, to: c.to, flow: 0, out: true, label: '' });
    }
  }

  const sel = selectedNode ? SITE[selectedNode] : null;
  const selLine = selectedLine ? CORRIDORS.find((c) => c.id === selectedLine) : null;
  const badges = plants ?? d.gens;
  return (
    <NetworkView ariaLabel={ariaLabel} width={MAP_W} height={MAP_H} nodes={nodes} lines={lines} onNodeClick={onNodeClick} onLineClick={onLineClick} lineAction={lineAction} flowScale={0.3}>
      {selLine && SITE[selLine.from] && SITE[selLine.to] && (
        <line
          x1={SITE[selLine.from].x}
          y1={SITE[selLine.from].y}
          x2={SITE[selLine.to].x}
          y2={SITE[selLine.to].y}
          stroke="#333"
          strokeOpacity={0.22}
          strokeWidth={22}
          strokeLinecap="round"
          style={{ pointerEvents: 'none' }}
        />
      )}
      {sel && <circle cx={sel.x} cy={sel.y} r={R + 7} fill="none" stroke="#333" strokeWidth={2} strokeDasharray="5 4" style={{ pointerEvents: 'none' }} />}
      {d.nodes.map((n) => {
        const s = SITE[n];
        const gs = badges.filter((g) => g.node === n && g.capacity > 0);
        if (!s || !gs.length) return null;
        const sizes = gs.map((g) => Math.min(16, 6 + 8 * Math.sqrt(g.capacity / 400)));
        const w = sizes.reduce((a, b) => a + b, 0) + 3 * (gs.length - 1);
        let x = s.badges === 'right' ? s.x + R + 6 : s.x - w / 2;
        return (
          <g key={n} style={{ pointerEvents: 'none' }} aria-hidden="true">
            {gs.map((g, i) => {
              const sz = sizes[i];
              const y = s.badges === 'right' ? s.y - sz / 2 : s.badges === 'below' ? s.y + R + 5 : s.y - R - 5 - sz;
              const el = <rect key={g.id} x={x} y={y} width={sz} height={sz} rx={2} fill={FUEL[g.fuel] ?? '#999'} stroke="#fff" strokeWidth={1} />;
              x += sz + 3;
              return el;
            })}
          </g>
        );
      })}
      {children}
    </NetworkView>
  );
}

/** Dollars in millions or billions: dollars(7.7e9) → "$7.70 billion", dollars(4.2e7) → "$42 million". */
export function dollars(x: number): string {
  if (!Number.isFinite(x)) return '—';
  const sign = x < 0 ? '−' : '';
  const a = Math.abs(x);
  if (a >= 1e9) return `${sign}$${(a / 1e9).toFixed(2)} billion`;
  if (a >= 1e6) return `${sign}$${fmt(a / 1e6)} million`;
  return `${sign}$${fmt(a)}`;
}

// ---------------------------------------------------------------------------
// 8.6: the best portfolio for the reader's grid, searched for once per design (off the main
// thread where the browser allows it) and remembered in this browser.

export type BestState =
  | { status: 'working'; tried: number; total: number }
  | { status: 'done'; best: BestPortfolio | null; total: number };

const BEST_KEY = 'emc.capstone.best.v1';
const bestMemo = new Map<string, BestState>();

function hash(s: string): string {
  let h = 5381;
  for (let i = 0; i < s.length; i++) h = ((h << 5) + h + s.charCodeAt(i)) | 0;
  return (h >>> 0).toString(36) + s.length.toString(36);
}

function recall(key: string): BestState | null {
  const hit = bestMemo.get(key);
  if (hit) return hit;
  try {
    const all = JSON.parse(window.localStorage.getItem(BEST_KEY) ?? '{}') as Record<string, { best: BestPortfolio | null; total: number }>;
    const r = all[key];
    if (r && typeof r.total === 'number' && (r.best === null || (Array.isArray(r.best.ids) && Number.isFinite(r.best.score)))) {
      const st: BestState = { status: 'done', best: r.best, total: r.total };
      bestMemo.set(key, st);
      return st;
    }
  } catch {
    // Nothing remembered.
  }
  return null;
}

function remember(key: string, st: BestState) {
  bestMemo.set(key, st);
  if (st.status !== 'done') return;
  try {
    const all = JSON.parse(window.localStorage.getItem(BEST_KEY) ?? '{}') as Record<string, unknown>;
    const keys = Object.keys(all).filter((k) => k !== key).slice(-7);
    const out: Record<string, unknown> = Object.fromEntries(keys.map((k) => [k, all[k]]));
    out[key] = { best: st.best, total: st.total };
    window.localStorage.setItem(BEST_KEY, JSON.stringify(out));
  } catch {
    // Remembered for this visit only.
  }
}

/** The best valid portfolio for the reader's grid, while it's being found and once it is. */
export function useBestPortfolio(d: CapstoneDesign): BestState {
  const key = hash(planKey(d));
  const [state, setState] = useState<{ key: string; st: BestState }>(() => ({ key, st: recall(key) ?? { status: 'working', tried: 0, total: 0 } }));
  useEffect(() => {
    const hit = recall(key);
    if (hit) {
      setState({ key, st: hit });
      return;
    }
    setState({ key, st: { status: 'working', tried: 0, total: 0 } });
    let cancelled = false;
    let worker: Worker | null = null;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const show = (st: BestState) => {
      if (!cancelled) setState({ key, st });
    };
    const finish = (st: BestState) => {
      remember(key, st);
      show(st);
    };
    // On the main thread: a slice of the search at a time, so the page stays responsive.
    const here = () => {
      const s = bestSearch(d);
      const tick = () => {
        if (cancelled) return;
        const t0 = performance.now();
        let done = s.tried >= s.total;
        while (!done && performance.now() - t0 < 40) done = s.step();
        if (done) finish({ status: 'done', best: s.best, total: s.total });
        else {
          show({ status: 'working', tried: s.tried, total: s.total });
          timer = setTimeout(tick, 30);
        }
      };
      timer = setTimeout(tick, 60);
    };
    if (typeof Worker !== 'undefined') {
      try {
        worker = new Worker(new URL('./best.worker.ts', import.meta.url), { type: 'module' });
        worker.onmessage = (e: MessageEvent<{ key: string; type: string; tried: number; total: number; best?: BestPortfolio | null }>) => {
          if (e.data.key !== key) return;
          if (e.data.type === 'done') finish({ status: 'done', best: e.data.best ?? null, total: e.data.total });
          else show({ status: 'working', tried: e.data.tried, total: e.data.total });
        };
        worker.onerror = () => {
          worker?.terminate();
          worker = null;
          if (!cancelled) here();
        };
        worker.postMessage({ key, design: d });
      } catch {
        worker = null;
        here();
      }
    } else here();
    return () => {
      cancelled = true;
      worker?.terminate();
      if (timer) clearTimeout(timer);
    };
    // The search depends on the design only through its key.
  }, [key]);
  return state.key === key ? state.st : (recall(key) ?? { status: 'working', tried: 0, total: 0 });
}


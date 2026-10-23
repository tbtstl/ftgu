// Shared pieces for the Chapter 8 figures: the capstone map, a site picker, check rows and the
// "Reset my grid" button.

import type { ReactNode } from 'react';
import { Button, FUEL, NetworkView, TEXT, fmt, type NetLine, type NetNode } from '../../framework';
import type { Generator, LoadKind } from '../../model/types';
import { CORRIDORS, SITES, SITE, resetCapstone, type CapstoneDesign } from './capstone';
import { siteName } from './system';

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
    <div style={{ display: 'flex', gap: 10, alignItems: 'flex-start', maxWidth: 560, margin: '6px auto', fontSize: 16, lineHeight: 1.5 }}>
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

export function ResetGridButton() {
  return <Button onClick={resetCapstone}>Reset my grid</Button>;
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

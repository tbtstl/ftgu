// Pieces the Chapter 7 lessons share: the "so far" strip that sums up what earlier lessons of the
// capstone saved, a reset that asks first, and Lesson 7.1's cheapest network as a fixed reference.

import { useState, type ReactNode } from 'react';
import { Button, fmt, lessonHref } from '../../../framework';
import { AS_BUILT, PORTFOLIO_DEFAULTS, systemCost, systemKey, type GasSystem, type PortfolioSettings } from '../../../engines/gas/capstone';
import { CORRIDORS, GAS_NODE, PIPELINE, STORAGE_SPECS } from '../../../model/gas/world';
import type { GasCapstone } from './capstone';
import { bcf, money } from './format';

/**
 * Lesson 7.1's cheapest network that passes both of its tests: a fourth compressor station on the
 * Coastal Line and a fifth on the Valley Line (the tests check it against 7.1's own search).
 */
export const CHEAPEST_NETWORK: GasSystem = {
  sizes: { ...AS_BUILT.sizes },
  stations: { ...AS_BUILT.stations, 'ridgeback-bayport': 4, 'sandhill-metro': 5 },
};

export function sameNetwork(a: GasSystem, b: GasSystem): boolean {
  return systemKey(a) === systemKey(b);
}

/** A line's name: the region's own, or "Bayport–Metro line" for one laid in an empty corridor. */
function lineName(id: string): string {
  const c = CORRIDORS.find((k) => k.id === id)!;
  return PIPELINE[id]?.name ?? `${GAS_NODE[c.from].name}–${GAS_NODE[c.to].name} line`;
}

/** Each changed line, briefly: "Coastal Line, 4 stations", "new Bayport–Metro line, 24-inch". */
export function networkChangesShort(s: GasSystem): string[] {
  return systemCost(s).changed.map((id) => {
    const size = s.sizes[id] ?? 0;
    const n = s.stations[id] ?? 1;
    if (!size) return `${lineName(id)} removed`;
    if (!AS_BUILT.sizes[id]) return `new ${lineName(id)}, ${size}-inch with ${n} station${n === 1 ? '' : 's'}`;
    if (size === AS_BUILT.sizes[id]) return `${lineName(id)}, ${n} station${n === 1 ? '' : 's'}`;
    return `${lineName(id)}, ${size}-inch with ${n} station${n === 1 ? '' : 's'}`;
  });
}

/** Whether a portfolio is the one Lesson 7.4 starts with. */
export function isStartingPortfolio(p: PortfolioSettings): boolean {
  return JSON.stringify({ ...PORTFOLIO_DEFAULTS, ...p }) === JSON.stringify(PORTFOLIO_DEFAULTS);
}

/** The portfolio's positions, briefly: "1.0 Bcf lease, hedged · toll · 10 lots of weather trades". */
export function portfolioShort(p: PortfolioSettings): string {
  const parts: string[] = [];
  const lease = p.storageShare * STORAGE_SPECS.saltflat.workingBcf;
  if (lease > 0) parts.push(`${bcf(lease, Math.round(lease * 100) % 10 === 0 ? 1 : 2)} lease, ${p.storageHedged ? 'hedged' : 'unhedged'}`);
  if (p.firmMMBtuD > 0) parts.push(`${fmt(p.firmMMBtuD)} MMBtu/d firm on ${PIPELINE[p.firmLine].name}`);
  if (p.toll) parts.push('Lakeside toll');
  if (p.weatherLots > 0 && p.skill > 0) parts.push(`${fmt(p.weatherLots)} lots of weather trades`);
  if (p.metroSellMMBtuD > 0) parts.push(`${fmt(p.metroSellMMBtuD)} MMBtu/d of Metro basis sold`);
  return parts.length ? parts.join(', ') : 'no positions';
}

const STRIP_STYLE = { fontSize: 15, lineHeight: 1.5, color: '#5f5f5f', borderTop: '1px solid #e2e2e2', borderBottom: '1px solid #e2e2e2', padding: '7px 0', margin: '0 0 1.2em' } as const;

/** "Your capstone so far": one line at the top of a lesson summing up what earlier lessons saved, linked to each. */
export function CapstoneSoFar({ capstone, portfolio = false }: { capstone: GasCapstone; portfolio?: boolean }) {
  const s = capstone.system;
  const changes = networkChangesShort(s);
  const cost = systemCost(s);
  const parts: ReactNode[] = [
    <span key="7.1">
      <a href={lessonHref('gas/7.1')}>network</a> (7.1):{' '}
      {changes.length ? `${changes.join('; ')} — ${money(cost.added)} of capital` : 'as built, unchanged'}
    </span>,
  ];
  if (portfolio)
    parts.push(
      <span key="7.4">
        <a href={lessonHref('gas/7.4')}>portfolio</a> (7.4): {isStartingPortfolio(capstone.portfolio) ? 'the starting one — ' : ''}
        {portfolioShort(capstone.portfolio)}
      </span>,
    );
  return (
    <div style={STRIP_STYLE} role="note" aria-label="Your capstone so far">
      <b style={{ fontWeight: 500, color: '#444' }}>Your capstone so far:</b>{' '}
      {parts.map((p, i) => (
        <span key={i}>
          {i > 0 && ' · '}
          {p}
        </span>
      ))}
    </div>
  );
}

/** A footer Reset that asks first, inline, and says what it puts back. */
export function ConfirmReset({ label = 'Reset', prompt, onConfirm }: { label?: string; prompt: string; onConfirm: () => void }) {
  const [ask, setAsk] = useState(false);
  if (ask)
    return (
      <span role="group" aria-label="Confirm reset" style={{ display: 'inline-flex', flexWrap: 'wrap', alignItems: 'center', gap: '0 12px', color: '#444' }}>
        <span>{prompt}</span>
        <Button
          primary
          onClick={() => {
            onConfirm();
            setAsk(false);
          }}
        >
          {label}
        </Button>
        <Button onClick={() => setAsk(false)}>Cancel</Button>
      </span>
    );
  return <Button onClick={() => setAsk(true)}>{label}</Button>;
}

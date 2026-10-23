// Radial distribution feeders: which customers have power after a fault, given the state of the
// substation breakers, the sectionalizing switches along each feeder, and the normally-open ties
// between feeders.
//
// Protection is modeled simply: if a faulted section is connected (through closed switches) to a
// live breaker, every breaker feeding that connected group trips and the whole group goes dark.
// Isolating the fault — opening the switches on either side of it — lets the breakers reclose.

export interface FeederSection {
  id: string;
  customers: number;
}

/** A switch between two sections. Ties between feeders are switches that are normally open. */
export interface FeederSwitch {
  id: string;
  a: string;
  b: string;
  closed: boolean;
}

/** A substation breaker feeding the head section of a feeder. */
export interface FeederSource {
  id: string;
  section: string;
  /** False if the substation itself has lost supply. */
  live: boolean;
}

export interface FeederState {
  /** Sections with power. */
  energized: string[];
  /** Breakers that tripped because they were connected to a fault. */
  tripped: string[];
  /** Sections reachable from no live, untripped breaker. */
  dark: string[];
  customersOn: number;
  customersOff: number;
}

/** Energize a set of radial feeders after faults on some sections. */
export function energizeFeeders(sections: FeederSection[], switches: FeederSwitch[], sources: FeederSource[], faults: string[]): FeederState {
  const fault = new Set(faults);
  const adj = new Map<string, string[]>(sections.map((s) => [s.id, []]));
  for (const sw of switches) {
    if (!sw.closed) continue;
    adj.get(sw.a)?.push(sw.b);
    adj.get(sw.b)?.push(sw.a);
  }
  // Connected groups of sections through closed switches.
  const group = new Map<string, number>();
  let n = 0;
  for (const s of sections) {
    if (group.has(s.id)) continue;
    const stack = [s.id];
    group.set(s.id, n);
    while (stack.length) {
      const id = stack.pop()!;
      for (const m of adj.get(id) ?? []) {
        if (!group.has(m)) {
          group.set(m, n);
          stack.push(m);
        }
      }
    }
    n++;
  }
  const faulted = new Set<number>();
  for (const s of sections) if (fault.has(s.id)) faulted.add(group.get(s.id)!);
  const tripped: string[] = [];
  const fed = new Set<number>();
  for (const src of sources) {
    const g = group.get(src.section);
    if (!src.live || g === undefined) continue;
    if (faulted.has(g)) tripped.push(src.id);
    else fed.add(g);
  }
  const energized = sections.filter((s) => fed.has(group.get(s.id)!) && !fault.has(s.id)).map((s) => s.id);
  const on = new Set(energized);
  const customersOn = sections.reduce((t, s) => t + (on.has(s.id) ? s.customers : 0), 0);
  const total = sections.reduce((t, s) => t + s.customers, 0);
  return {
    energized,
    tripped,
    dark: sections.filter((s) => !on.has(s.id)).map((s) => s.id),
    customersOn,
    customersOff: total - customersOn,
  };
}

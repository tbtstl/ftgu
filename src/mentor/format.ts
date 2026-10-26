// Money and dates as the mentor shows them.

/** 342 → "$3.42". */
export function money(cents: number): string {
  return '$' + (cents / 100).toFixed(2);
}

/** 1 → "1¢", 0.5 → "0.5¢". */
export function centsLabel(cents: number): string {
  return (Number.isInteger(cents) ? String(cents) : cents.toFixed(1)) + '¢';
}

/** "Today", "Yesterday" or "Oct 12", in the reader's time zone. */
export function dayLabel(iso: string, now = new Date()): string {
  const d = new Date(iso);
  const start = (x: Date) => new Date(x.getFullYear(), x.getMonth(), x.getDate()).getTime();
  const days = Math.round((start(now) - start(d)) / 86_400_000);
  if (days === 0) return 'Today';
  if (days === 1) return 'Yesterday';
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

/** "2026-11-01" → "Nov 1". Payfer limits reset by UTC calendar month. */
export function resetLabel(isoDate: string): string {
  return new Date(isoDate + 'T00:00:00Z').toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' });
}

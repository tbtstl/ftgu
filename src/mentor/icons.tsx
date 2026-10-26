// The mentor's line icons, drawn on a 16-unit grid in the current text color.

const line = { fill: 'none', stroke: 'currentColor', strokeWidth: 1.3, strokeLinecap: 'round', strokeLinejoin: 'round' } as const;

export function ChatIcon({ size = 16 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 16 16" aria-hidden="true">
      <path d="M3 3.25h10a1 1 0 0 1 1 1v6.25a1 1 0 0 1-1 1H8.25L5 14v-2.5H3a1 1 0 0 1-1-1V4.25a1 1 0 0 1 1-1z" {...line} />
    </svg>
  );
}

export function CoinIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" aria-hidden="true">
      <circle cx="8" cy="8" r="6.25" {...line} />
      <circle cx="8" cy="8" r="3" {...line} />
    </svg>
  );
}

export function PersonIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" aria-hidden="true">
      <circle cx="8" cy="5.75" r="2.75" {...line} />
      <path d="M2.75 14c.55-2.75 2.6-4.25 5.25-4.25S12.7 11.25 13.25 14" {...line} />
    </svg>
  );
}

export function CloseIcon({ size = 16 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 16 16" aria-hidden="true">
      <path d="M4 4l8 8M12 4l-8 8" {...line} />
    </svg>
  );
}

export function MoreIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" aria-hidden="true">
      <circle cx="3.5" cy="8" r="1.2" fill="currentColor" />
      <circle cx="8" cy="8" r="1.2" fill="currentColor" />
      <circle cx="12.5" cy="8" r="1.2" fill="currentColor" />
    </svg>
  );
}

export function SendIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" aria-hidden="true">
      <path d="M8 13V3.5M4 7.25 8 3.25l4 4" {...line} strokeWidth={1.6} />
    </svg>
  );
}

export function ArrowIcon({ back = false }: { back?: boolean }) {
  return (
    <svg width="14" height="14" viewBox="0 0 16 16" aria-hidden="true">
      <path d={back ? 'M13 8H3M7 4 3 8l4 4' : 'M3 8h10M9 4l4 4-4 4'} {...line} strokeWidth={1.5} />
    </svg>
  );
}

export function EyeIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 16 16" aria-hidden="true">
      <path d="M1.75 8S4.25 3.5 8 3.5 14.25 8 14.25 8 11.75 12.5 8 12.5 1.75 8 1.75 8z" {...line} />
      <circle cx="8" cy="8" r="2" {...line} />
    </svg>
  );
}

export function PenIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" aria-hidden="true">
      <path d="M2 12.5h12M4 9.75 9.75 4l2.25 2.25L6.25 12H4V9.75z" {...line} />
    </svg>
  );
}

export function CheckCircleIcon() {
  return (
    <svg width="32" height="32" viewBox="0 0 32 32" aria-hidden="true" className="mt-done">
      <circle cx="16" cy="16" r="14.25" fill="none" stroke="currentColor" strokeWidth="1.5" />
      <path d="M10 16.5 14 20.5 22 11.5" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

export function Spinner() {
  return (
    <svg width="28" height="28" viewBox="0 0 28 28" aria-hidden="true" className="mt-spin">
      <circle cx="14" cy="14" r="11" fill="none" stroke="var(--rule)" strokeWidth="2" />
      <path d="M14 3a11 11 0 0 1 11 11" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
    </svg>
  );
}

// A row in a demonstration where the reader commits to a prediction before checking it with the
// figure's own controls. Chapter 6's challenges are judged on both: the prediction, and the setting
// that checks it.

import type { ReactNode } from 'react';
import { Segmented } from '../../../framework';

export function Prediction<T extends string>({
  label,
  aria,
  value,
  options,
  onChange,
}: {
  /** The question, shown above the choices. */
  label: ReactNode;
  /** Accessible name of the group of choices. */
  aria: string;
  /** The reader's prediction, or '' before one is made. */
  value: T | '';
  options: Array<{ value: T; label: ReactNode }>;
  onChange: (v: T) => void;
}) {
  return (
    <div className="ctl" style={{ maxWidth: 'none', paddingTop: 8 }}>
      <div className="ctl-l" style={{ marginBottom: 2 }}>
        {label}
      </div>
      <Segmented<T | ''> label={aria} value={value} options={options} onChange={(v) => v !== '' && onChange(v)} />
    </div>
  );
}

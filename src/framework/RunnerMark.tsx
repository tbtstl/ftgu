import { useLogoColor } from '../course/logoColor';
import { RUNNER_PATH, RUNNER_SIZE } from './runner';

/** The runner, drawn in the reader's chosen logo color unless a color is given. */
export function RunnerMark({ size, color, className }: { size: number; color?: string; className?: string }) {
  const saved = useLogoColor();
  return (
    <svg className={className} width={size} height={size} viewBox={`0 0 ${RUNNER_SIZE} ${RUNNER_SIZE}`} aria-hidden="true" style={{ color: color ?? saved }}>
      <path fill="currentColor" fillRule="evenodd" d={RUNNER_PATH} />
    </svg>
  );
}

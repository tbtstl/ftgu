// Chapter 1's challenges hide the readout that would give their answer away. It appears once the
// challenge is solved, now or on an earlier visit, so the reader can go on exploring afterward.

import { useProgress } from '../../../course/progress';

/** Whether challenge `challengeId` of lesson `lessonId` is solved now or was solved before. */
export function useRevealed(lessonId: string, challengeId: string, solved: boolean): boolean {
  const done = useProgress()[lessonId]?.includes(challengeId) ?? false;
  return solved || done;
}

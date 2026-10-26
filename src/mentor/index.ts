// The course mentor: a chat beside each lesson that can take passages from it, with sign-in and
// pay-per-message through Payfer. See types.ts for what its backend has to provide.

export { MentorProvider, useMentor, MENTOR_ENABLED, MENTOR_WIDTH } from './MentorContext';
export type { Mentor } from './MentorContext';
export { MentorDock } from './MentorPanel';
export { MentorHeaderItems } from './HeaderItems';
export { HighlightBar } from './HighlightBar';
export { createMockBackend } from './mockBackend';
export type { MentorBackend, Account, Message } from './types';

// What the course mentor's backend has to provide. The panel only talks to this interface, so
// the practice backend (mockBackend.ts) and the real server are interchangeable.
//
// The real backend signs readers in with Privy, keeps one conversation per reader per course,
// and before each answer charges the reader through Payfer (verifyConnection once, then
// charge() per message) or uses up one of their free messages. Money is in whole cents here.

export type Role = 'you' | 'mentor';

export interface Message {
  id: string;
  role: Role;
  text: string;
  /** The lesson passage the reader brought into the question. */
  quote?: string;
  /** The lesson the reader was on when the message was sent. */
  lessonId: string;
  /** ISO time. */
  at: string;
}

/** Why the next message can't be paid for, matching Payfer's reasons where there is one. */
export type Blocked = 'connect' | 'funding' | 'limit' | 'revoked';

export type SignInMethod = 'google' | 'apple' | 'passkey' | 'email';

export interface PayferLink {
  /** The monthly limit the reader approved for this site. */
  limitCents: number;
  /** What's left of it this month. */
  leftCents: number;
  /** ISO date the limit resets (the 1st of next month, UTC). */
  resets: string;
}

export interface Account {
  email: string | null;
  via: SignInMethod;
  /** Free messages left before Payfer is needed. */
  freeLeft: number;
  priceCents: number;
  payfer: PayferLink | null;
  blocked: Blocked | null;
}

export interface AskRequest {
  courseId: string;
  lessonId: string;
  lessonTitle: string;
  text: string;
  quote?: string;
  /** The lesson's text as the reader sees it, so the answer can lean on it. */
  lessonText: string;
  /** Lessons in this course with a solved challenge. */
  solved: string[];
}

export interface AskResult {
  question: Message;
  answer: Message;
  account: Account;
}

export interface MentorBackend {
  account(): Promise<Account | null>;
  signIn(method: Exclude<SignInMethod, 'email'>): Promise<Account>;
  sendCode(email: string): Promise<void>;
  verifyCode(email: string, code: string): Promise<Account>;
  signOut(): Promise<void>;
  history(courseId: string): Promise<Message[]>;
  /** Charges for and answers one question, calling onDelta as the answer streams in. */
  ask(req: AskRequest, onDelta: (text: string) => void): Promise<AskResult>;
  /** Starts the course's mentor over. */
  clear(courseId: string): Promise<void>;
  /** Payfer's connect(): the reader approves a monthly limit on Payfer's page. */
  connectPayfer(limitCents: number): Promise<Account>;
  /** Payfer's manage(): the reader changes their limit or adds funds on Payfer's page. */
  managePayfer(): Promise<Account>;
}

export class MentorError extends Error {
  constructor(
    readonly code: Blocked | 'bad_code' | 'failed',
    message: string = code,
  ) {
    super(message);
  }
}

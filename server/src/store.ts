// Readers and their conversations, in SQLite. A reader is a Privy user; each has free messages
// left, the Payfer account they linked, and one conversation per course.

import Database from 'better-sqlite3';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import type { Blocked, Message } from '../../src/mentor/types';

export interface ReaderRow {
  id: string;
  email: string | null;
  freeLeft: number;
  paymentUserId: string | null;
  /** A Payfer refusal that the allowance alone can't show (an empty balance), until the reader fixes it. */
  blocked: Blocked | null;
}

export interface Store {
  reader(id: string): ReaderRow | null;
  /** Creates the reader with `freeMessages` on first sight, and keeps their email current. */
  ensureReader(id: string, email: string | null, freeMessages: number): ReaderRow;
  /** Uses up one free message; false when none are left. */
  takeFree(id: string): boolean;
  giveBackFree(id: string): void;
  linkPayfer(id: string, paymentUserId: string): void;
  setBlocked(id: string, blocked: Blocked | null): void;
  messages(readerId: string, courseId: string): Message[];
  addMessage(readerId: string, courseId: string, m: Message): void;
  deleteMessage(id: string): void;
  clear(readerId: string, courseId: string): void;
}

export function openStore(path: string): Store {
  if (path !== ':memory:') mkdirSync(dirname(path), { recursive: true });
  const db = new Database(path);
  db.pragma('journal_mode = WAL');
  db.exec(`
    CREATE TABLE IF NOT EXISTS readers (
      id TEXT PRIMARY KEY,
      email TEXT,
      free_left INTEGER NOT NULL,
      payment_user_id TEXT,
      blocked TEXT,
      created_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS messages (
      id TEXT PRIMARY KEY,
      reader_id TEXT NOT NULL REFERENCES readers(id),
      course_id TEXT NOT NULL,
      role TEXT NOT NULL,
      text TEXT NOT NULL,
      quote TEXT,
      lesson_id TEXT NOT NULL,
      at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS messages_by_course ON messages (reader_id, course_id);
  `);

  const q = {
    reader: db.prepare<[string], { id: string; email: string | null; free_left: number; payment_user_id: string | null; blocked: string | null }>(
      'SELECT id, email, free_left, payment_user_id, blocked FROM readers WHERE id = ?',
    ),
    insert: db.prepare('INSERT INTO readers (id, email, free_left, created_at) VALUES (?, ?, ?, ?) ON CONFLICT (id) DO UPDATE SET email = excluded.email'),
    takeFree: db.prepare('UPDATE readers SET free_left = free_left - 1 WHERE id = ? AND free_left > 0'),
    giveBackFree: db.prepare('UPDATE readers SET free_left = free_left + 1 WHERE id = ?'),
    link: db.prepare('UPDATE readers SET payment_user_id = ?, blocked = NULL WHERE id = ?'),
    blocked: db.prepare('UPDATE readers SET blocked = ? WHERE id = ?'),
    messages: db.prepare<[string, string], { id: string; role: string; text: string; quote: string | null; lesson_id: string; at: string }>(
      'SELECT id, role, text, quote, lesson_id, at FROM messages WHERE reader_id = ? AND course_id = ? ORDER BY rowid',
    ),
    add: db.prepare('INSERT INTO messages (id, reader_id, course_id, role, text, quote, lesson_id, at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)'),
    remove: db.prepare('DELETE FROM messages WHERE id = ?'),
    clear: db.prepare('DELETE FROM messages WHERE reader_id = ? AND course_id = ?'),
  };

  const reader = (id: string): ReaderRow | null => {
    const r = q.reader.get(id);
    return r ? { id: r.id, email: r.email, freeLeft: r.free_left, paymentUserId: r.payment_user_id, blocked: (r.blocked as Blocked | null) ?? null } : null;
  };

  return {
    reader,
    ensureReader(id, email, freeMessages) {
      q.insert.run(id, email, freeMessages, new Date().toISOString());
      return reader(id)!;
    },
    takeFree: (id) => q.takeFree.run(id).changes === 1,
    giveBackFree: (id) => void q.giveBackFree.run(id),
    linkPayfer: (id, paymentUserId) => void q.link.run(paymentUserId, id),
    setBlocked: (id, blocked) => void q.blocked.run(blocked, id),
    messages: (readerId, courseId) =>
      q.messages.all(readerId, courseId).map((r) => ({
        id: r.id,
        role: r.role === 'mentor' ? 'mentor' : 'you',
        text: r.text,
        ...(r.quote ? { quote: r.quote } : {}),
        lessonId: r.lesson_id,
        at: r.at,
      })),
    addMessage: (readerId, courseId, m) => void q.add.run(m.id, readerId, courseId, m.role, m.text, m.quote ?? null, m.lessonId, m.at),
    deleteMessage: (id) => void q.remove.run(id),
    clear: (readerId, courseId) => void q.clear.run(readerId, courseId),
  };
}

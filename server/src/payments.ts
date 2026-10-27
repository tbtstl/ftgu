// Payfer from the server: link a reader's Payfer account once, read their allowance, charge each
// message and refund it when no answer comes back. Payfer's reasons for refusing a charge map
// onto what the panel shows the reader.

import { Payfer, isPayferError, type Allowance, type Payment, type PayferErrorCode } from 'payfer/server';
import type { Blocked } from '../../src/mentor/types';
import { config } from './config';

/** The parts of the Payfer server SDK the mentor uses, so tests can stand in for it. */
export interface Payments {
  verifyConnection(c: { paymentUserId: string; connectionProof: string }): Promise<{ paymentUserId: string }>;
  getAllowance(p: { paymentUserId: string }): Promise<Allowance>;
  charge(p: { paymentUserId: string; amount: string; idempotencyKey: string }): Promise<Payment>;
  refund(p: { paymentId: string; idempotencyKey: string }): Promise<unknown>;
}

export function payferPayments(): Payments | null {
  return config.payferSecretKey ? new Payfer({ secretKey: config.payferSecretKey }) : null;
}

/** "5.00" → 500. Payfer amounts carry six decimals; the panel shows cents. */
export function toCents(amount: string): number {
  return Math.round(Number(amount) * 100);
}

/** 1 → "0.01". */
export function toAmount(cents: number): string {
  return (cents / 100).toFixed(2);
}

/** What the reader has to do about a refused charge, or null when it's not theirs to fix. */
export function blockedBy(err: unknown): Blocked | null {
  if (!isPayferError(err)) return null;
  const map: Partial<Record<PayferErrorCode, Blocked>> = {
    allowance_exceeded: 'limit',
    funding_required: 'funding',
    approval_revoked: 'revoked',
    approval_required: 'connect',
    payment_user_not_found: 'connect',
  };
  return map[err.code] ?? null;
}

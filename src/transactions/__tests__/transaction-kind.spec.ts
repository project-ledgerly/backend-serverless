import { describe, expect, it } from 'vitest';
import { transactionKind } from '../transaction-kind.js';

describe('transactionKind', () => {
  it('follows the section type', () => {
    expect(transactionKind('ESSENTIAL')).toBe('ESSENTIAL_SPENDING');
    expect(transactionKind('BILLS')).toBe('BILL_PAYMENT');
    expect(transactionKind('SAVINGS')).toBe('SAVING');
    expect(transactionKind('GOAL')).toBe('SAVING');
    expect(transactionKind('FLEXIBLE')).toBe('FLEXIBLE_SPENDING');
  });

  it('is a bill payment whenever a bill is linked, even from an older section', () => {
    expect(transactionKind('ESSENTIAL', 'some-bill-id')).toBe('BILL_PAYMENT');
  });
});

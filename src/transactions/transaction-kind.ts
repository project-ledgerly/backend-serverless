// What a transaction is, from the section it counts toward. Never stored, so it cannot
// disagree with the section: moving a transaction to another section changes its kind.

export type TransactionKind = 'ESSENTIAL_SPENDING' | 'BILL_PAYMENT' | 'SAVING' | 'FLEXIBLE_SPENDING';

export function transactionKind(sectionType: string, listingId?: string | null): TransactionKind {
  if (sectionType === 'BILLS' || listingId) return 'BILL_PAYMENT';
  if (sectionType === 'SAVINGS' || sectionType === 'GOAL') return 'SAVING';
  if (sectionType === 'ESSENTIAL') return 'ESSENTIAL_SPENDING';
  return 'FLEXIBLE_SPENDING';
}

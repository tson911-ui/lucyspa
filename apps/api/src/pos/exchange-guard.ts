import type { Prisma } from '@lucy-spa/database';
import { AuthError } from '../auth/auth.error.js';

/**
 * Phase 6 P6-14 (T22 extended): an invoice with an exchange keeps its payments and stays paid, so a correction can never double an
 * effect. Two invoices are held:
 *   - the ORIGINAL invoice of an exchange whose invoice was not cancelled (the returned units are claimed);
 *   - the invoice of an exchange that was COMPLETED (the replacement was handed over and the returned goods taken in).
 * An exchange whose invoice was cancelled holds nothing; an exchange still waiting for its payment may have that payment reversed or
 * its invoice cancelled (nothing else has moved). The database refuses the same moves (`lucy_refuse_when_refunded`).
 */
export async function assertNoExchangeHold(
  tx: Prisma.TransactionClient,
  invoiceId: string,
): Promise<void> {
  const held = await tx.productExchange.count({
    where: { invoiceId, exchangeInvoice: { status: { not: 'CANCELLED' } } },
  });
  if (held > 0) throw new AuthError('INVOICE_HAS_EXCHANGE');
  const completed = await tx.productExchange.count({
    where: { exchangeInvoiceId: invoiceId, completion: { isNot: null } },
  });
  if (completed > 0) throw new AuthError('INVOICE_HAS_EXCHANGE');
}

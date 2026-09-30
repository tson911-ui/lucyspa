'use client';

import type { InvoiceOpenedResponse, PosBoardResponse } from '@lucy-spa/contracts';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { BOARD_REFRESH_MS, branchTime } from '../../../lib/workforce/booking-board';
import { formatDate, formatVnd, todayIn } from '../../../lib/workforce/format';
import { invoiceTone, posBranches, posErrorMessage } from '../../../lib/workforce/pos';
import { useBranches } from '../data';
import { useAccount, useWorkforce } from '../session';
import { Badge, Empty, Field, Loading, Notice, PageHeader, Section } from '../ui';

/**
 * "Hóa đơn" (Phase 4 Step 5): completed visits still without an invoice, and the branch's recent invoices.
 * Opening an invoice creates (or reopens) the visit's single active DRAFT; every state and number comes from
 * the server. The page refreshes itself passively so it never keeps a session alive.
 */
export function PosScreen() {
  const { api, t, locale, base } = useWorkforce();
  const { account } = useAccount();
  const router = useRouter();
  const branches = useBranches(api);
  const allowed = useMemo(() => posBranches(account, branches.data), [account, branches.data]);
  const [branchId, setBranchId] = useState('');
  const [date, setDate] = useState('');
  const [board, setBoard] = useState<PosBoardResponse | null>(null);
  const [loadError, setLoadError] = useState<unknown>(null);
  const [opening, setOpening] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  useEffect(() => {
    if (!branchId && allowed[0]) setBranchId(allowed[0].id);
  }, [allowed, branchId]);

  const load = useCallback(
    async (passive: boolean) => {
      if (!branchId) return;
      try {
        setBoard(
          await api.get<PosBoardResponse>(
            `/api/v1/pos/branches/${branchId}/board`,
            date ? { date } : {},
            { passive },
          ),
        );
        setLoadError(null);
      } catch (error) {
        setLoadError(error);
      }
    },
    [api, branchId, date],
  );
  useEffect(() => {
    setBoard(null);
    void load(false);
    const timer = window.setInterval(() => void load(true), BOARD_REFRESH_MS);
    return () => window.clearInterval(timer);
  }, [load]);

  async function open(visitId: string) {
    if (opening) return;
    setOpening(visitId);
    setMessage(null);
    try {
      const opened = await api.post<InvoiceOpenedResponse>(
        `/api/v1/pos/visits/${visitId}/invoice`,
        {},
      );
      router.push(`${base}/pos/${opened.invoice.id}`);
    } catch (error) {
      setMessage(posErrorMessage(error, t));
      setOpening(null);
      await load(false);
    }
  }

  if (branches.loading && !branches.data) return <Loading t={t} />;
  if (allowed.length === 0) {
    return (
      <>
        <PageHeader title={t.pos.title} intro={t.pos.intro} />
        <Empty>{t.pos.noBranch}</Empty>
      </>
    );
  }
  const zone = board?.branch.timezone ?? 'UTC';
  const today = todayIn(zone);
  return (
    <>
      <PageHeader title={t.pos.title} intro={t.pos.intro}>
        <button type="button" className="wf-button" onClick={() => void load(false)}>
          {t.pos.refresh}
        </button>
      </PageHeader>
      <div className="wf-filters">
        <Field id="pos-branch" label={t.pos.branch}>
          <select
            id="pos-branch"
            value={branchId}
            onChange={(event) => (setBranchId(event.target.value), setDate(''))}
          >
            {allowed.map((branch) => (
              <option key={branch.id} value={branch.id}>
                {branch.name}
              </option>
            ))}
          </select>
        </Field>
        <Field id="pos-date" label={t.pos.date} hint={t.pos.windowNote}>
          <input
            id="pos-date"
            type="date"
            value={date || (board?.date ?? today)}
            max={today}
            onChange={(event) => setDate(event.target.value)}
          />
        </Field>
      </div>
      {message ? <Notice tone="error">{message}</Notice> : null}
      {loadError ? <Notice tone="error">{posErrorMessage(loadError, t)}</Notice> : null}
      {!board && !loadError ? <Loading t={t} /> : null}
      {board ? (
        <>
          <Section title={t.pos.awaitingTitle}>
            {board.awaiting.length === 0 ? <Empty>{t.pos.awaitingEmpty}</Empty> : null}
            {board.awaiting.length > 0 ? (
              <table className="wf-table">
                <thead>
                  <tr>
                    <th>{t.pos.visit}</th>
                    <th>{t.pos.guests}</th>
                    <th>{t.pos.performed}</th>
                    <th>{t.pos.completedAt}</th>
                    <th />
                  </tr>
                </thead>
                <tbody>
                  {board.awaiting.map((visit) => (
                    <tr key={visit.visitId}>
                      <td data-label={t.pos.visit}>
                        {visit.visitCode}
                        <br />
                        <span className="wf-small">{formatDate(visit.serviceDate, locale)}</span>
                      </td>
                      <td data-label={t.pos.guests}>{visit.participants.join(', ')}</td>
                      <td data-label={t.pos.performed}>{visit.performedServices}</td>
                      <td data-label={t.pos.completedAt}>
                        {visit.completedAt ? branchTime(visit.completedAt, zone, locale) : '—'}
                      </td>
                      <td>
                        {board.canManage ? (
                          <button
                            type="button"
                            className="wf-button wf-button-primary"
                            disabled={opening !== null}
                            aria-busy={opening === visit.visitId}
                            onClick={() => void open(visit.visitId)}
                          >
                            {opening === visit.visitId ? t.pos.opening : t.pos.openInvoice}
                          </button>
                        ) : null}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            ) : null}
          </Section>
          <Section title={t.pos.invoicesTitle}>
            {board.invoices.length === 0 ? <Empty>{t.pos.invoicesEmpty}</Empty> : null}
            {board.invoices.length > 0 ? (
              <table className="wf-table">
                <thead>
                  <tr>
                    <th>{t.pos.code}</th>
                    <th>{t.pos.visit}</th>
                    <th>{t.pos.status}</th>
                    <th>{t.pos.payer}</th>
                    <th>{t.pos.total}</th>
                    <th />
                  </tr>
                </thead>
                <tbody>
                  {board.invoices.map((invoice) => (
                    <tr key={invoice.id}>
                      <td data-label={t.pos.code}>
                        {invoice.code}
                        <br />
                        <span className="wf-small">{formatDate(invoice.businessDate, locale)}</span>
                      </td>
                      <td data-label={t.pos.visit}>{invoice.visitCode}</td>
                      <td data-label={t.pos.status}>
                        <Badge tone={invoiceTone(invoice.status)}>
                          {t.pos.statuses[invoice.status]}
                        </Badge>
                      </td>
                      <td data-label={t.pos.payer}>{invoice.payerName ?? t.pos.guestPayer}</td>
                      <td data-label={t.pos.total}>
                        {/* A draft total follows the live benefit evaluation shown on the invoice itself. */}
                        {invoice.status === 'DRAFT' ? '—' : formatVnd(invoice.totalVnd, locale)}
                      </td>
                      <td>
                        <Link className="wf-button" href={`${base}/pos/${invoice.id}`}>
                          {t.pos.view}
                        </Link>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            ) : null}
          </Section>
        </>
      ) : null}
    </>
  );
}

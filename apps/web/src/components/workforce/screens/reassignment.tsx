'use client';

import type { ReassignmentLine, ReassignmentScope, ReassignmentWorkResponse, ReplacementOptionsResponse, ReassignServicesResponse } from '@lucy-spa/contracts';
import { useCallback, useEffect, useMemo, useRef, useState, type FormEvent } from 'react';
import { reassignmentBody, reassignmentBranches, reassignmentError } from '../../../lib/workforce/reassignment';
import { useBranches } from '../data';
import { useAccount, useWorkforce } from '../session';
import { Badge, Empty, Field, Loading, Notice, PageHeader, Section } from '../ui';

export function ReassignmentScreen() {
  const { api, t, locale } = useWorkforce();
  const { account } = useAccount();
  const branches = useBranches(api);
  const allowed = useMemo(() => reassignmentBranches(account, branches.data), [account, branches.data]);
  const [branchId, setBranchId] = useState('');
  const [from, setFrom] = useState(''); const [to, setTo] = useState('');
  const [conflictsOnly, setConflictsOnly] = useState(true);
  const [board, setBoard] = useState<ReassignmentWorkResponse | null>(null);
  const [anchor, setAnchor] = useState<ReassignmentLine | null>(null);
  const [scope, setScope] = useState<ReassignmentScope>('PARTICIPANT');
  const [options, setOptions] = useState<ReplacementOptionsResponse | null>(null);
  const [replacement, setReplacement] = useState(''); const [reason, setReason] = useState('');
  const [acknowledged, setAcknowledged] = useState(false);
  const [error, setError] = useState<unknown>(null); const [success, setSuccess] = useState(false);
  const [loading, setLoading] = useState(false); const [saving, setSaving] = useState(false);
  const [optionsLoading, setOptionsLoading] = useState(false);
  const generation = useRef(0); const optionGeneration = useRef(0); const mutation = useRef(false);

  useEffect(() => { if (!allowed.some((b) => b.id === branchId)) setBranchId(allowed[0]?.id ?? ''); }, [allowed, branchId]);
  const load = useCallback(async (cursor?: string) => {
    if (!branchId) return;
    const current = ++generation.current;
    optionGeneration.current += 1; setAnchor(null); setOptions(null); setOptionsLoading(false); setLoading(true);
    try {
      const result = await api.get<ReassignmentWorkResponse>(`/api/v1/operations/branches/${branchId}/reassignment-work`, {
        ...(from ? { from } : {}), ...(to ? { to } : {}), conflictsOnly: String(conflictsOnly), ...(cursor ? { cursor } : {}),
      });
      if (current === generation.current) {
        setBoard((old) => cursor && old ? { ...result, lines: [...old.lines, ...result.lines] } : result);
        setError(null);
      }
    } catch (cause) { if (current === generation.current) setError(cause); }
    finally { if (current === generation.current) setLoading(false); }
  }, [api, branchId, from, to, conflictsOnly]);
  useEffect(() => {
    setBoard(null); setSuccess(false); void load();
    return () => { generation.current += 1; optionGeneration.current += 1; };
  }, [load]);

  async function inspect(line: ReassignmentLine, selectedScope: ReassignmentScope) {
    if (mutation.current) return;
    const current = ++optionGeneration.current;
    setAnchor(line); setScope(selectedScope); setOptions(null); setOptionsLoading(true);
    setReplacement(''); setReason(''); setAcknowledged(false); setError(null); setSuccess(false);
    try {
      const result = await api.get<ReplacementOptionsResponse>(`/api/v1/operations/assignment-lines/${line.kind}/${line.id}/replacements`, { scope: selectedScope });
      if (current === optionGeneration.current) setOptions(result);
    } catch (cause) { if (current === optionGeneration.current) setError(cause); }
    finally { if (current === optionGeneration.current) setOptionsLoading(false); }
  }

  async function submit(event: FormEvent) {
    event.preventDefault();
    const body = reassignmentBody(options, replacement, reason, acknowledged);
    if (!anchor || !body || mutation.current) return;
    mutation.current = true; setSaving(true); setError(null); setSuccess(false);
    generation.current += 1; optionGeneration.current += 1;
    try {
      const result = await api.post<ReassignServicesResponse>(`/api/v1/operations/assignment-lines/${anchor.kind}/${anchor.id}/reassign`, body);
      setBoard((previous) => previous ? { ...previous, lines: previous.lines.flatMap((line) => {
        const updated = result.lines.find((entry) => entry.id === line.id && entry.kind === line.kind);
        return updated ? (conflictsOnly && !updated.leaveConflict ? [] : [updated]) : [line];
      }) } : previous);
      setSuccess(true); await load();
    } catch (cause) {
      // A stale candidate/version must be inspected again; retain the safe error after reload.
      await load(); setError(cause);
    } finally { mutation.current = false; setSaving(false); }
  }
  const timestamp = (iso: string) => new Intl.DateTimeFormat(locale === 'vi' ? 'vi-VN' : 'en-GB', {
    timeZone: board?.branch.timezone ?? 'UTC', day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit',
  }).format(new Date(iso));
  const serviceName = (line: ReassignmentLine) => locale === 'vi' ? line.service.nameVi : line.service.nameEn;

  return <>
    <PageHeader title={t.reassignment.title} intro={t.reassignment.intro}>
      <button className="wf-button" type="button" disabled={saving || loading} onClick={() => void load()}>{t.bookingBoard.refresh}</button>
    </PageHeader>
    {branches.loading && !branches.data ? <Loading t={t} /> : null}
    {branches.error ? <Notice tone="error">{reassignmentError(branches.error, t)}</Notice> : null}
    {!branches.loading && allowed.length === 0 ? <Empty>{t.reassignment.noBranch}</Empty> : null}
    {allowed.length ? <div className="wf-filters">
      <Field id="reassignment-branch" label={t.bookingBoard.branch}><select id="reassignment-branch" value={branchId} disabled={saving} onChange={(event) => { setFrom(''); setTo(''); setBranchId(event.target.value); }}>
        {allowed.map((branch) => <option key={branch.id} value={branch.id}>{branch.name}</option>)}
      </select></Field>
      <Field id="reassignment-from" label={t.reassignment.from}><input id="reassignment-from" type="date" value={from} disabled={saving} onChange={(event) => setFrom(event.target.value)} /></Field>
      <Field id="reassignment-to" label={t.reassignment.to}><input id="reassignment-to" type="date" value={to} disabled={saving} onChange={(event) => setTo(event.target.value)} /></Field>
      <label><input type="checkbox" checked={conflictsOnly} disabled={saving} onChange={(event) => setConflictsOnly(event.target.checked)} /> {t.reassignment.conflictsOnly}</label>
    </div> : null}
    {error ? <Notice tone="error">{reassignmentError(error, t)}</Notice> : null}
    {success ? <Notice tone="success">{t.reassignment.success}</Notice> : null}
    {loading ? <Loading t={t} /> : null}
    {board ? <p className="wf-small">{board.from} – {board.to}</p> : null}
    {board?.lines.length === 0 ? <Empty>{t.reassignment.empty}</Empty> : null}
    {anchor ? <Section title={t.reassignment.affected}>
      <Field id="reassignment-scope" label={t.reassignment.scope}><select id="reassignment-scope" value={scope} disabled={saving} onChange={(event) => void inspect(anchor, event.target.value as ReassignmentScope)}>
        <option value="PARTICIPANT">{t.reassignment.participant}</option><option value="LINE">{t.reassignment.line}</option>
      </select></Field>
      {optionsLoading ? <Loading t={t} /> : null}
      {options ? <form onSubmit={(event) => void submit(event)}>
        <ul>{options.lines.map((line) => <li key={line.id}>{serviceName(line)} · {timestamp(line.plannedStartAt)} · {line.employee.displayName} · {line.assignmentMode === 'SPECIFIC' ? t.reassignment.specific : t.reassignment.any}</li>)}</ul>
        {options.candidates.length === 0 ? <Notice tone="warning">{t.reassignment.none}</Notice> : null}
        <Field id="reassignment-replacement" label={t.reassignment.replacement}><select id="reassignment-replacement" value={replacement} disabled={saving} onChange={(event) => setReplacement(event.target.value)} required>
          <option value="">{t.reassignment.choose}</option>
          {options.candidates.map((candidate) => <option key={candidate.id} value={candidate.id}>{candidate.displayName}{candidate.preferred ? ` · ${t.reassignment.preferred}` : ''}</option>)}
        </select></Field>
        <Field id="reassignment-reason" label={t.reassignment.reason} hint={t.reassignment.reasonHint}><textarea id="reassignment-reason" value={reason} disabled={saving} maxLength={1000} onChange={(event) => setReason(event.target.value)} required /></Field>
        {options.requiresSpecificAcknowledgement ? <label><input type="checkbox" checked={acknowledged} disabled={saving} onChange={(event) => setAcknowledged(event.target.checked)} /> {t.reassignment.acknowledge}</label> : null}
        <div className="wf-page-actions"><button className="wf-button wf-button-primary" type="submit" disabled={saving || !reassignmentBody(options, replacement, reason, acknowledged)}>{saving ? t.reassignment.saving : t.reassignment.confirm}</button></div>
      </form> : null}
      <button className="wf-button" type="button" disabled={saving} onClick={() => { optionGeneration.current += 1; setAnchor(null); setOptions(null); setOptionsLoading(false); }}>{t.common.cancel}</button>
    </Section> : null}
    {board?.branch.id === branchId ? board.lines.map((line) => <Section key={`${line.kind}:${line.id}`} title={`${line.parentCode} · ${serviceName(line)}`}>
      {line.leaveConflict ? <Badge tone="warning">{t.reassignment.leave}</Badge> : null}
      <p>{line.participantName ?? t.execution.participant} · {timestamp(line.plannedStartAt)} – {timestamp(line.plannedEndAt)}</p>
      <p>{t.reassignment.current}: {line.employee.displayName}</p>
      <p>{line.assignmentMode === 'SPECIFIC' ? t.reassignment.specific : t.reassignment.any}</p>
      <button type="button" className="wf-button" disabled={saving || loading || Boolean(error)} onClick={() => void inspect(line, 'PARTICIPANT')}>{t.reassignment.inspect}</button>
    </Section>) : null}
    {board?.nextCursor ? <button className="wf-button" type="button" disabled={saving || loading} onClick={() => void load(board.nextCursor!)}>{t.reassignment.more}</button> : null}
  </>;
}

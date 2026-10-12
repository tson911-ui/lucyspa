'use client';

import type { ReportExportFormat, ReportExportRequest } from '@lucy-spa/contracts';
import { Field, FormDialog, Select, SegmentedControl } from '@lucy-spa/ui';
import { useState } from 'react';
import { fill } from '../../../i18n/workforce';
import { reportsDictionary } from '../../../i18n/reports';
import { formOverlayLabels } from '../../../lib/workforce/form-labels';
import { ReauthenticationCancelled, withReauthentication } from '../../../lib/workforce/reauth';
import { reportErrorMessage, requestExport, saveFile } from '../../../lib/workforce/reports';
import { useReauthentication } from '../reauth-dialog';
import { useWorkforce } from '../session';
import { Notice, useSuccessToast } from '../ui';

export interface ExportChoice {
  /** The report id sent to the API. */
  id: string;
  label: string;
  /** A file of this report asks for the fresh password (pay and profit data). */
  reauth?: boolean;
}

type Format = ReportExportFormat | 'pdf';

/**
 * "Xuất báo cáo" (Phase 8 P8-5): what to take out and in which form. Excel and CSV come from the server (EXPORT_REPORTS, one audit row);
 * PDF is the browser's own print dialog on the page as it is. A file of pay or profit data asks for the password again (the sensitive-command
 * rule). The primary action of the page opens this dialog; nothing here changes any data.
 */
export function ExportDialog({
  choices,
  initial,
  build,
  onClose,
}: {
  choices: readonly ExportChoice[];
  initial: string;
  /** The request for a report id and format, from the filters on screen. */
  build: (report: string, format: ReportExportFormat) => ReportExportRequest;
  onClose: () => void;
}) {
  const { api, t, locale } = useWorkforce();
  const w = reportsDictionary(locale);
  const e = w.export;
  const [report, setReport] = useState(initial);
  const [format, setFormat] = useState<Format>('xlsx');
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const { confirm, dialog } = useReauthentication();
  const notify = useSuccessToast();
  const hint = format === 'xlsx' ? e.xlsxHint : format === 'csv' ? e.csvHint : e.pdfHint;

  async function submit() {
    if (pending) return;
    if (format === 'pdf') {
      onClose();
      // After the dialog has left the page, so the print shows the report and not the dialog.
      setTimeout(() => window.print(), 50);
      return;
    }
    setPending(true);
    setError(null);
    try {
      const file = await withReauthentication(
        () => requestExport(api, build(report, format)),
        confirm,
      );
      saveFile(file);
      notify(fill(e.done, { name: file.filename }));
      onClose();
    } catch (failure) {
      // Closing the password prompt is not an error: no file was made.
      if (!(failure instanceof ReauthenticationCancelled)) {
        setError(reportErrorMessage(failure, w, t));
      }
      setPending(false);
    }
  }

  return (
    <>
      <FormDialog
        size="sm"
        title={e.title}
        description={e.intro}
        labels={{
          ...formOverlayLabels(t, format === 'pdf' ? e.print : e.submit),
          submitting: e.submitting,
        }}
        busy={pending}
        error={error ? <Notice tone="error">{error}</Notice> : undefined}
        onClose={onClose}
        onSubmit={submit}
      >
        {choices.length > 1 ? (
          <Field label={e.content}>
            {(control) => (
              <Select
                {...control}
                value={report}
                onChange={(event) => setReport(event.target.value)}
                options={choices.map((choice) => ({ value: choice.id, label: choice.label }))}
              />
            )}
          </Field>
        ) : null}
        <SegmentedControl<Format>
          label={e.format}
          value={format}
          onChange={setFormat}
          options={[
            { value: 'xlsx', label: e.xlsx },
            { value: 'csv', label: e.csv },
            { value: 'pdf', label: e.pdf },
          ]}
        />
        <p className="ls-hint">{hint}</p>
        <p className="ls-hint">
          {e.scope} {e.cap}
        </p>
      </FormDialog>
      {dialog}
    </>
  );
}

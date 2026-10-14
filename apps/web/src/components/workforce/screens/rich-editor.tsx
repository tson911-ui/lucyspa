'use client';

import { parseRichText } from '@lucy-spa/contracts';
import { Button, Field, SegmentedControl, Textarea } from '@lucy-spa/ui';
import { useLayoutEffect, useRef, useState } from 'react';
import { fill } from '../../../i18n/workforce';
import type { Locale } from '../../../i18n/locales';
import { applyFormat, type FormatKind } from '../../../lib/workforce/pages';
import { RichBlocks } from '../../public/rich-text';
import { useWorkforce } from '../session';
import { Empty } from '../ui';

const TOOLS: readonly FormatKind[] = ['h2', 'h3', 'bold', 'italic', 'ul', 'ol', 'link'];

/**
 * The text of an information page: a formatting bar over a plain text box, and a preview that draws the very parse the website
 * draws. Every button only types the plain markup (the pattern is shown under the box), so nothing is hidden and the text is
 * always readable as it is stored. The bar keeps the selection, so a heading or a list is applied to the lines that are selected.
 */
export function RichEditor({
  label,
  hint,
  error,
  value,
  required = false,
  requiredLabel,
  language,
  onChange,
}: {
  label: string;
  hint: string;
  error: string | undefined;
  value: string;
  required?: boolean;
  requiredLabel?: string | undefined;
  /** The language the text is in (the preview draws its links for it). */
  language: Locale;
  onChange: (value: string) => void;
}) {
  const { t } = useWorkforce();
  const text = t.pages.form;
  const [mode, setMode] = useState<'write' | 'preview'>('write');
  const [selection, setSelection] = useState<{ start: number; end: number } | null>(null);
  const box = useRef<HTMLTextAreaElement | null>(null);

  // After a button changed the text, put the selection where the change says (the box is controlled, so it is set once drawn).
  useLayoutEffect(() => {
    if (!selection || !box.current) return;
    box.current.focus();
    box.current.setSelectionRange(selection.start, selection.end);
    setSelection(null);
  }, [selection]);

  function press(kind: FormatKind) {
    const area = box.current;
    const result = applyFormat(
      value,
      area?.selectionStart ?? value.length,
      area?.selectionEnd ?? value.length,
      kind,
      text.words,
    );
    onChange(result.value);
    setSelection({ start: result.start, end: result.end });
  }

  const parsed = mode === 'preview' ? parseRichText(value) : null;
  const left = 12_000 - [...value.trim()].length;

  return (
    <Field
      label={label}
      hint={`${hint} ${fill(text.bodyHint, { max: 12_000, left })}`.trim()}
      error={error}
      required={required}
      requiredLabel={requiredLabel}
      full
    >
      {(control) => (
        <div className="ls-rich-field">
          <div className="ls-rich-bar">
            <div role="toolbar" aria-label={text.toolbar} className="ls-rich-tools">
              {TOOLS.map((kind) => (
                <Button
                  key={kind}
                  variant="secondary"
                  compact
                  disabled={mode === 'preview'}
                  aria-controls={control.id}
                  onMouseDown={(event) => event.preventDefault()}
                  onClick={() => press(kind)}
                >
                  {text.tools[kind]}
                </Button>
              ))}
            </div>
            <SegmentedControl
              label={text.view}
              value={mode}
              onChange={setMode}
              options={[
                { value: 'write', label: text.write },
                { value: 'preview', label: text.preview },
              ]}
            />
          </div>
          {mode === 'write' ? (
            <Textarea
              {...control}
              ref={box}
              rows={18}
              spellCheck
              value={value}
              onChange={(event) => onChange(event.target.value)}
            />
          ) : parsed?.ok ? (
            <div className="ls-prose" lang={language}>
              <RichBlocks blocks={parsed.blocks} locale={language} newTabLabel="" headings />
            </div>
          ) : (
            <Empty>{text.previewEmpty}</Empty>
          )}
          <p className="ls-hint">{text.syntax}</p>
        </div>
      )}
    </Field>
  );
}

// Facts and templates as React nodes for the return, refund and exchange screens (session 10, Step 7 audit): the list of facts
// comes from Intl (no hand-written ", " join) and a dictionary template keeps its words in order while a code inside it stays
// `translate="no"` (wig Locale & i18n). Only the screens of a return case use it.

import { Fragment, type ReactNode } from 'react';
import type { Locale } from '../../../i18n/locales';
import { listFormat } from './pos-format';

const PLACEHOLDER = /(\{\w+\})/;
const NAME = /^\{(\w+)\}$/;

/** "A, B, C" through Intl (`unit` list) where a fact may be an element (e.g. a code in `translate="no"`); empty facts are left out. */
export function factNodes(
  locale: Locale,
  facts: readonly (ReactNode | null | undefined | false)[],
): ReactNode {
  const items = facts.filter(
    (fact) => fact !== null && fact !== undefined && fact !== false && fact !== '',
  );
  return listFormat(locale, 'meta')
    .formatToParts(items.map((_, index) => String(index)))
    .map((part, index) =>
      part.type === 'element' ? (
        <Fragment key={index}>{items[Number(part.value)]}</Fragment>
      ) : (
        part.value
      ),
    );
}

/** A dictionary template ("{label}: {value}") filled with nodes; an unknown placeholder stays as written. */
export function fillNodes(template: string, values: Record<string, ReactNode>): ReactNode {
  return template.split(PLACEHOLDER).map((piece, index) => {
    const name = NAME.exec(piece)?.[1];
    return name !== undefined && name in values ? (
      <Fragment key={index}>{values[name]}</Fragment>
    ) : (
      piece
    );
  });
}

/** A code or reference that is never machine-translated. */
export function Code({ children }: { children: ReactNode }) {
  return <span translate="no">{children}</span>;
}

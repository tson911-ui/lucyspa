import { SERVICE_CONTENT_LIMITS, type ServiceFaqItem } from '@lucy-spa/contracts';
import { Prisma } from '@lucy-spa/database';
import { AuthError } from '../auth/auth.error.js';
import { text } from '../auth/registration.js';

/**
 * Redesign group 1 (C11b): the optional page content of a service (what is included, the steps, the FAQ), one JSON array per
 * language. An empty list is stored as NULL, so "none" has one shape and the public page hides the band. Texts are plain text:
 * trimmed, NFC, no control characters (the shared `text` rule); items that are blank after trimming are dropped, not refused.
 */
const {
  listItems,
  listItemMaxCodePoints,
  faqItems,
  faqQuestionMaxCodePoints,
  faqAnswerMaxCodePoints,
} = SERVICE_CONTENT_LIMITS;

function blank(value: unknown): boolean {
  return typeof value === 'string' && value.trim() === '';
}

/** A list of short texts (included, steps). */
export function serviceTextList(value: unknown, field: string): string[] {
  if (!Array.isArray(value) || value.length > listItems * 4) {
    throw new AuthError('VALIDATION_FAILED', field);
  }
  const items: string[] = [];
  for (const entry of value as unknown[]) {
    if (typeof entry !== 'string') throw new AuthError('VALIDATION_FAILED', field);
    if (blank(entry)) continue;
    items.push(text(entry, field, listItemMaxCodePoints));
  }
  if (items.length > listItems) throw new AuthError('VALIDATION_FAILED', field);
  return items;
}

/** A list of question/answer pairs. A pair with one side blank is refused: half a pair would draw an empty accordion row. */
export function serviceFaqList(value: unknown, field: string): ServiceFaqItem[] {
  if (!Array.isArray(value) || value.length > faqItems * 4) {
    throw new AuthError('VALIDATION_FAILED', field);
  }
  const items: ServiceFaqItem[] = [];
  for (const entry of value as unknown[]) {
    if (typeof entry !== 'object' || entry === null || Array.isArray(entry)) {
      throw new AuthError('VALIDATION_FAILED', field);
    }
    const { question, answer, ...rest } = entry as Record<string, unknown>;
    if (Object.keys(rest).length > 0) throw new AuthError('VALIDATION_FAILED', field);
    if (typeof question !== 'string' || typeof answer !== 'string') {
      throw new AuthError('VALIDATION_FAILED', field);
    }
    if (blank(question) && blank(answer)) continue;
    items.push({
      question: text(question, field, faqQuestionMaxCodePoints),
      answer: text(answer, field, faqAnswerMaxCodePoints),
    });
  }
  if (items.length > faqItems) throw new AuthError('VALIDATION_FAILED', field);
  return items;
}

/** What goes into a nullable JSON column: no items is SQL NULL. */
export function storedList<T>(items: readonly T[]): Prisma.InputJsonValue | typeof Prisma.DbNull {
  return items.length === 0 ? Prisma.DbNull : (items as unknown as Prisma.InputJsonValue);
}

/** Reads a JSON column back; anything that is not a clean list reads as none (the column is only ever written by this API). */
export function readTextList(value: Prisma.JsonValue | null): string[] {
  if (!Array.isArray(value)) return [];
  return value.filter((entry): entry is string => typeof entry === 'string' && entry.trim() !== '');
}

export function readFaqList(value: Prisma.JsonValue | null): ServiceFaqItem[] {
  if (!Array.isArray(value)) return [];
  const items: ServiceFaqItem[] = [];
  for (const entry of value) {
    if (typeof entry !== 'object' || entry === null || Array.isArray(entry)) continue;
    const { question, answer } = entry as { question?: unknown; answer?: unknown };
    if (
      typeof question === 'string' &&
      typeof answer === 'string' &&
      question !== '' &&
      answer !== ''
    ) {
      items.push({ question, answer });
    }
  }
  return items;
}

/** The same content, to compare a stored value with a new one without caring about key order. */
export function sameJson(a: unknown, b: unknown): boolean {
  return JSON.stringify(a ?? null) === JSON.stringify(b ?? null);
}

export interface ServiceContent {
  includedVi: string[];
  includedEn: string[];
  stepsVi: string[];
  stepsEn: string[];
  faqVi: ServiceFaqItem[];
  faqEn: ServiceFaqItem[];
}

const TEXT_KEYS = ['includedVi', 'includedEn', 'stepsVi', 'stepsEn'] as const;
const FAQ_KEYS = ['faqVi', 'faqEn'] as const;

/** The content fields a request carries (omitted = untouched), each validated. */
export function parseContentPatch(input: {
  [K in keyof ServiceContent]?: unknown;
}): Partial<ServiceContent> {
  const patch: Partial<ServiceContent> = {};
  for (const key of TEXT_KEYS) {
    if (input[key] !== undefined) patch[key] = serviceTextList(input[key], key);
  }
  for (const key of FAQ_KEYS) {
    if (input[key] !== undefined) patch[key] = serviceFaqList(input[key], key);
  }
  return patch;
}

type ContentRow = { [K in keyof ServiceContent]: Prisma.JsonValue | null };

/** The service content as the API presents it: a missing column reads as an empty list. */
export function readContent(row: ContentRow): ServiceContent {
  return {
    includedVi: readTextList(row.includedVi),
    includedEn: readTextList(row.includedEn),
    stepsVi: readTextList(row.stepsVi),
    stepsEn: readTextList(row.stepsEn),
    faqVi: readFaqList(row.faqVi),
    faqEn: readFaqList(row.faqEn),
  };
}

/** Only the fields whose content really differs; the audit and the version bump skip an unchanged save. */
export function contentChanges(
  row: ContentRow,
  patch: Partial<ServiceContent>,
): Partial<ServiceContent> {
  const current = readContent(row);
  const changes: Partial<ServiceContent> = {};
  for (const key of TEXT_KEYS) {
    const next = patch[key];
    if (next !== undefined && !sameJson(current[key], next)) changes[key] = next;
  }
  for (const key of FAQ_KEYS) {
    const next = patch[key];
    if (next !== undefined && !sameJson(current[key], next)) changes[key] = next;
  }
  return changes;
}

/** The changed content as database column values (an empty list is NULL). */
export function contentData(changes: Partial<ServiceContent>) {
  const data: {
    [K in keyof ServiceContent]?: Prisma.InputJsonValue | typeof Prisma.DbNull;
  } = {};
  for (const key of TEXT_KEYS) {
    const next = changes[key];
    if (next !== undefined) data[key] = storedList(next);
  }
  for (const key of FAQ_KEYS) {
    const next = changes[key];
    if (next !== undefined) data[key] = storedList(next);
  }
  return data;
}

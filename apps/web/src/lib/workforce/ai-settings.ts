import {
  AI_CAPPED_FEATURES,
  AI_LIMITS,
  type AiCappedFeature,
  type AiEffortLevel,
  type AiModelId,
  type AiSettings,
  type AiSettingsEditRequest,
} from '@lucy-spa/contracts';

/** The form of "Cài đặt AI": every value as the person types it (text), turned into a request that carries only what changed. */
export interface AiSettingsDraft {
  enabled: boolean;
  rewriteEnabled: boolean;
  vndPerUsd: string;
  monthlyCapVnd: string;
  featureCapsVnd: Record<AiCappedFeature, string>;
  rewriteModel: AiModelId;
  rewriteEffort: AiEffortLevel;
  concurrency: string;
  refusalFallback: boolean;
  allowAuthenticityClaims: boolean;
  /** One phrase per line. */
  bannedPhrases: string;
}

export type AiSettingsField =
  'vndPerUsd' | 'monthlyCapVnd' | 'featureCapsVnd' | 'concurrency' | 'bannedPhrases';

export function draftFromSettings(settings: AiSettings): AiSettingsDraft {
  return {
    enabled: settings.enabled,
    rewriteEnabled: settings.rewriteEnabled,
    vndPerUsd: settings.vndPerUsd === null ? '' : String(settings.vndPerUsd),
    monthlyCapVnd: settings.monthlyCapVnd,
    featureCapsVnd: { ...settings.featureCapsVnd },
    rewriteModel: settings.rewriteModel,
    rewriteEffort: settings.rewriteEffort,
    concurrency: String(settings.concurrency),
    refusalFallback: settings.refusalFallback,
    allowAuthenticityClaims: settings.allowAuthenticityClaims,
    bannedPhrases: settings.bannedPhrases.join('\n'),
  };
}

export const phrasesOf = (text: string): string[] =>
  text
    .split('\n')
    .map((line) => line.replace(/\s+/g, ' ').trim())
    .filter((line) => line !== '');

const CAP = /^(0|[1-9][0-9]{0,12})$/;

export function validateDraft(draft: AiSettingsDraft): Partial<Record<AiSettingsField, true>> {
  const problems: Partial<Record<AiSettingsField, true>> = {};
  if (draft.vndPerUsd.trim() !== '') {
    const rate = Number(draft.vndPerUsd);
    if (!Number.isInteger(rate) || rate < AI_LIMITS.vndPerUsdMin || rate > AI_LIMITS.vndPerUsdMax) {
      problems.vndPerUsd = true;
    }
  }
  if (!CAP.test(draft.monthlyCapVnd)) problems.monthlyCapVnd = true;
  if (AI_CAPPED_FEATURES.some((feature) => !CAP.test(draft.featureCapsVnd[feature]))) {
    problems.featureCapsVnd = true;
  }
  const concurrency = Number(draft.concurrency);
  if (!Number.isInteger(concurrency) || concurrency < 1 || concurrency > AI_LIMITS.concurrencyMax) {
    problems.concurrency = true;
  }
  const phrases = phrasesOf(draft.bannedPhrases);
  if (
    phrases.length > AI_LIMITS.bannedPhrasesMax ||
    phrases.some(
      (phrase) =>
        phrase.length < AI_LIMITS.bannedPhraseMin || phrase.length > AI_LIMITS.bannedPhraseMax,
    )
  ) {
    problems.bannedPhrases = true;
  }
  return problems;
}

export function isDirty(draft: AiSettingsDraft, settings: AiSettings): boolean {
  return Object.keys(editRequest(draft, settings)).length > 1;
}

/** Only the values that differ from what was read, plus the row version they were read at. */
export function editRequest(draft: AiSettingsDraft, settings: AiSettings): AiSettingsEditRequest {
  const request: AiSettingsEditRequest = { expectedRowVersion: settings.rowVersion };
  if (draft.enabled !== settings.enabled) request.enabled = draft.enabled;
  if (draft.rewriteEnabled !== settings.rewriteEnabled)
    request.rewriteEnabled = draft.rewriteEnabled;
  const rate = draft.vndPerUsd.trim() === '' ? null : Number(draft.vndPerUsd);
  if (rate !== settings.vndPerUsd) request.vndPerUsd = rate;
  if (draft.monthlyCapVnd !== settings.monthlyCapVnd) request.monthlyCapVnd = draft.monthlyCapVnd;
  const caps: Partial<Record<AiCappedFeature, string>> = {};
  for (const feature of AI_CAPPED_FEATURES) {
    if (draft.featureCapsVnd[feature] !== settings.featureCapsVnd[feature]) {
      caps[feature] = draft.featureCapsVnd[feature];
    }
  }
  if (Object.keys(caps).length > 0) request.featureCapsVnd = caps;
  if (draft.rewriteModel !== settings.rewriteModel) request.rewriteModel = draft.rewriteModel;
  if (draft.rewriteEffort !== settings.rewriteEffort) request.rewriteEffort = draft.rewriteEffort;
  if (Number(draft.concurrency) !== settings.concurrency)
    request.concurrency = Number(draft.concurrency);
  if (draft.refusalFallback !== settings.refusalFallback)
    request.refusalFallback = draft.refusalFallback;
  if (draft.allowAuthenticityClaims !== settings.allowAuthenticityClaims) {
    request.allowAuthenticityClaims = draft.allowAuthenticityClaims;
  }
  const phrases = phrasesOf(draft.bannedPhrases);
  if (JSON.stringify(phrases) !== JSON.stringify(settings.bannedPhrases))
    request.bannedPhrases = phrases;
  return request;
}

/** The server's field name for a refused value, as the form's field. */
export function serverField(error: unknown): AiSettingsField | null {
  const field = Reflect.get(Object(error), 'field') as unknown;
  if (typeof field !== 'string') return null;
  if (field.startsWith('featureCapsVnd')) return 'featureCapsVnd';
  return (
    (['vndPerUsd', 'monthlyCapVnd', 'concurrency', 'bannedPhrases'] as const).find(
      (name) => name === field,
    ) ?? null
  );
}

/** A VND figure with dots (1.234.567) or commas, for reading. */
export function vndText(value: string | null, locale: 'vi' | 'en'): string | null {
  if (value === null) return null;
  return Number(value).toLocaleString(locale === 'vi' ? 'vi-VN' : 'en-US');
}

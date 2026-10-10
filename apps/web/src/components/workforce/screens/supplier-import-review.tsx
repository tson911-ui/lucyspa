'use client';

import type {
  SupplierCandidateApproveResponse,
  SupplierCandidateDetail,
  SupplierCandidateDetailResponse,
  SupplierCandidateImage,
  SupplierMappingResponse,
} from '@lucy-spa/contracts';
import {
  buttonClass,
  CheckField,
  Dialog,
  DescriptionList,
  Drawer,
  Field,
  FormSection,
  Icon,
  PictureReview,
  Select,
  Stack,
  TextInput,
  Textarea,
  type DescriptionItem,
} from '@lucy-spa/ui';
import { useEffect, useRef, useState } from 'react';
import { supplierImportsDictionary } from '../../../i18n/supplier-imports';
import { fill } from '../../../i18n/workforce';
import { formatVnd } from '../../../lib/workforce/format';
import {
  draftOf,
  duplicateMatches,
  editRequest,
  importErrorText,
  isImportConflict,
  isOpen,
  mappingTexts,
  pictureUrl,
  stateTone,
  suggestionFor,
  validateDraft,
  warningField,
  warningText,
  type ReviewDraft,
} from '../../../lib/workforce/supplier-imports';
import { errorMessage } from '../../../lib/workforce/workflows';
import { useWorkforce } from '../session';
import { Badge, Button, ErrorState, Loading, Notice, useResource, useSuccessToast } from '../ui';

const BASE = '/api/v1/supplier-imports';

/** What the person typed stays when a decision or a mapping refreshes the candidate; a field they did not touch follows the server. */
function mergeDraft(
  draft: ReviewDraft,
  before: SupplierCandidateDetail,
  after: SupplierCandidateDetail,
): ReviewDraft {
  const was = draftOf(before);
  const now = draftOf(after);
  const merged = { ...draft };
  for (const key of Object.keys(now) as (keyof ReviewDraft)[]) {
    if (key !== 'listPriceVnd' && draft[key] === was[key]) {
      (merged as Record<string, string | boolean>)[key] = now[key];
    }
  }
  return merged;
}

/**
 * The review of one candidate (Phase 9 P9-6), in a drawer: each picture beside the product it was read from, the Lucy-owned fields,
 * what the source says, and what still needs attention. A reviewer saves edits, remembers a brand or category once, decides about a
 * shared picture or a look-alike, and approves, which creates ONE draft product. The server decides what may be approved; the screen
 * only shows the blockers it reports. A supplier price is drawn only when the server sent it.
 */
export function ReviewDrawer({
  id,
  onClose,
  onChanged,
}: {
  id: string;
  onClose: () => void;
  /** The list should be read again (something about this candidate changed). */
  onChanged: () => void;
}) {
  const { api, t, locale } = useWorkforce();
  const text = supplierImportsDictionary(locale);
  const copy = text.drawer;
  const notify = useSuccessToast();
  const loaded = useResource(
    () => api.get<SupplierCandidateDetailResponse>(`${BASE}/candidates/${id}`),
    [api, id],
  );
  const [item, setItem] = useState<SupplierCandidateDetail | null>(null);
  const [draft, setDraft] = useState<ReviewDraft | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [checked, setChecked] = useState(false);
  const [mapping, setMapping] = useState<'BRAND' | 'CATEGORY' | null>(null);
  const first = useRef(true);

  useEffect(() => {
    if (!loaded.data) return;
    setItem(loaded.data.item);
    if (first.current) {
      first.current = false;
      setDraft(draftOf(loaded.data.item));
    }
  }, [loaded.data]);

  if (loaded.error && !item) {
    return (
      <Drawer
        open
        title={copy.title}
        closeLabel={t.common.close}
        className="ls-drawer-form"
        onClose={onClose}
      >
        <ErrorState error={loaded.error} t={t} onRetry={() => void loaded.reload()} />
      </Drawer>
    );
  }
  if (!item || !draft) {
    return (
      <Drawer
        open
        title={copy.title}
        closeLabel={t.common.close}
        className="ls-drawer-form"
        onClose={onClose}
      >
        <Loading t={t} />
      </Drawer>
    );
  }

  const open = isOpen(item.state);
  const problems = validateDraft(draft);
  const body = editRequest(draft, item);
  const dirty = body !== null;
  const needsConflictReload = (failure: unknown) => isImportConflict(failure);

  async function fail(failure: unknown) {
    if (needsConflictReload(failure)) await loaded.reload();
    setError(importErrorText(failure, locale, (cause) => errorMessage(cause, t)));
  }

  /** Runs one command that answers with the refreshed candidate. */
  async function run(label: string, path: string, payload: object, message?: string) {
    if (busy || !item) return;
    setBusy(label);
    setError(null);
    try {
      const response = await api.post<SupplierCandidateDetailResponse>(
        `${BASE}/candidates/${id}/${path}`,
        payload,
      );
      const before = item;
      setItem(response.item);
      setDraft((current) =>
        current ? mergeDraft(current, before, response.item) : draftOf(response.item),
      );
      if (message) notify(message);
      onChanged();
    } catch (failure) {
      await fail(failure);
    } finally {
      setBusy(null);
    }
  }

  async function save() {
    if (!body || !item) return;
    setChecked(true);
    if (Object.keys(problems).some((key) => key !== 'listPriceVnd')) return;
    await run('save', 'edit', body, copy.saved);
  }

  async function approve() {
    if (busy || !item) return;
    setChecked(true);
    if (Object.keys(problems).length > 0) return;
    setBusy('approve');
    setError(null);
    try {
      const price = draft?.listPriceVnd.trim() ?? '';
      const done = await api.post<SupplierCandidateApproveResponse>(
        `${BASE}/candidates/${id}/approve`,
        {
          expectedVersion: item.rowVersion,
          ...(price !== '' ? { listPriceVnd: price } : {}),
        },
      );
      notify(fill(copy.approved, { sku: done.sku }));
      onChanged();
      onClose();
    } catch (failure) {
      await fail(failure);
      setBusy(null);
    }
  }

  const blockers = item.approval.blockers;
  const brandOptions = item.brands.map((entry) => ({ value: entry.id, label: entry.name }));
  const categoryOptions = item.categories.map((entry) => ({ value: entry.id, label: entry.name }));
  const matches = duplicateMatches(item);
  // The source texts are a hint only while the brand or category is still unresolved.
  const unresolvedTexts = (kind: 'BRAND' | 'CATEGORY') =>
    item.warnings.some((warning) => warning.code === `${kind}_UNMAPPED`)
      ? mappingTexts(item, kind)
      : [];
  const skuWarning = item.warnings.find((warning) => warning.code === 'SKU_FORMAT');
  const collision = item.warnings.find((warning) => warning.code === 'SKU_COLLISION');
  const statusNotice = !open ? (
    <Notice tone="info">
      {item.state === 'IMPORTED' ? copy.importedIntro : copy.decidedIntro}
    </Notice>
  ) : blockers.length > 0 ? (
    <Notice tone="warning">
      {`${copy.blockedIntro} ${blockers.map((blocker) => text.blockers[blocker]).join(' ')}`}
    </Notice>
  ) : item.warnings.length > 0 ? (
    <Notice tone="info">{copy.warnedIntro}</Notice>
  ) : (
    <Notice tone="success">{copy.readyIntro}</Notice>
  );

  const pictureFacts = (image: SupplierCandidateImage): DescriptionItem[] => [
    { label: copy.facts.product, value: item.nameVi },
    { label: copy.facts.sku, value: item.proposedSku ?? copy.facts.none },
    {
      label: copy.facts.page,
      value: (
        <a
          className={buttonClass('ghost', 'md', 'ls-btn-icon')}
          href={item.source.url}
          target="_blank"
          rel="noopener noreferrer"
          aria-label={copy.facts.openPage}
          title={copy.facts.openPage}
        >
          <Icon name="globe" />
        </a>
      ),
    },
    ...(image.variantKey ? [{ label: copy.facts.variant, value: image.variantKey }] : []),
    ...(image.sharedWith.length > 0
      ? [
          {
            label: copy.facts.sharedWith,
            value: image.sharedWith
              .map(
                (other) =>
                  `${other.name}${other.sku ? ` (${other.sku})` : ''} · ${copy.kinds[other.kind]}`,
              )
              .join('; '),
          },
        ]
      : []),
  ];

  return (
    <Drawer
      open
      title={copy.title}
      closeLabel={t.common.close}
      className="ls-drawer-form"
      busy={busy !== null}
      onClose={onClose}
      footer={
        <>
          <Button variant="secondary" onClick={onClose} disabled={busy !== null}>
            {t.common.close}
          </Button>
          {open ? (
            <Button
              variant="secondary"
              onClick={() => void save()}
              disabled={busy !== null || !dirty}
            >
              {busy === 'save' ? copy.saving : copy.save}
            </Button>
          ) : null}
          {open ? (
            <Button
              variant="primary"
              onClick={() => void approve()}
              disabled={busy !== null || dirty || !item.approval.canApprove}
              title={dirty ? copy.saveFirst : undefined}
            >
              {busy === 'approve' ? copy.approving : copy.approve}
            </Button>
          ) : null}
        </>
      }
    >
      <Stack gap="page">
        <div>
          <Badge tone={stateTone(item.state)}>{text.states[item.state]}</Badge>
        </div>
        {error ? <Notice tone="error">{error}</Notice> : null}
        {statusNotice}
        {dirty && open ? <Notice tone="info">{copy.saveFirst}</Notice> : null}

        <FormSection title={copy.sections.pictures}>
          {item.images.length === 0 ? (
            <p className="ls-hint">{copy.noPictures}</p>
          ) : (
            <Stack gap="page">
              {item.images.map((image) => (
                <PictureReview
                  key={image.id}
                  src={pictureUrl(item.id, image.id, 'md')}
                  alt={fill(copy.pictureAlt, { name: item.nameVi })}
                  facts={pictureFacts(image)}
                  badges={
                    <>
                      {image.flag ? <Badge tone="warning">{copy.flags[image.flag]}</Badge> : null}
                      {image.decision ? (
                        <Badge tone="neutral">{copy.decisions[image.decision]}</Badge>
                      ) : null}
                    </>
                  }
                  actions={
                    open && (image.flag !== null || image.decision !== null) ? (
                      <>
                        {image.decision !== 'KEEP' ? (
                          <Button
                            variant="secondary"
                            onClick={() =>
                              void run(
                                'image',
                                'image-decision',
                                {
                                  expectedVersion: item.rowVersion,
                                  imageId: image.id,
                                  decision: 'KEEP',
                                },
                                copy.decided,
                              )
                            }
                            disabled={busy !== null || dirty}
                          >
                            {copy.keep}
                          </Button>
                        ) : null}
                        {image.decision !== 'DROP' ? (
                          <Button
                            variant="secondary"
                            onClick={() =>
                              void run(
                                'image',
                                'image-decision',
                                {
                                  expectedVersion: item.rowVersion,
                                  imageId: image.id,
                                  decision: 'DROP',
                                },
                                copy.decided,
                              )
                            }
                            disabled={busy !== null || dirty}
                          >
                            {copy.drop}
                          </Button>
                        ) : (
                          <Button
                            variant="secondary"
                            onClick={() =>
                              void run(
                                'image',
                                'image-decision',
                                {
                                  expectedVersion: item.rowVersion,
                                  imageId: image.id,
                                  decision: 'KEEP',
                                },
                                copy.decided,
                              )
                            }
                            disabled={busy !== null || dirty}
                          >
                            {copy.restore}
                          </Button>
                        )}
                      </>
                    ) : null
                  }
                />
              ))}
            </Stack>
          )}
        </FormSection>

        {item.warnings.length > 0 ? (
          <FormSection title={copy.sections.issues}>
            <Stack gap="field">
              {item.warnings.map((warning, index) => (
                <Notice key={`${warning.code}-${index}`} tone="warning">
                  {warningText(warning.code, locale)}
                  {warning.code === 'SKU_COLLISION' && collision
                    ? `. ${fill(copy.skuTakenBy, { name: warningField(collision, 'productName') })}`
                    : ''}
                  {warning.code === 'SKU_FORMAT' &&
                  skuWarning &&
                  warningField(skuWarning, 'upperCaseWouldBe') !== ''
                    ? `. ${fill(copy.skuFormatNote, { sku: warningField(skuWarning, 'upperCaseWouldBe') })}`
                    : ''}
                </Notice>
              ))}
              {open
                ? matches.map((match) => (
                    <div key={match.ref} className="ls-picture-review-actions">
                      <span>
                        {fill(copy.duplicateOf, { name: match.name, kind: copy.kinds[match.kind] })}
                      </span>
                      <Button
                        variant="secondary"
                        onClick={() =>
                          void run(
                            'separate',
                            'keep-separate',
                            { expectedVersion: item.rowVersion, ref: match.ref },
                            copy.decided,
                          )
                        }
                        disabled={busy !== null || dirty}
                      >
                        {copy.keepSeparate}
                      </Button>
                    </div>
                  ))
                : null}
            </Stack>
          </FormSection>
        ) : null}

        <FormSection title={copy.sections.info}>
          <Stack gap="field">
            <Field
              label={copy.fields.nameVi}
              error={checked && problems.nameVi ? copy.problems.nameVi : undefined}
              required
              full
            >
              {(control) => (
                <TextInput
                  {...control}
                  value={draft.nameVi}
                  disabled={!open}
                  onChange={(event) => setDraft({ ...draft, nameVi: event.target.value })}
                />
              )}
            </Field>
            <Field
              label={copy.fields.nameEn}
              error={checked && problems.nameEn ? copy.problems.nameEn : undefined}
              required
              full
            >
              {(control) => (
                <TextInput
                  {...control}
                  value={draft.nameEn}
                  disabled={!open}
                  onChange={(event) => setDraft({ ...draft, nameEn: event.target.value })}
                />
              )}
            </Field>
            <CheckField
              label={copy.fields.needsTranslation}
              checked={draft.needsTranslation}
              disabled={!open}
              onChange={(event) => setDraft({ ...draft, needsTranslation: event.target.checked })}
            />
            <Field label={copy.fields.descriptionVi} full>
              {(control) => (
                <Textarea
                  {...control}
                  value={draft.descriptionVi}
                  disabled={!open}
                  onChange={(event) => setDraft({ ...draft, descriptionVi: event.target.value })}
                />
              )}
            </Field>
            <Field
              label={copy.fields.sku}
              hint={copy.fields.skuHint}
              error={checked && problems.proposedSku ? copy.problems.proposedSku : undefined}
              full
            >
              {(control) => (
                <TextInput
                  {...control}
                  autoComplete="off"
                  maxLength={64}
                  value={draft.proposedSku}
                  disabled={!open}
                  onChange={(event) => setDraft({ ...draft, proposedSku: event.target.value })}
                />
              )}
            </Field>
            <Field
              label={copy.fields.brand}
              hint={
                unresolvedTexts('BRAND').length > 0
                  ? fill(copy.sourceTexts, { texts: unresolvedTexts('BRAND').join(', ') })
                  : undefined
              }
              full
            >
              {(control) => (
                <Select
                  {...control}
                  value={draft.brandId}
                  options={brandOptions}
                  placeholder={copy.fields.choose}
                  disabled={!open}
                  onChange={(event) => setDraft({ ...draft, brandId: event.target.value })}
                />
              )}
            </Field>
            {open && suggestionFor(item, 'BRAND') && draft.brandId === '' ? (
              <p className="ls-hint">{copy.suggestion}</p>
            ) : null}
            {open &&
            draft.brandId !== '' &&
            item.warnings.some((w) => w.code === 'BRAND_UNMAPPED') ? (
              <div>
                <Button
                  variant="secondary"
                  onClick={() => setMapping('BRAND')}
                  disabled={busy !== null}
                >
                  {text.map.button}
                </Button>
              </div>
            ) : null}
            <Field
              label={copy.fields.category}
              hint={
                unresolvedTexts('CATEGORY').length > 0
                  ? fill(copy.sourceTexts, { texts: unresolvedTexts('CATEGORY').join(', ') })
                  : undefined
              }
              full
            >
              {(control) => (
                <Select
                  {...control}
                  value={draft.categoryId}
                  options={categoryOptions}
                  placeholder={copy.fields.choose}
                  disabled={!open}
                  onChange={(event) => setDraft({ ...draft, categoryId: event.target.value })}
                />
              )}
            </Field>
            {open &&
            draft.categoryId !== '' &&
            item.warnings.some((w) => w.code === 'CATEGORY_UNMAPPED') ? (
              <div>
                <Button
                  variant="secondary"
                  onClick={() => setMapping('CATEGORY')}
                  disabled={busy !== null}
                >
                  {text.map.button}
                </Button>
              </div>
            ) : null}
            {open && item.canSeePrices ? (
              <Field
                label={copy.fields.price}
                hint={copy.fields.priceHint}
                error={checked && problems.listPriceVnd ? copy.problems.listPriceVnd : undefined}
                full
              >
                {(control) => (
                  <TextInput
                    {...control}
                    inputMode="numeric"
                    autoComplete="off"
                    value={draft.listPriceVnd}
                    onChange={(event) => setDraft({ ...draft, listPriceVnd: event.target.value })}
                  />
                )}
              </Field>
            ) : null}
          </Stack>
        </FormSection>

        <FormSection title={copy.sections.source}>
          <DescriptionList
            items={[
              { label: copy.facts.source, value: item.source.sourceName },
              { label: copy.facts.sourceName, value: item.source.name },
              { label: copy.facts.sourceSku, value: item.source.sku ?? copy.facts.none },
              {
                label: copy.facts.sourceCategories,
                value:
                  item.source.categoryNames.length > 0
                    ? item.source.categoryNames.join(', ')
                    : copy.facts.none,
              },
              {
                label: copy.facts.page,
                value: (
                  <a
                    className={buttonClass('ghost', 'md', 'ls-btn-icon')}
                    href={item.source.url}
                    target="_blank"
                    rel="noopener noreferrer"
                    aria-label={copy.facts.openPage}
                    title={copy.facts.openPage}
                  >
                    <Icon name="globe" />
                  </a>
                ),
              },
              ...(item.sourcePrice
                ? [
                    {
                      label: copy.facts.sourcePrice,
                      value:
                        item.sourcePrice.priceVnd === null
                          ? copy.facts.none
                          : formatVnd(String(item.sourcePrice.priceVnd), locale),
                    },
                    ...(item.sourcePrice.promoPriceVnd !== null
                      ? [
                          {
                            label: copy.facts.promo,
                            value: formatVnd(String(item.sourcePrice.promoPriceVnd), locale),
                          },
                        ]
                      : []),
                  ]
                : []),
            ]}
          />
          {item.sourcePrice ? <p className="ls-hint">{copy.facts.sourceNote}</p> : null}
        </FormSection>
      </Stack>
      {mapping ? (
        <MappingDialog
          item={item}
          kind={mapping}
          targetId={mapping === 'BRAND' ? draft.brandId : draft.categoryId}
          onClose={() => setMapping(null)}
          onDone={async (result) => {
            setMapping(null);
            notify(
              result.changed
                ? fill(text.map.done, { count: String(result.evaluated) })
                : text.map.nothing,
            );
            await loaded.reload();
            onChanged();
          }}
        />
      ) : null}
    </Drawer>
  );
}

/** "This source text means this brand or category": remembered once, then every candidate showing that text is read again. */
function MappingDialog({
  item,
  kind,
  targetId,
  onClose,
  onDone,
}: {
  item: SupplierCandidateDetail;
  kind: 'BRAND' | 'CATEGORY';
  targetId: string;
  onClose: () => void;
  onDone: (result: SupplierMappingResponse) => Promise<void>;
}) {
  const { api, t, locale } = useWorkforce();
  const text = supplierImportsDictionary(locale);
  const texts = mappingTexts(item, kind);
  const [chosen, setChosen] = useState(texts[0] ?? '');
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const targetName =
    (kind === 'BRAND' ? item.brands : item.categories).find((entry) => entry.id === targetId)
      ?.name ?? '';

  async function submit() {
    if (pending || chosen === '' || targetId === '') return;
    setPending(true);
    setError(null);
    try {
      const result = await api.post<SupplierMappingResponse>(`${BASE}/mappings`, {
        candidateId: item.id,
        kind,
        sourceText: chosen,
        targetId,
      });
      await onDone(result);
    } catch (failure) {
      setError(importErrorText(failure, locale, (cause) => errorMessage(cause, t)));
      setPending(false);
    }
  }

  return (
    <Dialog
      open
      title={kind === 'BRAND' ? text.map.titleBrand : text.map.titleCategory}
      description={text.map.body}
      closeLabel={t.common.close}
      busy={pending}
      onClose={onClose}
      footer={
        <>
          <Button variant="secondary" onClick={onClose} disabled={pending}>
            {t.common.cancel}
          </Button>
          <Button
            variant="primary"
            onClick={() => void submit()}
            disabled={pending || chosen === ''}
          >
            {pending ? text.map.busy : text.map.submit}
          </Button>
        </>
      }
    >
      <Stack gap="field">
        {error ? <Notice tone="error">{error}</Notice> : null}
        <Field label={text.map.text} full>
          {(control) => (
            <Select
              {...control}
              value={chosen}
              options={texts.map((entry) => ({ value: entry, label: entry }))}
              onChange={(event) => setChosen(event.target.value)}
            />
          )}
        </Field>
        <DescriptionList items={[{ label: text.map.target, value: targetName }]} />
      </Stack>
    </Dialog>
  );
}

'use client';

import {
  FOOTER_BLOCK_TYPES,
  FOOTER_SOCIAL_NETWORKS,
  type FooterBlockType,
  type WebsiteFooterBlock,
  type WebsiteFooterLink,
} from '@lucy-spa/contracts';
import {
  Cluster,
  ConfirmDialog,
  Field,
  FormDrawer,
  FormGrid,
  FormSection,
  Icon,
  ListRow,
  MediaPreview,
  RowActions,
  Select,
  SortableList,
  Stack,
  Textarea,
  TextInput,
  type IconName,
} from '@lucy-spa/ui';
import { useState } from 'react';
import { fill } from '../../../i18n/workforce';
import { confirmError, formOverlayLabels } from '../../../lib/workforce/form-labels';
import { mediaVariantUrl } from '../../../lib/workforce/media';
import { opensInput } from '../../../lib/workforce/opens-input';
import {
  footerBlockOf,
  FOOTER_LIMITS,
  inOrder,
  isHttpsLink,
  isSiteLink,
  newFooterBlock,
  type ShopInfoForm,
} from '../../../lib/workforce/shop-info';
import { Badge, Button, Notice } from '../ui';
import { useWorkforce } from '../session';
import { MediaPicker } from './media-picker';
import { focusInvalidSoon } from './products-links';

/**
 * What the form is editing outside the page form: a block in the drawer (null id = a new one), or a block to delete after a
 * confirmation (`remove`; the deletion is kept in the form and saved with the profile).
 */
export type FooterBlockEditor = { id: string | null; remove?: boolean | undefined } | null;

type Patch = (patch: Partial<ShopInfoForm>) => void;

const TYPE_ICON: Record<FooterBlockType, IconName> = {
  SOCIAL: 'globe',
  APP: 'download',
  TEXT: 'info',
  LINKS: 'menu',
  IMAGE: 'image',
  SLOGAN: 'sparkles',
};

/**
 * The footer's brand column as a block area (Owner request 2026-10-04): the blocks in the order the footer draws
 * them, each with a visibility switch in its `⋮` menu. Changes are kept in the form and saved with the profile.
 */
export function FooterBlocksEditor({
  form,
  onChange,
  onEdit,
  problem,
}: {
  form: ShopInfoForm;
  onChange: Patch;
  onEdit: (editor: FooterBlockEditor) => void;
  problem: string | undefined;
}) {
  const { t, locale } = useWorkforce();
  const text = t.shopInfo;
  const nameOf = (block: WebsiteFooterBlock) => text.footerTypes[block.type];
  const metaOf = (block: WebsiteFooterBlock): string => {
    switch (block.type) {
      case 'SOCIAL':
        return FOOTER_SOCIAL_NETWORKS.filter((network) => block.urls[network] !== null)
          .map((network) => text.footerNetworks[network])
          .join(', ');
      case 'APP':
        return [
          block.googlePlayUrl !== null ? 'Google Play' : null,
          block.appStoreUrl !== null ? 'App Store' : null,
        ]
          .filter((name) => name !== null)
          .join(', ');
      case 'TEXT':
        return (locale === 'vi' ? block.textVi : block.textEn).split('\n')[0] ?? '';
      case 'LINKS':
        return block.items
          .map((item) => (locale === 'vi' ? item.labelVi : item.labelEn))
          .join(', ');
      case 'IMAGE':
        return block.linkUrl ?? text.footerImage;
      case 'SLOGAN':
        return (locale === 'vi' ? form.taglineVi : form.taglineEn).trim() || text.footerSloganEmpty;
    }
  };
  const toggle = (id: string) =>
    onChange({
      footerBlocks: form.footerBlocks.map((block) =>
        block.id === id ? { ...block, visible: !block.visible } : block,
      ),
    });
  return (
    <FormSection title={text.footerSection} description={text.footerHint}>
      <Stack gap="block">
        {form.footerBlocks.length === 0 ? <p className="ls-hint">{text.footerEmpty}</p> : null}
        <SortableList<WebsiteFooterBlock>
          items={form.footerBlocks}
          getId={(block) => block.id}
          getLabel={nameOf}
          labels={text.sortable}
          variant="bare"
          ariaLabel={text.footerListLabel}
          onReorder={(ids) =>
            onChange({ footerBlocks: inOrder(form.footerBlocks, ids, (block) => block.id) })
          }
          renderItem={(block) => (
            <ListRow
              icon={<Icon name={TYPE_ICON[block.type]} />}
              title={nameOf(block)}
              meta={metaOf(block)}
              badge={block.visible ? null : <Badge tone="neutral">{text.footerHidden}</Badge>}
              actions={
                <RowActions
                  menuLabel={fill(text.footerActionsFor, { name: nameOf(block) })}
                  items={[
                    ...(block.type === 'SLOGAN'
                      ? []
                      : [
                          {
                            id: 'edit',
                            label: opensInput(text.footerEdit),
                            icon: 'edit' as const,
                            onSelect: () => onEdit({ id: block.id }),
                          },
                        ]),
                    {
                      id: 'toggle',
                      label: block.visible ? text.footerHideItem : text.footerShowItem,
                      icon: block.visible ? ('eye-off' as const) : ('eye' as const),
                      onSelect: () => toggle(block.id),
                    },
                    {
                      id: 'delete',
                      label: text.footerDelete,
                      icon: 'trash' as const,
                      tone: 'danger' as const,
                      // Asks first (the confirmation is drawn outside the page form, with the drawer).
                      onSelect: () => onEdit({ id: block.id, remove: true }),
                    },
                  ]}
                />
              }
            />
          )}
        />
        {problem ? <Notice tone="error">{problem}</Notice> : null}
        <div>
          <Button
            variant="secondary"
            disabled={form.footerBlocks.length >= FOOTER_LIMITS.blocks}
            onClick={() => onEdit({ id: null })}
          >
            {opensInput(text.footerAdd)}
          </Button>
        </div>
      </Stack>
    </FormSection>
  );
}

/**
 * The block drawer, drawn outside the page's `<form>` (a dialog's own submit must never reach the page form's handler).
 * One drawer for every type: a block is a medium form, and the type decides which fields it shows.
 */
export function FooterBlockDrawer({
  editor,
  form,
  onChange,
  onClose,
}: {
  editor: FooterBlockEditor;
  form: ShopInfoForm;
  onChange: Patch;
  onClose: () => void;
}) {
  if (editor === null) return null;
  const block =
    editor.id === null ? null : (form.footerBlocks.find((item) => item.id === editor.id) ?? null);
  if (editor.id !== null && !block) return null;
  if (editor.remove && block) {
    return <RemoveBlock block={block} form={form} onChange={onChange} onClose={onClose} />;
  }
  return (
    <BlockDrawer
      key={editor.id ?? 'new'}
      block={block}
      onClose={onClose}
      onSave={(saved) => {
        onChange({
          footerBlocks: block
            ? form.footerBlocks.map((item) => (item.id === saved.id ? saved : item))
            : [...form.footerBlocks, saved],
        });
        onClose();
      }}
    />
  );
}

/** "Xóa khối" asks first; the block leaves the form at once and the website when the shop info is saved. */
function RemoveBlock({
  block,
  form,
  onChange,
  onClose,
}: {
  block: WebsiteFooterBlock;
  form: ShopInfoForm;
  onChange: Patch;
  onClose: () => void;
}) {
  const { t } = useWorkforce();
  const text = t.shopInfo;
  return (
    <ConfirmDialog
      title={text.removeConfirm.footerTitle}
      description={fill(text.removeConfirm.body, { name: text.footerTypes[block.type] })}
      tone="danger"
      confirmLabel={text.footerDelete}
      cancelLabel={t.common.cancel}
      describeError={confirmError(t)}
      onCancel={onClose}
      onConfirm={async () => {
        onChange({ footerBlocks: form.footerBlocks.filter((item) => item.id !== block.id) });
        onClose();
      }}
    />
  );
}

const cleanLine = (value: string) => value.normalize('NFC').replace(/\s+/g, ' ').trim();
const lengthOf = (value: string) => [...value].length;

/**
 * Why a block cannot be kept, field by field (the same rules as `footerBlockOf`, which still decides): each message says what to
 * type, and sits under its own field (wig: errors inline next to the field, focus the first one).
 */
function blockProblems(
  draft: WebsiteFooterBlock,
  text: ReturnType<typeof useWorkforce>['t']['shopInfo'],
): Record<string, string> {
  const problems: Record<string, string> = {};
  const length = (max: number) => fill(text.fieldLength, { max });
  const optional = (
    key: string,
    value: string | null,
    valid: (url: string) => boolean,
    message: string,
  ) => {
    const url = cleanLine(value ?? '');
    if (url !== '' && !valid(url)) problems[key] = message;
    return url !== '';
  };
  switch (draft.type) {
    case 'SOCIAL': {
      let any = false;
      for (const network of FOOTER_SOCIAL_NETWORKS) {
        if (optional(`url-${network}`, draft.urls[network], isHttpsLink, text.fieldHttps))
          any = true;
      }
      const first = FOOTER_SOCIAL_NETWORKS[0];
      if (!any && first) problems[`url-${first}`] = text.fieldOneLink;
      break;
    }
    case 'APP': {
      const google = optional('google-play-url', draft.googlePlayUrl, isHttpsLink, text.fieldHttps);
      const apple = optional('app-store-url', draft.appStoreUrl, isHttpsLink, text.fieldHttps);
      if (!google && !apple) problems['google-play-url'] = text.fieldOneLink;
      break;
    }
    case 'TEXT':
      for (const [key, value] of [
        ['text-vi', draft.textVi],
        ['text-en', draft.textEn],
      ] as const) {
        const typed = value.trim();
        if (typed === '' || lengthOf(typed) > FOOTER_LIMITS.text)
          problems[key] = length(FOOTER_LIMITS.text);
      }
      break;
    case 'LINKS': {
      const titleVi = cleanLine(draft.titleVi ?? '');
      const titleEn = cleanLine(draft.titleEn ?? '');
      if (titleVi === '' && titleEn !== '') problems['title-vi'] = text.fieldTitlePair;
      if (titleEn === '' && titleVi !== '') problems['title-en'] = text.fieldTitlePair;
      if (lengthOf(titleVi) > FOOTER_LIMITS.title)
        problems['title-vi'] = fill(text.fieldTooLong, { max: FOOTER_LIMITS.title });
      if (lengthOf(titleEn) > FOOTER_LIMITS.title)
        problems['title-en'] = fill(text.fieldTooLong, { max: FOOTER_LIMITS.title });
      draft.items.forEach((item, index) => {
        for (const [key, value] of [
          ['label-vi', item.labelVi],
          ['label-en', item.labelEn],
        ] as const) {
          const label = cleanLine(value);
          if (label === '' || lengthOf(label) > FOOTER_LIMITS.label)
            problems[`item-${index}-${key}`] = length(FOOTER_LIMITS.label);
        }
        if (!isSiteLink(cleanLine(item.url))) problems[`item-${index}-url`] = text.fieldSiteLink;
      });
      break;
    }
    case 'IMAGE':
      if (draft.mediaId === '') problems['media'] = text.fieldImage;
      optional('link-url', draft.linkUrl, isSiteLink, text.fieldSiteLink);
      break;
    case 'SLOGAN':
      break;
  }
  return problems;
}

function BlockDrawer({
  block,
  onClose,
  onSave,
}: {
  block: WebsiteFooterBlock | null;
  onClose: () => void;
  onSave: (block: WebsiteFooterBlock) => void;
}) {
  const { t } = useWorkforce();
  const text = t.shopInfo;
  const [initial] = useState<WebsiteFooterBlock>(() => block ?? newFooterBlock('SOCIAL'));
  const [draft, setDraft] = useState<WebsiteFooterBlock>(initial);
  const [checked, setChecked] = useState(false);
  const [picking, setPicking] = useState(false);
  const dirty = JSON.stringify(draft) !== JSON.stringify(initial);
  const edit = (next: WebsiteFooterBlock) => setDraft(next);
  // After a refused save every field shows what to fix, and the message goes as soon as the field is right.
  const problems = checked ? blockProblems(draft, text) : {};
  const unexplained =
    checked && Object.keys(problems).length === 0 && footerBlockOf(draft) === null;
  return (
    <>
      <FormDrawer
        title={block ? text.footerEditTitle : text.footerAddTitle}
        onClose={onClose}
        dirty={dirty}
        error={unexplained ? text.footerDialogProblem : undefined}
        labels={formOverlayLabels(t, block ? text.footerSubmitEdit : text.footerSubmitAdd)}
        onSubmit={() => {
          const cleaned = footerBlockOf(draft);
          if (cleaned === null) {
            setChecked(true);
            focusInvalidSoon();
            return;
          }
          onSave(cleaned);
        }}
      >
        <Stack gap="block">
          <Field label={text.footerType} hint={text.footerTypeHints[draft.type]}>
            {(control) => (
              <Select
                {...control}
                disabled={block !== null}
                options={FOOTER_BLOCK_TYPES.map((value) => ({
                  value,
                  label: text.footerTypes[value],
                }))}
                value={draft.type}
                onChange={(event) => {
                  // A new block of another type starts empty (the id stays: it is the same row in the list).
                  const next = newFooterBlock(event.target.value as FooterBlockType);
                  edit({ ...next, id: draft.id, visible: draft.visible });
                }}
              />
            )}
          </Field>
          <BlockFields
            draft={draft}
            problems={problems}
            onEdit={edit}
            onPick={() => setPicking(true)}
          />
        </Stack>
      </FormDrawer>
      {picking ? (
        <MediaPicker
          onPick={(asset) => {
            if (draft.type === 'IMAGE') edit({ ...draft, mediaId: asset.id });
            setPicking(false);
          }}
          onClose={() => setPicking(false)}
        />
      ) : null}
    </>
  );
}

function BlockFields({
  draft,
  problems,
  onEdit,
  onPick,
}: {
  draft: WebsiteFooterBlock;
  problems: Record<string, string>;
  onEdit: (block: WebsiteFooterBlock) => void;
  onPick: () => void;
}) {
  const { t } = useWorkforce();
  const text = t.shopInfo;
  switch (draft.type) {
    case 'SOCIAL':
      return (
        <Stack gap="block">
          {FOOTER_SOCIAL_NETWORKS.map((network, position) => (
            <Field
              key={network}
              label={text.footerNetworks[network]}
              hint={
                position === 0 ? `${text.footerLinkHint} ${text.footerSocialAtLeastOne}` : undefined
              }
              error={problems[`url-${network}`]}
            >
              {(control) => (
                <TextInput
                  {...control}
                  name={`url-${network}`}
                  spellCheck={false}
                  inputMode="url"
                  autoComplete="off"
                  placeholder={text.footerUrlPlaceholder}
                  value={draft.urls[network] ?? ''}
                  onChange={(event) =>
                    onEdit({ ...draft, urls: { ...draft.urls, [network]: event.target.value } })
                  }
                />
              )}
            </Field>
          ))}
        </Stack>
      );
    case 'APP':
      return (
        <Stack gap="block">
          <Field
            label={text.footerGooglePlay}
            hint={text.footerLinkHint}
            error={problems['google-play-url']}
          >
            {(control) => (
              <TextInput
                {...control}
                name="google-play-url"
                spellCheck={false}
                inputMode="url"
                autoComplete="off"
                placeholder={text.footerUrlPlaceholder}
                value={draft.googlePlayUrl ?? ''}
                onChange={(event) => onEdit({ ...draft, googlePlayUrl: event.target.value })}
              />
            )}
          </Field>
          <Field
            label={text.footerAppStore}
            hint={text.footerLinkHint}
            error={problems['app-store-url']}
          >
            {(control) => (
              <TextInput
                {...control}
                name="app-store-url"
                spellCheck={false}
                inputMode="url"
                autoComplete="off"
                placeholder={text.footerUrlPlaceholder}
                value={draft.appStoreUrl ?? ''}
                onChange={(event) => onEdit({ ...draft, appStoreUrl: event.target.value })}
              />
            )}
          </Field>
          <p className="ls-hint">{text.footerBadgeNote}</p>
        </Stack>
      );
    case 'TEXT':
      return (
        <Stack gap="block">
          <Field
            label={text.footerTextVi}
            hint={text.footerTextHint}
            required
            requiredLabel={t.common.required}
            error={problems['text-vi']}
          >
            {(control) => (
              <Textarea
                {...control}
                name="text-vi"
                autoComplete="off"
                rows={4}
                value={draft.textVi}
                onChange={(event) => onEdit({ ...draft, textVi: event.target.value })}
              />
            )}
          </Field>
          <Field
            label={text.footerTextEn}
            required
            requiredLabel={t.common.required}
            error={problems['text-en']}
          >
            {(control) => (
              <Textarea
                {...control}
                name="text-en"
                autoComplete="off"
                rows={4}
                value={draft.textEn}
                onChange={(event) => onEdit({ ...draft, textEn: event.target.value })}
              />
            )}
          </Field>
        </Stack>
      );
    case 'LINKS': {
      const setItem = (index: number, patch: Partial<WebsiteFooterLink>) =>
        onEdit({
          ...draft,
          items: draft.items.map((item, at) => (at === index ? { ...item, ...patch } : item)),
        });
      return (
        <Stack gap="block">
          <FormGrid cols={2}>
            <Field
              label={text.footerLinksTitleVi}
              hint={text.footerLinksTitleHint}
              error={problems['title-vi']}
            >
              {(control) => (
                <TextInput
                  {...control}
                  name="title-vi"
                  value={draft.titleVi ?? ''}
                  onChange={(event) => onEdit({ ...draft, titleVi: event.target.value })}
                />
              )}
            </Field>
            <Field label={text.footerLinksTitleEn} error={problems['title-en']}>
              {(control) => (
                <TextInput
                  {...control}
                  name="title-en"
                  value={draft.titleEn ?? ''}
                  onChange={(event) => onEdit({ ...draft, titleEn: event.target.value })}
                />
              )}
            </Field>
          </FormGrid>
          {draft.items.map((item, index) => (
            <FormSection key={index} title={fill(text.footerLinkItem, { n: index + 1 })}>
              <Stack gap="block">
                <FormGrid cols={2}>
                  <Field
                    label={text.footerLinkLabelVi}
                    required
                    requiredLabel={t.common.required}
                    error={problems[`item-${index}-label-vi`]}
                  >
                    {(control) => (
                      <TextInput
                        {...control}
                        name="item-label-vi"
                        value={item.labelVi}
                        onChange={(event) => setItem(index, { labelVi: event.target.value })}
                      />
                    )}
                  </Field>
                  <Field
                    label={text.footerLinkLabelEn}
                    required
                    requiredLabel={t.common.required}
                    error={problems[`item-${index}-label-en`]}
                  >
                    {(control) => (
                      <TextInput
                        {...control}
                        name="item-label-en"
                        value={item.labelEn}
                        onChange={(event) => setItem(index, { labelEn: event.target.value })}
                      />
                    )}
                  </Field>
                  <Field
                    label={text.footerLinkUrl}
                    hint={text.footerLinkUrlHint}
                    required
                    requiredLabel={t.common.required}
                    error={problems[`item-${index}-url`]}
                    full
                  >
                    {(control) => (
                      <TextInput
                        {...control}
                        name="item-url"
                        spellCheck={false}
                        inputMode="url"
                        autoComplete="off"
                        value={item.url}
                        onChange={(event) => setItem(index, { url: event.target.value })}
                      />
                    )}
                  </Field>
                </FormGrid>
                {draft.items.length > 1 ? (
                  <div>
                    <Button
                      variant="ghost"
                      onClick={() =>
                        onEdit({ ...draft, items: draft.items.filter((_, at) => at !== index) })
                      }
                    >
                      {fill(text.footerLinkRemove, { n: index + 1 })}
                    </Button>
                  </div>
                ) : null}
              </Stack>
            </FormSection>
          ))}
          <div>
            <Button
              variant="secondary"
              disabled={draft.items.length >= FOOTER_LIMITS.links}
              onClick={() =>
                onEdit({ ...draft, items: [...draft.items, { labelVi: '', labelEn: '', url: '' }] })
              }
            >
              {text.footerLinkAdd}
            </Button>
          </div>
        </Stack>
      );
    }
    case 'IMAGE':
      return (
        <Stack gap="block">
          {draft.mediaId !== '' ? (
            <MediaPreview
              src={mediaVariantUrl(draft.mediaId, 'md')}
              alt={text.footerImagePreview}
            />
          ) : (
            <p className="ls-hint">{text.footerImageNone}</p>
          )}
          <Cluster>
            <Button
              variant="secondary"
              onClick={onPick}
              {...(problems['media'] ? { 'aria-describedby': 'footer-image-error' } : {})}
            >
              {opensInput(draft.mediaId !== '' ? text.footerImageChange : text.footerImageChoose)}
            </Button>
          </Cluster>
          {problems['media'] ? (
            <p className="ls-error" id="footer-image-error" role="alert">
              <Icon name="x-circle" size={16} />
              <span>{problems['media']}</span>
            </p>
          ) : null}
          <Field
            label={text.footerImageLink}
            hint={text.footerImageLinkHint}
            error={problems['link-url']}
          >
            {(control) => (
              <TextInput
                {...control}
                name="link-url"
                spellCheck={false}
                inputMode="url"
                autoComplete="off"
                value={draft.linkUrl ?? ''}
                onChange={(event) => onEdit({ ...draft, linkUrl: event.target.value })}
              />
            )}
          </Field>
        </Stack>
      );
    case 'SLOGAN':
      return null;
  }
}

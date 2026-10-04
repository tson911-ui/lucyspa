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
import { formOverlayLabels } from '../../../lib/workforce/form-labels';
import { mediaVariantUrl } from '../../../lib/workforce/media';
import {
  footerBlockOf,
  FOOTER_LIMITS,
  inOrder,
  newFooterBlock,
  type ShopInfoForm,
} from '../../../lib/workforce/shop-info';
import { Badge, Button, Notice } from '../ui';
import { useWorkforce } from '../session';
import { MediaPicker } from './media-picker';

/** What the form is editing in the drawer: a block (null id = a new one). */
export type FooterBlockEditor = { id: string | null } | null;

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
                            label: text.footerEdit,
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
                      onSelect: () =>
                        onChange({
                          footerBlocks: form.footerBlocks.filter((item) => item.id !== block.id),
                        }),
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
            {text.footerAdd}
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
  const [failed, setFailed] = useState(false);
  const [picking, setPicking] = useState(false);
  const dirty = JSON.stringify(draft) !== JSON.stringify(initial);
  const edit = (next: WebsiteFooterBlock) => {
    setDraft(next);
    setFailed(false);
  };
  return (
    <>
      <FormDrawer
        title={block ? text.footerEditTitle : text.footerAddTitle}
        onClose={onClose}
        dirty={dirty}
        error={failed ? text.footerDialogProblem : undefined}
        labels={formOverlayLabels(t, block ? text.footerSubmitEdit : text.footerSubmitAdd)}
        onSubmit={() => {
          const cleaned = footerBlockOf(draft);
          if (cleaned === null) {
            setFailed(true);
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
          <BlockFields draft={draft} onEdit={edit} onPick={() => setPicking(true)} />
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
  onEdit,
  onPick,
}: {
  draft: WebsiteFooterBlock;
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
            >
              {(control) => (
                <TextInput
                  {...control}
                  inputMode="url"
                  autoComplete="off"
                  placeholder="https://"
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
          <Field label={text.footerGooglePlay} hint={text.footerLinkHint}>
            {(control) => (
              <TextInput
                {...control}
                inputMode="url"
                autoComplete="off"
                placeholder="https://"
                value={draft.googlePlayUrl ?? ''}
                onChange={(event) => onEdit({ ...draft, googlePlayUrl: event.target.value })}
              />
            )}
          </Field>
          <Field label={text.footerAppStore} hint={text.footerLinkHint}>
            {(control) => (
              <TextInput
                {...control}
                inputMode="url"
                autoComplete="off"
                placeholder="https://"
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
          >
            {(control) => (
              <Textarea
                {...control}
                rows={4}
                value={draft.textVi}
                onChange={(event) => onEdit({ ...draft, textVi: event.target.value })}
              />
            )}
          </Field>
          <Field label={text.footerTextEn} required requiredLabel={t.common.required}>
            {(control) => (
              <Textarea
                {...control}
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
            <Field label={text.footerLinksTitleVi} hint={text.footerLinksTitleHint}>
              {(control) => (
                <TextInput
                  {...control}
                  value={draft.titleVi ?? ''}
                  onChange={(event) => onEdit({ ...draft, titleVi: event.target.value })}
                />
              )}
            </Field>
            <Field label={text.footerLinksTitleEn}>
              {(control) => (
                <TextInput
                  {...control}
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
                  <Field label={text.footerLinkLabelVi} required requiredLabel={t.common.required}>
                    {(control) => (
                      <TextInput
                        {...control}
                        value={item.labelVi}
                        onChange={(event) => setItem(index, { labelVi: event.target.value })}
                      />
                    )}
                  </Field>
                  <Field label={text.footerLinkLabelEn} required requiredLabel={t.common.required}>
                    {(control) => (
                      <TextInput
                        {...control}
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
                    full
                  >
                    {(control) => (
                      <TextInput
                        {...control}
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
            <Button variant="secondary" onClick={onPick}>
              {draft.mediaId !== '' ? text.footerImageChange : text.footerImageChoose}
            </Button>
          </Cluster>
          <Field label={text.footerImageLink} hint={text.footerImageLinkHint}>
            {(control) => (
              <TextInput
                {...control}
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

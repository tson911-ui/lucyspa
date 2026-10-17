'use client';

import {
  SHOP_FACT_ICONS,
  WHY_ICONS,
  type ShopFactIcon,
  type WebsiteFeaturedGroup,
  type WebsiteShopFact,
  type WebsiteShopInfoResponse,
  type WebsiteWhyCard,
  type WhyIcon,
} from '@lucy-spa/contracts';
import {
  ConfirmDialog,
  Field,
  FormDialog,
  FormGrid,
  FormSection,
  Icon,
  IconPicker,
  ListRow,
  RowActions,
  Select,
  SortableList,
  Stack,
  Switch,
  Textarea,
  TextInput,
  type IconName,
} from '@lucy-spa/ui';
import { useState } from 'react';
import { fill } from '../../../i18n/workforce';
import { confirmError, formOverlayLabels } from '../../../lib/workforce/form-labels';
import { opensInput } from '../../../lib/workforce/opens-input';
import {
  inOrder,
  newFactId,
  SHOP_INFO_LIMITS,
  type ShopInfoForm,
} from '../../../lib/workforce/shop-info';
import { Badge, Button, Notice } from '../ui';
import { useWorkforce } from '../session';
import { focusInvalidSoon } from './products-links';

/**
 * What the form is editing in a dialog: a custom fact (null id = a new one), a featured group (null code = a new one), a why-card,
 * or an item to take out after a confirmation (`remove`: the change is kept in the form and saved with the profile).
 */
export type ShopListEditor =
  | { kind: 'fact'; id: string | null }
  | { kind: 'group'; code: string | null }
  | { kind: 'why'; id: string | null }
  | { kind: 'remove'; list: 'fact' | 'group' | 'why'; id: string; name: string }
  | null;

type Patch = (patch: Partial<ShopInfoForm>) => void;

const BUILT_IN_ICON: Record<string, IconName> = {
  HOURS: 'clock',
  ADDRESS: 'map-pin',
  HOTLINE: 'phone',
};

/** The facts strip: show or hide the whole strip, then the ordered items (built-in ones can be hidden, custom ones edited). */
export function FactsEditor({
  form,
  onChange,
  onEdit,
  problem,
}: {
  form: ShopInfoForm;
  onChange: Patch;
  onEdit: (editor: ShopListEditor) => void;
  problem: string | undefined;
}) {
  const { t, locale } = useWorkforce();
  const text = t.shopInfo;
  const other = locale === 'vi' ? 'EN' : 'VI';
  const nameOf = (fact: WebsiteShopFact) => {
    if (fact.kind === 'HOURS') return text.factHours;
    if (fact.kind === 'ADDRESS') return text.factAddress;
    if (fact.kind === 'HOTLINE') return text.factHotline;
    return (locale === 'vi' ? fact.textVi : fact.textEn) ?? '';
  };
  const metaOf = (fact: WebsiteShopFact) => {
    if (fact.kind === 'HOURS') return text.factHoursMeta;
    if (fact.kind === 'ADDRESS') return text.factAddressMeta;
    if (fact.kind === 'HOTLINE') return text.factHotlineMeta;
    return `${other}: ${(locale === 'vi' ? fact.textEn : fact.textVi) ?? ''}`;
  };
  const toggle = (id: string) =>
    onChange({
      facts: form.facts.map((fact) =>
        fact.id === id ? { ...fact, visible: !fact.visible } : fact,
      ),
    });
  return (
    <FormSection title={text.factsSection} description={text.factsHint}>
      <Stack gap="block">
        <Switch
          checked={form.factsVisible}
          onCheckedChange={(checked) => onChange({ factsVisible: checked })}
          label={text.factsShow}
        />
        <SortableList<WebsiteShopFact>
          items={form.facts}
          getId={(fact) => fact.id}
          getLabel={nameOf}
          labels={text.sortable}
          variant="bare"
          ariaLabel={text.factsListLabel}
          onReorder={(ids) => onChange({ facts: inOrder(form.facts, ids, (fact) => fact.id) })}
          renderItem={(fact) => (
            <ListRow
              icon={<Icon name={fact.icon ?? BUILT_IN_ICON[fact.kind] ?? 'info'} />}
              title={nameOf(fact)}
              meta={metaOf(fact)}
              badge={fact.visible ? null : <Badge tone="neutral">{text.factHidden}</Badge>}
              actions={
                <RowActions
                  menuLabel={text.factActionsFor.replace('{name}', nameOf(fact))}
                  items={[
                    ...(fact.kind === 'CUSTOM'
                      ? [
                          {
                            id: 'edit',
                            label: opensInput(text.factEdit),
                            icon: 'edit' as const,
                            onSelect: () => onEdit({ kind: 'fact', id: fact.id }),
                          },
                        ]
                      : []),
                    {
                      id: 'toggle',
                      label: fact.visible ? text.factHideItem : text.factShowItem,
                      icon: fact.visible ? ('eye-off' as const) : ('eye' as const),
                      onSelect: () => toggle(fact.id),
                    },
                    ...(fact.kind === 'CUSTOM'
                      ? [
                          {
                            id: 'delete',
                            label: text.factDelete,
                            icon: 'trash' as const,
                            tone: 'danger' as const,
                            onSelect: () =>
                              onEdit({
                                kind: 'remove',
                                list: 'fact',
                                id: fact.id,
                                name: nameOf(fact),
                              }),
                          },
                        ]
                      : []),
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
            disabled={form.facts.length >= 16}
            onClick={() => onEdit({ kind: 'fact', id: null })}
          >
            {opensInput(text.factAdd)}
          </Button>
        </div>
      </Stack>
    </FormSection>
  );
}

/** The featured groups: the chosen groups in order, each with its description; none chosen = every group on the site. */
export function GroupsEditor({
  form,
  info,
  onChange,
  onEdit,
  problem,
}: {
  form: ShopInfoForm;
  info: WebsiteShopInfoResponse;
  onChange: Patch;
  onEdit: (editor: ShopListEditor) => void;
  problem: string | undefined;
}) {
  const { t, locale } = useWorkforce();
  const text = t.shopInfo;
  const nameOf = (group: WebsiteFeaturedGroup) => {
    const option = info.groupOptions.find((candidate) => candidate.code === group.code);
    return option ? (locale === 'vi' ? option.nameVi : option.nameEn) : group.code;
  };
  const known = (group: WebsiteFeaturedGroup) =>
    info.groupOptions.some((candidate) => candidate.code === group.code);
  const free = info.groupOptions.length - form.featuredGroups.length;
  return (
    <FormSection title={text.groupsSection} description={text.groupsHint}>
      <Stack gap="block">
        {form.featuredGroups.length === 0 ? (
          <p className="ls-hint">{text.groupsEmpty}</p>
        ) : (
          <SortableList<WebsiteFeaturedGroup>
            items={form.featuredGroups}
            getId={(group) => group.code}
            getLabel={nameOf}
            labels={text.sortable}
            variant="bare"
            ariaLabel={text.groupsListLabel}
            onReorder={(ids) =>
              onChange({ featuredGroups: inOrder(form.featuredGroups, ids, (group) => group.code) })
            }
            renderItem={(group) => (
              <ListRow
                title={nameOf(group)}
                meta={
                  (locale === 'vi' ? group.descriptionVi : group.descriptionEn) ??
                  text.groupNoDescription
                }
                badge={known(group) ? null : <Badge tone="warning">{text.groupInactive}</Badge>}
                actions={
                  <RowActions
                    menuLabel={text.groupActionsFor.replace('{name}', nameOf(group))}
                    items={[
                      {
                        id: 'edit',
                        label: opensInput(text.groupEdit),
                        icon: 'edit',
                        onSelect: () => onEdit({ kind: 'group', code: group.code }),
                      },
                      {
                        id: 'remove',
                        label: text.groupRemove,
                        icon: 'trash',
                        tone: 'danger',
                        onSelect: () =>
                          onEdit({
                            kind: 'remove',
                            list: 'group',
                            id: group.code,
                            name: nameOf(group),
                          }),
                      },
                    ]}
                  />
                }
              />
            )}
          />
        )}
        {problem ? <Notice tone="error">{problem}</Notice> : null}
        <div>
          <Button
            variant="secondary"
            disabled={free <= 0 || form.featuredGroups.length >= 12}
            onClick={() => onEdit({ kind: 'group', code: null })}
          >
            {opensInput(text.groupAdd)}
          </Button>
        </div>
      </Stack>
    </FormSection>
  );
}

const clean = (value: string) => value.normalize('NFC').replace(/\s+/g, ' ').trim();
const length = (value: string) => [...value].length;

/**
 * The two small dialogs. They are drawn outside the page's `<form>`: a dialog's own form submit must never reach the
 * page form's handler (React bubbles submit through portals), which would save the whole profile.
 */
export function ShopListDialogs({
  editor,
  form,
  info,
  onChange,
  onClose,
}: {
  editor: ShopListEditor;
  form: ShopInfoForm;
  info: WebsiteShopInfoResponse;
  onChange: Patch;
  onClose: () => void;
}) {
  if (editor?.kind === 'remove') {
    return <RemoveDialog editor={editor} form={form} onChange={onChange} onClose={onClose} />;
  }
  if (editor?.kind === 'fact') {
    const fact =
      editor.id === null ? null : (form.facts.find((item) => item.id === editor.id) ?? null);
    if (editor.id !== null && !fact) return null;
    return (
      <FactDialog
        key={editor.id ?? 'new'}
        fact={fact}
        onClose={onClose}
        onSave={(saved) => {
          onChange({
            facts: fact
              ? form.facts.map((item) => (item.id === saved.id ? saved : item))
              : [...form.facts, saved],
          });
          onClose();
        }}
      />
    );
  }
  if (editor?.kind === 'why') {
    const card =
      editor.id === null ? null : (form.whyCards.find((item) => item.id === editor.id) ?? null);
    if (editor.id !== null && !card) return null;
    return (
      <WhyCardDialog
        key={editor.id ?? 'new'}
        card={card}
        onClose={onClose}
        onSave={(saved) => {
          onChange({
            whyCards: card
              ? form.whyCards.map((item) => (item.id === saved.id ? saved : item))
              : [...form.whyCards, saved],
          });
          onClose();
        }}
      />
    );
  }
  if (editor?.kind === 'group') {
    const group =
      editor.code === null
        ? null
        : (form.featuredGroups.find((item) => item.code === editor.code) ?? null);
    if (editor.code !== null && !group) return null;
    return (
      <GroupDialog
        key={editor.code ?? 'new'}
        group={group}
        info={info}
        taken={form.featuredGroups.map((item) => item.code)}
        onClose={onClose}
        onSave={(saved) => {
          onChange({
            featuredGroups: group
              ? form.featuredGroups.map((item) => (item.code === saved.code ? saved : item))
              : [...form.featuredGroups, saved],
          });
          onClose();
        }}
      />
    );
  }
  return null;
}

/** A delete or remove from a list asks first; the item leaves the form at once and the website when the shop info is saved. */
function RemoveDialog({
  editor,
  form,
  onChange,
  onClose,
}: {
  editor: Extract<ShopListEditor, { kind: 'remove' }>;
  form: ShopInfoForm;
  onChange: Patch;
  onClose: () => void;
}) {
  const { t } = useWorkforce();
  const text = t.shopInfo;
  const copy =
    editor.list === 'fact'
      ? { title: text.removeConfirm.factTitle, confirm: text.factDelete }
      : editor.list === 'group'
        ? { title: text.removeConfirm.groupTitle, confirm: text.groupRemove }
        : { title: text.removeConfirm.whyTitle, confirm: text.whyDelete };
  return (
    <ConfirmDialog
      title={copy.title}
      description={fill(text.removeConfirm.body, { name: editor.name })}
      tone="danger"
      confirmLabel={copy.confirm}
      cancelLabel={t.common.cancel}
      describeError={confirmError(t)}
      onCancel={onClose}
      onConfirm={async () => {
        if (editor.list === 'fact') {
          onChange({ facts: form.facts.filter((item) => item.id !== editor.id) });
        } else if (editor.list === 'group') {
          onChange({
            featuredGroups: form.featuredGroups.filter((item) => item.code !== editor.id),
          });
        } else {
          onChange({ whyCards: form.whyCards.filter((item) => item.id !== editor.id) });
        }
        onClose();
      }}
    />
  );
}

/** "Nhập từ 1 đến {max} ký tự." when a required text is empty or too long, else nothing. */
function lengthProblem(value: string, max: number, template: string): string | undefined {
  const text = clean(value);
  return text === '' || length(text) > max ? fill(template, { max }) : undefined;
}

function FactDialog({
  fact,
  onClose,
  onSave,
}: {
  fact: WebsiteShopFact | null;
  onClose: () => void;
  onSave: (fact: WebsiteShopFact) => void;
}) {
  const { t } = useWorkforce();
  const text = t.shopInfo;
  const [icon, setIcon] = useState<ShopFactIcon>(fact?.icon ?? 'sparkles');
  const [textVi, setTextVi] = useState(fact?.textVi ?? '');
  const [textEn, setTextEn] = useState(fact?.textEn ?? '');
  const [checked, setChecked] = useState(false);
  // An icon-only change counts as an edit too (closing asks before it is lost).
  const dirty =
    icon !== (fact?.icon ?? 'sparkles') ||
    textVi !== (fact?.textVi ?? '') ||
    textEn !== (fact?.textEn ?? '');
  const problemVi = checked
    ? lengthProblem(textVi, SHOP_INFO_LIMITS.factText, text.fieldLength)
    : undefined;
  const problemEn = checked
    ? lengthProblem(textEn, SHOP_INFO_LIMITS.factText, text.fieldLength)
    : undefined;
  return (
    <FormDialog
      title={fact ? text.factEditTitle : text.factAddTitle}
      onClose={onClose}
      dirty={dirty}
      labels={formOverlayLabels(t, fact ? text.factSubmitEdit : text.factSubmitAdd)}
      onSubmit={() => {
        const vi = clean(textVi);
        const en = clean(textEn);
        if (
          vi === '' ||
          en === '' ||
          length(vi) > SHOP_INFO_LIMITS.factText ||
          length(en) > SHOP_INFO_LIMITS.factText
        ) {
          setChecked(true);
          focusInvalidSoon();
          return;
        }
        onSave({
          id: fact?.id ?? newFactId(),
          kind: 'CUSTOM',
          visible: fact?.visible ?? true,
          icon,
          textVi: vi,
          textEn: en,
        });
      }}
    >
      <Stack gap="block">
        <IconPicker
          label={text.factIcon}
          value={icon}
          options={SHOP_FACT_ICONS.map((value) => ({
            value,
            label: text.factIcons[value],
            icon: value,
          }))}
          onChange={(value) => setIcon(value as ShopFactIcon)}
        />
        <Field
          label={text.factTextVi}
          hint={text.factTextHint}
          required
          requiredLabel={t.common.required}
          error={problemVi}
        >
          {(control) => (
            <TextInput
              {...control}
              name="text-vi"
              value={textVi}
              onChange={(event) => setTextVi(event.target.value)}
            />
          )}
        </Field>
        <Field label={text.factTextEn} required requiredLabel={t.common.required} error={problemEn}>
          {(control) => (
            <TextInput
              {...control}
              name="text-en"
              value={textEn}
              onChange={(event) => setTextEn(event.target.value)}
            />
          )}
        </Field>
      </Stack>
    </FormDialog>
  );
}

function GroupDialog({
  group,
  info,
  taken,
  onClose,
  onSave,
}: {
  group: WebsiteFeaturedGroup | null;
  info: WebsiteShopInfoResponse;
  taken: readonly string[];
  onClose: () => void;
  onSave: (group: WebsiteFeaturedGroup) => void;
}) {
  const { t, locale } = useWorkforce();
  const text = t.shopInfo;
  const [code, setCode] = useState(group?.code ?? '');
  const [descriptionVi, setDescriptionVi] = useState(group?.descriptionVi ?? '');
  const [descriptionEn, setDescriptionEn] = useState(group?.descriptionEn ?? '');
  const [checked, setChecked] = useState(false);
  const tooLong = (value: string) =>
    checked && length(clean(value)) > SHOP_INFO_LIMITS.groupDescription
      ? fill(text.fieldTooLong, { max: SHOP_INFO_LIMITS.groupDescription })
      : undefined;
  const pickProblem = checked && code === '' ? text.groupPickRequired : undefined;
  const options = info.groupOptions
    .filter((option) => group !== null || !taken.includes(option.code))
    .map((option) => ({
      value: option.code,
      label: locale === 'vi' ? option.nameVi : option.nameEn,
    }));
  return (
    <FormDialog
      title={group ? text.groupEditTitle : text.groupAddTitle}
      onClose={onClose}
      dirty={
        code !== (group?.code ?? '') ||
        descriptionVi !== (group?.descriptionVi ?? '') ||
        descriptionEn !== (group?.descriptionEn ?? '')
      }
      labels={formOverlayLabels(t, group ? text.groupSubmitEdit : text.groupSubmitAdd)}
      onSubmit={() => {
        const vi = clean(descriptionVi);
        const en = clean(descriptionEn);
        if (
          code === '' ||
          length(vi) > SHOP_INFO_LIMITS.groupDescription ||
          length(en) > SHOP_INFO_LIMITS.groupDescription
        ) {
          setChecked(true);
          focusInvalidSoon();
          return;
        }
        onSave({
          code,
          descriptionVi: vi === '' ? null : vi,
          descriptionEn: en === '' ? null : en,
        });
      }}
    >
      <Stack gap="block">
        <Field
          label={text.groupPick}
          required
          requiredLabel={t.common.required}
          error={pickProblem}
        >
          {(control) => (
            <Select
              {...control}
              options={options}
              placeholder={text.groupPickPlaceholder}
              disabled={group !== null}
              value={code}
              onChange={(event) => setCode(event.target.value)}
            />
          )}
        </Field>
        <Field label={text.groupDescVi} hint={text.groupDescHint} error={tooLong(descriptionVi)}>
          {(control) => (
            <Textarea
              {...control}
              name="description-vi"
              autoComplete="off"
              rows={2}
              value={descriptionVi}
              onChange={(event) => setDescriptionVi(event.target.value)}
            />
          )}
        </Field>
        <Field label={text.groupDescEn} error={tooLong(descriptionEn)}>
          {(control) => (
            <Textarea
              {...control}
              name="description-en"
              autoComplete="off"
              rows={2}
              value={descriptionEn}
              onChange={(event) => setDescriptionEn(event.target.value)}
            />
          )}
        </Field>
      </Stack>
    </FormDialog>
  );
}

/** The optional "why choose us" section: on/off, its title in both languages and the ordered cards. */
export function WhyEditor({
  form,
  onChange,
  onEdit,
  problems,
}: {
  form: ShopInfoForm;
  onChange: Patch;
  onEdit: (editor: ShopListEditor) => void;
  problems: {
    whyTitleVi?: string | undefined;
    whyTitleEn?: string | undefined;
    whyCards?: string | undefined;
  };
}) {
  const { t, locale } = useWorkforce();
  const text = t.shopInfo;
  const headingOf = (card: WebsiteWhyCard) => (locale === 'vi' ? card.headingVi : card.headingEn);
  return (
    <FormSection title={text.whySection} description={text.whyHint}>
      <Stack gap="block">
        <Switch
          checked={form.whyVisible}
          onCheckedChange={(checked) => onChange({ whyVisible: checked })}
          label={text.whyShow}
        />
        <FormGrid cols={2}>
          <Field label={text.whyTitleVi} hint={text.whyTitleHint} error={problems.whyTitleVi}>
            {(control) => (
              <TextInput
                {...control}
                name="why-title-vi"
                value={form.whyTitleVi}
                onChange={(event) => onChange({ whyTitleVi: event.target.value })}
              />
            )}
          </Field>
          <Field label={text.whyTitleEn} error={problems.whyTitleEn}>
            {(control) => (
              <TextInput
                {...control}
                name="why-title-en"
                value={form.whyTitleEn}
                onChange={(event) => onChange({ whyTitleEn: event.target.value })}
              />
            )}
          </Field>
        </FormGrid>
        {form.whyCards.length === 0 ? (
          <p className="ls-hint">{text.whyEmpty}</p>
        ) : (
          <SortableList<WebsiteWhyCard>
            items={form.whyCards}
            getId={(card) => card.id}
            getLabel={headingOf}
            labels={text.sortable}
            variant="bare"
            ariaLabel={text.whyListLabel}
            onReorder={(ids) =>
              onChange({ whyCards: inOrder(form.whyCards, ids, (card) => card.id) })
            }
            renderItem={(card) => (
              <ListRow
                icon={<Icon name={card.icon} />}
                title={headingOf(card)}
                meta={locale === 'vi' ? card.descriptionVi : card.descriptionEn}
                actions={
                  <RowActions
                    menuLabel={text.whyActionsFor.replace('{name}', headingOf(card))}
                    items={[
                      {
                        id: 'edit',
                        label: opensInput(text.whyEdit),
                        icon: 'edit',
                        onSelect: () => onEdit({ kind: 'why', id: card.id }),
                      },
                      {
                        id: 'delete',
                        label: text.whyDelete,
                        icon: 'trash',
                        tone: 'danger',
                        onSelect: () =>
                          onEdit({
                            kind: 'remove',
                            list: 'why',
                            id: card.id,
                            name: headingOf(card),
                          }),
                      },
                    ]}
                  />
                }
              />
            )}
          />
        )}
        {problems.whyCards ? <Notice tone="error">{problems.whyCards}</Notice> : null}
        <div>
          <Button
            variant="secondary"
            disabled={form.whyCards.length >= 12}
            onClick={() => onEdit({ kind: 'why', id: null })}
          >
            {opensInput(text.whyAdd)}
          </Button>
        </div>
      </Stack>
    </FormSection>
  );
}

function WhyCardDialog({
  card,
  onClose,
  onSave,
}: {
  card: WebsiteWhyCard | null;
  onClose: () => void;
  onSave: (card: WebsiteWhyCard) => void;
}) {
  const { t } = useWorkforce();
  const text = t.shopInfo;
  const [icon, setIcon] = useState<WhyIcon>(card?.icon ?? 'sparkles');
  const [headingVi, setHeadingVi] = useState(card?.headingVi ?? '');
  const [headingEn, setHeadingEn] = useState(card?.headingEn ?? '');
  const [descriptionVi, setDescriptionVi] = useState(card?.descriptionVi ?? '');
  const [descriptionEn, setDescriptionEn] = useState(card?.descriptionEn ?? '');
  const [checked, setChecked] = useState(false);
  const problem = (value: string, max: number) =>
    checked ? lengthProblem(value, max, text.fieldLength) : undefined;
  return (
    <FormDialog
      title={card ? text.whyEditTitle : text.whyAddTitle}
      onClose={onClose}
      dirty={
        icon !== (card?.icon ?? 'sparkles') ||
        headingVi !== (card?.headingVi ?? '') ||
        headingEn !== (card?.headingEn ?? '') ||
        descriptionVi !== (card?.descriptionVi ?? '') ||
        descriptionEn !== (card?.descriptionEn ?? '')
      }
      labels={formOverlayLabels(t, card ? text.whySubmitEdit : text.whySubmitAdd)}
      onSubmit={() => {
        const next = {
          headingVi: clean(headingVi),
          headingEn: clean(headingEn),
          descriptionVi: clean(descriptionVi),
          descriptionEn: clean(descriptionEn),
        };
        if (
          Object.values(next).some((value) => value === '') ||
          length(next.headingVi) > SHOP_INFO_LIMITS.whyHeading ||
          length(next.headingEn) > SHOP_INFO_LIMITS.whyHeading ||
          length(next.descriptionVi) > SHOP_INFO_LIMITS.whyDescription ||
          length(next.descriptionEn) > SHOP_INFO_LIMITS.whyDescription
        ) {
          setChecked(true);
          focusInvalidSoon();
          return;
        }
        onSave({ id: card?.id ?? newFactId(), icon, ...next });
      }}
    >
      <Stack gap="block">
        <IconPicker
          label={text.whyIcon}
          value={icon}
          options={WHY_ICONS.map((value) => ({ value, label: text.whyIcons[value], icon: value }))}
          onChange={(value) => setIcon(value as WhyIcon)}
        />
        <Field
          label={text.whyHeadingVi}
          hint={text.whyHeadingHint}
          required
          requiredLabel={t.common.required}
          error={problem(headingVi, SHOP_INFO_LIMITS.whyHeading)}
        >
          {(control) => (
            <TextInput
              {...control}
              name="heading-vi"
              value={headingVi}
              onChange={(event) => setHeadingVi(event.target.value)}
            />
          )}
        </Field>
        <Field
          label={text.whyHeadingEn}
          required
          requiredLabel={t.common.required}
          error={problem(headingEn, SHOP_INFO_LIMITS.whyHeading)}
        >
          {(control) => (
            <TextInput
              {...control}
              name="heading-en"
              value={headingEn}
              onChange={(event) => setHeadingEn(event.target.value)}
            />
          )}
        </Field>
        <Field
          label={text.whyDescVi}
          hint={text.whyDescHint}
          required
          requiredLabel={t.common.required}
          error={problem(descriptionVi, SHOP_INFO_LIMITS.whyDescription)}
        >
          {(control) => (
            <Textarea
              {...control}
              name="description-vi"
              autoComplete="off"
              rows={3}
              value={descriptionVi}
              onChange={(event) => setDescriptionVi(event.target.value)}
            />
          )}
        </Field>
        <Field
          label={text.whyDescEn}
          required
          requiredLabel={t.common.required}
          error={problem(descriptionEn, SHOP_INFO_LIMITS.whyDescription)}
        >
          {(control) => (
            <Textarea
              {...control}
              name="description-en"
              autoComplete="off"
              rows={3}
              value={descriptionEn}
              onChange={(event) => setDescriptionEn(event.target.value)}
            />
          )}
        </Field>
      </Stack>
    </FormDialog>
  );
}

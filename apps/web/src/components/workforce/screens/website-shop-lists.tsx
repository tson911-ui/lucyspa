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
import { formOverlayLabels } from '../../../lib/workforce/form-labels';
import {
  inOrder,
  newFactId,
  SHOP_INFO_LIMITS,
  type ShopInfoForm,
} from '../../../lib/workforce/shop-info';
import { Badge, Button, Notice } from '../ui';
import { useWorkforce } from '../session';

/** What the form is editing in a dialog: a custom fact (null id = a new one) or a featured group (null code = a new one). */
export type ShopListEditor =
  | { kind: 'fact'; id: string | null }
  | { kind: 'group'; code: string | null }
  | { kind: 'why'; id: string | null }
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
                            label: text.factEdit,
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
                              onChange({ facts: form.facts.filter((item) => item.id !== fact.id) }),
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
            {text.factAdd}
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
                        label: text.groupEdit,
                        icon: 'edit',
                        onSelect: () => onEdit({ kind: 'group', code: group.code }),
                      },
                      {
                        id: 'remove',
                        label: text.groupRemove,
                        icon: 'trash',
                        tone: 'danger',
                        onSelect: () =>
                          onChange({
                            featuredGroups: form.featuredGroups.filter(
                              (item) => item.code !== group.code,
                            ),
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
            {text.groupAdd}
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
  const [failed, setFailed] = useState(false);
  const dirty =
    fact === null || icon !== fact.icon || textVi !== fact.textVi || textEn !== fact.textEn;
  return (
    <FormDialog
      title={fact ? text.factEditTitle : text.factAddTitle}
      onClose={onClose}
      dirty={dirty && (textVi !== (fact?.textVi ?? '') || textEn !== (fact?.textEn ?? ''))}
      error={failed ? text.problems.facts : undefined}
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
          setFailed(true);
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
        >
          {(control) => (
            <TextInput
              {...control}
              value={textVi}
              onChange={(event) => {
                setTextVi(event.target.value);
                setFailed(false);
              }}
            />
          )}
        </Field>
        <Field label={text.factTextEn} required requiredLabel={t.common.required}>
          {(control) => (
            <TextInput
              {...control}
              value={textEn}
              onChange={(event) => {
                setTextEn(event.target.value);
                setFailed(false);
              }}
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
  const [failed, setFailed] = useState<'pick' | 'long' | null>(null);
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
      error={
        failed === 'long'
          ? text.problems.featuredGroups
          : failed === 'pick'
            ? text.groupPickPlaceholder
            : undefined
      }
      labels={formOverlayLabels(t, group ? text.groupSubmitEdit : text.groupSubmitAdd)}
      onSubmit={() => {
        const vi = clean(descriptionVi);
        const en = clean(descriptionEn);
        if (code === '') {
          setFailed('pick');
          return;
        }
        if (
          length(vi) > SHOP_INFO_LIMITS.groupDescription ||
          length(en) > SHOP_INFO_LIMITS.groupDescription
        ) {
          setFailed('long');
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
        <Field label={text.groupPick} required requiredLabel={t.common.required}>
          {(control) => (
            <Select
              {...control}
              options={options}
              placeholder={text.groupPickPlaceholder}
              disabled={group !== null}
              value={code}
              onChange={(event) => {
                setCode(event.target.value);
                setFailed(null);
              }}
            />
          )}
        </Field>
        <Field label={text.groupDescVi} hint={text.groupDescHint}>
          {(control) => (
            <Textarea
              {...control}
              rows={2}
              value={descriptionVi}
              onChange={(event) => {
                setDescriptionVi(event.target.value);
                setFailed(null);
              }}
            />
          )}
        </Field>
        <Field label={text.groupDescEn}>
          {(control) => (
            <Textarea
              {...control}
              rows={2}
              value={descriptionEn}
              onChange={(event) => {
                setDescriptionEn(event.target.value);
                setFailed(null);
              }}
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
                value={form.whyTitleVi}
                onChange={(event) => onChange({ whyTitleVi: event.target.value })}
              />
            )}
          </Field>
          <Field label={text.whyTitleEn} error={problems.whyTitleEn}>
            {(control) => (
              <TextInput
                {...control}
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
                        label: text.whyEdit,
                        icon: 'edit',
                        onSelect: () => onEdit({ kind: 'why', id: card.id }),
                      },
                      {
                        id: 'delete',
                        label: text.whyDelete,
                        icon: 'trash',
                        tone: 'danger',
                        onSelect: () =>
                          onChange({
                            whyCards: form.whyCards.filter((item) => item.id !== card.id),
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
            {text.whyAdd}
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
  const [failed, setFailed] = useState(false);
  const touch = () => setFailed(false);
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
      error={failed ? text.problems.whyCards : undefined}
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
          setFailed(true);
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
        >
          {(control) => (
            <TextInput
              {...control}
              value={headingVi}
              onChange={(event) => {
                setHeadingVi(event.target.value);
                touch();
              }}
            />
          )}
        </Field>
        <Field label={text.whyHeadingEn} required requiredLabel={t.common.required}>
          {(control) => (
            <TextInput
              {...control}
              value={headingEn}
              onChange={(event) => {
                setHeadingEn(event.target.value);
                touch();
              }}
            />
          )}
        </Field>
        <Field
          label={text.whyDescVi}
          hint={text.whyDescHint}
          required
          requiredLabel={t.common.required}
        >
          {(control) => (
            <Textarea
              {...control}
              rows={3}
              value={descriptionVi}
              onChange={(event) => {
                setDescriptionVi(event.target.value);
                touch();
              }}
            />
          )}
        </Field>
        <Field label={text.whyDescEn} required requiredLabel={t.common.required}>
          {(control) => (
            <Textarea
              {...control}
              rows={3}
              value={descriptionEn}
              onChange={(event) => {
                setDescriptionEn(event.target.value);
                touch();
              }}
            />
          )}
        </Field>
      </Stack>
    </FormDialog>
  );
}

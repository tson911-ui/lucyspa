'use client';

import type { WebsiteSlideListResponse, WebsiteSlideResponse } from '@lucy-spa/contracts';
import { ConfirmDialog, MediaRow, Pagination, RowActions, SortableList } from '@lucy-spa/ui';
import { useState } from 'react';
import { fill } from '../../../i18n/workforce';
import { formatVnInstant } from '../../../lib/workforce/discounts';
import { confirmError } from '../../../lib/workforce/form-labels';
import { paginationLabels } from '../../../lib/workforce/list-view';
import { mediaVariantUrl } from '../../../lib/workforce/media';
import {
  applyPageOrder,
  inOrder,
  SLIDE_PAGE_SIZE,
  slideName,
  slideTone,
  visibleCount,
} from '../../../lib/workforce/slides';
import { errorMessage, runMutation } from '../../../lib/workforce/workflows';
import { useWorkforce } from '../session';
import { Badge, Empty, ErrorState, Notice, Spinner, useResource, useSuccessToast } from '../ui';
import { SlideDrawer } from './website-slide-drawer';

/** Which slide the drawer shows: `{ id: null }` adds one, `{ id }` edits it, `null` is closed. */
export type SlideEditing = { id: string | null } | null;

/**
 * The slider tab of the website content page (design 16.6, 16.7): every slide in slider order, rearranged by
 * dragging (or the up / down buttons), with its derived status and schedule, the row menu (edit, show or
 * hide, delete) and a drawer for adding and editing. The order is saved the moment it changes, in one call;
 * the list shows the new order at once and goes back if the save is refused.
 */
export function SlidesPanel({
  editing,
  onEditing,
}: {
  editing: SlideEditing;
  onEditing: (editing: SlideEditing) => void;
}) {
  const { api, t, locale } = useWorkforce();
  const notify = useSuccessToast();
  const slides = useResource(
    () => api.get<WebsiteSlideListResponse>('/api/v1/website/slides'),
    [api],
  );
  const [order, setOrder] = useState<string[] | null>(null);
  const [page, setPage] = useState(1);
  const [saving, setSaving] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const [removing, setRemoving] = useState<WebsiteSlideResponse | null>(null);

  const items = inOrder(slides.data?.items ?? [], order);
  const lastPage = Math.max(1, Math.ceil(items.length / SLIDE_PAGE_SIZE));
  const current = Math.min(page, lastPage);
  const pageItems = items.slice((current - 1) * SLIDE_PAGE_SIZE, current * SLIDE_PAGE_SIZE);
  const nameOf = (slide: WebsiteSlideResponse) => slideName(slide, locale, t.slides.untitled);

  /** "Always shown", "From …", "Until …" or both ends, in Vietnam time. */
  function windowText(slide: WebsiteSlideResponse): string {
    const from = slide.startsAt === null ? null : formatVnInstant(slide.startsAt, locale);
    const to = slide.endsAt === null ? null : formatVnInstant(slide.endsAt, locale);
    if (from !== null && to !== null) return fill(t.slides.windowBetween, { from, to });
    if (from !== null) return fill(t.slides.windowFrom, { from });
    if (to !== null) return fill(t.slides.windowUntil, { to });
    return t.slides.windowAlways;
  }

  async function reorder(pageIds: string[]) {
    const all = applyPageOrder(
      items.map((slide) => slide.id),
      current,
      SLIDE_PAGE_SIZE,
      pageIds,
    );
    setProblem(null);
    setSaving(true);
    // Optimistic: the list shows the new order now; a refusal puts the saved order back.
    setOrder(all);
    const outcome = await runMutation(
      () =>
        api.post<WebsiteSlideListResponse>('/api/v1/website/slides/reorder', { orderedIds: all }),
      () => slides.reload(),
    );
    if (outcome.ok) {
      await slides.reload();
      notify(t.slides.reordered);
    } else {
      setProblem(errorMessage(outcome.error, t));
    }
    setOrder(null);
    setSaving(false);
  }

  async function toggle(slide: WebsiteSlideResponse) {
    setProblem(null);
    const outcome = await runMutation(
      () =>
        api.post<WebsiteSlideResponse>(`/api/v1/website/slides/${slide.id}/enabled`, {
          expectedVersion: slide.rowVersion,
          isEnabled: !slide.isEnabled,
        }),
      () => slides.reload(),
    );
    if (outcome.ok) {
      await slides.reload();
      notify(slide.isEnabled ? t.slides.hidden : t.slides.shown);
    } else {
      setProblem(errorMessage(outcome.error, t));
    }
  }

  const editingSlide =
    editing?.id != null ? (items.find((slide) => slide.id === editing.id) ?? null) : null;

  return (
    <>
      {problem ? <Notice tone="error">{problem}</Notice> : null}
      {slides.error ? (
        <ErrorState error={slides.error} t={t} onRetry={() => void slides.reload()} />
      ) : slides.loading && !slides.data ? (
        <Spinner label={t.common.loading} />
      ) : items.length === 0 ? (
        <Empty>{t.slides.empty}</Empty>
      ) : (
        <>
          <p className="ls-hint">
            {t.slides.reorderHint}{' '}
            {fill(t.slides.visibleCount, {
              count: visibleCount(items),
              max: slides.data?.maxVisible ?? 8,
            })}
          </p>
          <SortableList<WebsiteSlideResponse>
            items={pageItems}
            getId={(slide) => slide.id}
            getLabel={nameOf}
            labels={t.slides.sortable}
            ariaLabel={t.slides.listLabel}
            disabled={saving}
            onReorder={(ids) => void reorder(ids)}
            renderItem={(slide, state) => (
              <MediaRow
                src={mediaVariantUrl(slide.media.id, 'thumb')}
                title={nameOf(slide)}
                meta={`${fill(t.slides.position, {
                  position: (current - 1) * SLIDE_PAGE_SIZE + state.index + 1,
                })} · ${windowText(slide)}`}
                badge={
                  <Badge tone={slideTone(slide.status)}>{t.slides.status[slide.status]}</Badge>
                }
                actionLabel={fill(t.slides.editLabel, { name: nameOf(slide) })}
                onSelect={() => onEditing({ id: slide.id })}
                actions={
                  <RowActions
                    menuLabel={fill(t.slides.actionsFor, { name: nameOf(slide) })}
                    items={[
                      {
                        id: 'edit',
                        label: t.slides.edit,
                        icon: 'edit',
                        onSelect: () => onEditing({ id: slide.id }),
                      },
                      {
                        id: 'toggle',
                        label: slide.isEnabled ? t.slides.hide : t.slides.show,
                        onSelect: () => void toggle(slide),
                      },
                      {
                        id: 'delete',
                        label: t.slides.remove.confirm,
                        icon: 'trash',
                        tone: 'danger',
                        onSelect: () => {
                          setProblem(null);
                          setRemoving(slide);
                        },
                      },
                    ]}
                  />
                }
              />
            )}
          />
          <Pagination
            page={current}
            pageSize={SLIDE_PAGE_SIZE}
            total={items.length}
            onPageChange={setPage}
            labels={paginationLabels(t, t.slides.listLabel)}
          />
        </>
      )}
      {editing && (editing.id === null || editingSlide) ? (
        <SlideDrawer
          // A new key per slide: the form starts from that slide, and again after a save.
          key={editing.id ?? 'new'}
          slide={editingSlide}
          reload={() => slides.reload()}
          onClose={() => onEditing(null)}
          onSaved={async (message) => {
            await slides.reload();
            onEditing(null);
            notify(message);
          }}
        />
      ) : null}
      {removing ? (
        <ConfirmDialog
          title={t.slides.remove.title}
          description={
            removing.status === 'VISIBLE'
              ? `${t.slides.remove.live} ${t.slides.remove.body}`
              : t.slides.remove.body
          }
          facts={[{ label: t.slides.remove.fact, value: nameOf(removing) }]}
          tone="danger"
          confirmLabel={t.slides.remove.confirm}
          busyLabel={t.common.saving}
          cancelLabel={t.common.cancel}
          referenceLabel={t.errors.reference}
          describeError={confirmError(t)}
          onCancel={() => setRemoving(null)}
          onConfirm={async () => {
            const target = removing;
            const outcome = await runMutation(
              () => api.post(`/api/v1/website/slides/${target.id}/delete`, {}),
              () => slides.reload(),
            );
            if (!outcome.ok) throw outcome.error;
            await slides.reload();
            setRemoving(null);
            notify(t.slides.remove.deleted);
          }}
        />
      ) : null}
    </>
  );
}

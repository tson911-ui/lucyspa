'use client';

import {
  DndContext,
  KeyboardSensor,
  MouseSensor,
  TouchSensor,
  closestCenter,
  useSensor,
  useSensors,
  type Announcements,
  type DragEndEvent,
} from '@dnd-kit/core';
import {
  SortableContext,
  rectSortingStrategy,
  sortableKeyboardCoordinates,
  useSortable,
  verticalListSortingStrategy,
} from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import { IconButton } from './button';
import { cx } from './cx';
import { fillTemplate } from './paging-core';
import type { SortableLabels, SortableProps } from './sortable';
import { SORT_EASING, SORT_TRANSITION_MS, moveBy, reorder } from './sortable-core';
import { useMediaQuery } from './use-media-query';

// The editable sortable collection: everything that needs @dnd-kit. `sortable.tsx` loads this module only when a list can be
// edited (rbp bundle-conditional), so a page that only shows the list (the staff dashboard outside edit mode) ships no drag code.

type Layout = 'list' | 'grid';

export function EditableCollection<T>({
  items,
  getId,
  getLabel,
  renderItem,
  onReorder,
  labels,
  ariaLabel,
  listClass,
  itemClassName,
  layout,
}: Omit<SortableProps<T>, 'disabled' | 'className' | 'variant'> & {
  layout: Layout;
  listClass: string;
}) {
  const ids = items.map(getId);
  const labelOf = new Map(items.map((item) => [getId(item), getLabel(item)]));
  const sensors = useSensors(
    useSensor(MouseSensor, { activationConstraint: { distance: 6 } }),
    // A short press on the handle lifts; a quick swipe still scrolls the page.
    useSensor(TouchSensor, { activationConstraint: { delay: 250, tolerance: 5 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );
  const reducedMotion = useMediaQuery('(prefers-reduced-motion: reduce)');
  const [message, setMessage] = useState('');
  // After a move by button the DOM node is re-inserted and loses focus; put it back on the same button.
  const refocus = useRef<{ id: string; direction: 'earlier' | 'later' } | null>(null);
  const root = useRef<HTMLUListElement | null>(null);
  const justLifted = useRef(false);

  useLayoutEffect(() => {
    const request = refocus.current;
    if (!request) return;
    refocus.current = null;
    root.current
      ?.querySelector<HTMLElement>(
        `[data-sortable-id="${escapeAttr(request.id)}"] [data-move="${request.direction}"]`,
      )
      ?.focus();
  });

  const position = (id: string | number, list = ids) => ({
    name: labelOf.get(String(id)) ?? String(id),
    position: list.indexOf(String(id)) + 1,
    count: list.length,
  });

  const announcements: Announcements = {
    onDragStart: ({ active }) => {
      justLifted.current = true;
      return fillTemplate(labels.lifted, position(active.id));
    },
    onDragOver: ({ active, over }) => {
      // dnd-kit reports the item's own slot right after the lift; that must not replace "lifted".
      const first = justLifted.current;
      justLifted.current = false;
      if (!over || (first && over.id === active.id)) return undefined;
      return fillTemplate(labels.moved, {
        name: labelOf.get(String(active.id)) ?? String(active.id),
        position: ids.indexOf(String(over.id)) + 1,
        count: ids.length,
      });
    },
    onDragEnd: ({ active, over }) =>
      fillTemplate(labels.dropped, {
        name: labelOf.get(String(active.id)) ?? String(active.id),
        position: (over ? ids.indexOf(String(over.id)) : ids.indexOf(String(active.id))) + 1,
        count: ids.length,
      }),
    onDragCancel: ({ active }) => fillTemplate(labels.cancelled, position(active.id)),
  };

  function onDragEnd({ active, over }: DragEndEvent) {
    if (!over || active.id === over.id) return;
    const from = ids.indexOf(String(active.id));
    const to = ids.indexOf(String(over.id));
    if (from < 0 || to < 0) return;
    onReorder(reorder(ids, from, to));
  }

  function moveByButton(id: string, delta: -1 | 1) {
    const next = moveBy(ids, id, delta);
    if (!next) return;
    refocus.current = { id, direction: delta < 0 ? 'earlier' : 'later' };
    setMessage(fillTemplate(labels.moved, position(id, next)));
    onReorder(next);
  }

  return (
    <>
      <DndContext
        sensors={sensors}
        collisionDetection={closestCenter}
        onDragEnd={onDragEnd}
        accessibility={{
          announcements,
          screenReaderInstructions: { draggable: labels.instructions },
        }}
      >
        <SortableContext
          items={ids}
          strategy={layout === 'grid' ? rectSortingStrategy : verticalListSortingStrategy}
        >
          <ul className={listClass} aria-label={ariaLabel} ref={root}>
            {items.map((item, index) => (
              <SortableItem
                key={getId(item)}
                id={getId(item)}
                name={getLabel(item)}
                index={index}
                count={items.length}
                layout={layout}
                labels={labels}
                reducedMotion={reducedMotion}
                itemClass={itemClassName?.(item)}
                onMove={moveByButton}
              >
                {(dragging) => renderItem(item, { index, count: items.length, dragging })}
              </SortableItem>
            ))}
          </ul>
        </SortableContext>
      </DndContext>
      <div className="ls-visually-hidden" role="status" aria-live="polite">
        {message}
      </div>
    </>
  );
}

function escapeAttr(value: string): string {
  return value.replace(/["\\]/g, '\\$&');
}

function SortableItem({
  id,
  name,
  index,
  count,
  layout,
  labels,
  reducedMotion,
  itemClass,
  onMove,
  children,
}: {
  id: string;
  name: string;
  index: number;
  count: number;
  layout: Layout;
  labels: SortableLabels;
  reducedMotion: boolean;
  itemClass: string | undefined;
  onMove: (id: string, delta: -1 | 1) => void;
  children: (dragging: boolean) => ReactNode;
}) {
  const {
    attributes,
    listeners,
    setNodeRef,
    setActivatorNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({
    id,
    attributes: { roleDescription: labels.roleDescription },
    transition: reducedMotion ? null : { duration: SORT_TRANSITION_MS, easing: SORT_EASING },
  });
  const values = { name };
  const earlier = layout === 'grid' ? 'chevron-left' : 'arrow-up';
  const later = layout === 'grid' ? 'chevron-right' : 'arrow-down';

  const handle = (
    <IconButton
      {...attributes}
      {...listeners}
      ref={setActivatorNodeRef}
      icon="drag"
      label={fillTemplate(labels.dragHandle, values)}
      className="ls-sortable-handle"
    />
  );
  const moves = (
    <div className="ls-sortable-moves">
      <IconButton
        icon={earlier}
        label={fillTemplate(labels.moveEarlier, values)}
        aria-disabled={index === 0 || undefined}
        data-move="earlier"
        onClick={() => onMove(id, -1)}
      />
      <IconButton
        icon={later}
        label={fillTemplate(labels.moveLater, values)}
        aria-disabled={index === count - 1 || undefined}
        data-move="later"
        onClick={() => onMove(id, 1)}
      />
    </div>
  );

  return (
    <li
      ref={setNodeRef}
      className={cx('ls-sortable-item', itemClass)}
      data-sortable-id={id}
      data-dragging={isDragging ? 'true' : undefined}
      style={{ transform: CSS.Translate.toString(transform), transition: transition ?? undefined }}
    >
      {layout === 'grid' ? (
        <div className="ls-sortable-bar">
          {handle}
          {moves}
        </div>
      ) : (
        handle
      )}
      <div className="ls-sortable-body">{children(isDragging)}</div>
      {layout === 'list' ? moves : null}
    </li>
  );
}

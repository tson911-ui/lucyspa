'use client';

import { useEffect, useState, type ReactNode } from 'react';
import { cx } from './cx';
import type { EditableCollection as EditableCollectionType } from './sortable-editable';

export interface SortableLabels {
  /** Accessible name of the drag handle, e.g. "Drag to reorder {name}". */
  dragHandle: string;
  /** Move button that shifts the item one place toward the start, e.g. "Move {name} earlier". */
  moveEarlier: string;
  /** e.g. "Move {name} later". */
  moveLater: string;
  /** What assistive technology says about the handle, e.g. "sortable item". */
  roleDescription: string;
  /** Read out when a handle gets focus: how to lift, move and drop with the keyboard. */
  instructions: string;
  /** "{name} lifted. Position {position} of {count}." */
  lifted: string;
  /** "{name} is now at position {position} of {count}." (drag and buttons) */
  moved: string;
  /** "{name} dropped at position {position} of {count}." */
  dropped: string;
  /** "Move cancelled. {name} is back at position {position} of {count}." */
  cancelled: string;
}

export interface SortableItemState {
  index: number;
  count: number;
  dragging: boolean;
}

export interface SortableProps<T> {
  items: readonly T[];
  getId: (item: T) => string;
  /** The item's name for handles, buttons and announcements. */
  getLabel: (item: T) => string;
  renderItem: (item: T, state: SortableItemState) => ReactNode;
  /** The ids in their new order. The list never persists or reorders itself: the caller owns `items`. */
  onReorder: (orderedIds: string[]) => void;
  labels: SortableLabels;
  /** Accessible name of the whole list. */
  ariaLabel: string;
  /** When true nothing can be dragged or moved and no handles are drawn (outside edit mode). */
  disabled?: boolean | undefined;
  className?: string | undefined;
  /**
   * `bare`: the item draws no frame of its own because its content is already a `Card` (the dashboard).
   * While editing, a dashed outline marks each item instead.
   */
  variant?: 'framed' | 'bare' | undefined;
  /** Layout class per item (for example a column span). */
  itemClassName?: ((item: T) => string | undefined) | undefined;
}

type Layout = 'list' | 'grid';

/** A vertical list whose items reorder by drag, touch (short press on the handle) or keyboard. */
export function SortableList<T>(props: SortableProps<T>) {
  return <SortableCollection {...props} layout="list" />;
}

/** The same for a grid; items reflow in reading order. Each item still has Move earlier / later buttons. */
export function SortableGrid<T>(props: SortableProps<T>) {
  return <SortableCollection {...props} layout="grid" />;
}

type Editable = typeof EditableCollectionType;

// The drag code (@dnd-kit) is loaded only when a list can be edited (rbp bundle-conditional): a list shown outside edit mode (the
// staff dashboard on every visit) never downloads it. Loaded once per page; until it arrives the list shows its plain form.
let editable: Editable | null = null;
let loading: Promise<Editable> | null = null;

/** Loads the editable collection (the drag and move code); resolves at once once loaded. Screens may call it ahead of edit mode. */
export function preloadSortable(): Promise<Editable> {
  loading ??= import('./sortable-editable').then((module) => {
    editable = module.EditableCollection;
    return editable;
  });
  return loading;
}

function useEditable(active: boolean): Editable | null {
  const [, setLoaded] = useState(editable !== null);
  useEffect(() => {
    if (!active || editable) return undefined;
    let live = true;
    void preloadSortable().then(() => {
      if (live) setLoaded(true);
    });
    return () => {
      live = false;
    };
  }, [active]);
  return active ? editable : null;
}

function SortableCollection<T>({
  items,
  getId,
  renderItem,
  disabled = false,
  className,
  variant = 'framed',
  itemClassName,
  layout,
  ...editProps
}: SortableProps<T> & { layout: Layout }) {
  const Collection = useEditable(!disabled);
  const listClass = cx(
    'ls-sortable',
    `ls-sortable-${layout}`,
    variant === 'bare' && 'ls-sortable-bare',
    className,
  );

  if (!Collection) {
    // Outside edit mode (and for the moment the drag code loads): the items in order, no handles, nothing to drag by accident.
    return (
      <ul className={listClass} aria-label={editProps.ariaLabel}>
        {items.map((item, index) => (
          <li key={getId(item)} className={cx('ls-sortable-item', itemClassName?.(item))}>
            <div className="ls-sortable-body">
              {renderItem(item, { index, count: items.length, dragging: false })}
            </div>
          </li>
        ))}
      </ul>
    );
  }

  return (
    <Collection
      {...editProps}
      items={items}
      getId={getId}
      renderItem={renderItem}
      itemClassName={itemClassName}
      layout={layout}
      listClass={listClass}
    />
  );
}

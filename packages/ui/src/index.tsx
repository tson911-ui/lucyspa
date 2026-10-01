// Single wordmark used by every shell and auth page. Same look in light and dark (color is inherited
// from the surrounding link, which uses the brand token). Replace the body with the logo image when
// the Owner supplies it; callers stay unchanged.
export function BrandWordmark({ size = 'md' }: { size?: 'md' | 'display' }) {
  return (
    <span
      style={{
        fontFamily: 'var(--ls-font-sans)',
        // `display` (twice `md`) is for the auth card, where the brand leads the page.
        fontSize: size === 'display' ? '2.5rem' : '1.25rem',
        fontWeight: 600,
        letterSpacing: '0.18em',
        textTransform: 'uppercase',
        whiteSpace: 'nowrap',
        // Centered use: a tight line box, and a leading space equal to the trailing letter-spacing so the
        // letters (not the letters plus a gap) sit on the center line.
        ...(size === 'display' ? { lineHeight: 1.2, paddingInlineStart: '0.18em' } : {}),
      }}
    >
      Lucy Spa
    </span>
  );
}

export { Icon, iconNames } from './icons';
export type { IconName, IconProps } from './icons';
export {
  THEME_COOKIE,
  THEME_COOKIE_MAX_AGE,
  parseThemeCookie,
  resolveTheme,
  serializeThemeCookie,
  themeInitScript,
} from './theme-core';
export type { ResolvedTheme, ThemePreference } from './theme-core';
export { ThemeInitScript } from './theme-script';
export { RouteFade } from './route-fade';
export { useTheme } from './use-theme';
export type { ThemeState } from './use-theme';

// Core components (Step 3). Text always comes from props; styles are in `components.css`.
export { Button, ButtonLink, IconButton, VisuallyHidden, buttonClass } from './button';
export type {
  ButtonLinkProps,
  ButtonProps,
  ButtonSize,
  ButtonVariant,
  IconButtonProps,
} from './button';
export { ActionBar, RowActions } from './actions';
export { Menu, arrangeMenu } from './menu';
export type { MenuDivider, MenuEntry, MenuItem } from './menu';
export { Popover, placePanel } from './popover';
export { nextEnabledIndex, orderActions, trapTarget, typeaheadIndex } from './menu-core';
export {
  Badge,
  EmptyState,
  ErrorState,
  Notice,
  ProgressBar,
  Skeleton,
  Spinner,
  Tooltip,
} from './feedback';
export type { BadgeTone, Tone } from './feedback';
export { ToastProvider, useToast } from './toast';
export type { ToastInput } from './toast';
export { MAX_TOASTS, TOAST_DURATION_MS, addToast, removeToast } from './toast-core';
export type { ToastData, ToastTone } from './toast-core';
export {
  Checkbox,
  Combobox,
  DateInput,
  Field,
  FormActions,
  FormSection,
  MoneyInput,
  NumberInput,
  PasswordInput,
  RadioGroup,
  SearchInput,
  Select,
  Switch,
  TextInput,
  Textarea,
  TimeInput,
  focusFirstInvalid,
  useUnsavedChangesGuard,
} from './form';
export type { ControlProps, RadioOption, SelectOption } from './form';
export { CheckField, Disclosure, FormGrid } from './form-frame';
export { FormDialog, FormDrawer } from './form-overlay';
export type { FormOverlayLabels } from './form-overlay';
export {
  createDebouncer,
  describedBy,
  digitsOnly,
  filterOptions,
  formatMoney,
  normalizeSearch,
  parseMoney,
} from './form-core';
export type { ComboOption } from './form-core';
export { Dialog, Drawer } from './overlay';
export type { DialogSize } from './overlay';
export { ConfirmDialog } from './confirm-dialog';
export type { ConfirmError, ConfirmFact } from './confirm-dialog';
export { createConfirmController, typingMatches } from './confirm-core';
export { FileDropzone, ImageUploader } from './image-uploader';
export type { ImageUploaderLabels } from './image-uploader';
export {
  DEFAULT_IMAGE_TYPES,
  formatBytes,
  precheckDimensions,
  precheckFile,
  uploaderReducer,
} from './image-core';
export type { UploadedImage } from './image-core';
export { cx } from './cx';

// Data components (Step 4): table, pagination, list toolbar, description list, tabs, URL state.
export { DataTable, MAX_UNPAGED_ROWS } from './data-table';
export type {
  DataTableColumn,
  DataTablePaging,
  DataTablePagingOff,
  DataTableSortLabels,
} from './data-table';
export { MultiValue } from './multi-value';
export { FacetedFilter } from './faceted-filter';
export type { FacetOption } from './faceted-filter';
export { CursorPagination, Pagination } from './pagination';
export type { CursorPaginationLabels, PaginationLabels } from './pagination';
export { FilterChips, ListToolbar } from './list-toolbar';
export type { FilterChip, ListToolbarLabels } from './list-toolbar';
export { DescriptionList } from './description-list';
export type { DescriptionItem } from './description-list';
export { Tabs } from './tabs';
export type { TabItem } from './tabs';
export { useUrlState } from './use-url-state';
export type { UrlStateChange, UrlStateOptions } from './use-url-state';
export { PHONE_QUERY, useMediaQuery } from './use-media-query';
export { applyUrlPatch, parseUrlState, serializeUrlState } from './url-state-core';
export type { UrlState, UrlValue } from './url-state-core';
export {
  DEFAULT_PAGE_SIZE,
  PAGE_SIZES,
  ariaSort,
  clampPage,
  compareValues,
  fillTemplate,
  nextSort,
  nextTabIndex,
  pageAfterSizeChange,
  pageItems,
  pageRange,
  pageSizeChoices,
  pagerState,
  sliceRows,
  sortRows,
  totalPages,
} from './paging-core';
export type { PageItem, SortDirection, SortState, SortValue } from './paging-core';

// App shell and auth layout (Step 5): shell, sidebar, user menu, breadcrumbs, theme toggle, split auth page.
export { AppShell, Breadcrumbs, SidebarNav, UserMenu } from './app-shell';
export type { AppShellLabels, Crumb, ShellLink, ShellLinkProps } from './app-shell';
export { AuthLayout, BotanicalPattern } from './auth-layout';
export { SegmentedControl, segmentedTarget } from './segmented';
export type { SegmentedOption } from './segmented';
export { ThemeToggle } from './theme-toggle';
export type { ThemeToggleLabels } from './theme-toggle';
export {
  SIDEBAR_COLLAPSED_KEY,
  TABLET_QUERY,
  arrangeNav,
  initials,
  isPathActive,
  readSidebarCollapsed,
  writeSidebarCollapsed,
} from './shell-core';
export type { ArrangedNavGroup, ShellNavGroup, ShellNavItem } from './shell-core';

// Card and Stat (Step 7): surface container and label + value + change.
export { Card, CardHeader } from './card';

// Page frame (Step 7.5b): page container, page header and the layout primitives that own every gap.
export { ListSection, Page, PageHeader } from './page';
export { Cluster, Grid, Stack } from './layout';
export type { ClusterGap, GridMin, StackGap } from './layout';
export { DeltaLine, Stat } from './stat';
export type { StatLabels } from './stat';

// Sortable primitives and chart kit (Step 6): drag-and-drop lists/grids, charts, KPI card, date range.
export { SortableGrid, SortableList } from './sortable';
export type { SortableItemState, SortableLabels, SortableProps } from './sortable';
export { SORT_EASING, SORT_TRANSITION_MS, moveBy, reorder } from './sortable-core';
export { BarChart, DonutChart, LineChart, Sparkline } from './charts';
export type {
  BarChartProps,
  ChartLabels,
  DonutChartProps,
  DonutLabels,
  LineChartProps,
} from './charts';
export {
  ChartFrame,
  ChartLegend,
  ChartTable,
  ChartTooltip,
  ComparisonToggle,
  useElementWidth,
} from './chart-parts';
export type {
  ChartFrameLabels,
  ChartTableModel,
  ComparisonToggleLabels,
  LegendItem,
  TooltipRow,
} from './chart-parts';
export { KpiCard } from './kpi-card';
export type { KpiCardLabels } from './kpi-card';
export { DateRangePicker } from './date-range-picker';
export type { DateRangePickerLabels } from './date-range-picker';
export {
  DEFAULT_MAX_RANGE_DAYS,
  PRESET_IDS,
  addDays,
  addMonths,
  addYears,
  comparisonRange,
  diffDays,
  formatDay,
  formatRange,
  isIsoDate,
  matchPreset,
  monthGrid,
  presetRange,
  rangeDays,
} from './date-range-core';
export type { CalendarDay, ComparisonMode, DateRange, PresetId } from './date-range-core';
export {
  MAX_POINTS,
  MAX_SERIES,
  deltaDirection,
  deltaPercent,
  deltaText,
  formatDelta,
  formatTick,
  formatValue,
  formatX,
  prepareChart,
  prepareSlices,
  slotColor,
} from './chart-core';
export type {
  ChartLocale,
  ChartPoint,
  Comparison,
  DeltaDirection,
  DeltaWords,
  DonutSlice,
  Format,
  Series,
  SlotIndex,
  ValueFormat,
} from './chart-core';

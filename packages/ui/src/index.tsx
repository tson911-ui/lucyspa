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
export { DataTable } from './data-table';
export type { DataTableColumn, DataTablePaging, DataTableSortLabels } from './data-table';
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

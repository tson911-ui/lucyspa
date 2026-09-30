# UX/UI Redesign Step 3: Core components (buttons, feedback, forms, overlays)

Status: CLOSED / OWNER APPROVED (jsdom dev dependency approved for later Steps). Not deployed. Contract: `UXUI_REDESIGN_DESIGN.md` 9.1-9.3, 9.5, 10, 11, 16.4.

## What changed

- `packages/ui` (framework-only, text via props, styles in new `components.css`, tokens only, imported once in the locale layout):
  - Actions: `Button` (primary/secondary/ghost/danger-outline/danger, `loading`, `disabledReason`), `IconButton`, `ButtonLink`, `buttonClass`, `ActionBar`, `RowActions`, `Menu`, `Popover`.
  - Feedback: `Badge`, `Notice`, `Spinner`, `Skeleton`, `EmptyState`, `ErrorState`, `Tooltip`, `ProgressBar`, `ToastProvider` + `useToast`.
  - Forms: `Field`, `TextInput`, `NumberInput`, `MoneyInput` (integer VND), `Textarea`, `Select`, `Combobox`, `Checkbox`, `RadioGroup`, `Switch`, `DateInput`, `TimeInput`, `SearchInput`, `FormSection`, `FormActions`, `focusFirstInvalid`, `useUnsavedChangesGuard`.
  - Overlays: `Dialog` (bottom sheet on phone), `Drawer`, `ConfirmDialog`; `FileDropzone` + `ImageUploader` shell (`upload(file)` injected).
  - Logic is in DOM-free modules (`menu-core`, `form-core`, `confirm-core`, `toast-core`, `image-core`) so it is unit tested.
- `apps/web/.../workforce/ui.tsx`: `Badge`, `Notice`, `Empty`, `ErrorState`, `Field`, `SubmitButton` keep their signatures and now render the shared components; new components are re-exported from here. `wf-*` CSS stays for the unmigrated screens.

## Behaviour notes

- `ConfirmDialog` keeps the existing delete rules: nothing sent until confirm; Cancel/Escape/backdrop close with no request; focus starts on Cancel; busy = spinner + not dismissible; refusal keeps dialog and shows message + request reference. `ConfirmDeleteDialog` is untouched until Steps 8-9.
- Solid `danger` is dialogs-only (test-enforced). Consequence: `SubmitButton tone="danger"` (6 inline forms) now renders `danger-outline`.
- Disabled-by-state buttons/menu items stay focusable (`aria-disabled`) with the reason as visible text linked by `aria-describedby`.

## Migrations / permissions / API

None. No change to `apps/api`, `packages/database`, `packages/contracts`, permissions or navigation.

## Other changes to know about

- `packages/ui/package.json`: devDependencies `react-dom` + `@types/react-dom` (same versions the web app already uses; `pnpm-lock.yaml` +6 lines) for render tests; `test` script now includes `*.test.tsx`.
- `apps/web/tsconfig.json`: `include` now lists `../../packages/ui/src/**` so `tsx` compiles the ui sources with the automatic JSX runtime when web tests render them (otherwise `React is not defined`).
- `employee-roles.test.tsx`: two badge assertions renamed `wf-badge-*` to `ls-badge-*` (the mapped `Badge`).

## Tests run

- `@lucy-spa/ui` test: 62 pass (44 new: keyboard/typeahead/focus-trap math, Vietnamese search, money, debounce, toasts, ConfirmDialog state machine, image prechecks, SSR ARIA per component with the longest VI label, CSS rules: no hex, no fixed width/nowrap, every class and token exists, danger only in dialogs).
- `apps/web` unit suite: 191 pass (all use the remapped wrappers). Typecheck ui + web, eslint (0 warnings) + boundaries, prettier check on touched paths: clean.

## Not verified / open questions

- No browser check (no jsdom in the repo): open/close, real focus movement, popover placement and touch behaviour are covered by pure logic tests and SSR markup only. Owner may want a quick look once Step 5 gives a page to host them.
- Should the Owner approve a `jsdom` dev dependency so later Steps can add interactive component tests? Not added without approval.
- Deferred by the contract: `DateRangePicker` (Step 6), `MediaPicker` and wiring `ImageUploader` (Step 11), in-app route-change guard for dirty forms (Step 5 shell / screen migration; only the browser `beforeunload` guard exists now).

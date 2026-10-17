'use client';

import {
  createContext,
  memo,
  useCallback,
  useContext,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
  type ChangeEvent,
  type InputHTMLAttributes,
  type KeyboardEvent as ReactKeyboardEvent,
  type ReactNode,
  type Ref,
  type SelectHTMLAttributes,
  type TextareaHTMLAttributes,
} from 'react';
import { IconButton } from './button';
import { cx } from './cx';
import {
  isoToDayMonthYear,
  isWithinRange,
  maskDayMonthYear,
  maskTime,
  readTypedDate,
  readTypedTime,
} from './date-text-core';
import {
  createDebouncer,
  describedBy,
  filterOptions,
  formatMoney,
  parseMoney,
  type ComboOption,
} from './form-core';
import { FormSectionLevel } from './heading-level';
import { Icon } from './icons';
import { Spinner } from './spinner';

// Form components (docs/UXUI_REDESIGN_DESIGN.md 9.3 and section 7): label above the control, hint
// below, error below with an icon and `aria-describedby`, required in words, first invalid field
// focused. Validation messages come from the screen; no schema library is imposed.

/** Props a control needs to be wired to its `Field`. */
export interface ControlProps {
  id: string;
  /** The field's `name` (autofill and form tools), when the screen gave one; a generated id is never a name. */
  name?: string | undefined;
  'aria-describedby'?: string | undefined;
  'aria-invalid'?: true | undefined;
  required?: boolean | undefined;
}

export function Field({
  id,
  name,
  label,
  required,
  requiredLabel,
  hint,
  error,
  labelAction,
  width,
  full,
  className,
  children,
}: {
  id?: string | undefined;
  /** A meaningful name for the control (WIG forms), passed with the control props, so it sits next to the label once. */
  name?: string | undefined;
  label: string;
  /** Caps the field at `--ls-field-sm/md/lg` (160/280/480 px). Omit to fill its grid cell. */
  width?: 'sm' | 'md' | 'lg' | undefined;
  /** In a two-column `FormGrid`: span both columns. */
  full?: boolean | undefined;
  /** A small link or button at the right end of the label row (for example "Forgot password?"). */
  labelAction?: ReactNode | undefined;
  required?: boolean | undefined;
  /** Required in words, e.g. "required" / "bắt buộc". Without it only a decorative `*` is drawn. */
  requiredLabel?: string | undefined;
  hint?: string | undefined;
  error?: string | undefined;
  className?: string | undefined;
  /** A control, or a function receiving the props that wire the control to this field. */
  children: ReactNode | ((control: ControlProps) => ReactNode);
}) {
  const generated = useId();
  const controlId = id ?? generated;
  const hintId = hint ? `${controlId}-hint` : undefined;
  const errorId = error ? `${controlId}-error` : undefined;
  const control: ControlProps = {
    id: controlId,
    ...(name ? { name } : {}),
    'aria-describedby': describedBy(hintId, errorId),
    ...(error ? { 'aria-invalid': true as const } : {}),
    ...(required ? { required: true } : {}),
  };
  const labelElement = (
    <label htmlFor={controlId} className="ls-label">
      {label}
      {required ? (
        requiredLabel ? (
          <span className="ls-required"> ({requiredLabel})</span>
        ) : (
          <span className="ls-required" aria-hidden="true">
            {' '}
            *
          </span>
        )
      ) : null}
    </label>
  );
  return (
    <div
      className={cx('ls-field', width && `ls-field-${width}`, full && 'ls-field-full', className)}
    >
      {labelAction ? (
        <div className="ls-label-row">
          {labelElement}
          <span className="ls-label-action">{labelAction}</span>
        </div>
      ) : (
        labelElement
      )}
      {typeof children === 'function' ? children(control) : children}
      {hint ? (
        <p className="ls-hint" id={hintId}>
          {hint}
        </p>
      ) : null}
      {/* A persistent polite live region (display: contents, so it adds no grid gap): an error that appears on blur or
          after a server reply is announced when it appears, not only on the next visit to the field (WIG). */}
      <div className="ls-field-live" aria-live="polite">
        {error ? (
          <p className="ls-error" id={errorId}>
            <Icon name="x-circle" size={16} />
            <span>{error}</span>
          </p>
        ) : null}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------------------------
// Text-like inputs

type InputBase = Omit<InputHTMLAttributes<HTMLInputElement>, 'size' | 'className'> & {
  invalid?: boolean | undefined;
  /** The compact density (DESIGN.md 8.2): 40 px high and a 14 px value on a fine pointer. Inside `data-density='compact'` it is automatic. */
  compact?: boolean | undefined;
  className?: string | undefined;
  ref?: Ref<HTMLInputElement> | undefined;
};

/**
 * The id as a field name when the caller chose it; an id React generated (useId: `_r_3_`, the server's `_R_57d_`, `:r3:`, `«r3»`) is
 * not a meaningful name.
 */
function callerName(id: string | undefined): string | undefined {
  return id && !/^(?:_r_|:r|«r)/i.test(id) ? id : undefined;
}

/** Types that are personal or sign-in data: the browser may fill them; everything else is a work field with autofill off (WIG). */
const AUTOFILL_TYPES = new Set(['email', 'tel', 'password', 'url']);
/** Types whose value is an address, a code or a secret: never spell-checked. */
const NO_SPELLCHECK_TYPES = new Set(['email', 'url', 'password', 'tel']);

export function TextInput({ invalid, compact, className, type = 'text', ...rest }: InputBase) {
  return (
    <input
      {...rest}
      // A meaningful name for autofill and form tools when the caller gave none (the id is unique and descriptive).
      name={rest.name ?? callerName(rest.id)}
      autoComplete={rest.autoComplete ?? (AUTOFILL_TYPES.has(type) ? undefined : 'off')}
      spellCheck={rest.spellCheck ?? (NO_SPELLCHECK_TYPES.has(type) ? false : undefined)}
      type={type}
      className={cx('ls-input', compact && 'ls-input-compact', className)}
      aria-invalid={invalid || rest['aria-invalid'] || undefined}
    />
  );
}

/**
 * Password field with a show/hide button inside the field. The button is a real button with a text
 * name that says what it will do ("Show password" / "Hide password"); the value stays in the input.
 */
export function PasswordInput({
  showLabel,
  hideLabel,
  invalid,
  className,
  ...rest
}: Omit<InputBase, 'type'> & {
  /** Name of the button while the password is hidden, for example "Hiện mật khẩu". */
  showLabel: string;
  /** Name of the button while the password is shown, for example "Ẩn mật khẩu". */
  hideLabel: string;
}) {
  const [visible, setVisible] = useState(false);
  const label = visible ? hideLabel : showLabel;
  return (
    <span className="ls-password">
      <TextInput
        {...rest}
        type={visible ? 'text' : 'password'}
        invalid={invalid}
        className={cx('ls-password-input', className)}
      />
      <button
        type="button"
        className="ls-password-toggle"
        aria-label={label}
        title={label}
        disabled={rest.disabled}
        onClick={() => setVisible((value) => !value)}
      >
        <Icon name={visible ? 'eye-off' : 'eye'} />
      </button>
    </span>
  );
}

/** Numeric input for quantities and percentages. Money uses `MoneyInput`. */
export function NumberInput({ invalid, compact, className, ...rest }: Omit<InputBase, 'type'>) {
  return (
    <input
      {...rest}
      name={rest.name ?? callerName(rest.id)}
      autoComplete={rest.autoComplete ?? 'off'}
      type="number"
      // Whole numbers (quantities, VND) get the digits keypad; a decimal step gets the decimal one.
      inputMode={
        rest.inputMode ??
        (rest.step !== undefined && !Number.isInteger(Number(rest.step)) ? 'decimal' : 'numeric')
      }
      className={cx('ls-input', 'ls-input-number', compact && 'ls-input-compact', className)}
      aria-invalid={invalid || rest['aria-invalid'] || undefined}
    />
  );
}

/** `YYYY-MM-DD`. Business dates are interpreted in the branch timezone by the caller. */
export function DateInput(props: Omit<InputBase, 'type'>) {
  return <TextInput {...props} type="date" />;
}

/**
 * A date typed as `dd/mm/yyyy` (staff screens; the native date field follows the browser language and shows mm/dd/yyyy in
 * English). The value and what `onChange` reports in `event.target.value` stay an ISO date (`YYYY-MM-DD`, or '' when empty),
 * so a caller reads it exactly as it read the native field. A date is reported only once it is whole, real and inside
 * `min`/`max`; while it is half typed nothing is reported and the field keeps the text, and on leaving it shows the
 * caller's current date again, so the text on screen is always the date the screen uses.
 */
export function DateTextInput({
  value,
  min,
  max,
  onChange,
  onBlur,
  onFocus,
  invalid,
  className,
  placeholder = 'dd/mm/yyyy…',
  ...rest
}: Omit<InputBase, 'type' | 'value' | 'min' | 'max'> & {
  /** ISO date or ''. */
  value: string;
  min?: string | undefined;
  max?: string | undefined;
}) {
  const [text, setText] = useState(() => isoToDayMonthYear(value));
  const [focused, setFocused] = useState(false);
  // A date set by the screen (a "previous day" button, a reset) shows at once, unless the person is typing. Adjusted
  // while rendering against the last value seen, not in an effect (rbp rerender-derived-state-no-effect).
  const [seen, setSeen] = useState(value);
  if (value !== seen) {
    setSeen(value);
    if (!focused) setText(isoToDayMonthYear(value));
  }
  const typed = readTypedDate(text);
  const outOfRange = typed !== null && typed !== '' && !isWithinRange(typed, min, max);
  return (
    <TextInput
      {...rest}
      type="text"
      inputMode="numeric"
      autoComplete="off"
      maxLength={10}
      placeholder={placeholder}
      value={text}
      invalid={invalid || outOfRange}
      className={className}
      onFocus={(event) => {
        setFocused(true);
        onFocus?.(event);
      }}
      onBlur={(event) => {
        setFocused(false);
        setText(isoToDayMonthYear(value));
        onBlur?.(event);
      }}
      onChange={(event) => {
        const raw = event.target.value;
        const iso = readTypedDate(raw);
        setText(iso ? isoToDayMonthYear(iso) : maskDayMonthYear(raw));
        if (iso === null || (iso !== '' && !isWithinRange(iso, min, max))) return;
        // The caller reads event.target.value: hand it the same event with the ISO date as the value.
        const target = { value: iso, id: event.target.id, name: event.target.name };
        onChange?.(
          Object.create(event, {
            target: { value: target },
            currentTarget: { value: target },
          }) as ChangeEvent<HTMLInputElement>,
        );
      }}
    />
  );
}

/** `HH:mm`. */
export function TimeInput(props: Omit<InputBase, 'type'>) {
  return <TextInput {...props} type="time" />;
}

/**
 * A date and a 24 h time in two boxes (dd/mm/yyyy and HH:mm), never the browser's `datetime-local` (which shows the US order and AM/PM
 * on a Vietnamese page). Value: `YYYY-MM-DDTHH:mm` or '' (the same as `datetime-local`). Only a whole date with a whole, valid
 * time is a value: while either part is empty, half typed or invalid the field reports '' (never the previous value), so a
 * required check fails and a save never carries a stale date. The typed time stays on screen; once the time box is left
 * incomplete it turns invalid and, with `timeError`, says what to fix right under the boxes.
 */
export function DateTimeInput({
  id,
  value,
  onValueChange,
  timeLabel,
  timeError,
  invalid,
  compact,
  disabled,
  min,
  max,
  'aria-describedby': describedByIds,
}: {
  /** Goes on the date box, so the field's label names it. */
  id?: string | undefined;
  value: string;
  onValueChange: (value: string) => void;
  /** Accessible name of the time box, e.g. "Giờ". */
  timeLabel: string;
  /** Shown and announced when the time box is left empty (with a date) or incomplete, e.g. "Nhập giờ dạng 14:30". */
  timeError?: string | undefined;
  invalid?: boolean | undefined;
  compact?: boolean | undefined;
  disabled?: boolean | undefined;
  /** ISO dates bounding the date part. */
  min?: string | undefined;
  max?: string | undefined;
  /** The Field's hint/error ids (from its control props); both boxes are described by them. */
  'aria-describedby'?: string | undefined;
}) {
  const [datePart = '', timePart = ''] = value ? value.split('T') : [];
  const [date, setDate] = useState(datePart);
  const [time, setTime] = useState(timePart.slice(0, 5));
  const [timeLeft, setTimeLeft] = useState(false);
  const errorId = `${useId()}-time-error`;
  // The value this field last reported or was given. A different value comes from the screen (a reset, a season's
  // dates): show it, adjusted while rendering, not in an effect (rbp rerender-derived-state-no-effect).
  const [seen, setSeen] = useState(value);
  if (value !== seen) {
    setSeen(value);
    setDate(datePart);
    setTime(timePart.slice(0, 5));
    setTimeLeft(false);
  }
  const report = (nextDate: string, nextTime: string) => {
    const validTime = readTypedTime(nextTime);
    const next = nextDate && validTime ? `${nextDate}T${validTime}` : '';
    setSeen(next);
    if (next !== value) onValueChange(next);
  };
  const timeBad = time === '' ? date !== '' : readTypedTime(time) === null;
  const timeInvalid = timeLeft ? timeBad : time.length === 5 && readTypedTime(time) === null;
  const showError = timeInvalid && timeError !== undefined && !disabled;
  return (
    <>
      <div className="ls-datetime">
        <DateTextInput
          id={id}
          value={date}
          min={min}
          max={max}
          invalid={invalid}
          compact={compact}
          disabled={disabled}
          aria-describedby={describedByIds}
          onChange={(event) => {
            setDate(event.target.value);
            report(event.target.value, time);
          }}
        />
        <TextInput
          type="text"
          inputMode="numeric"
          maxLength={5}
          placeholder="HH:mm…"
          aria-label={timeLabel}
          aria-describedby={describedBy(describedByIds, showError && errorId)}
          value={time}
          invalid={invalid || timeInvalid}
          compact={compact}
          disabled={disabled}
          onFocus={() => setTimeLeft(false)}
          onBlur={() => setTimeLeft(true)}
          onChange={(event) => {
            const masked = maskTime(event.target.value);
            setTime(masked);
            report(date, masked);
          }}
        />
      </div>
      <div className="ls-field-live" aria-live="polite">
        {showError ? (
          <p className="ls-error" id={errorId}>
            <Icon name="x-circle" size={16} />
            <span>{timeError}</span>
          </p>
        ) : null}
      </div>
    </>
  );
}

/**
 * Integer VND only: shows `1.234.567`, reports a whole number (or `null` when empty), and ignores
 * anything that is not a digit. `unit` is a visible suffix such as "₫".
 */
const separators = new Map<string, string>();
/** The locale's thousands separator, cached per locale (rbp js-cache-function-results). */
function groupSeparator(locale: string | undefined): string {
  if (!locale) return '.';
  let found = separators.get(locale);
  if (found === undefined) {
    found =
      new Intl.NumberFormat(locale).formatToParts(12345).find((part) => part.type === 'group')
        ?.value ?? '.';
    separators.set(locale, found);
  }
  return found;
}

export function MoneyInput({
  value,
  onValueChange,
  unit,
  separator,
  locale,
  invalid,
  compact,
  className,
  ...rest
}: Omit<InputBase, 'type' | 'value' | 'defaultValue' | 'onChange'> & {
  value: number | null;
  onValueChange: (value: number | null) => void;
  unit?: string | undefined;
  /** The thousands separator; by default the locale's (Intl), or '.' without a locale. */
  separator?: string | undefined;
  /** The page language ('vi', 'en'): the separator follows it, like every other number on the page. */
  locale?: string | undefined;
}) {
  const group = separator ?? groupSeparator(locale);
  return (
    <span className={cx('ls-money', className)}>
      <input
        {...rest}
        type="text"
        inputMode="numeric"
        autoComplete="off"
        className={cx('ls-input ls-input-number', compact && 'ls-input-compact')}
        value={formatMoney(value, group)}
        aria-invalid={invalid || rest['aria-invalid'] || undefined}
        onChange={(event: ChangeEvent<HTMLInputElement>) => {
          const parsed = parseMoney(event.target.value);
          if (parsed !== undefined) onValueChange(parsed);
        }}
      />
      {unit ? (
        <span className="ls-money-unit" aria-hidden="true">
          {unit}
        </span>
      ) : null}
    </span>
  );
}

export function Textarea({
  invalid,
  compact,
  className,
  ...rest
}: Omit<TextareaHTMLAttributes<HTMLTextAreaElement>, 'className'> & {
  invalid?: boolean | undefined;
  compact?: boolean | undefined;
  className?: string | undefined;
  ref?: Ref<HTMLTextAreaElement> | undefined;
}) {
  return (
    <textarea
      {...rest}
      name={rest.name ?? callerName(rest.id)}
      className={cx('ls-input', 'ls-textarea', compact && 'ls-input-compact', className)}
      aria-invalid={invalid || rest['aria-invalid'] || undefined}
    />
  );
}

export interface SelectOption {
  value: string;
  label: string;
  disabled?: boolean | undefined;
}

/**
 * A native select draws the chevron icon of the icon set instead of the platform arrow on every area (DESIGN.md 8.2; Owner B9, 2026-10-16:
 * the select is styled to the design system in both modes and stays a real select): it sits in a wrapper with a positioned icon.
 */
const SelectIconContext = createContext(true);

export function SelectIconScope({ children }: { children: ReactNode }) {
  return <SelectIconContext value={true}>{children}</SelectIconContext>;
}

/** Native select (best on touch). Use `Combobox` when the list is long or searchable. */
export function Select({
  options,
  placeholder,
  invalid,
  compact,
  className,
  ...rest
}: Omit<SelectHTMLAttributes<HTMLSelectElement>, 'className' | 'children'> & {
  options: readonly SelectOption[];
  /** Text of the empty first option. */
  placeholder?: string | undefined;
  invalid?: boolean | undefined;
  compact?: boolean | undefined;
  className?: string | undefined;
  ref?: Ref<HTMLSelectElement> | undefined;
}) {
  const withIcon = useContext(SelectIconContext) && !rest.multiple && (rest.size ?? 1) <= 1;
  const select = (
    <select
      {...rest}
      className={cx('ls-input', 'ls-select', compact && 'ls-input-compact', !withIcon && className)}
      aria-invalid={invalid || rest['aria-invalid'] || undefined}
    >
      {placeholder !== undefined ? <option value="">{placeholder}</option> : null}
      {options.map((option) => (
        <option key={option.value} value={option.value} disabled={option.disabled}>
          {option.label}
        </option>
      ))}
    </select>
  );
  if (!withIcon) return select;
  // The caller's class (a flex size, a width) moves to the wrapper, which is the box the layout sees.
  return (
    <span className={cx('ls-select-wrap', className)}>
      {select}
      <span className="ls-select-icon" aria-hidden="true">
        <Icon name="chevron-down" size={20} />
      </span>
    </span>
  );
}

// ---------------------------------------------------------------------------------------------
// Combobox (WAI-ARIA 1.2 editable combobox with a listbox popup)

const ComboOptionRow = memo(function ComboOptionRow({
  id,
  option,
  index,
  active,
  selected,
  onHover,
  onChoose,
}: {
  id: string;
  option: ComboOption;
  index: number;
  active: boolean;
  selected: boolean;
  onHover: (index: number) => void;
  onChoose: (option: ComboOption) => void;
}) {
  return (
    <li
      id={id}
      role="option"
      aria-selected={selected}
      aria-disabled={option.disabled || undefined}
      className={cx('ls-option', active && 'ls-option-active', selected && 'ls-option-selected')}
      onMouseEnter={() => onHover(index)}
      onClick={() => onChoose(option)}
    >
      {option.label}
      {selected ? <Icon name="check" size={16} /> : null}
    </li>
  );
});

export function Combobox({
  id,
  options,
  value,
  onValueChange,
  onQueryChange,
  loading,
  loadingLabel,
  emptyLabel,
  placeholder,
  resultsLabel,
  disabled,
  required,
  invalid,
  name,
  className,
  ...aria
}: {
  id?: string | undefined;
  options: readonly ComboOption[];
  value: string | null;
  onValueChange: (value: string | null) => void;
  /**
   * Async mode: called (not debounced) as the user types and `options` is used as given. Without
   * it the options are filtered here, ignoring case and Vietnamese diacritics.
   */
  onQueryChange?: ((query: string) => void) | undefined;
  loading?: boolean | undefined;
  loadingLabel?: string | undefined;
  /** Shown when nothing matches. */
  emptyLabel: string;
  placeholder?: string | undefined;
  /** Live announcement of the number of results, e.g. `(n) => \`${n} results\``. */
  resultsLabel?: ((count: number) => string) | undefined;
  disabled?: boolean | undefined;
  required?: boolean | undefined;
  invalid?: boolean | undefined;
  name?: string | undefined;
  className?: string | undefined;
  'aria-describedby'?: string | undefined;
  'aria-label'?: string | undefined;
}) {
  const generated = useId();
  const inputId = id ?? generated;
  const listId = `${inputId}-list`;
  const selected = options.find((option) => option.value === value) ?? null;
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState<string | null>(null);
  const [active, setActive] = useState(-1);
  const text = query ?? selected?.label ?? '';
  const visible = useMemo(
    () => (onQueryChange || query === null ? [...options] : filterOptions(options, query)),
    [options, query, onQueryChange],
  );

  function close() {
    setOpen(false);
    setQuery(null);
    setActive(-1);
  }
  function choose(option: ComboOption | undefined) {
    if (!option || option.disabled) return;
    onValueChange(option.value);
    close();
  }
  // One stable handler for the memoised rows, so hovering an option re-renders two rows, not the list (rbp rerender-memo).
  const chooseRef = useRef(choose);
  useEffect(() => {
    chooseRef.current = choose;
  });
  const chooseStable = useCallback((option: ComboOption) => chooseRef.current(option), []);
  function move(step: 1 | -1) {
    if (visible.length === 0) return;
    let index = active;
    for (let tries = 0; tries < visible.length; tries += 1) {
      index = (index + step + visible.length) % visible.length;
      if (!visible[index]?.disabled) break;
    }
    setActive(index);
  }
  function onKeyDown(event: ReactKeyboardEvent<HTMLInputElement>) {
    switch (event.key) {
      case 'ArrowDown':
        event.preventDefault();
        if (!open) setOpen(true);
        else move(1);
        break;
      case 'ArrowUp':
        event.preventDefault();
        if (!open) setOpen(true);
        else move(-1);
        break;
      case 'Home':
      case 'End':
        // Text editing keys stay with the input while the popup is closed.
        if (open && active >= 0) {
          event.preventDefault();
          setActive(event.key === 'Home' ? 0 : visible.length - 1);
        }
        break;
      case 'Enter':
        if (open && active >= 0) {
          event.preventDefault();
          choose(visible[active]);
        }
        break;
      case 'Escape':
        if (open) {
          event.preventDefault();
          event.stopPropagation();
          close();
        }
        break;
      case 'Tab':
        close();
        break;
      default:
    }
  }

  const activeId = open && active >= 0 ? `${inputId}-option-${active}` : undefined;
  return (
    <div className={cx('ls-combobox', className)}>
      <input
        id={inputId}
        name={name}
        type="text"
        role="combobox"
        autoComplete="off"
        className="ls-input"
        aria-expanded={open}
        aria-controls={listId}
        aria-autocomplete="list"
        aria-activedescendant={activeId}
        aria-invalid={invalid || undefined}
        aria-describedby={aria['aria-describedby']}
        aria-label={aria['aria-label']}
        aria-busy={loading || undefined}
        placeholder={placeholder}
        disabled={disabled}
        required={required}
        value={text}
        onChange={(event) => {
          setQuery(event.target.value);
          setOpen(true);
          setActive(-1);
          onQueryChange?.(event.target.value);
        }}
        onFocus={() => undefined}
        onBlur={close}
        onKeyDown={onKeyDown}
      />
      <span className="ls-combobox-chevron" aria-hidden="true">
        {loading ? <Spinner /> : <Icon name="chevron-down" size={16} />}
      </span>
      {open ? (
        <ul
          id={listId}
          role="listbox"
          aria-label={aria['aria-label']}
          className="ls-listbox"
          onMouseDown={(event) => event.preventDefault()}
        >
          {loading && loadingLabel ? <li className="ls-listbox-note">{loadingLabel}</li> : null}
          {!loading && visible.length === 0 ? (
            <li className="ls-listbox-note">{emptyLabel}</li>
          ) : null}
          {visible.map((option, index) => (
            <ComboOptionRow
              key={option.value}
              id={`${inputId}-option-${index}`}
              option={option}
              index={index}
              active={index === active}
              selected={option.value === value}
              onHover={setActive}
              onChoose={chooseStable}
            />
          ))}
        </ul>
      ) : null}
      {resultsLabel ? (
        <span className="ls-visually-hidden" role="status">
          {open && !loading ? resultsLabel(visible.length) : ''}
        </span>
      ) : null}
    </div>
  );
}

// ---------------------------------------------------------------------------------------------
// Choice controls

export function Checkbox({
  label,
  hint,
  invalid,
  className,
  ...rest
}: Omit<InputHTMLAttributes<HTMLInputElement>, 'type' | 'className'> & {
  label: string;
  hint?: string | undefined;
  invalid?: boolean | undefined;
  className?: string | undefined;
  ref?: Ref<HTMLInputElement> | undefined;
}) {
  const hintId = useId();
  return (
    <label className={cx('ls-check', className)}>
      <input
        {...rest}
        type="checkbox"
        aria-invalid={invalid || undefined}
        aria-describedby={describedBy(rest['aria-describedby'], hint && hintId)}
      />
      <span className="ls-check-text">
        {label}
        {hint ? (
          <span className="ls-hint" id={hintId}>
            {hint}
          </span>
        ) : null}
      </span>
    </label>
  );
}

export interface RadioOption {
  value: string;
  label: string;
  hint?: string | undefined;
  disabled?: boolean | undefined;
}

/** Native radios in a fieldset: arrow keys, grouping and form submission come from the browser. */
export function RadioGroup({
  legend,
  name,
  value,
  onValueChange,
  options,
  required,
  invalid,
  describedById,
  layout = 'stack',
}: {
  legend: string;
  name: string;
  value: string | null;
  onValueChange: (value: string) => void;
  options: readonly RadioOption[];
  required?: boolean | undefined;
  invalid?: boolean | undefined;
  describedById?: string | undefined;
  layout?: 'stack' | 'inline' | undefined;
}) {
  return (
    <fieldset
      role="radiogroup"
      className={cx('ls-radios', layout === 'inline' && 'ls-radios-inline')}
      aria-required={required || undefined}
      aria-invalid={invalid || undefined}
      aria-describedby={describedById}
    >
      <legend className="ls-label">{legend}</legend>
      {options.map((option) => (
        <label key={option.value} className="ls-check ls-check-field">
          <input
            type="radio"
            name={name}
            value={option.value}
            checked={value === option.value}
            disabled={option.disabled}
            onChange={() => onValueChange(option.value)}
          />
          <span className="ls-check-text">
            {option.label}
            {option.hint ? <span className="ls-hint">{option.hint}</span> : null}
          </span>
        </label>
      ))}
    </fieldset>
  );
}

/** On/off setting that takes effect immediately. The visible label is the accessible name. */
export function Switch({
  checked,
  onCheckedChange,
  label,
  disabled,
  className,
  ...aria
}: {
  checked: boolean;
  onCheckedChange: (checked: boolean) => void;
  label: string;
  disabled?: boolean | undefined;
  className?: string | undefined;
  'aria-describedby'?: string | undefined;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-describedby={aria['aria-describedby']}
      disabled={disabled}
      className={cx('ls-switch', className)}
      onClick={() => onCheckedChange(!checked)}
    >
      <span className="ls-switch-track" aria-hidden="true">
        <span className="ls-switch-thumb" />
      </span>
      <span className="ls-switch-label">{label}</span>
    </button>
  );
}

// ---------------------------------------------------------------------------------------------
// Search

/**
 * Debounced search box with a clear button. `onSearch` receives the trimmed text. The visible placeholder names what the box
 * searches (HIG C53: the label, "Tìm theo tên hoặc mã"), so the scope is seen, not only heard; an example of what to type
 * ("Ví dụ: NV0012 hoặc Lan…") is the `hint`: the box's description for assistive technology and its hover title.
 */
export function SearchInput({
  value,
  defaultValue = '',
  onSearch,
  debounceMs = 300,
  label,
  clearLabel,
  placeholder,
  hint,
  className,
  id,
  keyShortcut,
}: {
  /** Controlled text (for example from the URL). Omit for an uncontrolled box. */
  value?: string | undefined;
  defaultValue?: string | undefined;
  onSearch: (query: string) => void;
  debounceMs?: number | undefined;
  /** Accessible name and, by default, the placeholder: what the box searches ("Tìm theo tên hoặc mã"). No visible label above a toolbar search. */
  label: string;
  clearLabel: string;
  /** Overrides the placeholder; it must still name the scope. An example belongs in `hint`. */
  placeholder?: string | undefined;
  /** An example of what to type ("Ví dụ: Lan…"): the accessible description and the hover title, never the placeholder. */
  hint?: string | undefined;
  className?: string | undefined;
  id?: string | undefined;
  /** A key that focuses the box (the screen wires the key; this announces it), e.g. "/" on the counter (aria-keyshortcuts). */
  keyShortcut?: string | undefined;
}) {
  const [text, setText] = useState(value ?? defaultValue);
  const hintId = useId();
  const search = useRef(onSearch);
  search.current = onSearch;
  const debouncer = useMemo(
    () => createDebouncer((query: string) => search.current(query.trim()), debounceMs),
    [debounceMs],
  );
  useEffect(() => () => debouncer.cancel(), [debouncer]);
  // A controlled value that changes from outside (the URL, a reset) replaces the text, adjusted while rendering.
  const [seen, setSeen] = useState(value);
  if (value !== seen) {
    setSeen(value);
    if (value !== undefined) setText(value);
  }

  function clear() {
    debouncer.cancel();
    setText('');
    onSearch('');
  }
  return (
    <div className={cx('ls-search', className)}>
      <Icon name="search" className="ls-search-icon" />
      <input
        id={id}
        type="search"
        className="ls-input"
        aria-label={label}
        aria-describedby={hint ? hintId : undefined}
        aria-keyshortcuts={keyShortcut}
        placeholder={placeholder ?? label}
        title={hint}
        autoComplete="off"
        value={text}
        onChange={(event) => {
          setText(event.target.value);
          debouncer.call(event.target.value);
        }}
        onKeyDown={(event) => {
          if (event.key === 'Enter') {
            event.preventDefault();
            debouncer.cancel();
            onSearch(text.trim());
          } else if (event.key === 'Escape' && text) {
            event.preventDefault();
            clear();
          }
        }}
      />
      {text ? (
        <IconButton
          icon="close"
          label={clearLabel}
          size="md"
          className="ls-search-clear"
          onClick={clear}
        />
      ) : null}
      {hint ? (
        <span id={hintId} className="ls-visually-hidden">
          {hint}
        </span>
      ) : null}
    </div>
  );
}

// ---------------------------------------------------------------------------------------------
// Structure

/**
 * A titled group of fields: heading, optional one-line description, then the fields. A named
 * region, not a native `fieldset` (no border or legend chrome); use `RadioGroup` for real radio sets.
 */
export function FormSection({
  title,
  description,
  actions,
  children,
  className,
}: {
  title: string;
  description?: string | undefined;
  /** The action of this group only (for example removing one repeated block), at the trailing edge of the title row. */
  actions?: ReactNode | undefined;
  children: ReactNode;
  className?: string | undefined;
}) {
  const titleId = useId();
  const Heading = useContext(FormSectionLevel) === 2 ? 'h2' : 'h3';
  const heading = (
    <Heading className="ls-form-section-title" id={titleId}>
      {title}
    </Heading>
  );
  return (
    <section aria-labelledby={titleId} className={cx('ls-form-section', className)}>
      {actions ? (
        <div className="ls-form-section-head">
          {heading}
          <div className="ls-form-section-actions">{actions}</div>
        </div>
      ) : (
        heading
      )}
      {description ? <p className="ls-hint">{description}</p> : null}
      <div className="ls-form-section-body">{children}</div>
    </section>
  );
}

/** Cancel then Save at the trailing edge (primary last); sticky at the bottom of the screen on a phone. */
export function FormActions({
  primary,
  cancel,
  note,
  className,
}: {
  /** Usually `<Button type="submit" variant="primary" loading={pending}>`. Rendered last. */
  primary: ReactNode;
  cancel?: ReactNode | undefined;
  /** Short status text at the leading edge, e.g. "Unsaved changes". */
  note?: ReactNode | undefined;
  className?: string | undefined;
}) {
  return (
    <div className={cx('ls-form-actions', className)}>
      {note ? <span className="ls-form-actions-note">{note}</span> : null}
      {cancel}
      {primary}
    </div>
  );
}

/** Moves focus to the first control marked `aria-invalid="true"`; returns whether one was found. */
export function focusFirstInvalid(container: ParentNode): boolean {
  const target = container.querySelector<HTMLElement>('[aria-invalid="true"]');
  target?.focus();
  return target !== null;
}

/** Asks the browser to confirm before the tab closes or reloads while a form is dirty. */
export function useUnsavedChangesGuard(dirty: boolean) {
  useEffect(() => {
    if (!dirty) return undefined;
    const onBeforeUnload = (event: BeforeUnloadEvent) => {
      event.preventDefault();
    };
    window.addEventListener('beforeunload', onBeforeUnload);
    return () => window.removeEventListener('beforeunload', onBeforeUnload);
  }, [dirty]);
}

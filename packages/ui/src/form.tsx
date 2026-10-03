'use client';

import {
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
  'aria-describedby'?: string | undefined;
  'aria-invalid'?: true | undefined;
  required?: boolean | undefined;
}

export function Field({
  id,
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
      {error ? (
        <p className="ls-error" id={errorId}>
          <Icon name="x-circle" size={16} />
          <span>{error}</span>
        </p>
      ) : null}
    </div>
  );
}

// ---------------------------------------------------------------------------------------------
// Text-like inputs

type InputBase = Omit<InputHTMLAttributes<HTMLInputElement>, 'size' | 'className'> & {
  invalid?: boolean | undefined;
  className?: string | undefined;
  ref?: Ref<HTMLInputElement> | undefined;
};

export function TextInput({ invalid, className, type = 'text', ...rest }: InputBase) {
  return (
    <input
      {...rest}
      type={type}
      className={cx('ls-input', className)}
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
export function NumberInput({ invalid, className, ...rest }: Omit<InputBase, 'type'>) {
  return (
    <input
      {...rest}
      type="number"
      inputMode="decimal"
      className={cx('ls-input', 'ls-input-number', className)}
      aria-invalid={invalid || rest['aria-invalid'] || undefined}
    />
  );
}

/** `YYYY-MM-DD`. Business dates are interpreted in the branch timezone by the caller. */
export function DateInput(props: Omit<InputBase, 'type'>) {
  return <TextInput {...props} type="date" />;
}

/** `HH:mm`. */
export function TimeInput(props: Omit<InputBase, 'type'>) {
  return <TextInput {...props} type="time" />;
}

/**
 * Integer VND only: shows `1.234.567`, reports a whole number (or `null` when empty), and ignores
 * anything that is not a digit. `unit` is a visible suffix such as "₫".
 */
export function MoneyInput({
  value,
  onValueChange,
  unit,
  separator = '.',
  invalid,
  className,
  ...rest
}: Omit<InputBase, 'type' | 'value' | 'defaultValue' | 'onChange'> & {
  value: number | null;
  onValueChange: (value: number | null) => void;
  unit?: string | undefined;
  separator?: string | undefined;
}) {
  return (
    <span className={cx('ls-money', className)}>
      <input
        {...rest}
        type="text"
        inputMode="numeric"
        autoComplete="off"
        className="ls-input ls-input-number"
        value={formatMoney(value, separator)}
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
  className,
  ...rest
}: Omit<TextareaHTMLAttributes<HTMLTextAreaElement>, 'className'> & {
  invalid?: boolean | undefined;
  className?: string | undefined;
  ref?: Ref<HTMLTextAreaElement> | undefined;
}) {
  return (
    <textarea
      {...rest}
      className={cx('ls-input', 'ls-textarea', className)}
      aria-invalid={invalid || rest['aria-invalid'] || undefined}
    />
  );
}

export interface SelectOption {
  value: string;
  label: string;
  disabled?: boolean | undefined;
}

/** Native select (best on touch). Use `Combobox` when the list is long or searchable. */
export function Select({
  options,
  placeholder,
  invalid,
  className,
  ...rest
}: Omit<SelectHTMLAttributes<HTMLSelectElement>, 'className' | 'children'> & {
  options: readonly SelectOption[];
  /** Text of the empty first option. */
  placeholder?: string | undefined;
  invalid?: boolean | undefined;
  className?: string | undefined;
  ref?: Ref<HTMLSelectElement> | undefined;
}) {
  return (
    <select
      {...rest}
      className={cx('ls-input', 'ls-select', className)}
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
}

// ---------------------------------------------------------------------------------------------
// Combobox (WAI-ARIA 1.2 editable combobox with a listbox popup)

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
            <li
              key={option.value}
              id={`${inputId}-option-${index}`}
              role="option"
              aria-selected={option.value === value}
              aria-disabled={option.disabled || undefined}
              className={cx(
                'ls-option',
                index === active && 'ls-option-active',
                option.value === value && 'ls-option-selected',
              )}
              onMouseEnter={() => setActive(index)}
              onClick={() => choose(option)}
            >
              {option.label}
              {option.value === value ? <Icon name="check" size={16} /> : null}
            </li>
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

/** Debounced search box with a clear button. `onSearch` receives the trimmed text. */
export function SearchInput({
  value,
  defaultValue = '',
  onSearch,
  debounceMs = 300,
  label,
  clearLabel,
  placeholder,
  className,
  id,
}: {
  /** Controlled text (for example from the URL). Omit for an uncontrolled box. */
  value?: string | undefined;
  defaultValue?: string | undefined;
  onSearch: (query: string) => void;
  debounceMs?: number | undefined;
  /** Accessible name; there is no visible label above a toolbar search. */
  label: string;
  clearLabel: string;
  placeholder?: string | undefined;
  className?: string | undefined;
  id?: string | undefined;
}) {
  const [text, setText] = useState(value ?? defaultValue);
  const search = useRef(onSearch);
  search.current = onSearch;
  const debouncer = useMemo(
    () => createDebouncer((query: string) => search.current(query.trim()), debounceMs),
    [debounceMs],
  );
  useEffect(() => () => debouncer.cancel(), [debouncer]);
  useEffect(() => {
    if (value !== undefined) setText(value);
  }, [value]);

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
        placeholder={placeholder}
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

/**
 * A number shown in its final state (the loyalty points). Session 10 (Owner G3, 2026-10-16): motion only answers a user action, so the
 * number no longer counts up when it scrolls into view. The component keeps its API and its classes so callers do not change.
 */
export function CountUp({ value, format }: { value: number; format: (n: number) => string }) {
  return (
    <span className="ls-count">
      <span className="ls-count-final">{format(value)}</span>
    </span>
  );
}

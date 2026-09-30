export function Spinner({ label, size = 16 }: { label?: string; size?: number }) {
  return (
    <span
      className="ls-spinner"
      style={{ width: size, height: size }}
      {...(label ? { role: 'status', 'aria-label': label } : { 'aria-hidden': true })}
    />
  );
}

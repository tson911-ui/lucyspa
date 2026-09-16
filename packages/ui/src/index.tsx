// Temporary text wordmark; final brand assets can replace this component.
export function BrandWordmark() {
  return (
    <span
      style={{
        fontFamily: 'var(--lucy-font-display)',
        fontSize: '1.75rem',
        letterSpacing: '-0.04em',
        whiteSpace: 'nowrap',
      }}
    >
      Lucy <span style={{ fontStyle: 'italic' }}>Spa</span>
    </span>
  );
}

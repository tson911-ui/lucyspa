/**
 * The shop's tagline as two lines for a large headline: "Thư Giãn Tận Tâm – Nâng Tầm Nhan Sắc" becomes
 * ["Thư Giãn Tận Tâm", "Nâng Tầm Nhan Sắc"]. A tagline without a dash stays one line; the dash itself is not drawn.
 */
export function splitTagline(tagline: string): [string, string | null] {
  const parts = tagline
    .split(/\s[–—-]\s/)
    .map((part) => part.trim())
    .filter(Boolean);
  if (parts.length < 2) return [tagline.trim(), null];
  return [parts[0] ?? tagline, parts.slice(1).join(' – ')];
}

/** Fills `{name}` placeholders of a dictionary string. A module of its own, so a page that needs it never loads a whole dictionary. */
export function fill(template: string, values: Record<string, string | number>): string {
  return template.replace(/\{(\w+)\}/g, (match, key: string) =>
    key in values ? String(values[key]) : match,
  );
}

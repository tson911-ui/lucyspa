/**
 * HIG C39 (DESIGN.md section 4, H14): a button or menu item that opens a dialog or drawer to ask for more
 * input ends with "…" ("Điều chỉnh…", "Thêm chi nhánh…"). The dictionary keeps the bare action, because the
 * same words are also the dialog title and its submit button, which never carry the ellipsis. A button that
 * acts at once, a plain confirmation or a link to another page does not use this.
 */
export function opensInput(label: string): string {
  return label.endsWith('…') ? label : `${label}…`;
}

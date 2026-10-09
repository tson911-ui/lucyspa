// Search that ignores accents and case, for the lists of the customer side (a visitor types "goi dau" for "Gội đầu").
// Pure logic; the lists call it on the words they already show.

/** Lower case, accents removed, "đ" as "d": the form two spellings of the same Vietnamese words share. */
export function foldVietnamese(text: string): string {
  return text
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[đĐ]/g, 'd')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim();
}

/** Whether every word of the query is somewhere in the text (any order). An empty query matches everything. */
export function matchesQuery(text: string, query: string): boolean {
  const words = foldVietnamese(query).split(' ').filter(Boolean);
  if (words.length === 0) return true;
  const folded = foldVietnamese(text);
  return words.every((word) => folded.includes(word));
}

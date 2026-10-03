import type { PublicHoursGroup } from '@lucy-spa/contracts';

// Opening hours as text (admin preview and the public site). The API sends groups of ISO weekdays that share the
// same hours; this turns them into lines such as "Thứ Hai – Thứ Sáu: 09:00 – 21:00" or "Mỗi ngày: 09:00 – 21:00".
type HoursLocale = 'vi' | 'en';

const NAMES: Record<HoursLocale, readonly string[]> = {
  vi: ['Thứ Hai', 'Thứ Ba', 'Thứ Tư', 'Thứ Năm', 'Thứ Sáu', 'Thứ Bảy', 'Chủ nhật'],
  en: ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'],
};
const EVERY_DAY: Record<HoursLocale, string> = { vi: 'Mỗi ngày', en: 'Every day' };

/** Consecutive weekdays grouped into runs: [1,2,3,5] becomes [[1,2,3],[5]]. */
export function weekdayRuns(weekdays: readonly number[]): number[][] {
  const runs: number[][] = [];
  for (const day of [...weekdays].sort((a, b) => a - b)) {
    const last = runs[runs.length - 1];
    if (last && day === (last[last.length - 1] ?? 0) + 1) last.push(day);
    else runs.push([day]);
  }
  return runs;
}

/** "Mỗi ngày", "Thứ Hai – Thứ Sáu", "Thứ Bảy", "Thứ Hai, Thứ Tư". Two days in a row read as a list, three or more as a range. */
export function weekdaysLabel(weekdays: readonly number[], locale: HoursLocale): string {
  if (weekdays.length === 7) return EVERY_DAY[locale];
  const names = NAMES[locale];
  const name = (day: number) => names[day - 1] ?? String(day);
  return weekdayRuns(weekdays)
    .map((run) => {
      const first = run[0] ?? 0;
      const last = run[run.length - 1] ?? first;
      if (run.length === 1) return name(first);
      return run.length === 2 ? `${name(first)}, ${name(last)}` : `${name(first)} – ${name(last)}`;
    })
    .join(', ');
}

export function hoursRange(group: PublicHoursGroup, closedLabel: string): string {
  return group.closed || group.opensAt === null || group.closesAt === null
    ? closedLabel
    : `${group.opensAt} – ${group.closesAt}`;
}

export interface HoursLine {
  label: string;
  value: string;
}

export function hoursLines(
  groups: readonly PublicHoursGroup[],
  locale: HoursLocale,
  closedLabel: string,
): HoursLine[] {
  return groups.map((group) => ({
    label: weekdaysLabel(group.weekdays, locale),
    value: hoursRange(group, closedLabel),
  }));
}

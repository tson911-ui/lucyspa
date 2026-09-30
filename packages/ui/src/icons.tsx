import type { SVGProps } from 'react';

// One line-icon set (docs/UXUI_REDESIGN_DESIGN.md 6.6): 24 grid, drawn at 20 px, currentColor,
// 1.75 stroke, inlined so there is no icon font or runtime dependency.
const paths = {
  menu: 'M4 6h16M4 12h16M4 18h16',
  close: 'M6 6l12 12M18 6L6 18',
  'chevron-down': 'M6 9l6 6 6-6',
  'chevron-up': 'M6 15l6-6 6 6',
  'chevron-left': 'M15 6l-6 6 6 6',
  'chevron-right': 'M9 6l6 6-6 6',
  'arrow-up': 'M12 19V5M6 11l6-6 6 6',
  'arrow-down': 'M12 5v14M6 13l6 6 6-6',
  search: 'M11 4a7 7 0 100 14 7 7 0 000-14zM20 20l-4-4',
  plus: 'M12 5v14M5 12h14',
  edit: 'M4 20h4L19 9l-4-4L4 16v4zM13.5 6.5l4 4',
  trash: 'M4 7h16M10 11v6M14 11v6M6 7l1 12a1 1 0 001 1h8a1 1 0 001-1l1-12M9 7V4h6v3',
  check: 'M5 12.5l4.5 4.5L19 7.5',
  'check-circle': 'M12 3a9 9 0 100 18 9 9 0 000-18zM8 12.5l3 3 5-6',
  'x-circle': 'M12 3a9 9 0 100 18 9 9 0 000-18zM9 9l6 6M15 9l-6 6',
  'alert-triangle': 'M12 4L3 20h18L12 4zM12 10v4.5M12 17.5v.01',
  info: 'M12 3a9 9 0 100 18 9 9 0 000-18zM12 11v5M12 8v.01',
  sun: 'M12 8a4 4 0 100 8 4 4 0 000-8zM12 2v2M12 20v2M2 12h2M20 12h2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4',
  moon: 'M20 14.5A8 8 0 019.5 4 8 8 0 1020 14.5z',
  monitor: 'M3 5h18v11H3zM9 20h6M12 16v4',
  user: 'M12 4a4 4 0 100 8 4 4 0 000-8zM4 20a8 8 0 0116 0',
  users:
    'M9 5a3.5 3.5 0 100 7 3.5 3.5 0 000-7zM2.5 19a6.5 6.5 0 0113 0M16 5.5a3.5 3.5 0 010 6.5M18 13.5a6.5 6.5 0 013.5 5.5',
  home: 'M4 11l8-7 8 7M6 9.5V20h12V9.5',
  calendar: 'M4 6h16v14H4zM4 10h16M8 3v4M16 3v4',
  clock: 'M12 3a9 9 0 100 18 9 9 0 000-18zM12 7v5l3 2',
  settings:
    'M12 9a3 3 0 100 6 3 3 0 000-6zM19 12l2 1.2-2 3.4-2.2-.7a7 7 0 01-1.6.9L14.8 19h-4l-.4-2.2a7 7 0 01-1.6-.9l-2.2.7-2-3.4L6.5 12 4.6 10.8l2-3.4 2.2.7a7 7 0 011.6-.9L10.8 5h4l.4 2.2a7 7 0 011.6.9l2.2-.7 2 3.4z',
  filter: 'M4 5h16l-6 8v6l-4-2v-4L4 5z',
  'more-horizontal': 'M6 12v.01M12 12v.01M18 12v.01',
  eye: 'M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12zM12 9.5a2.5 2.5 0 100 5 2.5 2.5 0 000-5z',
  'eye-off':
    'M3 3l18 18M10.6 5.1A9.8 9.8 0 0112 5c6.5 0 10 7 10 7a17 17 0 01-3.2 4M6.6 6.6A16.6 16.6 0 002 12s3.5 7 10 7c1.7 0 3.2-.4 4.5-1M9.9 9.9a3 3 0 004.2 4.2',
  download: 'M12 4v11M7 11l5 5 5-5M5 20h14',
  upload: 'M12 16V5M7 9l5-5 5 5M5 20h14',
  image: 'M4 5h16v14H4zM8.5 9a1.5 1.5 0 100 3 1.5 1.5 0 000-3zM4 17l5-5 4 4 3-3 4 4',
  'log-out': 'M10 4H5v16h5M15 8l4 4-4 4M19 12H9',
  bell: 'M6 16V11a6 6 0 0112 0v5l2 2H4l2-2zM10 21h4',
  drag: 'M9 6v.01M9 12v.01M9 18v.01M15 6v.01M15 12v.01M15 18v.01',
  // Navigation set (Step 5)
  'panel-left': 'M4 5h16v14H4zM9 5v14',
  receipt: 'M6 3h12v18l-3-2-3 2-3-2-3 2V3zM9 8h6M9 12h6',
  tag: 'M3 12V4h8l10 10-8 8L3 12zM7.5 8v.01',
  building: 'M5 21V4h9v17M14 9h5v12M3 21h18M8 8h3M8 12h3M8 16h3',
  'map-pin':
    'M12 21s7-6.2 7-11.5a7 7 0 10-14 0C5 14.8 12 21 12 21zM12 7.5a2.3 2.3 0 100 4.6 2.3 2.3 0 000-4.6z',
  shield: 'M12 3l8 3v6c0 4.5-3.2 7.7-8 9-4.8-1.3-8-4.5-8-9V6l8-3zM9 12l2.2 2.2L15.5 10',
  clipboard: 'M9 4h6v3H9zM7 5.5H5v15h14v-15h-2M9 12h6M9 16h4',
  swap: 'M4 8h15M15 4l4 4-4 4M20 16H5M9 12l-4 4 4 4',
  award: 'M12 3a5.5 5.5 0 100 11 5.5 5.5 0 000-11zM8.5 13.5L7 21l5-3 5 3-1.5-7.5',
  wallet:
    'M4 7.5A1.5 1.5 0 015.5 6H18v3M4 7.5V18a1 1 0 001 1h14V9H5.5A1.5 1.5 0 014 7.5zM15.5 14v.01',
  'user-plus': 'M10 4a4 4 0 100 8 4 4 0 000-8zM3 20a7 7 0 0114 0M19 8v6M16 11h6',
  globe:
    'M12 3a9 9 0 100 18 9 9 0 000-18zM3 12h18M12 3c2.5 2.5 3.5 5.5 3.5 9s-1 6.5-3.5 9c-2.5-2.5-3.5-5.5-3.5-9s1-6.5 3.5-9z',
  sparkles:
    'M12 4l1.8 4.7 4.7 1.8-4.7 1.8L12 17l-1.8-4.7L5.5 10.5l4.7-1.8L12 4zM18 16l.8 2 2 .8-2 .8-.8 2-.8-2-2-.8 2-.8.8-2z',
  'calendar-check': 'M4 6h16v14H4zM4 10h16M8 3v4M16 3v4M9 15l2 2 4-4',
} as const;

export type IconName = keyof typeof paths;
export const iconNames = Object.keys(paths) as IconName[];

export interface IconProps extends Omit<SVGProps<SVGSVGElement>, 'name' | 'children'> {
  name: IconName;
  /** Pixel size; defaults to the 20 px token. */
  size?: number;
  /** Set only when the icon is the sole label of a control; otherwise it is decorative. */
  label?: string;
}

export function Icon({ name, size = 20, label, ...rest }: IconProps) {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 24 24"
      width={size}
      height={size}
      fill="none"
      stroke="currentColor"
      strokeWidth={1.75}
      strokeLinecap="round"
      strokeLinejoin="round"
      {...(label ? { role: 'img', 'aria-label': label } : { 'aria-hidden': true })}
      focusable="false"
      {...rest}
    >
      <path d={paths[name]} />
    </svg>
  );
}

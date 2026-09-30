'use client';

import { ThemeToggle, type ThemeToggleLabels } from '@lucy-spa/ui';
import type { WorkforceDictionary } from '../../i18n/workforce';
import { LanguageSwitch } from './language-switch';
import { useWorkforce } from './session';

export function themeLabels(t: WorkforceDictionary): ThemeToggleLabels {
  return {
    group: t.nav.appearance,
    light: t.nav.themeLight,
    dark: t.nav.themeDark,
    system: t.nav.themeSystem,
  };
}

/** Language and theme controls for the top right of the workforce auth pages (contract 12.6). */
export function AuthTopActions() {
  const { t } = useWorkforce();
  return (
    <>
      <LanguageSwitch />
      <ThemeToggle labels={themeLabels(t)} />
    </>
  );
}

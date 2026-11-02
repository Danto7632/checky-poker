// Language switch (US43): a native select with endonyms. Without the ko flag only English and 日本語 exist; the
// Korean name lives in the ko chunk, so a default build has no Hangul (US44 AC1). Each option carries its own
// `lang` so screen readers pronounce the endonym correctly (WCAG 3.1.2).
import type { Lang } from '@checky/engine/protocol';
import { flags } from '@/config';
import { selectableLangs } from '../i18n/lang';
import { koLanguageName, useT } from '../i18n/useT';
import { Select } from '../ui/Select';
import { useServices } from './ServicesProvider';

export function LanguageSwitch({ testId, showLabel = false }: { testId?: string; showLabel?: boolean }) {
  const t = useT();
  const { lang, changeLanguage } = useServices();
  const options = selectableLangs(flags.FEATURE_KO).map((l: Lang) => ({
    value: l,
    lang: l,
    label: l === 'en' ? t('lang.name.en') : l === 'ja' ? t('lang.name.ja') : (koLanguageName() ?? l),
  }));
  return (
    <Select
      label={t('settings.language')}
      hideLabel={!showLabel}
      value={lang}
      options={options}
      onChange={changeLanguage}
      testId={testId}
    />
  );
}

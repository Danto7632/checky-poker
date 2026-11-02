// TopBar for screens outside the table (ui-spec 0.1): logo -> /app on the left; Settings and the language switch on
// the right (the language moves into Settings below 768). History is added by 4-3 together with its screen — no
// dead entry points (US45). The gap between logo and menu is a spacing token (W2-R5). The bar belongs to no single
// screen ID, so E2E selects it by accessible name only (no data-testid).
import { Settings } from 'lucide-react';
import { Link } from 'react-router';
import { Logo } from '../brand/Logo';
import { useT } from '../i18n/useT';
import { LanguageSwitch } from './LanguageSwitch';

export function TopBar() {
  const t = useT();
  return (
    <header className="sticky top-0 z-(--z-hud) border-b border-border bg-background">
      <div className="mx-auto flex h-12 max-w-app items-center justify-between gap-6 px-4 md:h-14">
        <Link to="/app" aria-label={t('brand.name')} className="inline-flex min-h-11 items-center rounded-sm">
          <Logo variant="lockup" height={24} />
        </Link>
        <nav className="flex items-center gap-4">
          <Link
            to="/settings#profile"
            className="inline-flex min-h-11 items-center gap-2 rounded-sm px-2 text-body text-muted-foreground hover:text-foreground"
          >
            <Settings aria-hidden="true" width={20} height={20} />
            <span className="sr-only md:not-sr-only">{t('settings.title')}</span>
          </Link>
          <div className="hidden md:block">
            <LanguageSwitch />
          </div>
        </nav>
      </div>
    </header>
  );
}

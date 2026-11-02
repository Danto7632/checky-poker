// Gate loading (ui-spec G-01 loading): a blank --ink-950 screen; only after 300 ms does the logo fade in, so a fast
// profile read never flashes anything.
import { useT } from '../i18n/useT';
import { Logo } from '../brand/Logo';

export function GateLoading() {
  const t = useT();
  return (
    <div className="flex min-h-dvh items-center justify-center bg-background" aria-busy="true">
      <span className="motion-fade-in-base motion-delay-300">
        <Logo variant="symbol" height={48} label={t('brand.name')} />
      </span>
    </div>
  );
}

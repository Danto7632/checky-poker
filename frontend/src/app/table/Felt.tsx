// Felt (components.md 3.2): stadium shape (2:1, max 1120; 3:2 rounded rect in portrait layout B), radial felt
// gradient and rail from tokens, the logo symbol watermark at 8%. Width is capped so the felt also fits the viewport
// height between HUD and action bar (--felt-chrome). The old carbon texture hotlink is gone (US45 AC5).
import type { ReactNode } from 'react';
import { LogoSymbolPaths } from '../brand/Logo';

export function Felt({ children }: { children: ReactNode }) {
  return (
    <div className="relative aspect-3/2 w-[min(100%,var(--table-max-w),calc((100dvh-var(--felt-chrome))*2))] md:aspect-2/1" data-testid="T-01.felt">
      <div className="absolute inset-0 rounded-lg border-(length:--rail-w) border-rail bg-[radial-gradient(ellipse_at_50%_45%,var(--felt-center),var(--felt-edge))] shadow-e2 md:rounded-pill">
        <svg aria-hidden="true" viewBox="0 0 64 64" className="absolute top-1/2 left-1/2 w-1/6 -translate-x-1/2 -translate-y-1/2 opacity-8">
          <LogoSymbolPaths tone="onDark" />
        </svg>
      </div>
      {children}
    </div>
  );
}

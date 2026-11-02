// X-01 boot failure (E-UI-BOOT, screen) and the root error boundary. The boundary may fire before the services or
// i18n context exist, so it translates directly with the language already on <html lang> (set by I18nProvider)
// instead of using the context.
import { Component, type ReactNode } from 'react';
import type { Lang } from '@checky/engine/protocol';
import { translate } from '../i18n/useT';
import { Button } from '../ui/Button';
import { ErrorState } from '../ui/ErrorState';

function pageLang(): Lang {
  const l = typeof document === 'undefined' ? 'en' : document.documentElement.lang;
  return l === 'ja' ? 'ja' : 'en';
}

export function BootErrorScreen() {
  const lang = pageLang();
  return (
    <main className="min-h-dvh bg-background">
      <ErrorState
        testId="X-01.boot"
        title={translate(lang, 'boot.title')}
        body={translate(lang, 'boot.body')}
        code="E-UI-BOOT"
        detailsLabel={translate(lang, 'fail.details')}
        actions={
          <>
            <Button variant="primary" onClick={() => window.location.reload()} data-testid="X-01.reload">
              {translate(lang, 'boot.reload')}
            </Button>
            <Button variant="secondary" onClick={() => window.location.assign('/app')} data-testid="X-01.bootHome">
              {translate(lang, 'notFound.cta')}
            </Button>
          </>
        }
      />
    </main>
  );
}

export class BootErrorBoundary extends Component<{ children: ReactNode }, { failed: boolean }> {
  override state = { failed: false };

  static getDerivedStateFromError(): { failed: boolean } {
    return { failed: true };
  }


  override render(): ReactNode {
    return this.state.failed ? <BootErrorScreen /> : this.props.children;
  }
}

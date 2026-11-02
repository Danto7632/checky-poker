// Test helpers: render a screen with the real providers (services with an in-memory storage, i18n, tooltips) and an
// in-memory router. Tests only — app code never imports this file.
import type { ReactElement, ReactNode } from 'react';
import { render, type RenderResult } from '@testing-library/react';
import { createMemoryRouter, RouterProvider, type RouteObject } from 'react-router';
import type { Lang } from '@checky/engine/protocol';
import type { LocalProfile } from '@/storage';
import { createAppServices, type AppServices } from '../composition';
import { I18nProvider } from '../i18n/useT';
import { ServicesProvider } from '../shell/ServicesProvider';
import { TooltipProvider } from '../ui/Tooltip';
import { createMemoryStorage, type MemoryStorage } from './memory-storage';
import { NOTICE_VERSION } from '../gate/notice';

export const PROFILE: LocalProfile = { nickname: 'Mina', avatarSeed: 7, lang: 'en', updatedAt: '2026-11-01T00:00:00.000Z' };

export interface Harness extends RenderResult {
  storage: MemoryStorage;
  services: AppServices;
  router: ReturnType<typeof createMemoryRouter>;
}

export function servicesWith(opts: { lang?: Lang | null; profile?: LocalProfile | null; consented?: boolean } = {}): { storage: MemoryStorage; services: AppServices } {
  const storage = createMemoryStorage({
    profile: opts.profile === undefined ? PROFILE : opts.profile,
    consentVersion: opts.consented === false ? null : NOTICE_VERSION,
    lang: opts.lang === undefined ? 'en' : opts.lang,
  });
  return { storage, services: createAppServices(storage) };
}

/** Renders `routes` at `path` inside every app provider. */
export function renderRoutes(
  routes: RouteObject[],
  path: string,
  opts: { lang?: Lang | null; profile?: LocalProfile | null; consented?: boolean; services?: AppServices; storage?: MemoryStorage } = {},
): Harness {
  const made = opts.services && opts.storage ? { services: opts.services, storage: opts.storage } : servicesWith(opts);
  const router = createMemoryRouter(routes, { initialEntries: [path] });
  const result = render(
    <ServicesProvider services={made.services}>
      <TooltipProvider>
        <RouterProvider router={router} />
      </TooltipProvider>
    </ServicesProvider>,
  );
  return { ...result, ...made, router };
}

/** Renders a component that only needs i18n (+ tooltips), e.g. table pieces. */
export function renderI18n(ui: ReactElement, lang: Lang = 'en'): RenderResult {
  const wrapper = ({ children }: { children: ReactNode }) => (
    <I18nProvider lang={lang}>
      <TooltipProvider>{children}</TooltipProvider>
    </I18nProvider>
  );
  return render(ui, { wrapper });
}

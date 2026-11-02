// Frame for app screens outside the table: TopBar + centred body (max 960, ui-spec 0.1). Route content fades in
// (M-ROUTE, opacity only).
import type { ReactNode } from 'react';
import { TopBar } from './TopBar';

export function AppShell({ children }: { children: ReactNode }) {
  return (
    <div className="flex min-h-dvh flex-col bg-background">
      <TopBar />
      <main className="motion-fade-in mx-auto flex w-full max-w-app flex-1 flex-col gap-6 px-4 py-6 md:px-6 lg:px-8">{children}</main>
    </div>
  );
}

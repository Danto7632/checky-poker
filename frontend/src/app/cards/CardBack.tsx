// Face-down card (components.md 2.2): --card-back with the logo symbol at 18% opacity.
import { clsx } from 'clsx';
import { LogoSymbolPaths } from '../brand/Logo';

export function CardBack({ className }: { className?: string }) {
  return (
    <span className={clsx('flex items-center justify-center rounded-card border border-rail-highlight bg-card-back', className)}>
      <svg aria-hidden="true" viewBox="0 0 64 64" className="w-1/2 opacity-20">
        <LogoSymbolPaths tone="onDark" />
      </svg>
    </span>
  );
}

// Logo A "Knock" (D27; 07-design/brand/logo-a-*.svg path data). Inline SVG so it needs no request and follows the
// tokens: the "c" and wordmark use --text (onDark) or --ink-950 (onLight), the two knock marks use --accent
// (--accent-on-light on light); `mono` paints everything with currentColor.
//
// The interface (variant, tone, height) is fixed by components.md section 8; the artwork can be swapped here
// without touching callers.
import { clsx } from 'clsx';

export type LogoTone = 'onDark' | 'onLight' | 'mono';

const INK: Record<LogoTone, string> = { onDark: 'stroke-foreground', onLight: 'stroke-background', mono: 'stroke-current' };
const MARK: Record<LogoTone, string> = { onDark: 'stroke-primary', onLight: 'stroke-primary-on-light', mono: 'stroke-current' };

/** The symbol's two paths in its 64 x 64 box (shared with CardBack and the felt watermark). */
export function LogoSymbolPaths({ tone }: { tone: LogoTone }) {
  return (
    <>
      <path d="M36.23 20.19A17 17 0 1 0 36.23 43.81" fill="none" strokeWidth="9.5" strokeLinecap="round" className={INK[tone]} />
      <path d="M50 23L46 35M58.5 23L54.5 35" fill="none" strokeWidth="6.5" strokeLinecap="round" className={MARK[tone]} />
    </>
  );
}

function WordmarkPaths({ tone }: { tone: LogoTone }) {
  return (
    <g fill="none" strokeWidth="5.5" strokeLinecap="round" strokeLinejoin="round" className={INK[tone]}>
      <path d="M24.43 21.93A11 11 0 1 0 24.43 36.07" />
      <path d="M35 6V40M35 29A9 9 0 0 1 53 29V40" />
      <path d="M63.5 29H85.5A11 11 0 1 0 82.93 36.07" />
      <path d="M115.43 21.93A11 11 0 1 0 115.43 36.07" />
      <path d="M126 6V40M141 18L127 30M133 24.86L143 40" />
      <path d="M149.5 18L161.31 39M170.5 18L156.5 50" />
    </g>
  );
}

export interface LogoProps {
  variant: 'lockup' | 'symbol' | 'wordmark';
  tone?: LogoTone;
  height: number;
  /** Accessible name; omit when the logo is decorative (e.g. inside a link that already has a name). */
  label?: string | undefined;
  className?: string;
}

export function Logo({ variant, tone = 'onDark', height, label, className }: LogoProps) {
  const box = variant === 'symbol' ? [64, 64] : variant === 'wordmark' ? [176, 54] : [238, 64];
  const a11y = label === undefined ? { 'aria-hidden': true as const } : { role: 'img', 'aria-label': label };
  return (
    <svg viewBox={`0 0 ${box[0]} ${box[1]}`} height={height} width={(height * box[0]!) / box[1]!} className={clsx('h-auto max-w-full shrink-0', className)} {...a11y}>
      {variant === 'symbol' ? <LogoSymbolPaths tone={tone} /> : null}
      {variant === 'wordmark' ? <WordmarkPaths tone={tone} /> : null}
      {variant === 'lockup' ? (
        <>
          <svg x="0" y="0" width="64" height="64" viewBox="0 0 64 64">
            <LogoSymbolPaths tone={tone} />
          </svg>
          <svg x="80" y="8" width="156.4" height="48" viewBox="0 0 176 54">
            <WordmarkPaths tone={tone} />
          </svg>
        </>
      ) : null}
    </svg>
  );
}

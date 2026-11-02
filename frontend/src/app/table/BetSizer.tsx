// BetSizer (components.md 3.9). The value is the contract "to" (street total after the action). The range comes
// from legal only (raise.minTo..maxTo or bet.min..max) — the screen never computes a minimum raise (B-E4).
// Presets are display arithmetic (format.sizerPresets). Typing below the minimum disables confirm with
// "Minimum raise is X."; at or above the maximum the amount becomes All-in (legal.allIn.to) with a note.
// The confirm button is the only accent button on the table (D27/D-5).
//
// Typed text (review M3, ja is a launch language; reading rule fixed by R0-L20), on every keystroke:
//   1. NFKC — a Japanese IME types full-width digits (２５００) that `\d` does not match; NFKC maps them to ASCII, and
//      '，' to ',', the ideographic and no-break spaces to ' '.
//   2. Drop every ASCII ',' and ' ': digit grouping as people type it ("2,500", "2 500", "10,000 "). No grouping check.
//   3. What is left must be ASCII digits only. Anything else ("2.5", "2.5k", "-1", "2、500", a tab) disables confirm
//      with "Enter numbers only." instead of being guessed. An empty field reads as 0, i.e. the minimum error.
// The field keeps what was typed; the confirm label echoes the amount that would be sent ("2,5" -> "Raise to 25", so
// a locale decimal comma shows before anything is sent) and says "—" when there is no amount (rules 3 and empty).
// Enter and Escape are ignored while an IME is composing: the Enter that commits a composition must not also confirm
// a half-typed amount.
import { useState } from 'react';
import * as Slider from '@radix-ui/react-slider';
import type { EngineAction, LegalActions } from '@checky/engine/protocol';
import { useI18n } from '../i18n/useT';
import { Button } from '../ui/Button';
import { formatChips, sizerPresets, type SizerRange } from './format';

export interface BetSizerProps {
  legal: LegalActions;
  range: SizerRange;
  seat: number;
  pot: number;
  myBet: number;
  bb: number;
  busy: boolean;
  onAct: (action: EngineAction) => void;
  onBack: () => void;
}

export function BetSizer({ legal, range, seat, pot, myBet, bb, busy, onAct, onBack }: BetSizerProps) {
  const { t, lang } = useI18n();
  const [text, setText] = useState(String(range.min));
  const typed = text.normalize('NFKC').replace(/[, ]/g, '');
  const notDigits = !/^\d*$/.test(typed);
  const empty = typed === '';
  // '' reads as 0, i.e. below the minimum (same message as a small amount).
  const value = notDigits || empty ? 0 : Number.parseInt(typed, 10);
  const allIn = !notDigits && value >= range.max;
  const tooSmall = !notDigits && !allIn && value < range.min;
  const blocked = notDigits || tooSmall;
  const toCall = legal.call?.amount ?? 0;
  const presets = sizerPresets(range, pot, myBet, toCall);
  const set = (n: number) => setText(String(Math.min(n, range.max)));

  const confirm = () => {
    if (busy || blocked) return;
    if (allIn) onAct({ seat, type: 'allin', to: legal.allIn.to });
    else onAct({ seat, type: range.kind, to: value });
  };

  // No readable amount: the (disabled) confirm says "Raise to —" rather than a number the user never typed.
  const amount = notDigits || empty ? '—' : formatChips(allIn ? legal.allIn.to : value, lang);
  const confirmLabel = allIn ? t('sizer.confirm.allIn', { n: amount }) : t(range.kind === 'raise' ? 'sizer.confirm.raise' : 'sizer.confirm.bet', { n: amount });
  const errorId = 'betsizer-error';
  return (
    <div className="flex flex-col gap-3" data-testid="T-01.betSizer">
      <div className="flex flex-wrap gap-2">
        {presets.map((p) => (
          <Button key={p.id} size="sm" onClick={() => set(p.to)} data-testid={`T-01.preset${p.id[0]!.toUpperCase()}${p.id.slice(1)}`}>
            {p.id === 'min' ? t('sizer.min', { n: formatChips(p.to, lang) }) : t(p.id === 'half' ? 'sizer.halfPot' : p.id === 'pot' ? 'sizer.pot' : 'sizer.threeQuarterPot')}
          </Button>
        ))}
        <Button size="sm" onClick={() => set(range.max)} data-testid="T-01.presetAllIn">
          {t('sizer.allIn', { n: formatChips(legal.allIn.to, lang) })}
        </Button>
      </div>
      <div className="flex items-center gap-3">
        <Slider.Root
          min={range.min}
          max={range.max}
          step={bb}
          value={[Math.min(Math.max(value, range.min), range.max)]}
          onValueChange={([v]) => v !== undefined && set(v)}
          className="relative flex h-11 flex-1 touch-none items-center"
        >
          <Slider.Track className="relative h-1 flex-1 rounded-pill bg-input">
            <Slider.Range className="absolute h-full rounded-pill bg-foreground" />
          </Slider.Track>
          <Slider.Thumb aria-label={t('sizer.amount')} className="block size-6 rounded-pill bg-foreground shadow-e1" />
        </Slider.Root>
        <input
          inputMode="numeric"
          aria-label={t('sizer.amount')}
          placeholder={t('sizer.amount')}
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => {
            // keyCode 229 = "IME is processing" (Safari/Chrome send it with the committing Enter).
            if (e.nativeEvent.isComposing || e.keyCode === 229) return;
            if (e.key === 'Enter') confirm();
            if (e.key === 'Escape') onBack();
          }}
          aria-invalid={blocked ? true : undefined}
          aria-describedby={blocked || allIn ? errorId : undefined}
          className="num h-11 w-28 rounded-md border border-border-strong bg-input px-3 text-body text-foreground"
          data-testid="T-01.sizerInput"
        />
      </div>
      {notDigits ? (
        <p id={errorId} className="text-small text-critical" role="alert">
          {t('sizer.err.digits')}
        </p>
      ) : tooSmall ? (
        <p id={errorId} className="text-small text-critical" role="alert">
          {t(range.kind === 'raise' ? 'sizer.err.min' : 'sizer.err.minBet', { n: formatChips(range.min, lang) })}
        </p>
      ) : allIn && value > range.max ? (
        <p id={errorId} className="text-small text-muted-foreground">
          {t('sizer.clampAllIn')}
        </p>
      ) : null}
      <div className="flex gap-2">
        <Button variant="ghost" onClick={onBack} data-testid="T-01.sizerBack">
          {t('sizer.back')}
        </Button>
        <Button variant="primary" size="lg" className="flex-1" disabled={blocked} loading={busy} onClick={confirm} data-testid="T-01.sizerConfirm">
          {confirmLabel}
        </Button>
      </div>
    </div>
  );
}

// HandResult (components.md 3.11, ui-spec T-02, US10). One row per pot with its amount and winners, split pots
// marked "Split" with each share as given, returned bets on their own rows, and the showdown hand-rank line from the
// engine's RankCode (rank.<code>) with rank names read from best5 (format.rankParts). People's folded or unshown
// cards never appear here (D16); with no showdown the panel says so.
import type { PlayerView, ShowdownEntry } from '@checky/engine/protocol';
import { useI18n, type MessageKey } from '../i18n/useT';
import { Badge } from '../ui/Badge';
import { formatChips, rankParts, rankVarKeys } from './format';

export function useRankText(): (entry: ShowdownEntry) => string {
  const { td } = useI18n();
  return (entry) => {
    const parts = rankParts(entry.rank, entry.best5);
    const keys = rankVarKeys(parts);
    const vars: Record<string, string> = {};
    for (const [name, key] of Object.entries(keys) as [string, MessageKey][]) vars[name] = td(key);
    return td(`rank.${parts.key}`, vars);
  };
}

export function HandResult({ view }: { view: PlayerView }) {
  const { t, lang } = useI18n();
  const rankText = useRankText();
  const result = view.result;
  if (result === null) return null;
  const nameOf = (seat: number) => view.seats.find((s) => s.seat === seat)?.occupant?.name ?? '';
  const sep = t('common.listSep');
  const showdownOf = (seat: number) => result.showdown.find((s) => s.seat === seat);

  return (
    <section className="motion-fade-in-base flex w-full max-w-sm flex-col gap-2 rounded-lg bg-raised/95 p-4 text-small shadow-e2" data-testid="T-02.result">
      {result.pots.map((pot, i) => {
        const split = pot.winners.length > 1;
        const winners = pot.winners
          .map((w, j) => (split ? `${nameOf(w)} ${formatChips(pot.shares[j] ?? 0, lang)}` : nameOf(w)))
          .join(sep);
        const ranks = pot.winners.map(showdownOf).filter((e): e is ShowdownEntry => e !== undefined);
        return (
          <div key={i} className="flex flex-col gap-0.5" data-testid={`T-02.pot${i}`}>
            <p className="num flex flex-wrap items-center gap-2 font-semibold text-foreground">
              {t(pot.kind === 'main' ? 'result.main' : 'result.side', { n: formatChips(pot.amount, lang), winners })}
              {split ? <Badge tone="info">{t('result.split')}</Badge> : null}
            </p>
            {ranks.length > 0 ? (
              <p className="text-muted-foreground">{[...new Set(ranks.map((e) => t('result.handRank', { rank: rankText(e) })))].join(sep)}</p>
            ) : null}
          </div>
        );
      })}
      {result.returned.map((r) => (
        <p key={`r${r.seat}`} className="num text-muted-foreground" data-testid={`T-02.returned${r.seat}`}>
          {t('result.returned', { n: formatChips(r.amount, lang), name: nameOf(r.seat) })}
        </p>
      ))}
      {result.showdown.length === 0 ? <p className="text-muted-foreground">{t('result.noShowdown')}</p> : null}
    </section>
  );
}

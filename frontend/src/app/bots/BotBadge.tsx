// Bot badge (components.md section 6), house variant: neutral "House" tag. 3-3 adds the AI · {provider} variants
// and the "Runs on the host's AI key" tooltip.
import { useT } from '../i18n/useT';
import { Badge } from '../ui/Badge';

export function BotBadge() {
  const t = useT();
  return <Badge tone="neutral">{t('bot.badge.house')}</Badge>;
}

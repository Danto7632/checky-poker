// Storage problems as a banner (E-STO-UNAVAILABLE / E-STO-QUOTA / E-STO-BLOCKED, surface banner). The game keeps
// working in every case; the banner only explains why hands may not be kept.
import { useI18n } from '../i18n/useT';
import { useServices } from '../shell/ServicesProvider';
import { Banner } from '../ui/Banner';

export function StorageBanner() {
  const { td } = useI18n();
  const { storageIssue } = useServices();
  if (storageIssue === null) return null;
  return (
    <Banner tone="warn" testId="H-01.storageBanner">
      {td(`err.${storageIssue}`)}
    </Banner>
  );
}

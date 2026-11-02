// X-01 unknown app path (E-UI-NOT-FOUND, screen). The TopBar logo is the second way out.
import { useNavigate } from 'react-router';
import { useT } from '../i18n/useT';
import { Button } from '../ui/Button';
import { ErrorState } from '../ui/ErrorState';

export function NotFoundScreen() {
  const t = useT();
  const navigate = useNavigate();
  return (
    <ErrorState
      testId="X-01.notFound"
      title={t('notFound.title')}
      actions={
        <Button variant="primary" onClick={() => navigate('/app')} data-testid="X-01.home">
          {t('notFound.cta')}
        </Button>
      }
    />
  );
}

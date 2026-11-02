// App root: boot error boundary -> services (composition root, profile, language, i18n) -> tooltip provider ->
// router + toasts.
import { RouterProvider } from 'react-router';
import { getAppServices } from './composition';
import { router } from './routes';
import { BootErrorBoundary } from './shell/BootErrorScreen';
import { ServicesProvider } from './shell/ServicesProvider';
import { Toaster } from './ui/Toast';
import { TooltipProvider } from './ui/Tooltip';

export default function App() {
  return (
    <BootErrorBoundary>
      <ServicesProvider services={getAppServices()}>
        <TooltipProvider>
          <RouterProvider router={router} />
          <Toaster />
        </TooltipProvider>
      </ServicesProvider>
    </BootErrorBoundary>
  );
}

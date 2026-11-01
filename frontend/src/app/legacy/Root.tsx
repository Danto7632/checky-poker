import { Outlet, useLocation } from "react-router";
import { useEffect, useState } from "react";
import { RotateCw } from "lucide-react";
import { useI18n } from "../i18n";
import { audioManager } from "../audio";

const PHONE_MAX_SHORT_EDGE = 500;
const PHONE_MAX_LONG_EDGE = 1000;
const MOBILE_DESKTOP_VIEWPORT_WIDTH = 1366;

const DEFAULT_VIEWPORT_CONTENT = "width=device-width, initial-scale=1, viewport-fit=cover, interactive-widget=overlays-content";
const LANDSCAPE_VIEWPORT_CONTENT = `width=${MOBILE_DESKTOP_VIEWPORT_WIDTH}, viewport-fit=cover, interactive-widget=overlays-content`;

function isPhoneDevice() {
  const shortEdge = Math.min(window.screen.width, window.screen.height);
  const longEdge = Math.max(window.screen.width, window.screen.height);
  const hasTouch = window.matchMedia("(pointer: coarse)").matches || navigator.maxTouchPoints > 0;

  return hasTouch && shortEdge <= PHONE_MAX_SHORT_EDGE && longEdge <= PHONE_MAX_LONG_EDGE;
}

function isPortraitOrientation() {
  return window.matchMedia("(orientation: portrait)").matches;
}

export function Root() {
  const location = useLocation();
  const [isPortrait, setIsPortrait] = useState(false);
  const [isPhoneLandscape, setIsPhoneLandscape] = useState(false);
  const { t } = useI18n();

  useEffect(() => {
    const pathname = location.pathname;
    const shouldPlayBgm = pathname !== "/" && pathname !== "/loading";
    audioManager.setBgmEnabled(shouldPlayBgm);
  }, [location.pathname]);

  useEffect(() => {
    const viewportMeta = document.querySelector<HTMLMetaElement>("meta[name='viewport']");
    const originalViewportContent =
      viewportMeta?.getAttribute("content")?.trim() || DEFAULT_VIEWPORT_CONTENT;

    const syncPhoneLayout = () => {
      const isPhone = isPhoneDevice();
      const portrait = isPhone && isPortraitOrientation();
      const phoneLandscape = isPhone && !portrait;

      setIsPortrait(portrait);
      setIsPhoneLandscape(phoneLandscape);

      if (!viewportMeta) {
        return;
      }

      const nextViewportContent = phoneLandscape
        ? LANDSCAPE_VIEWPORT_CONTENT
        : originalViewportContent;

      if (viewportMeta.getAttribute("content") !== nextViewportContent) {
        viewportMeta.setAttribute("content", nextViewportContent);
      }
    };

    window.addEventListener("resize", syncPhoneLayout);
    window.addEventListener("orientationchange", syncPhoneLayout);

    syncPhoneLayout();

    return () => {
      window.removeEventListener("resize", syncPhoneLayout);
      window.removeEventListener("orientationchange", syncPhoneLayout);
      if (viewportMeta) {
        viewportMeta.setAttribute("content", originalViewportContent);
      }
    };
  }, []);

  return (
    <div className="relative w-full h-screen overflow-hidden bg-slate-950 text-white font-sans select-none">
      {/* Mobile Portrait Warning overlay */}
      {isPortrait ? (
        <div className="absolute inset-0 z-50 flex flex-col items-center justify-center bg-slate-900 text-center p-6 space-y-4">
          <RotateCw className="w-16 h-16 text-yellow-400 animate-spin-slow" />
          <h1 className="text-2xl font-bold">{t("Please rotate your device")}</h1>
          <p className="text-slate-300">
            {t("AIPOT is designed for the best experience in landscape mode.")}
          </p>
        </div>
      ) : isPhoneLandscape ? (
        <div className="absolute inset-0 px-2.5 py-1.5">
          <div className="h-full w-full overflow-hidden rounded-xl border border-white/10 shadow-[0_0_0_1px_rgba(255,255,255,0.03)]">
            <Outlet />
          </div>
        </div>
      ) : (
        <Outlet />
      )}
    </div>
  );
}

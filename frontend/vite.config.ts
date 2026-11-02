// Vite build for Checky Poker (Andrew).
//
// Two HTML entry points (ADR-0013): `index.html` is the static landing page (no JS) and `app.html` is the app shell
// that Cloudflare Pages serves for every app route via `_redirects` (added with 2-3). The dev and preview servers do
// the same rewrite in-process, so `/practice` works locally exactly like it will on Pages.
//
// The build also stamps the git sha into `import.meta.env.VITE_APP_VERSION`; config/app-version.ts (lead) turns it
// into APP_VERSION for records, exports and diagnostics. Without git (tarball builds) nothing is set and the app
// reports 'dev'.
import { execSync } from 'node:child_process';
import path from 'node:path';
import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import { defineConfig, loadEnv, type Connect, type Plugin } from 'vite';

// routes.v1 app_routes (api-contracts section 1). Keep in sync with app/routes.tsx when a story adds a route.
const APP_ROUTES = new Set([
  '/app',
  '/host',
  '/join',
  '/practice',
  '/arena',
  '/replay',
  '/history',
  '/settings',
  '/help/connect',
]);

function gitSha(): string | null {
  try {
    const sha = execSync('git rev-parse --short=7 HEAD', { stdio: ['ignore', 'pipe', 'ignore'] })
      .toString()
      .trim();
    return /^[0-9a-f]{7}$/.test(sha) ? sha : null;
  } catch {
    return null;
  }
}

/** Serves app.html for app routes in `vite` and `vite preview` (Pages does this with _redirects). */
function appShellRewrite(): Plugin {
  const rewrite: Connect.NextHandleFunction = (req, _res, next) => {
    if (req.url !== undefined) {
      const url = new URL(req.url, 'http://localhost');
      const pathname = url.pathname.length > 1 ? url.pathname.replace(/\/$/, '') : url.pathname;
      if (APP_ROUTES.has(pathname)) req.url = `/app.html${url.search}`;
    }
    next();
  };
  return {
    name: 'checky-app-shell-rewrite',
    configureServer(server) {
      server.middlewares.use(rewrite);
    },
    configurePreviewServer(server) {
      server.middlewares.use(rewrite);
    },
  };
}

/**
 * With ko off, useT.tsx's `import('./ko')` resolves to an empty dictionary, so a default build has no ko chunk and no
 * Hangul (ADR-0012, US44 AC1, scan-dist S4). Still needed although flags.ts now reads import.meta.env.VITE_* directly:
 * the minifier does fold `flags.FEATURE_KO` to false, but only after Rollup has already emitted a chunk for the
 * dynamic import (measured 2026-11-01, Vite 6.4: without this plugin a default build ships ko-*.js with Hangul).
 * ponytail: build-time resolve switch for one import; re-measure on a Vite/Rollup major upgrade and drop it if a
 * FEATURE_KO-off build shows no ko-*.js without it.
 */
function koSwitch(mode: string): Plugin {
  const enabled = loadEnv(mode, __dirname, 'VITE_').VITE_FEATURE_KO === 'true';
  const OFF = '\0checky-i18n-off';
  return {
    name: 'checky-ko-switch',
    enforce: 'pre',
    resolveId(source, importer) {
      if (!enabled && source === './ko' && importer !== undefined && /[\\/]app[\\/]i18n[\\/]useT\.tsx$/.test(importer)) return OFF;
      return null;
    },
    load(id) {
      return id === OFF ? 'export const ko = {};' : null;
    },
  };
}

const sha = gitSha();

export default defineConfig(({ mode }) => ({
  plugins: [
    // The React and Tailwind plugins are both required for Make, even if
    // Tailwind is not being actively used – do not remove them
    react(),
    tailwindcss(),
    appShellRewrite(),
    koSwitch(mode),
  ],
  resolve: {
    alias: {
      // Alias @ to the src directory
      '@': path.resolve(__dirname, './src'),
    },
  },
  define: sha === null ? {} : { 'import.meta.env.VITE_APP_VERSION': JSON.stringify(sha) },
  build: {
    rollupOptions: {
      input: {
        index: path.resolve(__dirname, 'index.html'),
        app: path.resolve(__dirname, 'app.html'),
      },
    },
  },

  // File types to support raw imports. Never add .css, .tsx, or .ts files to this.
  assetsInclude: ['**/*.svg', '**/*.csv'],
}));

import path from 'node:path';
import { defineConfig } from 'vitest/config';

// One Vitest run, three projects (ADR-0015, D-L6). The file must be named vitest.config.ts: Vitest 4+ silently
// ignores vitest.workspace.ts and would run the frontend tests in the node environment.
const frontendSrc = path.resolve(import.meta.dirname, 'frontend/src');

export default defineConfig({
  test: {
    // The on-disk transform cache keys on the importing file, not on what `import.meta.glob` matches, so a run can
    // miss a JSON fixture added after the cache was written (the R0 oracle run saw pending=140 until the cache was
    // cleared). Correct results beat a faster cold start: keep it off.
    fsModuleCache: false,
    projects: [
      {
        test: {
          name: 'engine',
          environment: 'node',
          include: ['packages/engine/{src,test}/**/*.test.ts'],
        },
      },
      {
        test: {
          name: 'analysis',
          environment: 'node',
          include: ['packages/analysis/{src,test}/**/*.test.ts'],
        },
      },
      {
        resolve: { alias: { '@': frontendSrc } },
        test: {
          name: 'frontend',
          environment: 'happy-dom',
          include: ['frontend/src/**/*.test.{ts,tsx}'],
          exclude: ['**/node_modules/**', 'frontend/src/app/legacy/**'],
        },
      },
    ],
  },
});

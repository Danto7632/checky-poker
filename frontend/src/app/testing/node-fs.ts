// Typed access to node:fs / node:process for contract tests. The frontend tsconfig has no Node types (lead config),
// and Vitest blanks CSS modules even with `?raw` (its test.css default), so tests that must read CSS from disk use
// this. Paths are repository-relative; Vitest runs from the repository root (root vitest.config.ts).
import { vi } from 'vitest';

interface Fs {
  readFileSync(path: string, encoding: 'utf8'): string;
  existsSync(path: string): boolean;
}

const fs = await vi.importActual<Fs>('node:fs');
const { cwd } = await vi.importActual<{ cwd(): string }>('node:process');
const ROOT = [cwd(), `${cwd()}/..`].find((dir) => fs.existsSync(`${dir}/frontend/src/app`)) ?? cwd();

export function readRepoFile(relative: string): string {
  return fs.readFileSync(`${ROOT}/${relative}`, 'utf8');
}

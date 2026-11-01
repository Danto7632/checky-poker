// Lint fixture (not product code, not type-checked by `npm run typecheck`): any -> branded type via JSON.parse.
type PlayerView = { readonly seat: number };
declare const raw: string;

export const v: PlayerView = JSON.parse(raw).b.view;

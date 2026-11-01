// Lint fixture: the allowed pattern. External input is received as unknown.
declare const raw: string;

export const x: unknown = JSON.parse(raw);

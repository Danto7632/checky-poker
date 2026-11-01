// Lint fixture: any flowing into an argument and out of a function.
declare const raw: string;
declare function takesNumber(n: number): void;

export function f(): number {
  const x = JSON.parse(raw);
  takesNumber(x);
  return x;
}

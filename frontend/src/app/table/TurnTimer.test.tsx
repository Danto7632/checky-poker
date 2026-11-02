// TurnTimer (components.md 3.5): turn === null renders nothing (ring, number, announcement all 0).
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { TurnTimer } from './TurnTimer';

afterEach(cleanup);

describe('TurnTimer', () => {
  it('renders nothing when turn is null (practice No limit, rule bots)', () => {
    const { container } = render(<TurnTimer turn={null} mine turnKey="h:1" />);
    expect(container.firstChild).toBeNull();
  });

  it('draws the ring and shows the seconds badge from 10 s', () => {
    render(<TurnTimer turn={{ remainingMs: 8000, totalMs: 30000 }} mine turnKey="h:1" />);
    const timer = screen.getByTestId('T-01.turnTimer');
    expect(timer.querySelector('svg')).toBeTruthy();
    expect(timer.textContent).toBe('8');
    expect(timer.querySelector('.stroke-warn')).toBeTruthy();
  });

  it('uses the critical colour at 5 s and the accent above 10 s for my turn', () => {
    const { rerender } = render(<TurnTimer turn={{ remainingMs: 4000, totalMs: 30000 }} mine turnKey="h:1" />);
    expect(screen.getByTestId('T-01.turnTimer').querySelector('.stroke-critical')).toBeTruthy();
    rerender(<TurnTimer turn={{ remainingMs: 24000, totalMs: 30000 }} mine turnKey="h:2" />);
    expect(screen.getByTestId('T-01.turnTimer').querySelector('.stroke-primary')).toBeTruthy();
  });
});

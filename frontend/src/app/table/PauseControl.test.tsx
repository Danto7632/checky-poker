// PauseControl (components.md 3.15 + contract pause_rule.practice 1.0.4-p1): three states, Keep playing enabled
// while pending (F-JN-05), no aria-pressed, no optimistic label change; paused on my empty stack draws nothing — no
// Resume that would be dropped (R0-L3) and no refill button either (R0-L25: the T-06 card is the one).
import { cleanup, fireEvent, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { renderI18n } from '../testing/render';
import { PauseControl } from './PauseControl';

afterEach(cleanup);

function setup(paused: boolean, phase: 'IN_HAND' | 'BETWEEN_HANDS' | 'PAUSED', mustRefill = false) {
  const onPause = vi.fn();
  const onResume = vi.fn();
  const { container } = renderI18n(<PauseControl paused={paused} phase={phase} mustRefill={mustRefill} onPause={onPause} onResume={onResume} />);
  return { onPause, onResume, container, root: screen.queryByTestId('T-01.pauseControl') };
}

describe('PauseControl', () => {
  it('running: Pause -> pause() once', () => {
    const { onPause, onResume, root } = setup(false, 'IN_HAND');
    expect(root?.dataset.state).toBe('running');
    fireEvent.click(screen.getByTestId('T-01.pauseButton'));
    expect(onPause).toHaveBeenCalledTimes(1);
    expect(onResume).not.toHaveBeenCalled();
  });

  it('pending: "Pausing before the next hand" + Keep playing -> resume() (cancel)', () => {
    const { onResume, onPause, root } = setup(true, 'IN_HAND');
    expect(root?.dataset.state).toBe('pending');
    expect(screen.getByText('Pausing before the next hand')).toBeTruthy();
    const keep = screen.getByTestId('T-01.pauseButton');
    expect(keep.textContent).toContain('Keep playing');
    expect(keep.getAttribute('aria-disabled')).toBeNull();
    fireEvent.click(keep);
    expect(onResume).toHaveBeenCalledTimes(1);
    expect(onPause).not.toHaveBeenCalled();
  });

  it('paused: Resume -> resume()', () => {
    const { onResume, root } = setup(true, 'PAUSED');
    expect(root?.dataset.state).toBe('paused');
    fireEvent.click(screen.getByTestId('T-01.pauseButton'));
    expect(onResume).toHaveBeenCalledTimes(1);
  });

  it('paused with my stack at 0 (needsChips, R0-L3 + R0-L25): renders nothing — no Resume, no refill button', () => {
    const { root, container } = setup(true, 'PAUSED', true);
    expect(root).toBeNull();
    expect(container.querySelectorAll('button')).toHaveLength(0);
  });

  it('mustRefill only matters once the room is paused (a running hand still offers Pause)', () => {
    const { onPause, root } = setup(false, 'IN_HAND', true);
    expect(root?.dataset.state).toBe('running');
    fireEvent.click(screen.getByTestId('T-01.pauseButton'));
    expect(onPause).toHaveBeenCalledTimes(1);
  });

  it('never uses aria-pressed and does not change its label on click (next snapshot decides)', () => {
    setup(false, 'IN_HAND');
    expect(document.querySelectorAll('[aria-pressed]')).toHaveLength(0);
    fireEvent.click(screen.getByTestId('T-01.pauseButton'));
    expect(screen.getByTestId('T-01.pauseButton').textContent).toContain('Pause');
  });

  it('the 768-1023 icon variant carries the same accessible name', () => {
    setup(true, 'PAUSED');
    expect(screen.getAllByRole('button', { name: 'Resume' }).length).toBeGreaterThanOrEqual(2);
  });
});

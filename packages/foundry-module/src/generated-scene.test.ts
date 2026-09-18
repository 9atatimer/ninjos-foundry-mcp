/**
 * Post-create handling of a scene imported from generate-map.
 *
 * Regression cover for #3: the module called scene.activate() on every
 * generated map, pulling all connected players onto an unprepared scene.
 * A generated scene is prep work; the GM activates it when ready.
 */

import { describe, it, expect, vi } from 'vitest';
import { finalizeGeneratedScene } from './generated-scene.js';

function fakeScene(img: string | null = 'maps/a.png') {
  return { img, activate: vi.fn(), update: vi.fn() };
}

describe('finalizeGeneratedScene', () => {
  it('never activates the new scene', async () => {
    const scene = fakeScene();

    await finalizeGeneratedScene(scene, { img: 'maps/a.png' });

    expect(scene.activate).not.toHaveBeenCalled();
  });

  it('restores a background Foundry dropped on create', async () => {
    const scene = fakeScene(null);

    await finalizeGeneratedScene(scene, { img: 'maps/a.png' });

    expect(scene.update).toHaveBeenCalledWith({
      img: 'maps/a.png',
      background: { src: 'maps/a.png' },
    });
  });

  it('leaves an intact background alone', async () => {
    const scene = fakeScene('maps/a.png');

    await finalizeGeneratedScene(scene, { img: 'maps/a.png' });

    expect(scene.update).not.toHaveBeenCalled();
  });
});

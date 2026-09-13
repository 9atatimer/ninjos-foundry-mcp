/**
 * Scene payload for AI-generated battlemaps.
 *
 * Generated art has no grid of its own, so the scene must not draw one either:
 * grid lines off, snap-to-grid off. A gridless scene gives both -- there are no
 * lines to draw and nothing to snap to -- while `size` and `distance` still
 * scale measurement and token size.
 */

import { describe, it, expect } from 'vitest';
import { buildMapSceneData } from './map-scene.js';

const base = {
  sceneName: 'Emberhollow Gulch',
  webPath: 'worlds/mainland/ai-generated-maps/map.png',
  sceneSize: 1536,
  gridSize: 70,
};

describe('buildMapSceneData', () => {
  it('creates a gridless scene, so no grid lines and no snapping', () => {
    const scene = buildMapSceneData(base);

    expect(scene.grid.type).toBe(0); // CONST.GRID_TYPES.GRIDLESS
  });

  it('keeps grid size and distance so measurement still scales', () => {
    const scene = buildMapSceneData(base);

    expect(scene.grid.size).toBe(70);
    expect(scene.grid.distance).toBe(5);
    expect(scene.grid.units).toBe('ft');
  });

  it('falls back to a 100px grid when none is given', () => {
    const scene = buildMapSceneData({ ...base, gridSize: undefined });

    expect(scene.grid.size).toBe(100);
  });

  it('sizes the scene to the image and uses it as background', () => {
    const scene = buildMapSceneData(base);

    expect(scene.name).toBe('Emberhollow Gulch');
    expect(scene.width).toBe(1536);
    expect(scene.height).toBe(1536);
    expect(scene.img).toBe(base.webPath);
    expect(scene.background.src).toBe(base.webPath);
  });
});

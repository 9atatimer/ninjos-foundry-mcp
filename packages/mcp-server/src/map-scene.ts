/**
 * Scene payload for an AI-generated battlemap (simplified version of mapgen's
 * FoundryIntegrator). Pure, so the shape is testable without a backend.
 */

export interface MapSceneInput {
  sceneName: string;
  webPath: string;
  sceneSize: number;
  gridSize?: number | undefined;
}

export function buildMapSceneData(input: MapSceneInput): Record<string, any> {
  const { sceneName, webPath, sceneSize } = input;

  return {
    name: sceneName,
    img: webPath,
    background: { src: webPath }, // Foundry v13 compatibility
    width: sceneSize,
    height: sceneSize,
    padding: 0.25,
    initial: {
      x: sceneSize / 2,
      y: sceneSize / 2,
      scale: 1,
    },
    backgroundColor: '#999999',
    grid: {
      // Gridless: generated art carries no grid, so draw no lines and snap to
      // nothing. size and distance still scale measurement and token size.
      type: 0, // CONST.GRID_TYPES.GRIDLESS
      size: input.gridSize || 100,
      color: '#000000',
      alpha: 0.2,
      distance: 5,
      units: 'ft',
    },
    tokenVision: true,
    fogExploration: true,
    fogReset: Date.now(),
    globalLight: false,
    darkness: 0,
    navigation: false, // unrevealed prep work stays out of the nav bar (#3)
    active: false,
    permission: {
      default: 2, // CONST.DOCUMENT_OWNERSHIP_LEVELS.OBSERVER
    },
    walls: [], // Could add wall detection here later
  };
}

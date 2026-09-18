/**
 * Post-create handling of a scene imported from generate-map.
 *
 * Deliberately does NOT activate the scene (#3). Activating pulls every
 * connected player onto it; a generated map is prep work that the GM reveals
 * when ready.
 */

interface GeneratedSceneLike {
  img?: string | null;
  update(data: Record<string, unknown>): Promise<unknown> | unknown;
}

export async function finalizeGeneratedScene(
  scene: GeneratedSceneLike,
  sceneData: { img?: string }
): Promise<void> {
  // Foundry v13 bug workaround (like working mapgen system): the background
  // can be dropped on create, so write it again.
  if (!scene.img && sceneData.img) {
    await scene.update({
      img: sceneData.img,
      background: { src: sceneData.img },
    });
  }
}

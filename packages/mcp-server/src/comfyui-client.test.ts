/**
 * ComfyUI workflow shape tests.
 *
 * Regression cover for #2: plain VAEDecode runs full self-attention over the
 * whole latent, and on Apple MPS a 1536px (medium) decode dies with "Can't be
 * indexed using 32-bit iterator". Decoding must be tiled so every size works.
 */

import { describe, it, expect, vi } from 'vitest';
import { ComfyUIClient } from './comfyui-client.js';

function makeClient() {
  const logger: any = {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    child: () => logger,
  };
  return new ComfyUIClient({ logger, config: { enabled: false } });
}

function buildWorkflow(size: number): Record<string, any> {
  return (makeClient() as any).buildWorkflow({
    prompt: 'a desert camp',
    width: size,
    height: size,
  });
}

describe('ComfyUIClient.buildWorkflow', () => {
  it.each([1024, 1536, 2048])('decodes a %ipx latent with VAEDecodeTiled', size => {
    const workflow = buildWorkflow(size);
    const decoders = Object.values(workflow).filter(n =>
      String(n.class_type).startsWith('VAEDecode')
    );

    expect(decoders).toHaveLength(1);
    expect(decoders[0].class_type).toBe('VAEDecodeTiled');
    expect(decoders[0].inputs.tile_size).toBeLessThanOrEqual(1024);
  });

  it('loads the D&D Battlemaps SDXL checkpoint the prompt wrapper is tuned for', () => {
    // "2d DnD battlemap" is this model's trigger phrase, and 8 steps at cfg 2.5
    // are its settings. juggernautXL (a photoreal model) produced empty sand.
    const loader = buildWorkflow(1536)['1'];

    expect(loader.class_type).toBe('CheckpointLoaderSimple');
    expect(loader.inputs.ckpt_name).toBe('dDBattlemapsSDXL10_upscaleV10.safetensors');
  });

  it('wires the tiled decoder between the sampler and SaveImage', () => {
    const workflow = buildWorkflow(1536);

    expect(workflow['6'].inputs.samples).toEqual(['5', 0]);
    expect(workflow['6'].inputs.vae).toEqual(['1', 2]);
    expect(workflow['7'].inputs.images).toEqual(['6', 0]);
  });
});

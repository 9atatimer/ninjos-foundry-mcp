#!/usr/bin/env python3
"""Turn a GM's colour-coded map into ControlNet control images.

A hand-drawn or vector overland map usually separates meaning by colour:
green contour rings, dark waterways, red city blocks, grey roads, pink
hatching for fields. ControlNet has no semantics -- it constrains geometry
and the prompt supplies the meaning -- so the useful move is to split those
layers and feed the right one to the right control type.

Writes three files next to --out:

  ctrl-lineart.png    every drawn layer, black on white, thickened
  ctrl-scribble.png   structure only (water, city, roads); contours dropped
  ctrl-depth.png      grayscale height from the contour rings, water cut in

Usage (needs Pillow + SciPy; the ComfyUI venv has both):

  ~/workplace/OSS/comfyui/.venv/bin/python3 scripts/map-layers-to-controls.py \
      --src ~/gamestuff/campaigns/_inbox/map.jpg --out /tmp/controls

Then render with scripts/battlemap-render.mjs against
workflows/battlemap/07-controlnet-region-map.api.json, after copying the
control image into ComfyUI's input/ directory.

Measured on a real GM map (2026-09-18): lineart at strength 0.8, ending at
85% of steps, was the most faithful -- it beat depth alone and a
depth+lineart stack. See docs/battlemap-region-map-controls.md.
"""

import argparse
import os

import numpy as np
from PIL import Image, ImageFilter
from scipy import ndimage


def masks(rgb):
    """Split an RGB array into the layers a GM map usually carries."""
    r, g, b = rgb[..., 0], rgb[..., 1], rgb[..., 2]
    lum = (r + g + b) / 3
    return {
        "green": (g - r > 40) & (g - b > 40),          # contours
        "dark": lum < 90,                               # waterways
        "red": (r - g > 50) & (r - b > 30) & (lum < 200),  # city blocks
        "grey": (lum >= 90) & (lum < 190) & (abs(r - g) < 30) & (abs(g - b) < 30),
        "pink": (r - g > 12) & (r - g <= 50) & (lum >= 200),  # field hatching
    }


def upscale(mask, size):
    return Image.fromarray((mask * 255).astype(np.uint8)).resize(size, Image.LANCZOS)


def ink_image(mask_img, thicken):
    """Black lines on white, thickened so an edge pass can see them."""
    grown = mask_img.filter(ImageFilter.MaxFilter(thicken))
    return Image.fromarray(255 - np.array(grown)).convert("RGB")


def depth_from_contours(green_img, water_img, shape):
    """Height from nested contour rings.

    Counts contour crossings inward from each of the four image edges and
    takes the minimum. Filling nested contours does not work here: a GM's
    rings usually run off the edge of the page, so every region connects to
    the outside and the fill finds one level. Straight map borders and scale
    bars still produce some banding -- smooth, then check by eye.
    """
    gm = ndimage.binary_dilation(np.array(green_img) > 100, np.ones((3, 3)))

    def crossings(axis, reverse):
        m = gm[:, ::-1] if (axis == 1 and reverse) else gm[::-1] if (axis == 0 and reverse) else gm
        entries = m & ~np.roll(m, 1, axis=axis)
        head = (slice(None, 1),) if axis == 0 else (slice(None), slice(None, 1))
        entries[head] = m[head]
        c = np.cumsum(entries, axis=axis)
        return c[:, ::-1] if (axis == 1 and reverse) else c[::-1] if (axis == 0 and reverse) else c

    level = np.minimum.reduce(
        [crossings(1, False), crossings(1, True), crossings(0, False), crossings(0, True)]
    )
    height = ndimage.gaussian_filter(level.astype(float) / max(1, level.max()), 8)

    water = np.array(water_img).astype(float) / 255
    height = np.clip(height * (1 - water) - 0.25 * water, 0, 1)
    span = max(1e-6, height.max() - height.min())
    return Image.fromarray((((height - height.min()) / span) * 255).astype(np.uint8)).convert("RGB")


def main():
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--src", required=True, help="the GM's map image")
    ap.add_argument("--out", required=True, help="directory to write control images into")
    ap.add_argument("--width", type=int, default=1344, help="control width (SDXL bucket)")
    ap.add_argument("--height", type=int, default=768, help="control height")
    args = ap.parse_args()

    os.makedirs(args.out, exist_ok=True)
    size = (args.width, args.height)
    rgb = np.array(Image.open(args.src).convert("RGB")).astype(int)
    layer = masks(rgb)
    for name, mask in layer.items():
        print(f"{name:6} {int(mask.sum()):7} px")

    everything = layer["green"] | layer["red"] | layer["dark"] | layer["grey"]
    ink_image(upscale(everything, size), 5).save(f"{args.out}/ctrl-lineart.png")

    structure = layer["dark"] | layer["red"] | layer["grey"]
    ink_image(upscale(structure, size), 9).save(f"{args.out}/ctrl-scribble.png")

    depth_from_contours(
        upscale(layer["green"], size).filter(ImageFilter.MaxFilter(3)),
        upscale(layer["dark"], size).filter(ImageFilter.MaxFilter(5)),
        size,
    ).save(f"{args.out}/ctrl-depth.png")

    print(f"wrote ctrl-lineart.png, ctrl-scribble.png, ctrl-depth.png to {args.out}")


if __name__ == "__main__":
    main()

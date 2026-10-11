#!/usr/bin/env python3
"""Render icons/icon-192.png, icon-512.png and icon-maskable-512.png (the door on a dark ground)."""
import os
from PIL import Image, ImageDraw

OUT = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "icons")


def render(size, scale=1.0):
    k = 8  # supersample
    s = size * k
    img = Image.new("RGB", (s, s), "#14110F")
    d = ImageDraw.Draw(img)
    u = s / 108 * scale
    o = (s - 108 * u) / 2

    def r(x0, y0, x1, y1, c):
        d.rectangle([o + x0 * u, o + y0 * u, o + x1 * u - 1, o + y1 * u - 1], fill=c)

    r(30, 22, 78, 88, "#3A2D22")
    r(34, 26, 74, 84, "#D9A441")
    r(54, 26, 74, 84, "#FFE9A8")
    d.ellipse([o + 61 * u, o + 49 * u, o + 67 * u, o + 55 * u], fill="#14110F")
    return img.resize((size, size), Image.LANCZOS)


render(192).save(os.path.join(OUT, "icon-192.png"))
render(512).save(os.path.join(OUT, "icon-512.png"))
render(512, 0.7).save(os.path.join(OUT, "icon-maskable-512.png"))

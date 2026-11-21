"""Generates crisp multi-resolution Obsidian Forge icons for mc-launcher-rust.
Uses only Python stdlib (math, pathlib, struct, zlib) with 4x4 supersampling anti-aliasing.
Outputs into src-tauri/icons/:
  - icon.png (512x512)
  - 128x128@2x.png (256x256)
  - 128x128.png (128x128)
  - 32x32.png (32x32)
  - icon.ico (multi-layer: 16, 32, 48, 256)
"""
from __future__ import annotations

import math
from pathlib import Path
import struct
import zlib

OUT_DIR = Path(__file__).resolve().parent.parent / "src-tauri" / "icons"


def clamp01(v: float) -> float:
    return 0.0 if v < 0.0 else (1.0 if v > 1.0 else v)


def lerp(a: float, b: float, t: float) -> float:
    return a + (b - a) * t


def blend(
    dst: tuple[float, float, float, float],
    src: tuple[float, float, float, float],
) -> tuple[float, float, float, float]:
    sa = src[3]
    da = dst[3]
    out_a = sa + da * (1.0 - sa)
    if out_a <= 1e-6:
        return (0.0, 0.0, 0.0, 0.0)
    r = (src[0] * sa + dst[0] * da * (1.0 - sa)) / out_a
    g = (src[1] * sa + dst[1] * da * (1.0 - sa)) / out_a
    b = (src[2] * sa + dst[2] * da * (1.0 - sa)) / out_a
    return (r, g, b, out_a)


def sd_rounded_box(px: float, py: float, bx: float, by: float, r: float) -> float:
    qx = abs(px) - bx + r
    qy = abs(py) - by + r
    return math.hypot(max(qx, 0.0), max(qy, 0.0)) + min(max(qx, qy), 0.0) - r


def point_in_poly(px: float, py: float, pts: list[tuple[float, float]]) -> bool:
    inside = False
    n = len(pts)
    j = n - 1
    for i in range(n):
        xi, yi = pts[i]
        xj, yj = pts[j]
        if ((yi > py) != (yj > py)) and (
            px < (xj - xi) * (py - yi) / (yj - yi + 1e-12) + xi
        ):
            inside = not inside
        j = i
    return inside


def dist_to_segment(
    px: float, py: float, ax: float, ay: float, bx: float, by: float
) -> float:
    vx, vy = bx - ax, by - ay
    wx, wy = px - ax, py - ay
    c1 = vx * wx + vy * wy
    if c1 <= 0.0:
        return math.hypot(px - ax, py - ay)
    c2 = vx * vx + vy * vy
    if c2 <= c1:
        return math.hypot(px - bx, py - by)
    t = c1 / c2
    return math.hypot(px - (ax + t * vx), py - (ay + t * vy))


TOP_POLY = [(0.0, -0.58), (0.52, -0.28), (0.0, 0.02), (-0.52, -0.28)]
LEFT_POLY = [(-0.52, -0.28), (0.0, 0.02), (0.0, 0.60), (-0.52, 0.30)]
RIGHT_POLY = [(0.0, 0.02), (0.52, -0.28), (0.52, 0.30), (0.0, 0.60)]
CORE_TOP = [(0.0, -0.44), (0.28, -0.28), (0.0, -0.12), (-0.28, -0.28)]


def sample_color(nx: float, ny: float) -> tuple[float, float, float, float]:
    d_outer = sd_rounded_box(nx, ny, 0.92, 0.92, 0.24)
    if d_outer > 0.015:
        return (0.0, 0.0, 0.0, 0.0)

    outer_alpha = clamp01(0.5 - d_outer / 0.018)
    grad_t = clamp01((ny + 1.0) * 0.5)
    bg_r = lerp(0.085, 0.035, grad_t)
    bg_g = lerp(0.112, 0.048, grad_t)
    bg_b = lerp(0.168, 0.075, grad_t)

    r_dist = math.hypot(nx, ny + 0.08)
    glow = math.exp(-r_dist * r_dist * 3.2) * 0.22
    col = (
        clamp01(bg_r + glow * 0.06),
        clamp01(bg_g + glow * 0.72),
        clamp01(bg_b + glow * 0.50),
        outer_alpha,
    )

    if -0.045 < d_outer < -0.008:
        col = blend(col, (0.18, 0.24, 0.36, 0.75 * outer_alpha))

    if point_in_poly(nx, ny, TOP_POLY):
        t = clamp01((nx + 0.52) / 1.04)
        face = (lerp(0.06, 0.22, t), lerp(0.73, 0.76, t), lerp(0.51, 0.96, t), 1.0)
        col = blend(col, face)
        if point_in_poly(nx, ny, CORE_TOP):
            col = blend(col, (0.65, 0.98, 0.88, 0.28))
    elif point_in_poly(nx, ny, LEFT_POLY):
        t = clamp01((ny + 0.28) / 0.88)
        face = (lerp(0.07, 0.04, t), lerp(0.32, 0.14, t), lerp(0.28, 0.18, t), 1.0)
        col = blend(col, face)
        top_y_at_x = -0.28 + (nx + 0.52) * (0.30 / 0.52)
        if ny - top_y_at_x < 0.11:
            col = blend(col, (0.04, 0.62, 0.44, 0.85))
    elif point_in_poly(nx, ny, RIGHT_POLY):
        t = clamp01((ny + 0.28) / 0.88)
        face = (lerp(0.09, 0.05, t), lerp(0.13, 0.07, t), lerp(0.20, 0.12, t), 1.0)
        col = blend(col, face)
        top_y_at_x = 0.02 - nx * (0.30 / 0.52)
        if ny - top_y_at_x < 0.11:
            col = blend(col, (0.14, 0.56, 0.82, 0.80))

    edges = [
        ((0.0, -0.58), (0.52, -0.28), (0.55, 0.98, 0.90, 0.70)),
        ((0.0, -0.58), (-0.52, -0.28), (0.45, 0.96, 0.80, 0.70)),
        ((-0.52, -0.28), (0.0, 0.02), (0.65, 1.00, 0.92, 0.85)),
        ((0.52, -0.28), (0.0, 0.02), (0.45, 0.88, 1.00, 0.85)),
        ((0.0, 0.02), (0.0, 0.60), (0.35, 0.85, 0.95, 0.60)),
    ]
    for (ax, ay), (bx, by), ec in edges:
        d = dist_to_segment(nx, ny, ax, ay, bx, by)
        if d < 0.022:
            a = clamp01(1.0 - d / 0.022) * ec[3]
            col = blend(col, (ec[0], ec[1], ec[2], a))

    return (col[0], col[1], col[2], col[3] * outer_alpha)


def render_rgba(size: int, ss: int = 4) -> bytes:
    out = bytearray(size * size * 4)
    inv_n = 1.0 / (ss * ss)
    idx = 0
    for y in range(size):
        for x in range(size):
            ar = ag = ab = aa = 0.0
            for sy in range(ss):
                ny = ((y + (sy + 0.5) / ss) / size) * 2.0 - 1.0
                for sx in range(ss):
                    nx = ((x + (sx + 0.5) / ss) / size) * 2.0 - 1.0
                    r, g, b, a = sample_color(nx, ny)
                    ar += r * a
                    ag += g * a
                    ab += b * a
                    aa += a
            aa *= inv_n
            if aa > 1e-6:
                r = clamp01((ar * inv_n) / aa)
                g = clamp01((ag * inv_n) / aa)
                b = clamp01((ab * inv_n) / aa)
            else:
                r = g = b = 0.0
            out[idx] = int(round(r * 255))
            out[idx + 1] = int(round(g * 255))
            out[idx + 2] = int(round(b * 255))
            out[idx + 3] = int(round(clamp01(aa) * 255))
            idx += 4
    return bytes(out)


def encode_png(size: int, rgba: bytes) -> bytes:
    def chunk(tag: bytes, data: bytes) -> bytes:
        crc = zlib.crc32(tag + data) & 0xFFFFFFFF
        return struct.pack(">I", len(data)) + tag + data + struct.pack(">I", crc)

    raw = bytearray()
    stride = size * 4
    for y in range(size):
        raw.append(0)
        raw.extend(rgba[y * stride : (y + 1) * stride])

    ihdr = struct.pack(">IIBBBBB", size, size, 8, 6, 0, 0, 0)
    compressed = zlib.compress(bytes(raw), level=9)
    return (
        b"\x89PNG\r\n\x1a\n"
        + chunk(b"IHDR", ihdr)
        + chunk(b"IDAT", compressed)
        + chunk(b"IEND", b"")
    )


def encode_ico(entries: list[tuple[int, bytes]]) -> bytes:
    header = struct.pack("<HHH", 0, 1, len(entries))
    dir_entries = bytearray()
    offset = 6 + 16 * len(entries)
    payloads = bytearray()
    for size, png_bytes in entries:
        dim = 0 if size >= 256 else size
        dir_entries.extend(
            struct.pack("<BBBBHHII", dim, dim, 0, 0, 1, 32, len(png_bytes), offset)
        )
        payloads.extend(png_bytes)
        offset += len(png_bytes)
    return header + bytes(dir_entries) + bytes(payloads)


def main() -> None:
    OUT_DIR.mkdir(parents=True, exist_ok=True)
    png_cache: dict[int, bytes] = {}
    for size in (16, 32, 48, 128, 256, 512):
        ss = 4 if size <= 256 else 2
        png_cache[size] = encode_png(size, render_rgba(size, ss=ss))

    targets = {
        "32x32.png": png_cache[32],
        "128x128.png": png_cache[128],
        "128x128@2x.png": png_cache[256],
        "icon.png": png_cache[512],
        "icon.ico": encode_ico([(s, png_cache[s]) for s in (16, 32, 48, 256)]),
    }

    for name, data in targets.items():
        path = OUT_DIR / name
        path.write_bytes(data)
        print(f"Wrote {name}: {len(data)} bytes")


if __name__ == "__main__":
    main()

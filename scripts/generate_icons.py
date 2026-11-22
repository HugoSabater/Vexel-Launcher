"""Generates crisp multi-resolution Vexel Launcher icons (v1.0.0).
Uses only Python stdlib (math, pathlib, struct, zlib) with supersampling anti-aliasing.
Outputs into src-tauri/icons/:
  - icon.png (512x512)
  - 128x128@2x.png (256x256)
  - 128x128.png (128x128)
  - 32x32.png (32x32)
  - icon.ico (multi-layer: 16, 32, 48, 64, 128, 256)
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


def lerp_rgb(
    c1: tuple[float, float, float],
    c2: tuple[float, float, float],
    t: float,
) -> tuple[float, float, float]:
    t = clamp01(t)
    return (lerp(c1[0], c2[0], t), lerp(c1[1], c2[1], t), lerp(c1[2], c2[2], t))


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


# Faceted isometric/voxel "V" mark geometry (normalized [-1, 1] space)
# Balanced thick stroke (~18% width per arm) for razor-sharp readability at 16x16..512x512
L_CAP = [(-0.60, -0.40), (-0.42, -0.54), (-0.23, -0.40), (-0.41, -0.26)]
R_CAP = [(0.23, -0.40), (0.42, -0.54), (0.60, -0.40), (0.41, -0.26)]

L_OUTER = [(-0.60, -0.40), (-0.41, -0.26), (0.00, 0.44), (0.00, 0.64)]
L_INNER = [(-0.41, -0.26), (-0.23, -0.40), (0.00, 0.06), (0.00, 0.44)]

R_INNER = [(0.23, -0.40), (0.41, -0.26), (0.00, 0.44), (0.00, 0.06)]
R_OUTER = [(0.41, -0.26), (0.60, -0.40), (0.00, 0.64), (0.00, 0.44)]

V_SILHOUETTE = [
    (-0.60, -0.40),
    (-0.42, -0.54),
    (-0.23, -0.40),
    (0.00, 0.06),
    (0.23, -0.40),
    (0.42, -0.54),
    (0.60, -0.40),
    (0.00, 0.64),
]

# Palette (linear-sRGB calibrated to Obsidian Forge: #07090D..#121722, #10B981 -> #38BDF8)
BG_TOP = (0x12 / 255.0, 0x17 / 255.0, 0x22 / 255.0)
BG_BOT = (0x07 / 255.0, 0x09 / 255.0, 0x0D / 255.0)

EMERALD_BRIGHT = (0x34 / 255.0, 0xD3 / 255.0, 0x99 / 255.0)
EMERALD = (0x10 / 255.0, 0xB9 / 255.0, 0x81 / 255.0)
TEAL_MID = (0x0D / 255.0, 0x94 / 255.0, 0x88 / 255.0)
CYAN = (0x38 / 255.0, 0xBD / 255.0, 0xF8 / 255.0)
CYAN_BRIGHT = (0x7D / 255.0, 0xD3 / 255.0, 0xFC / 255.0)
SHADOW_HI = (0x0E / 255.0, 0x74 / 255.0, 0x90 / 255.0)
SHADOW_LO = (0x0A / 255.0, 0x4E / 255.0, 0x66 / 255.0)
SHADOW_DEEP = (0x08 / 255.0, 0x3A / 255.0, 0x52 / 255.0)


def sample_color(nx: float, ny: float) -> tuple[float, float, float, float]:
    d_outer = sd_rounded_box(nx, ny, 0.92, 0.92, 0.26)
    if d_outer > 0.018:
        return (0.0, 0.0, 0.0, 0.0)

    outer_alpha = clamp01(0.5 - d_outer / 0.018)

    # Obsidian dark squircle gradient (#121722 top -> #07090D bottom)
    grad_t = clamp01((ny + 0.95) / 1.90)
    bg_r, bg_g, bg_b = lerp_rgb(BG_TOP, BG_BOT, grad_t)

    # Subtle ambient emerald/cyan core glow behind the V
    r_dist = math.hypot(nx * 0.95, (ny - 0.04) * 1.05)
    glow = math.exp(-r_dist * r_dist * 3.4) * 0.19
    glow_mix = clamp01((nx + 0.65) / 1.30)
    glow_rgb = lerp_rgb(EMERALD, CYAN, glow_mix)
    col = (
        clamp01(bg_r + glow * glow_rgb[0]),
        clamp01(bg_g + glow * glow_rgb[1]),
        clamp01(bg_b + glow * glow_rgb[2]),
        outer_alpha,
    )

    # Subtle zenithal top bevel rim + crisp perimeter border
    if -0.046 < d_outer < -0.004:
        rim_t = clamp01(1.0 - (ny + 0.92) / 1.55)
        rim_alpha = lerp(0.16, 0.62, rim_t) * outer_alpha
        rim_rgb = lerp_rgb((0.14, 0.19, 0.29), (0.36, 0.46, 0.62), rim_t)
        col = blend(col, (rim_rgb[0], rim_rgb[1], rim_rgb[2], rim_alpha))

    # Subtle cast drop shadow below the V onto the obsidian surface
    if point_in_poly(nx, ny - 0.065, V_SILHOUETTE):
        col = blend(col, (0.0, 0.0, 0.0, 0.42))

    # Faceted Voxel "V" faces
    v_t = clamp01((ny + 0.48) / 1.12)
    if point_in_poly(nx, ny, L_CAP):
        t = clamp01((nx + 0.60) / 0.37)
        rgb = lerp_rgb(EMERALD_BRIGHT, (0.58, 0.98, 0.85), t)
        col = blend(col, (rgb[0], rgb[1], rgb[2], 1.0))
    elif point_in_poly(nx, ny, R_CAP):
        t = clamp01((nx - 0.23) / 0.37)
        rgb = lerp_rgb(CYAN, CYAN_BRIGHT, 1.0 - t)
        col = blend(col, (rgb[0], rgb[1], rgb[2], 1.0))
    elif point_in_poly(nx, ny, L_OUTER):
        rgb = lerp_rgb(EMERALD, CYAN, v_t * 0.82)
        col = blend(col, (rgb[0], rgb[1], rgb[2], 1.0))
    elif point_in_poly(nx, ny, L_INNER):
        rgb = lerp_rgb(EMERALD_BRIGHT, CYAN, v_t * 0.92)
        col = blend(col, (rgb[0], rgb[1], rgb[2], 1.0))
    elif point_in_poly(nx, ny, R_INNER):
        rgb = lerp_rgb(SHADOW_HI, TEAL_MID, v_t * 0.75)
        col = blend(col, (rgb[0], rgb[1], rgb[2], 1.0))
    elif point_in_poly(nx, ny, R_OUTER):
        rgb = lerp_rgb(SHADOW_LO, SHADOW_DEEP, v_t)
        col = blend(col, (rgb[0], rgb[1], rgb[2], 1.0))

    # Crisp specular facet ridges (keeps facets distinct at small icon sizes)
    ridges = [
        ((-0.41, -0.26), (0.00, 0.44), (0.72, 1.00, 0.95, 0.78)),
        ((0.00, 0.06), (0.00, 0.64), (0.55, 0.94, 1.00, 0.72)),
        ((0.41, -0.26), (0.00, 0.44), (0.38, 0.82, 0.96, 0.55)),
        ((-0.60, -0.40), (-0.42, -0.54), (0.78, 1.00, 0.92, 0.65)),
        ((-0.42, -0.54), (-0.23, -0.40), (0.78, 1.00, 0.92, 0.65)),
        ((0.23, -0.40), (0.42, -0.54), (0.68, 0.95, 1.00, 0.65)),
        ((0.42, -0.54), (0.60, -0.40), (0.55, 0.88, 1.00, 0.55)),
    ]
    for (ax, ay), (bx, by), ec in ridges:
        d = dist_to_segment(nx, ny, ax, ay, bx, by)
        if d < 0.020:
            a = clamp01(1.0 - d / 0.020) * ec[3]
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


def verify_ico_binary(ico_bytes: bytes) -> list[tuple[int, int]]:
    reserved, ico_type, count = struct.unpack("<HHH", ico_bytes[:6])
    if reserved != 0 or ico_type != 1:
        raise ValueError(f"Invalid ICO header: reserved={reserved}, type={ico_type}")
    layers: list[tuple[int, int]] = []
    for i in range(count):
        base = 6 + i * 16
        w, h, _cc, _res, _planes, bpp, size, offset = struct.unpack(
            "<BBBBHHII", ico_bytes[base : base + 16]
        )
        dim = 256 if w == 0 else w
        if h != w or bpp != 32:
            raise ValueError(f"Unexpected ICO entry #{i}: {w}x{h} {bpp}bpp")
        payload = ico_bytes[offset : offset + size]
        if not payload.startswith(b"\x89PNG\r\n\x1a\n"):
            raise ValueError(f"ICO layer {dim}x{dim} missing PNG signature")
        layers.append((dim, size))
    return layers


def main() -> None:
    OUT_DIR.mkdir(parents=True, exist_ok=True)
    ico_sizes = (16, 32, 48, 64, 128, 256)
    all_sizes = (*ico_sizes, 512)
    png_cache: dict[int, bytes] = {}
    for size in all_sizes:
        ss = 4 if size <= 256 else 2
        png_cache[size] = encode_png(size, render_rgba(size, ss=ss))

    ico_bytes = encode_ico([(s, png_cache[s]) for s in ico_sizes])
    verified_layers = verify_ico_binary(ico_bytes)

    targets = {
        "32x32.png": png_cache[32],
        "128x128.png": png_cache[128],
        "128x128@2x.png": png_cache[256],
        "icon.png": png_cache[512],
        "icon.ico": ico_bytes,
    }

    for name, data in targets.items():
        path = OUT_DIR / name
        path.write_bytes(data)
        print(f"Wrote {name}: {len(data)} bytes")

    print(
        "Verified icon.ico layers:",
        ", ".join(f"{dim}x{dim} ({sz} B)" for dim, sz in verified_layers),
    )


if __name__ == "__main__":
    main()

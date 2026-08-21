#!/usr/bin/env python3
"""Generate the AutoHD toolbar icons."""

from pathlib import Path

from PIL import Image, ImageDraw, ImageFont

ROOT = Path(__file__).resolve().parent.parent
OUT = ROOT / "icons"
FONT = Path("/usr/share/fonts/TTF/DejaVuSans-Bold.ttf")

BG = (22, 18, 16, 255)
GOLD = (228, 179, 74, 255)


def rounded_rect(draw: ImageDraw.ImageDraw, box: list[int], radius: int, **kwargs) -> None:
    draw.rounded_rectangle(box, radius=radius, **kwargs)


def make_icon(size: int) -> Image.Image:
    image = Image.new("RGBA", (size, size), (0, 0, 0, 0))
    draw = ImageDraw.Draw(image)
    pad = max(1, round(size * 0.06))
    radius = max(3, round(size * 0.18))
    rounded_rect(draw, [pad, pad, size - pad - 1, size - pad - 1], radius, fill=BG)

    if size < 32:
        bar_h = max(4, round(size * 0.28))
        bar_y = (size - bar_h) // 2
        bar_x = pad + 3
        rounded_rect(
            draw,
            [bar_x, bar_y, size - bar_x - 1, bar_y + bar_h],
            2,
            fill=GOLD,
        )
        return image

    inset = pad + max(1, round(size * 0.08))
    rounded_rect(
        draw,
        [inset, inset, size - inset - 1, size - inset - 1],
        max(2, radius - 2),
        outline=GOLD,
        width=max(1, round(size / 28)),
    )

    font = ImageFont.truetype(str(FONT), size=round(size * 0.36))
    text = "HD"
    left, top, right, bottom = draw.textbbox((0, 0), text, font=font)
    width, height = right - left, bottom - top
    x = (size - width) / 2 - left
    y = (size - height) / 2 - top - size * 0.02
    draw.text((x, y), text, font=font, fill=GOLD)
    return image


def main() -> None:
    OUT.mkdir(parents=True, exist_ok=True)
    for size in (16, 32, 48, 128):
        path = OUT / f"icon{size}.png"
        make_icon(size).save(path, "PNG")
        print(f"wrote {path.relative_to(ROOT)}")


if __name__ == "__main__":
    main()

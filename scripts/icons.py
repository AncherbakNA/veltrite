"""Создание ресурсов иконки. Требуется Pillow; временные файлы — вне проекта."""

from pathlib import Path
import argparse
import subprocess
from PIL import Image, ImageDraw


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--local", type=Path, required=True)
    options = parser.parse_args()
    resources = Path(__file__).resolve().parents[1] / "resources"
    iconset = options.local / "icon.iconset"
    iconset.mkdir(parents=True, exist_ok=True)
    size = 1024
    image = Image.new("RGBA", (size, size))
    mask = Image.new("L", (size, size))
    ImageDraw.Draw(mask).rounded_rectangle((18, 18, 1006, 1006), radius=227, fill=255)
    background = Image.new("RGBA", (size, size), "#292724")
    background.putalpha(mask)
    image.alpha_composite(background)
    draw = ImageDraw.Draw(image)
    draw.line([(245, 290), (474, 777), (780, 252)], fill="#dba47f", width=42, joint="curve")
    facets = [
        ([(226, 274), (397, 334), (474, 777), (356, 556)], "#bb724f"),
        ([(397, 334), (486, 535), (474, 777)], "#80442d"),
        ([(486, 535), (780, 252), (650, 600), (474, 777)], "#e6b08b"),
        ([(780, 252), (665, 298), (486, 535)], "#c78660"),
        ([(226, 274), (397, 334), (342, 389)], "#f2cfab"),
    ]
    for points, fill in facets:
        draw.polygon(points, fill=fill)
    image.save(resources / "icon.png")
    image.save(resources / "icon.ico", sizes=[(16, 16), (32, 32), (48, 48), (64, 64), (128, 128), (256, 256)])
    for dimension in [16, 32, 128, 256, 512]:
        image.resize((dimension, dimension), Image.Resampling.LANCZOS).save(iconset / f"icon_{dimension}x{dimension}.png")
        image.resize((dimension * 2, dimension * 2), Image.Resampling.LANCZOS).save(iconset / f"icon_{dimension}x{dimension}@2x.png")
    subprocess.run(["iconutil", "-c", "icns", str(iconset), "-o", str(resources / "icon.icns")], check=True)


if __name__ == "__main__":
    main()

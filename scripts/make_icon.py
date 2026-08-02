from PIL import Image, ImageDraw
from pathlib import Path

root = Path(__file__).resolve().parent.parent / "build"
root.mkdir(exist_ok=True)

size = 256
img = Image.new("RGBA", (size, size), (0, 0, 0, 0))
d = ImageDraw.Draw(img)

d.rounded_rectangle([8, 8, 248, 248], radius=52, fill=(47, 111, 237))
d.rounded_rectangle([18, 18, 238, 238], radius=44, outline=(255, 255, 255, 36), width=4)

d.polygon([(52, 96), (128, 62), (204, 96), (128, 130)], fill=(255, 255, 255))
d.polygon([(128, 136), (188, 158), (128, 196), (68, 158)], fill=(205, 223, 255))
d.polygon([(52, 96), (128, 130), (128, 196), (68, 158)], fill=(168, 200, 255))
d.rectangle([120, 148, 136, 194], fill=(255, 255, 255))

img.save(root / "icon.png")
img.save(
    root / "icon.ico",
    sizes=[(16, 16), (24, 24), (32, 32), (48, 48), (64, 64), (128, 128), (256, 256)],
)
print(root / "icon.ico")

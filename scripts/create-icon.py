from pathlib import Path
from PIL import Image, ImageDraw

root = Path(__file__).resolve().parents[1]
assets = root / 'assets'
assets.mkdir(exist_ok=True)

size = 256
image = Image.new('RGBA', (size, size), (0, 0, 0, 0))
draw = ImageDraw.Draw(image)
draw.rounded_rectangle((8, 8, 248, 248), radius=58, fill='#5A49CC')
draw.rounded_rectangle((55, 45, 197, 213), radius=18, fill='#FFFFFF')
draw.rounded_rectangle((85, 28, 167, 65), radius=10, fill='#E7E2FF')
for y, width in [(99, 82), (128, 82), (157, 60)]:
    draw.rounded_rectangle((81, y, 81 + width, y + 11), radius=5, fill='#B8B1EA')
draw.ellipse((142, 149, 224, 231), fill='#37B890')
draw.line([(160, 190), (176, 206), (208, 171)], fill='#FFFFFF', width=11, joint='curve')

image.save(assets / 'icon.png')
image.save(assets / 'icon.ico', sizes=[(16, 16), (24, 24), (32, 32), (48, 48), (64, 64), (128, 128), (256, 256)])

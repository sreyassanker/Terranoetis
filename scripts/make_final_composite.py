import os
from PIL import Image, ImageDraw, ImageFont

ARTIFACT_DIR = "/Users/sreyassanker/.gemini/antigravity/brain/0d7f5cb1-1248-45e6-8b00-8c963e217a6e"

img_raw = Image.open(os.path.join(ARTIFACT_DIR, "live_app_03_trv_opacity_0pct.png"))
img_100 = Image.open(os.path.join(ARTIFACT_DIR, "live_app_04_trv_opacity_100pct.png"))
panel_card = Image.open(os.path.join(ARTIFACT_DIR, "live_app_05_panel_results_card.png"))

# 3200 x 2000 retina
# Crop airport region from main viewports
# Center airport runway triangle is roughly x: 800 to 2200, y: 300 to 1700
crop_box = (650, 160, 2250, 1760) # 1600 x 1600
crop_raw = img_raw.crop(crop_box)
crop_100 = img_100.crop(crop_box)

# Detailed runway triangle zoom: x: 1100 to 1850, y: 700 to 1450 (relative to full image)
zoom_box = (1100, 700, 1850, 1450) # 750 x 750
zoom_raw = img_raw.crop(zoom_box).resize((800, 800), Image.Resampling.LANCZOS)
zoom_100 = img_100.crop(zoom_box).resize((800, 800), Image.Resampling.NEAREST)

# Create layout:
# Top Row: Full Airport Area (Raw Satellite 0% Opacity [1200x1200] vs Classified 100% Opacity [1200x1200])
# Bottom Row: Zoomed Runway Triangle (Raw Satellite [700x700] vs Classified [700x700]) + Panel Card [scaled to fit]

w_main = 1100
h_main = 1100
crop_raw_scaled = crop_raw.resize((w_main, h_main), Image.Resampling.LANCZOS)
crop_100_scaled = crop_100.resize((w_main, h_main), Image.Resampling.NEAREST)

w_zoom = 700
h_zoom = 700
zoom_raw_scaled = zoom_raw.resize((w_zoom, h_zoom), Image.Resampling.LANCZOS)
zoom_100_scaled = zoom_100.resize((w_zoom, h_zoom), Image.Resampling.NEAREST)

# Panel card resize to match height
pc_ratio = panel_card.width / panel_card.height
h_card = h_zoom
w_card = int(h_card * pc_ratio)
panel_card_scaled = panel_card.resize((w_card, h_card), Image.Resampling.LANCZOS)

margin = 30
header_h = 110
mid_h = 70
footer_h = 50

total_w = max(w_main * 2 + margin * 3, w_zoom * 2 + w_card + margin * 4)
total_h = header_h + h_main + mid_h + h_zoom + footer_h

comp = Image.new("RGBA", (total_w, total_h), (11, 15, 25, 255))
draw = ImageDraw.Draw(comp)

# Try loading system font, fallback to default
try:
    font_title = ImageFont.truetype("/System/Library/Fonts/Helvetica.ttc", 36)
    font_sub = ImageFont.truetype("/System/Library/Fonts/Helvetica.ttc", 20)
    font_tag = ImageFont.truetype("/System/Library/Fonts/Helvetica.ttc", 22)
    font_sec = ImageFont.truetype("/System/Library/Fonts/Helvetica.ttc", 26)
except Exception:
    font_title = font_sub = font_tag = font_sec = ImageFont.load_default()

# Header
draw.rectangle([(0, 0), (total_w, header_h - 10)], fill=(15, 23, 42, 255))
draw.text((margin, 20), "TERRANOETIS LIVE DESKTOP APP: LAND COVER VERIFICATION (TRV AIRPORT)", fill=(248, 250, 252), font=font_title)
draw.text((margin, 65), "Verification Standard: 0% False Water on Airfield | 100% Solid Gray Runway (Class 7) | Crisp Sand Infields (Class 9)", fill=(56, 189, 248), font=font_sub)

# Top Row - Main Views
y_top = header_h
x_left = margin
x_right = margin * 2 + w_main

comp.paste(crop_raw_scaled, (x_left, y_top))
comp.paste(crop_100_scaled, (x_right, y_top))

# Labels for top row
draw.rectangle([(x_left + 15, y_top + 15), (x_left + 460, y_top + 65)], fill=(0, 0, 0, 200))
draw.text((x_left + 25, y_top + 25), "LIVE SATELLITE (0% OPACITY)", fill=(255, 255, 255), font=font_tag)

draw.rectangle([(x_right + 15, y_top + 15), (x_right + 580, y_top + 65)], fill=(0, 0, 0, 200))
draw.text((x_right + 25, y_top + 25), "CLASSIFIED OVERLAY (100% OPACITY)", fill=(74, 222, 128), font=font_tag)

# Section Divider
y_mid = y_top + h_main + 20
draw.text((margin, y_mid), "DETAILED RUNWAY & INFIELD AIRPORT TRIANGLE (ZERO FALSE WATER VERIFICATION)", fill=(251, 191, 36), font=font_sec)

# Bottom Row - Zoom Views + Panel Card
y_bot = y_mid + 45
x_z1 = margin
x_z2 = x_z1 + w_zoom + margin
x_z3 = x_z2 + w_zoom + margin

comp.paste(zoom_raw_scaled, (x_z1, y_bot))
comp.paste(zoom_100_scaled, (x_z2, y_bot))
comp.paste(panel_card_scaled, (x_z3, y_bot))

draw.rectangle([(x_z1 + 15, y_bot + 15), (x_z1 + 430, y_bot + 65)], fill=(0, 0, 0, 200))
draw.text((x_z1 + 25, y_bot + 25), "ZOOM: RUNWAY RAW SATELLITE", fill=(255, 255, 255), font=font_tag)

draw.rectangle([(x_z2 + 15, y_bot + 15), (x_z2 + 560, y_bot + 65)], fill=(0, 0, 0, 200))
draw.text((x_z2 + 25, y_bot + 25), "ZOOM: RUNWAY (#BEBEBE) + SOIL (#CE8F64)", fill=(74, 222, 128), font=font_tag)

# Save composite
out_path = os.path.join(ARTIFACT_DIR, "live_app_verification_composite.png")
comp.save(out_path, format="PNG")
print(f"✅ Saved perfected composite to: {out_path}")

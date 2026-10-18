import numpy as np
from PIL import Image

def rgb_to_lab(r, g, b):
    def pivot(n):
        n = n / 255.0
        return ((n + 0.055) / 1.055) ** 2.4 if n > 0.04045 else n / 12.92
    X = pivot(r) * 0.4124 + pivot(g) * 0.3576 + pivot(b) * 0.1805
    Y = pivot(r) * 0.2126 + pivot(g) * 0.7152 + pivot(b) * 0.0722
    Z = pivot(r) * 0.0193 + pivot(g) * 0.1192 + pivot(b) * 0.9505
    def f(t):
        return t ** (1/3) if t > 0.008856 else (7.787 * t) + (16 / 116)
    fx, fy, fz = f(X / 0.95047), f(Y / 1.0), f(Z / 1.08883)
    L = max(0.0, 116.0 * fy - 16.0)
    a = (fx - fy) * 500.0
    b_val = (fy - fz) * 200.0
    chroma = (a*a + b_val*b_val) ** 0.5
    return L, a, b_val, chroma

def classify_scene(img_path):
    img = Image.open(img_path).convert('RGB')
    # Resize to 512x512 for fast accurate simulation
    img = img.resize((512, 512), Image.Resampling.LANCZOS)
    arr = np.array(img, dtype=np.float32)
    h, w, _ = arr.shape
    
    r = arr[:, :, 0]
    g = arr[:, :, 1]
    b = arr[:, :, 2]
    
    LAvg = (r + g + b) / 3.0
    mx = np.maximum(np.maximum(r, g), b)
    mn = np.minimum(np.minimum(r, g), b)
    spread = mx - mn
    sat = spread / (mx + 1e-5)
    
    denomW = g + b + 2 * r + 1e-5
    wi = (g + b - 2 * r) / denomW
    denomV = g + r - b + 1e-5
    vari = np.where(np.abs(denomV) > 1e-4, (g - r) / denomV, 0.0)
    
    # Compute 2D spatial gradient
    gray = LAvg
    gx = np.zeros_like(gray)
    gy = np.zeros_like(gray)
    gx[:, 1:-1] = np.abs(gray[:, 2:] - gray[:, :-2]) * 0.5
    gy[1:-1, :] = np.abs(gray[2:, :] - gray[:-2, :]) * 0.5
    grad = gx + gy
    
    # Convert to Lab
    # Vectorized RGB to Lab
    def pivot_vec(n):
        n = n / 255.0
        return np.where(n > 0.04045, ((n + 0.055) / 1.055) ** 2.4, n / 12.92)
    X = pivot_vec(r) * 0.4124 + pivot_vec(g) * 0.3576 + pivot_vec(b) * 0.1805
    Y = pivot_vec(r) * 0.2126 + pivot_vec(g) * 0.7152 + pivot_vec(b) * 0.0722
    Z = pivot_vec(r) * 0.0193 + pivot_vec(g) * 0.1192 + pivot_vec(b) * 0.9505
    def f_vec(t):
        return np.where(t > 0.008856, t ** (1/3), (7.787 * t) + (16 / 116))
    fx, fy, fz = f_vec(X / 0.95047), f_vec(Y / 1.0), f_vec(Z / 1.08883)
    L = np.maximum(0.0, 116.0 * fy - 16.0)
    a = (fx - fy) * 500.0
    bVal = (fy - fz) * 200.0
    chroma = np.sqrt(a * a + bVal * bVal)
    
    out = np.zeros((h, w), dtype=np.uint8)
    
    # Snow detection (Pass 1):
    # 1. Direct Sunlit Snow: L > 80 or (r > 180 and g > 180 and b > 180 and sat < 0.20)
    # 2. Shaded Snow / Glacier Ice under diffuse blue sky: LAvg >= 65 and b >= r + 8 and b >= g and grad < 4.5 and chroma < 30 and LAvg <= 200
    isSunSnow = (L > 80) & (chroma < 18.0) & (spread < 35)
    isShadedSnow = (LAvg >= 65) & (b >= r + 10) & (b >= g - 2) & (grad < 4.5) & (chroma < 30.0) & (r >= 35) & (bVal <= 0.0)
    isSnow = isSunSnow | isShadedSnow
    snowCount = np.sum(isSnow)
    isAlpineScene = (snowCount / (h * w)) > 0.05
    
    out[isSnow] = 10
    
    # Case 2 Algal River Water (e.g. Nile River):
    # wi > 0.35, r <= 18, b >= 18, grad < 3.5
    isAlgalRiverWater = (wi > 0.35) & (r <= 20) & (b >= 15) & (grad < 3.5) & (r / (g + 1e-5) <= 0.40)
    
    # Real Vegetation Guard in Pass 1:
    isRealVeg = (
        ((a < -3.0) & (g > r + 6) & (g >= b - 2) & ((b / (g + 1e-5)) <= 0.90) & ((vari >= 0.08) | (g >= r + 10)) & (LAvg < 185)) |
        ((g >= r + 12) & (g >= b - 2) & ~isAlgalRiverWater)
    )
    
    # Pavement Guard:
    isPavementCandidate = (
        (chroma < 18.0) &
        (g - r <= 16) &
        (g - b <= 28) &
        (LAvg >= 35) &
        (LAvg <= 220) &
        ((r >= b + 4) | (wi <= 0.06)) &
        (bVal < 18.0)
    )
    
    # Water Extinction:
    isWaterExtinction = (b >= r - 1) | (g >= r + 18)
    
    # Deep Ocean Water (Class 1): MUST have blue dominant over green! Cannot have green dominant or chlorophyll!
    isDeepOcean = (
        (r <= 25) &
        (b >= 20) &
        (b <= 110) &
        (b >= g - 2) &
        ((b / (g + 1e-5)) >= 0.90) &
        (vari < 0.08) &
        isWaterExtinction &
        ~isRealVeg &
        ~isPavementCandidate
    )
    
    # Coastal / Estuary / River Water (Class 2):
    isCoastalSeed = (
        (wi >= 0.10) &
        ((b / (g + 1e-5)) >= 0.82) &
        (b >= g - 6) &
        (r < 75) &
        (bVal <= 1.0) &
        (a < 0.0) &
        isWaterExtinction &
        ~isPavementCandidate &
        ~isRealVeg
    )
    isEstuarySeed = (
        (wi > 0.12) &
        ((g + b) / (2 * r + 1) > 1.35) &
        (grad < 3.5) &
        (r < 75) &
        (b >= 25) &
        isWaterExtinction &
        ~isPavementCandidate &
        ~isRealVeg
    )
    
    isWaterSeed = isDeepOcean | isCoastalSeed | isEstuarySeed | isAlgalRiverWater
    
    # Assign Water:
    # If in Alpine scene, NO ocean/coastal water (avoids water on alpine ridges)
    if isAlpineScene:
        isWaterSeed = np.zeros_like(isWaterSeed)
        
    out[isWaterSeed & (out == 0) & isDeepOcean] = 1
    out[isWaterSeed & (out == 0)] = 2
    
    # Pass 2: Remaining pixels
    unassigned = (out == 0)
    
    # Alpine Scene handling:
    if isAlpineScene:
        # Snow in shade that had lower albedo:
        alp_snow = unassigned & (LAvg >= 60) & (b >= r - 2) & (grad < 5.0)
        out[alp_snow] = 10
        unassigned = (out == 0)
        
        # Mountain Rock:
        alp_rock = unassigned & (LAvg < 75)
        out[alp_rock] = 8
        unassigned = (out == 0)
        
        # Default alpine is rock:
        out[unassigned] = 8
        return out
        
    # Non-alpine scenes:
    # Bare Soil / Sand:
    isSoilWarm = (r > g + 4) & (g >= b + 4) & (bVal > 5.0) & (sat >= 0.14) & ((bVal > a * 1.2) | (a <= 4.0))
    isSand = (r > 110) & (g > 90) & (r > g + 6) & (b < r - 12) & (bVal > 5.0) & (sat >= 0.14) & ((a < 15.0) | (bVal > a * 1.2))
    isAridBare = (r > 125) & (g > 100) & (r > g + 6) & (b < r - 14) & (chroma > 7.0) & (bVal > 5.0) & ((a < 15.0) | (bVal > a * 1.2))
    soil_mask = unassigned & (isSoilWarm | isSand | isAridBare)
    out[soil_mask] = 9
    unassigned = (out == 0)
    
    # Pavement (Transportation Class 7):
    pave_mask = unassigned & isPavementCandidate
    out[pave_mask] = 7
    unassigned = (out == 0)
    
    # Real Vegetation: Crop (5) vs Forest (3/4)
    # Planar parcel (grad < 4.0) with strong green chlorophyll (vari >= 0.12 or g >= r + 8) -> Crop (Class 5)
    crop_mask = unassigned & isRealVeg & (grad < 4.0) & ((vari >= 0.10) | (g >= r + 8))
    out[crop_mask] = 5
    unassigned = (out == 0)
    
    # Forest:
    closed_forest = unassigned & isRealVeg & (LAvg < 55)
    out[closed_forest] = 3
    unassigned = (out == 0)
    
    open_forest = unassigned & isRealVeg
    out[open_forest] = 4
    unassigned = (out == 0)
    
    # Built-up:
    out[unassigned] = 6
    
    return out

# Run simulation across all locations
CLASSES = {
    1: 'Deep Ocean Water',
    2: 'Inland Water / Estuary',
    3: 'Closed Forest',
    4: 'Open Forest',
    5: 'Crop / Agriculture',
    6: 'Built Up',
    7: 'Transportation',
    8: 'Mountain Rock',
    9: 'Bare Soil / Sand',
    10: 'Snow / Ice / Glacier',
    11: 'Shadow / Dark'
}

for name, path in [
    ('Mont Blanc', '/Users/sreyassanker/.gemini/antigravity/brain/0d7f5cb1-1248-45e6-8b00-8c963e217a6e/multi_mont_blanc_01_raw.png'),
    ('San Francisco Bay', '/Users/sreyassanker/.gemini/antigravity/brain/0d7f5cb1-1248-45e6-8b00-8c963e217a6e/multi_sf_bay_01_raw.png'),
    ('Cairo & Nile', '/Users/sreyassanker/.gemini/antigravity/brain/0d7f5cb1-1248-45e6-8b00-8c963e217a6e/multi_cairo_nile_01_raw.png'),
    ('Central Valley', '/Users/sreyassanker/.gemini/antigravity/brain/0d7f5cb1-1248-45e6-8b00-8c963e217a6e/multi_central_valley_01_raw.png'),
    ('TRV Airport', '/Users/sreyassanker/.gemini/antigravity/brain/0d7f5cb1-1248-45e6-8b00-8c963e217a6e/live_app_01_trv_satellite_raw.png')
]:
    res = classify_scene(path)
    total = res.size
    print(f'=== {name} ===')
    counts = {c: np.sum(res == c) for c in range(1, 12)}
    for c, cnt in counts.items():
        if cnt > 0:
            pct = (cnt / total) * 100
            print(f'  {CLASSES[c]}: {pct:.1f}% ({cnt} px)')
    print()

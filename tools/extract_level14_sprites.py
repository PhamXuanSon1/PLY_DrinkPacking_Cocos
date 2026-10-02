"""Cut Level 14 sprites out of the Unity ripped project into the Cocos project.

Usage: python tools/extract_level14_sprites.py
Reads  F:/AssetDrinkPacking/Ripper/ExportedProject/Assets
Writes assets/resources/level14/sprites/<group>/<name>.png
"""
import os, re, glob, sys
from PIL import Image

UNITY = r"F:/AssetDrinkPacking/Ripper/ExportedProject/Assets"
OUT = os.path.join(os.path.dirname(__file__), "..", "assets", "resources", "level14", "sprites")

_guid_cache = {}
def guid_to_png(guid):
    if guid in _guid_cache:
        return _guid_cache[guid]
    for meta in glob.glob(os.path.join(UNITY, "Texture2D", "*.png.meta")):
        with open(meta, encoding="utf-8", errors="ignore") as f:
            head = f.read(200)
        m = re.search(r"guid: ([0-9a-f]+)", head)
        if m:
            _guid_cache[m.group(1)] = meta[:-5]
    return _guid_cache.get(guid)

def sprite_asset(name):
    for cand in (f"{name}_0.asset", f"{name}.asset"):
        p = os.path.join(UNITY, "Sprite", cand)
        if os.path.exists(p):
            return p
    return None

def num(txt, key):
    return float(re.search(rf"\b{key}: ([-0-9.e]+)", txt).group(1))

def cut(name, group, out_name=None):
    p = sprite_asset(name)
    if not p:
        print("MISSING sprite", name); return False
    txt = open(p, encoding="utf-8", errors="ignore").read()
    rect = txt[txt.index("m_Rect:"):]
    x, y, w, h = num(rect, "x"), num(rect, "y"), num(rect, "width"), num(rect, "height")
    guid = re.search(r"texture: \{fileID: \d+, guid: ([0-9a-f]+)", txt).group(1)
    png = guid_to_png(guid)
    if not png:
        print("MISSING texture", name, guid); return False
    img = Image.open(png).convert("RGBA")
    H = img.size[1]
    box = (round(x), round(H - y - h), round(x + w), round(H - y))
    os.makedirs(os.path.join(OUT, group), exist_ok=True)
    dst = os.path.join(OUT, group, (out_name or name) + ".png")
    img.crop(box).save(dst)
    print("ok", name, "->", os.path.relpath(dst, OUT), box)
    return True

def region0_list(script_field):
    """Return sprite guids listed in the region-0 SO (0_France_*.asset) for a field."""
    res = []
    for p in glob.glob(os.path.join(UNITY, "MonoBehaviour", "0_France*.asset")):
        txt = open(p, encoding="utf-8", errors="ignore").read()
        if script_field in txt:
            res = re.findall(rf"{script_field}: \{{fileID: \d+, guid: ([0-9a-f]+)", txt)
    return res

def sprite_name_from_guid(guid):
    for meta in glob.glob(os.path.join(UNITY, "Sprite", "*.asset.meta")):
        with open(meta, encoding="utf-8", errors="ignore") as f:
            if guid in f.read(200):
                txt = open(meta[:-5], encoding="utf-8", errors="ignore").read()
                return os.path.basename(meta[:-5])[:-6], re.search(r"m_Name: (.+)", txt).group(1).strip()
    return None, None

if __name__ == "__main__":
    # Drinks: index in tileDatas == drink ID used by the level JSON.
    for i, g in enumerate(region0_list("spriteTile")):
        asset, _ = sprite_name_from_guid(g)
        cut(asset[:-2] if asset.endswith("_0") else asset, "drinks", f"drink_{i}")
    # Customers: index == customer appearance id.
    for i, g in enumerate(region0_list("spriteNormal")):
        asset, _ = sprite_name_from_guid(g)
        if asset:
            cut(asset[:-2] if asset.endswith("_0") else asset, "customers", f"customer_{i}")
    for n in ["card", "mail_4c", "Tray_Active", "Tray_Unactive", "Table", "btn_magnet", "btn_swap",
              "ellipse_booster", "shadowBG_booster", "lock", "bubble_chat", "France_Gameplay",
              "level_complete_popup", "fail_popup", "btn_play_on", "btn_grey", "icon_check_mark"]:
        cut(n, "ui")

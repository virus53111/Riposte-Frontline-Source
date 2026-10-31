#!/usr/bin/env python3
"""Prepare IRON SHIFT visual identity using the approved user brand-art assets.

Source files and game logic on main are unchanged. Run BEFORE upstream build.py.
Requires Pillow. The compressed source artwork in branding/ was prepared from
the approved IRON SHIFT logo + icon and is solely used for preview packaging.
"""
import base64
import io
from pathlib import Path
from PIL import Image, ImageOps, ImageDraw

ROOT = Path(__file__).resolve().parent.parent
def text(p): return (ROOT/p).read_text(encoding="utf-8")
def put(p,s): (ROOT/p).write_text(s,encoding="utf-8")
def read_art(p):
    raw=base64.b64decode(text("branding/"+p).strip(),validate=True)
    img=Image.open(io.BytesIO(raw))
    img.load()
    return img.convert("RGBA")

def card(bg,logo,w,h):
    canvas=ImageOps.fit(bg.convert("RGB"),(w,h),Image.Resampling.LANCZOS,centering=(0.55,0.47)).convert("RGBA")
    veil=Image.new("RGBA",(w,h),(5,8,11,145));canvas.alpha_composite(veil)
    lw=int(w*0.72)
    tile=logo.copy();tile.thumbnail((lw,int(h*0.64)),Image.Resampling.LANCZOS)
    x=(w-tile.width)//2;y=(h-tile.height)//2
    canvas.alpha_composite(tile,(x,y))
    return canvas.convert("RGB")

logo=read_art("iron-shift-logo.webp.base64")
icon=read_art("iron-shift-icon.webp.base64")
(ROOT/"assets/logo.webp").write_bytes(base64.b64decode(text("branding/iron-shift-logo.webp.base64").strip()))
icondir=ROOT/"assets/icon";icondir.mkdir(exist_ok=True)
for name,sz in (("favicon-64",64),("favicon-96",96),("apple-touch-icon",180),
                ("icon-192",192),("icon-512",512),("maskable-192",192),("maskable-512",512)):
    tile=icon.resize((sz,sz),Image.Resampling.LANCZOS)
    if name.startswith("maskable"):
        base=Image.new("RGBA",(sz,sz),(10,12,17,255))
        tile=icon.resize((int(sz*0.81),int(sz*0.81)),Image.Resampling.LANCZOS)
        base.alpha_composite(tile,((sz-tile.width)//2,(sz-tile.height)//2))
        tile=base
    tile.save(icondir/(name+".png"),optimize=True)
icon.resize((64,64),Image.Resampling.LANCZOS).save(icondir/"favicon.ico",
    format="ICO",sizes=[(16,16),(32,32),(48,48),(64,64)])

bg=Image.open(ROOT/"assets/menu-bg.webp").convert("RGBA")
card(bg,logo,1200,630).save(ROOT/"assets/apercu.jpg",quality=90,subsampling=0,optimize=True)
# Replace branded Steam Deck shortcut pictures so no original logo remains.
for filename in ("jaquette.jpg","capsule.jpg","hero.jpg","logo.png","icone.png"):
    dst=ROOT/"assets/deck"/filename
    if not dst.exists(): continue
    original=Image.open(dst); w,h=original.size
    if filename in ("logo.png","icone.png"):
        img=logo if filename=="logo.png" else icon
        layer=Image.new("RGBA",(w,h),(0,0,0,0))
        im=img.copy();im.thumbnail((w,h),Image.Resampling.LANCZOS)
        layer.alpha_composite(im,((w-im.width)//2,(h-im.height)//2))
        layer.save(dst)
    else:
        card(bg,logo,w,h).save(dst,quality=89)
# Disable original game's separate Steam Deck installer in this preview:
put("assets/deck/installer.sh", "#!/bin/sh\necho 'IRON SHIFT preview: Steam Deck installer is not available yet.'\nexit 1\n")

# Only user-facing title/metadata strings; game rules and gameplay are never edited.
rename=(("Riposte: Frontline","IRON SHIFT"),("Riposte Frontline","IRON SHIFT"),
        ("RIPOSTE FRONTLINE","IRON SHIFT"),("RIPOSTE: FRONTLINE","IRON SHIFT"))
paths=[ROOT/"shell.html"]+sorted((ROOT/"src").glob("*.js"))+sorted((ROOT/"i18n").glob("*.txt"))
for path in paths:
    data=path.read_text(encoding="utf-8")
    for before,after in rename: data=data.replace(before,after)
    if path.name=="shell.html":
        data=data.replace('<meta name="apple-mobile-web-app-title" content="Riposte">','<meta name="apple-mobile-web-app-title" content="IRON SHIFT">')
        data=data.replace('"alternateName": ["IRON SHIFT", "Riposte"]','"alternateName": ["IRON SHIFT"]')
        data=data.replace('aspect-ratio: 1000 / 230; background: var(--logo)',
                          'aspect-ratio: 3 / 1; background: var(--logo)')
        data=data.replace('--xp: #F6C445; --acc: var(--xp); --acc-hi: #FFD76A; --acc-ink: #141005; --acc-soft: rgba(246,196,69,.14); --acc-line: rgba(246,196,69,.55);',
                          '--xp: #FF842C; --acc: var(--xp); --acc-hi: #FFAD67; --acc-ink: #180B04; --acc-soft: rgba(255,132,44,.14); --acc-line: rgba(255,132,44,.55);')
        data=data.replace('<meta name="google-site-verification" content="gIuJU_6bUl6fEssvTUEoHr2NDUONA5ir-w5quer8q3c">','')
        data=data.replace('<meta name="theme-color" content="#0E110D">','<meta name="theme-color" content="#0A0C11">')
        data=data.replace('<title>IRON SHIFT, FPS gratuit dans le navigateur</title>','<title>IRON SHIFT, Tactical Shooter</title>')
        data=data.replace('<meta property="og:site_name" content="IRON SHIFT">','<meta property="og:site_name" content="IRON SHIFT">')
        # Preview disclaimer: not affiliated with the original author.
        data=data.replace('</body>',
          '<aside style="position:fixed;bottom:3px;left:9px;z-index:99;pointer-events:none;'
          'font:11px Arial,sans-serif;color:#aaa8;letter-spacing:.02em">Non-commercial preview · Based on MIT-licensed Riposte: Frontline source</aside>\n</body>')
    if path.name=="09t-social.js":
        data=data.replace("b.classList.toggle('hidden', !on);", "b.classList.toggle('hidden', !on || id !== 'rankBtn');")
    if path.name=="09k-legal.js":
        data=data.replace("[région de la base Neon : Francfort recommandée]", "Render Postgres, Frankfurt (temporary beta)")
        data=data.replace("hébergé par Hetzner, en Allemagne", "connexion directe entre navigateurs, WebRTC")
    if data!=path.read_text(encoding="utf-8"):path.write_text(data,encoding="utf-8")

bp=ROOT/"build.py"
s=bp.read_text(encoding="utf-8")
s=s.replace('SITE="https://www.playriposte.com"','SITE="https://iron-shift-accounts-preview.onrender.com"')
s=s.replace('"name":"Riposte: Frontline","short_name":"Riposte"','"name":"IRON SHIFT","short_name":"IRON SHIFT"')
s=s.replace('"background_color":"#0E110D","theme_color":"#0E110D"','"background_color":"#0A0C11","theme_color":"#0A0C11"')
bp.write_text(s,encoding="utf-8")
print("IRON SHIFT artwork, browser icons, launch graphics, title & metadata prepared; gameplay unchanged.",flush=True)

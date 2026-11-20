#!/usr/bin/env python3
"""Baut MöbelFit aus src/ zu einer einzigen HTML-Datei.

  python3 build.py                 -> index.html (eigenständig, ohne Fotos)
  python3 build.py --photos DIR    -> zusätzlich Fotos (DIR/*.webp) eingebettet
  python3 build.py --fragment OUT  -> Seiteninhalt ohne <html>/<head>/<body> (für Artifact-Hosting)
"""
import argparse
import base64
import pathlib

ROOT = pathlib.Path(__file__).resolve().parent
SRC = ROOT / "src"
FONTS = ('<link rel="preconnect" href="https://fonts.googleapis.com">'
         '<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>'
         '<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Big+Shoulders+Display:wght@700;800;900'
         '&family=DM+Sans:opsz,wght@9..40,400;9..40,500;9..40,600;9..40,700&display=swap">')


def photos_script(folder):
    if not folder:
        return ""
    items = []
    for p in sorted(pathlib.Path(folder).glob("*.webp")):
        if p.stem.startswith("_"):
            continue
        b64 = base64.b64encode(p.read_bytes()).decode()
        items.append(f'"{p.stem}":"data:image/webp;base64,{b64}"')
    return "<script>window.HOME_PHOTOS={" + ",".join(items) + "};</script>"


def page_body(photos):
    css = (SRC / "styles.css").read_text()
    shell = (SRC / "shell.html").read_text()
    js = "\n".join((SRC / f).read_text() for f in ("figure.js", "data.js", "app.js"))
    return (
        '<title>MöbelFit</title>\n'
        '<meta name="claude:viewport-fit-sides" content="cover">\n'
        '<meta name="description" content="Fitness-App für zu Hause: deine Möbel als Trainingsgeräte, mit Video-Workouts.">\n'
        f"{FONTS}\n<style>\n{css}\n</style>\n{shell}\n{photos_script(photos)}\n<script>\n{js}\n</script>\n"
    )


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--photos")
    ap.add_argument("--fragment")
    ap.add_argument("--out", default=str(ROOT / "index.html"))
    a = ap.parse_args()
    body = page_body(a.photos)
    if a.fragment:
        pathlib.Path(a.fragment).write_text(body)
        print("fragment ->", a.fragment)
        return
    doc = ('<!doctype html>\n<html lang="de">\n<head>\n<meta charset="utf-8">\n'
           '<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">\n'
           '<meta name="theme-color" content="#C8322D">\n'
           '<style>:root{padding-top:env(safe-area-inset-top,0px);padding-bottom:env(safe-area-inset-bottom,0px)}body{margin:0}img{max-width:100%}[hidden]{display:none!important}</style>\n'
           '</head>\n<body>\n' + body + '</body>\n</html>\n')
    pathlib.Path(a.out).write_text(doc)
    print("index ->", a.out, f"({len(doc) // 1024} KB)")


if __name__ == "__main__":
    main()

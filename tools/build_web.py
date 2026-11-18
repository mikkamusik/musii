"""Bundles the app (assets/www) into one self-contained HTML file for the browser version.

Usage: python3 tools/build_web.py <output.html>
"""
import pathlib, re, sys

root = pathlib.Path(__file__).resolve().parent.parent / "app/src/main/assets/www"
html = (root / "index.html").read_text()
css = (root / "css/style.css").read_text()
scripts = re.findall(r'<script src="(js/[^"]+)"></script>', html)
js = "\n".join((root / s).read_text() for s in scripts)
boot = re.search(r"<style>.*?</script>", html, re.S).group(0)  # loading screen + error handler

css = css.replace("#app { display: flex; flex-direction: column; height: 100vh; height: 100dvh; }",
                  "#app { display: flex; flex-direction: column; height: 100%; }")
css += """
/* browser version: side gutter that clears system bars */
body { padding-left: max(16px, env(safe-area-inset-left, 0px)); padding-right: max(16px, env(safe-area-inset-right, 0px)); }
"""
assert "</script" not in js.replace("</script>", "")
out = f"""<title>Musii</title>
<meta name="claude:viewport-fit-sides" content="cover">
<style>
{css}
</style>
{boot}
<div id="boot"><b>musii</b><div>Lädt …</div></div>
<div id="app">
  <header id="topbar"></header>
  <main id="main"></main>
  <section id="panel"><div id="panelTabs"></div><div id="panelBody"></div></section>
</div>
<script>window.MUSII_WEB = true;</script>
<script>
{js}
</script>
"""
pathlib.Path(sys.argv[1]).write_text(out)
print("wrote", sys.argv[1], len(out), "bytes")

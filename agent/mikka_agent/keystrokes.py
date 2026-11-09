"""
Ausdruecklich gekennzeichnete Fernbedienungsmethode: Tastaturkuerzel an Ableton.

Fuer Vorgaenge, die das Live Object Model NICHT anbietet (Speichern, Speichern
unter, Export-Dialog), sendet der Agent ueber AppleScript/System Events ein
Tastaturkuerzel an Ableton Live. Voraussetzungen:
  - "allow_keystrokes": true in ~/.mikka-studio/config.json
  - macOS: Systemeinstellungen > Sicherheit > Bedienungshilfen fuer das Terminal
    bzw. Python freigeben.
Das Ergebnis wird von Ableton NICHT bestaetigt - die App zeigt das so an.
"""
from __future__ import annotations

import subprocess
import sys
from typing import Dict

SHORTCUTS: Dict[str, Dict[str, str]] = {
    "save": {"key": "s", "mods": "command down", "label": "Speichern (Cmd+S)"},
    "save_as": {"key": "s", "mods": "{command down, shift down}", "label": "Speichern unter (Cmd+Shift+S)"},
    "export_audio": {"key": "r", "mods": "{command down, shift down}",
                     "label": "Audio/Video exportieren - Dialog (Cmd+Shift+R)"},
    "toggle_view": {"key": "\t", "mods": "", "label": "Session/Arrangement wechseln (Tab)"},
}


class KeystrokeError(Exception):
    pass


def build_script(name: str) -> str:
    sc = SHORTCUTS[name]
    key = '"%s"' % sc["key"] if sc["key"] != "\t" else "tab"
    using = (" using %s" % sc["mods"]) if sc["mods"] else ""
    return ('tell application id "com.ableton.live" to activate\n'
            'delay 0.3\n'
            'tell application "System Events" to keystroke %s%s' % (key, using))


def send(name: str, allowed: bool) -> str:
    if not allowed:
        raise KeystrokeError("Tastaturkuerzel sind deaktiviert (allow_keystrokes=false).")
    if name not in SHORTCUTS:
        raise KeystrokeError("Unbekanntes Kuerzel")
    if sys.platform != "darwin":
        raise KeystrokeError("Nur auf macOS verfuegbar")
    proc = subprocess.run(["osascript", "-e", build_script(name)], stdout=subprocess.PIPE,
                          stderr=subprocess.PIPE, timeout=10)
    if proc.returncode != 0:
        raise KeystrokeError("AppleScript-Fehler (Bedienungshilfen-Freigabe?): %s"
                             % proc.stderr.decode("utf-8", "replace").strip())
    return SHORTCUTS[name]["label"]

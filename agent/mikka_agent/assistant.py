"""
AI Studio Engineer - Stufe 1: deterministische deutsche Befehlsinterpretation.

Diese Version uebersetzt klar formulierte Befehle in konkrete, ueberpruefbare
Ableton-Befehle. Jede Aktion wird erst als Plan angezeigt, Ableton bestaetigt
jede Aenderung durch Rueckmeldung des tatsaechlich gesetzten Werts.

Kreative/klangliche Anweisungen ("Mach die Kick druckvoller") erfordern Audio-
analyse pro Spur und ein Sprachmodell. Sie werden ehrlich als "noch nicht
implementiert" beantwortet, statt eine Wirkung vorzutaeuschen.
"""
from __future__ import annotations

import re
import unicodedata
from typing import Any, Dict, List, Optional, Tuple

ALIASES = {
    "kick": ["kick", "bassdrum", "bd", "bass drum"],
    "hihat": ["hihat", "hi-hat", "hi-hats", "hihats", "hi hat", "hats", "hh"],
    "snare": ["snare", "sd"],
    "clap": ["clap", "claps"],
    "perc": ["percussion", "perc", "percs", "perkussion"],
    "bass": ["bass", "rumble", "sub", "subbass"],
    "synth": ["synth", "synthesizer", "lead", "sequenz", "sequence"],
    "pad": ["pad", "pads", "flaeche"],
    "vocal": ["vocal", "vocals", "vox", "stimme", "gesang"],
    "fx": ["fx", "effekte", "transition", "transitions"],
    "violin": ["violin", "geige", "violine"],
    "harmony": ["harmony", "harmonie"],
    "drums": ["drums", "drum", "schlagzeug"],
}

UNSUPPORTED_HINTS = [
    (("druckvoll", "punch", "fetter", "waermer", "brillanter", "trockener", "trocken",
      "hypnotisch", "trippig", "break", "groove", "automation", "mastering",
      "optimiere", "mix ", "mixing", "resonanz", "stoerend", "frequenz", "rumble hinzu"),
     "Klangliche und kompositorische Anweisungen erfordern eine Audioanalyse je Spur und "
     "ein Sprachmodell. Das ist in dieser Version noch nicht implementiert. Ich nehme keine "
     "Aenderung vor. Moeglich sind bereits: Tempo, Transport, Metronom, Loop, Lautstaerke "
     "(z.B. 'Hi-Hats 2 dB leiser'), Mute/Solo, Rueckgaengig und 'Analysiere meinen Track'."),
]


def norm(text: str) -> str:
    text = text.lower()
    text = text.replace("ä", "ae").replace("ö", "oe").replace("ü", "ue").replace("ß", "ss")
    text = unicodedata.normalize("NFKD", text)
    return "".join(c for c in text if not unicodedata.combining(c))


def _num(s: str) -> float:
    return float(s.replace(",", "."))


def parse_db(text: Optional[str]) -> Optional[float]:
    if not text:
        return None
    m = re.search(r"(-?inf|[-+]?\d+(?:[.,]\d+)?)\s*dB", text, re.I)
    if not m:
        return None
    if m.group(1).lower() == "-inf":
        return float("-inf")
    return _num(m.group(1))


def _all_tracks(state: Dict[str, Any]) -> List[Dict[str, Any]]:
    tracks = state.get("tracks") or {}
    result = list(tracks.get("tracks") or []) + list(tracks.get("returns") or [])
    if tracks.get("master"):
        result.append(tracks["master"])
    return result


def ref_of(track: Dict[str, Any]) -> Dict[str, Any]:
    ref = {"kind": track["kind"], "index": track.get("index", 0)}
    if track["kind"] != "master":
        ref["name"] = track["name"]
    return ref


def match_tracks(text: str, state: Dict[str, Any]) -> List[Dict[str, Any]]:
    """Findet Spuren, die im Text erwaehnt werden (Name oder Instrumenten-Alias)."""
    t = norm(text)
    words = set(re.findall(r"[a-z0-9\-]+", t)) | set(re.findall(r"[a-z0-9]+", t))
    tracks = _all_tracks(state)
    found: List[Dict[str, Any]] = []
    if re.search(r"\b(master|summe|masterkanal)\b", t):
        found += [tr for tr in tracks if tr["kind"] == "master"]
    # 1) Exakter Spurname im Text
    for tr in tracks:
        name = norm(tr["name"]).strip()
        if tr["kind"] != "master" and len(name) >= 3 and name in t and tr not in found:
            found.append(tr)
    if found:
        return found
    # 2) Alias-Gruppen
    for group, aliases in ALIASES.items():
        hit = any((" " in a and a in t) or a in words for a in aliases)
        if not hit:
            continue
        for tr in tracks:
            if tr["kind"] == "master":
                continue
            tn = norm(tr["name"])
            tn_words = set(re.findall(r"[a-z0-9]+", tn.replace("-", "")))
            if group == "bass" and ("bassdrum" in tn or "bass drum" in tn):
                continue
            if any((" " in a and a in tn) or a.replace("-", "") in tn_words for a in aliases):
                if tr not in found:
                    found.append(tr)
    return found


def _action(cmd: str, args: Dict[str, Any], label: str) -> Dict[str, Any]:
    return {"cmd": cmd, "args": args, "label": label}


def plan(text: str, state: Dict[str, Any]) -> Dict[str, Any]:
    t = norm(text).strip()
    song = state.get("song") or {}
    result: Dict[str, Any] = {"input": text, "actions": [], "revert": [], "destructive": False,
                              "requires_confirmation": True, "unsupported": False, "message": ""}
    if not t:
        result.update(unsupported=True, message="Bitte einen Befehl eingeben.")
        return result
    connected = bool(song)

    def need_live() -> bool:
        if not connected:
            result.update(unsupported=True, message="Ableton ist nicht verbunden.")
            return False
        return True

    # Analyse ---------------------------------------------------------------
    if re.search(r"\b(analysiere|analyse|messe|miss|lufs|lautheit)\b", t):
        result["actions"].append(_action("exports.analyze_latest", {},
                                         "Neueste Exportdatei mit ffmpeg messen (LUFS, True Peak, RMS, LRA)"))
        result["requires_confirmation"] = False
        result["message"] = ("Analysiere die neueste Datei im Exportordner. Hinweis: Gemessen wird "
                             "eine von Ableton gerenderte Datei - bitte vorher exportieren.")
        return result

    # Rueckgaengig -----------------------------------------------------------
    if re.search(r"\b(rueckgaengig|undo)\b", t):
        if not need_live():
            return result
        result["actions"].append(_action("song.undo", {}, "Letzte Aktion in Ableton rueckgaengig machen"))
        result["destructive"] = True
        result["message"] = "Macht den letzten Schritt in Ableton rueckgaengig."
        return result

    # Speichern (Tastaturkuerzel) --------------------------------------------
    if re.search(r"\b(speicher|speichere|speichern|save)\b", t):
        result["actions"].append(_action("keys.send", {"shortcut": "save"},
                                         "Projekt speichern per Cmd+S (Tastaturkuerzel-Fernbedienung)"))
        result["message"] = ("Speichern ist nicht ueber die Live-API verfuegbar und wird per "
                             "Tastaturkuerzel ausgeloest (nicht von Ableton bestaetigt).")
        return result

    # Klangliche Anweisungen: ehrlich ablehnen (Spurnamen vorher entfernen,
    # damit z.B. "VIOLIN - BREAKS" nicht als "break" gewertet wird).
    t_free = t
    for tr in _all_tracks(state):
        t_free = t_free.replace(norm(tr["name"]), " ")
    for keywords, message in UNSUPPORTED_HINTS:
        if any(k in t_free for k in keywords):
            result.update(unsupported=True, message=message)
            return result

    # Tempo -----------------------------------------------------------------
    m = re.search(r"(\d{2,3}(?:[.,]\d+)?)\s*bpm", t) or \
        re.search(r"tempo\s*(?:auf|=|zu|:)?\s*(\d{2,3}(?:[.,]\d+)?)", t)
    rel = re.search(r"(?:um\s*)?(\d{1,2}(?:[.,]\d+)?)\s*bpm\s*(schneller|langsamer|hoeher|niedriger)", t) or \
        re.search(r"(schneller|langsamer)\s*um\s*(\d{1,2}(?:[.,]\d+)?)", t)
    if rel or m:
        if not need_live():
            return result
        current = float(song.get("tempo", 120))
        if rel:
            g = rel.groups()
            amount, direction = (g[0], g[1]) if g[0][0].isdigit() else (g[1], g[0])
            sign = -1 if direction in ("langsamer", "niedriger") else 1
            target = current + sign * _num(amount)
        else:
            target = _num(m.group(1))
        if not 20 <= target <= 999:
            result.update(unsupported=True, message="Tempo muss zwischen 20 und 999 BPM liegen.")
            return result
        target = round(target, 2)
        result["actions"].append(_action("song.set", {"tempo": target},
                                         "Tempo: %.2f -> %.2f BPM" % (current, target)))
        result["revert"].append(_action("song.set", {"tempo": current}, "Tempo zurueck auf %.2f BPM" % current))
        result["requires_confirmation"] = False
        result["message"] = "Setze das Tempo auf %.2f BPM." % target
        if 130 <= target <= 160:
            result["message"] += " (Im typischen Bereich des Techno-Modus.)"
        return result

    # Metronom / Loop --------------------------------------------------------
    onoff = None
    if re.search(r"\b(an|ein|einschalten|aktivieren|aktiviere|on)\b", t):
        onoff = True
    if re.search(r"\b(aus|ausschalten|deaktivieren|deaktiviere|off)\b", t):
        onoff = False
    if re.search(r"\b(metronom|klick|click)\b", t):
        if not need_live():
            return result
        value = (not song.get("metronome")) if onoff is None else onoff
        result["actions"].append(_action("song.set", {"metronome": value},
                                         "Metronom %s" % ("an" if value else "aus")))
        result["requires_confirmation"] = False
        result["message"] = "Metronom %s." % ("einschalten" if value else "ausschalten")
        return result
    if re.search(r"\b(loop|schleife)\b", t) and not match_tracks(text, state):
        if not need_live():
            return result
        value = (not song.get("loop")) if onoff is None else onoff
        result["actions"].append(_action("song.set", {"loop": value}, "Arrangement-Loop %s" % ("an" if value else "aus")))
        result["requires_confirmation"] = False
        result["message"] = "Loop %s." % ("einschalten" if value else "ausschalten")
        return result

    # Szenen -----------------------------------------------------------------
    m = re.search(r"szene\s*(\d{1,3})", t)
    if m and re.search(r"\b(start|starte|spiel|spiele|feuer|launch)\b", t):
        if not need_live():
            return result
        idx = int(m.group(1)) - 1
        if idx < 0 or idx >= len(state.get("scenes") or []):
            result.update(unsupported=True, message="Szene %s existiert nicht." % m.group(1))
            return result
        result["actions"].append(_action("scene.fire", {"scene": idx}, "Szene %d starten" % (idx + 1)))
        result["requires_confirmation"] = False
        result["message"] = "Starte Szene %d." % (idx + 1)
        return result

    tracks = match_tracks(text, state)

    # Lautstaerke -----------------------------------------------------------
    louder = re.search(r"\b(lauter|zu leise|anheben|hoch)\b", t)
    quieter = re.search(r"\b(leiser|zu laut|absenken|runter|reduzier\w*)\b", t)
    absolute = re.search(r"\bauf\s*([-+]?\d+(?:[.,]\d+)?)\s*db\b", t)
    if tracks and (louder or quieter or absolute):
        if not need_live():
            return result
        m = re.search(r"(?:um\s*)?(\d+(?:[.,]\d+)?)\s*db", t)
        amount = _num(m.group(1)) if (m and not absolute) else 2.0
        if amount > 12:
            result.update(unsupported=True, message="Aenderungen ueber 12 dB werden aus Sicherheitsgruenden "
                                                    "nicht automatisch ausgefuehrt.")
            return result
        for tr in tracks:
            before = parse_db(tr.get("volume_str"))
            if absolute:
                target = _num(absolute.group(1))
            else:
                if before is None or before == float("-inf"):
                    result["message"] += "Spur '%s': aktueller Pegel unbekannt, uebersprungen. " % tr["name"]
                    continue
                target = before + (amount if louder and not quieter else -amount)
            target = min(6.0, round(target, 2))
            result["actions"].append(_action(
                "track.set_volume_db", {"track": ref_of(tr), "db": target},
                "%s: %s -> %.1f dB" % (tr["name"], tr.get("volume_str", "?"), target)))
            result["revert"].append(_action("track.set", {"track": ref_of(tr), "volume": tr.get("volume")},
                                            "%s zurueck auf %s" % (tr["name"], tr.get("volume_str", "?"))))
        result["destructive"] = any(tr["kind"] == "master" for tr in tracks)
        result["requires_confirmation"] = True
        if result["actions"]:
            result["message"] += "Lautstaerke von %d Spur(en) anpassen." % len(result["actions"])
        return result

    # Mute / Solo / Arm ------------------------------------------------------
    flag: Optional[Tuple[str, bool]] = None
    if re.search(r"\b(unmute|stummschaltung aufheben|nicht mehr stumm|entstumm\w*)\b", t):
        flag = ("mute", False)
    elif re.search(r"\b(mute|stumm|muten|stummschalten)\b", t):
        flag = ("mute", onoff is not False)
    elif re.search(r"\bsolo\b", t):
        flag = ("solo", onoff is not False)
    elif re.search(r"\b(arm|scharf|aufnahmebereit)\w*", t):
        flag = ("arm", onoff is not False)
    if flag and tracks:
        if not need_live():
            return result
        key, value = flag
        names = {"mute": "Stumm", "solo": "Solo", "arm": "Aufnahmebereit"}
        for tr in tracks:
            if tr["kind"] == "master" or (key == "arm" and not tr.get("can_arm")):
                continue
            result["actions"].append(_action("track.set", {"track": ref_of(tr), key: value},
                                             "%s: %s %s" % (tr["name"], names[key], "an" if value else "aus")))
            result["revert"].append(_action("track.set", {"track": ref_of(tr), key: bool(tr.get(key))},
                                            "%s: %s wiederherstellen" % (tr["name"], names[key])))
        result["requires_confirmation"] = len(result["actions"]) > 1
        result["message"] = "%s fuer %d Spur(en)." % (names[key], len(result["actions"]))
        return result

    # Transport --------------------------------------------------------------
    if re.search(r"\b(stop|stopp|stoppe|anhalten|halt)\b", t):
        if not need_live():
            return result
        result["actions"].append(_action("transport.stop", {}, "Wiedergabe stoppen"))
        result["requires_confirmation"] = False
        result["message"] = "Stoppe die Wiedergabe."
        return result
    if re.search(r"\b(play|start|starte|abspielen|spiel|spiele|wiedergabe)\b", t):
        if not need_live():
            return result
        result["actions"].append(_action("transport.play", {}, "Wiedergabe starten"))
        result["requires_confirmation"] = False
        result["message"] = "Starte die Wiedergabe."
        return result

    if tracks:
        result.update(unsupported=True, message="Spur(en) erkannt (%s), aber keine ausfuehrbare Aktion. "
                      "Beispiele: 'leiser', 'um 3 dB lauter', 'stumm', 'solo'."
                      % ", ".join(tr["name"] for tr in tracks))
        return result
    result.update(unsupported=True, message="Diesen Befehl verstehe ich noch nicht. Beispiele: "
                  "'Stelle das Projekt auf 145 BPM', 'Die Hi-Hats sind zu laut', 'Kick stumm', "
                  "'Metronom an', 'Starte Szene 2', 'Analysiere meinen Track'.")
    return result

"""
Authentifizierung: Geraetekopplung, Geraete-Token, Widerruf, Einmal-Tickets.

- Kopplung: Am Mac wird mit `mikka pair` ein 6-stelliger Einmal-Code erzeugt
  (5 Minuten gueltig, max. 5 Fehlversuche). Nur wer Zugriff auf den Mac hat,
  kann also ein neues Geraet freigeben.
- Das Smartphone erhaelt dafuer ein zufaelliges Geraete-Token (256 Bit).
  Gespeichert wird nur dessen SHA-256-Hash.
- Tickets: kurzlebige Einmal-Token fuer Audio-Stream und Downloads, damit das
  Geraete-Token nie in einer URL landet.
"""
from __future__ import annotations

import hashlib
import hmac
import json
import os
import secrets
import threading
import time
from pathlib import Path
from typing import Any, Dict, List, Optional

PAIRING_TTL = 300
PAIRING_MAX_FAILURES = 5


def _hash(value: str) -> str:
    return hashlib.sha256(value.encode("utf-8")).hexdigest()


def _write_private(path: Path, data: Any) -> None:
    tmp = path.with_suffix(path.suffix + ".tmp")
    fd = os.open(str(tmp), os.O_WRONLY | os.O_CREAT | os.O_TRUNC, 0o600)
    with os.fdopen(fd, "w") as fh:
        json.dump(data, fh, indent=2, ensure_ascii=False)
    tmp.replace(path)


class PairingManager:
    """Einmal-Kopplungscodes. Datei-basiert, damit die CLI Codes fuer den
    laufenden Agent erzeugen kann."""

    def __init__(self, home: Path):
        self.path = home / "pairing.json"
        self._lock = threading.Lock()

    def create_code(self) -> str:
        code = "%06d" % secrets.randbelow(1000000)
        with self._lock:
            _write_private(self.path, {"code_hash": _hash(code),
                                       "expires": time.time() + PAIRING_TTL,
                                       "failures": 0})
        return code

    def _load(self) -> Optional[Dict[str, Any]]:
        try:
            return json.loads(self.path.read_text())
        except (OSError, ValueError):
            return None

    def has_active_code(self) -> bool:
        data = self._load()
        return bool(data and data.get("expires", 0) > time.time())

    def consume(self, code: str) -> bool:
        with self._lock:
            data = self._load()
            if not data or data.get("expires", 0) < time.time():
                return False
            if not isinstance(code, str) or not code.isdigit() or len(code) != 6:
                ok = False
            else:
                ok = hmac.compare_digest(_hash(code), data.get("code_hash", ""))
            if ok:
                try:
                    self.path.unlink()
                except OSError:
                    pass
                return True
            data["failures"] = int(data.get("failures", 0)) + 1
            if data["failures"] >= PAIRING_MAX_FAILURES:
                try:
                    self.path.unlink()
                except OSError:
                    pass
            else:
                _write_private(self.path, data)
            return False


class DeviceStore:
    def __init__(self, home: Path, inactivity_days: int = 30):
        self.path = home / "devices.json"
        self.inactivity = inactivity_days * 86400
        self._lock = threading.Lock()
        self._devices: List[Dict[str, Any]] = []
        self._last_persist = 0.0
        self._mtime = None
        self._load()

    def _file_mtime(self):
        try:
            return self.path.stat().st_mtime_ns
        except OSError:
            return None

    def _load(self) -> None:
        try:
            data = json.loads(self.path.read_text())
            self._devices = data.get("devices", [])
        except (OSError, ValueError):
            self._devices = []
        self._mtime = self._file_mtime()

    def _maybe_reload(self) -> None:
        """Aenderungen durch die CLI (z.B. `mikka revoke`) sofort uebernehmen."""
        if self._file_mtime() != self._mtime:
            self._load()

    def _persist(self) -> None:
        _write_private(self.path, {"devices": self._devices})
        self._last_persist = time.time()
        self._mtime = self._file_mtime()

    def register(self, name: str) -> Dict[str, str]:
        token = secrets.token_urlsafe(32)
        device_id = secrets.token_hex(6)
        name = (name or "Smartphone").strip()[:64] or "Smartphone"
        now = time.time()
        with self._lock:
            self._maybe_reload()
            self._devices.append({"id": device_id, "name": name, "token_hash": _hash(token),
                                  "created": now, "last_seen": now, "revoked": False})
            self._persist()
        return {"device_id": device_id, "token": token, "name": name}

    def verify(self, token: Any) -> Optional[Dict[str, Any]]:
        if not isinstance(token, str) or len(token) < 20:
            return None
        th = _hash(token)
        now = time.time()
        with self._lock:
            self._maybe_reload()
            for dev in self._devices:
                if hmac.compare_digest(dev["token_hash"], th):
                    if dev.get("revoked"):
                        return None
                    if self.inactivity and now - dev.get("last_seen", 0) > self.inactivity:
                        dev["revoked"] = True
                        dev["revoked_reason"] = "inaktiv"
                        self._persist()
                        return None
                    dev["last_seen"] = now
                    if now - self._last_persist > 60:
                        self._persist()
                    return dict(dev)
        return None

    def is_active(self, device_id: str) -> bool:
        with self._lock:
            self._maybe_reload()
            return any(d["id"] == device_id and not d.get("revoked") for d in self._devices)

    def list(self) -> List[Dict[str, Any]]:
        with self._lock:
            self._maybe_reload()
            return [{k: v for k, v in d.items() if k != "token_hash"} for d in self._devices]

    def revoke(self, device_id: str) -> bool:
        with self._lock:
            self._maybe_reload()
            for dev in self._devices:
                if dev["id"] == device_id and not dev.get("revoked"):
                    dev["revoked"] = True
                    dev["revoked_reason"] = "widerrufen"
                    self._persist()
                    return True
        return False


class TicketStore:
    """Kurzlebige Einmal-Tickets (im Speicher)."""

    def __init__(self):
        self._tickets: Dict[str, Dict[str, Any]] = {}
        self._lock = threading.Lock()

    def issue(self, device_id: str, purpose: str, payload: Any = None, ttl: float = 60) -> str:
        ticket = secrets.token_urlsafe(24)
        now = time.time()
        with self._lock:
            for key in [k for k, v in self._tickets.items() if v["expires"] < now]:
                del self._tickets[key]
            self._tickets[ticket] = {"device_id": device_id, "purpose": purpose,
                                     "payload": payload, "expires": now + ttl}
        return ticket

    def consume(self, ticket: Any, purpose: str) -> Optional[Dict[str, Any]]:
        if not isinstance(ticket, str):
            return None
        with self._lock:
            item = self._tickets.pop(ticket, None)
        if not item or item["expires"] < time.time() or item["purpose"] != purpose:
            return None
        return item


class RateLimiter:
    def __init__(self, limit: int, window: float):
        self.limit = limit
        self.window = window
        self._hits: Dict[str, List[float]] = {}

    def allow(self, key: str) -> bool:
        now = time.time()
        hits = [t for t in self._hits.get(key, []) if now - t < self.window]
        allowed = len(hits) < self.limit
        if allowed:
            hits.append(now)
        self._hits[key] = hits
        return allowed

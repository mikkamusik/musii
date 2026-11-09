"""Kommandozeile: python -m mikka_agent {run|pair|check|devices|revoke}."""
from __future__ import annotations

import argparse
import json
import logging
import sys
import time

from . import __version__
from .config import load_config


def cmd_run(cfg, args) -> int:
    from aiohttp import web
    from .server import StudioAgent

    agent = StudioAgent(cfg)
    if not agent.devices.list() or not any(not d.get("revoked") for d in agent.devices.list()):
        code = agent.pairing.create_code()
        print("\n  Noch kein Geraet gekoppelt. Kopplungscode (5 Minuten gueltig): %s\n" % code)
    if cfg.host not in ("127.0.0.1", "localhost", "::1"):
        print("WARNUNG: Agent lauscht auf %s - nur in einem vertrauenswuerdigen VPN verwenden!" % cfg.host)
    print("MIKKA STUDIO REMOTE Agent %s auf http://%s:%d" % (__version__, cfg.host, cfg.port))
    print("Von unterwegs: 'tailscale serve' verwenden (siehe docs/INSTALLATION.md).")
    web.run_app(agent.build_app(), host=cfg.host, port=cfg.port, print=None,
                access_log=None, shutdown_timeout=3)
    return 0


def cmd_pair(cfg, args) -> int:
    from .security import PairingManager
    code = PairingManager(cfg.home).create_code()
    print("Kopplungscode: %s  (5 Minuten gueltig, einmalig verwendbar)" % code)
    print("In der App unter 'Geraet koppeln' eingeben.")
    return 0


def cmd_check(cfg, args) -> int:
    from .sysinfo import collect, format_report
    report = collect(cfg)
    if args.json:
        print(json.dumps(report, indent=2, ensure_ascii=False))
    else:
        print(format_report(report))
    return 0


def cmd_devices(cfg, args) -> int:
    from .security import DeviceStore
    store = DeviceStore(cfg.home, cfg.device_inactivity_days)
    devices = store.list()
    if not devices:
        print("Keine Geraete gekoppelt.")
    for d in devices:
        print("%s  %-24s  zuletzt: %s  %s" % (
            d["id"], d["name"], time.strftime("%Y-%m-%d %H:%M", time.localtime(d.get("last_seen", 0))),
            "WIDERRUFEN (%s)" % d.get("revoked_reason", "") if d.get("revoked") else "aktiv"))
    return 0


def cmd_revoke(cfg, args) -> int:
    from .security import DeviceStore
    ok = DeviceStore(cfg.home, cfg.device_inactivity_days).revoke(args.id)
    print("Geraet widerrufen." if ok else "Geraet nicht gefunden.")
    print("Hinweis: Ein laufender Agent trennt das Geraet spaetestens bei der naechsten Aktion.")
    return 0 if ok else 1


def main(argv=None) -> int:
    parser = argparse.ArgumentParser(prog="mikka", description="MIKKA STUDIO REMOTE - Mac Studio Agent")
    sub = parser.add_subparsers(dest="command")
    sub.add_parser("run", help="Agent starten")
    sub.add_parser("pair", help="Kopplungscode fuer ein neues Smartphone erzeugen")
    p = sub.add_parser("check", help="Systempruefung (Phase 1)")
    p.add_argument("--json", action="store_true")
    sub.add_parser("devices", help="Gekoppelte Geraete anzeigen")
    p = sub.add_parser("revoke", help="Geraet widerrufen")
    p.add_argument("id")
    parser.add_argument("-v", "--verbose", action="store_true")
    args = parser.parse_args(argv)
    logging.basicConfig(level=logging.DEBUG if args.verbose else logging.INFO,
                        format="%(asctime)s %(levelname)s %(name)s: %(message)s")
    cfg = load_config()
    handlers = {"run": cmd_run, "pair": cmd_pair, "check": cmd_check, "devices": cmd_devices,
                "revoke": cmd_revoke}
    if args.command not in handlers:
        parser.print_help()
        return 1
    return handlers[args.command](cfg, args)


if __name__ == "__main__":
    sys.exit(main())

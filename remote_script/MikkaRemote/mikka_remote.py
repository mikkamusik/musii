# -*- coding: utf-8 -*-
"""
Control-Surface-Huelle fuer Ableton Live 12.

Wird von Live geladen, wenn unter Einstellungen > Link, Tempo & MIDI >
Control Surface "MikkaRemote" ausgewaehlt ist (Eingang/Ausgang: Keine).
"""
from __future__ import absolute_import

from _Framework.ControlSurface import ControlSurface

from .core import LiveBridge, DEFAULT_PORT


class MikkaRemote(ControlSurface):
    def __init__(self, c_instance):
        ControlSurface.__init__(self, c_instance)
        self._bridge = None
        try:
            self._bridge = LiveBridge(self.song, log=self.log_message,
                                      app=self.application(), port=DEFAULT_PORT)
            self._bridge.start()
            self.show_message("MIKKA STUDIO REMOTE bereit (127.0.0.1:%d)" % DEFAULT_PORT)
        except Exception as exc:
            self.log_message("MikkaRemote: Initialisierung fehlgeschlagen: %r" % exc)
            self.show_message("MIKKA STUDIO REMOTE: Fehler, siehe Log.txt")

    def update_display(self):
        ControlSurface.update_display(self)
        if self._bridge is not None:
            try:
                self._bridge.tick()
            except Exception as exc:
                self.log_message("MikkaRemote: tick-Fehler: %r" % exc)

    def disconnect(self):
        if self._bridge is not None:
            self._bridge.close()
            self._bridge = None
        ControlSurface.disconnect(self)

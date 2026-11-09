# -*- coding: utf-8 -*-
"""MIKKA STUDIO REMOTE - Ableton Live Remote Script (Control Surface)."""
from __future__ import absolute_import


def create_instance(c_instance):
    from .mikka_remote import MikkaRemote
    return MikkaRemote(c_instance)

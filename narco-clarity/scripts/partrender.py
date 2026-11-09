#!/usr/bin/env python3
"""Render one slice of the film so several slices can run side by side.

  partrender.py <animate script> <part> <parts>   -> raw RGB24 frames on stdout
"""
import sys, importlib.util

path, part, n = sys.argv[1], int(sys.argv[2]), int(sys.argv[3])
sys.argv = [path]
spec = importlib.util.spec_from_file_location("anim", path)
m = importlib.util.module_from_spec(spec)
spec.loader.exec_module(m)
total = int(m.TOTAL * m.FPS)
i0, i1 = total * part // n, total * (part + 1) // n
out = sys.stdout.buffer
for i in range(i0, i1):
    out.write(m.render(i / m.FPS).tobytes())
out.flush()

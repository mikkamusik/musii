#!/usr/bin/env python3
"""script.json -> voice.wav + timeline.json

Synthesises each sentence on its own so the animation can be keyed to the
exact moment every line starts and ends. Pauses are inserted as real
silence rather than left to the speech model, which gives control over
pacing without touching the voice itself.
"""
import json, os, sys, wave
import numpy as np

VOICE = "de_DE-thorsten-high"
LENGTH_SCALE = 1.10   # ~127 wpm; documentary pace, not news pace
LEAD_IN = 1.2         # silence before the first word
SR_OUT = 48000


def load_voice(workdir):
    from piper import PiperVoice
    vdir = os.path.join(workdir, "voices")
    model = os.path.join(vdir, VOICE + ".onnx")
    if not os.path.exists(model):
        os.makedirs(vdir, exist_ok=True)
        sys.stderr.write(f"downloading voice {VOICE} ...\n")
        import subprocess
        subprocess.run([sys.executable, "-m", "piper.download_voices",
                        "--data-dir", vdir, VOICE], check=True)
    return PiperVoice.load(model)


def main():
    workdir = os.getcwd()
    spec = json.load(open(os.path.join(workdir, "script.json"), encoding="utf-8"))
    lines = spec["zeilen"]
    voice = load_voice(workdir)

    try:
        from piper import SynthesisConfig
        cfg = SynthesisConfig(length_scale=LENGTH_SCALE)
    except Exception:
        cfg = None

    tmp = os.path.join(workdir, "_sent.wav")
    chunks, timeline, cursor, src_rate = [], [], 0.0, None

    for idx, ln in enumerate(lines):
        with wave.open(tmp, "w") as w:
            if cfg is not None:
                voice.synthesize_wav(ln.get("sprich", ln["text"]), w, syn_config=cfg)
            else:
                voice.synthesize_wav(ln.get("sprich", ln["text"]), w)
        with wave.open(tmp) as w:
            src_rate = w.getframerate()
            a = np.frombuffer(w.readframes(w.getnframes()), dtype="<i2").astype(np.float32) / 32768.0
            if w.getnchannels() == 2:
                a = a.reshape(-1, 2).mean(axis=1)
        dur = len(a) / src_rate
        pause = float(ln.get("pause", 0.7))
        chunks.append(a)
        chunks.append(np.zeros(int(pause * src_rate), dtype=np.float32))
        timeline.append({"i": idx, "scene": ln["szene"], "text": ln["text"],
                         "start": round(cursor + LEAD_IN, 3),
                         "end": round(cursor + LEAD_IN + dur, 3)})
        cursor += dur + pause

    speech = np.concatenate([np.zeros(int(LEAD_IN * src_rate), dtype=np.float32)] + chunks)
    total = len(speech) / src_rate

    n_out = int(round(total * SR_OUT))
    sp = np.interp(np.linspace(0, len(speech) - 1, n_out),
                   np.arange(len(speech)), speech).astype(np.float32)
    sp *= 0.85 / max(1e-6, np.max(np.abs(sp)))
    pcm = (np.stack([sp, sp], axis=1) * 32767).astype("<i2")
    with wave.open(os.path.join(workdir, "voice.wav"), "w") as w:
        w.setnchannels(2); w.setsampwidth(2); w.setframerate(SR_OUT)
        w.writeframes(pcm.tobytes())

    scenes, order = {}, []
    for e in timeline:
        if e["scene"] not in scenes:
            scenes[e["scene"]] = {"start": e["start"], "end": e["end"]}
            order.append(e["scene"])
        scenes[e["scene"]]["end"] = e["end"]
    scenes[order[-1]]["end"] = total

    json.dump({"total": round(total, 3), "lines": timeline, "scenes": scenes,
               "order": order,
               "kapitel": spec.get("kapitel", {}),
               "panel": spec.get("panel", {}),
               "titel": spec.get("titel", "")},
              open(os.path.join(workdir, "timeline.json"), "w"),
              ensure_ascii=False, indent=1)
    os.remove(tmp)
    words = sum(len(l["text"].split()) for l in lines)
    print(f"{len(lines)} Sätze, {words} Wörter, {total:.1f}s ({total/60:.2f} min), "
          f"{words/(total/60):.0f} wpm")


if __name__ == "__main__":
    main()

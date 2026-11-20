"""Erzeugt die gesprochenen spanischen Phrasen lokal und kostenlos mit Piper TTS.

Stimme: Piper "es_AR-daniela-high" (tiefe, warme Frauenstimme, Argentinien).
Datensatz OpenSLR 61, Lizenz CC BY-SA 4.0. Fuer eine kommerzielle
Veroeffentlichung Lizenz beachten oder die Stimme neu einsprechen lassen.

pip install piper-tts
Modell: https://huggingface.co/rhasspy/piper-voices/tree/main/es/es_AR/daniela/high
python3 spoken_tts.py <ordner-mit-es_AR-daniela-high.onnx> <ausgabe-ordner>
"""
import os
import sys
import wave

from piper import PiperVoice, SynthesisConfig

VOICE = "es_AR-daniela-high"
# Langsam, mit Pausen ("...") – sinnlich statt vorgelesen
PHRASES = {
    "DEJATE": "Ven... déjate caer.",
    "PROFUNDO": "Más profundo.",
    "CORRIENTE": "Corriente nocturna.",
    "SIGUE": "Sigue.",
    "NOPARES": "No pares.",
}


def main(model_dir, out_dir):
    os.makedirs(out_dir, exist_ok=True)
    v = PiperVoice.load(os.path.join(model_dir, VOICE + ".onnx"))
    cfg = SynthesisConfig(length_scale=1.35, noise_scale=0.6, noise_w_scale=0.7)
    for key, text in PHRASES.items():
        with wave.open(os.path.join(out_dir, f"TTS_{key}.wav"), "wb") as wf:
            v.synthesize_wav(text, wf, syn_config=cfg)
    print("TTS ok:", ", ".join(PHRASES))


if __name__ == "__main__":
    main(sys.argv[1], sys.argv[2])

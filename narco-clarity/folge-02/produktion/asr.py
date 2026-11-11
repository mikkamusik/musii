import sys, json
from faster_whisper import WhisperModel
m = WhisperModel(sys.argv[2] if len(sys.argv) > 2 else "medium", device="cpu", compute_type="int8", download_root="models")
import subprocess, numpy as np
raw = subprocess.run(["ffmpeg","-nostdin","-loglevel","error","-i",sys.argv[1],"-ac","1","-ar","16000","-f","f32le","-"],capture_output=True,check=True).stdout
audio = np.frombuffer(raw, dtype=np.float32)
segs, info = m.transcribe(audio, language="de", word_timestamps=True, beam_size=5, vad_filter=False)
out = []
for s in segs:
    for w in s.words:
        out.append({"w": w.word.strip(), "s": round(w.start, 3), "e": round(w.end, 3), "p": round(w.probability, 3)})
    print(f"[{s.start:6.2f}-{s.end:6.2f}] {s.text}")
json.dump(out, open(sys.argv[1] + ".words.json", "w"), ensure_ascii=False, indent=0)

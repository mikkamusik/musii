"""Cut the ElevenLabs take into sentences, slow it 5 % (rubberband, pitch kept),
re-space it with designed pauses, and write voice.wav + timeline.json.
Sentence text is the exact script text; word timings come from whisper."""
import json, subprocess, numpy as np, os, sys
W = sys.argv[1] if len(sys.argv) > 1 else os.getcwd()
SR = 48000
TEMPO = 0.95
LEAD = 0.45
PAD_IN, PAD_OUT = 0.04, 0.07
# (raw_start, raw_end, exact text, pause after)
SEG = [
 (0.05, 2.90, "Ich habe sogar im Urlaub versucht, mit Crack aufzuhören.", 0.55),
 (3.27, 4.09, "Mehrmals.", 1.05),
 (4.95, 7.22, "Ich war raus aus meinem normalen Alltag.", 0.50),
 (7.85, 11.57, "Aber ein anderer Ort hat meine Abhängigkeit nicht einfach beendet.", 1.15),
 (12.54, 14.60, "Ich habe auch ärztliche Hilfe gesucht.", 0.38),
 (14.80, 15.83, "Nicht nur einmal.", 0.55),
 (16.42, 18.17, "Bei wem, das bleibt privat.", 1.10),
 (19.07, 21.71, "Trotzdem bin ich immer wieder rückfällig geworden.", 0.65),
 (22.16, 22.88, "Bis heute.", 1.50),
 (24.12, 28.05, "Von außen sieht man dann oft nur das Ergebnis: wieder konsumiert.", 0.60),
 (28.81, 31.26, "Was man nicht sieht, sind die Versuche davor.", 1.15),
 (32.14, 34.66, "Ich erzähle das nicht als Erfolgsgeschichte.", 0.50),
 (35.17, 36.68, "Sondern so, wie es ist.", 1.25),
 (37.68, 38.81, "NARCO CLARITY.", 0.42),
 (39.25, 40.11, "Folge zwei.", 0.0),
]
TAIL = 4.3   # end card hold + fade after the last word

def load(path):
    raw = subprocess.run(['ffmpeg', '-nostdin', '-loglevel', 'error', '-i', path, '-ac', '1', '-ar', str(SR), '-f', 'f32le', '-'], capture_output=True, check=True).stdout
    return np.frombuffer(raw, dtype=np.float32).copy()

def stretch(x):
    p = subprocess.run(['ffmpeg', '-nostdin', '-loglevel', 'error', '-f', 'f32le', '-ar', str(SR), '-ac', '1', '-i', '-',
                        '-af', f'rubberband=tempo={TEMPO}:pitchq=quality:transients=smooth:detector=soft:window=standard:formant=preserved',
                        '-f', 'f32le', '-'], input=x.tobytes(), capture_output=True, check=True)
    return np.frombuffer(p.stdout, dtype=np.float32).copy()

raw = load(f'{W}/voice/vo_raw48.wav')
words = json.load(open(f'{W}/voice/vo_raw.mp3.words.json'))
out = [np.zeros(int(LEAD * SR), np.float32)]
t = LEAD
lines = []
for i, (s, e, text, pause) in enumerate(SEG):
    a0, a1 = max(0.0, s - PAD_IN), e + PAD_OUT
    seg = raw[int(a0 * SR):int(a1 * SR)].copy()
    fi, fo = int(0.006 * SR), int(0.03 * SR)
    seg[:fi] *= np.linspace(0, 1, fi); seg[-fo:] *= np.linspace(1, 0, fo)
    st = stretch(seg)
    k = len(st) / len(seg)
    speech_start = t + PAD_IN * k
    speech_end = t + (e - a0) * k
    # words of this segment, mapped to output time
    ws = [dict(w=w['w'], s=round(t + (w['s'] - a0) * k, 3), e=round(t + (w['e'] - a0) * k, 3))
          for w in words if s - 0.15 <= w['s'] < e + 0.05]
    lines.append(dict(i=i, text=text, start=round(speech_start, 3), end=round(speech_end, 3), words=ws))
    out.append(st)
    t += len(st) / SR
    if pause:
        out.append(np.zeros(int(pause * SR), np.float32)); t += pause
out.append(np.zeros(int(TAIL * SR), np.float32)); t += TAIL
v = np.concatenate(out)
total = len(v) / SR
v = v / max(1e-6, np.abs(v).max()) * 0.89
subprocess.run(['ffmpeg', '-nostdin', '-loglevel', 'error', '-y', '-f', 'f32le', '-ar', str(SR), '-ac', '1', '-i', '-',
                '-c:a', 'pcm_s24le', f'{W}/build/voice_dry.wav'], input=v.tobytes(), check=True)
json.dump(dict(total=round(total, 3), tempo=TEMPO, lines=lines), open(f'{W}/build/timeline.json', 'w'), ensure_ascii=False, indent=1)
nw = sum(len(l['text'].split()) for l in lines)
span = lines[-1]['end'] - lines[0]['start']
print(f'total {total:.2f}s, speech span {span:.2f}s, {nw} words, {nw / span * 60:.0f} wpm over narration, {nw / total * 60:.0f} wpm overall')
for l in lines: print(f"{l['start']:6.2f}-{l['end']:6.2f}  {l['text']}")

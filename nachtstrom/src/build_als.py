"""Erzeugt das Ableton-Live-Set NACHTSTROM.als von Grund auf (keine Vorlage).

Inhalt:
  * 11 Audiospuren mit den Stems, Arrangement fertig ab Takt 1
  * 5 MIDI-Spuren (Hook, Acid, Bass, FM-Stabs, Drums) mit allen Noten
    – ohne Instrument, damit du eigene Synths (Wavetable, Operator,
      Analog, Drift, Drum Rack) draufziehen kannst
  * Tempo 145, Locators fuer jede Section
"""
import gzip
import os
from xml.sax.saxutils import quoteattr

import soundfile as sf

import compose as C
import export_midi as M

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
# Wahrscheinlichster Ort nach dem Entpacken der Chat-ZIP (Fallback: relativer Pfad)
ABS_GUESS = os.environ.get("NACHTSTROM_ABS", "/Users/mikkamusik/Downloads/NACHTSTROM_v3")


class Ids:
    def __init__(self, start=1000):
        self.n = start

    def __call__(self):
        self.n += 1
        return self.n


ID = Ids()


def v(tag, val):
    if isinstance(val, bool):
        val = "true" if val else "false"
    return f"<{tag} Value={quoteattr(str(val))} />"


def target(tag="AutomationTarget"):
    return f'<{tag} Id="{ID()}"><LockEnvelope Value="0" /></{tag}>'


def param(tag, manual, mn=None, mx=None, mod=True):
    rng = ""
    if mn is not None:
        rng = f"<MidiControllerRange>{v('Min', mn)}{v('Max', mx)}</MidiControllerRange>"
    m = target("ModulationTarget") if mod else ""
    return f"<{tag}>{v('LomId', 0)}{v('Manual', manual)}{rng}{target()}{m}</{tag}>"


def bparam(tag, manual):
    return (f"<{tag}>{v('LomId', 0)}{v('Manual', manual)}{target()}"
            f"<MidiCCOnOffThresholds>{v('Min', 64)}{v('Max', 127)}</MidiCCOnOffThresholds></{tag}>")


def routing(tag, tgt, upper, lower=""):
    return (f"<{tag}>{v('Target', tgt)}{v('UpperDisplayString', upper)}"
            f"{v('LowerDisplayString', lower)}<MpeSettings>{v('ZoneType', 0)}"
            f"{v('FirstNoteChannel', 1)}{v('LastNoteChannel', 15)}</MpeSettings></{tag}>")


def mixer(volume=1.0, pan=0.0, master=False, speaker=True):
    extra = ""
    if master:
        extra = (param("Tempo", C.BPM, 60, 200) +
                 param("TimeSignature", 201, mod=False) +
                 param("GlobalGrooveAmount", 100, 0, 131.25) +
                 param("CrossFade", 0, -1, 1))
    return (
        "<Mixer>" + v("LomId", 0) + v("LomIdView", 0) + v("IsExpanded", True)
        + bparam("On", True) + v("ModulationSourceCount", 0)
        + '<ParametersListWrapper LomId="0" />' + f'<Pointee Id="{ID()}" />'
        + v("LastSelectedTimeableIndex", 0) + v("LastSelectedClipEnvelopeIndex", 0)
        + "<LastPresetRef><Value /></LastPresetRef><LockedScripts />"
        + v("IsFolded", False) + v("ShouldShowPresetName", False) + v("UserName", "")
        + v("Annotation", "") + "<SourceContext><Value /></SourceContext>"
        + "<Sends />" + bparam("Speaker", speaker) + v("SoloSink", False) + v("PanMode", 0)
        + param("Pan", pan, -1, 1) + param("SplitStereoPanL", -1, -1, 1)
        + param("SplitStereoPanR", 1, -1, 1)
        + param("Volume", volume, 0.0003162277571, 1.99526238) + v("ViewStateSesstionTrackWidth", 93)
        + param("CrossFadeState", 1, mod=False) + '<SendsListWrapper LomId="0" />'
        + extra + "</Mixer>"
    )


def time_sig():
    return ("<TimeSignature><TimeSignatures><RemoteableTimeSignature Id=\"0\">"
            + v("Numerator", 4) + v("Denominator", 4) + v("Time", 0)
            + "</RemoteableTimeSignature></TimeSignatures></TimeSignature>")


def clip_common(name, color, t0, t1, loop_start, loop_end, rel):
    return (
        v("CurrentStart", t0) + v("CurrentEnd", t1)
        + "<Loop>" + v("LoopStart", loop_start) + v("LoopEnd", loop_end)
        + v("StartRelative", rel) + v("LoopOn", False) + v("OutMarker", loop_end)
        + v("HiddenLoopStart", loop_start) + v("HiddenLoopEnd", loop_end) + "</Loop>"
        + v("Name", name) + v("Annotation", "") + v("Color", color)
        + v("LaunchMode", 0) + v("LaunchQuantisation", 0) + time_sig()
        + "<Envelopes><Envelopes /></Envelopes>"
        + "<ScrollerTimePreserver>" + v("LeftTime", t0) + v("RightTime", t1) + "</ScrollerTimePreserver>"
        + "<TimeSelection>" + v("AnchorTime", 0) + v("OtherTime", 0) + "</TimeSelection>"
        + v("Legato", False) + v("Ram", False)
        + "<GrooveSettings>" + v("GrooveId", -1) + "</GrooveSettings>"
        + v("Disabled", False) + v("VelocityAmount", 0)
        + "<FollowAction>" + v("FollowTime", 4) + v("IsLinked", True) + v("LoopIterations", 1)
        + v("FollowActionA", 4) + v("FollowActionB", 0) + v("FollowChanceA", 100)
        + v("FollowChanceB", 0) + v("JumpIndexA", 1) + v("JumpIndexB", 1)
        + v("FollowActionEnabled", False) + "</FollowAction>"
        + "<Grid>" + v("FixedNumerator", 1) + v("FixedDenominator", 16)
        + v("GridIntervalPixel", 20) + v("Ntoles", 2) + v("SnapToGrid", True)
        + v("Fixed", False) + "</Grid>"
        + v("FreezeStart", 0) + v("FreezeEnd", 0) + v("IsWarped", True) + v("TakeId", 1)
    )


def audio_clip(cid, name, color, rel_path, abs_path, t0, t1, frames, fsize, markers=None):
    secs = frames / 44100.0
    beats = secs / C.SPB
    if markers is None:
        markers = [(0.0, 0.0), (secs, beats)]
    return (
        f'<AudioClip Id="{cid}" Time="{t0}">'
        + clip_common(name, color, t0, t1, t0, t1, 0)
        + "<SampleRef><FileRef>" + v("RelativePathType", 3) + v("RelativePath", rel_path)
        + v("Path", abs_path) + v("Type", 1) + v("LivePackName", "") + v("LivePackId", "")
        + v("OriginalFileSize", fsize) + v("OriginalCrc", 0) + "</FileRef>"
        + v("LastModDate", 0) + "<SourceContext />" + v("SampleUsageHint", 0)
        + v("DefaultDuration", frames) + v("DefaultSampleRate", 44100) + "</SampleRef>"
        + "<Onsets><UserOnsets />" + v("HasUserOnsets", False) + "</Onsets>"
        + v("WarpMode", 3) + v("GranularityTones", 30) + v("GranularityTexture", 65)
        + v("FluctuationTexture", 25) + v("TransientResolution", 6) + v("TransientLoopMode", 2)
        + v("TransientEnvelope", 100) + v("ComplexProFormants", 100) + v("ComplexProEnvelope", 128)
        + v("Sync", True) + v("HiQ", True) + v("Fade", True)
        + "<Fades>" + v("FadeInLength", 0) + v("FadeOutLength", 0)
        + v("ClipFadesAreInitialized", True) + v("CrossfadeInState", 0)
        + v("FadeInCurveSkew", 0) + v("FadeInCurveSlope", 0) + v("FadeOutCurveSkew", 0)
        + v("FadeOutCurveSlope", 0) + v("IsDefaultFadeIn", True) + v("IsDefaultFadeOut", True)
        + "</Fades>" + v("PitchCoarse", 0) + v("PitchFine", 0) + v("SampleVolume", 1)
        + "<WarpMarkers>"
        + "".join(f'<WarpMarker Id="{i}" SecTime="{sc:.10f}" BeatTime="{bt:.10f}" />' for i, (sc, bt) in enumerate(markers))
        + "</WarpMarkers><SavedWarpMarkersForStretched />"
        + v("MarkersGenerated", False) + v("IsSongTempoMaster", False)
        + "</AudioClip>"
    )


def midi_clip(cid, name, color, t0, t1, notes):
    keys = {}
    for i, (s, d, p, vel) in enumerate(notes):
        keys.setdefault(p, []).append((s - t0, d, vel, i + 1))
    kt = ""
    for k, (p, ns) in enumerate(sorted(keys.items())):
        evs = "".join(
            f'<MidiNoteEvent Time="{s:.6f}" Duration="{d:.6f}" Velocity="{max(1, min(127, int(vel * 127)))}" '
            f'VelocityDeviation="0" OffVelocity="64" Probability="1" IsEnabled="true" NoteId="{nid}" />'
            for s, d, vel, nid in ns)
        kt += f'<KeyTrack Id="{k}"><Notes>{evs}</Notes>{v("MidiKey", p)}</KeyTrack>'
    length = t1 - t0
    return (
        f'<MidiClip Id="{cid}" Time="{t0}">'
        + clip_common(name, color, t0, t1, 0, length, 0)
        + v("IsInKey", True) + "<ScaleInformation>" + v("RootNote", 5) + v("Name", "Minor") + "</ScaleInformation>"
        + f"<Notes><KeyTracks>{kt}</KeyTracks><PerNoteEventStore><EventLists /></PerNoteEventStore>"
        + "<NoteProbabilityGroups /><ProbabilityGroupIdGenerator>" + v("NextId", 1)
        + "</ProbabilityGroupIdGenerator><NoteIdGenerator>" + v("NextId", len(notes) + 1)
        + "</NoteIdGenerator></Notes>"
        + v("BankSelectCoarse", -1) + v("BankSelectFine", -1) + v("ProgramChange", -1)
        + v("NoteEditorFoldInZoom", -1) + v("NoteEditorFoldInScroll", 0)
        + v("NoteEditorFoldOutZoom", 2848) + v("NoteEditorFoldOutScroll", -1300)
        + v("NoteEditorFoldScaleZoom", -1) + v("NoteEditorFoldScaleScroll", 0)
        + "<ExpressionGrid>" + v("FixedNumerator", 1) + v("FixedDenominator", 16)
        + v("GridIntervalPixel", 20) + v("Ntoles", 2) + v("SnapToGrid", True)
        + v("Fixed", False) + "</ExpressionGrid>"
        + "</MidiClip>"
    )


def clip_slots(n_scenes, audio):
    s = ""
    for i in range(n_scenes):
        s += (f'<ClipSlot Id="{i}">' + v("LomId", 0) + "<ClipSlot>" + "<Value />" + "</ClipSlot>"
              + v("HasStop", True) + v("NeedRefreeze", True) + "</ClipSlot>")
    return f"<ClipSlotList>{s}</ClipSlotList>"


def sequencer(tag, events, n_scenes, audio):
    return (
        f"<{tag}>" + v("LomId", 0) + v("LomIdView", 0) + v("IsExpanded", True)
        + bparam("On", True) + v("ModulationSourceCount", 0)
        + '<ParametersListWrapper LomId="0" />' + f'<Pointee Id="{ID()}" />'
        + v("LastSelectedTimeableIndex", 0) + v("LastSelectedClipEnvelopeIndex", 0)
        + "<LastPresetRef><Value /></LastPresetRef><LockedScripts />"
        + v("IsFolded", False) + v("ShouldShowPresetName", False) + v("UserName", "")
        + v("Annotation", "") + "<SourceContext><Value /></SourceContext>"
        + clip_slots(n_scenes, audio) + v("MonitoringEnum", 1)
        + (("<Sample><ArrangerAutomation><Events>" + events + "</Events>"
            "<AutomationTransformViewState>" + v("IsTransformPending", False)
            + "<TimeAndValueTransforms /></AutomationTransformViewState></ArrangerAutomation></Sample>")
           if audio else
           ("<ClipTimeable><ArrangerAutomation><Events>" + events + "</Events>"
            "<AutomationTransformViewState>" + v("IsTransformPending", False)
            + "<TimeAndValueTransforms /></AutomationTransformViewState></ArrangerAutomation></ClipTimeable>"))
        + "<VolumeModulationTarget Id=\"%d\"><LockEnvelope Value=\"0\" /></VolumeModulationTarget>" % ID()
        + "<TranspositionModulationTarget Id=\"%d\"><LockEnvelope Value=\"0\" /></TranspositionModulationTarget>" % ID()
        + "<GrainSizeModulationTarget Id=\"%d\"><LockEnvelope Value=\"0\" /></GrainSizeModulationTarget>" % ID()
        + "<FluxModulationTarget Id=\"%d\"><LockEnvelope Value=\"0\" /></FluxModulationTarget>" % ID()
        + "<SampleOffsetModulationTarget Id=\"%d\"><LockEnvelope Value=\"0\" /></SampleOffsetModulationTarget>" % ID()
        + v("PitchViewScrollPosition", -1073741824) + v("SampleOffsetModulationScrollPosition", -1073741824)
        + "<Recorder>" + v("IsArmed", False) + v("TakeCounter", 1) + "</Recorder>"
        + f"</{tag}>"
    )


def track(kind, tid, name, color, annotation, events, n_scenes, volume=1.0, pan=0.0, speaker=True):
    audio = kind == "AudioTrack"
    in_route = (routing("AudioInputRouting", "AudioIn/External/S0", "Ext. In", "1/2")
                + routing("MidiInputRouting", "MidiIn/External.All/-1", "Ext: All Ins"))
    return (
        f'<{kind} Id="{tid}">' + v("LomId", 0) + v("LomIdView", 0)
        + v("IsContentSelectedInDocument", False) + v("PreferredContentViewMode", 0)
        + "<TrackDelay>" + v("Value", 0) + v("IsValueSampleBased", False) + "</TrackDelay>"
        + "<Name>" + v("EffectiveName", name) + v("UserName", name)
        + v("Annotation", annotation) + v("MemorizedFirstClipName", "") + "</Name>"
        + v("Color", color) + "<AutomationEnvelopes><Envelopes /></AutomationEnvelopes>"
        + v("TrackGroupId", -1) + v("TrackUnfolded", True)
        + '<DevicesListWrapper LomId="0" /><ClipSlotsListWrapper LomId="0" />'
        + v("ViewData", "{}")
        + "<TakeLanes><TakeLanes />" + v("AreTakeLanesFolded", True) + "</TakeLanes>"
        + v("LinkedTrackGroupId", -1) + v("SavedPlayingSlot", -1) + v("SavedPlayingOffset", 0)
        + v("Freeze", False) + v("VelocityDetail", 0) + v("NeedArrangerRefreeze", True)
        + v("PostProcessFreezeClips", 0)
        + "<DeviceChain><AutomationLanes><AutomationLanes>"
        + f'<AutomationLane Id="0">{v("SelectedDevice", 0)}{v("SelectedEnvelope", 0)}'
        + v("IsContentSelectedInDocument", False) + v("LaneHeight", 68) + "</AutomationLane>"
        + "</AutomationLanes>" + v("AreAdditionalAutomationLanesFolded", False) + "</AutomationLanes>"
        + "<ClipEnvelopeChooserViewState>" + v("SelectedDevice", 0) + v("SelectedEnvelope", 0)
        + v("PreferModulationVisible", False) + "</ClipEnvelopeChooserViewState>"
        + in_route
        + routing("AudioOutputRouting", "AudioOut/Main", "Main", "")
        + routing("MidiOutputRouting", "MidiOut/None", "None", "")
        + mixer(volume, pan, speaker=speaker)
        + sequencer("MainSequencer", events, n_scenes, audio)
        + sequencer("FreezeSequencer", "", n_scenes, True)
        + "<DeviceChain><Devices /><SignalModulations /></DeviceChain>"
        + "</DeviceChain>"
        + (v("IsTuned", True) if audio else "")
        + f"</{kind}>"
    )


def master_track(n_scenes):
    return (
        "<MasterTrack>" + v("LomId", 0) + v("LomIdView", 0)
        + v("IsContentSelectedInDocument", False) + v("PreferredContentViewMode", 0)
        + "<TrackDelay>" + v("Value", 0) + v("IsValueSampleBased", False) + "</TrackDelay>"
        + "<Name>" + v("EffectiveName", "Master") + v("UserName", "")
        + v("Annotation", "Tipp: Glue Compressor (2:1, Attack 10 ms, Release Auto) + Limiter (Ceiling -1 dB) hier einsetzen – so klingt der Mix wie im Bounce.")
        + v("MemorizedFirstClipName", "") + "</Name>"
        + v("Color", 0) + "<AutomationEnvelopes><Envelopes /></AutomationEnvelopes>"
        + v("TrackGroupId", -1) + v("TrackUnfolded", False)
        + '<DevicesListWrapper LomId="0" /><ClipSlotsListWrapper LomId="0" />'
        + v("ViewData", "{}")
        + "<TakeLanes><TakeLanes />" + v("AreTakeLanesFolded", True) + "</TakeLanes>"
        + v("LinkedTrackGroupId", -1)
        + "<DeviceChain><AutomationLanes><AutomationLanes>"
        + f'<AutomationLane Id="0">{v("SelectedDevice", 0)}{v("SelectedEnvelope", 0)}'
        + v("IsContentSelectedInDocument", False) + v("LaneHeight", 68) + "</AutomationLane>"
        + "</AutomationLanes>" + v("AreAdditionalAutomationLanesFolded", False) + "</AutomationLanes>"
        + "<ClipEnvelopeChooserViewState>" + v("SelectedDevice", 0) + v("SelectedEnvelope", 0)
        + v("PreferModulationVisible", False) + "</ClipEnvelopeChooserViewState>"
        + routing("AudioInputRouting", "AudioIn/External/S0", "Ext. In", "1/2")
        + routing("MidiInputRouting", "MidiIn/External.All/-1", "Ext: All Ins")
        + routing("AudioOutputRouting", "AudioOut/External/S0", "Ext. Out", "1/2")
        + routing("MidiOutputRouting", "MidiOut/None", "None", "")
        + mixer(1.0, 0.0, master=True)
        + "<DeviceChain><Devices /><SignalModulations /></DeviceChain>"
        + "</DeviceChain></MasterTrack>"
    )


AUDIO = [  # Stem, Farbe, Volume, Pan, Info
    ("01 KICK", 14, 1.0, 0, "Hard-Techno-Kick: Pitch-Sweep 930->52 Hz (G#1), Click, Roehre + Clip. In Breaks Hochpass (kein Sub) wie Referenz."),
    ("02 RUMBLE", 14, 1.0, 0, "Kick -> dunkler Hall -> Roehre -> LP 190 Hz, nur im Offbeat-Fenster (0,5-0,95 Beat)."),
    ("03 BASS", 12, 1.0, 0, "Dirty Offbeat-Bass C#2 (69 Hz) + Quarte, Filter zu, Saettigung. Am Phrasenende D2 (b2)."),
    ("04 HATS", 26, 1.0, 0, "Offbeat-Hat (wie Referenz) + 16tel ab Takt 17 + Top-Layer in den hellen Teilen."),
    ("05 CLAP", 26, 1.0, 0, "Clap auf 2 & 4 (wie Referenz), Room."),
    ("06 PERC", 22, 1.0, 0, "Feste Patterns: Rim (3,6,11,14), Tom (7,15), Conga (2,9,12) - an Phrasen gebunden."),
    ("07 STAB", 5, 1.0, 0, "Haupt-Stab Cis-phrygisch. Variante A/B/C je Phrase, Antwort im 8. Takt, Filter oeffnet ueber 16 Takte."),
    ("08 ATMOS", 9, 1.0, 0, "Drone C#/G# nur in Breaks und Main 2: Saws -> Filter -> Phaser -> Hall, breit."),
    ("09 FX", 1, 1.0, 0, "FX-System: Sweep alle 4 Takte, Swell vor jeder 8er-Phrase, Wash bei Kick-Stopps, Booms im Breakdown."),
    ("10 WIDE", 41, 1.0, 0, "Breiter 16tel-Textur-Layer (Stereo-Feld wie Referenz), sidechained."),
]

MIDI = [  # Name, Datei-Key, Farbe, Info
    ("11 STAB MIDI", "STAB", 5, "Eigener Synth: Wavetable/Analog, 2 Saws detuned + Pulse, LP 24 dB, kurze Env, Saturator, Reverb + Echo 3/16."),
    ("12 BASS MIDI", "BASS", 12, "Operator/Drift: Sinus + leiser Saw, Filter ~260 Hz, Saturator kraeftig, Attack 35 ms (Offbeat-Bass)."),
    ("13 DRUMS MIDI", "DRUMS", 14, "Drum Rack: C1 Kick, C#1 Rim, D#1 Clap, F#1 HH, A#1 Offbeat-Hat, D#2 Top, A1 Tom, D#3 Conga."),
]

REF_T0 = 0.0245  # erster Downbeat der Referenz (gemessen)


def regions(path):
    """Aktive Bereiche (Takte) eines Stems -> Clips im Arrangement."""
    x, sr = sf.read(path)
    if x.ndim == 2:
        x = abs(x).max(1)
    else:
        x = abs(x)
    bar_len = int(4 * C.SPB * sr)
    act = [x[i * bar_len:(i + 1) * bar_len].max() > 1e-4 for i in range(C.BARS)]
    out, i = [], 0
    while i < C.BARS:
        if act[i]:
            j = i
            while j < C.BARS and act[j]:
                j += 1
            out.append((i, j))
            i = j
        else:
            i += 1
    return out, len(x)


def section_name(bar):
    name = C.SECTIONS[0][0]
    for n, b in C.SECTIONS:
        if bar >= b:
            name = n
    return name


def main():
    n_scenes = 8
    tracks = []
    tid = 10
    cid = 0
    # 00a REFERENZ (aus) – zum A/B-Vergleich, taktgenau auf 147 BPM gewarpt
    refp = f"{ROOT}/Samples/Referenz/REFERENZ.mp3"
    if os.path.exists(refp):
        info_ = sf.info(refp)
        frames = int(info_.frames)
        end_beat = C.BEATS
        mk = [(REF_T0, 0.0), (REF_T0 + end_beat * C.SPB, float(end_beat))]
        ev = audio_clip(cid, "REFERENZ", 3, "Samples/Referenz/REFERENZ.mp3",
                        f"{ABS_GUESS}/Samples/Referenz/REFERENZ.mp3", 0, end_beat, frames,
                        os.path.getsize(refp), markers=mk)
        cid += 1
        tracks.append(track("AudioTrack", tid, "00 REFERENZ (A/B)", 3,
                            "Deine Referenz, taktgenau auf 147 BPM. Zum Vergleichen Spur einschalten und die anderen solo/aus.",
                            ev, n_scenes, 1.0, 0.0, speaker=False))
        tid += 1
    bpath = f"{ROOT}/bounce/NACHTSTROM_master.flac"
    if os.path.exists(bpath):
        frames = sf.info(bpath).frames
        ev = audio_clip(cid, "MASTER BOUNCE", 0, "bounce/NACHTSTROM_master.flac",
                        f"{ABS_GUESS}/bounce/NACHTSTROM_master.flac", 0, frames / 44100.0 / C.SPB,
                        frames, os.path.getsize(bpath))
        cid += 1
        tracks.append(track("AudioTrack", tid, "00 MASTER BOUNCE", 0,
                            "Fertiger Master (Match-EQ, Clipper, Limiter). Zum Vergleich mit den Stems einschalten.",
                            ev, n_scenes, 1.0, 0.0, speaker=False))
        tid += 1
    for name, color, vol, pan, info in AUDIO:
        fn = name.replace(" ", "_") + ".flac"
        path = f"{ROOT}/Samples/Stems/{fn}"
        regs, frames = regions(path)
        size = os.path.getsize(path)
        ev = ""
        for a, b in regs:
            # Clips an Section-Grenzen schneiden -> lesbares Arrangement
            cuts = sorted({a, b} | {s for _, s in C.SECTIONS if a < s < b})
            for s0, s1 in zip(cuts[:-1], cuts[1:]):
                t0, t1 = s0 * 4, s1 * 4
                if s1 == C.BARS:
                    t1 = frames / 44100.0 / C.SPB  # Hall-Fahne mitnehmen
                ev += audio_clip(cid, f"{name[3:]} | {section_name(s0)}", color,
                                 f"Samples/Stems/{fn}", f"{ABS_GUESS}/Samples/Stems/{fn}",
                                 t0, t1, frames, size)
                cid += 1
        tracks.append(track("AudioTrack", tid, name, color, info, ev, n_scenes, vol, pan))
        tid += 1
    for name, key, color, info in MIDI:
        notes = M.PARTS[key]()
        ev = ""
        bars = sorted({int(n[0] // 4) for n in notes})
        # zusammenhaengende Bereiche -> ein Clip pro Section
        blocks, cur = [], None
        for b in bars:
            if cur and b == cur[1]:
                cur[1] = b + 1
            else:
                cur = [b, b + 1]
                blocks.append(cur)
        for a, b in blocks:
            cuts = sorted({a, b} | {s for _, s in C.SECTIONS if a < s < b})
            for s0, s1 in zip(cuts[:-1], cuts[1:]):
                t0, t1 = s0 * 4, s1 * 4
                ns = [n for n in notes if t0 <= n[0] < t1]
                if ns:
                    ev += midi_clip(cid, f"{name[3:]} | {section_name(s0)}", color, t0, t1, ns)
                    cid += 1
        tracks.append(track("MidiTrack", tid, name, color, info, ev, n_scenes))
        tid += 1

    scenes = "".join(
        f'<Scene Id="{i}">' + "<FollowAction>" + v("FollowTime", 4) + v("IsLinked", True)
        + v("LoopIterations", 1) + v("FollowActionA", 4) + v("FollowActionB", 0)
        + v("FollowChanceA", 100) + v("FollowChanceB", 0) + v("JumpIndexA", 1)
        + v("JumpIndexB", 1) + v("FollowActionEnabled", False) + "</FollowAction>"
        + v("Name", "") + v("Annotation", "") + v("Color", -1) + v("Tempo", C.BPM)
        + v("IsTempoEnabled", False) + v("TimeSignatureId", 201)
        + v("IsTimeSignatureEnabled", False) + v("LomId", 0)
        + '<ClipSlotsListWrapper LomId="0" /></Scene>' for i in range(n_scenes))

    locs = "".join(
        f'<Locator Id="{i}">' + v("LomId", 0) + v("Time", b * 4) + v("Name", n)
        + v("Annotation", "") + v("IsSongStart", i == 0) + "</Locator>"
        for i, (n, b) in enumerate(C.SECTIONS))

    transport = ("<Transport>" + v("PhaseNudgeTempo", 10) + v("LoopOn", False)
                 + v("LoopStart", 0) + v("LoopLength", 64) + v("LoopIsSongStart", False)
                 + v("CurrentTime", 0) + v("PunchIn", False) + v("PunchOut", False)
                 + v("MetronomeTickDuration", 0) + v("DrawMode", False) + "</Transport>")

    body = (
        "<LiveSet>" + v("NextPointeeId", ID.n + 100) + v("OverwriteProtectionNumber", 2817)
        + v("LomId", 0) + v("LomIdView", 0)
        + "<Tracks>" + "".join(tracks) + "</Tracks>"
        + master_track(n_scenes)
        + "<SendsPre />"
        + "<Scenes>" + scenes + "</Scenes>"
        + transport
        + "<SongMasterValues><SessionScrollerPos X=\"0\" Y=\"0\" /></SongMasterValues>"
        + v("GlobalQuantisation", 4) + v("AutoQuantisation", 0)
        + "<Grid>" + v("FixedNumerator", 1) + v("FixedDenominator", 16)
        + v("GridIntervalPixel", 20) + v("Ntoles", 2) + v("SnapToGrid", True)
        + v("Fixed", False) + "</Grid>"
        + "<ScaleInformation>" + v("RootNote", 5) + v("Name", "Minor") + "</ScaleInformation>"
        + v("InKey", True) + v("SmpteFormat", 0)
        + "<TimeSelection>" + v("AnchorTime", 0) + v("OtherTime", 0) + "</TimeSelection>"
        + "<Locators><Locators>" + locs + "</Locators></Locators>"
        + v("ViewData", "{}") + v("Annotation", "NACHTSTROM v3 – 147 BPM – Cis-Phrygisch. Gebaut nach dem vermessenen Bauplan der Referenz.")
        + "</LiveSet>"
    )
    xml = ('<?xml version="1.0" encoding="UTF-8"?>\n'
           '<Ableton MajorVersion="5" MinorVersion="11.0_11300" SchemaChangeCount="3" '
           'Creator="Ableton Live 11.3.13" Revision="">' + body + "</Ableton>\n")
    out = f"{ROOT}/NACHTSTROM.als"
    with gzip.open(out, "wb") as f:
        f.write(xml.encode("utf-8"))
    # Stems in die Live-typische Projektstruktur spiegeln
    print("ALS ok:", out, len(tracks), "Spuren,", cid, "Clips")


if __name__ == "__main__":
    main()

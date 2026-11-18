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


def mixer(volume=1.0, pan=0.0, master=False):
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
        + "<Sends />" + bparam("Speaker", True) + v("SoloSink", False) + v("PanMode", 0)
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


def audio_clip(cid, name, color, rel_path, abs_path, t0, t1, frames, fsize):
    secs = frames / 44100.0
    beats = secs / C.SPB
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
        + '<WarpMarker Id="0" SecTime="0" BeatTime="0" />'
        + f'<WarpMarker Id="1" SecTime="{secs:.10f}" BeatTime="{beats:.10f}" />'
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


def track(kind, tid, name, color, annotation, events, n_scenes, volume=1.0, pan=0.0):
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
        + mixer(volume, pan)
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
        + "<FreezeSequencer>" + v("LomId", 0) + "</FreezeSequencer>"
        + "<DeviceChain><Devices /><SignalModulations /></DeviceChain>"
        + "</DeviceChain></MasterTrack>"
    )


AUDIO = [  # Stem, Farbe, Volume, Pan, Info
    ("01 KICK", 14, 1.0, 0, "Synth-Kick 43,65 Hz (F1). Pitch-Env 270->44 Hz, Click 1,9 kHz, Tanh-Sattigung."),
    ("02 RUMBLE", 14, 1.0, 0, "Kick -> Hall 90 % -> LP 170 Hz -> Distortion -> Offbeat-Gate mit 16tel-Puls."),
    ("03 BASS", 12, 1.0, 0, "Rolling 16tel (2-3-4), Saw+Sub, LP mit Env, Sidechain 75 %."),
    ("04 CLAP", 26, 1.0, 0, "4 Noise-Bursts, BP 1,15 kHz, Room-Hall."),
    ("05 HATS", 26, 1.0, 0, "Metallische Square-Hats + Shaker + Offbeat-Open, 10 % Swing, atmender HP."),
    ("06 RIDE", 26, 1.0, 0, "Ride auf 8teln, Peak & Drop 3."),
    ("07 PERC", 22, 1.0, 0, "Tribal-Toms (C3/F3/Bb3) + Rim, 2-Takt-Pattern, Fills alle 8 Takte."),
    ("08 HOOK", 5, 1.0, 0, "DER Hook: 2x Saw + Sub-Pulse, SVF Res 0,62, Filterbogen + Ping-Pong 3/16."),
    ("09 ACID", 9, 1.0, 0, "303-Style: Saw -> 4-Pol-Ladder, Accent/Slide, lange Cutoff-Sweeps."),
    ("10 FM STABS", 41, 1.0, 0, "FM 1:2 + 1:3,51, Akkorde Fm-Db-Eb-C (Dominante = Spannung)."),
    ("11 FX", 1, 1.0, 0, "Riser, Snare-Roll, Pitch-Riser, Impacts, Crashes, Downlifter."),
]

MIDI = [  # Name, Datei-Key, Farbe, Info
    ("12 HOOK MIDI", "HOOK", 5, "Zieh Wavetable/Analog drauf: 2 Osc Saw detuned, Filter LP24 Res 60 %, Env->Cutoff."),
    ("13 ACID MIDI", "ACID", 9, "Zieh Analog/Drift oder TB-303-Plugin drauf. Glide 35 ms, Res hoch."),
    ("14 BASS MIDI", "BASS", 12, "Operator/Analog: Saw + Sinus-Sub, kurze Env, Sidechain auf Kick."),
    ("15 STABS MIDI", "FM_STABS", 41, "Operator: Algo 1, B=Ratio 2, Feedback leicht, viel Reverb/Delay."),
    ("16 DRUMS MIDI", "DRUMS", 14, "Drum Rack Mapping: C1 Kick, D#1 Clap, F#1 HH, A#1 OH, D#2 Ride, C#1 Rim, F1/A1/C2 Toms, D1 Roll."),
]


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
                                 f"Samples/Stems/{fn}", f"Samples/Stems/{fn}",
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
        + v("ViewData", "{}") + v("Annotation", "NACHTSTROM – 145 BPM – f-Moll. Komplett neu synthetisiert.")
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

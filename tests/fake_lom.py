"""
Test-Double des Ableton Live Object Model (nur fuer automatisierte Tests).

Bildet die von MikkaRemote genutzten LOM-Eigenschaften nach. Die Volume-Kurve
ist eine monotone Naeherung (0.85 = 0 dB), damit die dB-Suche getestet werden kann.
"""
import math


class Param:
    def __init__(self, name, value=0.0, lo=0.0, hi=1.0, kind="lin", quantized=False, items=None):
        self.name = name
        self.value = value
        self.min = lo
        self.max = hi
        self.kind = kind
        self.is_quantized = quantized
        self.value_items = items or []
        self.is_enabled = True

    def str_for_value(self, v):
        if self.kind == "vol":
            if v <= 0.0001:
                return "-inf dB"
            # monotone Kurve: 0.85 -> 0 dB, 1.0 -> +6 dB
            if v >= 0.85:
                db = (v - 0.85) / 0.15 * 6.0
            else:
                db = 40.0 * math.log10(v / 0.85)
            return "%.1f dB" % db
        if self.kind == "pan":
            if abs(v) < 0.01:
                return "C"
            return "%d%s" % (round(abs(v) * 50), "L" if v < 0 else "R")
        if self.is_quantized and self.value_items:
            return self.value_items[int(v)]
        return "%.2f" % v


class Mixer:
    def __init__(self, sends=2):
        self.volume = Param("Track Volume", 0.85, kind="vol")
        self.panning = Param("Track Panning", 0.0, -1.0, 1.0, kind="pan")
        self.sends = [Param("Send %d" % i, 0.0, kind="vol") for i in range(sends)]


class Device:
    def __init__(self, name, class_name, params=None, chains=None):
        self.name = name
        self.class_name = class_name
        self.type = 2
        self.is_active = True
        self.parameters = params or [Param("Device On", 1.0, 0, 1, quantized=True, items=["Off", "On"])]
        self.chains = chains or []
        self.can_have_chains = bool(chains)
        self.can_have_drum_pads = False


class Chain:
    def __init__(self, name, devices):
        self.name = name
        self.devices = devices


class Clip:
    def __init__(self, name, color=0xFF0000, audio=False):
        self.name = name
        self.color = color
        self.is_playing = False
        self.is_triggered = False
        self.is_recording = False
        self.is_audio_clip = audio
        self.looping = True


class Slot:
    def __init__(self, clip=None):
        self.clip = clip
        self.has_stop_button = True
        self.fired = 0

    @property
    def has_clip(self):
        return self.clip is not None

    def fire(self):
        self.fired += 1
        if self.clip:
            self.clip.is_triggered = True

    def stop(self):
        if self.clip:
            self.clip.is_playing = False


class Track:
    _ptr = 1000

    def __init__(self, name, midi=False, scenes=2, foldable=False, sends=2, armable=True):
        Track._ptr += 1
        self._live_ptr = Track._ptr
        self.name = name
        self.color = 0x00FF00
        self.mute = False
        self.solo = False
        self._arm = False
        self.can_be_armed = armable
        self.has_midi_input = midi
        self.has_audio_input = not midi
        self.has_audio_output = True
        self.is_foldable = foldable
        self.fold_state = False
        self.is_grouped = False
        self.group_track = None
        self.is_visible = True
        self.mixer_device = Mixer(sends)
        self.devices = []
        self.clip_slots = [Slot() for _ in range(scenes)]
        self.output_meter_left = 0.0
        self.output_meter_right = 0.0
        self.stopped = 0

    @property
    def arm(self):
        if not self.can_be_armed:
            raise RuntimeError("Master/Return/Group cannot be armed")
        return self._arm

    @arm.setter
    def arm(self, v):
        if not self.can_be_armed:
            raise RuntimeError("cannot be armed")
        self._arm = v

    def stop_all_clips(self):
        self.stopped += 1


class Cue:
    def __init__(self, name, time, song):
        self.name = name
        self.time = time
        self._song = song

    def jump(self):
        self._song.current_song_time = self.time


class Scene:
    def __init__(self, name):
        self.name = name
        self.color = 0
        self.is_triggered = False
        self.fired = 0

    def fire(self):
        self.fired += 1


class Song:
    def __init__(self):
        self.tempo = 120.0
        self.is_playing = False
        self.record_mode = False
        self.session_record = False
        self.metronome = False
        self.loop = False
        self.loop_start = 0.0
        self.loop_length = 16.0
        self.signature_numerator = 4
        self.signature_denominator = 4
        self.current_song_time = 0.0
        self.song_length = 256.0
        self.can_undo = True
        self.can_redo = False
        self.arrangement_overdub = False
        self.clip_trigger_quantization = 4
        self.undo_count = 0
        self.scenes = [Scene("Intro"), Scene("Drop")]
        kick = Track("01 KICK")
        kick.devices = [Device("EQ Eight", "Eq8", [
            Param("Device On", 1.0, 0, 1, quantized=True, items=["Off", "On"]),
            Param("1 Frequency A", 0.3), Param("1 Gain A", 0.5)])]
        kick.clip_slots[0].clip = Clip("Kick Loop", audio=True)
        hats = Track("04 HI-HATS")
        bass = Track("03 BASS", midi=True)
        rack = Device("Audio Effect Rack", "AudioEffectGroupDevice",
                      chains=[Chain("Chain 1", [Device("Saturator", "Saturator")])])
        bass.devices = [rack]
        group = Track("DRUMS", foldable=True, armable=False)
        kick.is_grouped = True
        kick.group_track = group
        self.tracks = [group, kick, bass, hats]
        self.return_tracks = [Track("A-Reverb", armable=False), Track("B-Delay", armable=False)]
        self.master_track = Track("Main", armable=False)
        self.cue_points = [Cue("Break", 64.0, self), Cue("Start", 0.0, self)]

    def start_playing(self):
        self.is_playing = True

    def stop_playing(self):
        self.is_playing = False

    def continue_playing(self):
        self.is_playing = True

    def tap_tempo(self):
        self.tempo = 121.0

    def undo(self):
        self.undo_count += 1

    def redo(self):
        pass

    def stop_all_clips(self):
        pass

    def create_scene(self, idx):
        self.scenes.append(Scene(""))
        for t in self.tracks:
            t.clip_slots.append(Slot())

    def set_or_delete_cue(self):
        self.cue_points.append(Cue("", self.current_song_time, self))


class App:
    def get_major_version(self):
        return 12

    def get_minor_version(self):
        return 4

    def get_bugfix_version(self):
        return 6

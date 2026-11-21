package com.musii.studio.editor

import android.content.Context
import android.net.Uri
import android.os.Handler
import android.os.Looper
import android.view.SurfaceView
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableFloatStateOf
import androidx.compose.runtime.mutableLongStateOf
import androidx.compose.runtime.mutableStateMapOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.setValue
import androidx.compose.ui.graphics.ImageBitmap
import androidx.compose.ui.graphics.asImageBitmap
import androidx.media3.common.Player
import androidx.media3.effect.MultipleInputVideoGraph
import androidx.media3.transformer.CompositionPlayer
import com.musii.studio.data.ProjectStore
import com.musii.studio.engine.CompositionFactory
import com.musii.studio.engine.LiveProject
import com.musii.studio.engine.MediaImporter
import com.musii.studio.engine.Thumbnails
import com.musii.studio.engine.Tools
import com.musii.studio.engine.VoiceRecorder
import com.musii.studio.model.*
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.Job
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.cancel
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import java.io.File
import kotlin.math.abs
import kotlin.math.max
import kotlin.math.min

sealed class Sel(val id: String) {
    class Main(id: String) : Sel(id)
    class Overlay(id: String) : Sel(id)
    class Audio(id: String) : Sel(id)
    class Text(id: String) : Sel(id)
    class Effect(id: String) : Sel(id)

    override fun equals(other: Any?) = other is Sel && other::class == this::class && other.id == id
    override fun hashCode() = id.hashCode() * 31 + this::class.hashCode()
}

data class Busy(val title: String, val progress: Float? = null)

class EditorState(private val ctx: Context, initial: Project, private val store: ProjectStore) {
    private val scope = CoroutineScope(SupervisorJob() + Dispatchers.Main)

    var project by mutableStateOf(initial)
        private set
    var selection by mutableStateOf<Sel?>(null)
    var timeUs by mutableLongStateOf(0L)
    var isPlaying by mutableStateOf(false)
        private set
    var pxPerSec by mutableFloatStateOf(80f)
    var busy by mutableStateOf<Busy?>(null)
    var message by mutableStateOf<String?>(null)
    var canUndo by mutableStateOf(false)
        private set
    var canRedo by mutableStateOf(false)
        private set
    var isRecording by mutableStateOf(false)
        private set
    var recordLevel by mutableFloatStateOf(0f)
    var playerVersion by mutableStateOf(0)
        private set

    val thumbs = mutableStateMapOf<String, List<ImageBitmap>>()
    val waves = mutableStateMapOf<String, FloatArray>()

    private val undoStack = ArrayList<Project>()
    private val redoStack = ArrayList<Project>()
    private var lastUndoKey: String? = null
    private var lastUndoTime = 0L

    var player: CompositionPlayer? = null
        private set
    private var surfaceView: SurfaceView? = null
    private var signature: String? = null
    private var rebuildJob: Job? = null
    private var saveJob: Job? = null
    private var tickJob: Job? = null
    private var recorder: VoiceRecorder? = null
    private var recordStartUs = 0L
    private val mainHandler = Handler(Looper.getMainLooper())

    init {
        LiveProject.project = initial
        initial.media.forEach { ensureThumbs(it) }
        scheduleRebuild(0)
    }

    // ---------- Änderungen & Undo ----------

    fun update(key: String? = null, change: (Project) -> Project) {
        val p = change(project)
        if (p == project) return
        val now = System.currentTimeMillis()
        if (key == null || key != lastUndoKey || now - lastUndoTime > 1200) {
            undoStack.add(project)
            if (undoStack.size > 150) undoStack.removeAt(0)
        }
        lastUndoKey = key
        lastUndoTime = now
        redoStack.clear()
        applyProject(p)
        canUndo = undoStack.isNotEmpty()
        canRedo = false
    }

    private fun applyProject(p: Project) {
        project = p
        LiveProject.project = p
        onProjectChanged()
    }

    fun undo() {
        val prev = undoStack.removeLastOrNull() ?: return
        redoStack.add(project)
        lastUndoKey = null
        applyProject(prev)
        canUndo = undoStack.isNotEmpty()
        canRedo = true
        validateSelection()
    }

    fun redo() {
        val next = redoStack.removeLastOrNull() ?: return
        undoStack.add(project)
        lastUndoKey = null
        applyProject(next)
        canUndo = true
        canRedo = redoStack.isNotEmpty()
        validateSelection()
    }

    private fun validateSelection() {
        val s = selection ?: return
        val exists = when (s) {
            is Sel.Main -> project.main.any { it.id == s.id }
            is Sel.Overlay -> project.overlays.any { it.id == s.id }
            is Sel.Audio -> project.audio.any { it.id == s.id }
            is Sel.Text -> project.texts.any { it.id == s.id }
            is Sel.Effect -> project.effects.any { it.id == s.id }
        }
        if (!exists) selection = null
    }

    private fun onProjectChanged() {
        val sig = structureSignature(project)
        if (sig != signature) {
            scheduleRebuild(250)
        } else if (!isPlaying) {
            refreshFrame()
        }
        saveJob?.cancel()
        saveJob = scope.launch {
            delay(700)
            val p = project
            withContext(Dispatchers.IO) { store.save(p) }
        }
    }

    fun saveNow() {
        saveJob?.cancel()
        val p = project
        scope.launch(Dispatchers.IO) { store.save(p) }
    }

    // ---------- Player ----------

    private fun structureSignature(p: Project): String {
        val sb = StringBuilder()
        sb.append(p.aspect).append(p.fps).append('|').append(p.background.mode)
        p.main.forEach { sb.append("M").append(it.mediaId).append(it.sourceStartUs).append(':').append(it.sourceDurationUs).append(':').append(it.speed).append(':').append(it.transition?.kind).append(it.transition?.durationUs).append(';') }
        p.overlays.forEach { sb.append("O").append(it.mediaId).append(it.sourceStartUs).append(':').append(it.sourceDurationUs).append(':').append(it.speed).append(':').append(it.startUs).append(':').append(it.lane).append(';') }
        p.audio.forEach { sb.append("A").append(it.mediaId).append(it.sourceStartUs).append(':').append(it.sourceDurationUs).append(':').append(it.speed).append(':').append(it.startUs).append(':').append(it.lane).append(';') }
        sb.append("D").append(p.durationUs / 100_000)
        return sb.toString()
    }

    fun attachSurface(view: SurfaceView?) {
        surfaceView = view
        val pl = player ?: return
        if (view != null) pl.setVideoSurfaceView(view) else pl.clearVideoSurface()
    }

    private fun scheduleRebuild(delayMs: Long) {
        rebuildJob?.cancel()
        rebuildJob = scope.launch {
            delay(delayMs)
            rebuild()
        }
    }

    private fun rebuild() {
        val p = project
        val wasPlaying = isPlaying
        val pos = timeUs
        player?.let {
            it.release()
        }
        player = null
        signature = structureSignature(p)
        val (w, h) = CompositionFactory.renderSize(p, 1280)
        val built = try {
            CompositionFactory.build(ctx, p, w, h, live = true)
        } catch (e: Exception) {
            message = "Vorschau-Fehler: ${e.message}"
            null
        } ?: run { isPlaying = false; playerVersion++; return }
        val pl = CompositionPlayer.Builder(ctx)
            .setVideoGraphFactory(MultipleInputVideoGraph.Factory())
            .experimentalSetEnableReplayableCache(true)
            .build()
        pl.addListener(object : Player.Listener {
            override fun onPlaybackStateChanged(state: Int) {
                if (state == Player.STATE_ENDED) {
                    isPlaying = false
                    stopTicker()
                }
            }

            override fun onIsPlayingChanged(playing: Boolean) {
                if (!playing && isPlaying && pl.playbackState != Player.STATE_BUFFERING) {
                    // Pause von außen
                }
            }

            override fun onPlayerError(error: androidx.media3.common.PlaybackException) {
                message = "Wiedergabefehler: ${error.message}"
                isPlaying = false
            }
        })
        pl.setComposition(built.composition)
        surfaceView?.let { pl.setVideoSurfaceView(it) }
        pl.prepare()
        pl.seekTo(min(pos, max(0, built.durationUs - 50_000)) / 1000)
        player = pl
        playerVersion++
        if (wasPlaying) {
            pl.play()
            startTicker()
        }
    }

    private fun refreshFrame() {
        val pl = player ?: return
        try {
            pl.experimentalRedrawLastFrame()
        } catch (_: Exception) {
            pl.seekTo(timeUs / 1000)
        }
    }

    fun togglePlay() = if (isPlaying) pause() else play()

    fun play() {
        val pl = player ?: return
        if (timeUs >= project.durationUs - 50_000) seek(0)
        isPlaying = true
        pl.play()
        startTicker()
    }

    fun pause() {
        player?.pause()
        isPlaying = false
        stopTicker()
        player?.let { timeUs = it.currentPosition * 1000 }
    }

    private fun startTicker() {
        tickJob?.cancel()
        tickJob = scope.launch {
            while (isPlaying) {
                player?.let { pl -> timeUs = pl.currentPosition * 1000 }
                delay(33)
            }
        }
    }

    private fun stopTicker() {
        tickJob?.cancel()
        tickJob = null
    }

    private var lastSeek = 0L
    fun seek(us: Long) {
        val t = us.coerceIn(0, max(0, project.durationUs))
        timeUs = t
        val now = System.currentTimeMillis()
        if (now - lastSeek > 60 || !isPlaying) {
            lastSeek = now
            player?.seekTo(t / 1000)
        }
    }

    fun setScrubbing(on: Boolean) {
        player?.setScrubbingModeEnabled(on)
        if (!on) player?.seekTo(timeUs / 1000)
    }

    fun release() {
        saveNow()
        player?.release()
        player = null
        recorder?.stop()
        scope.cancel()
    }

    // ---------- Abfragen ----------

    val mainSlots get() = project.mainSlots

    fun clip(id: String): Clip? = project.main.firstOrNull { it.id == id } ?: project.overlays.firstOrNull { it.id == id } ?: project.audio.firstOrNull { it.id == id }
    fun text(id: String): TextClip? = project.texts.firstOrNull { it.id == id }
    fun effect(id: String): EffectClip? = project.effects.firstOrNull { it.id == id }

    fun startOf(id: String): Long? {
        val i = project.main.indexOfFirst { it.id == id }
        if (i >= 0) return mainSlots[i].startUs
        clip(id)?.let { return it.startUs }
        text(id)?.let { return it.startUs }
        effect(id)?.let { return it.startUs }
        return null
    }

    val selectedClip: Clip? get() = selection?.let { s -> if (s is Sel.Main || s is Sel.Overlay || s is Sel.Audio) clip(s.id) else null }
    val selectedMedia: MediaFile? get() = selectedClip?.let { project.media(it.mediaId) }

    fun ensureThumbs(m: MediaFile) {
        if (thumbs.containsKey(m.id) && (!m.hasAudio || waves.containsKey(m.id))) return
        if (!File(m.path).exists()) return
        thumbs[m.id] = thumbs[m.id] ?: emptyList()
        scope.launch(Dispatchers.IO) {
            val list = if (m.isVisual) Thumbnails.strip(ctx, m).map { it.asImageBitmap() } else emptyList()
            val wave = if (m.hasAudio) Thumbnails.waveform(ctx, m) else null
            withContext(Dispatchers.Main) {
                thumbs[m.id] = list
                if (wave != null) waves[m.id] = wave
            }
        }
    }

    // ---------- Bearbeiten (generisch) ----------

    fun modifyClip(id: String, key: String? = null, f: (Clip) -> Clip) = update(key) { p ->
        p.copy(
            main = p.main.map { if (it.id == id) f(it) else it },
            overlays = p.overlays.map { if (it.id == id) f(it) else it },
            audio = p.audio.map { if (it.id == id) f(it) else it },
        )
    }

    fun modifyText(id: String, key: String? = null, f: (TextClip) -> TextClip) = update(key) { p ->
        p.copy(texts = p.texts.map { if (it.id == id) f(it) else it })
    }

    fun modifyEffect(id: String, key: String? = null, f: (EffectClip) -> EffectClip) = update(key) { p ->
        p.copy(effects = p.effects.map { if (it.id == id) f(it) else it })
    }

    // ---------- Transform & Keyframes ----------

    private fun localUs(id: String) = timeUs - (startOf(id) ?: 0)

    fun currentTransform(id: String): Transform2D {
        clip(id)?.let { return KeyframeMath.transform(it.transform, it.keyframes, localUs(id)) }
        text(id)?.let { return KeyframeMath.transform(it.transform, it.keyframes, localUs(id)) }
        return Transform2D()
    }

    fun setTransform(id: String, key: String, f: (Transform2D) -> Transform2D) {
        val tr = f(currentTransform(id))
        val local = localUs(id)
        fun apply(base: Transform2D, kfs: List<Keyframe>): Pair<Transform2D, List<Keyframe>> {
            if (kfs.isEmpty()) return tr to kfs
            val i = kfs.indexOfFirst { abs(it.timeUs - local) < 40_000 }
            return if (i >= 0) base to kfs.mapIndexed { j, k -> if (j == i) k.copy(transform = tr) else k }
            else base to (kfs + Keyframe(timeUs = local, transform = tr)).sortedBy { it.timeUs }
        }
        if (clip(id) != null) modifyClip(id, key) { c -> val (b, k) = apply(c.transform, c.keyframes); c.copy(transform = b, keyframes = k) }
        else if (text(id) != null) modifyText(id, key) { t -> val (b, k) = apply(t.transform, t.keyframes); t.copy(transform = b, keyframes = k) }
    }

    fun keyframes(id: String): List<Keyframe> = clip(id)?.keyframes ?: text(id)?.keyframes ?: emptyList()
    fun hasKeyframe(id: String): Boolean { val l = localUs(id); return keyframes(id).any { abs(it.timeUs - l) < 40_000 } }

    fun toggleKeyframe(id: String) {
        val l = localUs(id)
        val tr = currentTransform(id)
        fun toggle(k: List<Keyframe>): List<Keyframe> {
            val i = k.indexOfFirst { abs(it.timeUs - l) < 40_000 }
            return if (i >= 0) k.filterIndexed { j, _ -> j != i } else (k + Keyframe(timeUs = max(0, l), transform = tr)).sortedBy { it.timeUs }
        }
        if (clip(id) != null) modifyClip(id) { it.copy(keyframes = toggle(it.keyframes)) }
        else if (text(id) != null) modifyText(id) { it.copy(keyframes = toggle(it.keyframes)) }
    }

    fun clearKeyframes(id: String) {
        val tr = currentTransform(id)
        if (clip(id) != null) modifyClip(id) { it.copy(keyframes = emptyList(), transform = tr) }
        else if (text(id) != null) modifyText(id) { it.copy(keyframes = emptyList(), transform = tr) }
    }

    // ---------- Spuren ----------

    private fun <T> freeLane(items: List<T>, start: Long, end: Long, lane: (T) -> Int, range: (T) -> Pair<Long, Long>): Int {
        var l = 0
        while (items.any { lane(it) == l && range(it).first < end - 1000 && range(it).second > start + 1000 }) l++
        return l
    }

    // ---------- Import & Hinzufügen ----------

    enum class Target { MAIN, OVERLAY, AUDIO, AUTO, LIBRARY }

    fun importUris(uris: List<Uri>, target: Target) {
        if (uris.isEmpty()) return
        busy = Busy("Medien werden importiert …", 0f)
        scope.launch {
            val items = ArrayList<MediaFile>()
            var failed = 0
            uris.forEachIndexed { i, u ->
                try {
                    items.add(withContext(Dispatchers.IO) { MediaImporter.import(ctx, u) })
                } catch (_: Exception) {
                    failed++
                }
                busy = Busy("Medien werden importiert …", (i + 1f) / uris.size)
            }
            busy = null
            addImported(items, target)
            if (failed > 0) message = "$failed Datei(en) konnten nicht geladen werden."
        }
    }

    fun addImported(items: List<MediaFile>, target: Target) {
        if (items.isEmpty()) return
        val wasEmpty = project.main.isEmpty()
        update { p -> p.copy(media = p.media + items) }
        items.forEach { ensureThumbs(it) }
        for (m in items) {
            when (target) {
                Target.MAIN -> if (m.isVisual) addToMain(m) else addAudio(m, timeUs)
                Target.OVERLAY -> if (m.isVisual) addOverlay(m) else addAudio(m, timeUs)
                Target.AUDIO -> if (m.hasAudio) addAudio(m, timeUs)
                Target.AUTO -> if (m.isVisual) addToMain(m) else addAudio(m, timeUs)
                Target.LIBRARY -> {}
            }
        }
        if (wasEmpty && target != Target.LIBRARY && project.main.isNotEmpty()) {
            val first = items.firstOrNull { it.isVisual && it.width > 0 }
            if (first != null) {
                val r = first.width.toDouble() / first.height
                val best = AspectPreset.entries.minByOrNull { abs(it.w.toDouble() / it.h - r) }
                if (best != null && abs(best.w.toDouble() / best.h - r) < 0.05 && best != project.aspect) update { it.copy(aspect = best) }
            }
        }
    }

    private fun newClip(m: MediaFile): Clip {
        val dur = if (m.kind == MediaKind.IMAGE) 4_000_000L else max(100_000L, snapMs(m.durationUs))
        return Clip(mediaId = m.id, sourceDurationUs = dur, name = m.name)
    }

    fun addToMain(m: MediaFile) {
        val c = newClip(m)
        val slots = mainSlots
        var idx = project.main.size
        val i = slots.indexOfFirst { timeUs >= it.startUs && timeUs < it.endUs }
        if (i >= 0) idx = i + 1
        update { p -> p.copy(main = p.main.toMutableList().apply { add(min(idx, size), c) }) }
        selection = Sel.Main(c.id)
    }

    fun addOverlay(m: MediaFile, at: Long = timeUs) {
        if (!m.isVisual) return
        var c = newClip(m).copy(startUs = snapMs(at), transform = Transform2D(scale = 0.6f))
        c = c.copy(lane = freeLane(project.overlays, c.startUs, c.endUs, { it.lane }, { it.startUs to it.endUs }))
        update { it.copy(overlays = it.overlays + c) }
        selection = Sel.Overlay(c.id)
    }

    fun addAudio(m: MediaFile, at: Long) {
        if (!m.hasAudio) return
        var c = newClip(m).copy(startUs = snapMs(at))
        c = c.copy(lane = freeLane(project.audio, c.startUs, c.endUs, { it.lane }, { it.startUs to it.endUs }))
        update { it.copy(audio = it.audio + c) }
        selection = Sel.Audio(c.id)
    }

    fun addText(style: TextStyle, text: String = "Text eingeben", kind: TextKind = TextKind.TEXT, y: Float = 0.5f) {
        var t = TextClip(kind = kind, text = text, style = style, startUs = snapMs(timeUs), transform = Transform2D(y = y))
        t = t.copy(lane = freeLane(project.texts, t.startUs, t.endUs, { it.lane }, { it.startUs to it.endUs }))
        update { it.copy(texts = it.texts + t) }
        selection = Sel.Text(t.id)
    }

    fun addEmoji(e: String) = addText(TextStyle(fontSize = 160f, bold = false), e, TextKind.EMOJI)

    fun addEffectLayer(kind: EffectKind) {
        var e = EffectClip(kind = kind, startUs = snapMs(timeUs))
        e = e.copy(lane = freeLane(project.effects, e.startUs, e.endUs, { it.lane }, { it.startUs to it.endUs }))
        update { it.copy(effects = it.effects + e) }
        selection = Sel.Effect(e.id)
    }

    fun addEffectToClip(kind: EffectKind) {
        val c = selectedClip
        if (c == null || project.media(c.mediaId)?.isVisual != true) { message = "Wähle zuerst einen Video- oder Bild-Clip aus."; return }
        if (c.effects.size >= 4) { message = "Maximal 4 Effekte pro Clip."; return }
        modifyClip(c.id) { it.copy(effects = it.effects + EffectSetting(kind = kind)) }
    }

    fun applyFilter(preset: String, toAll: Boolean = false) {
        if (toAll) { update { p -> p.copy(main = p.main.map { it.copy(filter = it.filter.copy(preset = preset)) }) }; return }
        val c = selectedClip
        if (c == null || project.media(c.mediaId)?.isVisual != true) { message = "Wähle zuerst einen Clip aus."; return }
        modifyClip(c.id) { it.copy(filter = FilterSetting(preset, if (it.filter.intensity < 0.05f) 1f else it.filter.intensity)) }
    }

    fun applyTransition(kind: TransitionKind, toAll: Boolean = false) {
        if (toAll) {
            update { p -> p.copy(main = p.main.mapIndexed { i, c -> if (i < p.main.size - 1) c.copy(transition = if (kind == TransitionKind.NONE) null else TransitionSetting(kind, c.transition?.durationUs ?: 600_000)) else c }) }
            return
        }
        var idx = (selection as? Sel.Main)?.let { s -> project.main.indexOfFirst { it.id == s.id } } ?: -1
        if (idx < 0) idx = mainSlots.indexOfFirst { timeUs >= it.startUs && timeUs < it.endUs }
        if (idx < 0 || project.main.size < 2) { message = "Übergänge brauchen mindestens zwei Clips."; return }
        if (idx >= project.main.size - 1) idx = project.main.size - 2
        val id = project.main[idx].id
        modifyClip(id) { c -> c.copy(transition = if (kind == TransitionKind.NONE) null else TransitionSetting(kind, c.transition?.durationUs ?: 600_000)) }
        selection = Sel.Main(id)
    }

    // ---------- Teilen, Löschen, Duplizieren ----------

    fun split() {
        val t = timeUs
        var sel = selection
        if (sel == null) {
            val i = mainSlots.indexOfFirst { t > it.startUs + 50_000 && t < it.endUs - 50_000 }
            if (i >= 0) sel = Sel.Main(project.main[i].id)
        }
        when (val s = sel ?: return) {
            is Sel.Main -> {
                val i = project.main.indexOfFirst { it.id == s.id }
                if (i < 0) return
                val slot = mainSlots[i]
                if (t <= slot.startUs + 50_000 || t >= slot.endUs - 50_000) return
                val c = project.main[i]
                val offset = snapMs(((t - slot.startUs) * c.speed).toLong())
                val a = c.copy(sourceDurationUs = offset, transition = null, fadeOutUs = 0, animOut = AnimSetting(), keyframes = splitKf(c.keyframes, t - slot.startUs, true))
                val b = c.copy(id = newId(), sourceStartUs = c.sourceStartUs + offset, sourceDurationUs = c.sourceDurationUs - offset, fadeInUs = 0, animIn = AnimSetting(), keyframes = splitKf(c.keyframes, t - slot.startUs, false))
                update { p -> p.copy(main = p.main.toMutableList().apply { set(i, a); add(i + 1, b) }) }
                selection = Sel.Main(b.id)
            }
            is Sel.Overlay, is Sel.Audio -> {
                val c = clip(s.id) ?: return
                if (t <= c.startUs + 50_000 || t >= c.endUs - 50_000) return
                val offset = snapMs(((t - c.startUs) * c.speed).toLong())
                val a = c.copy(sourceDurationUs = offset, fadeOutUs = 0, keyframes = splitKf(c.keyframes, t - c.startUs, true))
                val b = c.copy(id = newId(), sourceStartUs = c.sourceStartUs + offset, sourceDurationUs = c.sourceDurationUs - offset, startUs = snapMs(t), fadeInUs = 0, keyframes = splitKf(c.keyframes, t - c.startUs, false))
                if (s is Sel.Overlay) {
                    update { p -> p.copy(overlays = p.overlays.map { if (it.id == c.id) a else it } + b) }
                    selection = Sel.Overlay(b.id)
                } else {
                    update { p -> p.copy(audio = p.audio.map { if (it.id == c.id) a else it } + b) }
                    selection = Sel.Audio(b.id)
                }
            }
            is Sel.Text -> {
                val x = text(s.id) ?: return
                if (t <= x.startUs + 50_000 || t >= x.endUs - 50_000) return
                val a = x.copy(durationUs = snapMs(t) - x.startUs, keyframes = splitKf(x.keyframes, t - x.startUs, true))
                val b = x.copy(id = newId(), startUs = snapMs(t), durationUs = x.endUs - snapMs(t), keyframes = splitKf(x.keyframes, t - x.startUs, false))
                update { p -> p.copy(texts = p.texts.map { if (it.id == x.id) a else it } + b) }
                selection = Sel.Text(b.id)
            }
            is Sel.Effect -> {
                val x = effect(s.id) ?: return
                if (t <= x.startUs + 50_000 || t >= x.endUs - 50_000) return
                val a = x.copy(durationUs = snapMs(t) - x.startUs)
                val b = x.copy(id = newId(), startUs = snapMs(t), durationUs = x.endUs - snapMs(t))
                update { p -> p.copy(effects = p.effects.map { if (it.id == x.id) a else it } + b) }
                selection = Sel.Effect(b.id)
            }
        }
    }

    private fun splitKf(k: List<Keyframe>, local: Long, first: Boolean): List<Keyframe> {
        if (k.isEmpty()) return k
        val mid = KeyframeMath.transform(Transform2D(), k, local)
        return if (first) k.filter { it.timeUs < local } + Keyframe(timeUs = local, transform = mid)
        else listOf(Keyframe(timeUs = 0, transform = mid)) + k.filter { it.timeUs > local }.map { it.copy(timeUs = it.timeUs - local) }
    }

    fun deleteSelection() {
        val s = selection ?: return
        update { p ->
            when (s) {
                is Sel.Main -> p.copy(main = p.main.filter { it.id != s.id })
                is Sel.Overlay -> p.copy(overlays = p.overlays.filter { it.id != s.id })
                is Sel.Audio -> p.copy(audio = p.audio.filter { it.id != s.id })
                is Sel.Text -> p.copy(texts = p.texts.filter { it.id != s.id })
                is Sel.Effect -> p.copy(effects = p.effects.filter { it.id != s.id })
            }
        }
        selection = null
    }

    fun duplicateSelection() {
        when (val s = selection ?: return) {
            is Sel.Main -> {
                val i = project.main.indexOfFirst { it.id == s.id }
                if (i < 0) return
                val c = project.main[i].copy(id = newId())
                update { p -> p.copy(main = p.main.toMutableList().apply { add(i + 1, c) }) }
                selection = Sel.Main(c.id)
            }
            is Sel.Overlay -> clip(s.id)?.let { c0 ->
                var c = c0.copy(id = newId(), startUs = c0.endUs)
                c = c.copy(lane = freeLane(project.overlays, c.startUs, c.endUs, { it.lane }, { it.startUs to it.endUs }))
                update { it.copy(overlays = it.overlays + c) }
                selection = Sel.Overlay(c.id)
            }
            is Sel.Audio -> clip(s.id)?.let { c0 ->
                var c = c0.copy(id = newId(), startUs = c0.endUs)
                c = c.copy(lane = freeLane(project.audio, c.startUs, c.endUs, { it.lane }, { it.startUs to it.endUs }))
                update { it.copy(audio = it.audio + c) }
                selection = Sel.Audio(c.id)
            }
            is Sel.Text -> text(s.id)?.let { t0 ->
                var t = t0.copy(id = newId(), startUs = t0.endUs)
                t = t.copy(lane = freeLane(project.texts, t.startUs, t.endUs, { it.lane }, { it.startUs to it.endUs }))
                update { it.copy(texts = it.texts + t) }
                selection = Sel.Text(t.id)
            }
            is Sel.Effect -> effect(s.id)?.let { e0 ->
                var e = e0.copy(id = newId(), startUs = e0.endUs)
                e = e.copy(lane = freeLane(project.effects, e.startUs, e.endUs, { it.lane }, { it.startUs to it.endUs }))
                update { it.copy(effects = it.effects + e) }
                selection = Sel.Effect(e.id)
            }
        }
    }

    // ---------- Verschieben & Trimmen ----------

    fun moveMain(id: String, toIndex: Int) {
        val i = project.main.indexOfFirst { it.id == id }
        if (i < 0) return
        update { p -> p.copy(main = p.main.toMutableList().apply { val c = removeAt(i); add(toIndex.coerceIn(0, size), c) }) }
    }

    fun moveLaneItem(s: Sel, startUs: Long, lane: Int) {
        val st = snapMs(max(0, startUs))
        val l = max(0, lane)
        update { p ->
            when (s) {
                is Sel.Overlay -> p.copy(overlays = p.overlays.map { if (it.id == s.id) it.copy(startUs = st, lane = l) else it })
                is Sel.Audio -> p.copy(audio = p.audio.map { if (it.id == s.id) it.copy(startUs = st, lane = l) else it })
                is Sel.Text -> p.copy(texts = p.texts.map { if (it.id == s.id) it.copy(startUs = st, lane = l) else it })
                is Sel.Effect -> p.copy(effects = p.effects.map { if (it.id == s.id) it.copy(startUs = st, lane = l) else it })
                is Sel.Main -> p
            }
        }
    }

    /** deltaStart/deltaEnd in Timeline-µs */
    fun trim(s: Sel, deltaStart: Long, deltaEnd: Long) {
        fun trimClip(c: Clip, isMain: Boolean): Clip {
            val m = project.media(c.mediaId) ?: return c
            val maxSrc = if (m.kind == MediaKind.IMAGE) 3_600_000_000L else m.durationUs
            var r = c
            if (deltaStart != 0L) {
                var ds = (deltaStart * r.speed).toLong()
                ds = ds.coerceIn(-r.sourceStartUs, r.sourceDurationUs - (100_000 * r.speed).toLong())
                if (m.kind == MediaKind.IMAGE) ds = ds.coerceAtMost(r.sourceDurationUs - 100_000)
                ds = snapMs(ds)
                r = r.copy(
                    sourceStartUs = if (m.kind == MediaKind.IMAGE) 0 else r.sourceStartUs + ds,
                    sourceDurationUs = r.sourceDurationUs - ds,
                    startUs = if (isMain) r.startUs else max(0, r.startUs + snapMs((ds / r.speed).toLong())),
                    keyframes = r.keyframes.map { it.copy(timeUs = it.timeUs - (ds / r.speed).toLong()) },
                )
            }
            if (deltaEnd != 0L) {
                var de = (deltaEnd * r.speed).toLong()
                val srcStart = if (m.kind == MediaKind.IMAGE) 0 else r.sourceStartUs
                de = de.coerceIn(-(r.sourceDurationUs - (100_000 * r.speed).toLong()), maxSrc - srcStart - r.sourceDurationUs)
                r = r.copy(sourceDurationUs = snapMs(r.sourceDurationUs + de))
            }
            return r
        }
        update { p ->
            when (s) {
                is Sel.Main -> p.copy(main = p.main.map { if (it.id == s.id) trimClip(it, true) else it })
                is Sel.Overlay -> p.copy(overlays = p.overlays.map { if (it.id == s.id) trimClip(it, false) else it })
                is Sel.Audio -> p.copy(audio = p.audio.map { if (it.id == s.id) trimClip(it, false) else it })
                is Sel.Text -> p.copy(texts = p.texts.map {
                    if (it.id != s.id) it else {
                        val ds = deltaStart.coerceIn(-it.startUs, it.durationUs - 100_000)
                        val d = (it.durationUs - ds + deltaEnd).coerceAtLeast(100_000)
                        it.copy(startUs = snapMs(it.startUs + ds), durationUs = snapMs(d))
                    }
                })
                is Sel.Effect -> p.copy(effects = p.effects.map {
                    if (it.id != s.id) it else {
                        val ds = deltaStart.coerceIn(-it.startUs, it.durationUs - 100_000)
                        val d = (it.durationUs - ds + deltaEnd).coerceAtLeast(100_000)
                        it.copy(startUs = snapMs(it.startUs + ds), durationUs = snapMs(d))
                    }
                })
            }
        }
    }

    fun snapPoints(exclude: String?): List<Long> {
        val pts = ArrayList<Long>()
        pts.add(0); pts.add(timeUs)
        mainSlots.forEach { pts.add(it.startUs); pts.add(it.endUs) }
        project.overlays.filter { it.id != exclude }.forEach { pts.add(it.startUs); pts.add(it.endUs) }
        project.audio.filter { it.id != exclude }.forEach { pts.add(it.startUs); pts.add(it.endUs) }
        project.texts.filter { it.id != exclude }.forEach { pts.add(it.startUs); pts.add(it.endUs) }
        project.effects.filter { it.id != exclude }.forEach { pts.add(it.startUs); pts.add(it.endUs) }
        return pts
    }

    fun snap(t: Long, exclude: String?, thresholdUs: Long): Long {
        var best = t
        var bestD = thresholdUs
        for (p in snapPoints(exclude)) {
            val d = abs(p - t)
            if (d < bestD) { bestD = d; best = p }
        }
        return best
    }

    // ---------- Spezialfunktionen ----------

    fun setSpeed(id: String, speed: Float) = modifyClip(id, "speed$id") { c ->
        val s = speed.coerceIn(0.1f, 10f)
        val f = c.speed / s
        c.copy(speed = s, keyframes = c.keyframes.map { it.copy(timeUs = (it.timeUs * f).toLong()) })
    }

    fun detachAudio() {
        val c = selectedClip
        val m = c?.let { project.media(it.mediaId) }
        if (c == null || m == null || m.kind != MediaKind.VIDEO || !m.hasAudio) { message = "Wähle einen Video-Clip mit Ton aus."; return }
        val start = startOf(c.id) ?: 0
        var a = Clip(mediaId = m.id, sourceStartUs = c.sourceStartUs, sourceDurationUs = c.sourceDurationUs, speed = c.speed, startUs = start,
            volume = c.volume, fadeInUs = c.fadeInUs, fadeOutUs = c.fadeOutUs, name = (c.name ?: m.name) + " (Ton)")
        a = a.copy(lane = freeLane(project.audio, a.startUs, a.endUs, { it.lane }, { it.startUs to it.endUs }))
        update { p ->
            p.copy(
                audio = p.audio + a,
                main = p.main.map { if (it.id == c.id) it.copy(muted = true) else it },
                overlays = p.overlays.map { if (it.id == c.id) it.copy(muted = true) else it },
            )
        }
        selection = Sel.Audio(a.id)
    }

    fun freezeFrame() {
        var id = (selection as? Sel.Main)?.id
        if (id == null) mainSlots.indexOfFirst { timeUs >= it.startUs && timeUs < it.endUs }.takeIf { it >= 0 }?.let { id = project.main[it].id }
        val cid = id ?: run { message = "Wähle einen Video-Clip auf der Hauptspur aus."; return }
        val i = project.main.indexOfFirst { it.id == cid }
        val c = project.main.getOrNull(i) ?: return
        val m = project.media(c.mediaId)
        if (m == null || m.kind != MediaKind.VIDEO) { message = "Standbild geht nur bei Videos."; return }
        val slot = mainSlots[i]
        val t = timeUs.coerceIn(slot.startUs, slot.endUs - 10_000)
        val src = c.sourceStartUs + ((t - slot.startUs) * c.speed).toLong()
        busy = Busy("Standbild wird erstellt …")
        scope.launch {
            try {
                val item = withContext(Dispatchers.IO) {
                    val f = Tools.freezeFrame(ctx, m, src)
                    MediaImporter.probe(f, "Standbild", "image/png", generated = true)
                }
                busy = null
                val freeze = Clip(mediaId = item.id, sourceDurationUs = 3_000_000, name = "Standbild", transform = c.transform, crop = c.crop,
                    filter = c.filter, adjust = c.adjust, fitMode = c.fitMode, flipH = c.flipH, flipV = c.flipV)
                update { p ->
                    val list = p.main.toMutableList()
                    val idx = list.indexOfFirst { it.id == cid }
                    if (idx >= 0 && t > slot.startUs + 50_000 && t < slot.endUs - 50_000) {
                        val off = snapMs(((t - slot.startUs) * c.speed).toLong())
                        val a = c.copy(sourceDurationUs = off, transition = null)
                        val b = c.copy(id = newId(), sourceStartUs = c.sourceStartUs + off, sourceDurationUs = c.sourceDurationUs - off)
                        list[idx] = a
                        list.add(idx + 1, freeze)
                        list.add(idx + 2, b)
                    } else if (idx >= 0) {
                        list.add(if (t <= slot.startUs + 50_000) idx else idx + 1, freeze)
                    }
                    p.copy(media = p.media + item, main = list)
                }
                ensureThumbs(item)
                selection = Sel.Main(freeze.id)
            } catch (e: Exception) {
                busy = null
                message = e.message ?: "Standbild fehlgeschlagen"
            }
        }
    }

    fun textToSpeech(text: String, voice: String?, rate: Float, pitch: Float) {
        val tx = text.trim()
        if (tx.isEmpty()) return
        val at = timeUs
        busy = Busy("Sprachausgabe wird erzeugt …")
        scope.launch {
            try {
                val f = Tools.textToSpeech(ctx, tx, voice, rate, pitch)
                val item = withContext(Dispatchers.IO) { MediaImporter.probe(f, "Sprache: " + tx.take(20), "audio/wav", generated = true) }
                busy = null
                update { it.copy(media = it.media + item) }
                addAudio(item, at)
                ensureThumbs(item)
            } catch (e: Exception) {
                busy = null
                message = e.message ?: "Sprachausgabe fehlgeschlagen"
            }
        }
    }

    fun startRecording() {
        try {
            val r = VoiceRecorder(ctx)
            r.start()
            recorder = r
            recordStartUs = timeUs
            isRecording = true
            player?.volume = 0f
            play()
            scope.launch {
                while (isRecording) {
                    recordLevel = r.level()
                    delay(60)
                }
            }
        } catch (e: Exception) {
            message = "Aufnahme nicht möglich: ${e.message}"
        }
    }

    fun stopRecording() {
        val f = recorder?.stop() ?: return
        recorder = null
        isRecording = false
        pause()
        player?.volume = 1f
        val at = recordStartUs
        scope.launch {
            try {
                val item = withContext(Dispatchers.IO) { MediaImporter.probe(f, "Aufnahme", "audio/mp4", generated = true) }
                update { it.copy(media = it.media + item) }
                addAudio(item, at)
                ensureThumbs(item)
            } catch (e: Exception) {
                message = "Aufnahme konnte nicht geladen werden."
            }
        }
    }

    fun deleteMedia(m: MediaFile) {
        update { p ->
            p.copy(
                media = p.media.filter { it.id != m.id },
                main = p.main.filter { it.mediaId != m.id },
                overlays = p.overlays.filter { it.mediaId != m.id },
                audio = p.audio.filter { it.mediaId != m.id },
            )
        }
        validateSelection()
    }

    fun runOnMain(r: Runnable) = mainHandler.post(r)
}

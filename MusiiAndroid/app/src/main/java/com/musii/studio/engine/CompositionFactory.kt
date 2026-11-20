package com.musii.studio.engine

import android.content.Context
import android.graphics.Bitmap
import android.net.Uri
import androidx.media3.common.Effect
import androidx.media3.common.MediaItem
import androidx.media3.common.audio.AudioProcessor
import androidx.media3.common.audio.SpeedProvider
import androidx.media3.common.C
import androidx.media3.effect.SpeedChangeEffect
import androidx.media3.transformer.Composition
import androidx.media3.transformer.EditedMediaItem
import androidx.media3.transformer.EditedMediaItemSequence
import androidx.media3.transformer.Effects
import com.musii.studio.model.Clip
import com.musii.studio.model.MediaFile
import com.musii.studio.model.MediaKind
import com.musii.studio.model.Project
import java.io.File
import java.io.FileOutputStream
import kotlin.math.max

data class BuiltComposition(
    val composition: Composition,
    val durationUs: Long,
    val canvasW: Int,
    val canvasH: Int,
    val videoSequences: Int,
)

object CompositionFactory {
    private const val MIN_GAP_US = 20_000L

    fun spacerFile(context: Context): File {
        val f = File(context.cacheDir, "musii_spacer.png")
        if (!f.exists()) {
            val bmp = Bitmap.createBitmap(16, 16, Bitmap.Config.ARGB_8888)
            bmp.eraseColor(0)
            FileOutputStream(f).use { bmp.compress(Bitmap.CompressFormat.PNG, 100, it) }
            bmp.recycle()
        }
        return f
    }

    private class ConstantSpeed(private val speed: Float) : SpeedProvider {
        override fun getSpeed(timeUs: Long): Float = speed
        override fun getNextSpeedChangeTimeUs(timeUs: Long): Long = C.TIME_UNSET
    }

    /** Baut eine Videospur aus Elementen mit Startzeiten; Lücken werden mit transparenten Platzhaltern gefüllt. */
    private class VideoLane(val ctx: Context, val fps: Int, val canvasW: Int, val canvasH: Int) {
        val items = ArrayList<EditedMediaItem>()
        var cursorUs = 0L
        var hasAudio = false

        fun spacer(durationUs: Long) {
            val ms = max(1L, durationUs / 1000)
            val mi = MediaItem.Builder()
                .setUri(Uri.fromFile(spacerFile(ctx)))
                .setImageDurationMs(ms)
                .build()
            val spec = LayerSpec(null, null, 0, cursorUs, ms * 1000, canvasW, canvasH, null, spacer = true)
            items.add(
                EditedMediaItem.Builder(mi)
                    .setDurationUs(ms * 1000)
                    .setFrameRate(fps)
                    .setEffects(Effects(emptyList(), listOf(LayerEffect(spec))))
                    .build()
            )
            cursorUs += ms * 1000
        }

        fun gapTo(startUs: Long) {
            val gap = startUs - cursorUs
            if (gap >= MIN_GAP_US) spacer(gap)
        }

        fun add(item: EditedMediaItem, durationUs: Long, withAudio: Boolean) {
            items.add(item)
            cursorUs += durationUs
            if (withAudio) hasAudio = true
        }

        fun padTo(totalUs: Long) {
            if (totalUs - cursorUs >= MIN_GAP_US) spacer(totalUs - cursorUs)
        }

        fun build(): EditedMediaItemSequence {
            val b = EditedMediaItemSequence.Builder(items)
            if (hasAudio) b.experimentalSetForceAudioTrack(true)
            return b.build()
        }
    }

    private fun visualItem(
        ctx: Context, p: Project, clip: Clip, media: MediaFile, itemStartUs: Long, spec: LayerSpec,
        fadeInUs: Long, fadeOutUs: Long,
    ): Pair<EditedMediaItem, Boolean> {
        val uri = Uri.fromFile(File(media.path))
        return if (media.kind == MediaKind.IMAGE) {
            val ms = max(1L, clip.durationUs / 1000)
            val mi = MediaItem.Builder().setUri(uri).setImageDurationMs(ms).build()
            EditedMediaItem.Builder(mi)
                .setDurationUs(ms * 1000)
                .setFrameRate(p.fps)
                .setEffects(Effects(emptyList(), listOf(LayerEffect(spec))))
                .build() to false
        } else {
            val end = (clip.sourceStartUs + clip.sourceDurationUs).coerceAtMost(media.durationUs)
            val mi = MediaItem.Builder()
                .setUri(uri)
                .setClippingConfiguration(
                    MediaItem.ClippingConfiguration.Builder()
                        .setStartPositionUs(clip.sourceStartUs.coerceAtLeast(0))
                        .setEndPositionUs(end)
                        .build()
                )
                .build()
            val audio = ArrayList<AudioProcessor>()
            val video = ArrayList<Effect>()
            video.add(LayerEffect(spec))
            val speedChanged = kotlin.math.abs(clip.speed - 1f) > 0.001f
            if (media.hasAudio) {
                if (speedChanged) {
                    val pair = Effects.createExperimentalSpeedChangingEffect(ConstantSpeed(clip.speed))
                    audio.add(pair.first)
                    video.add(pair.second)
                }
                val vol = if (clip.muted) 0f else clip.volume
                audio.add(GainEnvelopeProcessor(vol, fadeInUs, fadeOutUs, clip.durationUs))
            } else if (speedChanged) {
                video.add(SpeedChangeEffect(clip.speed))
            }
            EditedMediaItem.Builder(mi)
                .setDurationUs(media.durationUs.coerceAtLeast(1))
                .setEffects(Effects(audio, video))
                .build() to media.hasAudio
        }
    }

    private fun audioItem(clip: Clip, media: MediaFile): EditedMediaItem {
        val uri = Uri.fromFile(File(media.path))
        val end = (clip.sourceStartUs + clip.sourceDurationUs).coerceAtMost(media.durationUs)
        val mi = MediaItem.Builder()
            .setUri(uri)
            .setClippingConfiguration(
                MediaItem.ClippingConfiguration.Builder()
                    .setStartPositionUs(clip.sourceStartUs.coerceAtLeast(0))
                    .setEndPositionUs(end)
                    .build()
            )
            .build()
        val audio = ArrayList<AudioProcessor>()
        if (kotlin.math.abs(clip.speed - 1f) > 0.001f) {
            audio.add(Effects.createExperimentalSpeedChangingEffect(ConstantSpeed(clip.speed)).first)
        }
        audio.add(GainEnvelopeProcessor(if (clip.muted) 0f else clip.volume, clip.fadeInUs, clip.fadeOutUs, clip.durationUs))
        val b = EditedMediaItem.Builder(mi)
            .setDurationUs(media.durationUs.coerceAtLeast(1))
            .setEffects(Effects(audio, emptyList()))
        if (media.kind == MediaKind.VIDEO) b.setRemoveVideo(true)
        return b.build()
    }

    /**
     * @param renderW/renderH Ausgabegröße (Canvas, ggf. skaliert)
     */
    fun build(ctx: Context, p: Project, renderW: Int, renderH: Int, extraEffects: List<Effect> = emptyList()): BuiltComposition? {
        val total = snap(p.durationUs)
        if (total < 100_000) return null
        val slots = p.mainSlots
        val sequences = ArrayList<EditedMediaItemSequence>()

        // Überlagerungen (oberste Ebene zuerst)
        val overlayLanes = p.overlays.filter { p.media(it.mediaId)?.isVisual == true }.map { it.lane }.distinct().sortedDescending()
        for (lane in overlayLanes) {
            val lv = VideoLane(ctx, p.fps, renderW, renderH)
            for (c in p.overlays.filter { it.lane == lane }.sortedBy { it.startUs }) {
                val m = p.media(c.mediaId) ?: continue
                if (!m.isVisual || !File(m.path).exists()) continue
                val start = snap(c.startUs)
                if (start < lv.cursorUs) continue // überlappt auf gleicher Spur
                lv.gapTo(start)
                val spec = LayerSpec(c, m, m.rotation, lv.cursorUs, c.durationUs, renderW, renderH, null)
                val (item, hasAudio) = visualItem(ctx, p, c, m, lv.cursorUs, spec, c.fadeInUs, c.fadeOutUs)
                lv.add(item, c.durationUs, hasAudio)
            }
            lv.padTo(total)
            if (lv.items.isNotEmpty()) sequences.add(lv.build())
        }

        // Hauptspur: bei Übergängen abwechselnd auf zwei Spuren (B oben, A unten)
        val hasTransitions = (0 until p.main.size - 1).any { p.transitionUs(it) > 0 }
        val laneCount = if (hasTransitions) 2 else 1
        val mainLanes = List(laneCount) { VideoLane(ctx, p.fps, renderW, renderH) }
        p.main.forEachIndexed { i, c ->
            val m = p.media(c.mediaId) ?: return@forEachIndexed
            if (!File(m.path).exists()) return@forEachIndexed
            val laneIdx = if (hasTransitions) i % 2 else 0
            val lv = mainLanes[laneIdx]
            val slot = slots[i]
            lv.gapTo(snap(slot.startUs))
            val isTop = hasTransitions && laneIdx == 1
            val prevKind = if (i > 0) p.main[i - 1].transition?.kind else null
            val transIn = if (slot.transitionInUs > 0 && prevKind != null) TransRole(prevKind, slot.transitionInUs, isTop) else null
            val transOut = if (slot.transitionOutUs > 0 && c.transition != null) TransRole(c.transition.kind, slot.transitionOutUs, isTop) else null
            val spec = LayerSpec(c, m, m.rotation, lv.cursorUs, c.durationUs, renderW, renderH, p.background, transIn, transOut)
            val (item, hasAudio) = visualItem(ctx, p, c, m, lv.cursorUs, spec,
                max(c.fadeInUs, slot.transitionInUs), max(c.fadeOutUs, slot.transitionOutUs))
            lv.add(item, c.durationUs, hasAudio)
        }
        for (lv in mainLanes.reversed()) {
            if (lv.items.isEmpty()) continue
            lv.padTo(total)
            sequences.add(lv.build())
        }
        val videoSequences = sequences.size
        if (videoSequences == 0) {
            // Nur Texte/Audio: schwarzer Hintergrund
            val lv = VideoLane(ctx, p.fps, renderW, renderH)
            lv.spacer(total)
            sequences.add(lv.build())
        }

        // Audiospuren
        val audioLanes = p.audio.map { it.lane }.distinct().sorted()
        for (lane in audioLanes) {
            val b = EditedMediaItemSequence.Builder()
            var cursor = 0L
            var count = 0
            for (c in p.audio.filter { it.lane == lane }.sortedBy { it.startUs }) {
                val m = p.media(c.mediaId) ?: continue
                if (!m.hasAudio || !File(m.path).exists()) continue
                val start = snap(c.startUs)
                if (start < cursor) continue
                if (start - cursor >= MIN_GAP_US) b.addGap(start - cursor)
                b.addItem(audioItem(c, m))
                cursor = start + c.durationUs
                count++
            }
            if (count > 0) {
                b.experimentalSetForceAudioTrack(true)
                sequences.add(b.build())
            }
        }

        val compBuilder = Composition.Builder(sequences)
        val compEffects = ArrayList<Effect>(extraEffects)
        if (p.texts.isNotEmpty() || p.effects.isNotEmpty()) compEffects.add(ProjectEffect(p.texts, p.effects))
        if (compEffects.isNotEmpty()) compBuilder.setEffects(Effects(emptyList(), compEffects))
        return BuiltComposition(compBuilder.build(), total, renderW, renderH, max(1, videoSequences))
    }

    private fun snap(us: Long) = (us / 1000) * 1000

    fun renderSize(p: Project, maxLongSide: Int?): Pair<Int, Int> {
        var w = p.aspect.w.toDouble()
        var h = p.aspect.h.toDouble()
        if (maxLongSide != null && max(w, h) > maxLongSide) {
            val f = maxLongSide / max(w, h)
            w *= f; h *= f
        }
        return Pair((w / 2).toInt() * 2, (h / 2).toInt() * 2)
    }

    fun exportSize(p: Project, shortSide: Int): Pair<Int, Int> {
        val f = shortSide.toDouble() / kotlin.math.min(p.aspect.w, p.aspect.h)
        return Pair(((p.aspect.w * f) / 2).toInt() * 2, ((p.aspect.h * f) / 2).toInt() * 2)
    }
}

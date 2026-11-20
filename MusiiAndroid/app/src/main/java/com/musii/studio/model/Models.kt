package com.musii.studio.model

import kotlinx.serialization.Serializable
import java.util.UUID
import kotlin.math.max
import kotlin.math.min
import kotlin.math.roundToLong

fun newId(): String = UUID.randomUUID().toString()

/** Zeit in Mikrosekunden (gerundet) */
fun us(seconds: Double): Long = (seconds * 1_000_000.0).roundToLong()
fun sec(us: Long): Double = us / 1_000_000.0

@Serializable
data class RGBA(val r: Float = 1f, val g: Float = 1f, val b: Float = 1f, val a: Float = 1f) {
    fun toArgb(): Int {
        fun c(v: Float) = (v.coerceIn(0f, 1f) * 255f + 0.5f).toInt()
        return (c(a) shl 24) or (c(r) shl 16) or (c(g) shl 8) or c(b)
    }

    companion object {
        val White = RGBA(1f, 1f, 1f, 1f)
        val Black = RGBA(0f, 0f, 0f, 1f)
        val Green = RGBA(0f, 0.8f, 0.1f, 1f)
        val Yellow = RGBA(1f, 0.86f, 0.1f, 1f)
        fun fromArgb(c: Int) = RGBA(
            ((c shr 16) and 0xFF) / 255f, ((c shr 8) and 0xFF) / 255f, (c and 0xFF) / 255f, ((c ushr 24) and 0xFF) / 255f
        )
    }
}

@Serializable
enum class MediaKind { VIDEO, IMAGE, AUDIO }

@Serializable
data class MediaFile(
    val id: String = newId(),
    val name: String,
    val path: String,
    val kind: MediaKind,
    val durationUs: Long,
    /** angezeigte (gedrehte) Größe */
    val width: Int,
    val height: Int,
    val hasAudio: Boolean,
    val generated: Boolean = false,
) {
    val isVisual get() = kind != MediaKind.AUDIO
}

@Serializable
data class Transform2D(
    val x: Float = 0.5f,
    val y: Float = 0.5f,
    val scale: Float = 1f,
    val rotation: Float = 0f,
    val opacity: Float = 1f,
) {
    companion object {
        fun lerp(a: Transform2D, b: Transform2D, t: Float) = Transform2D(
            a.x + (b.x - a.x) * t, a.y + (b.y - a.y) * t, a.scale + (b.scale - a.scale) * t,
            a.rotation + (b.rotation - a.rotation) * t, a.opacity + (b.opacity - a.opacity) * t
        )
    }
}

@Serializable
data class Keyframe(val id: String = newId(), val timeUs: Long, val transform: Transform2D)

object KeyframeMath {
    fun transform(base: Transform2D, keyframes: List<Keyframe>, localUs: Long): Transform2D {
        if (keyframes.isEmpty()) return base
        val k = keyframes.sortedBy { it.timeUs }
        if (localUs <= k.first().timeUs) return k.first().transform
        if (localUs >= k.last().timeUs) return k.last().transform
        for (i in 0 until k.size - 1) {
            if (localUs >= k[i].timeUs && localUs <= k[i + 1].timeUs) {
                val span = max(1L, k[i + 1].timeUs - k[i].timeUs).toFloat()
                var t = (localUs - k[i].timeUs) / span
                t = t * t * (3 - 2 * t)
                return Transform2D.lerp(k[i].transform, k[i + 1].transform, t)
            }
        }
        return base
    }
}

@Serializable
enum class AnimKind { NONE, FADE, ZOOM_IN, ZOOM_OUT, SLIDE_LEFT, SLIDE_RIGHT, SLIDE_UP, SLIDE_DOWN, SPIN, POP, BLUR, TYPEWRITER, DROP, SWING }

@Serializable
enum class LoopAnim { NONE, KEN_BURNS, PULSE, SHAKE, SWING, FLOAT, FLICKER, ROTATE, HEARTBEAT }

@Serializable
data class AnimSetting(val kind: AnimKind = AnimKind.NONE, val durationUs: Long = 500_000)

@Serializable
data class FilterSetting(val preset: String = "none", val intensity: Float = 1f)

@Serializable
data class Adjustments(
    val brightness: Float = 0f,
    val contrast: Float = 0f,
    val saturation: Float = 0f,
    val exposure: Float = 0f,
    val temperature: Float = 0f,
    val tint: Float = 0f,
    val highlights: Float = 0f,
    val shadows: Float = 0f,
    val vibrance: Float = 0f,
    val hue: Float = 0f,
    val sharpen: Float = 0f,
    val vignette: Float = 0f,
    val grain: Float = 0f,
    val fade: Float = 0f,
) {
    val isIdentity get() = this == Adjustments()
}

@Serializable
data class EffectSetting(val id: String = newId(), val kind: EffectKind, val intensity: Float = 0.5f)

@Serializable
enum class FitMode { FIT, FILL }

@Serializable
data class CropRect(val x: Float = 0f, val y: Float = 0f, val w: Float = 1f, val h: Float = 1f) {
    val isFull get() = x <= 0.0001f && y <= 0.0001f && w >= 0.9999f && h >= 0.9999f
}

@Serializable
enum class MaskKind { NONE, CIRCLE, RECTANGLE, LINEAR, MIRROR, HEART }

@Serializable
data class MaskSetting(
    val kind: MaskKind = MaskKind.NONE,
    val x: Float = 0.5f,
    val y: Float = 0.5f,
    val size: Float = 0.5f,
    val aspect: Float = 1f,
    val rotation: Float = 0f,
    val feather: Float = 0.05f,
    val invert: Boolean = false,
)

@Serializable
data class ChromaKey(val enabled: Boolean = false, val color: RGBA = RGBA.Green, val tolerance: Float = 0.4f, val softness: Float = 0.1f)

@Serializable
data class TransitionSetting(val kind: TransitionKind, val durationUs: Long = 600_000)

@Serializable
data class Clip(
    val id: String = newId(),
    val mediaId: String,
    val sourceStartUs: Long = 0,
    val sourceDurationUs: Long,
    val speed: Float = 1f,
    /** Startzeit auf der Timeline (nur Spuren außerhalb der Hauptspur) */
    val startUs: Long = 0,
    val lane: Int = 0,
    val volume: Float = 1f,
    val muted: Boolean = false,
    val fadeInUs: Long = 0,
    val fadeOutUs: Long = 0,
    val fitMode: FitMode = FitMode.FIT,
    val transform: Transform2D = Transform2D(),
    val keyframes: List<Keyframe> = emptyList(),
    val crop: CropRect = CropRect(),
    val flipH: Boolean = false,
    val flipV: Boolean = false,
    val filter: FilterSetting = FilterSetting(),
    val adjust: Adjustments = Adjustments(),
    val effects: List<EffectSetting> = emptyList(),
    /** Übergang zum nächsten Clip (nur Hauptspur) */
    val transition: TransitionSetting? = null,
    val animIn: AnimSetting = AnimSetting(),
    val animOut: AnimSetting = AnimSetting(),
    val loop: LoopAnim = LoopAnim.NONE,
    val mask: MaskSetting = MaskSetting(),
    val chroma: ChromaKey = ChromaKey(),
    val name: String? = null,
) {
    val durationUs: Long get() = max(1L, (sourceDurationUs / max(0.01f, speed).toDouble()).roundToLong())
    val endUs: Long get() = startUs + durationUs
}

@Serializable
enum class TextKind { TEXT, EMOJI }

@Serializable
data class TextStyle(
    val font: String = "sans-serif",
    val fontSize: Float = 72f,
    val bold: Boolean = true,
    val italic: Boolean = false,
    val color: RGBA = RGBA.White,
    val strokeColor: RGBA = RGBA.Black,
    val strokeWidth: Float = 0f,
    val shadow: Boolean = false,
    val shadowColor: RGBA = RGBA(0f, 0f, 0f, 0.8f),
    val shadowBlur: Float = 8f,
    val shadowOffset: Float = 4f,
    val background: Boolean = false,
    val backgroundColor: RGBA = RGBA(0f, 0f, 0f, 0.6f),
    val backgroundPadding: Float = 18f,
    val backgroundCorner: Float = 14f,
    /** 0 links, 1 Mitte, 2 rechts */
    val alignment: Int = 1,
    val letterSpacing: Float = 0f,
    val uppercase: Boolean = false,
)

@Serializable
data class TextClip(
    val id: String = newId(),
    val kind: TextKind = TextKind.TEXT,
    val text: String,
    val style: TextStyle = TextStyle(),
    val startUs: Long,
    val durationUs: Long = 3_000_000,
    val lane: Int = 0,
    val transform: Transform2D = Transform2D(),
    val keyframes: List<Keyframe> = emptyList(),
    val animIn: AnimSetting = AnimSetting(),
    val animOut: AnimSetting = AnimSetting(),
    val loop: LoopAnim = LoopAnim.NONE,
    val isCaption: Boolean = false,
) {
    val endUs get() = startUs + durationUs
}

@Serializable
data class EffectClip(
    val id: String = newId(),
    val kind: EffectKind,
    val intensity: Float = 0.6f,
    val startUs: Long,
    val durationUs: Long = 3_000_000,
    val lane: Int = 0,
) {
    val endUs get() = startUs + durationUs
}

@Serializable
enum class AspectPreset(val title: String, val subtitle: String, val w: Int, val h: Int) {
    R16x9("16:9", "YouTube", 1920, 1080),
    R9x16("9:16", "TikTok, Reels, Shorts", 1080, 1920),
    R1x1("1:1", "Instagram", 1080, 1080),
    R4x5("4:5", "Instagram Post", 1080, 1350),
    R4x3("4:3", "Klassisch", 1440, 1080),
    R3x4("3:4", "Hochformat", 1080, 1440),
    R21x9("21:9", "Kino", 2520, 1080),
}

@Serializable
enum class BackgroundMode { COLOR, BLUR }

@Serializable
data class CanvasBackground(val mode: BackgroundMode = BackgroundMode.COLOR, val color: RGBA = RGBA.Black, val blur: Float = 0.5f)

data class MainSlot(val startUs: Long, val endUs: Long, val transitionInUs: Long, val transitionOutUs: Long)

@Serializable
data class Project(
    val id: String = newId(),
    val name: String,
    val created: Long = System.currentTimeMillis(),
    val modified: Long = System.currentTimeMillis(),
    val aspect: AspectPreset = AspectPreset.R9x16,
    val fps: Int = 30,
    val background: CanvasBackground = CanvasBackground(),
    val media: List<MediaFile> = emptyList(),
    val main: List<Clip> = emptyList(),
    val overlays: List<Clip> = emptyList(),
    val audio: List<Clip> = emptyList(),
    val texts: List<TextClip> = emptyList(),
    val effects: List<EffectClip> = emptyList(),
) {
    fun media(id: String): MediaFile? = media.firstOrNull { it.id == id }

    fun transitionUs(after: Int): Long {
        if (after < 0 || after + 1 >= main.size) return 0
        val t = main[after].transition ?: return 0
        if (t.kind == TransitionKind.NONE) return 0
        return max(0L, min(t.durationUs, min(main[after].durationUs / 2, main[after + 1].durationUs / 2)))
    }

    /** Positionen der Hauptspur (magnetisch; bei Übergängen überlappen sich Clips) */
    val mainSlots: List<MainSlot>
        get() {
            val result = ArrayList<MainSlot>(main.size)
            var cursor = 0L
            var prevTrans = 0L
            for (i in main.indices) {
                val d = main[i].durationUs
                val tOut = transitionUs(i)
                result.add(MainSlot(cursor, cursor + d, prevTrans, tOut))
                cursor = cursor + d - tOut
                prevTrans = tOut
            }
            return result
        }

    val mainDurationUs: Long get() = mainSlots.lastOrNull()?.endUs ?: 0L

    val durationUs: Long
        get() {
            var d = mainDurationUs
            overlays.forEach { d = max(d, it.endUs) }
            audio.forEach { d = max(d, it.endUs) }
            texts.forEach { d = max(d, it.endUs) }
            effects.forEach { d = max(d, it.endUs) }
            return d
        }
}

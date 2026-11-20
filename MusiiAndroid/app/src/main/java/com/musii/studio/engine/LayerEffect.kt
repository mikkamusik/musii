package com.musii.studio.engine

import android.content.Context
import android.graphics.Color
import android.opengl.GLES20
import androidx.media3.common.VideoFrameProcessingException
import androidx.media3.common.util.GlProgram
import androidx.media3.common.util.GlUtil
import androidx.media3.common.util.Size
import androidx.media3.effect.BaseGlShaderProgram
import androidx.media3.effect.GlEffect
import androidx.media3.effect.GlShaderProgram
import com.musii.studio.model.BackgroundMode
import com.musii.studio.model.CanvasBackground
import com.musii.studio.model.Clip
import com.musii.studio.model.FilterCatalog
import com.musii.studio.model.FitMode
import com.musii.studio.model.KeyframeMath
import com.musii.studio.model.MaskKind
import com.musii.studio.model.MediaFile
import com.musii.studio.model.TransitionKind
import kotlin.math.cos
import kotlin.math.max
import kotlin.math.min
import kotlin.math.sin

data class TransRole(val kind: TransitionKind, val durationUs: Long, val isTop: Boolean)

/** Unveränderliche Beschreibung, wie ein Clip auf das Canvas gezeichnet wird. */
data class LayerSpec(
    val clip: Clip?,
    val media: MediaFile?,
    val rotationDegrees: Int,
    /** Sequenzzeit, an der das Element beginnt */
    val itemStartUs: Long,
    /** Dauer auf der Timeline */
    val durationUs: Long,
    val canvasW: Int,
    val canvasH: Int,
    val background: CanvasBackground?,
    val transIn: TransRole? = null,
    val transOut: TransRole? = null,
    val spacer: Boolean = false,
    /** true = Vorschau: Farb-/Effektwerte live aus LiveProject lesen */
    val live: Boolean = false,
)

/** Media3-Effekt: rendert einen Clip (oder einen transparenten Platzhalter) auf Canvas-Größe. */
class LayerEffect(val spec: LayerSpec) : GlEffect {
    override fun toGlShaderProgram(context: Context, useHdr: Boolean): GlShaderProgram = LayerShaderProgram(spec, useHdr)
}

internal fun GlProgram.f(name: String, v: Float) {
    if (getUniformLocation(name) >= 0) setFloatUniform(name, v)
}

internal fun GlProgram.fv(name: String, v: FloatArray) {
    if (getUniformLocation(name) >= 0) setFloatsUniform(name, v)
}

class LayerShaderProgram(private val spec: LayerSpec, useHdr: Boolean) : BaseGlShaderProgram(useHdr, 1) {
    private val program: GlProgram = try {
        GlProgram(Shaders.VERTEX, Shaders.LAYER_FRAGMENT)
    } catch (e: GlUtil.GlException) {
        throw VideoFrameProcessingException(e)
    }
    private var inW = 1
    private var inH = 1
    private var preRot = 0

    init {
        program.setBufferAttribute("aFramePosition", GlUtil.getNormalizedCoordinateBounds(), GlUtil.HOMOGENEOUS_COORDINATE_VECTOR_SIZE)
    }

    override fun configure(inputWidth: Int, inputHeight: Int): Size {
        inW = inputWidth
        inH = inputHeight
        val m = spec.media
        preRot = 0
        if (m != null && (spec.rotationDegrees == 90 || spec.rotationDegrees == 270) && inputWidth != inputHeight) {
            val texLandscape = inputWidth > inputHeight
            val dispLandscape = m.width > m.height
            if (texLandscape != dispLandscape) preRot = spec.rotationDegrees
        }
        return Size(spec.canvasW, spec.canvasH)
    }

    override fun drawFrame(inputTexId: Int, presentationTimeUs: Long) {
        try {
            program.use()
            program.setSamplerTexIdUniform("uTex", inputTexId, 0)
            setUniforms(presentationTimeUs)
            program.bindAttributesAndUniforms()
            GLES20.glClearColor(0f, 0f, 0f, 0f)
            GLES20.glClear(GLES20.GL_COLOR_BUFFER_BIT)
            GLES20.glDrawArrays(GLES20.GL_TRIANGLE_STRIP, 0, 4)
        } catch (e: GlUtil.GlException) {
            throw VideoFrameProcessingException(e, presentationTimeUs)
        }
    }

    override fun release() {
        super.release()
        try { program.delete() } catch (_: GlUtil.GlException) {}
    }

    private fun setUniforms(ptsUs: Long) {
        val W = spec.canvasW.toFloat()
        val H = spec.canvasH.toFloat()
        program.fv("uOutSize", floatArrayOf(W, H))
        val clip = spec.clip
        val media = spec.media
        if (spec.spacer || clip == null || media == null) {
            program.f("uSpacer", 1f)
            return
        }
        program.f("uSpacer", 0f)
        val liveClip = if (spec.live) LiveProject.clip(clip.id) else null
        if (liveClip != null && liveClip.mediaId == clip.mediaId) {
            setClipUniforms(liveClip, media, ptsUs, if (spec.live) LiveProject.project?.background?.takeIf { spec.background != null } ?: spec.background else spec.background)
        } else {
            setClipUniforms(clip, media, ptsUs, spec.background)
        }
    }

    private fun setClipUniforms(clip: Clip, media: MediaFile, ptsUs: Long, background: CanvasBackground?) {
        val W = spec.canvasW.toFloat()
        val H = spec.canvasH.toFloat()
        val dispW = if (preRot == 90 || preRot == 270) inH.toFloat() else inW.toFloat()
        val dispH = if (preRot == 90 || preRot == 270) inW.toFloat() else inH.toFloat()
        program.fv("uInSize", floatArrayOf(inW.toFloat(), inH.toFloat()))
        program.fv("uDispSize", floatArrayOf(dispW, dispH))
        program.f("uPreRot", preRot.toFloat())

        // Lokale Zeit (Timeline-Sekunden seit Clipbeginn)
        val speed = if (media.kind == com.musii.studio.model.MediaKind.IMAGE) 1f else clip.speed
        val localUs = ((ptsUs - spec.itemStartUs) / speed.toDouble()).toLong().coerceIn(0L, spec.durationUs)
        val local = localUs / 1e6
        val duration = spec.durationUs / 1e6
        program.f("uTime", local.toFloat())

        val crop = clip.crop
        val cx = crop.x * dispW
        val cy = crop.y * dispH
        val cw = max(2f, crop.w * dispW)
        val ch = max(2f, crop.h * dispH)
        program.fv("uCrop", floatArrayOf(cx, cy, cw, ch))

        val tr = KeyframeMath.transform(clip.transform, clip.keyframes, localUs)
        val an = Animator.state(clip.animIn, clip.animOut, clip.loop, local, duration)
        val ts = TransitionState()
        spec.transIn?.let { r ->
            if (r.durationUs > 0 && localUs < r.durationUs) Transitions.apply(r.kind, localUs.toDouble() / r.durationUs, true, r.isTop, ts)
        }
        spec.transOut?.let { r ->
            val startOut = spec.durationUs - r.durationUs
            if (r.durationUs > 0 && localUs > startOut) Transitions.apply(r.kind, (localUs - startOut).toDouble() / r.durationUs, false, r.isTop, ts)
        }

        // Geometrie: Ausgabe-Pixel -> angezeigte Pixel
        val base = if (clip.fitMode == FitMode.FIT) min(W / cw, H / ch) else max(W / cw, H / ch)
        val s = (base * tr.scale * an.scale * ts.scale).toFloat().coerceAtLeast(0.0001f)
        val theta = Math.toRadians(tr.rotation + an.rotation + ts.rotation).toFloat()
        val centerX = ((tr.x + an.dx + ts.dx) * W).toFloat()
        val centerY = ((tr.y + an.dy + ts.dy) * H).toFloat()
        val fx = if (clip.flipH) -1f else 1f
        val fy = if (clip.flipV) -1f else 1f
        val a = 1f / (s * fx)
        val b = 1f / (s * fy)
        val c = cos(theta)
        val sn = sin(theta)
        val ccx = cx + cw / 2
        val ccy = cy + ch / 2
        val m00 = a * c
        val m01 = a * sn
        val m02 = ccx - a * (c * centerX + sn * centerY)
        val m10 = -b * sn
        val m11 = b * c
        val m12 = ccy - b * (-sn * centerX + c * centerY)
        program.fv("uM", floatArrayOf(m00, m10, 0f, m01, m11, 0f, m02, m12, 1f))
        program.f("uAlpha", (tr.opacity * an.opacity * ts.alpha).toFloat().coerceIn(0f, 1f))

        // Hintergrund
        val bg = background
        if (bg == null) {
            program.f("uBgMode", 0f)
        } else if (bg.mode == BackgroundMode.COLOR) {
            program.f("uBgMode", 1f)
            program.fv("uBgColor", floatArrayOf(bg.color.r, bg.color.g, bg.color.b))
        } else {
            program.f("uBgMode", 2f)
            program.f("uBgScale", max(W / cw, H / ch))
            program.f("uBgBlur", bg.blur)
        }

        // Farbe
        val preset = FilterCatalog.byId(clip.filter.preset)
        val k = clip.filter.intensity.coerceIn(0f, 1f)
        val pa = preset.adjust
        val ad = clip.adjust
        program.f("uBright", (ad.brightness + pa.brightness * k) / 100f)
        program.f("uContrast", (ad.contrast + pa.contrast * k) / 100f)
        program.f("uSat", (ad.saturation + pa.saturation * k) / 100f)
        program.f("uExposure", (ad.exposure + pa.exposure * k) / 100f)
        program.f("uTemp", (ad.temperature + pa.temperature * k) / 100f)
        program.f("uTint", (ad.tint + pa.tint * k) / 100f)
        program.f("uHigh", (ad.highlights + pa.highlights * k) / 100f)
        program.f("uShadow", (ad.shadows + pa.shadows * k) / 100f)
        program.f("uVibrance", (ad.vibrance + pa.vibrance * k) / 100f)
        program.f("uHue", (ad.hue + pa.hue * k) / 100f)
        program.f("uSharpen", max(0f, ad.sharpen + pa.sharpen * k) / 100f)
        program.f("uVignette", (ad.vignette + pa.vignette * k) / 100f)
        program.f("uGrain", max(0f, ad.grain + pa.grain * k) / 100f)
        program.f("uFade", max(0f, ad.fade + pa.fade * k) / 100f)
        program.f("uTone", if (k >= 0.5f) preset.tone.toFloat() else 0f)
        program.fv("uShadowTint", floatArrayOf(preset.shadowTint.r * k, preset.shadowTint.g * k, preset.shadowTint.b * k))
        program.fv("uHighTint", floatArrayOf(preset.highlightTint.r * k, preset.highlightTint.g * k, preset.highlightTint.b * k))

        // Chroma-Key
        val ck = clip.chroma
        if (ck.enabled) {
            val hsv = FloatArray(3)
            Color.RGBToHSV((ck.color.r * 255).toInt(), (ck.color.g * 255).toInt(), (ck.color.b * 255).toInt(), hsv)
            program.f("uChroma", 1f)
            program.f("uChromaHue", hsv[0] / 360f)
            program.f("uChromaTol", 0.04f + ck.tolerance * 0.22f)
            program.f("uChromaSoft", 0.01f + ck.softness * 0.15f)
        } else {
            program.f("uChroma", 0f)
        }

        // Maske
        val mk = clip.mask
        program.f("uMaskKind", when (mk.kind) {
            MaskKind.NONE -> 0f; MaskKind.CIRCLE -> 1f; MaskKind.RECTANGLE -> 2f; MaskKind.LINEAR -> 3f; MaskKind.MIRROR -> 4f; MaskKind.HEART -> 5f
        })
        if (mk.kind != MaskKind.NONE) {
            program.fv("uMaskCenter", floatArrayOf(cx + mk.x * cw, cy + mk.y * ch))
            program.f("uMaskSize", mk.size)
            program.f("uMaskAspect", mk.aspect)
            program.f("uMaskRot", Math.toRadians(mk.rotation.toDouble()).toFloat())
            program.f("uMaskFeather", mk.feather)
            program.f("uMaskInvert", if (mk.invert) 1f else 0f)
        }

        // Übergang
        program.f("uTMask", ts.maskType.toFloat())
        program.fv("uTRect", ts.rect)
        program.f("uTInvert", if (ts.maskInvert) 1f else 0f)
        program.fv("uTColor", ts.color)
        program.f("uTColorAmt", ts.colorAmt.toFloat())
        program.f("uTBlur", max(ts.blur, an.blur * 0.6).toFloat())
        program.f("uTPixel", ts.pixel.toFloat())
        program.f("uTGlitch", ts.glitch.toFloat())

        // Clip-Effekte
        val codes = FloatArray(4)
        val amts = FloatArray(4)
        clip.effects.take(4).forEachIndexed { i, fx ->
            codes[i] = fx.kind.code.toFloat()
            amts[i] = fx.intensity
        }
        program.fv("uFxCodes", codes)
        program.fv("uFxAmts", amts)
    }
}

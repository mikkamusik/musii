package com.musii.studio.engine

import com.musii.studio.model.AnimKind
import com.musii.studio.model.AnimSetting
import com.musii.studio.model.LoopAnim
import com.musii.studio.model.TransitionKind
import kotlin.math.PI
import kotlin.math.abs
import kotlin.math.cos
import kotlin.math.floor
import kotlin.math.max
import kotlin.math.min
import kotlin.math.pow
import kotlin.math.sin

object FxMath {
    fun rnd(seed: Int): Double {
        val v = sin(seed * 12.9898 + 78.233) * 43758.5453
        return v - floor(v)
    }

    fun clamp(v: Double, lo: Double, hi: Double) = min(hi, max(lo, v))
    fun smooth(t: Double): Double {
        val x = clamp(t, 0.0, 1.0)
        return x * x * (3 - 2 * x)
    }
}

class AnimState {
    var dx = 0.0
    var dy = 0.0
    var scale = 1.0
    var rotation = 0.0
    var opacity = 1.0
    var blur = 0.0
    var reveal = 1.0
}

object Animator {
    private fun bounceOut(x: Double): Double {
        val n1 = 7.5625
        val d1 = 2.75
        var t = x
        return when {
            t < 1 / d1 -> n1 * t * t
            t < 2 / d1 -> { t -= 1.5 / d1; n1 * t * t + 0.75 }
            t < 2.5 / d1 -> { t -= 2.25 / d1; n1 * t * t + 0.9375 }
            else -> { t -= 2.625 / d1; n1 * t * t + 0.984375 }
        }
    }

    private fun phase(kind: AnimKind, p: Double, entering: Boolean, s: AnimState) {
        val q = 1 - FxMath.smooth(p)
        val dir = if (entering) 1.0 else -1.0
        when (kind) {
            AnimKind.NONE -> {}
            AnimKind.FADE -> s.opacity *= 1 - q
            AnimKind.ZOOM_IN -> { s.scale *= if (entering) 1 - 0.6 * q else 1 + 0.6 * q; s.opacity *= 1 - q }
            AnimKind.ZOOM_OUT -> { s.scale *= if (entering) 1 + 0.6 * q else 1 - 0.6 * q; s.opacity *= 1 - q }
            AnimKind.SLIDE_LEFT -> s.dx += 0.6 * q * dir
            AnimKind.SLIDE_RIGHT -> s.dx -= 0.6 * q * dir
            AnimKind.SLIDE_UP -> s.dy += 0.5 * q * dir
            AnimKind.SLIDE_DOWN -> s.dy -= 0.5 * q * dir
            AnimKind.SPIN -> { s.rotation += 360 * q * dir; s.scale *= 1 - 0.6 * q; s.opacity *= 1 - q }
            AnimKind.POP -> {
                val x = FxMath.clamp(p, 0.0, 1.0)
                val sc = if (x < 0.6) 1.15 * (x / 0.6) else 1.15 - 0.15 * ((x - 0.6) / 0.4)
                s.scale *= max(0.001, sc)
            }
            AnimKind.BLUR -> { s.blur += q; s.opacity *= 1 - 0.6 * q }
            AnimKind.TYPEWRITER -> if (entering) s.reveal = min(s.reveal, FxMath.clamp(p, 0.0, 1.0)) else s.opacity *= 1 - q
            AnimKind.DROP -> {
                val b = if (entering) bounceOut(FxMath.clamp(p, 0.0, 1.0)) else FxMath.smooth(p)
                s.dy -= (1 - b) * 0.45
                if (!entering) s.opacity *= 1 - q
            }
            AnimKind.SWING -> { s.rotation += -30 * q * cos(q * 6); s.opacity *= 1 - q }
        }
    }

    /** local und duration in Sekunden */
    fun state(animIn: AnimSetting, animOut: AnimSetting, loop: LoopAnim, local: Double, duration: Double): AnimState {
        val s = AnimState()
        val dIn = min(animIn.durationUs / 1e6, duration)
        val dOut = min(animOut.durationUs / 1e6, duration)
        if (animIn.kind != AnimKind.NONE && dIn > 0.01 && local < dIn) phase(animIn.kind, local / dIn, true, s)
        if (animOut.kind != AnimKind.NONE && dOut > 0.01 && local > duration - dOut) phase(animOut.kind, (duration - local) / dOut, false, s)
        val tau = 2 * PI
        when (loop) {
            LoopAnim.NONE -> {}
            LoopAnim.KEN_BURNS -> {
                val f = FxMath.clamp(local / max(0.1, duration), 0.0, 1.0)
                s.scale *= 1 + 0.18 * f
                s.dx += 0.03 * f
            }
            LoopAnim.PULSE -> s.scale *= 1 + 0.06 * sin(tau * local * 1.2)
            LoopAnim.SHAKE -> {
                val seed = (local * 20).toInt()
                s.dx += (FxMath.rnd(seed) - 0.5) * 0.02
                s.dy += (FxMath.rnd(seed + 5) - 0.5) * 0.02
                s.rotation += (FxMath.rnd(seed + 9) - 0.5) * 3
            }
            LoopAnim.SWING -> s.rotation += 8 * sin(tau * local * 0.8)
            LoopAnim.FLOAT -> s.dy += 0.02 * sin(tau * local * 0.6)
            LoopAnim.FLICKER -> s.opacity *= if (FxMath.rnd((local * 12).toInt()) > 0.25) 1.0 else 0.35
            LoopAnim.ROTATE -> s.rotation += local * 90
            LoopAnim.HEARTBEAT -> {
                val ph = (local * 1.3) % 1.0
                s.scale *= 1 + 0.12 * max(0.0, sin(ph * PI * 2)).pow(6)
            }
        }
        return s
    }
}

/** Beitrag eines Übergangs zu einer Ebene */
class TransitionState {
    var dx = 0.0
    var dy = 0.0
    var scale = 1.0
    var rotation = 0.0
    var alpha = 1.0
    var maskType = 0 // 0 keine, 1 Rechteck, 2 Kreis
    var rect = floatArrayOf(0f, 0f, 1f, 1f) // x, y, w, h (oben links, normiert); Kreis: z = Radius
    var maskInvert = false
    var color = floatArrayOf(0f, 0f, 0f)
    var colorAmt = 0.0
    var blur = 0.0
    var pixel = 0.0
    var glitch = 0.0
}

object Transitions {
    /**
     * p: Fortschritt 0..1, incoming: diese Ebene ist der neue Clip, isTop: diese Ebene liegt oben.
     */
    fun apply(kind: TransitionKind, pIn: Double, incoming: Boolean, isTop: Boolean, s: TransitionState) {
        val p = FxMath.clamp(pIn, 0.0, 1.0)
        val e = FxMath.smooth(p)
        fun crossAlpha() { if (isTop) s.alpha *= if (incoming) e else 1 - e }
        fun stepAlpha() { if (isTop) s.alpha *= if (incoming) (if (p >= 0.5) 1.0 else 0.0) else (if (p < 0.5) 1.0 else 0.0) }
        fun reveal(x: Float, y: Float, w: Float, h: Float) {
            if (!isTop) return
            s.maskType = 1
            s.rect = floatArrayOf(x, y, w, h)
            s.maskInvert = !incoming
        }
        when (kind) {
            TransitionKind.NONE -> stepAlpha()
            TransitionKind.DISSOLVE -> crossAlpha()
            TransitionKind.DIP_BLACK, TransitionKind.DIP_WHITE -> {
                s.color = if (kind == TransitionKind.DIP_BLACK) floatArrayOf(0f, 0f, 0f) else floatArrayOf(1f, 1f, 1f)
                if (!incoming) {
                    if (p < 0.5) s.colorAmt = FxMath.smooth(p * 2) else { s.colorAmt = 1.0; if (isTop) s.alpha = 0.0 }
                } else {
                    if (p < 0.5) { s.colorAmt = 1.0; if (isTop) s.alpha = 0.0 } else s.colorAmt = 1 - FxMath.smooth(p * 2 - 1)
                }
            }
            TransitionKind.WIPE_LEFT -> reveal((1 - e).toFloat(), 0f, e.toFloat(), 1f)
            TransitionKind.WIPE_RIGHT -> reveal(0f, 0f, e.toFloat(), 1f)
            TransitionKind.WIPE_UP -> reveal(0f, (1 - e).toFloat(), 1f, e.toFloat())
            TransitionKind.WIPE_DOWN -> reveal(0f, 0f, 1f, e.toFloat())
            TransitionKind.PUSH_LEFT -> s.dx += if (incoming) 1 - e else -e
            TransitionKind.PUSH_RIGHT -> s.dx += if (incoming) -(1 - e) else e
            TransitionKind.PUSH_UP -> s.dy += if (incoming) 1 - e else -e
            TransitionKind.PUSH_DOWN -> s.dy += if (incoming) -(1 - e) else e
            TransitionKind.SLIDE_LEFT -> {
                if (incoming) s.dx += 1 - e
                else if (isTop) { s.maskType = 1; s.rect = floatArrayOf(0f, 0f, (1 - e).toFloat(), 1f) }
            }
            TransitionKind.SLIDE_RIGHT -> {
                if (incoming) s.dx -= 1 - e
                else if (isTop) { s.maskType = 1; s.rect = floatArrayOf(e.toFloat(), 0f, (1 - e).toFloat(), 1f) }
            }
            TransitionKind.ZOOM_IN -> {
                if (incoming) s.scale *= 0.6 + 0.4 * e else s.scale *= 1 + 0.8 * e
                crossAlpha()
            }
            TransitionKind.ZOOM_OUT -> {
                if (incoming) s.scale *= 1.5 - 0.5 * e else s.scale *= 1 - 0.45 * e
                crossAlpha()
            }
            TransitionKind.BLUR -> { s.blur = max(s.blur, sin(p * PI)); crossAlpha() }
            TransitionKind.CIRCLE -> {
                if (isTop) {
                    s.maskType = 2
                    s.rect = floatArrayOf(0.5f, 0.5f, (e * 1.2).toFloat(), 0f)
                    s.maskInvert = !incoming
                }
            }
            TransitionKind.SPIN -> {
                s.rotation += e * 360
                s.scale *= 1 - sin(p * PI) * 0.5
                s.alpha *= if (incoming) (if (p >= 0.5) 1.0 else 0.0) else (if (p < 0.5) 1.0 else 0.0)
            }
            TransitionKind.PIXELATE -> { s.pixel = max(s.pixel, sin(p * PI)); crossAlpha() }
            TransitionKind.FLASH -> {
                s.color = floatArrayOf(1f, 1f, 1f)
                s.colorAmt = max(s.colorAmt, max(0.0, 1 - abs(p - 0.5) * 2.2))
                stepAlpha()
            }
            TransitionKind.GLITCH -> { s.glitch = max(s.glitch, sin(p * PI)); stepAlpha() }
        }
    }
}

package com.musii.studio.engine

import android.graphics.Bitmap
import android.graphics.Canvas
import android.graphics.Paint
import android.graphics.PorterDuff
import android.graphics.RectF
import android.graphics.Typeface
import android.text.Layout
import android.text.StaticLayout
import android.text.TextPaint
import com.musii.studio.model.KeyframeMath
import com.musii.studio.model.TextClip
import com.musii.studio.model.TextKind
import com.musii.studio.model.TextStyle
import kotlin.math.ceil
import kotlin.math.max
import kotlin.math.min
import kotlin.math.roundToInt

/** Zeichnet Texte und Emoji-Sticker mit Android-Canvas. */
object TextRasterizer {

    fun typeface(style: TextStyle): Typeface {
        val st = when {
            style.bold && style.italic -> Typeface.BOLD_ITALIC
            style.bold -> Typeface.BOLD
            style.italic -> Typeface.ITALIC
            else -> Typeface.NORMAL
        }
        return Typeface.create(style.font, st)
    }

    data class Measured(val layout: StaticLayout, val fill: TextPaint, val stroke: TextPaint?, val width: Float, val height: Float, val pad: Float)

    fun layout(text: String, style: TextStyle, scale: Float, kind: TextKind): Measured {
        val content = if (style.uppercase && kind == TextKind.TEXT) text.uppercase() else text
        val fill = TextPaint(Paint.ANTI_ALIAS_FLAG).apply {
            typeface = typeface(style)
            textSize = max(4f, style.fontSize * scale)
            color = style.color.toArgb()
            letterSpacing = style.letterSpacing
        }
        if (style.shadow) {
            fill.setShadowLayer(max(0.1f, style.shadowBlur * scale), style.shadowOffset * scale, style.shadowOffset * scale, style.shadowColor.toArgb())
        }
        var stroke: TextPaint? = null
        if (style.strokeWidth > 0 && kind == TextKind.TEXT) {
            stroke = TextPaint(fill).apply {
                this.style = Paint.Style.STROKE
                strokeWidth = style.strokeWidth * scale * 2
                strokeJoin = Paint.Join.ROUND
                color = style.strokeColor.toArgb()
                clearShadowLayer()
                if (style.shadow) setShadowLayer(max(0.1f, style.shadowBlur * scale), style.shadowOffset * scale, style.shadowOffset * scale, style.shadowColor.toArgb())
            }
            if (style.shadow) fill.clearShadowLayer()
        }
        val align = when (style.alignment) {
            0 -> Layout.Alignment.ALIGN_NORMAL
            2 -> Layout.Alignment.ALIGN_OPPOSITE
            else -> Layout.Alignment.ALIGN_CENTER
        }
        val shown = content.ifEmpty { " " }
        var maxLine = 1f
        for (line in shown.split('\n')) maxLine = max(maxLine, fill.measureText(line))
        val width = ceil(maxLine + (stroke?.strokeWidth ?: 0f) + 4).toInt()
        val layout = StaticLayout.Builder.obtain(shown, 0, shown.length, fill, width)
            .setAlignment(align)
            .setIncludePad(true)
            .build()
        val pad = if (style.background) style.backgroundPadding * scale else 0f
        return Measured(layout, fill, stroke, width.toFloat(), layout.height.toFloat(), pad)
    }

    /** Größe eines Textes in Canvas-Pixeln (für Auswahlrahmen) */
    fun measure(t: TextClip, unit: Float): Pair<Float, Float> {
        val m = layout(t.text, t.style, unit, t.kind)
        return Pair(m.width + m.pad * 2, m.height + m.pad * 1.2f)
    }

    fun drawText(canvas: Canvas, t: TextClip, localUs: Long, unit: Float, canvasW: Int, canvasH: Int) {
        val local = localUs / 1e6
        val tr = KeyframeMath.transform(t.transform, t.keyframes, localUs)
        val an = Animator.state(t.animIn, t.animOut, t.loop, local, t.durationUs / 1e6)
        val opacity = (tr.opacity * an.opacity).coerceIn(0.0, 1.0)
        if (opacity <= 0.003) return
        var text = t.text
        if (an.reveal < 1) {
            val n = (text.length * an.reveal).toInt()
            text = text.take(n)
            if (text.isEmpty()) return
        }
        val scale = (unit * tr.scale * an.scale).toFloat()
        if (scale <= 0.01f) return
        val m = layout(text, t.style, scale, t.kind)
        canvas.save()
        canvas.translate(((tr.x + an.dx) * canvasW).toFloat(), ((tr.y + an.dy) * canvasH).toFloat())
        canvas.rotate((tr.rotation + an.rotation).toFloat())
        val left = -m.width / 2
        val top = -m.height / 2
        val bounds = RectF(left - m.pad - 200, top - m.pad - 200, left + m.width + m.pad + 200, top + m.height + m.pad + 200)
        val layerAlpha = (opacity * 255).roundToInt()
        val saved = if (layerAlpha < 255) canvas.saveLayerAlpha(bounds, layerAlpha) else -1
        if (t.style.background) {
            val p = Paint(Paint.ANTI_ALIAS_FLAG).apply { color = t.style.backgroundColor.toArgb() }
            val r = min(t.style.backgroundCorner * scale, (m.height + m.pad * 1.2f) / 2)
            canvas.drawRoundRect(RectF(left - m.pad, top - m.pad * 0.6f, left + m.width + m.pad, top + m.height + m.pad * 0.6f), r, r, p)
        }
        canvas.translate(left, top)
        m.stroke?.let { st ->
            val strokeLayout = StaticLayout.Builder.obtain(m.layout.text, 0, m.layout.text.length, st, m.layout.width)
                .setAlignment(m.layout.alignment).setIncludePad(true).build()
            strokeLayout.draw(canvas)
        }
        m.layout.draw(canvas)
        if (saved >= 0) canvas.restoreToCount(saved)
        canvas.restore()
    }

    /**
     * Zeichnet alle zum Zeitpunkt sichtbaren Texte in eine Bitmap.
     * Liefert einen Schlüssel, damit unveränderte Bilder nicht neu hochgeladen werden müssen.
     */
    fun visibleKey(texts: List<TextClip>, timeUs: Long): String {
        val sb = StringBuilder()
        for (t in texts) {
            if (timeUs < t.startUs || timeUs >= t.endUs) continue
            val local = timeUs - t.startUs
            val animated = t.keyframes.isNotEmpty() ||
                t.loop != com.musii.studio.model.LoopAnim.NONE ||
                (t.animIn.kind != com.musii.studio.model.AnimKind.NONE && local < t.animIn.durationUs) ||
                (t.animOut.kind != com.musii.studio.model.AnimKind.NONE && local > t.durationUs - t.animOut.durationUs)
            sb.append(t.id).append(':').append(t.hashCode())
            if (animated) sb.append('@').append(local / 33_000)
            sb.append('|')
        }
        return sb.toString()
    }

    fun render(bitmap: Bitmap, texts: List<TextClip>, timeUs: Long) {
        bitmap.eraseColor(0)
        val canvas = Canvas(bitmap)
        canvas.drawColor(0, PorterDuff.Mode.CLEAR)
        val unit = min(bitmap.width, bitmap.height) / 1080f
        for (t in texts.sortedBy { it.lane }) {
            if (timeUs < t.startUs || timeUs >= t.endUs) continue
            drawText(canvas, t, timeUs - t.startUs, unit, bitmap.width, bitmap.height)
        }
    }
}

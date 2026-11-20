package com.musii.studio.engine

import android.content.Context
import android.graphics.Bitmap
import android.opengl.GLES20
import android.opengl.GLUtils
import androidx.media3.common.VideoFrameProcessingException
import androidx.media3.common.util.GlProgram
import androidx.media3.common.util.GlUtil
import androidx.media3.common.util.Size
import androidx.media3.effect.BaseGlShaderProgram
import androidx.media3.effect.GlEffect
import androidx.media3.effect.GlShaderProgram
import com.musii.studio.model.EffectClip
import com.musii.studio.model.TextClip

/**
 * Projektweiter Effekt nach dem Zusammensetzen aller Ebenen:
 * Texte/Sticker und Effekt-Ebenen (Zeit = Projektzeit).
 */
class ProjectEffect(
    val texts: List<TextClip>,
    val effects: List<EffectClip>,
    /** Versatz, falls die Zeitstempel nicht bei 0 beginnen */
    val timeOffsetUs: Long = 0,
) : GlEffect {
    override fun toGlShaderProgram(context: Context, useHdr: Boolean): GlShaderProgram = ProjectShaderProgram(this, useHdr)
    override fun isNoOp(inputWidth: Int, inputHeight: Int): Boolean = texts.isEmpty() && effects.isEmpty()
}

class ProjectShaderProgram(private val fx: ProjectEffect, useHdr: Boolean) : BaseGlShaderProgram(useHdr, 1) {
    private val program: GlProgram = try {
        GlProgram(Shaders.VERTEX, Shaders.PROJECT_FRAGMENT)
    } catch (e: GlUtil.GlException) {
        throw VideoFrameProcessingException(e)
    }
    private var w = 1
    private var h = 1
    private var bitmap: Bitmap? = null
    private var textTex = 0
    private var lastKey: String? = null

    init {
        program.setBufferAttribute("aFramePosition", GlUtil.getNormalizedCoordinateBounds(), GlUtil.HOMOGENEOUS_COORDINATE_VECTOR_SIZE)
    }

    override fun configure(inputWidth: Int, inputHeight: Int): Size {
        w = inputWidth
        h = inputHeight
        if (fx.texts.isNotEmpty()) {
            bitmap?.recycle()
            bitmap = Bitmap.createBitmap(w, h, Bitmap.Config.ARGB_8888)
            lastKey = null
        }
        return Size(w, h)
    }

    private fun ensureTexture(): Int {
        if (textTex == 0) {
            val ids = IntArray(1)
            GLES20.glGenTextures(1, ids, 0)
            textTex = ids[0]
            GLES20.glBindTexture(GLES20.GL_TEXTURE_2D, textTex)
            GLES20.glTexParameteri(GLES20.GL_TEXTURE_2D, GLES20.GL_TEXTURE_MIN_FILTER, GLES20.GL_LINEAR)
            GLES20.glTexParameteri(GLES20.GL_TEXTURE_2D, GLES20.GL_TEXTURE_MAG_FILTER, GLES20.GL_LINEAR)
            GLES20.glTexParameteri(GLES20.GL_TEXTURE_2D, GLES20.GL_TEXTURE_WRAP_S, GLES20.GL_CLAMP_TO_EDGE)
            GLES20.glTexParameteri(GLES20.GL_TEXTURE_2D, GLES20.GL_TEXTURE_WRAP_T, GLES20.GL_CLAMP_TO_EDGE)
        }
        return textTex
    }

    override fun drawFrame(inputTexId: Int, presentationTimeUs: Long) {
        try {
            val t = presentationTimeUs - fx.timeOffsetUs
            var hasText = false
            val bmp = bitmap
            if (bmp != null) {
                val key = TextRasterizer.visibleKey(fx.texts, t)
                if (key.isNotEmpty()) {
                    hasText = true
                    val tex = ensureTexture()
                    if (key != lastKey) {
                        TextRasterizer.render(bmp, fx.texts, t)
                        GLES20.glBindTexture(GLES20.GL_TEXTURE_2D, tex)
                        GLUtils.texImage2D(GLES20.GL_TEXTURE_2D, 0, bmp, 0)
                        lastKey = key
                    }
                }
            }
            program.use()
            program.setSamplerTexIdUniform("uTex", inputTexId, 0)
            if (hasText) program.setSamplerTexIdUniform("uTextTex", textTex, 1)
            program.f("uHasText", if (hasText) 1f else 0f)
            program.fv("uOutSize", floatArrayOf(w.toFloat(), h.toFloat()))
            val codes = FloatArray(4)
            val amts = FloatArray(4)
            val times = FloatArray(4)
            var n = 0
            for (e in fx.effects.sortedBy { it.lane }) {
                if (n >= 4) break
                if (t >= e.startUs && t < e.endUs) {
                    codes[n] = e.kind.code.toFloat()
                    amts[n] = e.intensity
                    times[n] = ((t - e.startUs) / 1e6).toFloat()
                    n++
                }
            }
            program.fv("uFxCodes", codes)
            program.fv("uFxAmts", amts)
            program.fv("uFxTimes", times)
            if (!hasText && program.getUniformLocation("uTextTex") >= 0) {
                // Sampler braucht eine gültige Textur
                program.setSamplerTexIdUniform("uTextTex", inputTexId, 1)
            }
            program.bindAttributesAndUniforms()
            GLES20.glDrawArrays(GLES20.GL_TRIANGLE_STRIP, 0, 4)
        } catch (e: GlUtil.GlException) {
            throw VideoFrameProcessingException(e, presentationTimeUs)
        }
    }

    override fun release() {
        super.release()
        try {
            program.delete()
            if (textTex != 0) GLES20.glDeleteTextures(1, intArrayOf(textTex), 0)
        } catch (_: Exception) {}
        bitmap?.recycle()
        bitmap = null
    }
}

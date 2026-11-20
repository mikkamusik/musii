package com.musii.studio.engine

import androidx.media3.common.C
import androidx.media3.common.audio.AudioProcessor
import androidx.media3.common.audio.BaseAudioProcessor
import java.nio.ByteBuffer
import java.nio.ByteOrder
import kotlin.math.max
import kotlin.math.min

/** Lautstärke mit Ein-/Ausblenden (Zeit relativ zum Clip-Anfang). */
class GainEnvelopeProcessor(
    private val volume: Float,
    private val fadeInUs: Long,
    private val fadeOutUs: Long,
    private val durationUs: Long,
) : BaseAudioProcessor() {
    private var frames = 0L

    override fun onConfigure(inputAudioFormat: AudioProcessor.AudioFormat): AudioProcessor.AudioFormat {
        if (inputAudioFormat.encoding != C.ENCODING_PCM_16BIT && inputAudioFormat.encoding != C.ENCODING_PCM_FLOAT) {
            throw AudioProcessor.UnhandledAudioFormatException(inputAudioFormat)
        }
        return inputAudioFormat
    }

    private fun gainAt(tUs: Long): Float {
        var g = volume
        if (fadeInUs > 0 && tUs < fadeInUs) g *= tUs.toFloat() / fadeInUs
        if (fadeOutUs > 0 && tUs > durationUs - fadeOutUs) g *= max(0f, (durationUs - tUs).toFloat() / fadeOutUs)
        return min(4f, max(0f, g))
    }

    override fun queueInput(inputBuffer: ByteBuffer) {
        val fmt = inputAudioFormat
        val remaining = inputBuffer.remaining()
        if (remaining == 0) return
        val out = replaceOutputBuffer(remaining)
        val channels = fmt.channelCount
        val rate = fmt.sampleRate
        val inOrder = inputBuffer.order(ByteOrder.nativeOrder())
        if (fmt.encoding == C.ENCODING_PCM_16BIT) {
            val frameCount = remaining / (2 * channels)
            for (f in 0 until frameCount) {
                val g = gainAt(frames * 1_000_000L / rate)
                for (c in 0 until channels) {
                    val v = inOrder.short.toInt()
                    out.putShort((v * g).toInt().coerceIn(-32768, 32767).toShort())
                }
                frames++
            }
        } else {
            val frameCount = remaining / (4 * channels)
            for (f in 0 until frameCount) {
                val g = gainAt(frames * 1_000_000L / rate)
                for (c in 0 until channels) out.putFloat((inOrder.float * g).coerceIn(-1f, 1f))
                frames++
            }
        }
        inputBuffer.position(inputBuffer.limit())
        out.flip()
    }

    override fun onFlush() {
        frames = 0
    }

    override fun onReset() {
        frames = 0
    }
}

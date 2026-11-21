package com.musii.studio.engine

import android.content.ContentValues
import android.content.Context
import android.net.Uri
import android.os.Build
import android.os.Environment
import android.os.Handler
import android.os.Looper
import android.provider.MediaStore
import androidx.media3.common.MimeTypes
import androidx.media3.effect.FrameDropEffect
import androidx.media3.transformer.Composition
import androidx.media3.common.util.Clock
import androidx.media3.exoplayer.mediacodec.MediaCodecUtil
import androidx.media3.transformer.DefaultAssetLoaderFactory
import androidx.media3.transformer.DefaultDecoderFactory
import androidx.media3.transformer.DefaultEncoderFactory
import androidx.media3.transformer.ExportException
import androidx.media3.transformer.ExportResult
import androidx.media3.transformer.ProgressHolder
import androidx.media3.transformer.Transformer
import androidx.media3.transformer.VideoEncoderSettings
import com.musii.studio.model.Project
import java.io.File

enum class ExportResolution(val title: String, val shortSide: Int) {
    P480("480p", 480), P720("720p", 720), P1080("1080p Full HD", 1080), P1440("2K", 1440), P2160("4K", 2160)
}

enum class ExportCodec(val title: String, val mime: String) {
    H264("H.264 (kompatibel)", MimeTypes.VIDEO_H264), HEVC("HEVC / H.265 (kleiner)", MimeTypes.VIDEO_H265)
}

enum class ExportQuality(val title: String, val factor: Double) {
    LOW("Niedrig", 0.5), RECOMMENDED("Empfohlen", 1.0), HIGH("Hoch", 1.6), MAX("Maximal", 2.6)
}

data class ExportSettings(
    val resolution: ExportResolution = ExportResolution.P1080,
    val fps: Int = 30,
    val codec: ExportCodec = ExportCodec.H264,
    val quality: ExportQuality = ExportQuality.RECOMMENDED,
)

/** Exportiert ein Projekt als MP4 (läuft auf dem Haupt-Thread / einem Looper-Thread). */
class ExportJob(private val context: Context) {
    private var transformer: Transformer? = null
    private val handler = Handler(Looper.getMainLooper())
    private var progressRunnable: Runnable? = null

    companion object {
        fun bitrate(w: Int, h: Int, fps: Int, codec: ExportCodec, quality: ExportQuality): Int {
            var bpp = 0.1 * quality.factor
            if (codec == ExportCodec.HEVC) bpp *= 0.65
            return kotlin.math.max(800_000, (w.toLong() * h * bpp * 30 * (0.6 + 0.4 * fps / 30.0)).toInt())
        }
    }

    @Volatile private var cancelled = false

    fun start(
        project: Project,
        settings: ExportSettings,
        output: File,
        onProgress: (Int) -> Unit,
        limitFps: Boolean = true,
        onDone: (Result<File>) -> Unit,
    ) {
        cancelled = false
        attempt(project, settings, output, onProgress, limitFps, softwareDecoders = false) { r ->
            val e = r.exceptionOrNull()
            if (e != null && !cancelled && isDecoderProblem(e)) {
                // Zweiter Versuch mit Software-Decodern (z.B. bei hängenden Hardware-Decodern)
                onProgress(0)
                attempt(project, settings, output, onProgress, limitFps, softwareDecoders = true, onDone = onDone)
            } else {
                onDone(r)
            }
        }
    }

    private fun isDecoderProblem(e: Throwable): Boolean {
        val ex = e as? ExportException ?: return true
        return ex.errorCode == ExportException.ERROR_CODE_MUXING_TIMEOUT ||
            ex.errorCode == ExportException.ERROR_CODE_DECODER_INIT_FAILED ||
            ex.errorCode == ExportException.ERROR_CODE_DECODING_FAILED ||
            ex.errorCode == ExportException.ERROR_CODE_DECODING_FORMAT_UNSUPPORTED ||
            ex.errorCode == ExportException.ERROR_CODE_VIDEO_FRAME_PROCESSING_FAILED ||
            ex.errorCode == ExportException.ERROR_CODE_UNSPECIFIED
    }

    private fun attempt(
        project: Project,
        settings: ExportSettings,
        output: File,
        onProgress: (Int) -> Unit,
        limitFps: Boolean,
        softwareDecoders: Boolean,
        onDone: (Result<File>) -> Unit,
    ) {
        val (w, h) = CompositionFactory.exportSize(project, settings.resolution.shortSide)
        val p = project.copy(fps = settings.fps)
        // Bildrate begrenzen
        val extra = if (limitFps) listOf(FrameDropEffect.createDefaultFrameDropEffect(settings.fps.toFloat())) else emptyList()
        val built = CompositionFactory.build(context, p, w, h, extra)
        if (built == null) {
            onDone(Result.failure(IllegalStateException("Das Projekt ist leer.")))
            return
        }
        val comp: Composition = built.composition

        output.parentFile?.mkdirs()
        output.delete()
        val encoderFactory = DefaultEncoderFactory.Builder(context)
            .setRequestedVideoEncoderSettings(
                VideoEncoderSettings.Builder().setBitrate(bitrate(w, h, settings.fps, settings.codec, settings.quality)).build()
            )
            .setEnableFallback(true)
            .build()
        val decoderBuilder = DefaultDecoderFactory.Builder(context).setEnableDecoderFallback(true)
        if (softwareDecoders) {
            decoderBuilder.setMediaCodecSelector { mime, secure, tunneling ->
                MediaCodecUtil.getDecoderInfos(mime, secure, tunneling).sortedBy { if (it.softwareOnly) 0 else 1 }
            }
        }
        val t = Transformer.Builder(context)
            .setVideoMimeType(settings.codec.mime)
            .setAudioMimeType(MimeTypes.AUDIO_AAC)
            .setEncoderFactory(encoderFactory)
            .setAssetLoaderFactory(DefaultAssetLoaderFactory(context, decoderBuilder.build(), Clock.DEFAULT, null))
            .setMaxDelayBetweenMuxerSamplesMs(60_000)
            .addListener(object : Transformer.Listener {
                override fun onCompleted(composition: Composition, exportResult: ExportResult) {
                    stopProgress()
                    onProgress(100)
                    onDone(Result.success(output))
                }

                override fun onError(composition: Composition, exportResult: ExportResult, exportException: ExportException) {
                    stopProgress()
                    onDone(Result.failure(exportException))
                }
            })
            .build()
        transformer = t
        t.start(comp, output.absolutePath)
        val holder = ProgressHolder()
        val r = object : Runnable {
            override fun run() {
                val state = t.getProgress(holder)
                if (state == Transformer.PROGRESS_STATE_AVAILABLE) onProgress(holder.progress)
                handler.postDelayed(this, 250)
            }
        }
        progressRunnable = r
        handler.post(r)
    }

    private fun stopProgress() {
        progressRunnable?.let { handler.removeCallbacks(it) }
        progressRunnable = null
    }

    fun cancel() {
        cancelled = true
        stopProgress()
        transformer?.cancel()
    }
}

object Gallery {
    /** Kopiert ein fertiges Video in „Filme/Musii Studio“ (Galerie). */
    fun saveVideo(context: Context, file: File, name: String): Uri? {
        val resolver = context.contentResolver
        val values = ContentValues().apply {
            put(MediaStore.Video.Media.DISPLAY_NAME, name)
            put(MediaStore.Video.Media.MIME_TYPE, "video/mp4")
            if (Build.VERSION.SDK_INT >= 29) {
                put(MediaStore.Video.Media.RELATIVE_PATH, Environment.DIRECTORY_MOVIES + "/Musii Studio")
                put(MediaStore.Video.Media.IS_PENDING, 1)
            }
        }
        val collection = if (Build.VERSION.SDK_INT >= 29) MediaStore.Video.Media.getContentUri(MediaStore.VOLUME_EXTERNAL_PRIMARY)
        else MediaStore.Video.Media.EXTERNAL_CONTENT_URI
        val uri = resolver.insert(collection, values) ?: return null
        resolver.openOutputStream(uri)?.use { out -> file.inputStream().use { it.copyTo(out) } }
        if (Build.VERSION.SDK_INT >= 29) {
            values.clear()
            values.put(MediaStore.Video.Media.IS_PENDING, 0)
            resolver.update(uri, values, null, null)
        }
        return uri
    }

    fun saveImage(context: Context, file: File, name: String): Uri? {
        val resolver = context.contentResolver
        val values = ContentValues().apply {
            put(MediaStore.Images.Media.DISPLAY_NAME, name)
            put(MediaStore.Images.Media.MIME_TYPE, "image/png")
            if (Build.VERSION.SDK_INT >= 29) put(MediaStore.Images.Media.RELATIVE_PATH, Environment.DIRECTORY_PICTURES + "/Musii Studio")
        }
        val collection = if (Build.VERSION.SDK_INT >= 29) MediaStore.Images.Media.getContentUri(MediaStore.VOLUME_EXTERNAL_PRIMARY)
        else MediaStore.Images.Media.EXTERNAL_CONTENT_URI
        val uri = resolver.insert(collection, values) ?: return null
        resolver.openOutputStream(uri)?.use { out -> file.inputStream().use { it.copyTo(out) } }
        return uri
    }
}

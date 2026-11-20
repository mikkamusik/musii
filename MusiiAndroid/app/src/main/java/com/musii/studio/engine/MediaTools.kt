package com.musii.studio.engine

import android.content.Context
import android.graphics.Bitmap
import android.graphics.BitmapFactory
import android.media.ExifInterface
import android.media.MediaCodec
import android.media.MediaExtractor
import android.media.MediaFormat
import android.media.MediaMetadataRetriever
import android.media.MediaRecorder
import android.net.Uri
import android.os.Build
import android.provider.OpenableColumns
import android.speech.tts.TextToSpeech
import android.speech.tts.UtteranceProgressListener
import android.speech.tts.Voice
import com.musii.studio.model.MediaFile
import com.musii.studio.model.MediaKind
import com.musii.studio.model.newId
import kotlinx.coroutines.suspendCancellableCoroutine
import java.io.File
import java.io.FileOutputStream
import java.nio.ByteOrder
import java.util.Locale
import kotlin.coroutines.resume
import kotlin.math.abs
import kotlin.math.max

object Paths {
    fun mediaDir(ctx: Context) = File(ctx.filesDir, "media").apply { mkdirs() }
    fun projectsDir(ctx: Context) = File(ctx.filesDir, "projects").apply { mkdirs() }
    fun thumbsDir(ctx: Context) = File(ctx.filesDir, "thumbs").apply { mkdirs() }
    fun exportsDir(ctx: Context) = File(ctx.cacheDir, "exports").apply { mkdirs() }
}

object MediaImporter {
    private fun displayName(ctx: Context, uri: Uri): String {
        ctx.contentResolver.query(uri, arrayOf(OpenableColumns.DISPLAY_NAME), null, null, null)?.use { c ->
            if (c.moveToFirst()) {
                val i = c.getColumnIndex(OpenableColumns.DISPLAY_NAME)
                if (i >= 0) return c.getString(i) ?: "Datei"
            }
        }
        return uri.lastPathSegment ?: "Datei"
    }

    /** Kopiert eine Datei in den App-Speicher und liest ihre Eigenschaften. */
    fun import(ctx: Context, uri: Uri): MediaFile {
        val name = displayName(ctx, uri)
        val mime = ctx.contentResolver.getType(uri) ?: ""
        val ext = name.substringAfterLast('.', "").lowercase().ifEmpty {
            when {
                mime.startsWith("video") -> "mp4"
                mime.startsWith("image/png") -> "png"
                mime.startsWith("image") -> "jpg"
                mime.startsWith("audio") -> "m4a"
                else -> "bin"
            }
        }
        val target = File(Paths.mediaDir(ctx), newId() + "." + ext)
        ctx.contentResolver.openInputStream(uri).use { input ->
            requireNotNull(input) { "Datei konnte nicht geöffnet werden" }
            FileOutputStream(target).use { input.copyTo(it) }
        }
        return probe(target, name.substringBeforeLast('.'), mime)
    }

    fun probe(file: File, name: String, mimeHint: String = "", generated: Boolean = false): MediaFile {
        val ext = file.extension.lowercase()
        val isImage = mimeHint.startsWith("image") || ext in setOf("jpg", "jpeg", "png", "webp", "heic", "heif", "gif", "bmp")
        if (isImage) {
            val opts = BitmapFactory.Options().apply { inJustDecodeBounds = true }
            BitmapFactory.decodeFile(file.absolutePath, opts)
            var w = opts.outWidth
            var h = opts.outHeight
            try {
                val o = ExifInterface(file.absolutePath).getAttributeInt(ExifInterface.TAG_ORIENTATION, ExifInterface.ORIENTATION_NORMAL)
                if (o == ExifInterface.ORIENTATION_ROTATE_90 || o == ExifInterface.ORIENTATION_ROTATE_270 ||
                    o == ExifInterface.ORIENTATION_TRANSPOSE || o == ExifInterface.ORIENTATION_TRANSVERSE) {
                    val t = w; w = h; h = t
                }
            } catch (_: Exception) {}
            require(w > 0 && h > 0) { "Bild konnte nicht gelesen werden: $name" }
            return MediaFile(name = name, path = file.absolutePath, kind = MediaKind.IMAGE, durationUs = 0, width = w, height = h,
                hasAudio = false, generated = generated)
        }
        val r = MediaMetadataRetriever()
        try {
            r.setDataSource(file.absolutePath)
            val durMs = r.extractMetadata(MediaMetadataRetriever.METADATA_KEY_DURATION)?.toLongOrNull() ?: 0L
            val hasVideo = r.extractMetadata(MediaMetadataRetriever.METADATA_KEY_HAS_VIDEO) == "yes"
            val hasAudio = r.extractMetadata(MediaMetadataRetriever.METADATA_KEY_HAS_AUDIO) == "yes"
            require(durMs > 0 && (hasVideo || hasAudio)) { "Datei wird nicht unterstützt: $name" }
            if (hasVideo) {
                val w = r.extractMetadata(MediaMetadataRetriever.METADATA_KEY_VIDEO_WIDTH)?.toIntOrNull() ?: 0
                val h = r.extractMetadata(MediaMetadataRetriever.METADATA_KEY_VIDEO_HEIGHT)?.toIntOrNull() ?: 0
                val rot = r.extractMetadata(MediaMetadataRetriever.METADATA_KEY_VIDEO_ROTATION)?.toIntOrNull() ?: 0
                val rotated = rot == 90 || rot == 270
                return MediaFile(name = name, path = file.absolutePath, kind = MediaKind.VIDEO, durationUs = durMs * 1000,
                    width = if (rotated) h else w, height = if (rotated) w else h, hasAudio = hasAudio, generated = generated, rotation = rot)
            }
            return MediaFile(name = name, path = file.absolutePath, kind = MediaKind.AUDIO, durationUs = durMs * 1000,
                width = 0, height = 0, hasAudio = true, generated = generated)
        } finally {
            r.release()
        }
    }
}

object Thumbnails {
    const val STRIP = 12

    fun strip(ctx: Context, m: MediaFile): List<Bitmap> {
        val dir = File(Paths.thumbsDir(ctx), m.id).apply { mkdirs() }
        val count = if (m.kind == MediaKind.IMAGE) 1 else STRIP
        val cached = (0 until count).map { File(dir, "$it.jpg") }
        if (cached.all { it.exists() }) return cached.mapNotNull { BitmapFactory.decodeFile(it.absolutePath) }
        val out = ArrayList<Bitmap>()
        if (m.kind == MediaKind.IMAGE) {
            val opts = BitmapFactory.Options().apply { inSampleSize = sampleSize(m.width, m.height, 240) }
            var b = BitmapFactory.decodeFile(m.path, opts) ?: return emptyList()
            b = rotateByExif(m.path, b)
            out.add(b)
        } else if (m.kind == MediaKind.VIDEO) {
            val r = MediaMetadataRetriever()
            try {
                r.setDataSource(m.path)
                for (i in 0 until count) {
                    val t = m.durationUs * (i + 0.5) / count
                    val f = r.getFrameAtTime(t.toLong(), MediaMetadataRetriever.OPTION_CLOSEST_SYNC) ?: out.lastOrNull() ?: continue
                    val scale = 160f / max(f.width, f.height)
                    out.add(if (scale < 1) Bitmap.createScaledBitmap(f, (f.width * scale).toInt().coerceAtLeast(1), (f.height * scale).toInt().coerceAtLeast(1), true) else f)
                }
            } catch (_: Exception) {
            } finally {
                r.release()
            }
        }
        out.forEachIndexed { i, b ->
            try { FileOutputStream(File(dir, "$i.jpg")).use { b.compress(Bitmap.CompressFormat.JPEG, 80, it) } } catch (_: Exception) {}
        }
        return out
    }

    private fun sampleSize(w: Int, h: Int, target: Int): Int {
        var s = 1
        while (max(w, h) / (s * 2) >= target) s *= 2
        return s
    }

    fun rotateByExif(path: String, b: Bitmap): Bitmap {
        return try {
            val o = ExifInterface(path).getAttributeInt(ExifInterface.TAG_ORIENTATION, ExifInterface.ORIENTATION_NORMAL)
            val deg = when (o) {
                ExifInterface.ORIENTATION_ROTATE_90 -> 90f
                ExifInterface.ORIENTATION_ROTATE_180 -> 180f
                ExifInterface.ORIENTATION_ROTATE_270 -> 270f
                else -> 0f
            }
            if (deg == 0f) b else {
                val mtx = android.graphics.Matrix().apply { postRotate(deg) }
                Bitmap.createBitmap(b, 0, 0, b.width, b.height, mtx, true)
            }
        } catch (_: Exception) { b }
    }

    /** Wellenform: Spitzenwerte (0..1), 40 pro Sekunde */
    fun waveform(ctx: Context, m: MediaFile): FloatArray {
        val cache = File(Paths.thumbsDir(ctx), m.id + ".wave")
        if (cache.exists()) {
            val bytes = cache.readBytes()
            return FloatArray(bytes.size) { (bytes[it].toInt() and 0xFF) / 255f }
        }
        val peaks = ArrayList<Float>()
        val ex = MediaExtractor()
        var codec: MediaCodec? = null
        try {
            ex.setDataSource(m.path)
            var track = -1
            for (i in 0 until ex.trackCount) {
                if (ex.getTrackFormat(i).getString(MediaFormat.KEY_MIME)?.startsWith("audio/") == true) { track = i; break }
            }
            if (track < 0) return FloatArray(0)
            ex.selectTrack(track)
            val fmt = ex.getTrackFormat(track)
            val mime = fmt.getString(MediaFormat.KEY_MIME)!!
            val rate = fmt.getInteger(MediaFormat.KEY_SAMPLE_RATE)
            val channels = fmt.getInteger(MediaFormat.KEY_CHANNEL_COUNT)
            val c = MediaCodec.createDecoderByType(mime)
            codec = c
            c.configure(fmt, null, null, 0)
            c.start()
            val bucket = max(1, rate / 40)
            var cur = 0
            var cnt = 0
            val info = MediaCodec.BufferInfo()
            var inputDone = false
            var outputDone = false
            var guard = 0
            while (!outputDone && guard < 2_000_000) {
                guard++
                if (!inputDone) {
                    val ii = c.dequeueInputBuffer(5000)
                    if (ii >= 0) {
                        val buf = c.getInputBuffer(ii)!!
                        val n = ex.readSampleData(buf, 0)
                        if (n < 0) {
                            c.queueInputBuffer(ii, 0, 0, 0, MediaCodec.BUFFER_FLAG_END_OF_STREAM)
                            inputDone = true
                        } else {
                            c.queueInputBuffer(ii, 0, n, ex.sampleTime, 0)
                            ex.advance()
                        }
                    }
                }
                val oi = c.dequeueOutputBuffer(info, 5000)
                if (oi >= 0) {
                    val ob = c.getOutputBuffer(oi)!!.order(ByteOrder.nativeOrder())
                    ob.position(info.offset)
                    ob.limit(info.offset + info.size)
                    val shorts = ob.asShortBuffer()
                    val frames = shorts.remaining() / max(1, channels)
                    for (f in 0 until frames) {
                        val v = abs(shorts.get(f * channels).toInt())
                        if (v > cur) cur = v
                        cnt++
                        if (cnt >= bucket) { peaks.add(cur / 32768f); cur = 0; cnt = 0 }
                    }
                    c.releaseOutputBuffer(oi, false)
                    if (info.flags and MediaCodec.BUFFER_FLAG_END_OF_STREAM != 0) outputDone = true
                }
            }
        } catch (_: Exception) {
        } finally {
            try { codec?.stop() } catch (_: Exception) {}
            codec?.release()
            ex.release()
        }
        val arr = peaks.toFloatArray()
        try { cache.writeBytes(ByteArray(arr.size) { (arr[it].coerceIn(0f, 1f) * 255).toInt().toByte() }) } catch (_: Exception) {}
        return arr
    }
}

object Tools {
    /** Standbild eines Videos als PNG */
    fun freezeFrame(ctx: Context, m: MediaFile, sourceUs: Long): File {
        val r = MediaMetadataRetriever()
        try {
            r.setDataSource(m.path)
            val bmp = r.getFrameAtTime(sourceUs.coerceIn(0, max(0, m.durationUs - 10_000)), MediaMetadataRetriever.OPTION_CLOSEST)
                ?: throw IllegalStateException("Standbild konnte nicht gelesen werden")
            val f = File(Paths.mediaDir(ctx), "standbild-" + newId().take(8) + ".png")
            FileOutputStream(f).use { bmp.compress(Bitmap.CompressFormat.PNG, 100, it) }
            return f
        } finally {
            r.release()
        }
    }

    /** Text zu Sprache als WAV-Datei */
    suspend fun textToSpeech(ctx: Context, text: String, voiceName: String?, rate: Float, pitch: Float): File = suspendCancellableCoroutine { cont ->
        val out = File(Paths.mediaDir(ctx), "sprache-" + newId().take(8) + ".wav")
        var tts: TextToSpeech? = null
        tts = TextToSpeech(ctx.applicationContext) { status ->
            val engine = tts ?: return@TextToSpeech
            if (status != TextToSpeech.SUCCESS) {
                if (cont.isActive) cont.resumeWith(Result.failure(IllegalStateException("Sprachausgabe nicht verfügbar")))
                engine.shutdown()
                return@TextToSpeech
            }
            val voice: Voice? = voiceName?.let { n -> engine.voices?.firstOrNull { it.name == n } }
            if (voice != null) engine.voice = voice else engine.language = Locale.GERMAN
            engine.setSpeechRate(rate)
            engine.setPitch(pitch)
            engine.setOnUtteranceProgressListener(object : UtteranceProgressListener() {
                override fun onStart(utteranceId: String?) {}
                override fun onDone(utteranceId: String?) {
                    engine.shutdown()
                    if (cont.isActive) cont.resume(out)
                }
                @Deprecated("Deprecated in Java")
                override fun onError(utteranceId: String?) {
                    engine.shutdown()
                    if (cont.isActive) cont.resumeWith(Result.failure(IllegalStateException("Sprachausgabe fehlgeschlagen")))
                }
            })
            engine.synthesizeToFile(text, null, out, "musii")
        }
        cont.invokeOnCancellation { tts?.shutdown() }
    }

    fun voices(ctx: Context, onReady: (List<Voice>) -> Unit) {
        var tts: TextToSpeech? = null
        tts = TextToSpeech(ctx.applicationContext) { status ->
            val list = if (status == TextToSpeech.SUCCESS) tts?.voices?.filter { !it.isNetworkConnectionRequired || true }?.sortedBy { it.locale.toString() + it.name } ?: emptyList() else emptyList()
            onReady(list)
            tts?.shutdown()
        }
    }
}

/** Sprachaufnahme mit dem Mikrofon */
class VoiceRecorder(private val ctx: Context) {
    private var recorder: MediaRecorder? = null
    var file: File? = null
        private set

    fun start(): File {
        val f = File(Paths.mediaDir(ctx), "aufnahme-" + newId().take(8) + ".m4a")
        val r = if (Build.VERSION.SDK_INT >= 31) MediaRecorder(ctx) else @Suppress("DEPRECATION") MediaRecorder()
        r.setAudioSource(MediaRecorder.AudioSource.MIC)
        r.setOutputFormat(MediaRecorder.OutputFormat.MPEG_4)
        r.setAudioEncoder(MediaRecorder.AudioEncoder.AAC)
        r.setAudioEncodingBitRate(128_000)
        r.setAudioSamplingRate(44_100)
        r.setOutputFile(f.absolutePath)
        r.prepare()
        r.start()
        recorder = r
        file = f
        return f
    }

    fun level(): Float = try { (recorder?.maxAmplitude ?: 0) / 32767f } catch (_: Exception) { 0f }

    fun stop(): File? {
        val r = recorder ?: return null
        try { r.stop() } catch (_: Exception) {}
        r.release()
        recorder = null
        return file
    }
}

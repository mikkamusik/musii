package com.musii.studio

import android.content.Context
import android.content.Intent
import android.graphics.Bitmap
import android.graphics.Canvas
import android.media.MediaMetadataRetriever
import android.util.Log
import androidx.test.ext.junit.runners.AndroidJUnit4
import androidx.test.platform.app.InstrumentationRegistry
import com.musii.studio.data.ProjectStore
import com.musii.studio.engine.CompositionFactory
import com.musii.studio.engine.ExportJob
import com.musii.studio.engine.ExportResolution
import com.musii.studio.engine.ExportSettings
import com.musii.studio.engine.MediaImporter
import com.musii.studio.engine.Paths
import com.musii.studio.engine.Thumbnails
import com.musii.studio.engine.Tools
import com.musii.studio.model.*
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.FixMethodOrder
import org.junit.Test
import org.junit.runner.RunWith
import org.junit.runners.MethodSorters
import java.io.File
import java.io.FileOutputStream
import java.util.concurrent.CountDownLatch
import java.util.concurrent.TimeUnit

@RunWith(AndroidJUnit4::class)
@FixMethodOrder(MethodSorters.NAME_ASCENDING)
class EngineTest {
    private val inst = InstrumentationRegistry.getInstrumentation()
    private val ctx: Context = inst.targetContext
    private val out: File by lazy { File(ctx.getExternalFilesDir(null), "test-out").apply { mkdirs() } }

    private fun asset(name: String): File {
        val f = File(Paths.mediaDir(ctx), "test-$name")
        inst.context.assets.open(name).use { input -> FileOutputStream(f).use { input.copyTo(it) } }
        return f
    }

    private fun media(): List<MediaFile> = listOf(
        MediaImporter.probe(asset("a.mp4"), "a-landschaft", "video/mp4"),
        MediaImporter.probe(asset("b.mp4"), "b-hochkant", "video/mp4"),
        MediaImporter.probe(asset("c.png"), "c-foto", "image/png"),
        MediaImporter.probe(asset("d.m4a"), "d-musik", "audio/mp4"),
    )

    private fun demoProject(items: List<MediaFile>, aspect: AspectPreset): Project {
        val (a, b, c, d) = items
        val c1 = Clip(mediaId = a.id, sourceDurationUs = 3_000_000, filter = FilterSetting("vivid", 0.8f),
            transition = TransitionSetting(TransitionKind.DISSOLVE, 600_000), animIn = AnimSetting(AnimKind.ZOOM_IN, 500_000))
        val c2 = Clip(mediaId = c.id, sourceDurationUs = 2_000_000, loop = LoopAnim.KEN_BURNS, transition = TransitionSetting(TransitionKind.PUSH_LEFT, 500_000))
        val c3 = Clip(mediaId = b.id, sourceStartUs = 200_000, sourceDurationUs = 2_200_000, speed = 2f,
            effects = listOf(EffectSetting(kind = EffectKind.GLITCH, intensity = 0.7f)), fadeOutUs = 300_000)
        val ov = Clip(mediaId = a.id, sourceDurationUs = 1_500_000, startUs = 1_000_000,
            transform = Transform2D(x = 0.75f, scale = 0.4f), mask = MaskSetting(kind = MaskKind.CIRCLE, size = 0.8f, feather = 0.1f))
        val au = Clip(mediaId = d.id, sourceDurationUs = 4_000_000, startUs = 500_000, fadeInUs = 500_000, fadeOutUs = 1_000_000, volume = 0.7f)
        val title = TextClip(text = "Hallo Musii! 🎬", style = TextCatalog.presets[3].style, startUs = 200_000, durationUs = 2_500_000,
            animIn = AnimSetting(AnimKind.POP, 400_000), transform = Transform2D(y = 0.25f))
        val sticker = TextClip(kind = TextKind.EMOJI, text = "🔥", style = TextStyle(fontSize = 150f), startUs = 1_000_000, durationUs = 2_000_000,
            transform = Transform2D(x = 0.85f), loop = LoopAnim.PULSE, lane = 1)
        val typer = TextClip(text = "Schreibmaschine", startUs = 3_000_000, durationUs = 1_500_000, animIn = AnimSetting(AnimKind.TYPEWRITER, 1_000_000), lane = 2)
        return Project(
            name = "Selbsttest", aspect = aspect, background = CanvasBackground(BackgroundMode.BLUR, RGBA.Black, 0.6f),
            media = items, main = listOf(c1, c2, c3), overlays = listOf(ov), audio = listOf(au), texts = listOf(title, sticker, typer),
            effects = listOf(EffectClip(kind = EffectKind.SNOW, intensity = 0.6f, startUs = 0, durationUs = 2_000_000),
                EffectClip(kind = EffectKind.VHS, intensity = 0.5f, startUs = 3_000_000, durationUs = 1_000_000, lane = 1)),
        )
    }

    private fun describe(e: Throwable?): String {
        val sb = StringBuilder()
        var c = e
        var depth = 0
        while (c != null && depth < 8) {
            sb.append(c.javaClass.simpleName).append(": ").append(c.message).append(" | ")
            if (c is androidx.media3.transformer.ExportException) sb.append("code=").append(c.errorCodeName).append(" | ")
            c = c.cause
            depth++
        }
        return sb.toString()
    }

    private fun export(p: Project, settings: ExportSettings, file: File, limitFps: Boolean = true): Result<File> {
        val latch = CountDownLatch(1)
        var result: Result<File> = Result.failure(IllegalStateException("Zeitüberschreitung"))
        var job: ExportJob? = null
        val started = System.currentTimeMillis()
        var lastLogged = -10
        inst.runOnMainSync {
            job = ExportJob(ctx).also { j ->
                j.start(p, settings, file, onProgress = { pr ->
                    if (pr >= lastLogged + 10 || pr < lastLogged) {
                        lastLogged = pr
                        Log.i("MusiiTest", "Export ${file.name}: $pr % nach ${(System.currentTimeMillis() - started) / 1000} s")
                    }
                }, limitFps = limitFps) { r -> result = r; latch.countDown() }
            }
        }
        if (!latch.await(600, TimeUnit.SECONDS)) {
            // Hängenden Export abbrechen, damit er die folgenden Tests nicht ausbremst
            inst.runOnMainSync { job?.cancel() }
        }
        Log.i("MusiiTest", "Export ${file.name} beendet nach ${(System.currentTimeMillis() - started) / 1000} s: ${if (result.isSuccess) "OK" else "Fehler"}")
        result.exceptionOrNull()?.let { Log.e("MusiiTest", "Export ${file.name} fehlgeschlagen: ${describe(it)}", it) }
        return result
    }

    @Test
    fun aExportMatrix() {
        val items = media()
        val (a, b, c, d) = items
        val base = Project(name = "Matrix", aspect = AspectPreset.R16x9, media = items)
        val va = Clip(mediaId = a.id, sourceDurationUs = 2_000_000)
        val img = Clip(mediaId = c.id, sourceDurationUs = 1_000_000)
        val cases = linkedMapOf(
            "A-ein-video" to base.copy(main = listOf(va)),
            "A2-ohne-framedrop" to base.copy(main = listOf(va)),
            "B-video-bild" to base.copy(main = listOf(va, img)),
            "B2-nur-bild" to base.copy(main = listOf(img)),
            "C-uebergang" to base.copy(main = listOf(va.copy(transition = TransitionSetting(TransitionKind.DISSOLVE, 500_000)), img.copy(id = newId()))),
            "D-overlay" to base.copy(main = listOf(va), overlays = listOf(Clip(mediaId = c.id, sourceDurationUs = 1_000_000, startUs = 500_000, transform = Transform2D(scale = 0.4f)))),
            "E-musik" to base.copy(main = listOf(va), audio = listOf(Clip(mediaId = d.id, sourceDurationUs = 1_500_000, startUs = 0))),
            "E2-musik-spaeter" to base.copy(main = listOf(va), audio = listOf(Clip(mediaId = d.id, sourceDurationUs = 1_000_000, startUs = 500_000))),
            "F-text-effekt" to base.copy(main = listOf(va), texts = listOf(TextClip(text = "Hallo", startUs = 0, durationUs = 1_000_000)), effects = listOf(EffectClip(kind = EffectKind.VHS, startUs = 0, durationUs = 1_000_000))),
            "G-tempo" to base.copy(main = listOf(va.copy(speed = 2f))),
            "H-hochkant" to base.copy(main = listOf(Clip(mediaId = b.id, sourceDurationUs = 2_000_000))),
            "I-video-luecke-video" to base.copy(main = listOf(Clip(mediaId = c.id, sourceDurationUs = 2_500_000)),
                overlays = listOf(Clip(mediaId = a.id, sourceDurationUs = 1_000_000, startUs = 0, transform = Transform2D(scale = 0.5f)),
                    Clip(mediaId = a.id, sourceStartUs = 1_000_000, sourceDurationUs = 1_000_000, startUs = 1_200_000, transform = Transform2D(scale = 0.5f)))),
            "J-drei-uebergaenge" to base.copy(main = listOf(
                Clip(mediaId = a.id, sourceDurationUs = 1_000_000, transition = TransitionSetting(TransitionKind.DISSOLVE, 400_000)),
                Clip(mediaId = c.id, sourceDurationUs = 1_000_000, transition = TransitionSetting(TransitionKind.WIPE_LEFT, 400_000)),
                Clip(mediaId = a.id, sourceStartUs = 1_000_000, sourceDurationUs = 1_000_000))),
            "K-fuenf-uebergaenge" to base.copy(main = (0 until 5).map { i ->
                Clip(mediaId = if (i % 2 == 0) a.id else c.id, sourceDurationUs = 1_000_000,
                    transition = if (i < 4) TransitionSetting(TransitionKind.entries[1 + i], 400_000) else null)
            }),
        )
        val report = StringBuilder()
        for ((name, p) in cases) {
            val f = File(out, "matrix-$name.mp4")
            val r = export(p, ExportSettings(resolution = ExportResolution.P480, fps = 30), f, limitFps = name != "A2-ohne-framedrop")
            val line = "$name: " + (if (r.isSuccess) "OK (${f.length()} Bytes)" else "FEHLER " + describe(r.exceptionOrNull()))
            Log.i("MusiiTest", line)
            report.append(line).append('\n')
        }
        File(out, "matrix.txt").writeText(report.toString())
    }

    private fun contactSheet(video: File, name: String, times: List<Long>) {
        val r = MediaMetadataRetriever()
        r.setDataSource(video.absolutePath)
        val frames = times.mapNotNull { r.getFrameAtTime(it, MediaMetadataRetriever.OPTION_CLOSEST) }
        r.release()
        if (frames.isEmpty()) return
        val tw = 320
        val th = (tw * frames[0].height.toFloat() / frames[0].width).toInt()
        val cols = 4
        val rows = (frames.size + cols - 1) / cols
        val sheet = Bitmap.createBitmap(tw * cols, th * rows, Bitmap.Config.ARGB_8888)
        val cv = Canvas(sheet)
        frames.forEachIndexed { i, f ->
            cv.drawBitmap(Bitmap.createScaledBitmap(f, tw, th, true), (i % cols * tw).toFloat(), (i / cols * th).toFloat(), null)
        }
        FileOutputStream(File(out, name)).use { sheet.compress(Bitmap.CompressFormat.PNG, 100, it) }
    }

    @Test
    fun importDetectsMedia() {
        val m = media()
        assertEquals(MediaKind.VIDEO, m[0].kind)
        assertTrue("Dauer A", kotlin.math.abs(m[0].durationUs - 3_000_000) < 150_000)
        assertTrue("A hat Ton", m[0].hasAudio)
        Log.i("MusiiTest", "B: ${m[1].width}x${m[1].height} rot=${m[1].rotation}")
        assertTrue("B hochkant", m[1].height > m[1].width)
        assertEquals(MediaKind.IMAGE, m[2].kind)
        assertEquals(MediaKind.AUDIO, m[3].kind)
        assertTrue("Filmstreifen", Thumbnails.strip(ctx, m[0]).isNotEmpty())
        assertTrue("Wellenform", Thumbnails.waveform(ctx, m[0]).size > 50)
        val freeze = Tools.freezeFrame(ctx, m[1], 1_000_000)
        assertTrue("Standbild", freeze.length() > 1000)
    }

    @Test
    fun exportLandscapeWithAllFeatures() {
        val p = demoProject(media(), AspectPreset.R16x9)
        val expected = p.durationUs
        val f = File(out, "export-16x9.mp4")
        val r = export(p, ExportSettings(resolution = ExportResolution.P720, fps = 30), f)
        assertTrue("Export fehlgeschlagen: ${describe(r.exceptionOrNull())}", r.isSuccess)
        val mr = MediaMetadataRetriever()
        mr.setDataSource(f.absolutePath)
        val dur = mr.extractMetadata(MediaMetadataRetriever.METADATA_KEY_DURATION)!!.toLong() * 1000
        val w = mr.extractMetadata(MediaMetadataRetriever.METADATA_KEY_VIDEO_WIDTH)!!.toInt()
        val h = mr.extractMetadata(MediaMetadataRetriever.METADATA_KEY_VIDEO_HEIGHT)!!.toInt()
        val audio = mr.extractMetadata(MediaMetadataRetriever.METADATA_KEY_HAS_AUDIO)
        mr.release()
        Log.i("MusiiTest", "Export: ${dur}us erwartet $expected, ${w}x$h audio=$audio")
        assertTrue("Dauer $dur ≈ $expected", kotlin.math.abs(dur - expected) < 300_000)
        assertEquals(1280, w)
        assertEquals(720, h)
        assertEquals("yes", audio)
        contactSheet(f, "sheet-16x9.png", (0 until 12).map { it * 450_000L + 100_000 })
    }

    @Test
    fun exportPortrait() {
        val p = demoProject(media(), AspectPreset.R9x16)
        val f = File(out, "export-9x16.mp4")
        val r = export(p, ExportSettings(resolution = ExportResolution.P720, fps = 30), f)
        assertTrue("Export fehlgeschlagen: ${describe(r.exceptionOrNull())}", r.isSuccess)
        val mr = MediaMetadataRetriever()
        mr.setDataSource(f.absolutePath)
        val cw = mr.extractMetadata(MediaMetadataRetriever.METADATA_KEY_VIDEO_WIDTH)!!.toInt()
        val ch = mr.extractMetadata(MediaMetadataRetriever.METADATA_KEY_VIDEO_HEIGHT)!!.toInt()
        val rot = mr.extractMetadata(MediaMetadataRetriever.METADATA_KEY_VIDEO_ROTATION)?.toIntOrNull() ?: 0
        mr.release()
        // Der Encoder darf quer kodieren und die Drehung als Metadaten speichern – angezeigt wird hochkant
        val (w, h) = if (rot % 180 != 0) ch to cw else cw to ch
        Log.i("MusiiTest", "Hochkant-Export: ${cw}x$ch rot=$rot → ${w}x$h")
        assertEquals(720, w)
        assertEquals(1280, h)
        contactSheet(f, "sheet-9x16.png", (0 until 12).map { it * 450_000L + 100_000 })
    }

    @Test
    fun allTransitionsAndEffectsExport() {
        val items = media()
        val a = items[0]
        val img = items[2]
        // Alle Übergänge nacheinander (kurze Clips), alle Effekte als Ebenen
        val clips = TransitionKind.entries.filter { it != TransitionKind.NONE }.mapIndexed { i, k ->
            Clip(mediaId = if (i % 2 == 0) a.id else img.id, sourceDurationUs = 1_000_000, transition = TransitionSetting(k, 400_000),
                filter = FilterSetting(FilterCatalog.all[i % FilterCatalog.all.size].id, 1f))
        }
        val effects = EffectKind.entries.mapIndexed { i, k -> EffectClip(kind = k, startUs = i * 300_000L, durationUs = 300_000) }
        val p = Project(name = "Alle", aspect = AspectPreset.R1x1, media = items, main = clips, effects = effects)
        val f = File(out, "export-alle.mp4")
        val r = export(p, ExportSettings(resolution = ExportResolution.P480, fps = 25), f)
        assertTrue("Export fehlgeschlagen: ${describe(r.exceptionOrNull())}", r.isSuccess)
        contactSheet(f, "sheet-alle.png", (0 until 16).map { it * 650_000L + 200_000 })
    }

    /** Läuft zuletzt (Name), damit die Vorschau im Emulator keine Exporte ausbremst. */
    @Test
    fun zEditorScreenshots() {
        val items = media()
        val store = ProjectStore(ctx)
        val p = demoProject(items, AspectPreset.R9x16).copy(name = "Demo-Projekt")
        store.save(p)
        val intent = Intent(ctx, MainActivity::class.java).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
        val home = inst.startActivitySync(intent)
        Thread.sleep(4000)
        save(inst.uiAutomation.takeScreenshot(), "ui-1-start.png")
        val intent2 = Intent(ctx, MainActivity::class.java).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_CLEAR_TASK).putExtra("projectId", p.id)
        val editor = inst.startActivitySync(intent2)
        Thread.sleep(9000)
        save(inst.uiAutomation.takeScreenshot(), "ui-2-editor.png")
        // Editor schließen und die Vorschau freigeben
        inst.runOnMainSync { editor.finish(); home.finish() }
        Thread.sleep(2000)
    }

    private fun save(b: Bitmap?, name: String) {
        b ?: return
        FileOutputStream(File(out, name)).use { b.compress(Bitmap.CompressFormat.PNG, 100, it) }
    }
}

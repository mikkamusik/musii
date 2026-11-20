package com.musii.studio.ui

import android.content.Intent
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.LazyRow
import androidx.compose.foundation.lazy.items
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.compose.ui.window.Dialog
import androidx.compose.ui.window.DialogProperties
import androidx.core.content.FileProvider
import com.musii.studio.editor.EditorState
import com.musii.studio.engine.CompositionFactory
import com.musii.studio.engine.ExportCodec
import com.musii.studio.engine.ExportJob
import com.musii.studio.engine.ExportQuality
import com.musii.studio.engine.ExportResolution
import com.musii.studio.engine.ExportSettings
import com.musii.studio.engine.Gallery
import com.musii.studio.engine.Paths
import java.io.File

@Composable
fun ExportDialog(editor: EditorState, onDismiss: () -> Unit) {
    val ctx = LocalContext.current
    var settings by remember { mutableStateOf(ExportSettings()) }
    var progress by remember { mutableStateOf<Int?>(null) }
    var result by remember { mutableStateOf<File?>(null) }
    var error by remember { mutableStateOf<String?>(null) }
    var saved by remember { mutableStateOf(false) }
    var job by remember { mutableStateOf<ExportJob?>(null) }

    Dialog(onDismissRequest = { if (progress == null) onDismiss() }, properties = DialogProperties(usePlatformDefaultWidth = false)) {
        Surface(shape = MaterialTheme.shapes.large, color = C.panel, modifier = Modifier.fillMaxWidth(0.94f)) {
            Column(Modifier.padding(20.dp)) {
                Row {
                    Text("Exportieren", fontSize = 18.sp, fontWeight = FontWeight.SemiBold, modifier = Modifier.weight(1f))
                    Text("ohne Wasserzeichen", fontSize = 11.sp, color = C.accent)
                }
                Spacer(Modifier.height(12.dp))
                val res = result
                when {
                    progress != null && res == null && error == null -> {
                        Text("Video wird erstellt … ${progress}%", fontSize = 14.sp)
                        Spacer(Modifier.height(10.dp))
                        LinearProgressIndicator(progress = { (progress ?: 0) / 100f }, modifier = Modifier.fillMaxWidth())
                        Spacer(Modifier.height(14.dp))
                        TextButton(onClick = { job?.cancel(); progress = null }) { Text("Abbrechen") }
                    }
                    res != null -> {
                        Text("✓ Fertig!", fontSize = 16.sp, color = Color(0xFF4CD964), fontWeight = FontWeight.SemiBold)
                        Text(if (saved) "Gespeichert in Galerie › Filme › Musii Studio" else "Video erstellt.", fontSize = 12.sp, color = C.text2)
                        Spacer(Modifier.height(14.dp))
                        Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                            Pill("Teilen", prominent = true, modifier = Modifier.weight(1f)) {
                                val uri = FileProvider.getUriForFile(ctx, ctx.packageName + ".files", res)
                                val i = Intent(Intent.ACTION_SEND).setType("video/mp4").putExtra(Intent.EXTRA_STREAM, uri).addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION)
                                ctx.startActivity(Intent.createChooser(i, "Video teilen"))
                            }
                            Pill("Abspielen", modifier = Modifier.weight(1f)) {
                                val uri = FileProvider.getUriForFile(ctx, ctx.packageName + ".files", res)
                                val i = Intent(Intent.ACTION_VIEW).setDataAndType(uri, "video/mp4").addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION)
                                try { ctx.startActivity(i) } catch (_: Exception) {}
                            }
                            Pill("Fertig", modifier = Modifier.weight(1f)) { onDismiss() }
                        }
                    }
                    else -> {
                        Text("Auflösung", fontSize = 12.sp, color = C.text2)
                        LazyRow(horizontalArrangement = Arrangement.spacedBy(6.dp), modifier = Modifier.padding(vertical = 4.dp)) {
                            items(ExportResolution.entries) { r -> Tile(r.title, settings.resolution == r, modifier = Modifier.width(92.dp)) { settings = settings.copy(resolution = r) } }
                        }
                        Text("Bildrate", fontSize = 12.sp, color = C.text2)
                        Row(horizontalArrangement = Arrangement.spacedBy(6.dp), modifier = Modifier.padding(vertical = 4.dp)) {
                            listOf(24, 25, 30, 50, 60).forEach { f -> Tile("$f", settings.fps == f, modifier = Modifier.weight(1f)) { settings = settings.copy(fps = f) } }
                        }
                        Text("Format", fontSize = 12.sp, color = C.text2)
                        Row(horizontalArrangement = Arrangement.spacedBy(6.dp), modifier = Modifier.padding(vertical = 4.dp)) {
                            ExportCodec.entries.forEach { c -> Tile(c.title, settings.codec == c, modifier = Modifier.weight(1f)) { settings = settings.copy(codec = c) } }
                        }
                        Text("Qualität", fontSize = 12.sp, color = C.text2)
                        Row(horizontalArrangement = Arrangement.spacedBy(6.dp), modifier = Modifier.padding(vertical = 4.dp)) {
                            ExportQuality.entries.forEach { q -> Tile(q.title, settings.quality == q, modifier = Modifier.weight(1f)) { settings = settings.copy(quality = q) } }
                        }
                        val (w, h) = CompositionFactory.exportSize(editor.project, settings.resolution.shortSide)
                        val mb = ExportJob.bitrate(w, h, settings.fps, settings.codec, settings.quality) / 8.0 / 1_000_000 * (editor.project.durationUs / 1e6) + editor.project.durationUs / 1e6 * 0.03
                        Text("$w × $h · ${formatTime(editor.project.durationUs)} · ca. ${"%.0f".format(mb.coerceAtLeast(1.0))} MB", fontSize = 12.sp, color = C.text2, modifier = Modifier.padding(vertical = 8.dp))
                        error?.let { Text("Fehler: $it", color = Color(0xFFFF6B6B), fontSize = 12.sp) }
                        Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                            Pill("Abbrechen", modifier = Modifier.weight(1f)) { onDismiss() }
                            Pill("Exportieren", prominent = true, modifier = Modifier.weight(1f)) {
                                if (editor.project.durationUs <= 0) { error = "Das Projekt ist leer."; return@Pill }
                                editor.saveNow()
                                error = null
                                progress = 0
                                val safe = editor.project.name.replace(Regex("[^A-Za-z0-9äöüÄÖÜß _-]"), "_")
                                val out = File(Paths.exportsDir(ctx), "$safe.mp4")
                                val j = ExportJob(ctx)
                                job = j
                                j.start(editor.project, settings, out, onProgress = { progress = it }) { r ->
                                    r.onSuccess { f ->
                                        saved = try { Gallery.saveVideo(ctx, f, "$safe.mp4") != null } catch (_: Exception) { false }
                                        result = f
                                    }.onFailure { e ->
                                        error = e.message ?: "Unbekannter Fehler"
                                        progress = null
                                    }
                                }
                            }
                        }
                    }
                }
            }
        }
    }
}

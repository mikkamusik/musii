package com.musii.studio.ui

import android.Manifest
import android.content.pm.PackageManager
import android.view.SurfaceView
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.PickVisualMediaRequest
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.foundation.Canvas
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.gestures.detectTapGestures
import androidx.compose.foundation.gestures.detectTransformGestures
import androidx.compose.foundation.horizontalScroll
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.ArrowBack
import androidx.compose.material.icons.automirrored.filled.Redo
import androidx.compose.material.icons.automirrored.filled.Undo
import androidx.compose.material.icons.filled.*
import androidx.compose.material.icons.outlined.Diamond
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.geometry.Size
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.drawscope.Stroke
import androidx.compose.ui.graphics.drawscope.rotate
import androidx.compose.ui.input.pointer.pointerInput
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.compose.ui.viewinterop.AndroidView
import androidx.core.content.ContextCompat
import com.musii.studio.editor.EditorState
import com.musii.studio.editor.Sel
import com.musii.studio.engine.TextRasterizer
import com.musii.studio.model.FitMode
import com.musii.studio.model.KeyframeMath
import com.musii.studio.model.MediaKind
import com.musii.studio.model.TextKind
import kotlin.math.max
import kotlin.math.min

enum class Panel(val title: String) {
    AUDIO("Audio"), TEXT("Text"), STICKER("Sticker"), EFFECTS("Effekte"), FILTERS("Filter"), FORMAT("Format"),
    BACKGROUND("Hintergrund"), TRANSITION("Übergang"), SPEED("Tempo"), VOLUME("Lautstärke"), ANIMATION("Animation"),
    ADJUST("Anpassen"), CLIP_EFFECTS("Clip-Effekte"), MASK("Maske"), CHROMA("Chroma-Key"), TRANSFORM("Bild"),
    TEXT_EDIT("Text bearbeiten"), TEXT_STYLE("Textstil"), TEXT_ANIM("Animation"), TEXT_POS("Position"), TEXT_VOICE("Vorlesen"),
    EFFECT_EDIT("Effekt"), MEDIA("Medien"),
}

@Composable
fun EditorScreen(editor: EditorState, onClose: () -> Unit) {
    val ctx = LocalContext.current
    var panel by remember { mutableStateOf<Panel?>(null) }
    var showExport by remember { mutableStateOf(false) }

    val pickMain = rememberLauncherForActivityResult(ActivityResultContracts.PickMultipleVisualMedia(50)) { editor.importUris(it, EditorState.Target.MAIN) }
    val pickOverlay = rememberLauncherForActivityResult(ActivityResultContracts.PickMultipleVisualMedia(10)) { editor.importUris(it, EditorState.Target.OVERLAY) }
    val pickAudio = rememberLauncherForActivityResult(ActivityResultContracts.OpenMultipleDocuments()) { editor.importUris(it, EditorState.Target.AUDIO) }
    val micPermission = rememberLauncherForActivityResult(ActivityResultContracts.RequestPermission()) { ok ->
        if (ok) editor.startRecording() else editor.message = "Ohne Mikrofon-Erlaubnis ist keine Aufnahme möglich."
    }
    val actions = remember {
        EditorActions(
            pickMain = { pickMain.launch(PickVisualMediaRequest(ActivityResultContracts.PickVisualMedia.ImageAndVideo)) },
            pickOverlay = { pickOverlay.launch(PickVisualMediaRequest(ActivityResultContracts.PickVisualMedia.ImageAndVideo)) },
            pickAudio = { pickAudio.launch(arrayOf("audio/*")) },
            record = {
                if (ContextCompat.checkSelfPermission(ctx, Manifest.permission.RECORD_AUDIO) == PackageManager.PERMISSION_GRANTED) editor.startRecording()
                else micPermission.launch(Manifest.permission.RECORD_AUDIO)
            },
        )
    }

    // Panel schließen, wenn die Auswahl verschwindet
    LaunchedEffect(editor.selection) {
        val p = panel ?: return@LaunchedEffect
        val needsSel = p in setOf(Panel.SPEED, Panel.VOLUME, Panel.ANIMATION, Panel.ADJUST, Panel.CLIP_EFFECTS, Panel.MASK, Panel.CHROMA,
            Panel.TRANSFORM, Panel.TEXT_EDIT, Panel.TEXT_STYLE, Panel.TEXT_ANIM, Panel.TEXT_POS, Panel.TEXT_VOICE, Panel.EFFECT_EDIT)
        if (needsSel && editor.selection == null) panel = null
    }

    Box(Modifier.fillMaxSize()) {
        Column(Modifier.fillMaxSize().statusBarsPadding().navigationBarsPadding()) {
            // Kopfzeile
            Row(Modifier.fillMaxWidth().height(52.dp).padding(horizontal = 4.dp), verticalAlignment = Alignment.CenterVertically) {
                IconButton(onClick = { editor.saveNow(); onClose() }) { Icon(Icons.AutoMirrored.Filled.ArrowBack, "Zurück") }
                Text(editor.project.name, fontSize = 14.sp, fontWeight = FontWeight.SemiBold, maxLines = 1, modifier = Modifier.weight(1f))
                IconButton(onClick = { editor.undo() }, enabled = editor.canUndo) { Icon(Icons.AutoMirrored.Filled.Undo, "Rückgängig") }
                IconButton(onClick = { editor.redo() }, enabled = editor.canRedo) { Icon(Icons.AutoMirrored.Filled.Redo, "Wiederholen") }
                Button(onClick = { editor.pause(); showExport = true }, shape = RoundedCornerShape(8.dp), contentPadding = PaddingValues(horizontal = 14.dp, vertical = 6.dp)) {
                    Text("Exportieren", fontWeight = FontWeight.SemiBold)
                }
                Spacer(Modifier.width(6.dp))
            }
            // Vorschau
            Preview(editor, Modifier.weight(1f).fillMaxWidth())
            // Steuerung
            Row(Modifier.fillMaxWidth().height(44.dp).padding(horizontal = 12.dp), verticalAlignment = Alignment.CenterVertically) {
                Text("${formatTime(editor.timeUs)} / ${formatTime(editor.project.durationUs)}", fontSize = 12.sp, color = C.text2, modifier = Modifier.weight(1f))
                IconButton(onClick = { editor.togglePlay() }) {
                    Icon(if (editor.isPlaying) Icons.Default.Pause else Icons.Default.PlayArrow, "Abspielen", modifier = Modifier.size(32.dp))
                }
                Box(Modifier.weight(1f), contentAlignment = Alignment.CenterEnd) {
                    val sel = editor.selection
                    if (sel != null && (editor.clip(sel.id)?.let { editor.project.media(it.mediaId)?.isVisual } == true || editor.text(sel.id) != null)) {
                        val has = editor.hasKeyframe(sel.id)
                        IconButton(onClick = { editor.toggleKeyframe(sel.id) }) {
                            Icon(if (has) Icons.Default.Diamond else Icons.Outlined.Diamond, "Keyframe", tint = if (has) Color(0xFFFFD60A) else Color.White)
                        }
                    }
                }
            }
            val p = panel
            if (p == null) {
                Timeline(editor, actions, Modifier.fillMaxWidth().height(220.dp)) { panel = it }
                ToolBar(editor, actions) { panel = it }
            } else {
                PanelHost(p, editor, actions, Modifier.fillMaxWidth().height(340.dp)) { panel = null }
            }
        }

        editor.busy?.let { b ->
            Box(Modifier.fillMaxSize().background(Color.Black.copy(alpha = 0.5f)).pointerInput(Unit) { detectTapGestures { } }, contentAlignment = Alignment.Center) {
                Column(Modifier.clip(RoundedCornerShape(14.dp)).background(C.panel2).padding(24.dp), horizontalAlignment = Alignment.CenterHorizontally) {
                    Text(b.title, fontSize = 14.sp)
                    Spacer(Modifier.height(12.dp))
                    if (b.progress != null) LinearProgressIndicator(progress = { b.progress }, modifier = Modifier.width(220.dp))
                    else CircularProgressIndicator()
                }
            }
        }
        editor.message?.let { msg ->
            LaunchedEffect(msg) {
                kotlinx.coroutines.delay(3500)
                if (editor.message == msg) editor.message = null
            }
            Box(Modifier.fillMaxSize().navigationBarsPadding().padding(bottom = 90.dp), contentAlignment = Alignment.BottomCenter) {
                Text(msg, fontSize = 13.sp, modifier = Modifier.clip(RoundedCornerShape(20.dp)).background(C.panel3).clickable { editor.message = null }.padding(horizontal = 16.dp, vertical = 10.dp))
            }
        }
        if (editor.isRecording) {
            Box(Modifier.fillMaxSize().statusBarsPadding().padding(top = 60.dp), contentAlignment = Alignment.TopCenter) {
                Row(Modifier.clip(RoundedCornerShape(20.dp)).background(Color(0xFFD32F2F)).clickable { editor.stopRecording() }.padding(horizontal = 16.dp, vertical = 10.dp), verticalAlignment = Alignment.CenterVertically) {
                    Icon(Icons.Default.Stop, null)
                    Spacer(Modifier.width(8.dp))
                    Text("Aufnahme läuft – tippen zum Beenden", fontSize = 13.sp)
                    Spacer(Modifier.width(8.dp))
                    Box(Modifier.size(width = (10 + 60 * editor.recordLevel).dp, height = 6.dp).clip(RoundedCornerShape(3.dp)).background(Color.White))
                }
            }
        }
    }
    if (showExport) ExportDialog(editor) { showExport = false }
}


class EditorActions(
    val pickMain: () -> Unit,
    val pickOverlay: () -> Unit,
    val pickAudio: () -> Unit,
    val record: () -> Unit,
)

// ---------------- Vorschau ----------------

@Composable
fun Preview(editor: EditorState, modifier: Modifier) {
    val ctx = LocalContext.current
    val density = LocalDensity.current
    val surfaceView = remember { SurfaceView(ctx) }
    DisposableEffect(surfaceView) {
        editor.attachSurface(surfaceView)
        onDispose { editor.attachSurface(null) }
    }
    BoxWithConstraints(modifier.background(Color.Black), contentAlignment = Alignment.Center) {
        val p = editor.project
        val availW = constraints.maxWidth.toFloat()
        val availH = constraints.maxHeight.toFloat()
        val f = min(availW / p.aspect.w, availH / p.aspect.h)
        val wPx = p.aspect.w * f
        val hPx = p.aspect.h * f
        val wDp = with(density) { wPx.toDp() }
        val hDp = with(density) { hPx.toDp() }
        Box(Modifier.size(wDp, hDp)) {
            AndroidView(factory = { surfaceView }, modifier = Modifier.fillMaxSize())
            SelectionOverlay(editor, wPx, hPx)
            if (p.main.isEmpty() && p.overlays.isEmpty() && p.texts.isEmpty()) {
                Text("Tippe unten auf „+“ oder „Medien“,\num Videos und Fotos hinzuzufügen.", color = Color.White.copy(alpha = 0.6f), fontSize = 13.sp,
                    modifier = Modifier.align(Alignment.Center))
            }
        }
    }
}

private data class Box2(val sel: Sel, val cx: Float, val cy: Float, val w: Float, val h: Float, val rot: Float)

@Composable
private fun SelectionOverlay(editor: EditorState, wPx: Float, hPx: Float) {
    val p = editor.project
    val t = editor.timeUs
    val k = wPx / p.aspect.w
    val unit = min(p.aspect.w, p.aspect.h) / 1080f

    fun boxes(): List<Box2> {
        val out = ArrayList<Box2>()
        fun clipBox(c: com.musii.studio.model.Clip, start: Long, sel: Sel) {
            val m = p.media(c.mediaId) ?: return
            if (!m.isVisual || m.width <= 0) return
            val tr = KeyframeMath.transform(c.transform, c.keyframes, t - start)
            val iw = m.width * c.crop.w
            val ih = m.height * c.crop.h
            val base = if (c.fitMode == FitMode.FIT) min(p.aspect.w / iw, p.aspect.h / ih) else max(p.aspect.w / iw, p.aspect.h / ih)
            val s = base * tr.scale * k
            out.add(Box2(sel, tr.x * wPx, tr.y * hPx, iw * s, ih * s, tr.rotation))
        }
        val slots = p.mainSlots
        p.main.forEachIndexed { i, c -> if (t >= slots[i].startUs && t < slots[i].endUs) clipBox(c, slots[i].startUs, Sel.Main(c.id)) }
        p.overlays.sortedBy { it.lane }.forEach { c -> if (t >= c.startUs && t < c.endUs) clipBox(c, c.startUs, Sel.Overlay(c.id)) }
        p.texts.sortedBy { it.lane }.forEach { x ->
            if (t >= x.startUs && t < x.endUs) {
                val tr = KeyframeMath.transform(x.transform, x.keyframes, t - x.startUs)
                val (mw, mh) = TextRasterizer.measure(x, unit)
                out.add(Box2(Sel.Text(x.id), tr.x * wPx, tr.y * hPx, mw * tr.scale * k, mh * tr.scale * k, tr.rotation))
            }
        }
        return out
    }

    val all = boxes()
    val selected = all.firstOrNull { it.sel == editor.selection }
    Canvas(
        Modifier
            .fillMaxSize()
            .pointerInput(editor.selection, p.aspect) {
                detectTapGestures { pos ->
                    val hit = all.reversed().firstOrNull { kotlin.math.abs(pos.x - it.cx) <= max(30f, it.w / 2) && kotlin.math.abs(pos.y - it.cy) <= max(30f, it.h / 2) }
                    editor.selection = hit?.sel
                }
            }
            .pointerInput(editor.selection, p.aspect) {
                detectTransformGestures { _, pan, zoom, rotation ->
                    val sel = editor.selection ?: return@detectTransformGestures
                    if (sel is Sel.Audio || sel is Sel.Effect) return@detectTransformGestures
                    if (editor.isPlaying) editor.pause()
                    editor.setTransform(sel.id, "gesture${sel.id}") { tr ->
                        tr.copy(
                            x = tr.x + pan.x / wPx,
                            y = tr.y + pan.y / hPx,
                            scale = (tr.scale * zoom).coerceIn(0.05f, 10f),
                            rotation = tr.rotation + rotation,
                        )
                    }
                }
            }
    ) {
        selected?.let { b ->
            rotate(b.rot, Offset(b.cx, b.cy)) {
                drawRect(C.accent, topLeft = Offset(b.cx - b.w / 2, b.cy - b.h / 2), size = Size(max(8f, b.w), max(8f, b.h)), style = Stroke(width = 2.dp.toPx()))
                listOf(Offset(-1f, -1f), Offset(1f, -1f), Offset(1f, 1f), Offset(-1f, 1f)).forEach { o ->
                    drawCircle(Color.White, 5.dp.toPx(), Offset(b.cx + o.x * b.w / 2, b.cy + o.y * b.h / 2))
                }
            }
        }
    }
}

// ---------------- Werkzeugleiste ----------------

@Composable
fun ToolBar(editor: EditorState, actions: EditorActions, open: (Panel) -> Unit) {
    val sel = editor.selection
    Row(
        Modifier.fillMaxWidth().background(C.panel).horizontalScroll(rememberScrollState()).padding(horizontal = 4.dp, vertical = 4.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        when (sel) {
            null -> {
                ToolButton(Icons.Default.AddPhotoAlternate, "Medien") { actions.pickMain() }
                ToolButton(Icons.Default.MusicNote, "Audio") { open(Panel.AUDIO) }
                ToolButton(Icons.Default.TextFields, "Text") { open(Panel.TEXT) }
                ToolButton(Icons.Default.EmojiEmotions, "Sticker") { open(Panel.STICKER) }
                ToolButton(Icons.Default.AutoAwesome, "Effekte") { open(Panel.EFFECTS) }
                ToolButton(Icons.Default.PictureInPicture, "Overlay") { actions.pickOverlay() }
                ToolButton(Icons.Default.FilterVintage, "Filter") { open(Panel.FILTERS) }
                ToolButton(Icons.Default.AspectRatio, "Format") { open(Panel.FORMAT) }
                ToolButton(Icons.Default.Wallpaper, "Hintergrund") { open(Panel.BACKGROUND) }
                ToolButton(Icons.Default.SwapHoriz, "Übergänge") { open(Panel.TRANSITION) }
            }
            is Sel.Main, is Sel.Overlay -> {
                val c = editor.clip(sel.id)
                val m = c?.let { editor.project.media(it.mediaId) }
                ToolButton(Icons.Default.ContentCut, "Teilen") { editor.split() }
                if (m?.kind == MediaKind.VIDEO) ToolButton(Icons.Default.Speed, "Tempo") { open(Panel.SPEED) }
                if (m?.hasAudio == true) ToolButton(Icons.Default.VolumeUp, "Lautstärke") { open(Panel.VOLUME) }
                ToolButton(Icons.Default.Transform, "Bild") { open(Panel.TRANSFORM) }
                ToolButton(Icons.Default.Animation, "Animation") { open(Panel.ANIMATION) }
                ToolButton(Icons.Default.FilterVintage, "Filter") { open(Panel.FILTERS) }
                ToolButton(Icons.Default.Tune, "Anpassen") { open(Panel.ADJUST) }
                ToolButton(Icons.Default.AutoAwesome, "Effekte") { open(Panel.CLIP_EFFECTS) }
                ToolButton(Icons.Default.Lens, "Maske") { open(Panel.MASK) }
                ToolButton(Icons.Default.PersonRemove, "Chroma") { open(Panel.CHROMA) }
                if (sel is Sel.Main) ToolButton(Icons.Default.SwapHoriz, "Übergang") { open(Panel.TRANSITION) }
                if (m?.kind == MediaKind.IMAGE) ToolButton(Icons.Default.Timer, "Dauer") { open(Panel.SPEED) }
                if (m?.kind == MediaKind.VIDEO && sel is Sel.Main) ToolButton(Icons.Default.PauseCircle, "Standbild") { editor.freezeFrame() }
                if (m?.kind == MediaKind.VIDEO && m.hasAudio) ToolButton(Icons.Default.CallSplit, "Ton trennen") { editor.detachAudio() }
                ToolButton(Icons.Default.ContentCopy, "Duplizieren") { editor.duplicateSelection() }
                ToolButton(Icons.Default.Delete, "Löschen") { editor.deleteSelection() }
            }
            is Sel.Audio -> {
                ToolButton(Icons.Default.ContentCut, "Teilen") { editor.split() }
                ToolButton(Icons.Default.VolumeUp, "Lautstärke") { open(Panel.VOLUME) }
                ToolButton(Icons.Default.Speed, "Tempo") { open(Panel.SPEED) }
                ToolButton(Icons.Default.ContentCopy, "Duplizieren") { editor.duplicateSelection() }
                ToolButton(Icons.Default.Delete, "Löschen") { editor.deleteSelection() }
            }
            is Sel.Text -> {
                val t = editor.text(sel.id)
                ToolButton(Icons.Default.Edit, "Bearbeiten") { open(Panel.TEXT_EDIT) }
                if (t?.kind == TextKind.TEXT) ToolButton(Icons.Default.Style, "Stil") { open(Panel.TEXT_STYLE) }
                ToolButton(Icons.Default.Animation, "Animation") { open(Panel.TEXT_ANIM) }
                ToolButton(Icons.Default.OpenWith, "Position") { open(Panel.TEXT_POS) }
                if (t?.kind == TextKind.TEXT) ToolButton(Icons.Default.RecordVoiceOver, "Vorlesen") { open(Panel.TEXT_VOICE) }
                ToolButton(Icons.Default.ContentCut, "Teilen") { editor.split() }
                ToolButton(Icons.Default.ContentCopy, "Duplizieren") { editor.duplicateSelection() }
                ToolButton(Icons.Default.Delete, "Löschen") { editor.deleteSelection() }
            }
            is Sel.Effect -> {
                ToolButton(Icons.Default.AutoAwesome, "Effekt") { open(Panel.EFFECT_EDIT) }
                ToolButton(Icons.Default.ContentCut, "Teilen") { editor.split() }
                ToolButton(Icons.Default.ContentCopy, "Duplizieren") { editor.duplicateSelection() }
                ToolButton(Icons.Default.Delete, "Löschen") { editor.deleteSelection() }
            }
        }
    }
}

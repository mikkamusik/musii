package com.musii.studio.ui

import android.speech.tts.Voice
import androidx.compose.foundation.Image
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.LazyRow
import androidx.compose.foundation.lazy.grid.GridCells
import androidx.compose.foundation.lazy.grid.LazyVerticalGrid
import androidx.compose.foundation.lazy.grid.items
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.*
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.asImageBitmap
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.musii.studio.editor.EditorState
import com.musii.studio.editor.Sel
import com.musii.studio.engine.TextRasterizer
import com.musii.studio.engine.Tools
import com.musii.studio.model.*
import kotlin.math.log10
import kotlin.math.pow

@Composable
fun PanelHost(panel: Panel, editor: EditorState, actions: EditorActions, modifier: Modifier, onClose: () -> Unit) {
    Column(modifier.background(C.panel)) {
        Row(Modifier.fillMaxWidth().height(44.dp).padding(horizontal = 12.dp), verticalAlignment = Alignment.CenterVertically) {
            Text(panel.title, fontSize = 15.sp, fontWeight = FontWeight.SemiBold, modifier = Modifier.weight(1f))
            IconButton(onClick = onClose) { Icon(Icons.Default.Check, "Fertig", tint = C.accent) }
        }
        Column(Modifier.fillMaxSize().padding(horizontal = 12.dp)) {
            when (panel) {
                Panel.MEDIA -> {}
                Panel.AUDIO -> AudioPanel(editor, actions)
                Panel.TEXT -> TextPanel(editor)
                Panel.STICKER -> StickerPanel(editor)
                Panel.EFFECTS -> EffectsPanel(editor, asLayer = true)
                Panel.CLIP_EFFECTS -> ClipEffectsPanel(editor)
                Panel.FILTERS -> FiltersPanel(editor)
                Panel.FORMAT -> FormatPanel(editor)
                Panel.BACKGROUND -> BackgroundPanel(editor)
                Panel.TRANSITION -> TransitionPanel(editor)
                Panel.SPEED -> SpeedPanel(editor)
                Panel.VOLUME -> VolumePanel(editor)
                Panel.ANIMATION -> ClipAnimationPanel(editor)
                Panel.ADJUST -> AdjustPanel(editor)
                Panel.MASK -> MaskPanel(editor)
                Panel.CHROMA -> ChromaPanel(editor)
                Panel.TRANSFORM -> TransformPanel(editor)
                Panel.TEXT_EDIT -> TextEditPanel(editor)
                Panel.TEXT_STYLE -> TextStylePanel(editor)
                Panel.TEXT_ANIM -> TextAnimationPanel(editor)
                Panel.TEXT_POS -> TextPositionPanel(editor)
                Panel.TEXT_VOICE -> TextVoicePanel(editor)
                Panel.EFFECT_EDIT -> EffectEditPanel(editor)
            }
        }
    }
}

@Composable
private fun Scroll(content: @Composable ColumnScope.() -> Unit) {
    Column(Modifier.fillMaxSize().verticalScroll(rememberScrollState()).padding(bottom = 16.dp), content = content)
}

// ---------- Audio ----------

@Composable
private fun AudioPanel(editor: EditorState, actions: EditorActions) {
    val ctx = LocalContext.current
    var text by remember { mutableStateOf("") }
    var voices by remember { mutableStateOf<List<Voice>>(emptyList()) }
    var voice by remember { mutableStateOf<String?>(null) }
    var rate by remember { mutableFloatStateOf(1f) }
    var pitch by remember { mutableFloatStateOf(1f) }
    LaunchedEffect(Unit) { Tools.voices(ctx) { list -> voices = list.filter { it.locale.language in setOf("de", "en", "fr", "es", "it", "tr") } } }
    Scroll {
        Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
            Pill("Musik importieren", prominent = true, modifier = Modifier.weight(1f)) { actions.pickAudio() }
            Pill("Sprachaufnahme", modifier = Modifier.weight(1f)) { actions.record() }
        }
        Section("Text zu Sprache") {
            OutlinedTextField(text, { text = it }, modifier = Modifier.fillMaxWidth(), placeholder = { Text("Text eingeben …") }, minLines = 2)
            if (voices.isNotEmpty()) {
                LazyRow(horizontalArrangement = Arrangement.spacedBy(6.dp), modifier = Modifier.padding(vertical = 6.dp)) {
                    item { Tile("Standard", voice == null, modifier = Modifier.width(90.dp)) { voice = null } }
                    items(voices.take(40)) { v -> Tile(v.locale.displayLanguage + " " + v.name.takeLast(6), voice == v.name, modifier = Modifier.width(110.dp)) { voice = v.name } }
                }
            }
            LabeledSlider("Tempo", rate, 0.5f..2f, 1f, { "%.1fx".format(it) }) { rate = it }
            LabeledSlider("Tonhöhe", pitch, 0.5f..2f, 1f, { "%.1f".format(it) }) { pitch = it }
            Pill("Sprache erzeugen & einfügen", prominent = true, modifier = Modifier.fillMaxWidth()) { editor.textToSpeech(text, voice, rate, pitch) }
        }
        val audio = editor.project.media.filter { it.kind == MediaKind.AUDIO }
        if (audio.isNotEmpty()) {
            Section("Audio im Projekt") {
                audio.forEach { m ->
                    Row(Modifier.fillMaxWidth().padding(vertical = 4.dp), verticalAlignment = Alignment.CenterVertically) {
                        Icon(Icons.Default.GraphicEq, null, tint = C.accent)
                        Text(m.name, fontSize = 13.sp, maxLines = 1, modifier = Modifier.weight(1f).padding(horizontal = 8.dp))
                        Text(formatTime(m.durationUs), fontSize = 11.sp, color = C.text2)
                        IconButton(onClick = { editor.addAudio(m, editor.timeUs) }) { Icon(Icons.Default.AddCircle, "Einfügen", tint = C.accent) }
                    }
                }
            }
        }
    }
}

// ---------- Text & Sticker ----------

@Composable
private fun TextPreview(style: TextStyle, text: String = "Abc") {
    val bmp = remember(style, text) {
        val m = TextRasterizer.layout(text, style.copy(fontSize = 52f), 1f, TextKind.TEXT)
        val w = (m.width + m.pad * 2 + 40).toInt().coerceAtLeast(10)
        val h = (m.height + m.pad * 2 + 40).toInt().coerceAtLeast(10)
        val b = android.graphics.Bitmap.createBitmap(w, h, android.graphics.Bitmap.Config.ARGB_8888)
        val t = TextClip(text = text, style = style.copy(fontSize = 52f), startUs = 0)
        TextRasterizer.drawText(android.graphics.Canvas(b), t, 1_000_000, 1f, w, h)
        b.asImageBitmap()
    }
    Image(bmp, null, modifier = Modifier.fillMaxSize().padding(4.dp))
}

@Composable
private fun TextPanel(editor: EditorState) {
    Scroll {
        Pill("+ Text hinzufügen", prominent = true, modifier = Modifier.fillMaxWidth()) { editor.addText(TextStyle()) }
        Spacer(Modifier.height(8.dp))
        Text("Vorlagen", fontSize = 12.sp, color = C.text2)
        PresetGrid(editor)
    }
}

@Composable
private fun PresetGrid(editor: EditorState) {
    val rows = TextCatalog.presets.chunked(4)
    rows.forEach { row ->
        Row(Modifier.fillMaxWidth().padding(vertical = 4.dp), horizontalArrangement = Arrangement.spacedBy(6.dp)) {
            row.forEach { p ->
                Box(Modifier.weight(1f).height(58.dp).clip(RoundedCornerShape(8.dp)).background(C.panel3).clickable {
                    val sel = editor.selection
                    if (sel is Sel.Text && editor.text(sel.id)?.kind == TextKind.TEXT) {
                        editor.modifyText(sel.id) { t -> t.copy(style = p.style.copy(fontSize = t.style.fontSize, alignment = t.style.alignment)) }
                    } else editor.addText(p.style)
                }) { TextPreview(p.style) }
            }
            repeat(4 - row.size) { Spacer(Modifier.weight(1f)) }
        }
    }
}

@Composable
private fun StickerPanel(editor: EditorState) {
    Scroll {
        StickerCatalog.groups.forEach { (title, list) ->
            Text(title, fontSize = 12.sp, color = C.text2, modifier = Modifier.padding(top = 8.dp, bottom = 4.dp))
            list.chunked(8).forEach { row ->
                Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(4.dp)) {
                    row.forEach { e ->
                        Box(Modifier.weight(1f).aspectRatio(1f).clip(RoundedCornerShape(8.dp)).background(C.panel2).clickable { editor.addEmoji(e) }, contentAlignment = Alignment.Center) {
                            Text(e, fontSize = 24.sp)
                        }
                    }
                    repeat(8 - row.size) { Spacer(Modifier.weight(1f)) }
                }
                Spacer(Modifier.height(4.dp))
            }
        }
    }
}

// ---------- Effekte, Filter, Übergänge ----------

private fun effectIcon(k: EffectKind) = when (k) {
    EffectKind.BLUR -> Icons.Default.BlurOn; EffectKind.PIXELATE -> Icons.Default.GridOn; EffectKind.GLITCH -> Icons.Default.Waves
    EffectKind.RGB_SPLIT -> Icons.Default.Contrast; EffectKind.VHS -> Icons.Default.Tv; EffectKind.MIRROR -> Icons.Default.Flip
    EffectKind.KALEIDOSCOPE -> Icons.Default.FilterVintage; EffectKind.ZOOM_PULSE -> Icons.Default.ZoomIn; EffectKind.SHAKE -> Icons.Default.Vibration
    EffectKind.GLOW -> Icons.Default.WbSunny; EffectKind.POSTERIZE -> Icons.Default.Palette; EffectKind.INVERT -> Icons.Default.InvertColors
    EffectKind.EDGES -> Icons.Default.Gesture; EffectKind.THERMAL -> Icons.Default.Thermostat; EffectKind.STROBE -> Icons.Default.FlashOn
    EffectKind.OLD_FILM -> Icons.Default.Movie; EffectKind.LETTERBOX -> Icons.Default.Crop169; EffectKind.SPLIT4 -> Icons.Default.GridView
    EffectKind.SPLIT9 -> Icons.Default.Apps; EffectKind.TWIRL -> Icons.Default.Cyclone; EffectKind.BULGE -> Icons.Default.Circle
    EffectKind.FLASH -> Icons.Default.Bolt; EffectKind.SNOW -> Icons.Default.AcUnit; EffectKind.RAIN -> Icons.Default.WaterDrop
    EffectKind.SPARKLE -> Icons.Default.AutoAwesome; EffectKind.LIGHT_LEAK -> Icons.Default.LightMode; EffectKind.VIGNETTE -> Icons.Default.Camera
    EffectKind.BLACK_WHITE -> Icons.Default.FilterBAndW; EffectKind.HALFTONE -> Icons.Default.BlurCircular; EffectKind.SCANLINES -> Icons.Default.DensityMedium
}

@Composable
private fun EffectsPanel(editor: EditorState, asLayer: Boolean) {
    Text(if (asLayer) "Wird als eigene Ebene am Abspielkopf eingefügt und wirkt auf alles darunter." else "Wird dem ausgewählten Clip hinzugefügt (max. 4).",
        fontSize = 11.sp, color = C.text2, modifier = Modifier.padding(bottom = 6.dp))
    LazyVerticalGrid(GridCells.Adaptive(78.dp), horizontalArrangement = Arrangement.spacedBy(6.dp), verticalArrangement = Arrangement.spacedBy(6.dp)) {
        items(EffectKind.entries) { k ->
            Tile(k.title, icon = effectIcon(k)) { if (asLayer) editor.addEffectLayer(k) else editor.addEffectToClip(k) }
        }
    }
}

@Composable
private fun ClipEffectsPanel(editor: EditorState) {
    val c = editor.selectedClip ?: return
    Column(Modifier.fillMaxSize()) {
        if (c.effects.isNotEmpty()) {
            c.effects.forEach { fx ->
                Row(verticalAlignment = Alignment.CenterVertically) {
                    Text(fx.kind.title, fontSize = 12.sp, modifier = Modifier.width(90.dp))
                    Box(Modifier.weight(1f)) {
                        LabeledSlider("Stärke", fx.intensity, 0f..1f, null, { "%.0f%%".format(it * 100) }) { v ->
                            editor.modifyClip(c.id, "fx${fx.id}") { cc -> cc.copy(effects = cc.effects.map { if (it.id == fx.id) it.copy(intensity = v) else it }) }
                        }
                    }
                    IconButton(onClick = { editor.modifyClip(c.id) { cc -> cc.copy(effects = cc.effects.filter { it.id != fx.id }) } }) { Icon(Icons.Default.Close, "Entfernen") }
                }
            }
            HorizontalDivider(color = C.panel3)
        }
        EffectsPanel(editor, asLayer = false)
    }
}

@Composable
private fun FiltersPanel(editor: EditorState) {
    val c = editor.selectedClip
    val visual = c != null && editor.project.media(c.mediaId)?.isVisual == true
    Column {
        if (visual && c != null) {
            LabeledSlider("Stärke: " + FilterCatalog.byId(c.filter.preset).title, c.filter.intensity, 0f..1f, 1f, { "%.0f%%".format(it * 100) }) { v ->
                editor.modifyClip(c.id, "filterAmt${c.id}") { it.copy(filter = it.filter.copy(intensity = v)) }
            }
        } else {
            Text("Wähle einen Clip in der Timeline – oder wende den Filter auf alle Clips an.", fontSize = 11.sp, color = C.text2)
        }
        var lastPreset by remember { mutableStateOf("vivid") }
        LazyVerticalGrid(GridCells.Adaptive(84.dp), horizontalArrangement = Arrangement.spacedBy(6.dp), verticalArrangement = Arrangement.spacedBy(6.dp), modifier = Modifier.weight(1f).padding(top = 6.dp)) {
            items(FilterCatalog.all) { f ->
                Tile(f.title, selected = c?.filter?.preset == f.id) {
                    lastPreset = f.id
                    if (visual) editor.applyFilter(f.id) else editor.applyFilter(f.id, toAll = true)
                }
            }
        }
        Pill("Auf alle Clips der Hauptspur", modifier = Modifier.fillMaxWidth().padding(vertical = 6.dp)) { editor.applyFilter(c?.filter?.preset ?: lastPreset, toAll = true) }
    }
}

@Composable
private fun TransitionPanel(editor: EditorState) {
    val c = (editor.selection as? Sel.Main)?.let { editor.clip(it.id) }
    val idx = c?.let { cl -> editor.project.main.indexOfFirst { it.id == cl.id } } ?: -1
    Column {
        if (editor.project.main.size < 2) Text("Füge mindestens zwei Clips zur Hauptspur hinzu.", fontSize = 11.sp, color = C.text2)
        else Text("Übergang nach dem ausgewählten Clip (oder dem Clip am Abspielkopf).", fontSize = 11.sp, color = C.text2)
        c?.transition?.let { t ->
            LabeledSlider("Dauer", t.durationUs / 1e6f, 0.1f..3f, 0.6f, { "%.1f s".format(it) }) { v ->
                editor.modifyClip(c.id, "transDur${c.id}") { it.copy(transition = it.transition?.copy(durationUs = (v * 1000).toLong() * 1000)) }
            }
        }
        LazyVerticalGrid(GridCells.Adaptive(84.dp), horizontalArrangement = Arrangement.spacedBy(6.dp), verticalArrangement = Arrangement.spacedBy(6.dp), modifier = Modifier.weight(1f).padding(top = 6.dp)) {
            items(TransitionKind.entries) { k ->
                Tile(k.title, selected = idx >= 0 && (c?.transition?.kind ?: TransitionKind.NONE) == k) { editor.applyTransition(k) }
            }
        }
        Pill("Auf alle Clips anwenden", modifier = Modifier.fillMaxWidth().padding(vertical = 6.dp)) { editor.applyTransition(c?.transition?.kind ?: TransitionKind.DISSOLVE, toAll = true) }
    }
}

// ---------- Projekt ----------

@Composable
private fun FormatPanel(editor: EditorState) {
    Scroll {
        AspectPreset.entries.chunked(4).forEach { row ->
            Row(Modifier.fillMaxWidth().padding(vertical = 4.dp), horizontalArrangement = Arrangement.spacedBy(6.dp)) {
                row.forEach { a ->
                    val sel = editor.project.aspect == a
                    Column(Modifier.weight(1f).clip(RoundedCornerShape(10.dp)).background(if (sel) C.accent.copy(alpha = 0.18f) else C.panel2)
                        .border(1.5.dp, if (sel) C.accent else Color.Transparent, RoundedCornerShape(10.dp)).clickable { editor.update { it.copy(aspect = a) } }.padding(8.dp),
                        horizontalAlignment = Alignment.CenterHorizontally) {
                        val r = a.w.toFloat() / a.h
                        Box(Modifier.size(if (r >= 1) 34.dp else (34 * r).dp, if (r >= 1) (34 / r).dp else 34.dp).border(1.5.dp, Color.White, RoundedCornerShape(3.dp)))
                        Text(a.title, fontSize = 12.sp, fontWeight = FontWeight.SemiBold)
                        Text(a.subtitle, fontSize = 8.sp, color = C.text2, maxLines = 1)
                    }
                }
                repeat(4 - row.size) { Spacer(Modifier.weight(1f)) }
            }
        }
        Section("Bildrate") {
            Row(horizontalArrangement = Arrangement.spacedBy(6.dp)) {
                listOf(24, 25, 30, 50, 60).forEach { f -> Tile("$f fps", editor.project.fps == f, modifier = Modifier.weight(1f)) { editor.update { it.copy(fps = f) } } }
            }
        }
    }
}

@Composable
private fun BackgroundPanel(editor: EditorState) {
    val bg = editor.project.background
    Scroll {
        Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
            Tile("Farbe", bg.mode == BackgroundMode.COLOR, Icons.Default.FormatColorFill, Modifier.weight(1f)) { editor.update { it.copy(background = it.background.copy(mode = BackgroundMode.COLOR)) } }
            Tile("Unscharf", bg.mode == BackgroundMode.BLUR, Icons.Default.BlurOn, Modifier.weight(1f)) { editor.update { it.copy(background = it.background.copy(mode = BackgroundMode.BLUR)) } }
        }
        if (bg.mode == BackgroundMode.COLOR) {
            ColorRow("Farbe", bg.color) { c -> editor.update("bgColor") { it.copy(background = it.background.copy(color = c.copy(a = 1f))) } }
        } else {
            LabeledSlider("Unschärfe", bg.blur, 0f..1f, 0.5f, { "%.0f%%".format(it * 100) }) { v -> editor.update("bgBlur") { it.copy(background = it.background.copy(blur = v)) } }
        }
        Text("Sichtbar, wenn ein Clip das Bild nicht ganz füllt.", fontSize = 11.sp, color = C.text2)
    }
}

// ---------- Clip ----------

@Composable
private fun SpeedPanel(editor: EditorState) {
    val c = editor.selectedClip ?: return
    val m = editor.project.media(c.mediaId)
    Scroll {
        if (m?.kind == MediaKind.IMAGE) {
            LabeledSlider("Anzeigedauer", c.sourceDurationUs / 1e6f, 0.2f..30f, 4f, { "%.1f s".format(it) }) { v ->
                editor.modifyClip(c.id, "imgDur${c.id}") { it.copy(sourceDurationUs = (v * 1000).toLong() * 1000, sourceStartUs = 0) }
            }
            return@Scroll
        }
        LabeledSlider("Tempo", log10(c.speed), -1f..1f, 0f, { "%.2fx".format(10f.pow(it)) }) { v -> editor.setSpeed(c.id, 10f.pow(v)) }
        val presets = listOf(0.1f, 0.25f, 0.5f, 0.75f, 1f, 1.5f, 2f, 3f, 5f, 10f)
        presets.chunked(5).forEach { row ->
            Row(Modifier.fillMaxWidth().padding(vertical = 3.dp), horizontalArrangement = Arrangement.spacedBy(6.dp)) {
                row.forEach { s -> Tile("${s}x".replace(".0x", "x"), kotlin.math.abs(c.speed - s) < 0.001f, modifier = Modifier.weight(1f)) { editor.setSpeed(c.id, s) } }
            }
        }
        Text("Dauer auf der Timeline: ${formatTime(c.durationUs)} · Tonhöhe bleibt erhalten", fontSize = 11.sp, color = C.text2, modifier = Modifier.padding(top = 6.dp))
    }
}

@Composable
private fun VolumePanel(editor: EditorState) {
    val c = editor.selectedClip ?: return
    Scroll {
        LabeledSlider("Lautstärke", c.volume, 0f..2f, 1f, { "%.0f%%".format(it * 100) }) { v -> editor.modifyClip(c.id, "vol${c.id}") { it.copy(volume = v, muted = false) } }
        Row(verticalAlignment = Alignment.CenterVertically) {
            Text("Stumm", fontSize = 13.sp, modifier = Modifier.weight(1f))
            Switch(c.muted, { m -> editor.modifyClip(c.id) { it.copy(muted = m) } })
        }
        val maxFade = (c.durationUs / 2e6f).coerceIn(0.1f, 10f)
        LabeledSlider("Einblenden", c.fadeInUs / 1e6f, 0f..maxFade, 0f, { "%.1f s".format(it) }) { v -> editor.modifyClip(c.id, "fi${c.id}") { it.copy(fadeInUs = (v * 1000).toLong() * 1000) } }
        LabeledSlider("Ausblenden", c.fadeOutUs / 1e6f, 0f..maxFade, 0f, { "%.1f s".format(it) }) { v -> editor.modifyClip(c.id, "fo${c.id}") { it.copy(fadeOutUs = (v * 1000).toLong() * 1000) } }
    }
}

@Composable
private fun AnimationChooser(title: String, setting: AnimSetting, kinds: List<AnimKind>, onChange: (AnimSetting) -> Unit) {
    Text(title, fontSize = 12.sp, color = C.text2, modifier = Modifier.padding(top = 6.dp))
    LazyRow(horizontalArrangement = Arrangement.spacedBy(6.dp), modifier = Modifier.padding(vertical = 4.dp)) {
        items(kinds) { k -> Tile(k.title, setting.kind == k, modifier = Modifier.width(86.dp)) { onChange(setting.copy(kind = k)) } }
    }
    if (setting.kind != AnimKind.NONE) {
        LabeledSlider("Dauer", setting.durationUs / 1e6f, 0.1f..3f, 0.5f, { "%.1f s".format(it) }) { v -> onChange(setting.copy(durationUs = (v * 1000).toLong() * 1000)) }
    }
}

@Composable
private fun LoopChooser(loop: LoopAnim, onChange: (LoopAnim) -> Unit) {
    Text("Dauerschleife", fontSize = 12.sp, color = C.text2, modifier = Modifier.padding(top = 6.dp))
    LazyRow(horizontalArrangement = Arrangement.spacedBy(6.dp), modifier = Modifier.padding(vertical = 4.dp)) {
        items(LoopAnim.entries) { l -> Tile(l.title, loop == l, modifier = Modifier.width(86.dp)) { onChange(l) } }
    }
}

@Composable
private fun ClipAnimationPanel(editor: EditorState) {
    val c = editor.selectedClip ?: return
    val kinds = AnimKind.entries.filter { it != AnimKind.TYPEWRITER }
    Scroll {
        AnimationChooser("Einblenden", c.animIn, kinds) { s -> editor.modifyClip(c.id, "ain${c.id}") { it.copy(animIn = s) } }
        AnimationChooser("Ausblenden", c.animOut, kinds.filter { it != AnimKind.POP }) { s -> editor.modifyClip(c.id, "aout${c.id}") { it.copy(animOut = s) } }
        LoopChooser(c.loop) { l -> editor.modifyClip(c.id) { it.copy(loop = l) } }
    }
}

@Composable
private fun AdjustPanel(editor: EditorState) {
    val c = editor.selectedClip ?: return
    val a = c.adjust
    fun set(key: String, f: (Adjustments) -> Adjustments) = editor.modifyClip(c.id, "adj$key${c.id}") { it.copy(adjust = f(it.adjust)) }
    Scroll {
        Row {
            Spacer(Modifier.weight(1f))
            TextButton({ editor.modifyClip(c.id) { it.copy(adjust = Adjustments()) } }) { Text("Alle zurücksetzen", fontSize = 12.sp) }
        }
        val pct = { v: Float -> "%.0f".format(v) }
        LabeledSlider("Helligkeit", a.brightness, -100f..100f, 0f, pct) { v -> set("b") { it.copy(brightness = v) } }
        LabeledSlider("Kontrast", a.contrast, -100f..100f, 0f, pct) { v -> set("c") { it.copy(contrast = v) } }
        LabeledSlider("Sättigung", a.saturation, -100f..100f, 0f, pct) { v -> set("s") { it.copy(saturation = v) } }
        LabeledSlider("Belichtung", a.exposure, -100f..100f, 0f, pct) { v -> set("e") { it.copy(exposure = v) } }
        LabeledSlider("Temperatur", a.temperature, -100f..100f, 0f, pct) { v -> set("t") { it.copy(temperature = v) } }
        LabeledSlider("Farbton (Tint)", a.tint, -100f..100f, 0f, pct) { v -> set("ti") { it.copy(tint = v) } }
        LabeledSlider("Lichter", a.highlights, -100f..100f, 0f, pct) { v -> set("h") { it.copy(highlights = v) } }
        LabeledSlider("Schatten", a.shadows, -100f..100f, 0f, pct) { v -> set("sh") { it.copy(shadows = v) } }
        LabeledSlider("Dynamik", a.vibrance, -100f..100f, 0f, pct) { v -> set("v") { it.copy(vibrance = v) } }
        LabeledSlider("Farbverschiebung", a.hue, -100f..100f, 0f, pct) { v -> set("hu") { it.copy(hue = v) } }
        LabeledSlider("Schärfe", a.sharpen, 0f..100f, 0f, pct) { v -> set("sp") { it.copy(sharpen = v) } }
        LabeledSlider("Vignette", a.vignette, -100f..100f, 0f, pct) { v -> set("vi") { it.copy(vignette = v) } }
        LabeledSlider("Körnung", a.grain, 0f..100f, 0f, pct) { v -> set("g") { it.copy(grain = v) } }
        LabeledSlider("Verblassen", a.fade, 0f..100f, 0f, pct) { v -> set("f") { it.copy(fade = v) } }
    }
}

@Composable
private fun MaskPanel(editor: EditorState) {
    val c = editor.selectedClip ?: return
    val mk = c.mask
    fun set(key: String, f: (MaskSetting) -> MaskSetting) = editor.modifyClip(c.id, "mask$key${c.id}") { it.copy(mask = f(it.mask)) }
    Scroll {
        LazyRow(horizontalArrangement = Arrangement.spacedBy(6.dp)) {
            items(MaskKind.entries) { k -> Tile(k.title, mk.kind == k, modifier = Modifier.width(80.dp)) { set("k") { it.copy(kind = k) } } }
        }
        if (mk.kind != MaskKind.NONE) {
            LabeledSlider("Position X", mk.x, 0f..1f, 0.5f, { "%.0f".format((it - 0.5f) * 200) }) { v -> set("x") { it.copy(x = v) } }
            LabeledSlider("Position Y", mk.y, 0f..1f, 0.5f, { "%.0f".format((it - 0.5f) * 200) }) { v -> set("y") { it.copy(y = v) } }
            if (mk.kind != MaskKind.LINEAR) LabeledSlider("Größe", mk.size, 0.02f..2f, 0.5f, { "%.0f%%".format(it * 100) }) { v -> set("s") { it.copy(size = v) } }
            if (mk.kind == MaskKind.CIRCLE || mk.kind == MaskKind.RECTANGLE) LabeledSlider("Seitenverhältnis", mk.aspect, 0.2f..5f, 1f, { "%.2f".format(it) }) { v -> set("a") { it.copy(aspect = v) } }
            LabeledSlider("Drehung", mk.rotation, -180f..180f, 0f, { "%.0f°".format(it) }) { v -> set("r") { it.copy(rotation = v) } }
            LabeledSlider("Weiche Kante", mk.feather, 0f..1f, 0.05f, { "%.0f%%".format(it * 100) }) { v -> set("f") { it.copy(feather = v) } }
            Row(verticalAlignment = Alignment.CenterVertically) {
                Text("Umkehren", fontSize = 13.sp, modifier = Modifier.weight(1f))
                Switch(mk.invert, { v -> set("i") { it.copy(invert = v) } })
            }
        }
    }
}

@Composable
private fun ChromaPanel(editor: EditorState) {
    val c = editor.selectedClip ?: return
    val ck = c.chroma
    fun set(key: String, f: (ChromaKey) -> ChromaKey) = editor.modifyClip(c.id, "ck$key${c.id}") { it.copy(chroma = f(it.chroma)) }
    Scroll {
        Row(verticalAlignment = Alignment.CenterVertically) {
            Text("Greenscreen entfernen", fontSize = 13.sp, modifier = Modifier.weight(1f))
            Switch(ck.enabled, { v -> set("e") { it.copy(enabled = v) } })
        }
        Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
            Tile("Grün", ck.color == RGBA.Green, modifier = Modifier.weight(1f)) { set("g") { it.copy(color = RGBA.Green, enabled = true) } }
            Tile("Blau", ck.color == RGBA(0f, 0.3f, 0.95f), modifier = Modifier.weight(1f)) { set("b") { it.copy(color = RGBA(0f, 0.3f, 0.95f), enabled = true) } }
        }
        ColorRow("Schlüsselfarbe", ck.color) { col -> set("c") { it.copy(color = col.copy(a = 1f), enabled = true) } }
        LabeledSlider("Toleranz", ck.tolerance, 0f..1f, 0.4f, { "%.0f%%".format(it * 100) }) { v -> set("t") { it.copy(tolerance = v) } }
        LabeledSlider("Weichheit", ck.softness, 0f..1f, 0.1f, { "%.0f%%".format(it * 100) }) { v -> set("s") { it.copy(softness = v) } }
    }
}

@Composable
private fun TransformControls(editor: EditorState, id: String) {
    val tr = editor.currentTransform(id)
    val kf = editor.keyframes(id).size
    Row(verticalAlignment = Alignment.CenterVertically) {
        Text(if (kf > 0) "$kf Keyframe(s) – Änderungen setzen Keyframes" else "Tipp: In der Vorschau ziehen, mit zwei Fingern skalieren/drehen.", fontSize = 11.sp, color = if (kf > 0) Color(0xFFFFD60A) else C.text2, modifier = Modifier.weight(1f))
        IconButton(onClick = { editor.toggleKeyframe(id) }) { Icon(Icons.Default.Diamond, "Keyframe", tint = if (editor.hasKeyframe(id)) Color(0xFFFFD60A) else Color.White) }
        if (kf > 0) IconButton(onClick = { editor.clearKeyframes(id) }) { Icon(Icons.Default.Clear, "Keyframes löschen") }
    }
    LabeledSlider("Position X", tr.x, -0.5f..1.5f, 0.5f, { "%.0f".format((it - 0.5f) * 200) }) { v -> editor.setTransform(id, "tx$id") { it.copy(x = v) } }
    LabeledSlider("Position Y", tr.y, -0.5f..1.5f, 0.5f, { "%.0f".format((it - 0.5f) * 200) }) { v -> editor.setTransform(id, "ty$id") { it.copy(y = v) } }
    LabeledSlider("Skalierung", tr.scale, 0.05f..5f, 1f, { "%.0f%%".format(it * 100) }) { v -> editor.setTransform(id, "ts$id") { it.copy(scale = v) } }
    LabeledSlider("Drehung", tr.rotation, -180f..180f, 0f, { "%.0f°".format(it) }) { v -> editor.setTransform(id, "tr$id") { it.copy(rotation = v) } }
    LabeledSlider("Deckkraft", tr.opacity, 0f..1f, 1f, { "%.0f%%".format(it * 100) }) { v -> editor.setTransform(id, "to$id") { it.copy(opacity = v) } }
}

@Composable
private fun TransformPanel(editor: EditorState) {
    val c = editor.selectedClip ?: return
    Scroll {
        TransformControls(editor, c.id)
        Row(horizontalArrangement = Arrangement.spacedBy(6.dp), modifier = Modifier.padding(vertical = 4.dp)) {
            Tile("Einpassen", c.fitMode == FitMode.FIT, modifier = Modifier.weight(1f)) { editor.modifyClip(c.id) { it.copy(fitMode = FitMode.FIT) } }
            Tile("Füllen", c.fitMode == FitMode.FILL, modifier = Modifier.weight(1f)) { editor.modifyClip(c.id) { it.copy(fitMode = FitMode.FILL) } }
            Tile("↔ Spiegeln", c.flipH, modifier = Modifier.weight(1f)) { editor.modifyClip(c.id) { it.copy(flipH = !it.flipH) } }
            Tile("↕ Spiegeln", c.flipV, modifier = Modifier.weight(1f)) { editor.modifyClip(c.id) { it.copy(flipV = !it.flipV) } }
        }
        Row(horizontalArrangement = Arrangement.spacedBy(6.dp), modifier = Modifier.padding(vertical = 4.dp)) {
            Tile("↻ 90°", modifier = Modifier.weight(1f)) { editor.setTransform(c.id, "rot90") { t -> var r = t.rotation + 90; if (r > 180) r -= 360; t.copy(rotation = r) } }
            Tile("Zentrieren", modifier = Modifier.weight(1f)) { editor.setTransform(c.id, "center") { it.copy(x = 0.5f, y = 0.5f) } }
            Tile("Zurücksetzen", modifier = Modifier.weight(1f)) { editor.setTransform(c.id, "reset") { Transform2D(opacity = it.opacity) } }
        }
        Section("Zuschneiden") {
            val cr = c.crop
            fun setCrop(f: (CropRect) -> CropRect) = editor.modifyClip(c.id, "crop${c.id}") { it.copy(crop = f(it.crop)) }
            LabeledSlider("Links", cr.x, 0f..0.9f, 0f, { "%.0f%%".format(it * 100) }) { v -> setCrop { val right = it.x + it.w; val nx = v.coerceAtMost(right - 0.05f); it.copy(x = nx, w = right - nx) } }
            LabeledSlider("Rechts", 1 - cr.x - cr.w, 0f..0.9f, 0f, { "%.0f%%".format(it * 100) }) { v -> setCrop { it.copy(w = (1 - it.x - v).coerceAtLeast(0.05f)) } }
            LabeledSlider("Oben", cr.y, 0f..0.9f, 0f, { "%.0f%%".format(it * 100) }) { v -> setCrop { val bottom = it.y + it.h; val ny = v.coerceAtMost(bottom - 0.05f); it.copy(y = ny, h = bottom - ny) } }
            LabeledSlider("Unten", 1 - cr.y - cr.h, 0f..0.9f, 0f, { "%.0f%%".format(it * 100) }) { v -> setCrop { it.copy(h = (1 - it.y - v).coerceAtLeast(0.05f)) } }
        }
    }
}

// ---------- Text bearbeiten ----------

@Composable
private fun TextEditPanel(editor: EditorState) {
    val sel = editor.selection as? Sel.Text ?: return
    val t = editor.text(sel.id) ?: return
    Scroll {
        OutlinedTextField(t.text, { v -> editor.modifyText(t.id, "txt${t.id}") { it.copy(text = v) } }, modifier = Modifier.fillMaxWidth(), minLines = if (t.kind == TextKind.TEXT) 2 else 1, label = { Text(if (t.kind == TextKind.TEXT) "Text" else "Emoji") })
        if (t.kind == TextKind.TEXT) {
            Text("Schrift", fontSize = 12.sp, color = C.text2, modifier = Modifier.padding(top = 8.dp))
            LazyRow(horizontalArrangement = Arrangement.spacedBy(6.dp), modifier = Modifier.padding(vertical = 4.dp)) {
                items(TextCatalog.fonts) { (family, title) ->
                    Tile(title, t.style.font == family, modifier = Modifier.width(96.dp)) { editor.modifyText(t.id) { it.copy(style = it.style.copy(font = family)) } }
                }
            }
            Row(horizontalArrangement = Arrangement.spacedBy(6.dp)) {
                Tile("Fett", t.style.bold, Icons.Default.FormatBold, Modifier.weight(1f)) { editor.modifyText(t.id) { it.copy(style = it.style.copy(bold = !it.style.bold)) } }
                Tile("Kursiv", t.style.italic, Icons.Default.FormatItalic, Modifier.weight(1f)) { editor.modifyText(t.id) { it.copy(style = it.style.copy(italic = !it.style.italic)) } }
                Tile("GROSS", t.style.uppercase, Icons.Default.TextFields, Modifier.weight(1f)) { editor.modifyText(t.id) { it.copy(style = it.style.copy(uppercase = !it.style.uppercase)) } }
                Tile("Links", t.style.alignment == 0, Icons.Default.FormatAlignLeft, Modifier.weight(1f)) { editor.modifyText(t.id) { it.copy(style = it.style.copy(alignment = 0)) } }
                Tile("Mitte", t.style.alignment == 1, Icons.Default.FormatAlignCenter, Modifier.weight(1f)) { editor.modifyText(t.id) { it.copy(style = it.style.copy(alignment = 1)) } }
                Tile("Rechts", t.style.alignment == 2, Icons.Default.FormatAlignRight, Modifier.weight(1f)) { editor.modifyText(t.id) { it.copy(style = it.style.copy(alignment = 2)) } }
            }
            ColorRow("Farbe", t.style.color) { c -> editor.modifyText(t.id, "col${t.id}") { it.copy(style = it.style.copy(color = c)) } }
        }
        LabeledSlider("Größe", t.style.fontSize, 12f..400f, if (t.kind == TextKind.TEXT) 72f else 160f, { "%.0f".format(it) }) { v -> editor.modifyText(t.id, "fs${t.id}") { it.copy(style = it.style.copy(fontSize = v)) } }
        LabeledSlider("Dauer", t.durationUs / 1e6f, 0.1f..60f, 3f, { "%.1f s".format(it) }) { v -> editor.modifyText(t.id, "dur${t.id}") { it.copy(durationUs = (v * 1000).toLong() * 1000) } }
    }
}

@Composable
private fun TextStylePanel(editor: EditorState) {
    val sel = editor.selection as? Sel.Text ?: return
    val t = editor.text(sel.id) ?: return
    val s = t.style
    fun set(key: String, f: (TextStyle) -> TextStyle) = editor.modifyText(t.id, "st$key${t.id}") { it.copy(style = f(it.style)) }
    Scroll {
        PresetGrid(editor)
        Section("Kontur") {
            LabeledSlider("Stärke", s.strokeWidth, 0f..30f, 0f, { "%.0f".format(it) }) { v -> set("sw") { it.copy(strokeWidth = v) } }
            ColorRow("Farbe", s.strokeColor) { c -> set("sc") { it.copy(strokeColor = c) } }
        }
        Section("Schatten / Leuchten") {
            Row(verticalAlignment = Alignment.CenterVertically) { Text("Aktiv", fontSize = 13.sp, modifier = Modifier.weight(1f)); Switch(s.shadow, { v -> set("sh") { it.copy(shadow = v) } }) }
            if (s.shadow) {
                ColorRow("Farbe", s.shadowColor) { c -> set("shc") { it.copy(shadowColor = c) } }
                LabeledSlider("Weichheit", s.shadowBlur, 0f..60f, 8f, { "%.0f".format(it) }) { v -> set("shb") { it.copy(shadowBlur = v) } }
                LabeledSlider("Abstand", s.shadowOffset, 0f..40f, 4f, { "%.0f".format(it) }) { v -> set("sho") { it.copy(shadowOffset = v) } }
            }
        }
        Section("Hintergrund") {
            Row(verticalAlignment = Alignment.CenterVertically) { Text("Aktiv", fontSize = 13.sp, modifier = Modifier.weight(1f)); Switch(s.background, { v -> set("bg") { it.copy(background = v) } }) }
            if (s.background) {
                ColorRow("Farbe", s.backgroundColor) { c -> set("bgc") { it.copy(backgroundColor = c) } }
                LabeledSlider("Innenabstand", s.backgroundPadding, 0f..80f, 18f, { "%.0f".format(it) }) { v -> set("bgp") { it.copy(backgroundPadding = v) } }
                LabeledSlider("Eckenradius", s.backgroundCorner, 0f..80f, 14f, { "%.0f".format(it) }) { v -> set("bgr") { it.copy(backgroundCorner = v) } }
            }
        }
        Section("Abstände") {
            LabeledSlider("Zeichenabstand", s.letterSpacing, -0.1f..0.6f, 0f, { "%.2f".format(it) }) { v -> set("ls") { it.copy(letterSpacing = v) } }
        }
    }
}

@Composable
private fun TextAnimationPanel(editor: EditorState) {
    val sel = editor.selection as? Sel.Text ?: return
    val t = editor.text(sel.id) ?: return
    val kinds = AnimKind.entries.filter { t.kind == TextKind.TEXT || it != AnimKind.TYPEWRITER }
    Scroll {
        AnimationChooser("Einblenden", t.animIn, kinds) { s -> editor.modifyText(t.id, "ain${t.id}") { it.copy(animIn = s) } }
        AnimationChooser("Ausblenden", t.animOut, kinds.filter { it != AnimKind.POP && it != AnimKind.TYPEWRITER }) { s -> editor.modifyText(t.id, "aout${t.id}") { it.copy(animOut = s) } }
        LoopChooser(t.loop) { l -> editor.modifyText(t.id) { it.copy(loop = l) } }
    }
}

@Composable
private fun TextPositionPanel(editor: EditorState) {
    val sel = editor.selection as? Sel.Text ?: return
    Scroll { TransformControls(editor, sel.id) }
}

@Composable
private fun TextVoicePanel(editor: EditorState) {
    val ctx = LocalContext.current
    val sel = editor.selection as? Sel.Text ?: return
    val t = editor.text(sel.id) ?: return
    var voices by remember { mutableStateOf<List<Voice>>(emptyList()) }
    var voice by remember { mutableStateOf<String?>(null) }
    LaunchedEffect(Unit) { Tools.voices(ctx) { list -> voices = list.filter { it.locale.language in setOf("de", "en", "fr", "es", "it", "tr") } } }
    Scroll {
        Text("Der Text wird vorgelesen und am Textanfang in die Audiospur gelegt.", fontSize = 11.sp, color = C.text2)
        LazyRow(horizontalArrangement = Arrangement.spacedBy(6.dp), modifier = Modifier.padding(vertical = 6.dp)) {
            item { Tile("Standard", voice == null, modifier = Modifier.width(90.dp)) { voice = null } }
            items(voices.take(40)) { v -> Tile(v.locale.displayLanguage + " " + v.name.takeLast(6), voice == v.name, modifier = Modifier.width(110.dp)) { voice = v.name } }
        }
        Pill("Sprache erzeugen", prominent = true, modifier = Modifier.fillMaxWidth()) {
            editor.seek(t.startUs)
            editor.textToSpeech(t.text, voice, 1f, 1f)
        }
    }
}

@Composable
private fun EffectEditPanel(editor: EditorState) {
    val sel = editor.selection as? Sel.Effect ?: return
    val e = editor.effect(sel.id) ?: return
    Column {
        LabeledSlider("Stärke", e.intensity, 0f..1f, 0.6f, { "%.0f%%".format(it * 100) }) { v -> editor.modifyEffect(e.id, "fxi${e.id}") { it.copy(intensity = v) } }
        LabeledSlider("Dauer", e.durationUs / 1e6f, 0.1f..60f, 3f, { "%.1f s".format(it) }) { v -> editor.modifyEffect(e.id, "fxd${e.id}") { it.copy(durationUs = (v * 1000).toLong() * 1000) } }
        LazyVerticalGrid(GridCells.Adaptive(78.dp), horizontalArrangement = Arrangement.spacedBy(6.dp), verticalArrangement = Arrangement.spacedBy(6.dp), modifier = Modifier.weight(1f)) {
            items(EffectKind.entries) { k -> Tile(k.title, e.kind == k, effectIcon(k)) { editor.modifyEffect(e.id) { it.copy(kind = k) } } }
        }
    }
}

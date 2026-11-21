package com.musii.studio.ui

import androidx.compose.foundation.Canvas
import androidx.compose.foundation.background
import androidx.compose.foundation.gestures.awaitEachGesture
import androidx.compose.foundation.gestures.awaitFirstDown
import androidx.compose.foundation.layout.*
import androidx.compose.runtime.*
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clipToBounds
import androidx.compose.ui.geometry.CornerRadius
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.geometry.Rect
import androidx.compose.ui.geometry.Size
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.Path
import androidx.compose.ui.graphics.drawscope.DrawScope
import androidx.compose.ui.graphics.drawscope.Stroke
import androidx.compose.ui.graphics.drawscope.clipRect
import androidx.compose.ui.hapticfeedback.HapticFeedbackType
import androidx.compose.ui.input.pointer.pointerInput
import androidx.compose.ui.input.pointer.positionChange
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.platform.LocalHapticFeedback
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.drawText
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.rememberTextMeasurer
import androidx.compose.ui.unit.IntSize
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.musii.studio.editor.EditorState
import com.musii.studio.editor.Sel
import com.musii.studio.model.MediaKind
import com.musii.studio.model.TextKind
import kotlinx.coroutines.withTimeoutOrNull
import kotlin.math.abs
import kotlin.math.ceil
import kotlin.math.floor
import kotlin.math.max
import kotlin.math.min
import kotlin.math.roundToInt

private enum class RowType { EFFECT, TEXT, OVERLAY, MAIN, AUDIO }

private data class Row(val type: RowType, val lane: Int, val y: Float, val h: Float)

private data class TItem(
    val sel: Sel,
    val startUs: Long,
    val endUs: Long,
    val row: Int,
    val color: Color,
    val label: String,
    val mediaId: String?,
    val srcStartUs: Long = 0,
    val srcDurUs: Long = 0,
    val speed: Float = 1f,
    val keyframes: List<Long> = emptyList(),
)

private enum class Mode { PENDING, SCRUB, VSCROLL, MOVE, TRIM, ZOOM }

@Composable
fun Timeline(editor: EditorState, actions: EditorActions, modifier: Modifier, openPanel: (Panel) -> Unit) {
    val density = LocalDensity.current
    val haptic = LocalHapticFeedback.current
    val tm = rememberTextMeasurer()
    var vScroll by remember { mutableFloatStateOf(0f) }
    var userScrolled by remember { mutableStateOf(false) }
    var dragSel by remember { mutableStateOf<Sel?>(null) }
    var dragDx by remember { mutableFloatStateOf(0f) }
    var dragDy by remember { mutableFloatStateOf(0f) }
    var trimSel by remember { mutableStateOf<Sel?>(null) }
    var trimLeft by remember { mutableStateOf(true) }
    var trimDx by remember { mutableFloatStateOf(0f) }
    var size by remember { mutableStateOf(IntSize(1, 1)) }

    val p = editor.project
    val dp = density.density
    val rulerH = 18 * dp
    val laneH = 30 * dp
    val mainH = 54 * dp
    val gap = 4 * dp
    val handleW = 12 * dp
    val pps = editor.pxPerSec * dp

    // Zeilen aufbauen
    val rows = ArrayList<Row>()
    var y = rulerH + gap
    val effLanes = (p.effects.maxOfOrNull { it.lane } ?: -1) + 1
    val txtLanes = (p.texts.maxOfOrNull { it.lane } ?: -1) + 1
    val ovLanes = (p.overlays.maxOfOrNull { it.lane } ?: -1) + 1
    val auLanes = max(1, (p.audio.maxOfOrNull { it.lane } ?: -1) + 1)
    for (l in effLanes - 1 downTo 0) { rows.add(Row(RowType.EFFECT, l, y, laneH)); y += laneH + gap }
    for (l in txtLanes - 1 downTo 0) { rows.add(Row(RowType.TEXT, l, y, laneH)); y += laneH + gap }
    for (l in ovLanes - 1 downTo 0) { rows.add(Row(RowType.OVERLAY, l, y, laneH + 6 * dp)); y += laneH + 6 * dp + gap }
    val mainRow = rows.size
    rows.add(Row(RowType.MAIN, 0, y, mainH)); y += mainH + gap
    for (l in 0 until auLanes) { rows.add(Row(RowType.AUDIO, l, y, laneH)); y += laneH + gap }
    val contentH = y + 10 * dp
    fun rowIndex(t: RowType, lane: Int) = rows.indexOfFirst { it.type == t && it.lane == lane }

    // Elemente
    val items = ArrayList<TItem>()
    val slots = p.mainSlots
    p.main.forEachIndexed { i, c ->
        val m = p.media(c.mediaId)
        items.add(TItem(Sel.Main(c.id), slots[i].startUs, slots[i].endUs, mainRow, if (m?.kind == MediaKind.IMAGE) C.image else C.video,
            c.name ?: m?.name ?: "", c.mediaId, c.sourceStartUs, c.sourceDurationUs, c.speed, c.keyframes.map { it.timeUs }))
    }
    p.overlays.forEach { c -> items.add(TItem(Sel.Overlay(c.id), c.startUs, c.endUs, rowIndex(RowType.OVERLAY, c.lane), C.overlay, c.name ?: "", c.mediaId, c.sourceStartUs, c.sourceDurationUs, c.speed, c.keyframes.map { it.timeUs })) }
    p.audio.forEach { c -> items.add(TItem(Sel.Audio(c.id), c.startUs, c.endUs, rowIndex(RowType.AUDIO, c.lane), C.audio, c.name ?: "", c.mediaId, c.sourceStartUs, c.sourceDurationUs, c.speed)) }
    p.texts.forEach { t ->
        items.add(TItem(Sel.Text(t.id), t.startUs, t.endUs, rowIndex(RowType.TEXT, t.lane),
            if (t.isCaption) C.caption else if (t.kind == TextKind.TEXT) C.textClip else C.sticker,
            (if (t.kind == TextKind.TEXT) "T  " else "") + t.text.replace('\n', ' '), null, keyframes = t.keyframes.map { it.timeUs }))
    }
    p.effects.forEach { e -> items.add(TItem(Sel.Effect(e.id), e.startUs, e.endUs, rowIndex(RowType.EFFECT, e.lane), C.effect, "✦ " + e.kind.title, null)) }

    // Hauptspur automatisch sichtbar halten, solange nicht manuell gescrollt wurde
    val autoScroll = max(0f, rows[mainRow].y + mainH + gap + laneH + 6 * dp - size.height)
    val scrollY = if (userScrolled) vScroll else autoScroll
    val scrollState = rememberUpdatedState(scrollY)
    val itemsState = rememberUpdatedState(items)
    val rowsState = rememberUpdatedState(rows)
    val ppsState = rememberUpdatedState(pps)
    val contentHState = rememberUpdatedState(contentH)

    fun xOf(t: Long, w: Float) = w / 2 + (t - editor.timeUs) / 1e6f * ppsState.value

    fun hitItem(pos: Offset, w: Float): TItem? {
        val yy = pos.y + scrollState.value
        return itemsState.value.lastOrNull { it ->
            val r = rowsState.value.getOrNull(it.row) ?: return@lastOrNull false
            yy >= r.y && yy <= r.y + r.h && pos.x >= xOf(it.startUs, w) && pos.x <= xOf(it.endUs, w)
        }
    }

    fun hitHandle(pos: Offset, w: Float): Pair<TItem, Boolean>? {
        val sel = editor.selection ?: return null
        val it = itemsState.value.firstOrNull { it.sel == sel } ?: return null
        val r = rowsState.value.getOrNull(it.row) ?: return null
        val yy = pos.y + scrollState.value
        if (yy < r.y - 6 * dp || yy > r.y + r.h + 6 * dp) return null
        val x0 = xOf(it.startUs, w)
        val x1 = xOf(it.endUs, w)
        if (abs(pos.x - x0) < handleW * 1.6f) return it to true
        if (abs(pos.x - x1) < handleW * 1.6f) return it to false
        return null
    }

    Box(modifier.background(C.bg).clipToBounds()) {
        Canvas(
            Modifier
                .fillMaxSize()
                .pointerInput(Unit) {
                    awaitEachGesture {
                        val down = awaitFirstDown(requireUnconsumed = false)
                        val w = size.width.toFloat()
                        val handle = hitHandle(down.position, w)
                        val item = hitItem(down.position, w)
                        val slop = viewConfiguration.touchSlop
                        var mode = if (handle != null) Mode.TRIM else Mode.PENDING
                        val startTime = editor.timeUs
                        var totalDx = 0f
                        var totalDy = 0f
                        var zoomDist = 0f
                        var zoomPps = 0f
                        var lifted = false

                        if (mode == Mode.PENDING) {
                            val r = withTimeoutOrNull(viewConfiguration.longPressTimeoutMillis) {
                                while (true) {
                                    val e = awaitPointerEvent()
                                    val c = e.changes.first()
                                    if (!c.pressed) return@withTimeoutOrNull "up"
                                    if (e.changes.count { it.pressed } >= 2) return@withTimeoutOrNull "zoom"
                                    val d = c.position - down.position
                                    if (abs(d.x) > slop || abs(d.y) > slop) {
                                        totalDx = d.x; totalDy = d.y
                                        return@withTimeoutOrNull "moved"
                                    }
                                }
                                @Suppress("UNREACHABLE_CODE") ""
                            }
                            when (r) {
                                null -> if (item != null) {
                                    mode = Mode.MOVE
                                    haptic.performHapticFeedback(HapticFeedbackType.LongPress)
                                    editor.selection = item.sel
                                    if (editor.isPlaying) editor.pause()
                                    dragSel = item.sel; dragDx = 0f; dragDy = 0f
                                } else mode = Mode.SCRUB
                                "up" -> { lifted = true }
                                "zoom" -> mode = Mode.ZOOM
                                else -> {
                                    mode = if (abs(totalDy) > abs(totalDx)) Mode.VSCROLL else Mode.SCRUB
                                }
                            }
                            if (mode == Mode.SCRUB) {
                                if (editor.isPlaying) editor.pause()
                                editor.setScrubbing(true)
                                editor.seek((startTime - totalDx / ppsState.value * 1e6f).toLong())
                            }
                        } else {
                            if (editor.isPlaying) editor.pause()
                            trimSel = handle!!.first.sel; trimLeft = handle.second; trimDx = 0f
                        }

                        if (!lifted) {
                            while (true) {
                                val e = awaitPointerEvent()
                                val pressed = e.changes.filter { it.pressed }
                                if (pressed.isEmpty()) break
                                if (pressed.size >= 2) {
                                    val d = (pressed[0].position - pressed[1].position).getDistance()
                                    if (mode != Mode.ZOOM) { mode = Mode.ZOOM; zoomDist = d; zoomPps = editor.pxPerSec; editor.setScrubbing(false) }
                                    if (zoomDist == 0f) { zoomDist = d; zoomPps = editor.pxPerSec }
                                    if (zoomDist > 0f) editor.pxPerSec = (zoomPps * d / zoomDist).coerceIn(6f, 600f)
                                    e.changes.forEach { it.consume() }
                                    continue
                                }
                                val ch = pressed[0]
                                val delta = ch.positionChange()
                                totalDx += delta.x
                                totalDy += delta.y
                                when (mode) {
                                    Mode.SCRUB -> editor.seek((startTime - totalDx / ppsState.value * 1e6f).toLong())
                                    Mode.VSCROLL -> {
                                        if (!userScrolled) { vScroll = scrollState.value; userScrolled = true }
                                        vScroll = (vScroll - delta.y).coerceIn(0f, max(0f, contentHState.value - size.height))
                                    }
                                    Mode.MOVE -> { dragDx = totalDx; dragDy = totalDy }
                                    Mode.TRIM -> trimDx = totalDx
                                    else -> {}
                                }
                                ch.consume()
                            }
                        }

                        // Loslassen
                        when (mode) {
                            Mode.PENDING -> {
                                val pos = down.position
                                // Übergangs-Marker / Plus-Knopf
                                val mainR = rowsState.value[mainRow]
                                val yy = pos.y + scrollState.value
                                var handled = false
                                if (yy >= mainR.y && yy <= mainR.y + mainR.h) {
                                    val sl = editor.mainSlots
                                    for (i in 0 until sl.size - 1) {
                                        val jx = xOf((sl[i].endUs + sl[i + 1].startUs) / 2, w)
                                        if (abs(pos.x - jx) < 14 * dp && abs(yy - (mainR.y + mainR.h / 2)) < 14 * dp) {
                                            editor.selection = Sel.Main(editor.project.main[i].id)
                                            openPanel(Panel.TRANSITION)
                                            handled = true
                                            break
                                        }
                                    }
                                    if (!handled) {
                                        val endX = xOf(editor.project.mainDurationUs, w)
                                        if (pos.x > endX + 6 * dp && pos.x < endX + 6 * dp + mainR.h) { actions.pickMain(); handled = true }
                                    }
                                }
                                if (!handled) editor.selection = item?.sel
                            }
                            Mode.SCRUB -> editor.setScrubbing(false)
                            Mode.MOVE -> {
                                val s = dragSel
                                val it = itemsState.value.firstOrNull { it.sel == s }
                                if (s != null && it != null) {
                                    val dtUs = (totalDx / ppsState.value * 1e6f).toLong()
                                    if (s is Sel.Main) {
                                        val center = (it.startUs + it.endUs) / 2 + dtUs
                                        val sl = editor.mainSlots
                                        val idx = editor.project.main.indexOfFirst { c -> c.id == s.id }
                                        val newIndex = sl.withIndex().count { (j, x) -> j != idx && (x.startUs + x.endUs) / 2 < center }
                                        if (newIndex != idx) editor.moveMain(s.id, newIndex)
                                    } else {
                                        val proposed = max(0L, it.startUs + dtUs)
                                        val th = (10 * dp / ppsState.value * 1e6f).toLong()
                                        val s1 = editor.snap(proposed, s.id, th)
                                        val s2 = editor.snap(proposed + (it.endUs - it.startUs), s.id, th) - (it.endUs - it.startUs)
                                        val newStart = if (abs(s1 - proposed) <= abs(s2 - proposed)) s1 else max(0, s2)
                                        val r = rowsState.value[it.row]
                                        val laneDelta = (totalDy / (r.h + gap)).roundToInt()
                                        val lane = r.lane + if (r.type == RowType.AUDIO) laneDelta else -laneDelta
                                        editor.moveLaneItem(s, newStart, lane)
                                    }
                                }
                                dragSel = null; dragDx = 0f; dragDy = 0f
                            }
                            Mode.TRIM -> {
                                val s = trimSel
                                val it = itemsState.value.firstOrNull { it.sel == s }
                                if (s != null && it != null) {
                                    val th = (10 * dp / ppsState.value * 1e6f).toLong()
                                    val dtUs = (trimDx / ppsState.value * 1e6f).toLong()
                                    if (trimLeft) {
                                        val d = editor.snap(it.startUs + dtUs, s.id, th) - it.startUs
                                        if (abs(d) > 1000) editor.trim(s, d, 0)
                                    } else {
                                        val d = editor.snap(it.endUs + dtUs, s.id, th) - it.endUs
                                        if (abs(d) > 1000) editor.trim(s, 0, d)
                                    }
                                }
                                trimSel = null; trimDx = 0f
                            }
                            else -> {}
                        }
                    }
                }
        ) {
            size = IntSize(this.size.width.toInt(), this.size.height.toInt())
            val w = this.size.width
            val t0 = editor.timeUs
            fun x(t: Long) = w / 2 + (t - t0) / 1e6f * pps

            // Lineal
            val steps = listOf(0.1, 0.2, 0.5, 1.0, 2.0, 5.0, 10.0, 15.0, 30.0, 60.0, 120.0, 300.0)
            val major = steps.firstOrNull { it * pps >= 70 * dp } ?: 600.0
            val minor = major / 5
            val tLeft = (t0 / 1e6 - (w / 2) / pps).coerceAtLeast(0.0)
            val tRight = t0 / 1e6 + (w / 2) / pps
            var k = floor(tLeft / minor).toInt()
            while (k * minor <= tRight) {
                val tt = k * minor
                val xx = x((tt * 1e6).toLong())
                val isMajor = k % 5 == 0
                drawLine(Color.White.copy(alpha = if (isMajor) 0.5f else 0.22f), Offset(xx, rulerH), Offset(xx, rulerH - if (isMajor) 8 * dp else 4 * dp), 1f)
                if (isMajor) {
                    val label = if (major < 1) "%.1fs".format(tt) else "%d:%02d".format(tt.toInt() / 60, tt.toInt() % 60)
                    drawText(tm, label, Offset(xx + 3 * dp, 0f), TextStyle(fontSize = 9.sp, color = Color.White.copy(alpha = 0.55f)))
                }
                k++
            }

            clipRect(0f, rulerH, w, this.size.height) {
                // Spuren
                for (r in rows) {
                    drawRect(Color.White.copy(alpha = if (r.type == RowType.MAIN) 0.04f else 0.02f), Offset(0f, r.y - scrollY), Size(w, r.h))
                }
                if (p.audio.isEmpty()) {
                    val r = rows.last()
                    drawText(tm, "♪  Musik hinzufügen: unten „Audio“", Offset(x(0) + 8 * dp, r.y - scrollY + r.h / 2 - 7 * dp), TextStyle(fontSize = 10.sp, color = C.text2))
                }
                // Elemente
                val sel = editor.selection
                for (it in items) {
                    val r = rows.getOrNull(it.row) ?: continue
                    var x0 = x(it.startUs)
                    var x1 = x(it.endUs)
                    var yy = r.y - scrollY
                    val isDrag = dragSel == it.sel
                    if (isDrag) { x0 += dragDx; x1 += dragDx; yy += dragDy }
                    if (trimSel == it.sel) { if (trimLeft) x0 = min(x1 - 4 * dp, x0 + trimDx) else x1 = max(x0 + 4 * dp, x1 + trimDx) }
                    if (x1 < 0 || x0 > w) continue
                    val rect = Rect(x0, yy, max(x0 + 3 * dp, x1), yy + r.h)
                    drawItem(it, rect, tm, editor, sel == it.sel, pps, dp, handleW)
                }
                // Übergangs-Marker und Plus-Knopf
                val mr = rows[mainRow]
                val my = mr.y - scrollY
                val sl = slots
                for (i in 0 until sl.size - 1) {
                    val jx = x((sl[i].endUs + sl[i + 1].startUs) / 2)
                    val has = p.main[i].transition != null
                    drawRoundRect(Color.Black.copy(alpha = 0.7f), Offset(jx - 10 * dp, my + mr.h / 2 - 10 * dp), Size(20 * dp, 20 * dp), CornerRadius(4 * dp))
                    drawRoundRect(if (has) C.accent else Color.White, Offset(jx - 8 * dp, my + mr.h / 2 - 8 * dp), Size(16 * dp, 16 * dp), CornerRadius(3 * dp), style = Stroke(1.5f * dp))
                    if (has) drawLine(C.accent, Offset(jx - 4 * dp, my + mr.h / 2), Offset(jx + 4 * dp, my + mr.h / 2), 2 * dp)
                    else {
                        drawLine(Color.White, Offset(jx - 4 * dp, my + mr.h / 2), Offset(jx + 4 * dp, my + mr.h / 2), 1.5f * dp)
                        drawLine(Color.White, Offset(jx, my + mr.h / 2 - 4 * dp), Offset(jx, my + mr.h / 2 + 4 * dp), 1.5f * dp)
                    }
                }
                val endX = x(p.mainDurationUs) + 6 * dp
                drawRoundRect(Color.White, Offset(endX, my), Size(mr.h, mr.h), CornerRadius(8 * dp))
                drawLine(Color.Black, Offset(endX + mr.h / 2 - 9 * dp, my + mr.h / 2), Offset(endX + mr.h / 2 + 9 * dp, my + mr.h / 2), 3 * dp)
                drawLine(Color.Black, Offset(endX + mr.h / 2, my + mr.h / 2 - 9 * dp), Offset(endX + mr.h / 2, my + mr.h / 2 + 9 * dp), 3 * dp)
            }
            // Abspielkopf
            drawLine(Color.White, Offset(w / 2, 4 * dp), Offset(w / 2, this.size.height), 2 * dp)
            drawCircle(Color.White, 4 * dp, Offset(w / 2, 4 * dp))
        }
    }
}

private fun DrawScope.drawItem(it: TItem, rect: Rect, tm: androidx.compose.ui.text.TextMeasurer, editor: EditorState, selected: Boolean, pps: Float, dp: Float, handleW: Float) {
    val radius = CornerRadius(6 * dp)
    drawRoundRect(it.color, rect.topLeft, rect.size, radius)
    clipRect(rect.left, rect.top, rect.right, rect.bottom) {
        val p = editor.project
        val m = it.mediaId?.let { id -> p.media(id) }
        // Filmstreifen
        if (m != null && m.isVisual) {
            val frames = editor.thumbs[m.id]
            if (!frames.isNullOrEmpty()) {
                val aspect = if (m.height > 0) m.width.toFloat() / m.height else 16f / 9f
                val tw = max(16 * dp, rect.height * aspect)
                val n = ceil(rect.width / tw).toInt().coerceAtMost(200)
                for (i in 0 until n) {
                    val img = if (m.kind == MediaKind.IMAGE || frames.size == 1) frames[0] else {
                        val src = it.srcStartUs + it.srcDurUs * (i + 0.5) / n
                        frames[((src / m.durationUs.coerceAtLeast(1)) * frames.size).toInt().coerceIn(0, frames.size - 1)]
                    }
                    val dx = rect.left + i * tw
                    val ih = img.height.toFloat()
                    val iw = img.width.toFloat()
                    // Mittig zuschneiden
                    val srcAspect = iw / ih
                    val dstAspect = tw / rect.height
                    val (sw, sh) = if (srcAspect > dstAspect) Pair(ih * dstAspect, ih) else Pair(iw, iw / dstAspect)
                    drawImage(img, srcOffset = androidx.compose.ui.unit.IntOffset(((iw - sw) / 2).toInt(), ((ih - sh) / 2).toInt()),
                        srcSize = IntSize(sw.toInt().coerceAtLeast(1), sh.toInt().coerceAtLeast(1)),
                        dstOffset = androidx.compose.ui.unit.IntOffset(dx.toInt(), rect.top.toInt()),
                        dstSize = IntSize(tw.toInt() + 1, rect.height.toInt()), alpha = 0.9f)
                }
            }
        }
        // Wellenform
        if (m != null && m.hasAudio && it.sel !is Sel.Main && it.sel !is Sel.Overlay) {
            editor.waves[m.id]?.let { wave ->
                if (wave.isNotEmpty()) {
                    val first = (it.srcStartUs / 1e6 * 40).toInt()
                    val last = min(wave.size, ((it.srcStartUs + it.srcDurUs) / 1e6 * 40).toInt())
                    val cols = (rect.width / (2 * dp)).toInt().coerceAtLeast(1)
                    val mid = rect.center.y + 4 * dp
                    val path = Path()
                    for (c in 0 until cols) {
                        val a = first + (last - first) * c / cols
                        val b = max(a + 1, first + (last - first) * (c + 1) / cols)
                        var mx = 0f
                        for (q in a until min(b, wave.size)) mx = max(mx, wave[q])
                        val hh = max(0.5f * dp, mx * (rect.height - 12 * dp) / 2)
                        val xx = rect.left + c * 2 * dp
                        path.addRect(Rect(xx, mid - hh, xx + 1.4f * dp, mid + hh))
                    }
                    drawPath(path, Color.White.copy(alpha = 0.75f))
                }
            }
        }
        // Beschriftung
        val clip = editor.clip(it.sel.id)
        var label = it.label
        if (clip != null) {
            if (abs(clip.speed - 1f) > 0.001f) label = "%.2gx  ".format(clip.speed) + label
            if (clip.muted) label = "🔇 $label"
            if (clip.filter.preset != "none" || !clip.adjust.isIdentity) label = "◐ $label"
            if (clip.effects.isNotEmpty()) label = "✦ $label"
        }
        val layout = tm.measure(label, TextStyle(fontSize = 9.sp, color = Color.White, fontWeight = FontWeight.SemiBold), maxLines = 1)
        drawRoundRect(Color.Black.copy(alpha = 0.45f), Offset(rect.left + 3 * dp, rect.top + 2 * dp), Size(min(rect.width - 6 * dp, layout.size.width + 8 * dp).coerceAtLeast(0f), layout.size.height + 2 * dp), CornerRadius(3 * dp))
        drawText(layout, topLeft = Offset(rect.left + 7 * dp, rect.top + 3 * dp))
        // Keyframes
        for (k in it.keyframes) {
            val kx = rect.left + k / 1e6f * pps
            val ky = rect.bottom - 7 * dp
            val d = Path().apply { moveTo(kx, ky - 4 * dp); lineTo(kx + 4 * dp, ky); lineTo(kx, ky + 4 * dp); lineTo(kx - 4 * dp, ky); close() }
            drawPath(d, Color(0xFFFFD60A))
        }
    }
    if (selected) {
        drawRoundRect(Color.White, rect.topLeft, rect.size, radius, style = Stroke(2 * dp))
        drawRoundRect(Color.White, Offset(rect.left - handleW / 2, rect.top), Size(handleW, rect.height), CornerRadius(3 * dp))
        drawRoundRect(Color.White, Offset(rect.right - handleW / 2, rect.top), Size(handleW, rect.height), CornerRadius(3 * dp))
        drawLine(Color.Black.copy(alpha = 0.5f), Offset(rect.left, rect.center.y - 6 * dp), Offset(rect.left, rect.center.y + 6 * dp), 1.5f * dp)
        drawLine(Color.Black.copy(alpha = 0.5f), Offset(rect.right, rect.center.y - 6 * dp), Offset(rect.right, rect.center.y + 6 * dp), 1.5f * dp)
    } else {
        drawRoundRect(Color.Black.copy(alpha = 0.35f), rect.topLeft, rect.size, radius, style = Stroke(1f))
    }
}

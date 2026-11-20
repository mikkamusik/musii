package com.musii.studio.ui

import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.*
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.musii.studio.model.RGBA

object C {
    val bg = Color(0xFF131316)
    val panel = Color(0xFF1C1C20)
    val panel2 = Color(0xFF26262B)
    val panel3 = Color(0xFF333339)
    val accent = Color(0xFF21D1C7)
    val accent2 = Color(0xFFFA528C)
    val text2 = Color(0x99FFFFFF)
    val video = Color(0xFF2A6B9E)
    val image = Color(0xFF387A66)
    val overlay = Color(0xFF734DA6)
    val audio = Color(0xFF2E8049)
    val textClip = Color(0xFFBF7A1F)
    val sticker = Color(0xFFC74D73)
    val effect = Color(0xFF8C40BF)
    val caption = Color(0xFF998C26)
}

fun RGBA.toColor() = Color(r.coerceIn(0f, 1f), g.coerceIn(0f, 1f), b.coerceIn(0f, 1f), a.coerceIn(0f, 1f))
fun Color.toRGBA() = RGBA(red, green, blue, alpha)

@Composable
fun MusiiTheme(content: @Composable () -> Unit) {
    MaterialTheme(
        colorScheme = darkColorScheme(
            primary = C.accent,
            onPrimary = Color.Black,
            secondary = C.accent2,
            background = C.bg,
            surface = C.panel,
            surfaceVariant = C.panel2,
            onSurface = Color.White,
            onBackground = Color.White,
        ),
        content = content,
    )
}

fun formatTime(us: Long): String {
    val total = us.coerceAtLeast(0) / 1000
    val m = total / 60000
    val s = (total / 1000) % 60
    val cs = (total % 1000) / 10
    return "%02d:%02d.%02d".format(m, s, cs)
}

@Composable
fun ToolButton(icon: ImageVector, label: String, active: Boolean = false, enabled: Boolean = true, onClick: () -> Unit) {
    Column(
        Modifier
            .width(64.dp)
            .clip(RoundedCornerShape(10.dp))
            .clickable(enabled = enabled, onClick = onClick)
            .padding(vertical = 6.dp),
        horizontalAlignment = Alignment.CenterHorizontally,
    ) {
        Icon(icon, contentDescription = label, tint = when { !enabled -> Color.White.copy(alpha = 0.3f); active -> C.accent; else -> Color.White }, modifier = Modifier.size(22.dp))
        Spacer(Modifier.height(3.dp))
        Text(label, fontSize = 10.sp, color = if (active) C.accent else Color.White.copy(alpha = if (enabled) 0.85f else 0.3f), maxLines = 1, overflow = TextOverflow.Ellipsis, textAlign = TextAlign.Center)
    }
}

@Composable
fun Tile(title: String, selected: Boolean = false, icon: ImageVector? = null, modifier: Modifier = Modifier, onClick: () -> Unit) {
    Column(
        modifier
            .clip(RoundedCornerShape(10.dp))
            .background(if (selected) C.accent.copy(alpha = 0.18f) else C.panel2)
            .border(1.5.dp, if (selected) C.accent else Color.Transparent, RoundedCornerShape(10.dp))
            .clickable(onClick = onClick)
            .padding(vertical = 10.dp, horizontal = 4.dp),
        horizontalAlignment = Alignment.CenterHorizontally,
        verticalArrangement = Arrangement.Center,
    ) {
        if (icon != null) {
            Icon(icon, null, tint = if (selected) C.accent else Color.White, modifier = Modifier.size(22.dp))
            Spacer(Modifier.height(4.dp))
        }
        Text(title, fontSize = 11.sp, maxLines = 1, overflow = TextOverflow.Ellipsis, color = Color.White.copy(alpha = 0.9f), textAlign = TextAlign.Center)
    }
}

@Composable
fun LabeledSlider(
    title: String,
    value: Float,
    range: ClosedFloatingPointRange<Float>,
    default: Float? = null,
    display: (Float) -> String = { "%.0f".format(it) },
    onChange: (Float) -> Unit,
) {
    Column(Modifier.fillMaxWidth().padding(vertical = 2.dp)) {
        Row(verticalAlignment = Alignment.CenterVertically) {
            Text(title, fontSize = 12.sp, color = C.text2, modifier = Modifier.weight(1f))
            Text(display(value), fontSize = 12.sp, color = Color.White)
            if (default != null && kotlin.math.abs(value - default) > 0.0001f) {
                Text("↺", fontSize = 14.sp, color = C.accent, modifier = Modifier.padding(start = 8.dp).clickable { onChange(default) })
            }
        }
        Slider(
            value = value.coerceIn(range.start, range.endInclusive),
            onValueChange = onChange,
            valueRange = range,
            modifier = Modifier.height(28.dp),
            colors = SliderDefaults.colors(thumbColor = Color.White, activeTrackColor = C.accent, inactiveTrackColor = C.panel3),
        )
    }
}

@Composable
fun Section(title: String, trailing: @Composable (() -> Unit)? = null, content: @Composable ColumnScope.() -> Unit) {
    Column(
        Modifier
            .fillMaxWidth()
            .padding(vertical = 4.dp)
            .clip(RoundedCornerShape(10.dp))
            .background(C.panel2)
            .padding(10.dp)
    ) {
        Row(verticalAlignment = Alignment.CenterVertically) {
            Text(title.uppercase(), fontSize = 10.sp, fontWeight = FontWeight.SemiBold, color = C.text2, modifier = Modifier.weight(1f))
            trailing?.invoke()
        }
        Spacer(Modifier.height(6.dp))
        content()
    }
}

@Composable
fun Pill(text: String, prominent: Boolean = false, modifier: Modifier = Modifier, onClick: () -> Unit) {
    Box(
        modifier
            .clip(RoundedCornerShape(8.dp))
            .background(if (prominent) C.accent else C.panel3)
            .clickable(onClick = onClick)
            .padding(horizontal = 14.dp, vertical = 9.dp),
        contentAlignment = Alignment.Center,
    ) {
        Text(text, fontSize = 13.sp, fontWeight = FontWeight.Medium, color = if (prominent) Color.Black else Color.White, maxLines = 1)
    }
}

val swatches = listOf(
    Color.White, Color.Black, Color(0xFFFF3B30), Color(0xFFFF9500), Color(0xFFFFCC00), Color(0xFF34C759), Color(0xFF00C7BE),
    Color(0xFF32ADE6), Color(0xFF007AFF), Color(0xFF5856D6), Color(0xFFAF52DE), Color(0xFFFF2D55), Color(0xFFA2845E), Color(0xFF8E8E93),
)

@Composable
fun ColorRow(title: String, color: RGBA, onChange: (RGBA) -> Unit) {
    Column(Modifier.fillMaxWidth().padding(vertical = 4.dp)) {
        Text(title, fontSize = 12.sp, color = C.text2)
        Spacer(Modifier.height(4.dp))
        Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(6.dp)) {
            swatches.take(7).forEach { sw -> Swatch(sw, color, onChange) }
        }
        Spacer(Modifier.height(6.dp))
        Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(6.dp)) {
            swatches.drop(7).forEach { sw -> Swatch(sw, color, onChange) }
        }
        LabeledSlider("Deckkraft", color.a, 0f..1f, 1f, { "%.0f%%".format(it * 100) }) { onChange(color.copy(a = it)) }
    }
}

@Composable
private fun RowScope.Swatch(sw: Color, current: RGBA, onChange: (RGBA) -> Unit) {
    val sel = kotlin.math.abs(sw.red - current.r) < 0.02f && kotlin.math.abs(sw.green - current.g) < 0.02f && kotlin.math.abs(sw.blue - current.b) < 0.02f
    Box(
        Modifier
            .weight(1f)
            .aspectRatio(1f)
            .clip(RoundedCornerShape(50))
            .background(sw)
            .border(if (sel) 2.5.dp else 1.dp, if (sel) C.accent else Color.White.copy(alpha = 0.25f), RoundedCornerShape(50))
            .clickable { onChange(sw.toRGBA().copy(a = current.a)) }
    )
}

@Composable
fun AppLogo(size: androidx.compose.ui.unit.Dp) {
    Box(
        Modifier
            .size(size)
            .clip(RoundedCornerShape(size * 0.24f))
            .background(Brush.linearGradient(listOf(C.accent, C.accent2))),
        contentAlignment = Alignment.Center,
    ) {
        Text("▶", color = Color.White, fontSize = (size.value * 0.42f).sp, fontWeight = FontWeight.Bold)
    }
}

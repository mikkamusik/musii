package com.musii.studio.model

import kotlinx.serialization.Serializable

/** Effekt-IDs (die Nummer `code` wird im Shader verwendet) */
@Serializable
enum class EffectKind(val title: String, val code: Int) {
    BLUR("Weichzeichnen", 1),
    PIXELATE("Verpixeln", 2),
    GLITCH("Glitch", 3),
    RGB_SPLIT("RGB-Versatz", 4),
    VHS("VHS", 5),
    MIRROR("Spiegeln", 6),
    KALEIDOSCOPE("Kaleidoskop", 7),
    ZOOM_PULSE("Zoom-Puls", 8),
    SHAKE("Erschütterung", 9),
    GLOW("Leuchten", 10),
    POSTERIZE("Poster", 11),
    INVERT("Negativ", 12),
    EDGES("Kanten", 13),
    THERMAL("Wärmebild", 14),
    STROBE("Stroboskop", 15),
    OLD_FILM("Alter Film", 16),
    LETTERBOX("Kinobalken", 17),
    SPLIT4("Split 4", 18),
    SPLIT9("Split 9", 19),
    TWIRL("Strudel", 20),
    BULGE("Wölbung", 21),
    FLASH("Blitz", 22),
    SNOW("Schnee", 23),
    RAIN("Regen", 24),
    SPARKLE("Funkeln", 25),
    LIGHT_LEAK("Lichteinfall", 26),
    VIGNETTE("Vignette", 27),
    BLACK_WHITE("S/W-Wechsel", 28),
    HALFTONE("Raster", 29),
    SCANLINES("Bildröhre", 30),
}

@Serializable
enum class TransitionKind(val title: String, val code: Int) {
    NONE("Keiner", 0),
    DISSOLVE("Überblenden", 1),
    DIP_BLACK("Schwarzblende", 2),
    DIP_WHITE("Weißblende", 3),
    WIPE_LEFT("Wischen ←", 4),
    WIPE_RIGHT("Wischen →", 5),
    WIPE_UP("Wischen ↑", 6),
    WIPE_DOWN("Wischen ↓", 7),
    PUSH_LEFT("Schieben ←", 8),
    PUSH_RIGHT("Schieben →", 9),
    PUSH_UP("Schieben ↑", 10),
    PUSH_DOWN("Schieben ↓", 11),
    SLIDE_LEFT("Gleiten ←", 12),
    SLIDE_RIGHT("Gleiten →", 13),
    ZOOM_IN("Zoom rein", 14),
    ZOOM_OUT("Zoom raus", 15),
    BLUR("Unschärfe", 16),
    CIRCLE("Kreis", 17),
    SPIN("Drehung", 18),
    PIXELATE("Pixel", 19),
    FLASH("Blitz", 20),
    GLITCH("Glitch", 21),
}

val AnimKind.title: String
    get() = when (this) {
        AnimKind.NONE -> "Keine"
        AnimKind.FADE -> "Einblenden"
        AnimKind.ZOOM_IN -> "Zoom rein"
        AnimKind.ZOOM_OUT -> "Zoom raus"
        AnimKind.SLIDE_LEFT -> "Von rechts"
        AnimKind.SLIDE_RIGHT -> "Von links"
        AnimKind.SLIDE_UP -> "Von unten"
        AnimKind.SLIDE_DOWN -> "Von oben"
        AnimKind.SPIN -> "Drehen"
        AnimKind.POP -> "Pop"
        AnimKind.BLUR -> "Unschärfe"
        AnimKind.TYPEWRITER -> "Schreibmaschine"
        AnimKind.DROP -> "Fallen"
        AnimKind.SWING -> "Schwingen"
    }

val LoopAnim.title: String
    get() = when (this) {
        LoopAnim.NONE -> "Keine"
        LoopAnim.KEN_BURNS -> "Ken Burns"
        LoopAnim.PULSE -> "Pulsieren"
        LoopAnim.SHAKE -> "Wackeln"
        LoopAnim.SWING -> "Pendeln"
        LoopAnim.FLOAT -> "Schweben"
        LoopAnim.FLICKER -> "Flackern"
        LoopAnim.ROTATE -> "Rotieren"
        LoopAnim.HEARTBEAT -> "Herzschlag"
    }

val MaskKind.title: String
    get() = when (this) {
        MaskKind.NONE -> "Keine"
        MaskKind.CIRCLE -> "Kreis"
        MaskKind.RECTANGLE -> "Rechteck"
        MaskKind.LINEAR -> "Linear"
        MaskKind.MIRROR -> "Spiegel"
        MaskKind.HEART -> "Herz"
    }

/**
 * Filter-Vorlage als Parametersatz für den Farb-Shader.
 * Werte im Bereich wie Adjustments (-100..100) plus Sonderfarbwerte.
 */
data class FilterPreset(
    val id: String,
    val title: String,
    val adjust: Adjustments = Adjustments(),
    /** 0 = normal, 1 = Mono, 2 = Sepia, 3 = Noir (kontrastreich S/W) */
    val tone: Int = 0,
    /** Farbverschiebung Schatten (r,g,b) und Lichter (r,g,b) – Split-Toning */
    val shadowTint: RGBA = RGBA(0f, 0f, 0f, 0f),
    val highlightTint: RGBA = RGBA(0f, 0f, 0f, 0f),
)

object FilterCatalog {
    val all: List<FilterPreset> = listOf(
        FilterPreset("none", "Original"),
        FilterPreset("vivid", "Lebendig", Adjustments(contrast = 15f, saturation = 35f, vibrance = 30f)),
        FilterPreset("warm", "Warm", Adjustments(temperature = 45f, saturation = 8f)),
        FilterPreset("cool", "Kühl", Adjustments(temperature = -45f)),
        FilterPreset("tealOrange", "Teal & Orange", Adjustments(contrast = 15f, saturation = 15f),
            shadowTint = RGBA(-0.03f, 0.04f, 0.09f, 1f), highlightTint = RGBA(0.09f, 0.03f, -0.06f, 1f)),
        FilterPreset("cinema", "Kino", Adjustments(contrast = 25f, saturation = -15f, vignette = 35f),
            shadowTint = RGBA(0f, 0.02f, 0.05f, 1f)),
        FilterPreset("dramatic", "Dramatisch", Adjustments(brightness = -8f, contrast = 55f, saturation = -22f, vignette = 60f)),
        FilterPreset("film", "Film", Adjustments(contrast = 5f, temperature = 15f, fade = 35f, grain = 25f)),
        FilterPreset("retro", "Retro", Adjustments(saturation = -15f, temperature = 30f, vignette = 40f, fade = 20f), tone = 0,
            highlightTint = RGBA(0.06f, 0.03f, -0.04f, 1f)),
        FilterPreset("vintage", "Vintage", Adjustments(contrast = -10f, saturation = -25f, temperature = 25f, fade = 45f)),
        FilterPreset("dreamy", "Verträumt", Adjustments(brightness = 10f, contrast = -12f, saturation = -10f, highlights = 30f)),
        FilterPreset("pastel", "Pastell", Adjustments(brightness = 14f, contrast = -30f, saturation = -30f, temperature = 10f)),
        FilterPreset("cyber", "Cyber", Adjustments(contrast = 20f, saturation = 45f, temperature = -35f, tint = 40f, hue = 12f)),
        FilterPreset("sunset", "Sonnenuntergang", Adjustments(contrast = 8f, saturation = 22f, temperature = 70f, tint = 18f)),
        FilterPreset("forest", "Wald", Adjustments(contrast = 8f, saturation = 12f, tint = -25f)),
        FilterPreset("matte", "Matt", Adjustments(saturation = -12f, fade = 55f)),
        FilterPreset("golden", "Goldene Stunde", Adjustments(brightness = 4f, saturation = 15f, temperature = 55f, tint = 10f)),
        FilterPreset("night", "Nacht", Adjustments(exposure = -35f, saturation = -30f, temperature = -55f)),
        FilterPreset("sepia", "Sepia", tone = 2),
        FilterPreset("mono", "Mono", tone = 1),
        FilterPreset("noir", "Noir", Adjustments(contrast = 45f), tone = 3),
        FilterPreset("fade", "Verblasst", Adjustments(contrast = -20f, saturation = -35f, fade = 40f)),
        FilterPreset("chrome", "Chrom", Adjustments(contrast = 18f, saturation = 18f, highlights = 15f)),
        FilterPreset("instant", "Sofortbild", Adjustments(contrast = -8f, saturation = -10f, temperature = 20f, fade = 25f),
            shadowTint = RGBA(0.02f, 0.03f, 0.06f, 1f)),
    )

    fun byId(id: String) = all.firstOrNull { it.id == id } ?: all[0]
}

data class TextPreset(val id: String, val title: String, val style: TextStyle)

object TextCatalog {
    val fonts: List<Pair<String, String>> = listOf(
        "sans-serif" to "Standard",
        "sans-serif-medium" to "Medium",
        "sans-serif-black" to "Black",
        "sans-serif-light" to "Light",
        "sans-serif-condensed" to "Schmal",
        "sans-serif-thin" to "Dünn",
        "serif" to "Serif",
        "monospace" to "Mono",
        "serif-monospace" to "Schreibmaschine",
        "casual" to "Lässig",
        "cursive" to "Schreibschrift",
        "sans-serif-smallcaps" to "Kapitälchen",
    )

    val presets: List<TextPreset> = listOf(
        TextPreset("basic", "Standard", TextStyle()),
        TextPreset("outline", "Kontur", TextStyle(strokeWidth = 6f)),
        TextPreset("subtitle", "Untertitel", TextStyle(fontSize = 54f, bold = false, background = true, backgroundColor = RGBA(0f, 0f, 0f, 0.65f))),
        TextPreset("neon", "Neon", TextStyle(color = RGBA(0.3f, 1f, 1f), shadow = true, shadowColor = RGBA(0f, 0.9f, 1f), shadowBlur = 24f, shadowOffset = 0f)),
        TextPreset("meme", "Meme", TextStyle(font = "sans-serif-black", color = RGBA.Yellow, strokeWidth = 8f, uppercase = true)),
        TextPreset("shadow", "Schatten", TextStyle(shadow = true, shadowBlur = 10f, shadowOffset = 6f)),
        TextPreset("pinkbox", "Pink Box", TextStyle(background = true, backgroundColor = RGBA(1f, 0.2f, 0.55f))),
        TextPreset("whitebox", "Weiße Box", TextStyle(color = RGBA.Black, background = true, backgroundColor = RGBA.White)),
        TextPreset("retro", "Retro", TextStyle(font = "serif", color = RGBA(1f, 0.55f, 0.1f), shadow = true, shadowColor = RGBA(0.35f, 0.12f, 0f), shadowBlur = 0f, shadowOffset = 6f)),
        TextPreset("comic", "Comic", TextStyle(font = "casual", color = RGBA.Yellow, strokeWidth = 5f)),
        TextPreset("elegant", "Elegant", TextStyle(font = "serif", bold = false, italic = true, letterSpacing = 0.08f)),
        TextPreset("script", "Handschrift", TextStyle(font = "cursive", fontSize = 90f, shadow = true, shadowBlur = 6f, shadowOffset = 2f)),
        TextPreset("minimal", "Minimal", TextStyle(font = "sans-serif-light", uppercase = true, letterSpacing = 0.3f)),
        TextPreset("typewriter", "Schreibmaschine", TextStyle(font = "serif-monospace", bold = false, color = RGBA(0.95f, 0.95f, 0.9f))),
        TextPreset("bold", "Knallig", TextStyle(font = "sans-serif-black", color = RGBA(1f, 0.25f, 0.25f), strokeWidth = 6f, strokeColor = RGBA.White)),
        TextPreset("violet", "Lila Glühen", TextStyle(color = RGBA(0.75f, 0.5f, 1f), shadow = true, shadowColor = RGBA(0.7f, 0.2f, 1f), shadowBlur = 28f, shadowOffset = 0f)),
    )
}

object StickerCatalog {
    val groups: List<Pair<String, List<String>>> = listOf(
        "Gesichter" to listOf("😀", "😂", "🤣", "😍", "🥰", "😎", "🤩", "🥳", "😜", "🤔", "😱", "😭", "😡", "🤯", "🥺", "😴", "🤫", "🙄", "😇", "🤠"),
        "Gesten" to listOf("👍", "👎", "👏", "🙌", "🙏", "💪", "👋", "✌️", "🤞", "👌", "🤙", "👉", "👈", "👆", "👇", "🫶"),
        "Herzen" to listOf("❤️", "🧡", "💛", "💚", "💙", "💜", "🖤", "🤍", "💖", "💘", "💔", "💯", "✨", "⭐", "🌟", "💥"),
        "Feiern" to listOf("🎉", "🎊", "🎁", "🎂", "🍾", "🥂", "🎈", "🏆", "🥇", "👑", "💎", "🔥", "⚡", "🌈", "☀️", "🌙"),
        "Musik" to listOf("🎵", "🎶", "🎤", "🎧", "🎸", "🥁", "🎹", "🎷", "🎺", "🎻", "📻", "🔊", "💿", "📀", "🪩", "🕺"),
        "Tiere" to listOf("🐶", "🐱", "🦊", "🐻", "🐼", "🐨", "🦁", "🐯", "🐸", "🐵", "🦄", "🐝", "🦋", "🐬", "🐙", "🦖"),
        "Essen" to listOf("🍕", "🍔", "🍟", "🌮", "🍩", "🍪", "🍰", "🍦", "🍓", "🍉", "🍌", "🥑", "☕", "🍹", "🍺", "🍿"),
        "Reisen" to listOf("✈️", "🚗", "🏝️", "🏔️", "🌍", "🗺️", "📍", "🏠", "🌃", "🎡", "⛱️", "🚀", "🛸", "⏰", "📸", "🎬"),
        "Zeichen" to listOf("➡️", "⬅️", "⬆️", "⬇️", "✅", "❌", "⚠️", "❓", "❗", "💬", "💭", "🔔", "📢", "🆕", "🔝", "🆒"),
    )
}

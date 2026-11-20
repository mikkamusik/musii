import Foundation

// MARK: - Effekte

enum EffectKind: String, Codable, CaseIterable, Identifiable {
    case blur, pixelate, glitch, rgbSplit, vhs, mirror, kaleidoscope, zoomPulse, shake, glow
    case comic, posterize, invert, edges, crystallize, dots, thermal, strobe, oldFilm, letterbox
    case split4, split9, twirl, bulge, hexagon, flash, snow, rain, sparkle, lightLeak, vignette, blackWhite

    var id: String { rawValue }

    var title: String {
        switch self {
        case .blur: return "Weichzeichnen"
        case .pixelate: return "Verpixeln"
        case .glitch: return "Glitch"
        case .rgbSplit: return "RGB-Versatz"
        case .vhs: return "VHS"
        case .mirror: return "Spiegeln"
        case .kaleidoscope: return "Kaleidoskop"
        case .zoomPulse: return "Zoom-Puls"
        case .shake: return "Erschütterung"
        case .glow: return "Leuchten"
        case .comic: return "Comic"
        case .posterize: return "Poster"
        case .invert: return "Negativ"
        case .edges: return "Kanten"
        case .crystallize: return "Kristall"
        case .dots: return "Raster"
        case .thermal: return "Wärmebild"
        case .strobe: return "Stroboskop"
        case .oldFilm: return "Alter Film"
        case .letterbox: return "Kinobalken"
        case .split4: return "Split 4"
        case .split9: return "Split 9"
        case .twirl: return "Strudel"
        case .bulge: return "Wölbung"
        case .hexagon: return "Waben"
        case .flash: return "Blitz"
        case .snow: return "Schnee"
        case .rain: return "Regen"
        case .sparkle: return "Funkeln"
        case .lightLeak: return "Lichteinfall"
        case .vignette: return "Vignette"
        case .blackWhite: return "S/W-Wechsel"
        }
    }

    var symbol: String {
        switch self {
        case .blur: return "drop"
        case .pixelate: return "square.grid.3x3"
        case .glitch: return "waveform.path"
        case .rgbSplit: return "circle.hexagongrid"
        case .vhs: return "tv"
        case .mirror: return "arrow.left.and.right.righttriangle.left.righttriangle.right"
        case .kaleidoscope: return "seal"
        case .zoomPulse: return "plus.magnifyingglass"
        case .shake: return "iphone.radiowaves.left.and.right"
        case .glow: return "sun.max"
        case .comic: return "text.bubble"
        case .posterize: return "paintpalette"
        case .invert: return "circle.lefthalf.filled"
        case .edges: return "scribble"
        case .crystallize: return "diamond"
        case .dots: return "circle.grid.3x3"
        case .thermal: return "thermometer"
        case .strobe: return "light.max"
        case .oldFilm: return "film"
        case .letterbox: return "rectangle.ratio.16.to.9"
        case .split4: return "square.grid.2x2"
        case .split9: return "square.grid.3x3.fill"
        case .twirl: return "tornado"
        case .bulge: return "circle.circle"
        case .hexagon: return "hexagon"
        case .flash: return "bolt"
        case .snow: return "snowflake"
        case .rain: return "cloud.rain"
        case .sparkle: return "sparkles"
        case .lightLeak: return "sun.haze"
        case .vignette: return "camera.aperture"
        case .blackWhite: return "circle.righthalf.filled"
        }
    }
}

// MARK: - Übergänge

enum TransitionKind: String, Codable, CaseIterable, Identifiable {
    case none, dissolve, dipBlack, dipWhite, wipeLeft, wipeRight, wipeUp, wipeDown
    case pushLeft, pushRight, pushUp, pushDown, slideLeft, slideRight, zoomIn, zoomOut
    case blur, circle, spin, pixelate, flash, glitch, pageCurl, ripple, bars, copyMachine, mod, swipe

    var id: String { rawValue }

    var title: String {
        switch self {
        case .none: return "Keiner"
        case .dissolve: return "Überblenden"
        case .dipBlack: return "Schwarzblende"
        case .dipWhite: return "Weißblende"
        case .wipeLeft: return "Wischen ←"
        case .wipeRight: return "Wischen →"
        case .wipeUp: return "Wischen ↑"
        case .wipeDown: return "Wischen ↓"
        case .pushLeft: return "Schieben ←"
        case .pushRight: return "Schieben →"
        case .pushUp: return "Schieben ↑"
        case .pushDown: return "Schieben ↓"
        case .slideLeft: return "Gleiten ←"
        case .slideRight: return "Gleiten →"
        case .zoomIn: return "Zoom rein"
        case .zoomOut: return "Zoom raus"
        case .blur: return "Unschärfe"
        case .circle: return "Kreis"
        case .spin: return "Drehung"
        case .pixelate: return "Pixel"
        case .flash: return "Blitz"
        case .glitch: return "Glitch"
        case .pageCurl: return "Umblättern"
        case .ripple: return "Welle"
        case .bars: return "Balken"
        case .copyMachine: return "Kopierer"
        case .mod: return "Muster"
        case .swipe: return "Weich wischen"
        }
    }

    var symbol: String {
        switch self {
        case .none: return "nosign"
        case .dissolve: return "circle.lefthalf.filled"
        case .dipBlack: return "moon.fill"
        case .dipWhite: return "sun.max.fill"
        case .wipeLeft: return "arrow.left.square"
        case .wipeRight: return "arrow.right.square"
        case .wipeUp: return "arrow.up.square"
        case .wipeDown: return "arrow.down.square"
        case .pushLeft: return "arrow.left.to.line"
        case .pushRight: return "arrow.right.to.line"
        case .pushUp: return "arrow.up.to.line"
        case .pushDown: return "arrow.down.to.line"
        case .slideLeft: return "rectangle.lefthalf.inset.filled"
        case .slideRight: return "rectangle.righthalf.inset.filled"
        case .zoomIn: return "plus.magnifyingglass"
        case .zoomOut: return "minus.magnifyingglass"
        case .blur: return "drop"
        case .circle: return "circle.dashed"
        case .spin: return "arrow.triangle.2.circlepath"
        case .pixelate: return "square.grid.3x3"
        case .flash: return "bolt.fill"
        case .glitch: return "waveform.path"
        case .pageCurl: return "doc.richtext"
        case .ripple: return "water.waves"
        case .bars: return "line.3.horizontal"
        case .copyMachine: return "printer"
        case .mod: return "circle.grid.cross"
        case .swipe: return "hand.draw"
        }
    }
}

// MARK: - Filter-Vorlagen

struct FilterPreset: Identifiable {
    let id: String
    let title: String
}

enum FilterCatalog {
    static let all: [FilterPreset] = [
        FilterPreset(id: "none", title: "Original"),
        FilterPreset(id: "vivid", title: "Lebendig"),
        FilterPreset(id: "warm", title: "Warm"),
        FilterPreset(id: "cool", title: "Kühl"),
        FilterPreset(id: "tealOrange", title: "Teal & Orange"),
        FilterPreset(id: "cinema", title: "Kino"),
        FilterPreset(id: "dramatic", title: "Dramatisch"),
        FilterPreset(id: "film", title: "Film"),
        FilterPreset(id: "retro", title: "Retro"),
        FilterPreset(id: "vintage", title: "Vintage"),
        FilterPreset(id: "dreamy", title: "Verträumt"),
        FilterPreset(id: "pastel", title: "Pastell"),
        FilterPreset(id: "cyber", title: "Cyber"),
        FilterPreset(id: "sunset", title: "Sonnenuntergang"),
        FilterPreset(id: "forest", title: "Wald"),
        FilterPreset(id: "chrome", title: "Chrom"),
        FilterPreset(id: "fade", title: "Verblasst"),
        FilterPreset(id: "instant", title: "Sofortbild"),
        FilterPreset(id: "process", title: "Prozess"),
        FilterPreset(id: "transfer", title: "Transfer"),
        FilterPreset(id: "sepia", title: "Sepia"),
        FilterPreset(id: "mono", title: "Mono"),
        FilterPreset(id: "noir", title: "Noir"),
        FilterPreset(id: "tonal", title: "Tonal"),
        FilterPreset(id: "highContrastBW", title: "S/W Kontrast"),
        FilterPreset(id: "night", title: "Nacht"),
        FilterPreset(id: "golden", title: "Goldene Stunde"),
        FilterPreset(id: "matte", title: "Matt"),
    ]

    static func title(_ id: String) -> String { all.first { $0.id == id }?.title ?? id }
}

// MARK: - Text-Vorlagen

struct TextPreset: Identifiable {
    let id: String
    let title: String
    let style: TextStyle
}

enum TextCatalog {
    static var presets: [TextPreset] {
        var list: [TextPreset] = []
        var s = TextStyle()
        list.append(TextPreset(id: "basic", title: "Standard", style: s))

        s = TextStyle(); s.strokeWidth = 6; s.strokeColor = .black
        list.append(TextPreset(id: "outline", title: "Kontur", style: s))

        s = TextStyle(); s.background = true; s.backgroundColor = RGBA(0, 0, 0, 0.65); s.fontSize = 54; s.bold = false
        list.append(TextPreset(id: "subtitle", title: "Untertitel", style: s))

        s = TextStyle(); s.color = RGBA(0.3, 1, 1); s.shadow = true; s.shadowColor = RGBA(0, 0.9, 1, 1); s.shadowBlur = 24; s.shadowOffset = 0
        list.append(TextPreset(id: "neon", title: "Neon", style: s))

        s = TextStyle(); s.color = .yellow; s.strokeWidth = 8; s.strokeColor = .black; s.fontFamily = "Impact"; s.uppercase = true
        list.append(TextPreset(id: "meme", title: "Meme", style: s))

        s = TextStyle(); s.shadow = true; s.shadowBlur = 10; s.shadowOffset = 6
        list.append(TextPreset(id: "shadow", title: "Schatten", style: s))

        s = TextStyle(); s.background = true; s.backgroundColor = RGBA(1, 0.2, 0.55); s.fontFamily = "Avenir Next"
        list.append(TextPreset(id: "pinkbox", title: "Pink Box", style: s))

        s = TextStyle(); s.background = true; s.backgroundColor = .white; s.color = .black; s.fontFamily = "Avenir Next"
        list.append(TextPreset(id: "whitebox", title: "Weiße Box", style: s))

        s = TextStyle(); s.color = RGBA(1, 0.55, 0.1); s.shadow = true; s.shadowColor = RGBA(0.35, 0.12, 0, 1); s.shadowBlur = 0; s.shadowOffset = 6; s.fontFamily = "Cooper Black"
        list.append(TextPreset(id: "retro", title: "Retro", style: s))

        s = TextStyle(); s.color = .yellow; s.strokeWidth = 5; s.strokeColor = .black; s.fontFamily = "Marker Felt"
        list.append(TextPreset(id: "comic", title: "Comic", style: s))

        s = TextStyle(); s.fontFamily = "Didot"; s.bold = false; s.italic = true; s.letterSpacing = 2
        list.append(TextPreset(id: "elegant", title: "Elegant", style: s))

        s = TextStyle(); s.fontFamily = "Snell Roundhand"; s.bold = true; s.fontSize = 90; s.shadow = true; s.shadowBlur = 6; s.shadowOffset = 2
        list.append(TextPreset(id: "script", title: "Handschrift", style: s))

        s = TextStyle(); s.fontFamily = "Futura"; s.uppercase = true; s.letterSpacing = 8; s.bold = true
        list.append(TextPreset(id: "minimal", title: "Minimal", style: s))

        s = TextStyle(); s.fontFamily = "American Typewriter"; s.bold = false; s.color = RGBA(0.95, 0.95, 0.9)
        list.append(TextPreset(id: "typewriter", title: "Schreibmaschine", style: s))

        s = TextStyle(); s.color = RGBA(1, 0.25, 0.25); s.strokeWidth = 6; s.strokeColor = .white; s.fontFamily = "Arial Black"
        list.append(TextPreset(id: "bold", title: "Knallig", style: s))

        s = TextStyle(); s.color = RGBA(0.75, 0.5, 1); s.shadow = true; s.shadowColor = RGBA(0.7, 0.2, 1, 1); s.shadowBlur = 28; s.shadowOffset = 0; s.fontFamily = "Avenir Next"
        list.append(TextPreset(id: "violet", title: "Lila Glühen", style: s))
        return list
    }

    static let fonts: [String] = [
        "Helvetica Neue", "Avenir Next", "Futura", "Gill Sans", "Optima", "Arial", "Arial Black", "Impact",
        "Georgia", "Didot", "Baskerville", "Times New Roman", "Rockwell", "American Typewriter", "Courier New", "Menlo",
        "Marker Felt", "Chalkboard SE", "Noteworthy", "Bradley Hand", "Snell Roundhand", "Zapfino", "Savoye LET",
        "Copperplate", "Cooper Black", "Papyrus", "Phosphate", "Herculanum", "Trattatello", "Luminari", "Chalkduster",
        "Big Caslon", "Hoefler Text", "Palatino", "Trebuchet MS", "Verdana", "Tahoma", "Skia", "Kefa", "SignPainter",
    ]
}

// MARK: - Sticker

enum StickerCatalog {
    static let emojiGroups: [(String, [String])] = [
        ("Gesichter", ["😀", "😂", "🤣", "😍", "🥰", "😎", "🤩", "🥳", "😜", "🤔", "😱", "😭", "😡", "🤯", "🥺", "😴", "🤫", "🙄", "😇", "🤠"]),
        ("Gesten", ["👍", "👎", "👏", "🙌", "🙏", "💪", "👋", "✌️", "🤞", "👌", "🤙", "👉", "👈", "👆", "👇", "🫶"]),
        ("Herzen", ["❤️", "🧡", "💛", "💚", "💙", "💜", "🖤", "🤍", "💖", "💘", "💔", "💯", "✨", "⭐️", "🌟", "💥"]),
        ("Feiern", ["🎉", "🎊", "🎁", "🎂", "🍾", "🥂", "🎈", "🏆", "🥇", "👑", "💎", "🔥", "⚡️", "🌈", "☀️", "🌙"]),
        ("Musik", ["🎵", "🎶", "🎤", "🎧", "🎸", "🥁", "🎹", "🎷", "🎺", "🎻", "📻", "🔊", "💿", "📀", "🪩", "🕺"]),
        ("Tiere", ["🐶", "🐱", "🦊", "🐻", "🐼", "🐨", "🦁", "🐯", "🐸", "🐵", "🦄", "🐝", "🦋", "🐬", "🐙", "🦖"]),
        ("Essen", ["🍕", "🍔", "🍟", "🌮", "🍩", "🍪", "🍰", "🍦", "🍓", "🍉", "🍌", "🥑", "☕️", "🍹", "🍺", "🍿"]),
        ("Reisen", ["✈️", "🚗", "🏝️", "🏔️", "🌍", "🗺️", "📍", "🏠", "🌃", "🎡", "⛱️", "🚀", "🛸", "⏰", "📸", "🎬"]),
    ]

    static let symbols: [String] = [
        "heart.fill", "star.fill", "bolt.fill", "flame.fill", "sparkles", "crown.fill", "music.note", "music.mic",
        "hand.thumbsup.fill", "checkmark.seal.fill", "xmark.circle.fill", "exclamationmark.triangle.fill", "arrow.right", "arrow.down",
        "arrow.up.right", "arrowshape.turn.up.right.fill", "play.circle.fill", "camera.fill", "bell.fill", "gift.fill",
        "cart.fill", "location.fill", "sun.max.fill", "moon.stars.fill", "cloud.fill", "snowflake", "drop.fill", "leaf.fill",
        "pawprint.fill", "gamecontroller.fill", "trophy.fill", "bubble.left.fill", "quote.bubble.fill", "megaphone.fill",
        "circle.fill", "square.fill", "triangle.fill", "diamond.fill", "hexagon.fill", "seal.fill",
    ]
}

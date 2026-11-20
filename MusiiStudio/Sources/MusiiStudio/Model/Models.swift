import Foundation
import CoreGraphics

// MARK: - Basistypen

enum MediaKind: String, Codable {
    case video, image, audio
}

struct RGBA: Codable, Equatable, Hashable {
    var r: Double
    var g: Double
    var b: Double
    var a: Double

    init(_ r: Double, _ g: Double, _ b: Double, _ a: Double = 1) {
        self.r = r; self.g = g; self.b = b; self.a = a
    }

    static let white = RGBA(1, 1, 1)
    static let black = RGBA(0, 0, 0)
    static let clear = RGBA(0, 0, 0, 0)
    static let green = RGBA(0, 0.8, 0.1)
    static let yellow = RGBA(1, 0.86, 0.1)

    var cgColor: CGColor { CGColor(srgbRed: r, green: g, blue: b, alpha: a) }

    var hex: String {
        String(format: "#%02X%02X%02X", Int(r * 255), Int(g * 255), Int(b * 255))
    }
}

/// Zeitraster: alle Zeitpunkte werden auf 1/600 Sekunde gerundet (teilbar durch 24/25/30/50/60 fps).
enum TimeGrid {
    static let scale: Int64 = 600
    static func ticks(_ s: Double) -> Int64 { Int64((s * Double(scale)).rounded()) }
    static func seconds(_ t: Int64) -> Double { Double(t) / Double(scale) }
    static func snap(_ s: Double) -> Double { seconds(ticks(s)) }
}

struct MediaItem: Codable, Identifiable, Equatable {
    var id: UUID = UUID()
    var name: String
    var path: String
    var kind: MediaKind
    var duration: Double
    var width: Double
    var height: Double
    var hasAudio: Bool
    var hasVideo: Bool
    /// CGImagePropertyOrientation-Rohwert (1 = normal)
    var orientation: UInt32 = 1
    var frameRate: Double = 30
    var generated: Bool = false

    var url: URL { URL(fileURLWithPath: path) }
    var exists: Bool { FileManager.default.fileExists(atPath: path) }
    var isVisual: Bool { kind == .video || kind == .image }
}

// MARK: - Transformation & Keyframes

struct Transform2D: Codable, Equatable {
    /// Mittelpunkt in normierten Canvas-Koordinaten (0...1, y von oben)
    var x: Double = 0.5
    var y: Double = 0.5
    var scale: Double = 1
    /// Grad, im Uhrzeigersinn
    var rotation: Double = 0
    var opacity: Double = 1

    static func lerp(_ a: Transform2D, _ b: Transform2D, _ t: Double) -> Transform2D {
        Transform2D(x: a.x + (b.x - a.x) * t,
                    y: a.y + (b.y - a.y) * t,
                    scale: a.scale + (b.scale - a.scale) * t,
                    rotation: a.rotation + (b.rotation - a.rotation) * t,
                    opacity: a.opacity + (b.opacity - a.opacity) * t)
    }
}

struct Keyframe: Codable, Equatable, Identifiable {
    var id: UUID = UUID()
    /// Zeit relativ zum Clip-Anfang (Timeline-Sekunden)
    var time: Double
    var transform: Transform2D
}

enum KeyframeMath {
    static func transform(base: Transform2D, keyframes: [Keyframe], at local: Double) -> Transform2D {
        guard !keyframes.isEmpty else { return base }
        let k = keyframes.sorted { $0.time < $1.time }
        if local <= k[0].time { return k[0].transform }
        if local >= k[k.count - 1].time { return k[k.count - 1].transform }
        for i in 0..<(k.count - 1) where local >= k[i].time && local <= k[i + 1].time {
            let span = max(0.0001, k[i + 1].time - k[i].time)
            var t = (local - k[i].time) / span
            t = t * t * (3 - 2 * t) // weiche Kurve
            return Transform2D.lerp(k[i].transform, k[i + 1].transform, t)
        }
        return base
    }
}

// MARK: - Animationen

enum AnimKind: String, Codable, CaseIterable, Identifiable {
    case none, fade, zoomIn, zoomOut, slideLeft, slideRight, slideUp, slideDown, spin, pop, blur, typewriter, drop, swing

    var id: String { rawValue }
    var title: String {
        switch self {
        case .none: return "Keine"
        case .fade: return "Einblenden"
        case .zoomIn: return "Zoom rein"
        case .zoomOut: return "Zoom raus"
        case .slideLeft: return "Von rechts"
        case .slideRight: return "Von links"
        case .slideUp: return "Von unten"
        case .slideDown: return "Von oben"
        case .spin: return "Drehen"
        case .pop: return "Pop"
        case .blur: return "Unschärfe"
        case .typewriter: return "Schreibmaschine"
        case .drop: return "Fallen"
        case .swing: return "Schwingen"
        }
    }
}

enum LoopAnim: String, Codable, CaseIterable, Identifiable {
    case none, kenBurns, pulse, shake, swing, float, flicker, rotate, heartbeat

    var id: String { rawValue }
    var title: String {
        switch self {
        case .none: return "Keine"
        case .kenBurns: return "Ken Burns"
        case .pulse: return "Pulsieren"
        case .shake: return "Wackeln"
        case .swing: return "Pendeln"
        case .float: return "Schweben"
        case .flicker: return "Flackern"
        case .rotate: return "Rotieren"
        case .heartbeat: return "Herzschlag"
        }
    }
}

struct AnimSetting: Codable, Equatable {
    var kind: AnimKind = .none
    var duration: Double = 0.5
}

// MARK: - Bildbearbeitung

struct FilterSetting: Codable, Equatable {
    var preset: String = "none"
    var intensity: Double = 1
}

struct Adjustments: Codable, Equatable {
    // Alle Werte im Bereich -100...100 (0 = neutral)
    var brightness: Double = 0
    var contrast: Double = 0
    var saturation: Double = 0
    var exposure: Double = 0
    var temperature: Double = 0
    var tint: Double = 0
    var highlights: Double = 0
    var shadows: Double = 0
    var vibrance: Double = 0
    var hue: Double = 0
    var sharpen: Double = 0
    var vignette: Double = 0
    var grain: Double = 0
    var fade: Double = 0

    var isIdentity: Bool { self == Adjustments() }
}

struct EffectSetting: Codable, Equatable, Identifiable {
    var id: UUID = UUID()
    var kind: EffectKind
    var intensity: Double = 0.5
}

enum FitMode: String, Codable, CaseIterable {
    case fit, fill
}

struct CropRect: Codable, Equatable {
    // normiert, y von oben
    var x: Double = 0
    var y: Double = 0
    var w: Double = 1
    var h: Double = 1
    var isFull: Bool { x <= 0.0001 && y <= 0.0001 && w >= 0.9999 && h >= 0.9999 }
}

enum MaskKind: String, Codable, CaseIterable, Identifiable {
    case none, circle, rectangle, linear, mirror, heart
    var id: String { rawValue }
    var title: String {
        switch self {
        case .none: return "Keine"
        case .circle: return "Kreis"
        case .rectangle: return "Rechteck"
        case .linear: return "Linear"
        case .mirror: return "Spiegel"
        case .heart: return "Herz"
        }
    }
    var symbol: String {
        switch self {
        case .none: return "nosign"
        case .circle: return "circle"
        case .rectangle: return "rectangle"
        case .linear: return "square.bottomhalf.filled"
        case .mirror: return "rectangle.split.1x2"
        case .heart: return "heart"
        }
    }
}

struct MaskSetting: Codable, Equatable {
    var kind: MaskKind = .none
    var x: Double = 0.5
    var y: Double = 0.5
    var size: Double = 0.5
    var aspect: Double = 1
    var rotation: Double = 0
    var feather: Double = 0.05
    var invert: Bool = false
}

struct ChromaKey: Codable, Equatable {
    var enabled: Bool = false
    var color: RGBA = .green
    var tolerance: Double = 0.4
    var softness: Double = 0.1
}

enum BlendMode: String, Codable, CaseIterable, Identifiable {
    case normal, multiply, screen, overlay, darken, lighten, add, difference, softLight, hardLight, colorBurn, colorDodge
    var id: String { rawValue }
    var title: String {
        switch self {
        case .normal: return "Normal"
        case .multiply: return "Multiplizieren"
        case .screen: return "Negativ multiplizieren"
        case .overlay: return "Überlagern"
        case .darken: return "Abdunkeln"
        case .lighten: return "Aufhellen"
        case .add: return "Addieren"
        case .difference: return "Differenz"
        case .softLight: return "Weiches Licht"
        case .hardLight: return "Hartes Licht"
        case .colorBurn: return "Farbig nachbelichten"
        case .colorDodge: return "Farbig abwedeln"
        }
    }
    var ciFilter: String {
        switch self {
        case .normal: return "CISourceOverCompositing"
        case .multiply: return "CIMultiplyBlendMode"
        case .screen: return "CIScreenBlendMode"
        case .overlay: return "CIOverlayBlendMode"
        case .darken: return "CIDarkenBlendMode"
        case .lighten: return "CILightenBlendMode"
        case .add: return "CIAdditionCompositing"
        case .difference: return "CIDifferenceBlendMode"
        case .softLight: return "CISoftLightBlendMode"
        case .hardLight: return "CIHardLightBlendMode"
        case .colorBurn: return "CIColorBurnBlendMode"
        case .colorDodge: return "CIColorDodgeBlendMode"
        }
    }
}

struct TransitionSetting: Codable, Equatable {
    var kind: TransitionKind
    var duration: Double = 0.6
}

// MARK: - Clips

struct Clip: Codable, Identifiable, Equatable {
    var id: UUID = UUID()
    var mediaID: UUID
    var sourceStart: Double = 0
    var sourceDuration: Double
    var speed: Double = 1
    /// Startzeit auf der Timeline (für Spuren außerhalb der Hauptspur)
    var start: Double = 0
    var lane: Int = 0
    var volume: Double = 1
    var muted: Bool = false
    var fadeIn: Double = 0
    var fadeOut: Double = 0
    var fitMode: FitMode = .fit
    var transform: Transform2D = Transform2D()
    var keyframes: [Keyframe] = []
    var crop: CropRect = CropRect()
    var flipH: Bool = false
    var flipV: Bool = false
    var filter: FilterSetting = FilterSetting()
    var adjust: Adjustments = Adjustments()
    var effects: [EffectSetting] = []
    /// Übergang zum nächsten Clip (nur Hauptspur)
    var transition: TransitionSetting? = nil
    var animIn: AnimSetting = AnimSetting()
    var animOut: AnimSetting = AnimSetting()
    var loop: LoopAnim = .none
    var mask: MaskSetting = MaskSetting()
    var chroma: ChromaKey = ChromaKey()
    var removeBackground: Bool = false
    var blend: BlendMode = .normal
    var reversed: Bool = false
    var originalMediaID: UUID? = nil
    var name: String? = nil

    var duration: Double { sourceDuration / max(0.01, speed) }
    var end: Double { start + duration }
}

enum TextKind: String, Codable {
    case text, emoji, symbol
}

struct TextStyle: Codable, Equatable {
    var fontFamily: String = "Helvetica Neue"
    var fontSize: Double = 72
    var bold: Bool = true
    var italic: Bool = false
    var color: RGBA = .white
    var strokeColor: RGBA = .black
    var strokeWidth: Double = 0
    var shadow: Bool = false
    var shadowColor: RGBA = RGBA(0, 0, 0, 0.8)
    var shadowBlur: Double = 8
    var shadowOffset: Double = 4
    var background: Bool = false
    var backgroundColor: RGBA = RGBA(0, 0, 0, 0.6)
    var backgroundPadding: Double = 18
    var backgroundCorner: Double = 14
    /// 0 links, 1 zentriert, 2 rechts
    var alignment: Int = 1
    var letterSpacing: Double = 0
    var lineSpacing: Double = 0
    var uppercase: Bool = false
}

struct TextClip: Codable, Identifiable, Equatable {
    var id: UUID = UUID()
    var kind: TextKind = .text
    var text: String
    var style: TextStyle = TextStyle()
    var start: Double
    var duration: Double = 3
    var lane: Int = 0
    var transform: Transform2D = Transform2D()
    var keyframes: [Keyframe] = []
    var animIn: AnimSetting = AnimSetting()
    var animOut: AnimSetting = AnimSetting()
    var loop: LoopAnim = .none
    var isCaption: Bool = false

    var end: Double { start + duration }
}

struct EffectClip: Codable, Identifiable, Equatable {
    var id: UUID = UUID()
    var kind: EffectKind
    var intensity: Double = 0.6
    var start: Double
    var duration: Double = 3
    var lane: Int = 0
    var end: Double { start + duration }
}

// MARK: - Projekt

enum AspectPreset: String, Codable, CaseIterable, Identifiable {
    case r16x9, r9x16, r1x1, r4x5, r4x3, r3x4, r21x9, r2x1

    var id: String { rawValue }
    var title: String {
        switch self {
        case .r16x9: return "16:9"
        case .r9x16: return "9:16"
        case .r1x1: return "1:1"
        case .r4x5: return "4:5"
        case .r4x3: return "4:3"
        case .r3x4: return "3:4"
        case .r21x9: return "21:9"
        case .r2x1: return "2:1"
        }
    }
    var subtitle: String {
        switch self {
        case .r16x9: return "YouTube"
        case .r9x16: return "TikTok, Reels, Shorts"
        case .r1x1: return "Instagram"
        case .r4x5: return "Instagram Post"
        case .r4x3: return "Klassisch"
        case .r3x4: return "Hochformat"
        case .r21x9: return "Kino"
        case .r2x1: return "Breitbild"
        }
    }
    /// Referenz-Canvas (kurze Seite 1080)
    var canvas: CGSize {
        switch self {
        case .r16x9: return CGSize(width: 1920, height: 1080)
        case .r9x16: return CGSize(width: 1080, height: 1920)
        case .r1x1: return CGSize(width: 1080, height: 1080)
        case .r4x5: return CGSize(width: 1080, height: 1350)
        case .r4x3: return CGSize(width: 1440, height: 1080)
        case .r3x4: return CGSize(width: 1080, height: 1440)
        case .r21x9: return CGSize(width: 2520, height: 1080)
        case .r2x1: return CGSize(width: 2160, height: 1080)
        }
    }
}

enum BackgroundMode: String, Codable, CaseIterable {
    case color, blur
}

struct CanvasBackground: Codable, Equatable {
    var mode: BackgroundMode = .color
    var color: RGBA = .black
    var blur: Double = 0.5
}

struct Project: Codable, Identifiable, Equatable {
    var id: UUID = UUID()
    var name: String
    var created: Date = Date()
    var modified: Date = Date()
    var aspect: AspectPreset = .r16x9
    var fps: Int = 30
    var background: CanvasBackground = CanvasBackground()
    var media: [MediaItem] = []
    var main: [Clip] = []
    var overlays: [Clip] = []
    var audio: [Clip] = []
    var texts: [TextClip] = []
    var effects: [EffectClip] = []

    func mediaItem(_ id: UUID) -> MediaItem? { media.first { $0.id == id } }
}

// MARK: - Zeitberechnungen

struct MainSlot {
    let start: Double
    let end: Double
    /// effektive Übergangsdauer zum nächsten Clip
    let transitionOut: Double
    let transitionIn: Double
}

extension Project {
    /// Effektive Übergangsdauer zwischen Clip i und i+1 in Ticks
    func transitionTicks(after i: Int) -> Int64 {
        guard i >= 0, i + 1 < main.count, let t = main[i].transition, t.kind != .none else { return 0 }
        let a = TimeGrid.ticks(main[i].duration)
        let b = TimeGrid.ticks(main[i + 1].duration)
        let d = TimeGrid.ticks(t.duration)
        return max(0, min(d, a / 2, b / 2))
    }

    /// Positionen der Hauptspur (magnetisch, mit Überlappung bei Übergängen)
    var mainSlots: [MainSlot] {
        var result: [MainSlot] = []
        var cursor: Int64 = 0
        var prevTrans: Int64 = 0
        for i in 0..<main.count {
            let dur = TimeGrid.ticks(main[i].duration)
            let tOut = transitionTicks(after: i)
            result.append(MainSlot(start: TimeGrid.seconds(cursor),
                                   end: TimeGrid.seconds(cursor + dur),
                                   transitionOut: TimeGrid.seconds(tOut),
                                   transitionIn: TimeGrid.seconds(prevTrans)))
            cursor = cursor + dur - tOut
            prevTrans = tOut
        }
        return result
    }

    var mainDuration: Double { mainSlots.last?.end ?? 0 }

    var duration: Double {
        var d = mainDuration
        for c in overlays { d = max(d, TimeGrid.snap(c.start) + TimeGrid.snap(c.duration)) }
        for c in audio { d = max(d, TimeGrid.snap(c.start) + TimeGrid.snap(c.duration)) }
        for t in texts { d = max(d, TimeGrid.snap(t.start) + TimeGrid.snap(t.duration)) }
        for e in effects { d = max(d, TimeGrid.snap(e.start) + TimeGrid.snap(e.duration)) }
        return d
    }

    var canvasSize: CGSize { aspect.canvas }

    func mainIndex(of id: UUID) -> Int? { main.firstIndex { $0.id == id } }
}

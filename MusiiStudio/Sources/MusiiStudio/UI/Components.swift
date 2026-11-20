import SwiftUI
import AppKit
import CoreImage

enum Theme {
    static let bg = Color(red: 0.075, green: 0.075, blue: 0.085)
    static let panel = Color(red: 0.11, green: 0.11, blue: 0.125)
    static let panel2 = Color(red: 0.15, green: 0.15, blue: 0.17)
    static let panel3 = Color(red: 0.20, green: 0.20, blue: 0.225)
    static let border = Color.white.opacity(0.08)
    static let accent = Color(red: 0.13, green: 0.82, blue: 0.78)
    static let accent2 = Color(red: 0.98, green: 0.32, blue: 0.55)
    static let secondaryText = Color.white.opacity(0.6)

    static let videoClip = Color(red: 0.16, green: 0.42, blue: 0.62)
    static let imageClip = Color(red: 0.22, green: 0.48, blue: 0.40)
    static let overlayClip = Color(red: 0.45, green: 0.30, blue: 0.65)
    static let audioClip = Color(red: 0.18, green: 0.50, blue: 0.30)
    static let textClip = Color(red: 0.75, green: 0.48, blue: 0.12)
    static let stickerClip = Color(red: 0.78, green: 0.30, blue: 0.45)
    static let effectClip = Color(red: 0.55, green: 0.25, blue: 0.75)
    static let captionClip = Color(red: 0.60, green: 0.55, blue: 0.15)
}

func formatTime(_ t: Double, fps: Int = 30) -> String {
    let total = max(0, t)
    let m = Int(total) / 60
    let s = Int(total) % 60
    let cs = Int((total - floor(total)) * 100)
    return String(format: "%02d:%02d.%02d", m, s, cs)
}

func colorBinding(_ b: Binding<RGBA>) -> Binding<Color> {
    Binding(get: {
        Color(.sRGB, red: b.wrappedValue.r, green: b.wrappedValue.g, blue: b.wrappedValue.b, opacity: b.wrappedValue.a)
    }, set: { c in
        let ns = NSColor(c).usingColorSpace(.sRGB) ?? NSColor.white
        b.wrappedValue = RGBA(Double(ns.redComponent), Double(ns.greenComponent), Double(ns.blueComponent), Double(ns.alphaComponent))
    })
}

extension RGBA {
    var swiftUI: Color { Color(.sRGB, red: r, green: g, blue: b, opacity: a) }
}

struct SliderRow: View {
    let title: String
    @Binding var value: Double
    var range: ClosedRange<Double>
    var defaultValue: Double? = nil
    var display: (Double) -> String = { String(format: "%.0f", $0) }

    var body: some View {
        VStack(alignment: .leading, spacing: 2) {
            HStack {
                Text(title).font(.system(size: 11)).foregroundColor(Theme.secondaryText)
                Spacer()
                Text(display(value)).font(.system(size: 11, design: .monospaced)).foregroundColor(.white.opacity(0.85))
                if let d = defaultValue, abs(value - d) > 0.0001 {
                    Button {
                        value = d
                    } label: {
                        Image(systemName: "arrow.counterclockwise").font(.system(size: 9))
                    }
                    .buttonStyle(.borderless)
                    .help("Zurücksetzen")
                }
            }
            Slider(value: $value, in: range)
                .controlSize(.small)
        }
    }
}

struct SectionBox<Content: View>: View {
    let title: String
    var trailing: AnyView? = nil
    @ViewBuilder var content: Content

    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            HStack {
                Text(title.uppercased())
                    .font(.system(size: 10, weight: .semibold))
                    .foregroundColor(Theme.secondaryText)
                Spacer()
                if let t = trailing { t }
            }
            content
        }
        .padding(10)
        .background(RoundedRectangle(cornerRadius: 8).fill(Theme.panel2))
    }
}

struct TileButton: View {
    let symbol: String
    let title: String
    var selected: Bool = false
    var tint: Color = Theme.accent
    let action: () -> Void

    var body: some View {
        Button(action: action) {
            VStack(spacing: 5) {
                Image(systemName: symbol)
                    .font(.system(size: 18))
                    .frame(height: 22)
                    .foregroundColor(selected ? tint : .white.opacity(0.9))
                Text(title)
                    .font(.system(size: 10))
                    .lineLimit(1)
                    .minimumScaleFactor(0.7)
                    .foregroundColor(.white.opacity(0.85))
            }
            .frame(maxWidth: .infinity)
            .frame(height: 58)
            .background(RoundedRectangle(cornerRadius: 8).fill(selected ? tint.opacity(0.18) : Theme.panel2))
            .overlay(RoundedRectangle(cornerRadius: 8).stroke(selected ? tint : Color.clear, lineWidth: 1.5))
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
    }
}

struct PillButton: View {
    let title: String
    var symbol: String? = nil
    var prominent: Bool = false
    let action: () -> Void

    var body: some View {
        Button(action: action) {
            HStack(spacing: 6) {
                if let s = symbol { Image(systemName: s) }
                Text(title)
            }
            .font(.system(size: 12, weight: .medium))
            .padding(.horizontal, 12)
            .padding(.vertical, 6)
            .frame(maxWidth: .infinity)
            .background(RoundedRectangle(cornerRadius: 7).fill(prominent ? Theme.accent : Theme.panel3))
            .foregroundColor(prominent ? .black : .white)
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
    }
}

struct IconButton: View {
    let symbol: String
    let help: String
    var enabled: Bool = true
    var active: Bool = false
    let action: () -> Void

    var body: some View {
        Button(action: action) {
            Image(systemName: symbol)
                .font(.system(size: 13))
                .frame(width: 28, height: 26)
                .foregroundColor(active ? Theme.accent : (enabled ? .white.opacity(0.9) : .white.opacity(0.3)))
                .background(RoundedRectangle(cornerRadius: 6).fill(active ? Theme.accent.opacity(0.15) : Color.clear))
                .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .disabled(!enabled)
        .help(help)
    }
}

struct ColorRow: View {
    let title: String
    @Binding var color: RGBA

    var body: some View {
        HStack {
            Text(title).font(.system(size: 11)).foregroundColor(Theme.secondaryText)
            Spacer()
            ColorPicker("", selection: colorBinding($color), supportsOpacity: true)
                .labelsHidden()
                .frame(width: 44)
        }
    }
}

struct ToggleRow: View {
    let title: String
    @Binding var isOn: Bool
    var body: some View {
        Toggle(isOn: $isOn) {
            Text(title).font(.system(size: 11)).foregroundColor(.white.opacity(0.85))
        }
        .toggleStyle(.switch)
        .controlSize(.small)
    }
}

/// Rendert eine Text-Vorlage mit dem echten Text-Renderer als Vorschaubild
enum PreviewImages {
    private static var cache: [String: NSImage] = [:]

    static func textPreview(_ style: TextStyle, text: String = "Abc") -> NSImage? {
        let key = style.hashKey + text
        if let c = cache[key] { return c }
        var s = style
        s.fontSize = 64
        guard let ci = TextRenderer.shared.image(text: text, style: s, scale: 0.5),
              let cg = StudioCompositor.ciContext.createCGImage(ci, from: ci.extent) else { return nil }
        let img = NSImage(cgImage: cg, size: NSSize(width: cg.width, height: cg.height))
        cache[key] = img
        return img
    }

    static func filterPreview(_ preset: String, base: NSImage?) -> NSImage? {
        let key = "f|\(preset)|\(base.map { ObjectIdentifier($0).hashValue } ?? 0)"
        if let c = cache[key] { return c }
        var ci: CIImage
        if let b = base, let tiff = b.tiffRepresentation, let img = CIImage(data: tiff) {
            ci = img
        } else {
            ci = CIFilter(name: "CILinearGradient", parameters: [
                "inputPoint0": CIVector(x: 0, y: 0), "inputPoint1": CIVector(x: 120, y: 80),
                "inputColor0": CIColor(red: 0.95, green: 0.55, blue: 0.25), "inputColor1": CIColor(red: 0.2, green: 0.45, blue: 0.85),
            ])?.outputImage?.cropped(to: CGRect(x: 0, y: 0, width: 120, height: 80)) ?? CIImage.empty()
        }
        let maxSide = max(ci.extent.width, ci.extent.height)
        if maxSide > 160 {
            let f = 160 / maxSide
            ci = ci.transformed(by: CGAffineTransform(scaleX: f, y: f)).movedToOrigin()
        }
        let out = ColorFX.applyPreset(preset, intensity: 1, to: ci)
        guard let cg = StudioCompositor.ciContext.createCGImage(out, from: ci.extent) else { return nil }
        let img = NSImage(cgImage: cg, size: NSSize(width: cg.width, height: cg.height))
        if cache.count > 400 { cache.removeAll() }
        cache[key] = img
        return img
    }
}

struct EmptyHint: View {
    let symbol: String
    let text: String
    var body: some View {
        VStack(spacing: 8) {
            Image(systemName: symbol).font(.system(size: 28)).foregroundColor(Theme.secondaryText)
            Text(text).font(.system(size: 12)).foregroundColor(Theme.secondaryText).multilineTextAlignment(.center)
        }
        .frame(maxWidth: .infinity)
        .padding(20)
    }
}

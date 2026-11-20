import Foundation
import CoreText
import CoreGraphics
import CoreImage
import AppKit

/// Rendert Texte, Emojis und Symbole als Bilder (thread-sicher, mit Cache).
final class TextRenderer {
    static let shared = TextRenderer()

    private let cache = NSCache<NSString, CIImage>()
    private let lock = NSLock()

    init() { cache.countLimit = 300 }

    func font(_ style: TextStyle, size: CGFloat) -> CTFont {
        var traits: CTFontSymbolicTraits = []
        if style.bold { traits.insert(.traitBold) }
        if style.italic { traits.insert(.traitItalic) }
        let desc = CTFontDescriptorCreateWithAttributes([
            kCTFontFamilyNameAttribute: style.fontFamily,
        ] as CFDictionary)
        var font = CTFontCreateWithFontDescriptor(desc, size, nil)
        let family = CTFontCopyFamilyName(font) as String
        if family.lowercased() != style.fontFamily.lowercased() {
            font = CTFontCreateWithName("Helvetica Neue" as CFString, size, nil)
        }
        if !traits.isEmpty, let f = CTFontCreateCopyWithSymbolicTraits(font, size, nil, traits, traits) {
            font = f
        } else if style.bold, let f = CTFontCreateCopyWithSymbolicTraits(font, size, nil, .traitBold, .traitBold) {
            font = f
        }
        return font
    }

    private func attributed(_ string: String, style: TextStyle, scale: CGFloat) -> NSAttributedString {
        let size = CGFloat(style.fontSize) * scale
        let f = font(style, size: size)
        var align: CTTextAlignment = style.alignment == 0 ? .left : (style.alignment == 2 ? .right : .center)
        var spacing = CGFloat(style.lineSpacing) * scale
        let para: CTParagraphStyle = withUnsafePointer(to: &align) { ap in
            withUnsafePointer(to: &spacing) { sp in
                var settings = [
                    CTParagraphStyleSetting(spec: .alignment, valueSize: MemoryLayout<CTTextAlignment>.size, value: ap),
                    CTParagraphStyleSetting(spec: .lineSpacingAdjustment, valueSize: MemoryLayout<CGFloat>.size, value: sp),
                ]
                return CTParagraphStyleCreate(&settings, settings.count)
            }
        }
        var attrs: [NSAttributedString.Key: Any] = [
            NSAttributedString.Key(kCTFontAttributeName as String): f,
            NSAttributedString.Key(kCTForegroundColorAttributeName as String): style.color.cgColor,
            NSAttributedString.Key(kCTParagraphStyleAttributeName as String): para,
            NSAttributedString.Key(kCTKernAttributeName as String): CGFloat(style.letterSpacing) * scale,
        ]
        if style.strokeWidth > 0 {
            attrs[NSAttributedString.Key(kCTStrokeColorAttributeName as String)] = style.strokeColor.cgColor
        }
        return NSAttributedString(string: style.uppercase ? string.uppercased() : string, attributes: attrs)
    }

    private func drawText(_ string: String, style: TextStyle, scale: CGFloat, strokeOnly: Bool, in ctx: CGContext, rect: CGRect) {
        let size = CGFloat(style.fontSize) * scale
        let attr = NSMutableAttributedString(attributedString: attributed(string, style: style, scale: scale))
        let full = NSRange(location: 0, length: attr.length)
        if strokeOnly {
            // Prozentwert relativ zur Schriftgröße; positiv = nur Kontur
            let pct = CGFloat(style.strokeWidth) * scale / size * 100 * 2
            attr.addAttribute(NSAttributedString.Key(kCTStrokeWidthAttributeName as String), value: pct, range: full)
            attr.addAttribute(NSAttributedString.Key(kCTForegroundColorAttributeName as String), value: style.strokeColor.cgColor, range: full)
        }
        let framesetter = CTFramesetterCreateWithAttributedString(attr)
        let path = CGPath(rect: rect, transform: nil)
        let frame = CTFramesetterCreateFrame(framesetter, CFRange(location: 0, length: 0), path, nil)
        CTFrameDraw(frame, ctx)
    }

    /// Größe des Textblocks in Pixeln (ohne Rand)
    func measure(_ string: String, style: TextStyle, scale: CGFloat) -> CGSize {
        let attr = attributed(string.isEmpty ? " " : string, style: style, scale: scale)
        let fs = CTFramesetterCreateWithAttributedString(attr)
        let s = CTFramesetterSuggestFrameSizeWithConstraints(fs, CFRange(location: 0, length: 0), nil, CGSize(width: 20000, height: 20000), nil)
        return CGSize(width: ceil(s.width) + 2, height: ceil(s.height) + 2)
    }

    /// Text als CIImage, Ursprung in der Bildmitte zentriert ist NICHT gesetzt (Ursprung 0,0)
    func image(text: String, style: TextStyle, scale: CGFloat) -> CIImage? {
        let key = "\(text.hashValue)|\(text.count)|\(style.hashKey)|\(Int(scale * 100))" as NSString
        lock.lock()
        if let c = cache.object(forKey: key) { lock.unlock(); return c }
        lock.unlock()
        guard let img = renderText(text, style: style, scale: scale) else { return nil }
        lock.lock(); cache.setObject(img, forKey: key); lock.unlock()
        return img
    }

    private func renderText(_ text: String, style: TextStyle, scale: CGFloat) -> CIImage? {
        let content = text.isEmpty ? " " : text
        let textSize = measure(content, style: style, scale: scale)
        let stroke = style.strokeWidth > 0 ? CGFloat(style.strokeWidth) * scale : 0
        let pad = style.background ? CGFloat(style.backgroundPadding) * scale : 0
        let shadowR = style.shadow ? (CGFloat(style.shadowBlur) + CGFloat(abs(style.shadowOffset))) * scale * 2 : 0
        let margin = ceil(stroke + pad + shadowR + 4)
        let w = Int(textSize.width + margin * 2)
        let h = Int(textSize.height + margin * 2)
        guard w > 0, h > 0, w < 16000, h < 16000 else { return nil }
        let cs = CGColorSpace(name: CGColorSpace.sRGB) ?? CGColorSpaceCreateDeviceRGB()
        guard let ctx = CGContext(data: nil, width: w, height: h, bitsPerComponent: 8, bytesPerRow: 0, space: cs,
                                  bitmapInfo: CGImageAlphaInfo.premultipliedLast.rawValue) else { return nil }
        ctx.setShouldAntialias(true)
        ctx.setAllowsFontSmoothing(true)
        let textRect = CGRect(x: margin, y: margin, width: textSize.width, height: textSize.height)
        if style.background {
            let bg = textRect.insetBy(dx: -pad, dy: -pad * 0.6)
            let r = CGFloat(style.backgroundCorner) * scale
            ctx.addPath(CGPath(roundedRect: bg, cornerWidth: min(r, bg.height / 2), cornerHeight: min(r, bg.height / 2), transform: nil))
            ctx.setFillColor(style.backgroundColor.cgColor)
            ctx.fillPath()
        }
        if style.shadow {
            ctx.setShadow(offset: CGSize(width: CGFloat(style.shadowOffset) * scale, height: -CGFloat(style.shadowOffset) * scale),
                          blur: CGFloat(style.shadowBlur) * scale, color: style.shadowColor.cgColor)
        }
        if stroke > 0 {
            ctx.setLineJoin(.round)
            drawText(content, style: style, scale: scale, strokeOnly: true, in: ctx, rect: textRect)
            ctx.setShadow(offset: .zero, blur: 0, color: nil)
        }
        drawText(content, style: style, scale: scale, strokeOnly: false, in: ctx, rect: textRect)
        guard let cg = ctx.makeImage() else { return nil }
        return CIImage(cgImage: cg)
    }

    // MARK: Symbole

    private let symbolLock = NSLock()
    private var symbolCache: [String: CIImage] = [:]

    func symbolImage(name: String, color: RGBA, pixelSize: CGFloat) -> CIImage? {
        let px = max(16, min(2048, Int(pixelSize / 32) * 32 + 32))
        let key = "\(name)|\(color.hex)|\(color.a)|\(px)"
        symbolLock.lock(); defer { symbolLock.unlock() }
        if let c = symbolCache[key] { return c }
        guard let base = NSImage(systemSymbolName: name, accessibilityDescription: nil) else { return nil }
        let config = NSImage.SymbolConfiguration(pointSize: CGFloat(px) * 0.8, weight: .regular)
        let sym = base.withSymbolConfiguration(config) ?? base
        var rect = CGRect(x: 0, y: 0, width: px, height: px)
        guard let cgMask = sym.cgImage(forProposedRect: &rect, context: nil, hints: nil) else { return nil }
        let w = cgMask.width, h = cgMask.height
        let cs = CGColorSpace(name: CGColorSpace.sRGB) ?? CGColorSpaceCreateDeviceRGB()
        guard let ctx = CGContext(data: nil, width: w, height: h, bitsPerComponent: 8, bytesPerRow: 0, space: cs,
                                  bitmapInfo: CGImageAlphaInfo.premultipliedLast.rawValue) else { return nil }
        let r = CGRect(x: 0, y: 0, width: w, height: h)
        ctx.clip(to: r, mask: cgMask)
        ctx.setFillColor(color.cgColor)
        ctx.fill(r)
        guard let out = ctx.makeImage() else { return nil }
        let img = CIImage(cgImage: out)
        if symbolCache.count > 200 { symbolCache.removeAll() }
        symbolCache[key] = img
        return img
    }
}

extension TextStyle {
    var hashKey: String {
        "\(fontFamily)|\(fontSize)|\(bold)|\(italic)|\(color.hex)\(color.a)|\(strokeColor.hex)\(strokeColor.a)|\(strokeWidth)|\(shadow)|\(shadowColor.hex)\(shadowColor.a)|\(shadowBlur)|\(shadowOffset)|\(background)|\(backgroundColor.hex)\(backgroundColor.a)|\(backgroundPadding)|\(backgroundCorner)|\(alignment)|\(letterSpacing)|\(lineSpacing)|\(uppercase)"
    }
}

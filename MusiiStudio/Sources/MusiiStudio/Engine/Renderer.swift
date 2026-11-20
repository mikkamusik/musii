import Foundation
import AVFoundation
import CoreImage
import Vision
import ImageIO
import Metal

// MARK: - Render-Plan (unveränderlicher Schnappschuss eines Projekts)

struct PlanClip {
    let clip: Clip
    let media: MediaItem
    let start: Double
    let end: Double
    let trackID: CMPersistentTrackID?
    let transitionOut: TransitionKind
}

final class RenderPlan {
    let canvas: CGSize
    let background: CanvasBackground
    let main: [PlanClip]
    let overlays: [PlanClip]
    let texts: [TextClip]
    let effects: [EffectClip]
    let duration: Double

    init(canvas: CGSize, background: CanvasBackground, main: [PlanClip], overlays: [PlanClip], texts: [TextClip], effects: [EffectClip], duration: Double) {
        self.canvas = canvas
        self.background = background
        self.main = main
        self.overlays = overlays
        self.texts = texts
        self.effects = effects
        self.duration = duration
    }
}

// MARK: - Animationen

struct AnimState {
    var dx: Double = 0
    var dy: Double = 0
    var scale: Double = 1
    var rotation: Double = 0
    var opacity: Double = 1
    var blur: Double = 0
    var reveal: Double = 1
}

enum Animator {
    static func bounceOut(_ x: Double) -> Double {
        let n1 = 7.5625, d1 = 2.75
        var t = x
        if t < 1 / d1 { return n1 * t * t }
        if t < 2 / d1 { t -= 1.5 / d1; return n1 * t * t + 0.75 }
        if t < 2.5 / d1 { t -= 2.25 / d1; return n1 * t * t + 0.9375 }
        t -= 2.625 / d1
        return n1 * t * t + 0.984375
    }

    private static func applyPhase(_ kind: AnimKind, p: Double, entering: Bool, into s: inout AnimState) {
        let q = 1 - FXMath.smooth(p) // 1 = ganz "weg", 0 = Ruheposition
        let dir: Double = entering ? 1 : -1
        switch kind {
        case .none: break
        case .fade: s.opacity *= 1 - q
        case .zoomIn:
            s.scale *= entering ? 1 - 0.6 * q : 1 + 0.6 * q
            s.opacity *= 1 - q
        case .zoomOut:
            s.scale *= entering ? 1 + 0.6 * q : 1 - 0.6 * q
            s.opacity *= 1 - q
        case .slideLeft: s.dx += 0.6 * q * dir
        case .slideRight: s.dx -= 0.6 * q * dir
        case .slideUp: s.dy += 0.5 * q * dir
        case .slideDown: s.dy -= 0.5 * q * dir
        case .spin:
            s.rotation += 360 * q * dir
            s.scale *= 1 - 0.6 * q
            s.opacity *= 1 - q
        case .pop:
            let x = FXMath.clamp(p, 0, 1)
            let sc = x < 0.6 ? 1.15 * (x / 0.6) : 1.15 - 0.15 * ((x - 0.6) / 0.4)
            s.scale *= max(0.001, sc)
        case .blur:
            s.blur += 30 * q
            s.opacity *= 1 - 0.6 * q
        case .typewriter:
            if entering { s.reveal = min(s.reveal, FXMath.clamp(p, 0, 1)) } else { s.opacity *= 1 - q }
        case .drop:
            let b = entering ? bounceOut(FXMath.clamp(p, 0, 1)) : FXMath.smooth(p)
            s.dy -= (1 - b) * 0.45
            if !entering { s.opacity *= 1 - q }
        case .swing:
            s.rotation += -30 * q * cos(q * 6)
            s.opacity *= 1 - q
        }
    }

    static func state(animIn: AnimSetting, animOut: AnimSetting, loop: LoopAnim, local: Double, duration: Double) -> AnimState {
        var s = AnimState()
        let dIn = min(animIn.duration, duration)
        let dOut = min(animOut.duration, duration)
        if animIn.kind != .none, dIn > 0.01, local < dIn {
            applyPhase(animIn.kind, p: local / dIn, entering: true, into: &s)
        }
        if animOut.kind != .none, dOut > 0.01, local > duration - dOut {
            applyPhase(animOut.kind, p: (duration - local) / dOut, entering: false, into: &s)
        }
        let tau = 2 * Double.pi
        switch loop {
        case .none: break
        case .kenBurns:
            let f = FXMath.clamp(local / max(0.1, duration), 0, 1)
            s.scale *= 1 + 0.18 * f
            s.dx += 0.03 * f
        case .pulse: s.scale *= 1 + 0.06 * sin(tau * local * 1.2)
        case .shake:
            let seed = Int(local * 20)
            s.dx += (FXMath.rnd(seed) - 0.5) * 0.02
            s.dy += (FXMath.rnd(seed + 5) - 0.5) * 0.02
            s.rotation += (FXMath.rnd(seed + 9) - 0.5) * 3
        case .swing: s.rotation += 8 * sin(tau * local * 0.8)
        case .float: s.dy += 0.02 * sin(tau * local * 0.6)
        case .flicker: s.opacity *= FXMath.rnd(Int(local * 12)) > 0.25 ? 1 : 0.35
        case .rotate: s.rotation += local * 90
        case .heartbeat:
            let ph = (local * 1.3).truncatingRemainder(dividingBy: 1)
            s.scale *= 1 + 0.12 * pow(max(0, sin(ph * Double.pi * 2)), 6)
        }
        return s
    }
}

// MARK: - Personen-Freistellung

final class PersonSegmenter {
    private lazy var request: VNGeneratePersonSegmentationRequest = {
        let r = VNGeneratePersonSegmentationRequest()
        r.qualityLevel = .balanced
        r.outputPixelFormat = kCVPixelFormatType_OneComponent8
        return r
    }()

    func cutout(_ img: CIImage) -> CIImage {
        let rect = img.extent
        let handler = VNImageRequestHandler(ciImage: img, options: [:])
        do { try handler.perform([request]) } catch { return img }
        guard let obs = request.results?.first else { return img }
        var mask = CIImage(cvPixelBuffer: obs.pixelBuffer)
        let sx = rect.width / mask.extent.width
        let sy = rect.height / mask.extent.height
        mask = mask.transformed(by: CGAffineTransform(scaleX: sx, y: sy)).transformed(by: CGAffineTransform(translationX: rect.minX, y: rect.minY))
        return img.applyingFilter("CIBlendWithMask", parameters: [
            kCIInputBackgroundImageKey: CIImage.empty(),
            kCIInputMaskImageKey: mask,
        ]).cropped(to: rect)
    }
}

// MARK: - Bild-Cache für Fotos

enum StillCache {
    private static let cache: NSCache<NSString, CIImage> = {
        let c = NSCache<NSString, CIImage>()
        c.countLimit = 60
        return c
    }()

    static func image(_ media: MediaItem) -> CIImage? {
        let key = media.path as NSString
        if let c = cache.object(forKey: key) { return c }
        guard let src = CGImageSourceCreateWithURL(media.url as CFURL, nil) else { return nil }
        let opts: [CFString: Any] = [
            kCGImageSourceCreateThumbnailFromImageAlways: true,
            kCGImageSourceCreateThumbnailWithTransform: true,
            kCGImageSourceThumbnailMaxPixelSize: 3840,
        ]
        guard let cg = CGImageSourceCreateThumbnailAtIndex(src, 0, opts as CFDictionary) else { return nil }
        let img = CIImage(cgImage: cg)
        cache.setObject(img, forKey: key)
        return img
    }
}

// MARK: - Frame-Renderer

final class FrameRenderer {
    private let segmenter = PersonSegmenter()

    func render(plan: RenderPlan, time t: Double, size: CGSize, source: (CMPersistentTrackID) -> CVPixelBuffer?) -> CIImage {
        let W = size.width, H = size.height
        let rect = CGRect(origin: .zero, size: size)
        let unit = min(W, H) / 1080
        let bgColor = CIImage.solid(plan.background.mode == .color ? plan.background.color : .black, rect)

        // Hauptspur
        let actives = plan.main.filter { t >= $0.start - 0.0005 && t < $0.end }
        var out: CIImage
        if actives.isEmpty {
            out = bgColor
        } else if actives.count >= 2 {
            let a = actives[0], b = actives[1]
            let fa = mainFrame(a, plan: plan, t: t, rect: rect, source: source)
            let fb = mainFrame(b, plan: plan, t: t, rect: rect, source: source)
            let span = max(0.001, a.end - b.start)
            let p = (t - b.start) / span
            switch (fa, fb) {
            case let (x?, y?): out = TransitionFX.apply(a.transitionOut, from: x, to: y, progress: p, rect: rect)
            case let (x?, nil): out = x
            case let (nil, y?): out = y
            default: out = bgColor
            }
        } else {
            out = mainFrame(actives[0], plan: plan, t: t, rect: rect, source: source) ?? bgColor
        }

        // Überlagerungen (Bild-in-Bild)
        for o in plan.overlays where t >= o.start - 0.0005 && t < o.end {
            guard let layer = clipLayer(o, t: t, rect: rect, source: source) else { continue }
            if o.clip.blend == .normal {
                out = layer.composited(over: out)
            } else {
                out = layer.applyingFilter(o.clip.blend.ciFilter, parameters: [kCIInputBackgroundImageKey: out])
            }
        }

        // Texte & Sticker
        for tx in plan.texts where t >= tx.start - 0.0005 && t < tx.end {
            if let layer = textLayer(tx, t: t, rect: rect, unit: unit) {
                out = layer.composited(over: out)
            }
        }

        out = out.cropped(to: rect)

        // Effekt-Ebenen
        for e in plan.effects where t >= e.start - 0.0005 && t < e.end {
            out = EffectFX.apply(e.kind, intensity: e.intensity, to: out, time: t - e.start)
        }
        return out.composited(over: bgColor).cropped(to: rect)
    }

    // MARK: Clips

    private func sourceImage(_ pc: PlanClip, source: (CMPersistentTrackID) -> CVPixelBuffer?) -> CIImage? {
        switch pc.media.kind {
        case .image:
            return StillCache.image(pc.media)
        case .video:
            guard let id = pc.trackID, let pb = source(id) else { return nil }
            var img = CIImage(cvPixelBuffer: pb)
            if pc.media.orientation != 1, let o = CGImagePropertyOrientation(rawValue: pc.media.orientation) {
                img = img.oriented(o)
            }
            return img.movedToOrigin()
        case .audio:
            return nil
        }
    }

    /// Bearbeitetes Clip-Bild im Quellraum (Zuschnitt, Farbe, Effekte, Maske)
    private func processedSource(_ pc: PlanClip, t: Double, source: (CMPersistentTrackID) -> CVPixelBuffer?) -> CIImage? {
        guard var img = sourceImage(pc, source: source) else { return nil }
        let c = pc.clip
        let local = t - pc.start
        if !c.crop.isFull {
            let e = img.extent
            let r = CGRect(x: e.width * CGFloat(c.crop.x),
                           y: e.height * CGFloat(1 - c.crop.y - c.crop.h),
                           width: max(2, e.width * CGFloat(c.crop.w)),
                           height: max(2, e.height * CGFloat(c.crop.h)))
            img = img.cropped(to: r).movedToOrigin()
        }
        if c.removeBackground { img = segmenter.cutout(img) }
        if c.chroma.enabled { img = ChromaFX.apply(c.chroma, to: img) }
        img = ColorFX.applyPreset(c.filter.preset, intensity: c.filter.intensity, to: img)
        img = ColorFX.applyAdjustments(c.adjust, to: img, time: local)
        for fx in c.effects {
            img = EffectFX.apply(fx.kind, intensity: fx.intensity, to: img, time: local)
        }
        img = MaskFX.applyMask(c.mask, to: img)
        return img
    }

    private func place(_ img: CIImage, clip c: Clip, local: Double, duration: Double, rect: CGRect) -> CIImage {
        let W = rect.width, H = rect.height
        let iw = max(1, img.extent.width), ih = max(1, img.extent.height)
        let tr = KeyframeMath.transform(base: c.transform, keyframes: c.keyframes, at: local)
        let an = Animator.state(animIn: c.animIn, animOut: c.animOut, loop: c.loop, local: local, duration: duration)
        let base = c.fitMode == .fit ? min(W / iw, H / ih) : max(W / iw, H / ih)
        let s = base * CGFloat(tr.scale * an.scale)
        var m = CGAffineTransform(translationX: -iw / 2, y: -ih / 2)
        m = m.concatenating(CGAffineTransform(scaleX: s * (c.flipH ? -1 : 1), y: s * (c.flipV ? -1 : 1)))
        m = m.concatenating(CGAffineTransform(rotationAngle: CGFloat(-(tr.rotation + an.rotation) * Double.pi / 180)))
        m = m.concatenating(CGAffineTransform(translationX: CGFloat(tr.x + an.dx) * W, y: CGFloat(1 - tr.y - an.dy) * H))
        var out = img.transformed(by: m, highQualityDownsample: true)
        if an.blur > 0.1 { out = out.blurred(an.blur * Double(H) / 1080, keepEdges: false) }
        return out.withOpacity(tr.opacity * an.opacity)
    }

    private func blurredBackground(_ img: CIImage, rect: CGRect, amount: Double) -> CIImage {
        let iw = max(1, img.extent.width), ih = max(1, img.extent.height)
        let k: CGFloat = 0.1
        let fill = max(rect.width / iw, rect.height / ih)
        let small = img.transformed(by: CGAffineTransform(scaleX: fill * k, y: fill * k))
        let blurred = small.clampedToExtent().applyingGaussianBlur(sigma: 2 + amount * 10)
        let big = blurred.transformed(by: CGAffineTransform(scaleX: 1 / k, y: 1 / k))
        let dx = (rect.width - iw * fill) / 2, dy = (rect.height - ih * fill) / 2
        return ColorFX.controls(big.transformed(by: CGAffineTransform(translationX: dx, y: dy)), brightness: -0.06, saturation: 1.1).cropped(to: rect)
    }

    private func mainFrame(_ pc: PlanClip, plan: RenderPlan, t: Double, rect: CGRect, source: (CMPersistentTrackID) -> CVPixelBuffer?) -> CIImage? {
        guard let src = processedSource(pc, t: t, source: source) else { return nil }
        let local = t - pc.start
        let layer = place(src, clip: pc.clip, local: local, duration: pc.end - pc.start, rect: rect)
        let bg: CIImage
        if plan.background.mode == .blur {
            bg = blurredBackground(src, rect: rect, amount: plan.background.blur)
        } else {
            bg = CIImage.solid(plan.background.color, rect)
        }
        return layer.composited(over: bg).cropped(to: rect)
    }

    private func clipLayer(_ pc: PlanClip, t: Double, rect: CGRect, source: (CMPersistentTrackID) -> CVPixelBuffer?) -> CIImage? {
        guard let src = processedSource(pc, t: t, source: source) else { return nil }
        return place(src, clip: pc.clip, local: t - pc.start, duration: pc.end - pc.start, rect: rect).cropped(to: rect)
    }

    // MARK: Text

    private func textLayer(_ tx: TextClip, t: Double, rect: CGRect, unit: CGFloat) -> CIImage? {
        let local = t - tx.start
        let tr = KeyframeMath.transform(base: tx.transform, keyframes: tx.keyframes, at: local)
        let an = Animator.state(animIn: tx.animIn, animOut: tx.animOut, loop: tx.loop, local: local, duration: tx.duration)
        let wanted = max(0.05, unit * CGFloat(tr.scale * an.scale))
        // auf Stufen runden, damit der Cache greift
        let q = max(0.05, (wanted * 20).rounded() / 20)
        var img: CIImage?
        switch tx.kind {
        case .symbol:
            img = TextRenderer.shared.symbolImage(name: tx.text, color: tx.style.color, pixelSize: CGFloat(tx.style.fontSize) * 2 * q)
            if let i = img {
                let target = CGFloat(tx.style.fontSize) * 2 * q
                let f = target / max(1, max(i.extent.width, i.extent.height))
                img = i.transformed(by: CGAffineTransform(scaleX: f, y: f))
            }
        case .text, .emoji:
            var str = tx.text
            if an.reveal < 1 {
                let n = Int((Double(str.count) * an.reveal).rounded(.down))
                str = String(str.prefix(n))
                if str.isEmpty { return nil }
            }
            img = TextRenderer.shared.image(text: str, style: tx.style, scale: q)
        }
        guard var image = img?.movedToOrigin() else { return nil }
        let iw = image.extent.width, ih = image.extent.height
        let residual = wanted / q
        var m = CGAffineTransform(translationX: -iw / 2, y: -ih / 2)
        m = m.concatenating(CGAffineTransform(scaleX: residual, y: residual))
        m = m.concatenating(CGAffineTransform(rotationAngle: CGFloat(-(tr.rotation + an.rotation) * Double.pi / 180)))
        m = m.concatenating(CGAffineTransform(translationX: CGFloat(tr.x + an.dx) * rect.width, y: CGFloat(1 - tr.y - an.dy) * rect.height))
        image = image.transformed(by: m)
        if an.blur > 0.1 { image = image.blurred(an.blur * Double(rect.height) / 1080, keepEdges: false) }
        return image.withOpacity(tr.opacity * an.opacity).cropped(to: rect)
    }
}

// MARK: - Compositor für AVFoundation

final class StudioInstruction: NSObject, AVVideoCompositionInstructionProtocol {
    let timeRange: CMTimeRange
    let enablePostProcessing: Bool = false
    let containsTweening: Bool = true
    let requiredSourceTrackIDs: [NSValue]?
    let passthroughTrackID: CMPersistentTrackID = kCMPersistentTrackID_Invalid
    let plan: RenderPlan

    init(timeRange: CMTimeRange, trackIDs: [CMPersistentTrackID], plan: RenderPlan) {
        self.timeRange = timeRange
        self.requiredSourceTrackIDs = trackIDs.map { NSNumber(value: $0) }
        self.plan = plan
        super.init()
    }
}

final class StudioCompositor: NSObject, AVVideoCompositing {
    static let ciContext: CIContext = {
        if let dev = MTLCreateSystemDefaultDevice() {
            return CIContext(mtlDevice: dev, options: [.cacheIntermediates: false])
        }
        return CIContext(options: [.cacheIntermediates: false])
    }()

    static let outputColorSpace = CGColorSpace(name: CGColorSpace.sRGB)!

    private static let pixelAttributes: [String: Any] = [
        kCVPixelBufferPixelFormatTypeKey as String: [kCVPixelFormatType_32BGRA],
        kCVPixelBufferIOSurfacePropertiesKey as String: [String: Any](),
        kCVPixelBufferMetalCompatibilityKey as String: true,
    ]

    var sourcePixelBufferAttributes: [String: Any]? { StudioCompositor.pixelAttributes }
    var requiredPixelBufferAttributesForRenderContext: [String: Any] { StudioCompositor.pixelAttributes }

    private let queue = DispatchQueue(label: "musii.compositor", qos: .userInitiated)
    private let renderer = FrameRenderer()
    private var generation = 0
    private let lock = NSLock()

    func renderContextChanged(_ newRenderContext: AVVideoCompositionRenderContext) {}

    func startRequest(_ request: AVAsynchronousVideoCompositionRequest) {
        lock.lock(); let gen = generation; lock.unlock()
        queue.async { [weak self] in
            guard let self = self else { request.finishCancelledRequest(); return }
            self.lock.lock(); let current = self.generation; self.lock.unlock()
            if gen != current { request.finishCancelledRequest(); return }
            autoreleasepool {
                guard let instr = request.videoCompositionInstruction as? StudioInstruction,
                      let out = request.renderContext.newPixelBuffer() else {
                    request.finish(with: NSError(domain: "MusiiStudio", code: 1, userInfo: [NSLocalizedDescriptionKey: "Frame konnte nicht erzeugt werden"]))
                    return
                }
                let size = request.renderContext.size
                let t = CMTimeGetSeconds(request.compositionTime)
                let image = self.renderer.render(plan: instr.plan, time: t, size: size) { id in
                    request.sourceFrame(byTrackID: id)
                }
                StudioCompositor.ciContext.render(image, to: out, bounds: CGRect(origin: .zero, size: size), colorSpace: StudioCompositor.outputColorSpace)
                request.finish(withComposedVideoFrame: out)
            }
        }
    }

    func cancelAllPendingVideoCompositionRequests() {
        lock.lock(); generation += 1; lock.unlock()
    }
}

/// Rendert einen einzelnen Frame direkt (z.B. für Vorschaubilder ohne AVPlayer)
enum DirectRender {
    static func cgImage(plan: RenderPlan, time: Double, size: CGSize) -> CGImage? {
        let r = FrameRenderer()
        let img = r.render(plan: plan, time: time, size: size) { _ in nil }
        return StudioCompositor.ciContext.createCGImage(img, from: CGRect(origin: .zero, size: size))
    }
}

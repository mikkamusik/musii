import Foundation
import AVFoundation
import CoreImage
import ImageIO
import UniformTypeIdentifiers
import AppKit

/// Automatischer Funktionstest der Video-Engine (läuft ohne Oberfläche, z.B. im CI).
enum SelfTest {
    private static var failures: [String] = []
    private static var passes = 0

    static func start(outputDir: URL) -> Never {
        Task.detached {
            let ok = await run(outputDir: outputDir)
            print(ok ? "SELFTEST OK (\(passes) Prüfungen)" : "SELFTEST FEHLGESCHLAGEN: \(failures.count) Fehler")
            exit(ok ? 0 : 1)
        }
        dispatchMain()
    }

    private static func check(_ cond: Bool, _ name: String) {
        if cond { passes += 1; print("  ✓ \(name)") } else { failures.append(name); print("  ✗ \(name)") }
    }

    private static func step<T>(_ name: String, _ f: () async throws -> T) async -> T? {
        print("▶︎ \(name)")
        let start = Date()
        do {
            let r = try await f()
            print("  … fertig in \(String(format: "%.1f", Date().timeIntervalSince(start))) s")
            return r
        } catch {
            failures.append("\(name): \(error.localizedDescription)")
            print("  ✗ \(name): \(error)")
            return nil
        }
    }

    // MARK: Testmedien

    static func makeVideo(url: URL, width: Int, height: Int, seconds: Double, fps: Int, hue: Double, rotate: Bool, withAudio: Bool) async throws {
        try? FileManager.default.removeItem(at: url)
        let writer = try AVAssetWriter(outputURL: url, fileType: .mov)
        let vIn = AVAssetWriterInput(mediaType: .video, outputSettings: [
            AVVideoCodecKey: AVVideoCodecType.h264, AVVideoWidthKey: width, AVVideoHeightKey: height,
        ])
        vIn.expectsMediaDataInRealTime = false
        if rotate { vIn.transform = CGAffineTransform(rotationAngle: .pi / 2) }
        let adaptor = AVAssetWriterInputPixelBufferAdaptor(assetWriterInput: vIn, sourcePixelBufferAttributes: [
            kCVPixelBufferPixelFormatTypeKey as String: kCVPixelFormatType_32BGRA,
            kCVPixelBufferWidthKey as String: width, kCVPixelBufferHeightKey as String: height,
        ])
        writer.add(vIn)
        let sampleRate = 44100.0
        var aIn: AVAssetWriterInput?
        if withAudio {
            let a = AVAssetWriterInput(mediaType: .audio, outputSettings: [
                AVFormatIDKey: kAudioFormatMPEG4AAC, AVSampleRateKey: sampleRate, AVNumberOfChannelsKey: 2, AVEncoderBitRateKey: 128_000,
            ])
            a.expectsMediaDataInRealTime = false
            writer.add(a)
            aIn = a
        }
        guard writer.startWriting() else { throw writer.error ?? StudioError.message("Writer") }
        writer.startSession(atSourceTime: .zero)
        let frames = Int(seconds * Double(fps))
        let samplesPerFrame = Int(sampleRate) / fps
        var phase = 0.0
        func videoFrame(_ i: Int) -> CVPixelBuffer? {
            var pb: CVPixelBuffer?
            CVPixelBufferCreate(kCFAllocatorDefault, width, height, kCVPixelFormatType_32BGRA, nil, &pb)
            guard let buf = pb else { return nil }
            CVPixelBufferLockBaseAddress(buf, [])
            let base = CVPixelBufferGetBaseAddress(buf)!.assumingMemoryBound(to: UInt8.self)
            let bpr = CVPixelBufferGetBytesPerRow(buf)
            let t = Double(i) / Double(fps)
            let boxX = Int((0.1 + 0.6 * (t / seconds)) * Double(width))
            for y in 0..<height {
                for x in 0..<width {
                    let o = y * bpr + x * 4
                    let inBox = x >= boxX && x < boxX + width / 6 && y >= height / 3 && y < height / 3 + height / 4
                    let r = inBox ? 255.0 : 120 + 120 * sin(hue + Double(x) / Double(width) * 3)
                    let g = inBox ? 255.0 : 120 + 120 * sin(hue + 2 + Double(y) / Double(height) * 3)
                    let b = inBox ? 255.0 : 120 + 120 * sin(hue + 4 + t)
                    base[o] = UInt8(max(0, min(255, b)))
                    base[o + 1] = UInt8(max(0, min(255, g)))
                    base[o + 2] = UInt8(max(0, min(255, r)))
                    base[o + 3] = 255
                }
            }
            CVPixelBufferUnlockBaseAddress(buf, [])
            return buf
        }
        func audioChunk(_ i: Int) -> CMSampleBuffer? {
            var samples = [Int16](repeating: 0, count: samplesPerFrame * 2)
            for s in 0..<samplesPerFrame {
                let v = Int16(sin(phase) * 8000)
                phase += 2 * Double.pi * 440 / sampleRate
                samples[s * 2] = v
                samples[s * 2 + 1] = v
            }
            return MediaTools.pcmBuffer(samples: samples, channels: 2, sampleRate: sampleRate, startFrame: i * samplesPerFrame)
        }
        // Bild und Ton abwechselnd schreiben, sobald die jeweilige Spur bereit ist
        var vi = 0, ai = aIn == nil ? frames : 0
        var idle = 0
        while vi < frames || ai < frames {
            var progressed = false
            if vi < frames && vIn.isReadyForMoreMediaData {
                if let buf = videoFrame(vi) {
                    adaptor.append(buf, withPresentationTime: CMTime(value: CMTimeValue(vi), timescale: CMTimeScale(fps)))
                }
                vi += 1
                progressed = true
                if vi == frames { vIn.markAsFinished() }
            }
            if let a = aIn, ai < frames, a.isReadyForMoreMediaData {
                if let sb = audioChunk(ai) { a.append(sb) }
                ai += 1
                progressed = true
                if ai == frames { a.markAsFinished() }
            }
            if !progressed {
                idle += 1
                if idle > 10_000 { throw StudioError.message("Testvideo: Zeitüberschreitung") }
                try await Task.sleep(nanoseconds: 2_000_000)
            } else {
                idle = 0
            }
        }
        await withCheckedContinuation { (c: CheckedContinuation<Void, Never>) in writer.finishWriting { c.resume() } }
        if writer.status != .completed { throw writer.error ?? StudioError.message("Testvideo fehlgeschlagen") }
    }

    static func makeImage(url: URL, width: Int, height: Int) throws {
        let cs = CGColorSpaceCreateDeviceRGB()
        guard let ctx = CGContext(data: nil, width: width, height: height, bitsPerComponent: 8, bytesPerRow: 0, space: cs,
                                  bitmapInfo: CGImageAlphaInfo.premultipliedLast.rawValue) else { throw StudioError.message("Kontext") }
        ctx.setFillColor(CGColor(srgbRed: 0.95, green: 0.6, blue: 0.2, alpha: 1))
        ctx.fill(CGRect(x: 0, y: 0, width: width, height: height))
        ctx.setFillColor(CGColor(srgbRed: 0.1, green: 0.3, blue: 0.8, alpha: 1))
        ctx.fillEllipse(in: CGRect(x: width / 4, y: height / 4, width: width / 2, height: height / 2))
        guard let img = ctx.makeImage(),
              let dest = CGImageDestinationCreateWithURL(url as CFURL, UTType.png.identifier as CFString, 1, nil) else { throw StudioError.message("Bild") }
        CGImageDestinationAddImage(dest, img, nil)
        guard CGImageDestinationFinalize(dest) else { throw StudioError.message("Bild speichern") }
    }

    static func makeAudio(url: URL, seconds: Double) throws {
        try? FileManager.default.removeItem(at: url)
        let format = AVAudioFormat(standardFormatWithSampleRate: 44100, channels: 2)!
        let file = try AVAudioFile(forWriting: url, settings: format.settings)
        let frames = AVAudioFrameCount(seconds * 44100)
        let buf = AVAudioPCMBuffer(pcmFormat: format, frameCapacity: frames)!
        buf.frameLength = frames
        for ch in 0..<2 {
            let p = buf.floatChannelData![ch]
            for i in 0..<Int(frames) { p[i] = Float(sin(Double(i) * 2 * Double.pi * 330 / 44100) * 0.3) }
        }
        try file.write(from: buf)
    }

    // MARK: Prüfungen

    static func averageBrightness(_ cg: CGImage) -> Double {
        let ci = CIImage(cgImage: cg)
        guard let avg = CIFilter(name: "CIAreaAverage", parameters: [kCIInputImageKey: ci, "inputExtent": CIVector(cgRect: ci.extent)])?.outputImage else { return 0 }
        var px = [UInt8](repeating: 0, count: 4)
        StudioCompositor.ciContext.render(avg, toBitmap: &px, rowBytes: 4, bounds: CGRect(x: 0, y: 0, width: 1, height: 1), format: .RGBA8, colorSpace: nil)
        return (Double(px[0]) + Double(px[1]) + Double(px[2])) / 3 / 255
    }

    static func probe(_ url: URL) async -> (duration: Double, video: Bool, audio: Bool, size: CGSize) {
        let a = AVURLAsset(url: url)
        let d = (try? await a.load(.duration).seconds) ?? 0
        let v = (try? await a.loadTracks(withMediaType: .video)) ?? []
        let au = (try? await a.loadTracks(withMediaType: .audio)) ?? []
        var size = CGSize.zero
        if let t = v.first, let s = try? await t.load(.naturalSize) { size = s }
        return (d, !v.isEmpty, !au.isEmpty, size)
    }

    static func run(outputDir: URL) async -> Bool {
        try? FileManager.default.createDirectory(at: outputDir, withIntermediateDirectories: true)
        let media = outputDir.appendingPathComponent("medien")
        try? FileManager.default.createDirectory(at: media, withIntermediateDirectories: true)
        print("Musii Studio Selbsttest – Ausgabe: \(outputDir.path)")

        let vA = media.appendingPathComponent("a-landschaft.mov")
        let vB = media.appendingPathComponent("b-hochkant.mov")
        let img = media.appendingPathComponent("c-foto.png")
        let aud = media.appendingPathComponent("d-musik.caf")
        _ = await step("Testmedien erzeugen") {
            try await makeVideo(url: vA, width: 640, height: 360, seconds: 3, fps: 30, hue: 0, rotate: false, withAudio: true)
            try await makeVideo(url: vB, width: 640, height: 360, seconds: 2.5, fps: 30, hue: 2, rotate: true, withAudio: true)
            try makeImage(url: img, width: 800, height: 600)
            try makeAudio(url: aud, seconds: 4)
        }

        var items: [MediaItem] = []
        _ = await step("Import") {
            for u in [vA, vB, img, aud] { items.append(try await MediaImporter.load(u)) }
        }
        guard items.count == 4 else { return false }
        let (mA, mB, mI, mAu) = (items[0], items[1], items[2], items[3])
        check(mA.kind == .video && abs(mA.duration - 3) < 0.1 && mA.hasAudio, "Video A erkannt (3 s, mit Ton)")
        check(mB.orientation == CGImagePropertyOrientation.right.rawValue && mB.width < mB.height, "Hochkant-Video erkannt (gedreht)")
        check(mI.kind == .image && mI.width == 800, "Foto erkannt")
        check(mAu.kind == .audio && abs(mAu.duration - 4) < 0.1, "Audio erkannt")

        // Projekt mit möglichst vielen Funktionen
        var p = Project(name: "Selbsttest")
        p.aspect = .r16x9
        p.media = items
        var c1 = Clip(mediaID: mA.id, sourceDuration: 3)
        c1.filter = FilterSetting(preset: "vivid", intensity: 0.8)
        c1.adjust.contrast = 20
        c1.adjust.grain = 30
        c1.transition = TransitionSetting(kind: .dissolve, duration: 0.6)
        c1.animIn = AnimSetting(kind: .zoomIn, duration: 0.5)
        var c2 = Clip(mediaID: mI.id, sourceDuration: 2)
        c2.loop = .kenBurns
        c2.transition = TransitionSetting(kind: .pushLeft, duration: 0.5)
        var c3 = Clip(mediaID: mB.id, sourceStart: 0.2, sourceDuration: 2.2, speed: 2)
        c3.effects = [EffectSetting(kind: .glitch, intensity: 0.7)]
        c3.fadeOut = 0.3
        p.main = [c1, c2, c3]
        p.background = CanvasBackground(mode: .blur, color: .black, blur: 0.6)
        var ov = Clip(mediaID: mA.id, sourceDuration: 1.5, start: 1)
        ov.transform.scale = 0.4
        ov.transform.x = 0.75
        ov.mask = MaskSetting(kind: .circle, x: 0.5, y: 0.5, size: 0.8, aspect: 1, rotation: 0, feather: 0.1, invert: false)
        ov.keyframes = [Keyframe(time: 0, transform: ov.transform), Keyframe(time: 1.4, transform: Transform2D(x: 0.25, y: 0.3, scale: 0.6, rotation: 30, opacity: 0.8))]
        ov.chroma = ChromaKey(enabled: true, color: .green, tolerance: 0.3, softness: 0.1)
        ov.blend = .screen
        p.overlays = [ov]
        var au = Clip(mediaID: mAu.id, sourceDuration: 4, start: 0.5)
        au.fadeIn = 0.5
        au.fadeOut = 1
        au.volume = 0.7
        p.audio = [au]
        var title = TextClip(text: "Hallo Musii! 🎬", start: 0.2, duration: 2.5)
        title.style = TextCatalog.presets[3].style
        title.animIn = AnimSetting(kind: .pop, duration: 0.4)
        title.animOut = AnimSetting(kind: .fade, duration: 0.4)
        var sticker = TextClip(kind: .emoji, text: "🔥", start: 1, duration: 2)
        sticker.style.fontSize = 150
        sticker.transform.x = 0.85
        sticker.loop = .pulse
        var symbol = TextClip(kind: .symbol, text: "heart.fill", start: 2, duration: 2)
        symbol.style.color = RGBA(1, 0.2, 0.4)
        symbol.lane = 1
        var typer = TextClip(text: "Schreibmaschine", start: 3, duration: 1.5)
        typer.animIn = AnimSetting(kind: .typewriter, duration: 1)
        typer.lane = 2
        p.texts = [title, sticker, symbol, typer]
        p.effects = [EffectClip(kind: .snow, intensity: 0.6, start: 0, duration: 2), EffectClip(kind: .vhs, intensity: 0.5, start: 3, duration: 1, lane: 1)]

        let expected = p.duration
        check(abs(p.mainSlots[1].start - 2.4) < 0.01, "Übergang verschiebt Clip 2 (Start 2,4 s)")
        check(expected > 4.5 && expected < 6, "Projektdauer plausibel (\(String(format: "%.2f", expected)) s)")

        // Projekt speichern/laden
        _ = await step("Projekt als JSON speichern/laden") {
            let data = try JSONEncoder().encode(p)
            let back = try JSONDecoder().decode(Project.self, from: data)
            check(back == p, "JSON-Rundreise identisch")
        }

        // Alle Filter, Effekte, Übergänge, Masken rendern
        _ = await step("Alle Filter/Effekte/Übergänge rendern") {
            var plainClip = Clip(mediaID: mI.id, sourceDuration: 2)
            plainClip.transition = TransitionSetting(kind: .dissolve, duration: 1)
            let size = CGSize(width: 320, height: 180)
            var okCount = 0
            var total = 0
            for f in FilterCatalog.all {
                var c = plainClip; c.filter.preset = f.id
                let plan = RenderPlan(canvas: size, background: CanvasBackground(), main: [PlanClip(clip: c, media: mI, start: 0, end: 2, trackID: nil, transitionOut: .none)],
                                      overlays: [], texts: [], effects: [], duration: 2)
                total += 1
                if let cg = DirectRender.cgImage(plan: plan, time: 0.5, size: size), averageBrightness(cg) > 0.02 { okCount += 1 } else { print("    Filter fehlgeschlagen: \(f.id)") }
            }
            for k in EffectKind.allCases {
                var c = plainClip; c.effects = [EffectSetting(kind: k, intensity: 0.7)]
                let plan = RenderPlan(canvas: size, background: CanvasBackground(), main: [PlanClip(clip: c, media: mI, start: 0, end: 2, trackID: nil, transitionOut: .none)],
                                      overlays: [], texts: [], effects: [EffectClip(kind: k, start: 0, duration: 2)], duration: 2)
                total += 1
                if DirectRender.cgImage(plan: plan, time: 0.7, size: size) != nil { okCount += 1 } else { print("    Effekt fehlgeschlagen: \(k)") }
            }
            for k in TransitionKind.allCases {
                let a = PlanClip(clip: plainClip, media: mI, start: 0, end: 2, trackID: nil, transitionOut: k)
                var c2 = plainClip; c2.id = UUID(); c2.flipH = true
                let b = PlanClip(clip: c2, media: mI, start: 1, end: 3, trackID: nil, transitionOut: .none)
                let plan = RenderPlan(canvas: size, background: CanvasBackground(), main: [a, b], overlays: [], texts: [], effects: [], duration: 3)
                total += 1
                if let cg = DirectRender.cgImage(plan: plan, time: 1.5, size: size), averageBrightness(cg) > 0.01 || k == .dipBlack { okCount += 1 } else { print("    Übergang fehlgeschlagen: \(k)") }
            }
            for k in MaskKind.allCases {
                var c = plainClip; c.mask = MaskSetting(); c.mask.kind = k
                let plan = RenderPlan(canvas: size, background: CanvasBackground(), main: [PlanClip(clip: c, media: mI, start: 0, end: 2, trackID: nil, transitionOut: .none)],
                                      overlays: [], texts: [], effects: [], duration: 2)
                total += 1
                if DirectRender.cgImage(plan: plan, time: 0.5, size: size) != nil { okCount += 1 }
            }
            for preset in TextCatalog.presets {
                total += 1
                if TextRenderer.shared.image(text: "Test Äöü", style: preset.style, scale: 0.5) != nil { okCount += 1 } else { print("    Textstil fehlgeschlagen: \(preset.id)") }
            }
            total += 1
            if TextRenderer.shared.symbolImage(name: "heart.fill", color: .white, pixelSize: 100) != nil { okCount += 1 }
            check(okCount == total, "Rendering: \(okCount)/\(total) Varianten erfolgreich")
        }

        // Vorschau-Komposition
        _ = await step("Komposition bauen") {
            let out = try await CompositionBuilder.build(project: p, renderSize: CGSize(width: 640, height: 360))
            check(abs(out.duration - expected) < 0.05, "Kompositionsdauer = Projektdauer")
            check(out.hasAudio, "Komposition hat Audio")
            let gen = AVAssetImageGenerator(asset: out.composition)
            gen.videoComposition = out.videoComposition
            gen.requestedTimeToleranceBefore = .zero
            gen.requestedTimeToleranceAfter = .zero
            var bright = 0
            for t in [0.5, 2.6, 4.0] {
                if let cg = try? gen.copyCGImage(at: CMTime(seconds: t, preferredTimescale: 600), actualTime: nil), averageBrightness(cg) > 0.05 { bright += 1 }
            }
            check(bright == 3, "Vorschaubilder aus der Komposition (\(bright)/3)")
        }

        // Export-Varianten
        let mp4 = outputDir.appendingPathComponent("export-h264.mp4")
        _ = await step("Export MP4 (H.264, 720p)") {
            var s = ExportSettings(); s.resolution = .p720; s.fps = 30; s.codec = .h264; s.format = .mp4
            try await ExportJob.runRetained(project: p, settings: s, to: mp4) { _ in }
            let info = await probe(mp4)
            check(abs(info.duration - expected) < 0.2, "MP4-Dauer \(String(format: "%.2f", info.duration)) s ≈ \(String(format: "%.2f", expected)) s")
            check(info.video && info.audio, "MP4 hat Bild und Ton")
            check(Int(info.size.width) == 1280 && Int(info.size.height) == 720, "MP4 hat 1280×720")
            let gen = AVAssetImageGenerator(asset: AVURLAsset(url: mp4))
            if let cg = try? gen.copyCGImage(at: CMTime(seconds: 1.5, preferredTimescale: 600), actualTime: nil) {
                check(averageBrightness(cg) > 0.05, "Exportiertes Bild ist nicht schwarz")
                let rep = NSBitmapImageRepCompat.png(cg)
                try? rep?.write(to: outputDir.appendingPathComponent("export-frame.png"))
            } else {
                check(false, "Bild aus Export lesbar")
            }
        }
        _ = await step("Export HEVC 1080p 60 fps") {
            var s = ExportSettings(); s.resolution = .p1080; s.fps = 60; s.codec = .hevc; s.format = .mov; s.quality = .high
            let u = outputDir.appendingPathComponent("export-hevc.mov")
            try await ExportJob.runRetained(project: p, settings: s, to: u) { _ in }
            let info = await probe(u)
            check(info.video && abs(info.duration - expected) < 0.2, "HEVC-Export ok")
        }
        _ = await step("Export 9:16 Hochformat") {
            var q = p; q.aspect = .r9x16
            var s = ExportSettings(); s.resolution = .p720; s.format = .mp4
            let u = outputDir.appendingPathComponent("export-9x16.mp4")
            try await ExportJob.runRetained(project: q, settings: s, to: u) { _ in }
            let info = await probe(u)
            check(Int(info.size.width) == 720 && Int(info.size.height) == 1280, "Hochformat 720×1280")
        }
        _ = await step("Export GIF") {
            var s = ExportSettings(); s.format = .gif
            let u = outputDir.appendingPathComponent("export.gif")
            try await ExportJob.runRetained(project: p, settings: s, to: u) { _ in }
            let size = (try? FileManager.default.attributesOfItem(atPath: u.path)[.size] as? Int) ?? 0
            check(size > 1000, "GIF erstellt (\(size / 1024) KB)")
        }
        _ = await step("Export nur Audio (M4A)") {
            var s = ExportSettings(); s.format = .m4a
            let u = outputDir.appendingPathComponent("export.m4a")
            try await ExportJob.runRetained(project: p, settings: s, to: u) { _ in }
            let info = await probe(u)
            check(info.audio && !info.video && info.duration > 4, "M4A hat nur Ton")
        }
        _ = await step("Einzelbild exportieren") {
            let u = outputDir.appendingPathComponent("standbild.png")
            try await ExportJob.exportFrame(project: p, time: 1, url: u)
            check(FileManager.default.fileExists(atPath: u.path), "PNG-Standbild")
        }

        // Werkzeuge
        let pid = UUID()
        _ = await step("Rückwärts") {
            let u = try await MediaTools.reverse(media: mA, projectID: pid) { _ in }
            let info = await probe(u)
            check(abs(info.duration - 3) < 0.15 && info.audio, "Rückwärts-Video 3 s mit Ton")
        }
        _ = await step("Standbild") {
            let u = try await MediaTools.freezeFrame(media: mB, sourceTime: 1, projectID: pid)
            let m = try await MediaImporter.load(u)
            check(m.kind == .image && m.height > m.width, "Standbild hochkant")
        }
        _ = await step("Wellenform & Vorschaubilder") {
            let w = ThumbStore.waveform(mA)
            check(w.count > 100 && (w.max() ?? 0) > 0.1, "Wellenform berechnet")
            let s = ThumbStore.videoStrip(mA)
            check(s.count == ThumbStore.stripCount, "Filmstreifen berechnet")
        }
        _ = await step("Untertitel-Gruppierung") {
            let words = (0..<20).map { CaptionGenerator.Word(text: "Wort\($0)", start: Double($0) * 0.4, duration: 0.3) }
            let caps = CaptionGenerator.group(words)
            check(caps.count >= 3 && caps.allSatisfy { $0.end > $0.start }, "Untertitel gruppiert (\(caps.count))")
        }
        try? FileManager.default.removeItem(at: AppPaths.projectFolder(pid))

        print("")
        print("Ergebnis: \(passes) bestanden, \(failures.count) fehlgeschlagen")
        for f in failures { print("  FEHLER: \(f)") }
        return failures.isEmpty
    }
}

enum NSBitmapImageRepCompat {
    static func png(_ cg: CGImage) -> Data? {
        NSBitmapImageRep(cgImage: cg).representation(using: .png, properties: [:])
    }
}

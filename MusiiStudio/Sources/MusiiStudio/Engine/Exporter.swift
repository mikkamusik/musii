import Foundation
import AVFoundation
import CoreImage
import ImageIO
import UniformTypeIdentifiers

enum ExportResolution: String, CaseIterable, Identifiable, Codable {
    case p480, p720, p1080, p1440, p2160
    var id: String { rawValue }
    var title: String {
        switch self {
        case .p480: return "480p"
        case .p720: return "720p"
        case .p1080: return "1080p (Full HD)"
        case .p1440: return "2K (1440p)"
        case .p2160: return "4K (2160p)"
        }
    }
    var shortSide: CGFloat {
        switch self {
        case .p480: return 480
        case .p720: return 720
        case .p1080: return 1080
        case .p1440: return 1440
        case .p2160: return 2160
        }
    }
}

enum ExportCodec: String, CaseIterable, Identifiable, Codable {
    case h264, hevc, prores
    var id: String { rawValue }
    var title: String {
        switch self {
        case .h264: return "H.264 (kompatibel)"
        case .hevc: return "HEVC / H.265 (kleiner)"
        case .prores: return "ProRes 422 (Profi)"
        }
    }
}

enum ExportQuality: String, CaseIterable, Identifiable, Codable {
    case low, recommended, high, maximum
    var id: String { rawValue }
    var title: String {
        switch self {
        case .low: return "Niedrig"
        case .recommended: return "Empfohlen"
        case .high: return "Hoch"
        case .maximum: return "Maximal"
        }
    }
    var factor: Double {
        switch self {
        case .low: return 0.5
        case .recommended: return 1
        case .high: return 1.6
        case .maximum: return 2.6
        }
    }
}

enum ExportFormat: String, CaseIterable, Identifiable, Codable {
    case mp4, mov, gif, m4a
    var id: String { rawValue }
    var title: String {
        switch self {
        case .mp4: return "MP4 Video"
        case .mov: return "MOV Video"
        case .gif: return "GIF Animation"
        case .m4a: return "Nur Audio (M4A)"
        }
    }
}

struct ExportSettings: Codable, Equatable {
    var resolution: ExportResolution = .p1080
    var fps: Int = 30
    var codec: ExportCodec = .h264
    var quality: ExportQuality = .recommended
    var format: ExportFormat = .mp4
}

final class ExportJob {
    private var reader: AVAssetReader?
    private var writer: AVAssetWriter?
    private var cancelled = false
    private let lock = NSLock()

    func cancel() {
        lock.lock(); cancelled = true; lock.unlock()
        reader?.cancelReading()
        writer?.cancelWriting()
    }

    private var isCancelled: Bool { lock.lock(); defer { lock.unlock() }; return cancelled }

    /// Export mit eigener Job-Instanz, die während des gesamten Exports gehalten wird
    static func runRetained(project: Project, settings: ExportSettings, to url: URL, progress: @escaping (Double) -> Void) async throws {
        let job = ExportJob()
        try await job.run(project: project, settings: settings, to: url, progress: progress)
        withExtendedLifetime(job) {}
    }

    static func renderSize(project: Project, resolution: ExportResolution) -> CGSize {
        let c = project.canvasSize
        let f = resolution.shortSide / min(c.width, c.height)
        return CGSize(width: max(16, (c.width * f / 2).rounded() * 2), height: max(16, (c.height * f / 2).rounded() * 2))
    }

    static func bitrate(size: CGSize, fps: Int, codec: ExportCodec, quality: ExportQuality) -> Int {
        // ca. 0.1 Bit pro Pixel für H.264 bei 30fps
        let pixels = Double(size.width * size.height)
        var bpp = 0.1 * quality.factor
        if codec == .hevc { bpp *= 0.65 }
        let fpsFactor = Double(fps) / 30
        return max(800_000, Int(pixels * bpp * 30 * (0.6 + 0.4 * fpsFactor)))
    }

    func run(project: Project, settings: ExportSettings, to url: URL, progress: @escaping (Double) -> Void) async throws {
        var p = project
        p.fps = settings.fps
        let size = ExportJob.renderSize(project: p, resolution: settings.resolution)
        switch settings.format {
        case .gif:
            try await exportGIF(project: p, url: url, progress: progress)
        case .m4a:
            let build = try await CompositionBuilder.build(project: p, renderSize: size)
            guard build.hasAudio else { throw StudioError.message("Das Projekt enthält keine Audiospur.") }
            try await write(build: build, url: url, fileType: .m4a, size: size, settings: settings, video: false, progress: progress)
        case .mp4, .mov:
            let build = try await CompositionBuilder.build(project: p, renderSize: size)
            try await write(build: build, url: url, fileType: settings.format == .mov ? .mov : .mp4, size: size, settings: settings, video: true, progress: progress)
        }
    }

    private func videoSettings(size: CGSize, settings: ExportSettings) -> [String: Any] {
        switch settings.codec {
        case .prores:
            return [AVVideoCodecKey: AVVideoCodecType.proRes422, AVVideoWidthKey: Int(size.width), AVVideoHeightKey: Int(size.height)]
        case .hevc, .h264:
            var props: [String: Any] = [
                AVVideoAverageBitRateKey: ExportJob.bitrate(size: size, fps: settings.fps, codec: settings.codec, quality: settings.quality),
                AVVideoExpectedSourceFrameRateKey: settings.fps,
                AVVideoMaxKeyFrameIntervalKey: settings.fps * 2,
            ]
            if settings.codec == .h264 {
                props[AVVideoProfileLevelKey] = AVVideoProfileLevelH264HighAutoLevel
            }
            return [
                AVVideoCodecKey: settings.codec == .hevc ? AVVideoCodecType.hevc : AVVideoCodecType.h264,
                AVVideoWidthKey: Int(size.width),
                AVVideoHeightKey: Int(size.height),
                AVVideoCompressionPropertiesKey: props,
            ]
        }
    }

    private func write(build: BuildOutput, url: URL, fileType: AVFileType, size: CGSize, settings: ExportSettings, video: Bool, progress: @escaping (Double) -> Void) async throws {
        try? FileManager.default.removeItem(at: url)
        let comp = build.composition
        let reader = try AVAssetReader(asset: comp)
        reader.timeRange = CMTimeRange(start: .zero, duration: CMTime(seconds: build.duration, preferredTimescale: 600))
        self.reader = reader

        var vOut: AVAssetReaderVideoCompositionOutput?
        if video {
            let vTracks = comp.tracks(withMediaType: .video)
            let o = AVAssetReaderVideoCompositionOutput(videoTracks: vTracks, videoSettings: [
                kCVPixelBufferPixelFormatTypeKey as String: kCVPixelFormatType_32BGRA,
                kCVPixelBufferIOSurfacePropertiesKey as String: [String: Any](),
            ])
            o.videoComposition = build.videoComposition
            o.alwaysCopiesSampleData = false
            if reader.canAdd(o) { reader.add(o); vOut = o }
        }
        var aOut: AVAssetReaderAudioMixOutput?
        let aTracks = comp.tracks(withMediaType: .audio)
        if !aTracks.isEmpty && build.hasAudio {
            let o = AVAssetReaderAudioMixOutput(audioTracks: aTracks, audioSettings: [
                AVFormatIDKey: kAudioFormatLinearPCM,
                AVSampleRateKey: 48000,
                AVNumberOfChannelsKey: 2,
                AVLinearPCMBitDepthKey: 16,
                AVLinearPCMIsFloatKey: false,
                AVLinearPCMIsBigEndianKey: false,
                AVLinearPCMIsNonInterleaved: false,
            ])
            o.audioMix = build.audioMix
            o.audioTimePitchAlgorithm = .spectral
            o.alwaysCopiesSampleData = false
            if reader.canAdd(o) { reader.add(o); aOut = o }
        }

        let writer = try AVAssetWriter(outputURL: url, fileType: fileType)
        self.writer = writer
        var vIn: AVAssetWriterInput?
        if vOut != nil {
            var vs = videoSettings(size: size, settings: settings)
            if !writer.canApply(outputSettings: vs, forMediaType: .video) {
                var fallback = settings; fallback.codec = .h264
                vs = videoSettings(size: size, settings: fallback)
            }
            let i = AVAssetWriterInput(mediaType: .video, outputSettings: vs)
            i.expectsMediaDataInRealTime = false
            if writer.canAdd(i) { writer.add(i); vIn = i }
        }
        var aIn: AVAssetWriterInput?
        if aOut != nil {
            let i = AVAssetWriterInput(mediaType: .audio, outputSettings: [
                AVFormatIDKey: kAudioFormatMPEG4AAC,
                AVSampleRateKey: 48000,
                AVNumberOfChannelsKey: 2,
                AVEncoderBitRateKey: 256_000,
            ])
            i.expectsMediaDataInRealTime = false
            if writer.canAdd(i) { writer.add(i); aIn = i }
        }
        guard vIn != nil || aIn != nil else { throw StudioError.message("Nichts zu exportieren.") }

        guard reader.startReading() else { throw reader.error ?? StudioError.message("Lesen fehlgeschlagen") }
        guard writer.startWriting() else { throw writer.error ?? StudioError.message("Schreiben fehlgeschlagen") }
        writer.startSession(atSourceTime: .zero)

        let total = max(0.01, build.duration)
        let group = DispatchGroup()
        let progressLock = NSLock()
        var vProg = 0.0, aProg = 0.0

        func pump(_ input: AVAssetWriterInput, _ output: AVAssetReaderOutput, label: String, isVideo: Bool) {
            group.enter()
            let q = DispatchQueue(label: "musii.export.\(label)")
            var finished = false
            input.requestMediaDataWhenReady(on: q) {
                while input.isReadyForMoreMediaData && !finished {
                    if self.isCancelled {
                        finished = true
                        input.markAsFinished()
                        group.leave()
                        return
                    }
                    if let sb = output.copyNextSampleBuffer() {
                        let t = CMSampleBufferGetPresentationTimeStamp(sb).seconds
                        if !input.append(sb) {
                            finished = true
                            input.markAsFinished()
                            group.leave()
                            return
                        }
                        progressLock.lock()
                        if isVideo { vProg = t / total } else { aProg = t / total }
                        let p = (vIn != nil && aIn != nil) ? min(vProg, aProg) : max(vProg, aProg)
                        progressLock.unlock()
                        progress(min(0.999, max(0, p)))
                    } else {
                        finished = true
                        input.markAsFinished()
                        group.leave()
                        return
                    }
                }
            }
        }
        if let i = vIn, let o = vOut { pump(i, o, label: "video", isVideo: true) }
        if let i = aIn, let o = aOut { pump(i, o, label: "audio", isVideo: false) }

        await withCheckedContinuation { (c: CheckedContinuation<Void, Never>) in
            group.notify(queue: .global()) { c.resume() }
        }
        if isCancelled {
            writer.cancelWriting()
            try? FileManager.default.removeItem(at: url)
            throw CancellationError()
        }
        if reader.status == .failed {
            writer.cancelWriting()
            throw reader.error ?? StudioError.message("Export fehlgeschlagen (Lesen)")
        }
        await withCheckedContinuation { (c: CheckedContinuation<Void, Never>) in
            writer.finishWriting { c.resume() }
        }
        if writer.status != .completed {
            throw writer.error ?? StudioError.message("Export fehlgeschlagen (Schreiben)")
        }
        progress(1)
    }

    // MARK: GIF

    private func exportGIF(project: Project, url: URL, progress: @escaping (Double) -> Void) async throws {
        var p = project
        p.fps = 15
        let size = CompositionBuilder.renderSize(for: p, maxLongSide: 540)
        let build = try await CompositionBuilder.build(project: p, renderSize: size)
        let gen = AVAssetImageGenerator(asset: build.composition)
        gen.videoComposition = build.videoComposition
        gen.requestedTimeToleranceBefore = .zero
        gen.requestedTimeToleranceAfter = .zero
        gen.maximumSize = size
        let fps = 12.0
        let count = max(1, Int(build.duration * fps))
        try? FileManager.default.removeItem(at: url)
        guard let dest = CGImageDestinationCreateWithURL(url as CFURL, UTType.gif.identifier as CFString, count, nil) else {
            throw StudioError.message("GIF konnte nicht erstellt werden")
        }
        CGImageDestinationSetProperties(dest, [kCGImagePropertyGIFDictionary: [kCGImagePropertyGIFLoopCount: 0]] as CFDictionary)
        let frameProps = [kCGImagePropertyGIFDictionary: [kCGImagePropertyGIFDelayTime: 1.0 / fps]] as CFDictionary
        for i in 0..<count {
            if isCancelled { throw CancellationError() }
            let t = CMTime(seconds: Double(i) / fps, preferredTimescale: 600)
            if let img = try? gen.copyCGImage(at: t, actualTime: nil) {
                CGImageDestinationAddImage(dest, img, frameProps)
            }
            progress(Double(i) / Double(count))
        }
        guard CGImageDestinationFinalize(dest) else { throw StudioError.message("GIF konnte nicht gespeichert werden") }
        progress(1)
    }

    // MARK: Einzelbild

    static func exportFrame(project: Project, time: Double, url: URL) async throws {
        let size = renderSize(project: project, resolution: .p2160)
        let build = try await CompositionBuilder.build(project: project, renderSize: size)
        let gen = AVAssetImageGenerator(asset: build.composition)
        gen.videoComposition = build.videoComposition
        gen.requestedTimeToleranceBefore = .zero
        gen.requestedTimeToleranceAfter = .zero
        let t = CMTime(seconds: min(time, max(0, build.duration - 0.04)), preferredTimescale: 600)
        let cg = try gen.copyCGImage(at: t, actualTime: nil)
        let type: UTType = url.pathExtension.lowercased() == "jpg" || url.pathExtension.lowercased() == "jpeg" ? .jpeg : .png
        guard let dest = CGImageDestinationCreateWithURL(url as CFURL, type.identifier as CFString, 1, nil) else {
            throw StudioError.message("Bild konnte nicht gespeichert werden")
        }
        CGImageDestinationAddImage(dest, cg, nil)
        guard CGImageDestinationFinalize(dest) else { throw StudioError.message("Bild konnte nicht gespeichert werden") }
    }
}

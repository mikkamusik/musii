import Foundation
import AVFoundation
import AppKit
import ImageIO
import UniformTypeIdentifiers

// MARK: - Pfade

enum AppPaths {
    static var support: URL {
        let base = FileManager.default.urls(for: .applicationSupportDirectory, in: .userDomainMask).first
            ?? URL(fileURLWithPath: NSHomeDirectory()).appendingPathComponent("Library/Application Support")
        let dir = base.appendingPathComponent("Musii Studio", isDirectory: true)
        try? FileManager.default.createDirectory(at: dir, withIntermediateDirectories: true)
        return dir
    }

    static var projects: URL {
        let dir = support.appendingPathComponent("Projekte", isDirectory: true)
        try? FileManager.default.createDirectory(at: dir, withIntermediateDirectories: true)
        return dir
    }

    static func projectFolder(_ id: UUID) -> URL {
        let dir = projects.appendingPathComponent(id.uuidString, isDirectory: true)
        try? FileManager.default.createDirectory(at: dir, withIntermediateDirectories: true)
        return dir
    }

    static func generatedMedia(_ projectID: UUID) -> URL {
        let dir = projectFolder(projectID).appendingPathComponent("Medien", isDirectory: true)
        try? FileManager.default.createDirectory(at: dir, withIntermediateDirectories: true)
        return dir
    }
}

// MARK: - Import

enum MediaImporter {
    static let videoExtensions: Set<String> = ["mp4", "mov", "m4v", "avi", "mkv", "3gp", "mts", "m2ts", "webm", "hevc"]
    static let imageExtensions: Set<String> = ["jpg", "jpeg", "png", "heic", "heif", "gif", "tif", "tiff", "bmp", "webp"]
    static let audioExtensions: Set<String> = ["mp3", "m4a", "wav", "aif", "aiff", "aac", "caf", "flac", "ogg"]

    static var allowedTypes: [UTType] {
        [.movie, .video, .image, .audio, .mpeg4Movie, .quickTimeMovie, .mp3, .wav, .aiff, .png, .jpeg]
    }

    static func kind(for url: URL) -> MediaKind? {
        let ext = url.pathExtension.lowercased()
        if videoExtensions.contains(ext) { return .video }
        if imageExtensions.contains(ext) { return .image }
        if audioExtensions.contains(ext) { return .audio }
        if let t = UTType(filenameExtension: ext) {
            if t.conforms(to: .movie) || t.conforms(to: .video) { return .video }
            if t.conforms(to: .image) { return .image }
            if t.conforms(to: .audio) { return .audio }
        }
        return nil
    }

    static func orientation(from t: CGAffineTransform) -> UInt32 {
        let angle = atan2(Double(t.b), Double(t.a)) * 180 / Double.pi
        let a = Int((angle / 90).rounded()) * 90
        switch (a + 360) % 360 {
        case 90: return CGImagePropertyOrientation.right.rawValue
        case 180: return CGImagePropertyOrientation.down.rawValue
        case 270: return CGImagePropertyOrientation.left.rawValue
        default: return CGImagePropertyOrientation.up.rawValue
        }
    }

    static func load(_ url: URL, generated: Bool = false) async throws -> MediaItem {
        guard let kind = kind(for: url) else {
            throw StudioError.message("Dateityp wird nicht unterstützt: \(url.lastPathComponent)")
        }
        let name = url.deletingPathExtension().lastPathComponent
        switch kind {
        case .image:
            guard let src = CGImageSourceCreateWithURL(url as CFURL, nil),
                  let props = CGImageSourceCopyPropertiesAtIndex(src, 0, nil) as? [CFString: Any] else {
                throw StudioError.message("Bild konnte nicht gelesen werden: \(url.lastPathComponent)")
            }
            var w = (props[kCGImagePropertyPixelWidth] as? NSNumber)?.doubleValue ?? 1000
            var h = (props[kCGImagePropertyPixelHeight] as? NSNumber)?.doubleValue ?? 1000
            let o = (props[kCGImagePropertyOrientation] as? NSNumber)?.intValue ?? 1
            if o >= 5 { swap(&w, &h) }
            return MediaItem(name: name, path: url.path, kind: .image, duration: 0, width: w, height: h,
                             hasAudio: false, hasVideo: true, orientation: 1, generated: generated)
        case .video, .audio:
            let asset = AVURLAsset(url: url, options: [AVURLAssetPreferPreciseDurationAndTimingKey: true])
            let duration = try await asset.load(.duration).seconds
            let vtracks = try await asset.loadTracks(withMediaType: .video)
            let atracks = try await asset.loadTracks(withMediaType: .audio)
            if let v = vtracks.first {
                let size = try await v.load(.naturalSize)
                let tr = try await v.load(.preferredTransform)
                let fps = try await v.load(.nominalFrameRate)
                let o = orientation(from: tr)
                let rotated = o == CGImagePropertyOrientation.right.rawValue || o == CGImagePropertyOrientation.left.rawValue
                return MediaItem(name: name, path: url.path, kind: .video, duration: duration,
                                 width: Double(rotated ? size.height : size.width), height: Double(rotated ? size.width : size.height),
                                 hasAudio: !atracks.isEmpty, hasVideo: true, orientation: o, frameRate: Double(fps > 0 ? fps : 30), generated: generated)
            }
            guard !atracks.isEmpty else { throw StudioError.message("Keine Video- oder Audiospur: \(url.lastPathComponent)") }
            return MediaItem(name: name, path: url.path, kind: .audio, duration: duration, width: 0, height: 0,
                             hasAudio: true, hasVideo: false, generated: generated)
        }
    }
}

// MARK: - Vorschaubilder & Wellenform

final class ThumbStore: ObservableObject {
    static let shared = ThumbStore()

    @Published private(set) var strips: [UUID: [NSImage]] = [:]
    @Published private(set) var waves: [UUID: [Float]] = [:]
    private var pending = Set<UUID>()
    private let queue = DispatchQueue(label: "musii.thumbs", qos: .utility, attributes: .concurrent)

    static let stripCount = 24
    static let wavePerSecond = 40.0

    func poster(_ id: UUID) -> NSImage? { strips[id]?.first }

    func ensure(_ media: MediaItem) {
        guard !pending.contains(media.id), strips[media.id] == nil || (media.hasAudio && waves[media.id] == nil) else { return }
        guard media.exists else { return }
        pending.insert(media.id)
        queue.async {
            var images: [NSImage] = []
            if media.kind == .video {
                images = ThumbStore.videoStrip(media)
            } else if media.kind == .image {
                if let img = ThumbStore.imageThumb(media) { images = [img] }
            }
            let wave: [Float] = media.hasAudio ? ThumbStore.waveform(media) : []
            DispatchQueue.main.async {
                self.strips[media.id] = images
                if media.hasAudio { self.waves[media.id] = wave }
                self.pending.remove(media.id)
            }
        }
    }

    static func videoStrip(_ media: MediaItem) -> [NSImage] {
        let asset = AVURLAsset(url: media.url)
        let gen = AVAssetImageGenerator(asset: asset)
        gen.appliesPreferredTrackTransform = true
        gen.maximumSize = CGSize(width: 200, height: 200)
        gen.requestedTimeToleranceBefore = CMTime(seconds: 0.5, preferredTimescale: 600)
        gen.requestedTimeToleranceAfter = CMTime(seconds: 0.5, preferredTimescale: 600)
        var out: [NSImage] = []
        let n = stripCount
        for i in 0..<n {
            let t = media.duration * (Double(i) + 0.5) / Double(n)
            if let cg = try? gen.copyCGImage(at: CMTime(seconds: t, preferredTimescale: 600), actualTime: nil) {
                out.append(NSImage(cgImage: cg, size: NSSize(width: cg.width, height: cg.height)))
            } else if let last = out.last {
                out.append(last)
            }
        }
        return out
    }

    static func imageThumb(_ media: MediaItem) -> NSImage? {
        guard let src = CGImageSourceCreateWithURL(media.url as CFURL, nil) else { return nil }
        let opts: [CFString: Any] = [
            kCGImageSourceCreateThumbnailFromImageAlways: true,
            kCGImageSourceCreateThumbnailWithTransform: true,
            kCGImageSourceThumbnailMaxPixelSize: 240,
        ]
        guard let cg = CGImageSourceCreateThumbnailAtIndex(src, 0, opts as CFDictionary) else { return nil }
        return NSImage(cgImage: cg, size: NSSize(width: cg.width, height: cg.height))
    }

    static func waveform(_ media: MediaItem) -> [Float] {
        let asset = AVURLAsset(url: media.url)
        let sem = DispatchSemaphore(value: 0)
        var track: AVAssetTrack?
        Task {
            track = try? await asset.loadTracks(withMediaType: .audio).first
            sem.signal()
        }
        sem.wait()
        guard let t = track, let reader = try? AVAssetReader(asset: asset) else { return [] }
        let sampleRate = 8000.0
        let out = AVAssetReaderTrackOutput(track: t, outputSettings: [
            AVFormatIDKey: kAudioFormatLinearPCM,
            AVSampleRateKey: sampleRate,
            AVNumberOfChannelsKey: 1,
            AVLinearPCMBitDepthKey: 16,
            AVLinearPCMIsFloatKey: false,
            AVLinearPCMIsBigEndianKey: false,
            AVLinearPCMIsNonInterleaved: false,
        ])
        reader.add(out)
        guard reader.startReading() else { return [] }
        let bucket = max(1, Int(sampleRate / wavePerSecond))
        var peaks: [Float] = []
        var current: Int16 = 0
        var count = 0
        while let sb = out.copyNextSampleBuffer() {
            guard let block = CMSampleBufferGetDataBuffer(sb) else { continue }
            var length = 0
            var ptr: UnsafeMutablePointer<Int8>?
            CMBlockBufferGetDataPointer(block, atOffset: 0, lengthAtOffsetOut: nil, totalLengthOut: &length, dataPointerOut: &ptr)
            guard let p = ptr else { continue }
            let samples = length / 2
            p.withMemoryRebound(to: Int16.self, capacity: samples) { s in
                for i in 0..<samples {
                    let v = s[i] == Int16.min ? Int16.max : abs(s[i])
                    if v > current { current = v }
                    count += 1
                    if count >= bucket {
                        peaks.append(Float(current) / Float(Int16.max))
                        current = 0
                        count = 0
                    }
                }
            }
        }
        return peaks
    }
}

// MARK: - Bearbeitungswerkzeuge

enum MediaTools {
    /// Standbild eines Videos an einer Quellzeit als PNG speichern
    static func freezeFrame(media: MediaItem, sourceTime: Double, projectID: UUID) async throws -> URL {
        let asset = AVURLAsset(url: media.url)
        let gen = AVAssetImageGenerator(asset: asset)
        gen.appliesPreferredTrackTransform = true
        gen.requestedTimeToleranceBefore = .zero
        gen.requestedTimeToleranceAfter = .zero
        let cg = try gen.copyCGImage(at: CMTime(seconds: max(0, min(sourceTime, media.duration - 0.05)), preferredTimescale: 600), actualTime: nil)
        let url = AppPaths.generatedMedia(projectID).appendingPathComponent("Standbild-\(UUID().uuidString.prefix(8)).png")
        guard let dest = CGImageDestinationCreateWithURL(url as CFURL, UTType.png.identifier as CFString, 1, nil) else {
            throw StudioError.message("Standbild konnte nicht gespeichert werden")
        }
        CGImageDestinationAddImage(dest, cg, nil)
        guard CGImageDestinationFinalize(dest) else { throw StudioError.message("Standbild konnte nicht gespeichert werden") }
        return url
    }

    /// Audio eines Medienbereichs als M4A exportieren (z.B. für Spracherkennung)
    static func extractAudio(media: MediaItem, start: Double, duration: Double, to url: URL) async throws {
        let asset = AVURLAsset(url: media.url)
        guard let session = AVAssetExportSession(asset: asset, presetName: AVAssetExportPresetAppleM4A) else {
            throw StudioError.message("Audio konnte nicht extrahiert werden")
        }
        try? FileManager.default.removeItem(at: url)
        session.outputURL = url
        session.outputFileType = .m4a
        session.timeRange = CMTimeRange(start: CMTime(seconds: start, preferredTimescale: 600), duration: CMTime(seconds: duration, preferredTimescale: 600))
        await withCheckedContinuation { (c: CheckedContinuation<Void, Never>) in
            session.exportAsynchronously { c.resume() }
        }
        if session.status != .completed {
            throw session.error ?? StudioError.message("Audio-Export fehlgeschlagen")
        }
    }

    /// Video rückwärts abspielen: erzeugt eine neue Datei (Bild + Ton umgekehrt)
    static func reverse(media: MediaItem, projectID: UUID, progress: @escaping (Double) -> Void) async throws -> URL {
        let asset = AVURLAsset(url: media.url, options: [AVURLAssetPreferPreciseDurationAndTimingKey: true])
        guard let vTrack = try await asset.loadTracks(withMediaType: .video).first else {
            throw StudioError.message("Keine Videospur")
        }
        let aTrack = try await asset.loadTracks(withMediaType: .audio).first
        let duration = try await asset.load(.duration)
        let natural = try await vTrack.load(.naturalSize)
        let transform = try await vTrack.load(.preferredTransform)
        let fpsRaw = try await vTrack.load(.nominalFrameRate)
        let fps = Double(fpsRaw)
        let url = AppPaths.generatedMedia(projectID).appendingPathComponent("Rueckwaerts-\(UUID().uuidString.prefix(8)).mov")
        try? FileManager.default.removeItem(at: url)

        let writer = try AVAssetWriter(outputURL: url, fileType: .mov)
        let w = Int(natural.width) / 2 * 2, h = Int(natural.height) / 2 * 2
        let vIn = AVAssetWriterInput(mediaType: .video, outputSettings: [
            AVVideoCodecKey: AVVideoCodecType.h264,
            AVVideoWidthKey: w,
            AVVideoHeightKey: h,
            AVVideoCompressionPropertiesKey: [AVVideoAverageBitRateKey: max(4_000_000, w * h * 6)],
        ])
        vIn.transform = transform
        vIn.expectsMediaDataInRealTime = false
        let adaptor = AVAssetWriterInputPixelBufferAdaptor(assetWriterInput: vIn, sourcePixelBufferAttributes: nil)
        writer.add(vIn)

        // Audio vorbereiten (komplett lesen, umkehren)
        var reversedAudio: [Int16] = []
        let channels = 2
        let sampleRate = 44100.0
        var aIn: AVAssetWriterInput?
        if let at = aTrack {
            let reader = try AVAssetReader(asset: asset)
            let out = AVAssetReaderTrackOutput(track: at, outputSettings: [
                AVFormatIDKey: kAudioFormatLinearPCM, AVSampleRateKey: sampleRate, AVNumberOfChannelsKey: channels,
                AVLinearPCMBitDepthKey: 16, AVLinearPCMIsFloatKey: false, AVLinearPCMIsBigEndianKey: false, AVLinearPCMIsNonInterleaved: false,
            ])
            reader.add(out)
            if reader.startReading() {
                var samples: [Int16] = []
                while let sb = out.copyNextSampleBuffer() {
                    guard let block = CMSampleBufferGetDataBuffer(sb) else { continue }
                    let len = CMBlockBufferGetDataLength(block)
                    var chunk = [Int16](repeating: 0, count: len / 2)
                    chunk.withUnsafeMutableBytes { raw in
                        _ = CMBlockBufferCopyDataBytes(block, atOffset: 0, dataLength: len, destination: raw.baseAddress!)
                    }
                    samples.append(contentsOf: chunk)
                }
                let frames = samples.count / channels
                reversedAudio = [Int16](repeating: 0, count: frames * channels)
                for f in 0..<frames {
                    for c in 0..<channels {
                        reversedAudio[f * channels + c] = samples[(frames - 1 - f) * channels + c]
                    }
                }
            }
            if !reversedAudio.isEmpty {
                let i = AVAssetWriterInput(mediaType: .audio, outputSettings: [
                    AVFormatIDKey: kAudioFormatMPEG4AAC, AVSampleRateKey: sampleRate, AVNumberOfChannelsKey: channels, AVEncoderBitRateKey: 192_000,
                ])
                i.expectsMediaDataInRealTime = false
                writer.add(i)
                aIn = i
            }
        }

        var audioBuffers: [CMSampleBuffer] = []
        var audioIndex = 0
        if aIn != nil {
            let totalFrames = reversedAudio.count / channels
            var pos = 0
            while pos < totalFrames {
                let n = min(4096, totalFrames - pos)
                let slice = Array(reversedAudio[(pos * channels)..<((pos + n) * channels)])
                if let sb = pcmBuffer(samples: slice, channels: channels, sampleRate: sampleRate, startFrame: pos) { audioBuffers.append(sb) }
                pos += n
            }
            reversedAudio = []
        }

        guard writer.startWriting() else { throw writer.error ?? StudioError.message("Rückwärts fehlgeschlagen") }
        writer.startSession(atSourceTime: .zero)

        // Video in Blöcken von hinten nach vorne
        let total = duration.seconds
        let chunkLen = 0.5
        var chunkEnd = total
        var frameIndex: Int64 = 0
        let outFps = fps > 1 ? fps : 30
        while chunkEnd > 0.0001 {
            let chunkStart = max(0, chunkEnd - chunkLen)
            let reader = try AVAssetReader(asset: asset)
            reader.timeRange = CMTimeRange(start: CMTime(seconds: chunkStart, preferredTimescale: 600), end: CMTime(seconds: chunkEnd, preferredTimescale: 600))
            let out = AVAssetReaderTrackOutput(track: vTrack, outputSettings: [kCVPixelBufferPixelFormatTypeKey as String: kCVPixelFormatType_32BGRA])
            out.alwaysCopiesSampleData = true
            reader.add(out)
            guard reader.startReading() else { throw reader.error ?? StudioError.message("Lesen fehlgeschlagen") }
            var frames: [CVPixelBuffer] = []
            while let sb = out.copyNextSampleBuffer() {
                let pts = CMSampleBufferGetPresentationTimeStamp(sb).seconds
                if pts >= chunkStart - 0.0001 && pts < chunkEnd - 0.0001, let pb = CMSampleBufferGetImageBuffer(sb) {
                    frames.append(pb)
                }
            }
            for pb in frames.reversed() {
                var waited = 0
                while !vIn.isReadyForMoreMediaData {
                    // Bild und Ton müssen abwechselnd geschrieben werden
                    if let a = aIn, audioIndex < audioBuffers.count, a.isReadyForMoreMediaData {
                        a.append(audioBuffers[audioIndex])
                        audioIndex += 1
                        continue
                    }
                    waited += 1
                    if waited > 20_000 { throw StudioError.message("Rückwärts: Zeitüberschreitung beim Schreiben") }
                    try await Task.sleep(nanoseconds: 2_000_000)
                }
                let t = CMTime(value: frameIndex * 1000, timescale: CMTimeScale(outFps * 1000))
                adaptor.append(pb, withPresentationTime: t)
                frameIndex += 1
            }
            chunkEnd = chunkStart
            progress(min(0.95, 1 - chunkEnd / max(0.01, total)))
        }
        vIn.markAsFinished()

        if let i = aIn {
            var waited = 0
            while audioIndex < audioBuffers.count {
                if i.isReadyForMoreMediaData {
                    i.append(audioBuffers[audioIndex])
                    audioIndex += 1
                    waited = 0
                } else {
                    waited += 1
                    if waited > 20_000 { throw StudioError.message("Rückwärts: Zeitüberschreitung (Ton)") }
                    try await Task.sleep(nanoseconds: 2_000_000)
                }
            }
            i.markAsFinished()
        }

        await withCheckedContinuation { (c: CheckedContinuation<Void, Never>) in
            writer.finishWriting { c.resume() }
        }
        guard writer.status == .completed else { throw writer.error ?? StudioError.message("Rückwärts fehlgeschlagen") }
        progress(1)
        return url
    }

    /// Erzeugt einen PCM-Audio-Puffer (16 Bit, verschachtelt) für AVAssetWriter
    static func pcmBuffer(samples: [Int16], channels: Int, sampleRate: Double, startFrame: Int) -> CMSampleBuffer? {
        var asbd = AudioStreamBasicDescription(mSampleRate: sampleRate, mFormatID: kAudioFormatLinearPCM,
                                               mFormatFlags: kLinearPCMFormatFlagIsSignedInteger | kLinearPCMFormatFlagIsPacked,
                                               mBytesPerPacket: UInt32(2 * channels), mFramesPerPacket: 1, mBytesPerFrame: UInt32(2 * channels),
                                               mChannelsPerFrame: UInt32(channels), mBitsPerChannel: 16, mReserved: 0)
        var fmt: CMAudioFormatDescription?
        CMAudioFormatDescriptionCreate(allocator: kCFAllocatorDefault, asbd: &asbd, layoutSize: 0, layout: nil, magicCookieSize: 0,
                                       magicCookie: nil, extensions: nil, formatDescriptionOut: &fmt)
        guard let f = fmt, !samples.isEmpty else { return nil }
        let bytes = samples.count * 2
        var block: CMBlockBuffer?
        CMBlockBufferCreateWithMemoryBlock(allocator: kCFAllocatorDefault, memoryBlock: nil, blockLength: bytes, blockAllocator: kCFAllocatorDefault,
                                           customBlockSource: nil, offsetToData: 0, dataLength: bytes, flags: kCMBlockBufferAssureMemoryNowFlag, blockBufferOut: &block)
        guard let b = block else { return nil }
        samples.withUnsafeBytes { raw in
            _ = CMBlockBufferReplaceDataBytes(with: raw.baseAddress!, blockBuffer: b, offsetIntoDestination: 0, dataLength: bytes)
        }
        var sb: CMSampleBuffer?
        CMAudioSampleBufferCreateReadyWithPacketDescriptions(allocator: kCFAllocatorDefault, dataBuffer: b, formatDescription: f,
                                                             sampleCount: samples.count / channels,
                                                             presentationTimeStamp: CMTime(value: CMTimeValue(startFrame), timescale: CMTimeScale(sampleRate)),
                                                             packetDescriptions: nil, sampleBufferOut: &sb)
        return sb
    }

    /// Kopiert eine Datei in den Projektordner (für Aufnahmen etc.)
    static func uniqueURL(projectID: UUID, base: String, ext: String) -> URL {
        AppPaths.generatedMedia(projectID).appendingPathComponent("\(base)-\(UUID().uuidString.prefix(8)).\(ext)")
    }
}

import Foundation
import AVFoundation
import CoreVideo

// MARK: - Asset-Cache

struct LoadedAsset {
    let asset: AVURLAsset
    let video: AVAssetTrack?
    let videoRange: CMTimeRange
    let audio: AVAssetTrack?
    let audioRange: CMTimeRange
}

actor AssetCache {
    static let shared = AssetCache()
    private var store: [String: LoadedAsset] = [:]

    func load(_ url: URL) async -> LoadedAsset? {
        if let a = store[url.path] { return a }
        guard FileManager.default.fileExists(atPath: url.path) else { return nil }
        let asset = AVURLAsset(url: url, options: [AVURLAssetPreferPreciseDurationAndTimingKey: true])
        let v = try? await asset.loadTracks(withMediaType: .video).first
        let a = try? await asset.loadTracks(withMediaType: .audio).first
        var vr = CMTimeRange.zero, ar = CMTimeRange.zero
        if let v = v { vr = (try? await v.load(.timeRange)) ?? .zero }
        if let a = a { ar = (try? await a.load(.timeRange)) ?? .zero }
        let loaded = LoadedAsset(asset: asset, video: v, videoRange: vr, audio: a, audioRange: ar)
        store[url.path] = loaded
        return loaded
    }

    func forget(_ path: String) { store[path] = nil }
}

// MARK: - Schwarzes Basis-Video (garantiert Frames über die gesamte Projektdauer)

enum BlackVideo {
    static let chunkSeconds: Double = 2

    static var url: URL {
        AppPaths.support.appendingPathComponent("base_black_v1.mov")
    }

    static func ensure() async throws -> URL {
        let u = url
        if FileManager.default.fileExists(atPath: u.path) { return u }
        let tmp = AppPaths.support.appendingPathComponent("base_black_tmp.mov")
        try? FileManager.default.removeItem(at: tmp)
        let writer = try AVAssetWriter(outputURL: tmp, fileType: .mov)
        let settings: [String: Any] = [
            AVVideoCodecKey: AVVideoCodecType.h264,
            AVVideoWidthKey: 64,
            AVVideoHeightKey: 64,
        ]
        let input = AVAssetWriterInput(mediaType: .video, outputSettings: settings)
        input.expectsMediaDataInRealTime = false
        let adaptor = AVAssetWriterInputPixelBufferAdaptor(assetWriterInput: input, sourcePixelBufferAttributes: [
            kCVPixelBufferPixelFormatTypeKey as String: kCVPixelFormatType_32BGRA,
            kCVPixelBufferWidthKey as String: 64,
            kCVPixelBufferHeightKey as String: 64,
        ])
        writer.add(input)
        guard writer.startWriting() else { throw writer.error ?? StudioError.message("Basisvideo fehlgeschlagen") }
        writer.startSession(atSourceTime: .zero)
        let fps: Int32 = 30
        let frames = Int(chunkSeconds * Double(fps))
        var pb: CVPixelBuffer?
        CVPixelBufferCreate(kCFAllocatorDefault, 64, 64, kCVPixelFormatType_32BGRA, nil, &pb)
        if let pb = pb {
            CVPixelBufferLockBaseAddress(pb, [])
            if let base = CVPixelBufferGetBaseAddress(pb) {
                memset(base, 0, CVPixelBufferGetDataSize(pb))
                // Alpha = 255
                let bpr = CVPixelBufferGetBytesPerRow(pb)
                let p = base.assumingMemoryBound(to: UInt8.self)
                for y in 0..<64 { for x in 0..<64 { p[y * bpr + x * 4 + 3] = 255 } }
            }
            CVPixelBufferUnlockBaseAddress(pb, [])
        }
        for i in 0..<frames {
            while !input.isReadyForMoreMediaData { try await Task.sleep(nanoseconds: 2_000_000) }
            if let pb = pb {
                adaptor.append(pb, withPresentationTime: CMTime(value: CMTimeValue(i), timescale: fps))
            }
        }
        input.markAsFinished()
        await withCheckedContinuation { (c: CheckedContinuation<Void, Never>) in
            writer.finishWriting { c.resume() }
        }
        if writer.status != .completed { throw writer.error ?? StudioError.message("Basisvideo fehlgeschlagen") }
        try? FileManager.default.removeItem(at: u)
        try FileManager.default.moveItem(at: tmp, to: u)
        return u
    }
}

enum StudioError: LocalizedError {
    case message(String)
    var errorDescription: String? {
        switch self {
        case .message(let m): return m
        }
    }
}

// MARK: - Composition Builder

struct BuildOutput {
    let composition: AVMutableComposition
    let videoComposition: AVMutableVideoComposition
    let audioMix: AVMutableAudioMix
    let plan: RenderPlan
    let signature: String
    let duration: Double
    let hasAudio: Bool
}

enum CompositionBuilder {
    static let baseTrackID: CMPersistentTrackID = 1

    private struct VisualEntry {
        let clip: Clip
        let media: MediaItem
        let startTicks: Int64
        let endTicks: Int64
        let isMain: Bool
        let mainIndex: Int
    }

    private struct AudioEntry {
        let clip: Clip
        let media: MediaItem
        let startTicks: Int64
        let endTicks: Int64
        let crossIn: Double
        let crossOut: Double
    }

    private static func cm(_ ticks: Int64) -> CMTime { CMTime(value: ticks, timescale: CMTimeScale(TimeGrid.scale)) }

    /// Intervall-Färbung: weist jedem Eintrag eine Spur zu, so dass sich Clips einer Spur nicht überlappen.
    private static func allocate(_ ranges: [(Int64, Int64)]) -> [Int] {
        let order = ranges.indices.sorted { ranges[$0].0 < ranges[$1].0 || (ranges[$0].0 == ranges[$1].0 && $0 < $1) }
        var trackEnds: [Int64] = []
        var result = [Int](repeating: 0, count: ranges.count)
        for i in order {
            let (s, e) = ranges[i]
            if let k = trackEnds.firstIndex(where: { $0 <= s }) {
                result[i] = k
                trackEnds[k] = e
            } else {
                result[i] = trackEnds.count
                trackEnds.append(e)
            }
        }
        return result
    }

    private static func insert(_ clip: Clip, assetTrack: AVAssetTrack, assetRange: CMTimeRange,
                               into track: AVMutableCompositionTrack, end: inout CMTime, startTicks: Int64) throws {
        let at = cm(startTicks)
        var src = CMTimeRange(start: cm(TimeGrid.ticks(clip.sourceStart)), duration: cm(TimeGrid.ticks(clip.sourceDuration)))
        src = src.intersection(assetRange)
        guard src.duration.seconds > 0.002 else { return }
        if CMTimeCompare(at, end) > 0 {
            track.insertEmptyTimeRange(CMTimeRange(start: end, end: at))
        }
        let insertAt = CMTimeMaximum(at, end)
        try track.insertTimeRange(src, of: assetTrack, at: insertAt)
        var placed = src.duration
        if abs(clip.speed - 1) > 0.0005 {
            let target = cm(max(1, Int64((src.duration.seconds / clip.speed * Double(TimeGrid.scale)).rounded())))
            track.scaleTimeRange(CMTimeRange(start: insertAt, duration: src.duration), toDuration: target)
            placed = target
        }
        end = CMTimeAdd(insertAt, placed)
    }

    static func renderSize(for project: Project, maxLongSide: CGFloat?) -> CGSize {
        var s = project.canvasSize
        if let m = maxLongSide, max(s.width, s.height) > m {
            let f = m / max(s.width, s.height)
            s = CGSize(width: s.width * f, height: s.height * f)
        }
        return CGSize(width: max(16, (s.width / 2).rounded() * 2), height: max(16, (s.height / 2).rounded() * 2))
    }

    static func build(project: Project, renderSize: CGSize) async throws -> BuildOutput {
        let blackURL = try await BlackVideo.ensure()
        guard let black = await AssetCache.shared.load(blackURL), let blackTrack = black.video else {
            throw StudioError.message("Basisvideo konnte nicht geladen werden")
        }

        // Assets laden
        var loaded: [UUID: LoadedAsset] = [:]
        for m in project.media where m.kind != .image && m.exists {
            if let l = await AssetCache.shared.load(m.url) { loaded[m.id] = l }
        }

        let composition = AVMutableComposition()
        let slots = project.mainSlots
        var signatureParts: [String] = ["fps\(project.fps)", "rs\(Int(renderSize.width))x\(Int(renderSize.height))"]

        // Visuelle Einträge
        var visuals: [VisualEntry] = []
        for (i, c) in project.main.enumerated() {
            guard let m = project.mediaItem(c.mediaID), m.isVisual else { continue }
            let s = TimeGrid.ticks(slots[i].start), e = TimeGrid.ticks(slots[i].end)
            visuals.append(VisualEntry(clip: c, media: m, startTicks: s, endTicks: e, isMain: true, mainIndex: i))
        }
        for c in project.overlays {
            guard let m = project.mediaItem(c.mediaID), m.isVisual else { continue }
            let s = TimeGrid.ticks(c.start)
            visuals.append(VisualEntry(clip: c, media: m, startTicks: s, endTicks: s + TimeGrid.ticks(c.duration), isMain: false, mainIndex: -1))
        }

        var totalTicks: Int64 = TimeGrid.ticks(project.duration)
        for v in visuals { totalTicks = max(totalTicks, v.endTicks) }
        totalTicks = max(totalTicks, TimeGrid.ticks(0.5))

        // Basis-Spur
        guard let baseTrack = composition.addMutableTrack(withMediaType: .video, preferredTrackID: baseTrackID) else {
            throw StudioError.message("Spur konnte nicht angelegt werden")
        }
        let blackRange = black.videoRange
        let chunk = max(1, min(TimeGrid.ticks(BlackVideo.chunkSeconds), Int64(floor(blackRange.duration.seconds * Double(TimeGrid.scale)))))
        var pos: Int64 = 0
        while pos < totalTicks {
            let len = min(chunk, totalTicks - pos)
            let r = CMTimeRange(start: blackRange.start, duration: cm(len))
            try baseTrack.insertTimeRange(r, of: blackTrack, at: cm(pos))
            pos += len
        }
        signatureParts.append("base\(totalTicks)")

        // Video-Spuren zuteilen
        let videoEntries = visuals.indices.filter { visuals[$0].media.kind == .video && loaded[visuals[$0].media.id]?.video != nil }
        let vAlloc = allocate(videoEntries.map { (visuals[$0].startTicks, visuals[$0].endTicks) })
        var videoTracks: [AVMutableCompositionTrack] = []
        var videoEnds: [CMTime] = []
        var trackForVisual: [Int: CMPersistentTrackID] = [:]
        let vCount = (vAlloc.max() ?? -1) + 1
        for k in 0..<vCount {
            guard let t = composition.addMutableTrack(withMediaType: .video, preferredTrackID: CMPersistentTrackID(10 + k)) else { continue }
            videoTracks.append(t)
            videoEnds.append(.zero)
        }
        let vOrder = videoEntries.indices.sorted { visuals[videoEntries[$0]].startTicks < visuals[videoEntries[$1]].startTicks }
        for j in vOrder {
            let vi = videoEntries[j]
            let k = vAlloc[j]
            guard k < videoTracks.count, let la = loaded[visuals[vi].media.id], let vt = la.video else { continue }
            let entry = visuals[vi]
            try insert(entry.clip, assetTrack: vt, assetRange: la.videoRange, into: videoTracks[k], end: &videoEnds[k], startTicks: entry.startTicks)
            trackForVisual[vi] = videoTracks[k].trackID
            signatureParts.append("v\(k):\(entry.media.path)|\(TimeGrid.ticks(entry.clip.sourceStart))|\(TimeGrid.ticks(entry.clip.sourceDuration))|\(entry.clip.speed)|\(entry.startTicks)")
        }

        // Audio-Einträge
        var audios: [AudioEntry] = []
        for (i, c) in project.main.enumerated() {
            guard let m = project.mediaItem(c.mediaID), m.kind == .video, loaded[m.id]?.audio != nil else { continue }
            audios.append(AudioEntry(clip: c, media: m, startTicks: TimeGrid.ticks(slots[i].start), endTicks: TimeGrid.ticks(slots[i].end),
                                     crossIn: slots[i].transitionIn, crossOut: slots[i].transitionOut))
        }
        for c in project.overlays {
            guard let m = project.mediaItem(c.mediaID), m.kind == .video, loaded[m.id]?.audio != nil else { continue }
            let s = TimeGrid.ticks(c.start)
            audios.append(AudioEntry(clip: c, media: m, startTicks: s, endTicks: s + TimeGrid.ticks(c.duration), crossIn: 0, crossOut: 0))
        }
        for c in project.audio {
            guard let m = project.mediaItem(c.mediaID), loaded[m.id]?.audio != nil else { continue }
            let s = TimeGrid.ticks(c.start)
            audios.append(AudioEntry(clip: c, media: m, startTicks: s, endTicks: s + TimeGrid.ticks(c.duration), crossIn: 0, crossOut: 0))
        }
        let aAlloc = allocate(audios.map { ($0.startTicks, $0.endTicks) })
        var audioTracks: [AVMutableCompositionTrack] = []
        var audioEnds: [CMTime] = []
        let aCount = (aAlloc.max() ?? -1) + 1
        for k in 0..<aCount {
            guard let t = composition.addMutableTrack(withMediaType: .audio, preferredTrackID: CMPersistentTrackID(100 + k)) else { continue }
            audioTracks.append(t)
            audioEnds.append(.zero)
        }
        var mixParams: [Int: AVMutableAudioMixInputParameters] = [:]
        let aOrder = audios.indices.sorted { audios[$0].startTicks < audios[$1].startTicks }
        for i in aOrder {
            let k = aAlloc[i]
            guard k < audioTracks.count, let la = loaded[audios[i].media.id], let at = la.audio else { continue }
            let e = audios[i]
            let before = audioEnds[k]
            try insert(e.clip, assetTrack: at, assetRange: la.audioRange, into: audioTracks[k], end: &audioEnds[k], startTicks: e.startTicks)
            if CMTimeCompare(audioEnds[k], before) == 0 { continue }
            signatureParts.append("a\(k):\(e.media.path)|\(TimeGrid.ticks(e.clip.sourceStart))|\(TimeGrid.ticks(e.clip.sourceDuration))|\(e.clip.speed)|\(e.startTicks)")

            let params = mixParams[k] ?? {
                let p = AVMutableAudioMixInputParameters(track: audioTracks[k])
                p.audioTimePitchAlgorithm = .spectral
                return p
            }()
            mixParams[k] = params
            let vol = Float(e.clip.muted ? 0 : FXMath.clamp(e.clip.volume, 0, 1))
            let startT = cm(e.startTicks)
            let endT = audioEnds[k]
            let dur = max(0.01, endT.seconds - startT.seconds)
            var fi = max(e.clip.fadeIn, e.crossIn)
            var fo = max(e.clip.fadeOut, e.crossOut)
            if fi + fo > dur { let f = dur / (fi + fo); fi *= f; fo *= f }
            if fi > 0.01 {
                params.setVolumeRamp(fromStartVolume: 0, toEndVolume: vol, timeRange: CMTimeRange(start: startT, duration: CMTime(seconds: fi, preferredTimescale: 600)))
                params.setVolume(vol, at: CMTimeAdd(startT, CMTime(seconds: fi, preferredTimescale: 600)))
            } else {
                params.setVolume(vol, at: startT)
            }
            if fo > 0.01 {
                let fs = CMTimeSubtract(endT, CMTime(seconds: fo, preferredTimescale: 600))
                params.setVolumeRamp(fromStartVolume: vol, toEndVolume: 0, timeRange: CMTimeRange(start: fs, end: endT))
            }
        }
        for (k, t) in audioTracks.enumerated() where mixParams[k] == nil {
            composition.removeTrack(t)
        }
        let audioMix = AVMutableAudioMix()
        audioMix.inputParameters = mixParams.keys.sorted().compactMap { mixParams[$0] }

        // Render-Plan
        var planMain: [PlanClip] = []
        var planOverlays: [PlanClip] = []
        for (vi, v) in visuals.enumerated() {
            let tid = trackForVisual[vi]
            if v.media.kind == .video && tid == nil { continue }
            var trans: TransitionKind = .none
            if v.isMain, v.mainIndex >= 0, project.transitionTicks(after: v.mainIndex) > 0 {
                trans = v.clip.transition?.kind ?? .none
            }
            let pc = PlanClip(clip: v.clip, media: v.media, start: TimeGrid.seconds(v.startTicks), end: TimeGrid.seconds(v.endTicks), trackID: tid, transitionOut: trans)
            if v.isMain { planMain.append(pc) } else { planOverlays.append(pc) }
        }
        planOverlays.sort { ($0.clip.lane, $0.start) < ($1.clip.lane, $1.start) }
        let texts = project.texts.sorted { ($0.lane, $0.start) < ($1.lane, $1.start) }
        let effects = project.effects.sorted { ($0.lane, $0.start) < ($1.lane, $1.start) }
        let plan = RenderPlan(canvas: project.canvasSize, background: project.background, main: planMain, overlays: planOverlays,
                              texts: texts, effects: effects, duration: TimeGrid.seconds(totalTicks))

        // Video-Composition mit Segmenten
        var bounds = Set<Int64>([0, totalTicks])
        for v in visuals {
            bounds.insert(min(totalTicks, max(0, v.startTicks)))
            bounds.insert(min(totalTicks, max(0, v.endTicks)))
        }
        let sortedBounds = bounds.sorted()
        var instructions: [StudioInstruction] = []
        for i in 0..<(sortedBounds.count - 1) {
            let a = sortedBounds[i], b = sortedBounds[i + 1]
            guard b > a else { continue }
            var ids: [CMPersistentTrackID] = [baseTrackID]
            for (vi, v) in visuals.enumerated() where v.startTicks < b && v.endTicks > a {
                if let tid = trackForVisual[vi], !ids.contains(tid) { ids.append(tid) }
            }
            instructions.append(StudioInstruction(timeRange: CMTimeRange(start: cm(a), end: cm(b)), trackIDs: ids, plan: plan))
        }
        let vc = AVMutableVideoComposition()
        vc.customVideoCompositorClass = StudioCompositor.self
        vc.frameDuration = CMTime(value: 1, timescale: CMTimeScale(max(1, project.fps)))
        vc.renderSize = renderSize
        vc.instructions = instructions

        return BuildOutput(composition: composition, videoComposition: vc, audioMix: audioMix, plan: plan,
                           signature: signatureParts.joined(separator: ";"), duration: TimeGrid.seconds(totalTicks),
                           hasAudio: !mixParams.isEmpty)
    }
}

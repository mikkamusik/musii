import Foundation
import AVFoundation
import SwiftUI
import AppKit

enum Selection: Equatable {
    case main(UUID), overlay(UUID), audio(UUID), text(UUID), effect(UUID)

    var id: UUID {
        switch self {
        case .main(let i), .overlay(let i), .audio(let i), .text(let i), .effect(let i): return i
        }
    }
}

enum LeftTab: String, CaseIterable, Identifiable {
    case media, audio, text, stickers, effects, transitions, filters, captions
    var id: String { rawValue }
    var title: String {
        switch self {
        case .media: return "Medien"
        case .audio: return "Audio"
        case .text: return "Text"
        case .stickers: return "Sticker"
        case .effects: return "Effekte"
        case .transitions: return "Übergänge"
        case .filters: return "Filter"
        case .captions: return "Untertitel"
        }
    }
    var symbol: String {
        switch self {
        case .media: return "photo.on.rectangle"
        case .audio: return "music.note"
        case .text: return "textformat"
        case .stickers: return "face.smiling"
        case .effects: return "sparkles"
        case .transitions: return "arrow.left.arrow.right"
        case .filters: return "camera.filters"
        case .captions: return "captions.bubble"
        }
    }
}

enum PreviewQuality: String, CaseIterable, Identifiable {
    case low, medium, high, full
    var id: String { rawValue }
    var title: String {
        switch self {
        case .low: return "Niedrig"
        case .medium: return "Mittel"
        case .high: return "Hoch"
        case .full: return "Voll"
        }
    }
    var longSide: CGFloat? {
        switch self {
        case .low: return 640
        case .medium: return 960
        case .high: return 1280
        case .full: return nil
        }
    }
}

struct BusyInfo: Equatable {
    var title: String
    var progress: Double?
}

final class PlaybackClock: ObservableObject {
    @Published var time: Double = 0
}

final class EditorState: ObservableObject {
    @Published var project: Project {
        didSet { if project != oldValue { projectDidChange() } }
    }
    @Published var selection: Selection?
    @Published var leftTab: LeftTab = .media
    @Published var pps: Double = 80
    @Published var isPlaying = false
    @Published var busy: BusyInfo?
    @Published var errorMessage: String?
    @Published var infoMessage: String?
    @Published var showExport = false
    @Published var previewQuality: PreviewQuality = .medium {
        didSet { currentSignature = nil; scheduleRebuild(delay: 0) }
    }
    @Published var snapping = true
    @Published var duration: Double = 0
    @Published var canUndo = false
    @Published var canRedo = false
    @Published var isRecordingVoice = false

    let clock = PlaybackClock()
    let player = AVPlayer()
    let recorder = VoiceRecorder()

    private var undoStack: [Project] = []
    private var redoStack: [Project] = []
    private var lastUndoKey: String?
    private var lastUndoTime = Date.distantPast
    private var rebuildWork: DispatchWorkItem?
    private var saveWork: DispatchWorkItem?
    private var buildGeneration = 0
    private var currentSignature: String?
    private var timeObserver: Any?
    private var statusObservation: NSKeyValueObservation?
    private var endObserver: NSObjectProtocol?
    private var isSeeking = false
    private var pendingSeek: Double?
    private var recordStart: Double = 0
    private(set) var plan: RenderPlan?

    init(project: Project) {
        self.project = project
        player.actionAtItemEnd = .pause
        timeObserver = player.addPeriodicTimeObserver(forInterval: CMTime(value: 1, timescale: 30), queue: .main) { [weak self] t in
            guard let self = self, self.isPlaying else { return }
            self.clock.time = t.seconds
        }
        for m in project.media { ThumbStore.shared.ensure(m) }
        scheduleRebuild(delay: 0)
    }

    deinit {
        if let o = timeObserver { player.removeTimeObserver(o) }
        if let e = endObserver { NotificationCenter.default.removeObserver(e) }
    }

    // MARK: - Änderungen & Undo

    func update(_ key: String? = nil, _ change: (inout Project) -> Void) {
        var p = project
        change(&p)
        guard p != project else { return }
        let now = Date()
        if key == nil || key != lastUndoKey || now.timeIntervalSince(lastUndoTime) > 1.2 {
            undoStack.append(project)
            if undoStack.count > 150 { undoStack.removeFirst() }
        }
        lastUndoKey = key
        lastUndoTime = now
        redoStack.removeAll()
        project = p
        canUndo = !undoStack.isEmpty
        canRedo = false
    }

    func undo() {
        guard let prev = undoStack.popLast() else { return }
        redoStack.append(project)
        lastUndoKey = nil
        project = prev
        canUndo = !undoStack.isEmpty
        canRedo = true
        validateSelection()
    }

    func redo() {
        guard let next = redoStack.popLast() else { return }
        undoStack.append(project)
        lastUndoKey = nil
        project = next
        canUndo = true
        canRedo = !redoStack.isEmpty
        validateSelection()
    }

    private func validateSelection() {
        guard let s = selection else { return }
        let exists: Bool
        switch s {
        case .main(let id): exists = project.main.contains { $0.id == id }
        case .overlay(let id): exists = project.overlays.contains { $0.id == id }
        case .audio(let id): exists = project.audio.contains { $0.id == id }
        case .text(let id): exists = project.texts.contains { $0.id == id }
        case .effect(let id): exists = project.effects.contains { $0.id == id }
        }
        if !exists { selection = nil }
    }

    private func projectDidChange() {
        scheduleRebuild(delay: 0.06)
        scheduleSave()
    }

    private func scheduleSave() {
        saveWork?.cancel()
        let w = DispatchWorkItem { [weak self] in
            guard let self = self else { return }
            ProjectStore.shared.save(self.project)
        }
        saveWork = w
        DispatchQueue.main.asyncAfter(deadline: .now() + 0.8, execute: w)
    }

    func saveNow() {
        saveWork?.cancel()
        ProjectStore.shared.save(project)
    }

    // MARK: - Wiedergabe

    var previewSize: CGSize { CompositionBuilder.renderSize(for: project, maxLongSide: previewQuality.longSide) }

    func scheduleRebuild(delay: Double) {
        rebuildWork?.cancel()
        let w = DispatchWorkItem { [weak self] in self?.rebuild() }
        rebuildWork = w
        DispatchQueue.main.asyncAfter(deadline: .now() + delay, execute: w)
    }

    private func rebuild() {
        buildGeneration += 1
        let gen = buildGeneration
        let p = project
        let size = previewSize
        Task {
            do {
                let out = try await CompositionBuilder.build(project: p, renderSize: size)
                await MainActor.run { self.apply(out, generation: gen) }
            } catch {
                await MainActor.run { self.errorMessage = "Vorschau konnte nicht erstellt werden: \(error.localizedDescription)" }
            }
        }
    }

    private func apply(_ out: BuildOutput, generation: Int) {
        guard generation == buildGeneration else { return }
        duration = out.duration
        plan = out.plan
        if let item = player.currentItem, out.signature == currentSignature {
            item.videoComposition = out.videoComposition
            item.audioMix = out.audioMix
            if !isPlaying { seek(to: clock.time) }
            return
        }
        let wasPlaying = isPlaying
        if wasPlaying { player.pause() }
        let item = AVPlayerItem(asset: out.composition)
        item.videoComposition = out.videoComposition
        item.audioMix = out.audioMix
        item.audioTimePitchAlgorithm = .spectral
        item.seekingWaitsForVideoCompositionRendering = true
        currentSignature = out.signature
        statusObservation = item.observe(\.status, options: [.new]) { [weak self] it, _ in
            DispatchQueue.main.async {
                guard let self = self else { return }
                if it.status == .readyToPlay {
                    self.performSeekIfNeeded()
                    if wasPlaying && self.isPlaying { self.player.play() }
                } else if it.status == .failed {
                    self.errorMessage = "Wiedergabefehler: \(it.error?.localizedDescription ?? "unbekannt")"
                }
            }
        }
        if let e = endObserver { NotificationCenter.default.removeObserver(e) }
        endObserver = NotificationCenter.default.addObserver(forName: AVPlayerItem.didPlayToEndTimeNotification, object: item, queue: .main) { [weak self] _ in
            guard let self = self else { return }
            self.isPlaying = false
            self.clock.time = self.duration
        }
        pendingSeek = min(clock.time, max(0, out.duration - 0.001))
        isSeeking = false
        player.replaceCurrentItem(with: item)
    }

    func seek(to t: Double) {
        let target = max(0, min(t, max(0, duration - 0.001)))
        clock.time = target
        pendingSeek = target
        performSeekIfNeeded()
    }

    private func performSeekIfNeeded() {
        guard !isSeeking, let target = pendingSeek, let item = player.currentItem, item.status == .readyToPlay else { return }
        pendingSeek = nil
        isSeeking = true
        player.seek(to: CMTime(seconds: target, preferredTimescale: 600), toleranceBefore: .zero, toleranceAfter: .zero) { [weak self] _ in
            DispatchQueue.main.async {
                self?.isSeeking = false
                self?.performSeekIfNeeded()
            }
        }
    }

    func togglePlay() {
        if isPlaying { pause() } else { play() }
    }

    func play() {
        guard player.currentItem != nil, duration > 0 else { return }
        if clock.time >= duration - 0.05 { seek(to: 0) }
        isPlaying = true
        player.play()
    }

    func pause() {
        player.pause()
        isPlaying = false
        let t = player.currentTime().seconds
        if t.isFinite { clock.time = t }
    }

    func step(frames: Int) {
        pause()
        seek(to: clock.time + Double(frames) / Double(max(1, project.fps)))
    }

    func jumpToStart() { pause(); seek(to: 0) }
    func jumpToEnd() { pause(); seek(to: duration) }

    // MARK: - Abfragen

    var mainSlots: [MainSlot] { project.mainSlots }

    func clip(_ id: UUID) -> Clip? {
        project.main.first { $0.id == id } ?? project.overlays.first { $0.id == id } ?? project.audio.first { $0.id == id }
    }

    func text(_ id: UUID) -> TextClip? { project.texts.first { $0.id == id } }
    func effect(_ id: UUID) -> EffectClip? { project.effects.first { $0.id == id } }

    /// Startzeit eines Clips auf der Timeline (Hauptspur berücksichtigt)
    func timelineStart(of id: UUID) -> Double? {
        if let i = project.mainIndex(of: id) { return mainSlots[i].start }
        if let c = project.overlays.first(where: { $0.id == id }) { return c.start }
        if let c = project.audio.first(where: { $0.id == id }) { return c.start }
        if let t = text(id) { return t.start }
        if let e = effect(id) { return e.start }
        return nil
    }

    func timelineRange(of id: UUID) -> (Double, Double)? {
        if let i = project.mainIndex(of: id) { return (mainSlots[i].start, mainSlots[i].end) }
        if let c = project.overlays.first(where: { $0.id == id }) ?? project.audio.first(where: { $0.id == id }) { return (c.start, c.end) }
        if let t = text(id) { return (t.start, t.end) }
        if let e = effect(id) { return (e.start, e.end) }
        return nil
    }

    func maxSourceDuration(_ media: MediaItem) -> Double {
        media.kind == .image ? 3600 * 4 : media.duration
    }

    var selectedClip: Clip? {
        switch selection {
        case .main(let id)?, .overlay(let id)?, .audio(let id)?: return clip(id)
        default: return nil
        }
    }

    var selectedMedia: MediaItem? {
        guard let c = selectedClip else { return nil }
        return project.mediaItem(c.mediaID)
    }

    // MARK: - Clip-Bearbeitung (generisch)

    func modifyClip(_ id: UUID, key: String? = nil, _ f: (inout Clip) -> Void) {
        update(key) { p in
            if let i = p.main.firstIndex(where: { $0.id == id }) { f(&p.main[i]) }
            else if let i = p.overlays.firstIndex(where: { $0.id == id }) { f(&p.overlays[i]) }
            else if let i = p.audio.firstIndex(where: { $0.id == id }) { f(&p.audio[i]) }
        }
    }

    func modifyText(_ id: UUID, key: String? = nil, _ f: (inout TextClip) -> Void) {
        update(key) { p in
            if let i = p.texts.firstIndex(where: { $0.id == id }) { f(&p.texts[i]) }
        }
    }

    func modifyEffect(_ id: UUID, key: String? = nil, _ f: (inout EffectClip) -> Void) {
        update(key) { p in
            if let i = p.effects.firstIndex(where: { $0.id == id }) { f(&p.effects[i]) }
        }
    }

    func clipBinding<T>(_ id: UUID, _ kp: WritableKeyPath<Clip, T>, fallback: T) -> Binding<T> {
        Binding(get: { [weak self] in self?.clip(id)?[keyPath: kp] ?? fallback },
                set: { [weak self] v in self?.modifyClip(id, key: "clip\(id)\(kp)") { $0[keyPath: kp] = v } })
    }

    func textBinding<T>(_ id: UUID, _ kp: WritableKeyPath<TextClip, T>, fallback: T) -> Binding<T> {
        Binding(get: { [weak self] in self?.text(id)?[keyPath: kp] ?? fallback },
                set: { [weak self] v in self?.modifyText(id, key: "text\(id)\(kp)") { $0[keyPath: kp] = v } })
    }

    func effectBinding<T>(_ id: UUID, _ kp: WritableKeyPath<EffectClip, T>, fallback: T) -> Binding<T> {
        Binding(get: { [weak self] in self?.effect(id)?[keyPath: kp] ?? fallback },
                set: { [weak self] v in self?.modifyEffect(id, key: "fx\(id)\(kp)") { $0[keyPath: kp] = v } })
    }

    func projectBinding<T>(_ kp: WritableKeyPath<Project, T>) -> Binding<T> {
        Binding(get: { [unowned self] in self.project[keyPath: kp] },
                set: { [unowned self] v in self.update("project\(kp)") { $0[keyPath: kp] = v } })
    }

    // MARK: - Transformation mit Keyframes

    private func localTime(_ id: UUID) -> Double {
        clock.time - (timelineStart(of: id) ?? 0)
    }

    func currentTransform(_ id: UUID) -> Transform2D {
        if let c = clip(id) { return KeyframeMath.transform(base: c.transform, keyframes: c.keyframes, at: localTime(id)) }
        if let t = text(id) { return KeyframeMath.transform(base: t.transform, keyframes: t.keyframes, at: localTime(id)) }
        return Transform2D()
    }

    func setTransform(_ id: UUID, key: String, _ f: (inout Transform2D) -> Void) {
        var tr = currentTransform(id)
        f(&tr)
        let local = localTime(id)
        func apply(_ base: inout Transform2D, _ kfs: inout [Keyframe]) {
            if kfs.isEmpty {
                base = tr
            } else if let i = kfs.firstIndex(where: { abs($0.time - local) < 0.04 }) {
                kfs[i].transform = tr
            } else {
                kfs.append(Keyframe(time: local, transform: tr))
                kfs.sort { $0.time < $1.time }
            }
        }
        if clip(id) != nil {
            modifyClip(id, key: key) { apply(&$0.transform, &$0.keyframes) }
        } else if text(id) != nil {
            modifyText(id, key: key) { apply(&$0.transform, &$0.keyframes) }
        }
    }

    func transformBinding(_ id: UUID, _ kp: WritableKeyPath<Transform2D, Double>) -> Binding<Double> {
        Binding(get: { [weak self] in self?.currentTransform(id)[keyPath: kp] ?? 0 },
                set: { [weak self] v in self?.setTransform(id, key: "tr\(id)\(kp)") { $0[keyPath: kp] = v } })
    }

    func hasKeyframe(_ id: UUID) -> Bool {
        let local = localTime(id)
        let kfs = clip(id)?.keyframes ?? text(id)?.keyframes ?? []
        return kfs.contains { abs($0.time - local) < 0.04 }
    }

    func keyframes(_ id: UUID) -> [Keyframe] { clip(id)?.keyframes ?? text(id)?.keyframes ?? [] }

    func toggleKeyframe(_ id: UUID) {
        let local = localTime(id)
        let tr = currentTransform(id)
        func toggle(_ kfs: inout [Keyframe]) {
            if let i = kfs.firstIndex(where: { abs($0.time - local) < 0.04 }) {
                kfs.remove(at: i)
            } else {
                kfs.append(Keyframe(time: max(0, local), transform: tr))
                kfs.sort { $0.time < $1.time }
            }
        }
        if clip(id) != nil { modifyClip(id) { toggle(&$0.keyframes) } }
        else if text(id) != nil { modifyText(id) { toggle(&$0.keyframes) } }
    }

    func clearKeyframes(_ id: UUID) {
        let tr = currentTransform(id)
        if clip(id) != nil { modifyClip(id) { $0.keyframes = []; $0.transform = tr } }
        else if text(id) != nil { modifyText(id) { $0.keyframes = []; $0.transform = tr } }
    }

    // MARK: - Spuren

    func freeLane<T>(_ items: [T], start: Double, end: Double, lane: (T) -> Int, range: (T) -> (Double, Double)) -> Int {
        var l = 0
        while items.contains(where: { lane($0) == l && range($0).0 < end - 0.001 && range($0).1 > start + 0.001 }) { l += 1 }
        return l
    }

    func overlayLaneCount() -> Int { (project.overlays.map { $0.lane }.max() ?? -1) + 1 }
    func audioLaneCount() -> Int { (project.audio.map { $0.lane }.max() ?? -1) + 1 }
    func textLaneCount() -> Int { (project.texts.map { $0.lane }.max() ?? -1) + 1 }
    func effectLaneCount() -> Int { (project.effects.map { $0.lane }.max() ?? -1) + 1 }

    // MARK: - Import & Hinzufügen

    func importMedia(_ urls: [URL], addToTimeline: Bool) {
        guard !urls.isEmpty else { return }
        busy = BusyInfo(title: "Medien werden importiert …", progress: 0)
        Task {
            var items: [MediaItem] = []
            var failed: [String] = []
            for (i, u) in urls.enumerated() {
                do {
                    let m = try await MediaImporter.load(u)
                    items.append(m)
                } catch {
                    failed.append(u.lastPathComponent)
                }
                let p = Double(i + 1) / Double(urls.count)
                await MainActor.run { self.busy?.progress = p }
            }
            await MainActor.run {
                self.busy = nil
                self.addImported(items, addToTimeline: addToTimeline)
                if !failed.isEmpty {
                    self.errorMessage = "Diese Dateien konnten nicht geladen werden:\n" + failed.joined(separator: "\n")
                }
            }
        }
    }

    private func addImported(_ items: [MediaItem], addToTimeline: Bool) {
        guard !items.isEmpty else { return }
        update { p in
            for m in items where !p.media.contains(where: { $0.path == m.path }) { p.media.append(m) }
        }
        for m in items { ThumbStore.shared.ensure(m) }
        if addToTimeline {
            for m in items {
                let existing = project.media.first { $0.path == m.path } ?? m
                addToTimelineAuto(existing)
            }
        }
        // Seitenverhältnis automatisch beim ersten Clip
        if project.main.count == items.count, let first = items.first(where: { $0.isVisual }), first.width > 0, first.height > 0 {
            let r = first.width / first.height
            let best = AspectPreset.allCases.min { abs($0.canvas.width / $0.canvas.height - r) < abs($1.canvas.width / $1.canvas.height - r) }
            if let b = best, b != project.aspect, abs(b.canvas.width / b.canvas.height - r) < 0.05 {
                update { $0.aspect = b }
            }
        }
    }

    func addToTimelineAuto(_ m: MediaItem) {
        if m.isVisual { addToMain(m) } else { addAudio(m, at: clock.time) }
    }

    func newClip(for m: MediaItem) -> Clip {
        let dur = m.kind == .image ? 4.0 : max(0.1, m.duration)
        return Clip(mediaID: m.id, sourceStart: 0, sourceDuration: dur, name: m.name)
    }

    func addToMain(_ m: MediaItem) {
        let c = newClip(for: m)
        let slots = mainSlots
        var insertIndex = project.main.count
        if let i = slots.firstIndex(where: { clock.time >= $0.start && clock.time < $0.end }), !slots.isEmpty {
            insertIndex = i + 1
        }
        update { p in p.main.insert(c, at: min(insertIndex, p.main.count)) }
        selection = .main(c.id)
    }

    func addOverlay(_ m: MediaItem) {
        guard m.isVisual else { return }
        var c = newClip(for: m)
        c.start = clock.time
        c.transform.scale = 0.6
        c.lane = freeLane(project.overlays, start: c.start, end: c.end, lane: { $0.lane }, range: { ($0.start, $0.end) })
        update { $0.overlays.append(c) }
        selection = .overlay(c.id)
    }

    func addAudio(_ m: MediaItem, at time: Double) {
        guard m.hasAudio else { return }
        var c = newClip(for: m)
        c.start = time
        c.lane = freeLane(project.audio, start: c.start, end: c.end, lane: { $0.lane }, range: { ($0.start, $0.end) })
        update { $0.audio.append(c) }
        selection = .audio(c.id)
    }

    func addText(style: TextStyle, text: String = "Text eingeben", kind: TextKind = .text, duration: Double = 3, y: Double = 0.5) {
        var t = TextClip(kind: kind, text: text, style: style, start: clock.time, duration: duration)
        t.transform.y = y
        t.lane = freeLane(project.texts, start: t.start, end: t.end, lane: { $0.lane }, range: { ($0.start, $0.end) })
        update { $0.texts.append(t) }
        selection = .text(t.id)
    }

    func addEmoji(_ e: String) {
        var s = TextStyle()
        s.fontSize = 160
        s.bold = false
        addText(style: s, text: e, kind: .emoji)
    }

    func addSymbol(_ name: String) {
        var s = TextStyle()
        s.fontSize = 110
        s.color = .white
        addText(style: s, text: name, kind: .symbol)
    }

    func addEffectLayer(_ kind: EffectKind) {
        var e = EffectClip(kind: kind, start: clock.time)
        e.lane = freeLane(project.effects, start: e.start, end: e.end, lane: { $0.lane }, range: { ($0.start, $0.end) })
        update { $0.effects.append(e) }
        selection = .effect(e.id)
    }

    func addEffectToSelectedClip(_ kind: EffectKind) {
        guard let c = selectedClip, project.mediaItem(c.mediaID)?.isVisual == true else {
            infoMessage = "Wähle zuerst einen Video- oder Bild-Clip aus."
            return
        }
        modifyClip(c.id) { $0.effects.append(EffectSetting(kind: kind)) }
    }

    func applyFilter(_ preset: String, toAll: Bool = false) {
        if toAll {
            update { p in for i in p.main.indices { p.main[i].filter.preset = preset } }
            return
        }
        guard let c = selectedClip, project.mediaItem(c.mediaID)?.isVisual == true else {
            infoMessage = "Wähle zuerst einen Video- oder Bild-Clip aus (oder „Auf alle anwenden“)."
            return
        }
        modifyClip(c.id) { $0.filter.preset = preset; if $0.filter.intensity < 0.05 { $0.filter.intensity = 1 } }
    }

    /// Übergang nach dem ausgewählten Hauptspur-Clip (oder dem Clip unter dem Abspielkopf)
    func applyTransition(_ kind: TransitionKind, toAll: Bool = false) {
        if toAll {
            update { p in
                for i in 0..<max(0, p.main.count - 1) {
                    p.main[i].transition = kind == .none ? nil : TransitionSetting(kind: kind, duration: p.main[i].transition?.duration ?? 0.6)
                }
            }
            return
        }
        var index: Int?
        if case .main(let id)? = selection { index = project.mainIndex(of: id) }
        if index == nil { index = mainSlots.firstIndex { clock.time >= $0.start && clock.time < $0.end } }
        guard var i = index, project.main.count > 1 else {
            infoMessage = "Übergänge brauchen mindestens zwei Clips auf der Hauptspur."
            return
        }
        if i >= project.main.count - 1 { i = project.main.count - 2 }
        update { p in
            p.main[i].transition = kind == .none ? nil : TransitionSetting(kind: kind, duration: p.main[i].transition?.duration ?? 0.6)
        }
        selection = .main(project.main[i].id)
    }

    // MARK: - Teilen, Löschen, Duplizieren

    func splitAtPlayhead() {
        let t = clock.time
        var target = selection
        if target == nil, let i = mainSlots.firstIndex(where: { t > $0.start + 0.05 && t < $0.end - 0.05 }) {
            target = .main(project.main[i].id)
        }
        guard let sel = target else { return }
        switch sel {
        case .main(let id):
            guard let i = project.mainIndex(of: id) else { return }
            let slot = mainSlots[i]
            guard t > slot.start + 0.05, t < slot.end - 0.05 else { return }
            let offset = (t - slot.start) * project.main[i].speed
            var a = project.main[i], b = project.main[i]
            b.id = UUID()
            a.sourceDuration = offset
            b.sourceStart += offset
            b.sourceDuration -= offset
            b.transition = a.transition
            a.transition = nil
            a.fadeOut = 0; a.animOut = AnimSetting()
            b.fadeIn = 0; b.animIn = AnimSetting()
            splitKeyframes(&a.keyframes, &b.keyframes, at: t - slot.start)
            update { p in p.main[i] = a; p.main.insert(b, at: i + 1) }
            selection = .main(b.id)
        case .overlay(let id), .audio(let id):
            let isOverlay: Bool
            if case .overlay = sel { isOverlay = true } else { isOverlay = false }
            guard let c = clip(id), t > c.start + 0.05, t < c.end - 0.05 else { return }
            let offset = (t - c.start) * c.speed
            var a = c, b = c
            b.id = UUID()
            a.sourceDuration = offset
            b.sourceStart += offset
            b.sourceDuration -= offset
            b.start = t
            a.fadeOut = 0; b.fadeIn = 0
            splitKeyframes(&a.keyframes, &b.keyframes, at: t - c.start)
            update { p in
                if isOverlay {
                    if let i = p.overlays.firstIndex(where: { $0.id == id }) { p.overlays[i] = a; p.overlays.append(b) }
                } else {
                    if let i = p.audio.firstIndex(where: { $0.id == id }) { p.audio[i] = a; p.audio.append(b) }
                }
            }
            selection = isOverlay ? .overlay(b.id) : .audio(b.id)
        case .text(let id):
            guard let x = text(id), t > x.start + 0.05, t < x.end - 0.05 else { return }
            var a = x, b = x
            b.id = UUID()
            a.duration = t - x.start
            b.start = t
            b.duration = x.end - t
            splitKeyframes(&a.keyframes, &b.keyframes, at: t - x.start)
            update { p in
                if let i = p.texts.firstIndex(where: { $0.id == id }) { p.texts[i] = a; p.texts.append(b) }
            }
            selection = .text(b.id)
        case .effect(let id):
            guard let x = effect(id), t > x.start + 0.05, t < x.end - 0.05 else { return }
            var a = x, b = x
            b.id = UUID()
            a.duration = t - x.start
            b.start = t
            b.duration = x.end - t
            update { p in
                if let i = p.effects.firstIndex(where: { $0.id == id }) { p.effects[i] = a; p.effects.append(b) }
            }
            selection = .effect(b.id)
        }
    }

    private func splitKeyframes(_ a: inout [Keyframe], _ b: inout [Keyframe], at local: Double) {
        guard !a.isEmpty else { return }
        let all = a
        let mid = KeyframeMath.transform(base: Transform2D(), keyframes: all, at: local)
        a = all.filter { $0.time < local } + [Keyframe(time: local, transform: mid)]
        b = [Keyframe(time: 0, transform: mid)] + all.filter { $0.time > local }.map { Keyframe(time: $0.time - local, transform: $0.transform) }
    }

    func deleteSelection() {
        guard let sel = selection else { return }
        update { p in
            switch sel {
            case .main(let id): p.main.removeAll { $0.id == id }
            case .overlay(let id): p.overlays.removeAll { $0.id == id }
            case .audio(let id): p.audio.removeAll { $0.id == id }
            case .text(let id): p.texts.removeAll { $0.id == id }
            case .effect(let id): p.effects.removeAll { $0.id == id }
            }
        }
        selection = nil
    }

    func duplicateSelection() {
        guard let sel = selection else { return }
        switch sel {
        case .main(let id):
            guard let i = project.mainIndex(of: id) else { return }
            var c = project.main[i]; c.id = UUID()
            update { $0.main.insert(c, at: i + 1) }
            selection = .main(c.id)
        case .overlay(let id):
            guard var c = clip(id) else { return }
            c.id = UUID(); c.start = c.end
            c.lane = freeLane(project.overlays, start: c.start, end: c.end, lane: { $0.lane }, range: { ($0.start, $0.end) })
            update { $0.overlays.append(c) }
            selection = .overlay(c.id)
        case .audio(let id):
            guard var c = clip(id) else { return }
            c.id = UUID(); c.start = c.end
            c.lane = freeLane(project.audio, start: c.start, end: c.end, lane: { $0.lane }, range: { ($0.start, $0.end) })
            update { $0.audio.append(c) }
            selection = .audio(c.id)
        case .text(let id):
            guard var t = text(id) else { return }
            t.id = UUID(); t.start = t.end
            t.lane = freeLane(project.texts, start: t.start, end: t.end, lane: { $0.lane }, range: { ($0.start, $0.end) })
            update { $0.texts.append(t) }
            selection = .text(t.id)
        case .effect(let id):
            guard var e = effect(id) else { return }
            e.id = UUID(); e.start = e.end
            e.lane = freeLane(project.effects, start: e.start, end: e.end, lane: { $0.lane }, range: { ($0.start, $0.end) })
            update { $0.effects.append(e) }
            selection = .effect(e.id)
        }
    }

    func deleteMedia(_ m: MediaItem) {
        update { p in
            p.media.removeAll { $0.id == m.id }
            p.main.removeAll { $0.mediaID == m.id }
            p.overlays.removeAll { $0.mediaID == m.id }
            p.audio.removeAll { $0.mediaID == m.id }
        }
        validateSelection()
    }

    // MARK: - Verschieben & Trimmen (Timeline)

    func moveMainClip(_ id: UUID, toIndex newIndex: Int) {
        guard let i = project.mainIndex(of: id) else { return }
        update { p in
            let c = p.main.remove(at: i)
            p.main.insert(c, at: max(0, min(newIndex, p.main.count)))
        }
    }

    func moveLaneItem(_ sel: Selection, start: Double, lane: Int) {
        let s = max(0, TimeGrid.snap(start))
        let l = max(0, lane)
        update { p in
            switch sel {
            case .overlay(let id): if let i = p.overlays.firstIndex(where: { $0.id == id }) { p.overlays[i].start = s; p.overlays[i].lane = l }
            case .audio(let id): if let i = p.audio.firstIndex(where: { $0.id == id }) { p.audio[i].start = s; p.audio[i].lane = l }
            case .text(let id): if let i = p.texts.firstIndex(where: { $0.id == id }) { p.texts[i].start = s; p.texts[i].lane = l }
            case .effect(let id): if let i = p.effects.firstIndex(where: { $0.id == id }) { p.effects[i].start = s; p.effects[i].lane = l }
            case .main: break
            }
        }
    }

    /// Trimmt ein Element: deltaStart/deltaEnd in Timeline-Sekunden
    func trim(_ sel: Selection, deltaStart: Double, deltaEnd: Double) {
        update { p in
            func trimClip(_ c: inout Clip, media: MediaItem?, isMain: Bool) {
                guard let m = media else { return }
                let maxSrc = m.kind == .image ? 3600 * 4 : m.duration
                if deltaStart != 0 {
                    var ds = deltaStart * c.speed
                    ds = max(-c.sourceStart, min(ds, c.sourceDuration - 0.1 * c.speed))
                    if m.kind == .image { ds = min(ds, c.sourceDuration - 0.1) ; c.sourceStart = 0 } else { c.sourceStart += ds }
                    c.sourceDuration -= ds
                    if !isMain { c.start = max(0, c.start + ds / c.speed) }
                    c.keyframes = c.keyframes.map { Keyframe(id: $0.id, time: $0.time - ds / c.speed, transform: $0.transform) }
                }
                if deltaEnd != 0 {
                    var de = deltaEnd * c.speed
                    let srcStart = m.kind == .image ? 0 : c.sourceStart
                    de = max(-(c.sourceDuration - 0.1 * c.speed), min(de, maxSrc - srcStart - c.sourceDuration))
                    c.sourceDuration += de
                }
            }
            switch sel {
            case .main(let id):
                if let i = p.main.firstIndex(where: { $0.id == id }) {
                    let m = p.mediaItem(p.main[i].mediaID)
                    trimClip(&p.main[i], media: m, isMain: true)
                }
            case .overlay(let id):
                if let i = p.overlays.firstIndex(where: { $0.id == id }) {
                    let m = p.mediaItem(p.overlays[i].mediaID)
                    trimClip(&p.overlays[i], media: m, isMain: false)
                }
            case .audio(let id):
                if let i = p.audio.firstIndex(where: { $0.id == id }) {
                    let m = p.mediaItem(p.audio[i].mediaID)
                    trimClip(&p.audio[i], media: m, isMain: false)
                }
            case .text(let id):
                if let i = p.texts.firstIndex(where: { $0.id == id }) {
                    var t = p.texts[i]
                    let ds = max(-t.start, min(deltaStart, t.duration - 0.1))
                    t.start += ds; t.duration -= ds
                    t.duration = max(0.1, t.duration + deltaEnd)
                    p.texts[i] = t
                }
            case .effect(let id):
                if let i = p.effects.firstIndex(where: { $0.id == id }) {
                    var e = p.effects[i]
                    let ds = max(-e.start, min(deltaStart, e.duration - 0.1))
                    e.start += ds; e.duration -= ds
                    e.duration = max(0.1, e.duration + deltaEnd)
                    p.effects[i] = e
                }
            }
        }
    }

    /// Schnapp-Punkte (Clip-Kanten + Abspielkopf)
    func snapPoints(excluding id: UUID?) -> [Double] {
        var pts: [Double] = [0, clock.time]
        for s in mainSlots { pts.append(s.start); pts.append(s.end) }
        for c in project.overlays where c.id != id { pts.append(c.start); pts.append(c.end) }
        for c in project.audio where c.id != id { pts.append(c.start); pts.append(c.end) }
        for t in project.texts where t.id != id { pts.append(t.start); pts.append(t.end) }
        for e in project.effects where e.id != id { pts.append(e.start); pts.append(e.end) }
        return pts
    }

    func snap(_ t: Double, excluding id: UUID?) -> Double {
        guard snapping else { return t }
        let threshold = 8 / pps
        var best = t
        var bestD = threshold
        for p in snapPoints(excluding: id) where abs(p - t) < bestD {
            bestD = abs(p - t); best = p
        }
        return best
    }

    // MARK: - Spezialfunktionen

    func detachAudio() {
        guard let c = selectedClip, let m = project.mediaItem(c.mediaID), m.kind == .video, m.hasAudio else {
            infoMessage = "Wähle einen Video-Clip mit Ton aus."
            return
        }
        let start = timelineStart(of: c.id) ?? 0
        var a = Clip(mediaID: m.id, sourceStart: c.sourceStart, sourceDuration: c.sourceDuration, speed: c.speed, start: start, name: (c.name ?? m.name) + " (Audio)")
        a.volume = c.volume
        a.fadeIn = c.fadeIn
        a.fadeOut = c.fadeOut
        a.lane = freeLane(project.audio, start: a.start, end: a.end, lane: { $0.lane }, range: { ($0.start, $0.end) })
        let cid = c.id
        update { p in
            p.audio.append(a)
            if let i = p.main.firstIndex(where: { $0.id == cid }) { p.main[i].muted = true }
            if let i = p.overlays.firstIndex(where: { $0.id == cid }) { p.overlays[i].muted = true }
        }
        selection = .audio(a.id)
    }

    func freezeFrame() {
        var targetID: UUID?
        if case .main(let sid)? = selection { targetID = sid }
        if targetID == nil, let idx = mainSlots.firstIndex(where: { clock.time >= $0.start && clock.time < $0.end }) {
            targetID = project.main[idx].id
        }
        guard let id = targetID, let i = project.mainIndex(of: id), let m = project.mediaItem(project.main[i].mediaID), m.kind == .video else {
            infoMessage = "Wähle einen Video-Clip auf der Hauptspur aus."
            return
        }
        let slot = mainSlots[i]
        let t = min(max(clock.time, slot.start), slot.end - 0.01)
        let c = project.main[i]
        let srcTime = c.sourceStart + (t - slot.start) * c.speed
        busy = BusyInfo(title: "Standbild wird erstellt …", progress: nil)
        let pid = project.id
        Task {
            do {
                let url = try await MediaTools.freezeFrame(media: m, sourceTime: srcTime, projectID: pid)
                var item = try await MediaImporter.load(url, generated: true)
                item.name = "Standbild"
                await MainActor.run {
                    self.busy = nil
                    self.insertFreeze(item, clipID: id, at: t)
                }
            } catch {
                await MainActor.run { self.busy = nil; self.errorMessage = error.localizedDescription }
            }
        }
    }

    private func insertFreeze(_ item: MediaItem, clipID: UUID, at t: Double) {
        guard let i = project.mainIndex(of: clipID) else { return }
        let slot = mainSlots[i]
        let c = project.main[i]
        var freeze = Clip(mediaID: item.id, sourceStart: 0, sourceDuration: 3, name: "Standbild")
        freeze.transform = c.transform
        freeze.crop = c.crop
        freeze.filter = c.filter
        freeze.adjust = c.adjust
        freeze.fitMode = c.fitMode
        freeze.flipH = c.flipH
        freeze.flipV = c.flipV
        update { p in
            p.media.append(item)
            if t > slot.start + 0.05 && t < slot.end - 0.05 {
                let offset = (t - slot.start) * c.speed
                var a = c, b = c
                b.id = UUID()
                a.sourceDuration = offset
                a.transition = nil
                b.sourceStart += offset
                b.sourceDuration -= offset
                p.main[i] = a
                p.main.insert(freeze, at: i + 1)
                p.main.insert(b, at: i + 2)
            } else {
                p.main.insert(freeze, at: t <= slot.start + 0.05 ? i : i + 1)
            }
        }
        ThumbStore.shared.ensure(item)
        selection = .main(freeze.id)
    }

    func reverseSelected() {
        guard let c = selectedClip, let m = project.mediaItem(c.mediaID), m.kind == .video else {
            infoMessage = "Wähle einen Video-Clip aus."
            return
        }
        // Zurückschalten auf das Original
        if c.reversed, let orig = c.originalMediaID, let om = project.mediaItem(orig) {
            let newStart = max(0, om.duration - (c.sourceStart + c.sourceDuration))
            modifyClip(c.id) { $0.mediaID = orig; $0.sourceStart = newStart; $0.reversed = false; $0.originalMediaID = nil }
            return
        }
        busy = BusyInfo(title: "Video wird rückwärts berechnet …", progress: 0)
        let pid = project.id
        let cid = c.id
        Task {
            do {
                let url = try await MediaTools.reverse(media: m, projectID: pid) { p in
                    DispatchQueue.main.async { self.busy?.progress = p }
                }
                var item = try await MediaImporter.load(url, generated: true)
                item.name = m.name + " (rückwärts)"
                await MainActor.run {
                    self.busy = nil
                    self.update { p in
                        p.media.append(item)
                        func fix(_ x: inout Clip) {
                            let newStart = max(0, item.duration - (x.sourceStart + x.sourceDuration))
                            x.originalMediaID = x.mediaID
                            x.mediaID = item.id
                            x.sourceStart = newStart
                            x.sourceDuration = min(x.sourceDuration, item.duration - newStart)
                            x.reversed = true
                        }
                        if let i = p.main.firstIndex(where: { $0.id == cid }) { fix(&p.main[i]) }
                        if let i = p.overlays.firstIndex(where: { $0.id == cid }) { fix(&p.overlays[i]) }
                    }
                    ThumbStore.shared.ensure(item)
                }
            } catch {
                await MainActor.run { self.busy = nil; self.errorMessage = "Rückwärts fehlgeschlagen: \(error.localizedDescription)" }
            }
        }
    }

    func setSpeed(_ id: UUID, _ speed: Double) {
        modifyClip(id, key: "speed\(id)") { c in
            let old = c.speed
            c.speed = FXMath.clamp(speed, 0.1, 10)
            let factor = old / c.speed
            c.keyframes = c.keyframes.map { Keyframe(id: $0.id, time: $0.time * factor, transform: $0.transform) }
        }
    }

    // MARK: - Untertitel, Sprachausgabe, Aufnahme

    func generateCaptions(locale: String, style: TextStyle) {
        var sources: [(Clip, MediaItem, Double)] = []
        for (i, c) in project.main.enumerated() {
            if let m = project.mediaItem(c.mediaID), m.kind == .video, m.hasAudio, !c.muted, !c.reversed { sources.append((c, m, mainSlots[i].start)) }
        }
        for c in project.audio {
            if let m = project.mediaItem(c.mediaID), m.hasAudio, !c.muted, !c.reversed { sources.append((c, m, c.start)) }
        }
        for c in project.overlays {
            if let m = project.mediaItem(c.mediaID), m.kind == .video, m.hasAudio, !c.muted, !c.reversed { sources.append((c, m, c.start)) }
        }
        guard !sources.isEmpty else {
            infoMessage = "Keine Clips mit Ton gefunden."
            return
        }
        busy = BusyInfo(title: "Sprache wird erkannt …", progress: 0)
        Task {
            guard await CaptionGenerator.authorize() else {
                await MainActor.run {
                    self.busy = nil
                    self.errorMessage = "Bitte erlaube die Spracherkennung in Systemeinstellungen › Sicherheit › Datenschutz › Spracherkennung."
                }
                return
            }
            var all: [TextClip] = []
            do {
                for (n, s) in sources.enumerated() {
                    let (c, m, start) = s
                    let caps = try await CaptionGenerator.captions(media: m, sourceStart: c.sourceStart, sourceDuration: c.sourceDuration,
                                                                   locale: Locale(identifier: locale)) { p in
                        DispatchQueue.main.async { self.busy?.progress = (Double(n) + p) / Double(sources.count) }
                    }
                    for cap in caps {
                        var t = TextClip(text: cap.text, style: style, start: start + cap.start / c.speed, duration: max(0.3, (cap.end - cap.start) / c.speed))
                        t.transform.y = 0.82
                        t.isCaption = true
                        all.append(t)
                    }
                }
            } catch {
                await MainActor.run { self.busy = nil; self.errorMessage = "Spracherkennung fehlgeschlagen: \(error.localizedDescription)" }
                return
            }
            await MainActor.run {
                self.busy = nil
                guard !all.isEmpty else { self.infoMessage = "Es wurde keine Sprache erkannt."; return }
                self.update { p in
                    p.texts.removeAll { $0.isCaption }
                    let lane = (p.texts.map { $0.lane }.max() ?? -1) + 1
                    for var t in all { t.lane = lane; p.texts.append(t) }
                }
                self.infoMessage = "\(all.count) Untertitel wurden erstellt."
            }
        }
    }

    func restyleCaptions(_ style: TextStyle) {
        update { p in for i in p.texts.indices where p.texts[i].isCaption { p.texts[i].style = style } }
    }

    func textToSpeech(_ text: String, voiceID: String?, rate: Float, pitch: Float) {
        let trimmed = text.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !trimmed.isEmpty else { return }
        busy = BusyInfo(title: "Sprachausgabe wird erzeugt …", progress: nil)
        let url = MediaTools.uniqueURL(projectID: project.id, base: "Sprache", ext: "caf")
        let at = clock.time
        Task {
            do {
                try await SpeechSynth.render(text: trimmed, voiceID: voiceID, rate: rate, pitch: pitch, to: url)
                var item = try await MediaImporter.load(url, generated: true)
                item.name = "Sprache: " + String(trimmed.prefix(24))
                await MainActor.run {
                    self.busy = nil
                    self.update { $0.media.append(item) }
                    self.addAudio(item, at: at)
                    ThumbStore.shared.ensure(item)
                }
            } catch {
                await MainActor.run { self.busy = nil; self.errorMessage = error.localizedDescription }
            }
        }
    }

    func startVoiceRecording() {
        Task {
            let ok = await recorder.requestPermission()
            await MainActor.run {
                guard ok else {
                    self.errorMessage = "Kein Mikrofon-Zugriff. Bitte in Systemeinstellungen › Sicherheit › Datenschutz › Mikrofon erlauben."
                    return
                }
                let url = MediaTools.uniqueURL(projectID: self.project.id, base: "Aufnahme", ext: "m4a")
                do {
                    self.recordStart = self.clock.time
                    try self.recorder.start(to: url)
                    self.isRecordingVoice = true
                    self.player.volume = 0
                    self.play()
                } catch {
                    self.errorMessage = error.localizedDescription
                }
            }
        }
    }

    func stopVoiceRecording() {
        guard let url = recorder.stop() else { return }
        isRecordingVoice = false
        pause()
        player.volume = 1
        let at = recordStart
        Task {
            do {
                var item = try await MediaImporter.load(url, generated: true)
                item.name = "Aufnahme"
                await MainActor.run {
                    self.update { $0.media.append(item) }
                    self.addAudio(item, at: at)
                    ThumbStore.shared.ensure(item)
                }
            } catch {
                await MainActor.run { self.errorMessage = "Aufnahme konnte nicht geladen werden: \(error.localizedDescription)" }
            }
        }
    }

    // MARK: - Export

    func exportFrame(to url: URL) {
        busy = BusyInfo(title: "Bild wird gespeichert …", progress: nil)
        let p = project
        let t = clock.time
        Task {
            do {
                try await ExportJob.exportFrame(project: p, time: t, url: url)
                await MainActor.run { self.busy = nil; self.infoMessage = "Bild gespeichert." }
            } catch {
                await MainActor.run { self.busy = nil; self.errorMessage = error.localizedDescription }
            }
        }
    }
}

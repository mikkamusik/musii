import SwiftUI
import AppKit
import UniformTypeIdentifiers

enum TL {
    static let leftPad: CGFloat = 16
    static let rulerHeight: CGFloat = 26
    static let mainHeight: CGFloat = 62
    static let overlayHeight: CGFloat = 44
    static let textHeight: CGFloat = 28
    static let effectHeight: CGFloat = 26
    static let audioHeight: CGFloat = 40
    static let spacing: CGFloat = 5
    static let marker: CGFloat = 200
}

private struct ScrollOffsetKey: PreferenceKey {
    static var defaultValue: CGFloat = 0
    static func reduce(value: inout CGFloat, nextValue: () -> CGFloat) { value = nextValue() }
}

struct TimelinePanel: View {
    @ObservedObject var editor: EditorState

    var body: some View {
        VStack(spacing: 0) {
            TimelineToolbar(editor: editor)
            Divider().background(Theme.border)
            TimelineScroll(editor: editor, clock: editor.clock)
        }
        .background(Theme.panel)
    }
}

struct TimelineToolbar: View {
    @ObservedObject var editor: EditorState

    var body: some View {
        let hasSel = editor.selection != nil
        HStack(spacing: 4) {
            IconButton(symbol: "arrow.uturn.backward", help: "Rückgängig (⌘Z)", enabled: editor.canUndo) { editor.undo() }
            IconButton(symbol: "arrow.uturn.forward", help: "Wiederholen (⇧⌘Z)", enabled: editor.canRedo) { editor.redo() }
            Divider().frame(height: 18)
            IconButton(symbol: "scissors", help: "Am Abspielkopf teilen (⌘B)") { editor.splitAtPlayhead() }
            IconButton(symbol: "trash", help: "Löschen (⌫)", enabled: hasSel) { editor.deleteSelection() }
            IconButton(symbol: "plus.square.on.square", help: "Duplizieren (⌘D)", enabled: hasSel) { editor.duplicateSelection() }
            IconButton(symbol: "pause.rectangle", help: "Standbild einfügen") { editor.freezeFrame() }
            IconButton(symbol: "backward.circle", help: "Rückwärts abspielen") { editor.reverseSelected() }
            IconButton(symbol: "waveform.badge.minus", help: "Audio vom Video trennen") { editor.detachAudio() }
            if let id = editor.selection?.id, editor.clip(id) != nil || editor.text(id) != nil {
                IconButton(symbol: editor.hasKeyframe(id) ? "diamond.fill" : "diamond", help: "Keyframe setzen/entfernen (⌥K)", active: editor.hasKeyframe(id)) {
                    editor.toggleKeyframe(id)
                }
            }
            Spacer()
            IconButton(symbol: "arrow.right.and.line.vertical.and.arrow.left", help: "Einrasten an Kanten", active: editor.snapping) {
                editor.snapping.toggle()
            }
            Divider().frame(height: 18)
            IconButton(symbol: "minus.magnifyingglass", help: "Herauszoomen (⌘-)") { editor.pps = max(4, editor.pps / 1.4) }
            Slider(value: Binding(get: { log(editor.pps) }, set: { editor.pps = exp($0) }), in: log(4)...log(600))
                .frame(width: 120)
                .controlSize(.small)
            IconButton(symbol: "plus.magnifyingglass", help: "Hineinzoomen (⌘+)") { editor.pps = min(600, editor.pps * 1.4) }
            IconButton(symbol: "arrow.left.and.right.square", help: "Ganzes Projekt anzeigen") {
                NotificationCenter.default.post(name: .musiiFitTimeline, object: nil)
            }
        }
        .padding(.horizontal, 8)
        .frame(height: 34)
    }
}

extension Notification.Name {
    static let musiiFitTimeline = Notification.Name("musiiFitTimeline")
}

struct TimelineScroll: View {
    @ObservedObject var editor: EditorState
    @ObservedObject var clock: PlaybackClock
    @State private var scrollX: CGFloat = 0
    @State private var viewWidth: CGFloat = 800

    var body: some View {
        GeometryReader { geo in
            let contentWidth = max(geo.size.width, TL.leftPad + CGFloat(max(editor.duration, 10) + 30) * CGFloat(editor.pps))
            ScrollViewReader { proxy in
                ScrollView([.horizontal, .vertical], showsIndicators: true) {
                    ZStack(alignment: .topLeading) {
                        Color.black.opacity(0.001)
                            .onTapGesture { editor.selection = nil }
                        HStack(spacing: 0) {
                            ForEach(0..<Int(contentWidth / TL.marker) + 1, id: \.self) { i in
                                Color.clear.frame(width: TL.marker, height: 1).id(i)
                            }
                        }
                        TimelineContent(editor: editor)
                            .padding(.leading, TL.leftPad)
                        PlayheadView(editor: editor, clock: clock)
                    }
                    .frame(width: contentWidth, alignment: .topLeading)
                    .frame(minHeight: geo.size.height, alignment: .top)
                    .background(GeometryReader { g in
                        Color.clear.preference(key: ScrollOffsetKey.self, value: -g.frame(in: .named("tlscroll")).minX)
                    })
                }
                .coordinateSpace(name: "tlscroll")
                .onPreferenceChange(ScrollOffsetKey.self) { scrollX = $0 }
                .onAppear { viewWidth = geo.size.width }
                .onChange(of: geo.size.width) { viewWidth = $0 }
                .onChange(of: clock.time) { t in
                    guard editor.isPlaying else { return }
                    let x = TL.leftPad + CGFloat(t * editor.pps)
                    if x > scrollX + viewWidth - 60 || x < scrollX {
                        let idx = max(0, Int((x - 40) / TL.marker))
                        proxy.scrollTo(idx, anchor: .leading)
                    }
                }
                .onReceive(NotificationCenter.default.publisher(for: .musiiFitTimeline)) { _ in
                    let d = max(5, editor.duration)
                    editor.pps = max(4, min(600, Double(viewWidth - 80) / d))
                    proxy.scrollTo(0, anchor: .leading)
                }
            }
        }
        .background(Theme.bg)
        .onDrop(of: [UTType.fileURL, UTType.plainText], isTargeted: nil) { providers, location in
            let t = max(0, Double(location.x + scrollX - TL.leftPad) / editor.pps)
            let mainTop = TL.rulerHeight + TL.spacing
                + CGFloat(editor.effectLaneCount()) * (TL.effectHeight + TL.spacing)
                + CGFloat(editor.textLaneCount()) * (TL.textHeight + TL.spacing)
                + CGFloat(editor.overlayLaneCount()) * (TL.overlayHeight + TL.spacing)
            let asOverlay = location.y < mainTop - 2
            if providers.contains(where: { $0.hasItemConformingToTypeIdentifier(UTType.fileURL.identifier) }) {
                loadDroppedURLs(providers) { urls in editor.importMedia(urls, addToTimeline: true) }
                return true
            }
            for p in providers where p.canLoadObject(ofClass: NSString.self) {
                _ = p.loadObject(ofClass: NSString.self) { obj, _ in
                    guard let str = obj as? String, str.hasPrefix("musii-media:"),
                          let id = UUID(uuidString: String(str.dropFirst("musii-media:".count))) else { return }
                    DispatchQueue.main.async {
                        if let m = editor.project.mediaItem(id) { editor.dropMedia(m, at: t, asOverlay: asOverlay) }
                    }
                }
            }
            return true
        }
    }
}

func loadDroppedURLs(_ providers: [NSItemProvider], completion: @escaping ([URL]) -> Void) {
    var urls: [URL] = []
    let group = DispatchGroup()
    let lock = NSLock()
    for p in providers where p.hasItemConformingToTypeIdentifier(UTType.fileURL.identifier) {
        group.enter()
        p.loadItem(forTypeIdentifier: UTType.fileURL.identifier, options: nil) { item, _ in
            defer { group.leave() }
            var url: URL?
            if let d = item as? Data { url = URL(dataRepresentation: d, relativeTo: nil) }
            else if let u = item as? URL { url = u }
            if let u = url { lock.lock(); urls.append(u); lock.unlock() }
        }
    }
    group.notify(queue: .main) { completion(urls.sorted { $0.lastPathComponent < $1.lastPathComponent }) }
}

// MARK: - Inhalt

struct TimelineContent: View {
    @ObservedObject var editor: EditorState

    var body: some View {
        let p = editor.project
        let effectLanes = editor.effectLaneCount()
        let textLanes = editor.textLaneCount()
        let overlayLanes = editor.overlayLaneCount()
        let audioLanes = max(1, editor.audioLaneCount())
        VStack(alignment: .leading, spacing: TL.spacing) {
            RulerView(editor: editor)
            ForEach((0..<effectLanes).reversed(), id: \.self) { lane in
                LaneBackground(height: TL.effectHeight) {
                    ForEach(p.effects.filter { $0.lane == lane }) { e in
                        LaneItemView(editor: editor, selection: .effect(e.id), start: e.start, duration: e.duration, lane: lane,
                                     laneStep: -(TL.effectHeight + TL.spacing), height: TL.effectHeight, color: Theme.effectClip) {
                            Label(e.kind.title, systemImage: e.kind.symbol).font(.system(size: 10, weight: .medium)).lineLimit(1)
                        }
                    }
                }
            }
            ForEach((0..<textLanes).reversed(), id: \.self) { lane in
                LaneBackground(height: TL.textHeight) {
                    ForEach(p.texts.filter { $0.lane == lane }) { t in
                        LaneItemView(editor: editor, selection: .text(t.id), start: t.start, duration: t.duration, lane: lane,
                                     laneStep: -(TL.textHeight + TL.spacing), height: TL.textHeight,
                                     color: t.isCaption ? Theme.captionClip : (t.kind == .text ? Theme.textClip : Theme.stickerClip)) {
                            HStack(spacing: 4) {
                                Image(systemName: t.kind == .text ? "textformat" : (t.kind == .emoji ? "face.smiling" : "star"))
                                Text(t.kind == .symbol ? "Symbol" : t.text.replacingOccurrences(of: "\n", with: " ")).lineLimit(1)
                            }
                            .font(.system(size: 10, weight: .medium))
                        }
                    }
                }
            }
            ForEach((0..<overlayLanes).reversed(), id: \.self) { lane in
                LaneBackground(height: TL.overlayHeight) {
                    ForEach(p.overlays.filter { $0.lane == lane }) { c in
                        LaneItemView(editor: editor, selection: .overlay(c.id), start: c.start, duration: c.duration, lane: lane,
                                     laneStep: -(TL.overlayHeight + TL.spacing), height: TL.overlayHeight, color: Theme.overlayClip) {
                            ClipContent(editor: editor, clip: c, height: TL.overlayHeight, width: CGFloat(c.duration * editor.pps))
                        }
                    }
                }
            }
            MainLane(editor: editor)
            ForEach(0..<audioLanes, id: \.self) { lane in
                LaneBackground(height: TL.audioHeight) {
                    if p.audio.isEmpty && lane == 0 {
                        Text("♪  Musik oder Audio hierher ziehen – oder im Tab „Audio“ hinzufügen")
                            .font(.system(size: 10))
                            .foregroundColor(Theme.secondaryText)
                            .padding(.leading, 8)
                            .frame(height: TL.audioHeight)
                    }
                    ForEach(p.audio.filter { $0.lane == lane }) { c in
                        LaneItemView(editor: editor, selection: .audio(c.id), start: c.start, duration: c.duration, lane: lane,
                                     laneStep: TL.audioHeight + TL.spacing, height: TL.audioHeight, color: Theme.audioClip) {
                            ClipContent(editor: editor, clip: c, height: TL.audioHeight, width: CGFloat(c.duration * editor.pps))
                        }
                    }
                }
            }
            Spacer(minLength: 20)
        }
    }
}

struct LaneBackground<Content: View>: View {
    let height: CGFloat
    @ViewBuilder var content: Content
    var body: some View {
        ZStack(alignment: .topLeading) {
            Rectangle().fill(Color.white.opacity(0.025)).frame(height: height).allowsHitTesting(false)
            content
        }
        .frame(height: height)
        .frame(maxWidth: .infinity, alignment: .leading)
    }
}

// MARK: - Lineal & Abspielkopf

struct RulerView: View {
    @ObservedObject var editor: EditorState

    var body: some View {
        let pps = editor.pps
        let total = max(editor.duration, 10) + 30
        let chunkW: CGFloat = 1500
        let totalW = CGFloat(total * pps)
        let chunks = max(1, Int(ceil(totalW / chunkW)))
        let steps: [Double] = [0.1, 0.2, 0.5, 1, 2, 5, 10, 15, 30, 60, 120, 300]
        let major = steps.first { $0 * pps >= 70 } ?? 600
        let minor = major / 5
        HStack(spacing: 0) {
            ForEach(0..<chunks, id: \.self) { c in
                Canvas { ctx, size in
                    let x0 = CGFloat(c) * chunkW
                    var i = Int(floor(Double(x0) / pps / minor))
                    while true {
                        let t = Double(i) * minor
                        let x = CGFloat(t * pps) - x0
                        if x > size.width + 1 || t > total { break }
                        let isMajor = i % 5 == 0
                        var path = Path()
                        path.move(to: CGPoint(x: x, y: size.height))
                        path.addLine(to: CGPoint(x: x, y: size.height - (isMajor ? 10 : 5)))
                        ctx.stroke(path, with: .color(.white.opacity(isMajor ? 0.5 : 0.25)), lineWidth: 1)
                        if isMajor {
                            let label = major < 1 ? String(format: "%.1fs", t) : formatShort(t)
                            ctx.draw(Text(label).font(.system(size: 9)).foregroundColor(.white.opacity(0.55)), at: CGPoint(x: x + 3, y: 7), anchor: .leading)
                        }
                        i += 1
                    }
                }
                .frame(width: min(chunkW, max(1, totalW - CGFloat(c) * chunkW)), height: TL.rulerHeight)
            }
        }
        .frame(width: CGFloat(total * pps), height: TL.rulerHeight)
        .contentShape(Rectangle())
        .gesture(DragGesture(minimumDistance: 0).onChanged { v in
            if editor.isPlaying { editor.pause() }
            editor.seek(to: max(0, Double(v.location.x) / pps))
        })
    }

    private func formatShort(_ t: Double) -> String {
        let m = Int(t) / 60, s = Int(t) % 60
        return String(format: "%d:%02d", m, s)
    }
}

struct PlayheadView: View {
    @ObservedObject var editor: EditorState
    @ObservedObject var clock: PlaybackClock

    var body: some View {
        let x = TL.leftPad + CGFloat(clock.time * editor.pps)
        ZStack(alignment: .top) {
            Rectangle().fill(Color.white).frame(width: 1.5)
            Path { p in
                p.move(to: CGPoint(x: -6, y: 0))
                p.addLine(to: CGPoint(x: 6, y: 0))
                p.addLine(to: CGPoint(x: 6, y: 8))
                p.addLine(to: CGPoint(x: 0, y: 14))
                p.addLine(to: CGPoint(x: -6, y: 8))
                p.closeSubpath()
            }
            .fill(Color.white)
            .frame(width: 1, height: 14)
        }
        .frame(width: 1.5)
        .frame(maxHeight: .infinity)
        .offset(x: x)
        .allowsHitTesting(false)
    }
}

// MARK: - Hauptspur

struct MainLane: View {
    @ObservedObject var editor: EditorState

    var body: some View {
        let p = editor.project
        let slots = editor.mainSlots
        ZStack(alignment: .topLeading) {
            Rectangle().fill(Color.white.opacity(0.04)).frame(height: TL.mainHeight).allowsHitTesting(false)
            if p.main.isEmpty {
                HStack(spacing: 8) {
                    Image(systemName: "plus.rectangle.on.rectangle")
                    Text("Hauptspur – Videos & Fotos hierher ziehen")
                }
                .font(.system(size: 11))
                .foregroundColor(Theme.secondaryText)
                .padding(.leading, 10)
                .frame(height: TL.mainHeight)
            }
            ForEach(Array(p.main.enumerated()), id: \.element.id) { i, c in
                if i < slots.count {
                    MainClipView(editor: editor, clip: c, index: i, slot: slots[i])
                }
            }
            // Übergangs-Knöpfe
            ForEach(Array(p.main.enumerated()), id: \.element.id) { i, c in
                if i + 1 < p.main.count, i + 1 < slots.count {
                    let junction = (slots[i].end + slots[i + 1].start) / 2
                    Button {
                        editor.selection = .main(c.id)
                        editor.leftTab = .transitions
                    } label: {
                        Image(systemName: c.transition != nil ? "arrow.left.arrow.right.square.fill" : "plus.square.fill")
                            .font(.system(size: 14))
                            .foregroundColor(c.transition != nil ? Theme.accent : .white.opacity(0.85))
                            .background(RoundedRectangle(cornerRadius: 3).fill(Color.black.opacity(0.6)))
                    }
                    .buttonStyle(.plain)
                    .help(c.transition.map { "Übergang: \($0.kind.title)" } ?? "Übergang hinzufügen")
                    .offset(x: CGFloat(junction * editor.pps) - 8, y: TL.mainHeight / 2 - 9)
                }
            }
        }
        .frame(height: TL.mainHeight)
        .frame(maxWidth: .infinity, alignment: .leading)
    }
}

struct MainClipView: View {
    @ObservedObject var editor: EditorState
    let clip: Clip
    let index: Int
    let slot: MainSlot

    @State private var dragX: CGFloat = 0
    @State private var trimL: CGFloat = 0
    @State private var trimR: CGFloat = 0

    var body: some View {
        let pps = CGFloat(editor.pps)
        let selected = editor.selection == .main(clip.id)
        let width = max(4, CGFloat(slot.end - slot.start) * pps - trimL + trimR)
        let media = editor.project.mediaItem(clip.mediaID)
        ZStack(alignment: .topLeading) {
            ClipContent(editor: editor, clip: clip, height: TL.mainHeight, width: width)
            if clip.transition != nil && slot.transitionOut > 0 {
                Rectangle().fill(Theme.accent.opacity(0.3))
                    .frame(width: CGFloat(slot.transitionOut) * pps, height: TL.mainHeight)
                    .offset(x: width - CGFloat(slot.transitionOut) * pps)
                    .allowsHitTesting(false)
            }
        }
        .frame(width: width, height: TL.mainHeight, alignment: .topLeading)
        .background(RoundedRectangle(cornerRadius: 6).fill(media?.kind == .image ? Theme.imageClip : Theme.videoClip))
        .clipShape(RoundedRectangle(cornerRadius: 6))
        .overlay(RoundedRectangle(cornerRadius: 6).stroke(selected ? Color.white : Color.black.opacity(0.4), lineWidth: selected ? 2 : 1))
        .overlay(alignment: .leading) { if selected { TrimHandle(offset: $trimL, onEnd: commitTrimL) } }
        .overlay(alignment: .trailing) { if selected { TrimHandle(offset: $trimR, onEnd: commitTrimR) } }
        .offset(x: CGFloat(slot.start) * pps + trimL + dragX)
        .zIndex(dragX != 0 ? 10 : (selected ? 2 : 0))
        .onTapGesture { editor.selection = .main(clip.id) }
        .gesture(
            DragGesture(minimumDistance: 4)
                .onChanged { v in
                    editor.selection = .main(clip.id)
                    dragX = v.translation.width
                }
                .onEnded { v in
                    let center = (slot.start + slot.end) / 2 + Double(v.translation.width) / editor.pps
                    let others = editor.mainSlots.enumerated().filter { $0.offset != index }
                    let newIndex = others.filter { ($0.element.start + $0.element.end) / 2 < center }.count
                    dragX = 0
                    if newIndex != index { editor.moveMainClip(clip.id, toIndex: newIndex) }
                }
        )
        .contextMenu { ClipContextMenu(editor: editor, selection: .main(clip.id)) }
    }

    private func commitTrimL() {
        let d = editor.snap(slot.start + Double(trimL) / editor.pps, excluding: clip.id) - slot.start
        trimL = 0
        if abs(d) > 0.001 { editor.trim(.main(clip.id), deltaStart: d, deltaEnd: 0) }
    }

    private func commitTrimR() {
        let d = editor.snap(slot.end + Double(trimR) / editor.pps, excluding: clip.id) - slot.end
        trimR = 0
        if abs(d) > 0.001 { editor.trim(.main(clip.id), deltaStart: 0, deltaEnd: d) }
    }
}

struct TrimHandle: View {
    @Binding var offset: CGFloat
    let onEnd: () -> Void

    var body: some View {
        RoundedRectangle(cornerRadius: 2)
            .fill(Color.white)
            .frame(width: 7)
            .overlay(Rectangle().fill(Color.black.opacity(0.5)).frame(width: 1.5, height: 12))
            .padding(.vertical, 2)
            .contentShape(Rectangle().inset(by: -4))
            .onHover { inside in
                if inside { NSCursor.resizeLeftRight.push() } else { NSCursor.pop() }
            }
            .gesture(
                DragGesture(minimumDistance: 1, coordinateSpace: .global)
                    .onChanged { v in offset = v.translation.width }
                    .onEnded { _ in onEnd() }
            )
    }
}

// MARK: - Spur-Elemente (Overlay, Audio, Text, Effekt)

struct LaneItemView<ItemLabel: View>: View {
    @ObservedObject var editor: EditorState
    let selection: Selection
    let start: Double
    let duration: Double
    let lane: Int
    /// Höhe pro Spurwechsel; negativ, wenn höhere Spuren weiter oben liegen
    let laneStep: CGFloat
    let height: CGFloat
    let color: Color
    @ViewBuilder var label: ItemLabel

    @State private var drag: CGSize = .zero
    @State private var trimL: CGFloat = 0
    @State private var trimR: CGFloat = 0
    @State private var snappedStart: Double?

    var body: some View {
        let pps = CGFloat(editor.pps)
        let selected = editor.selection == selection
        let width = max(4, CGFloat(duration) * pps - trimL + trimR)
        let displayStart = snappedStart ?? start
        ZStack(alignment: .leading) {
            label
                .padding(.horizontal, 6)
                .frame(width: width, height: height, alignment: .leading)
                .foregroundColor(.white)
        }
        .frame(width: width, height: height, alignment: .leading)
        .background(RoundedRectangle(cornerRadius: 5).fill(color))
        .clipShape(RoundedRectangle(cornerRadius: 5))
        .overlay(RoundedRectangle(cornerRadius: 5).stroke(selected ? Color.white : Color.black.opacity(0.4), lineWidth: selected ? 2 : 1))
        .overlay(alignment: .leading) { if selected { TrimHandle(offset: $trimL, onEnd: commitTrimL) } }
        .overlay(alignment: .trailing) { if selected { TrimHandle(offset: $trimR, onEnd: commitTrimR) } }
        .offset(x: CGFloat(displayStart) * pps + trimL, y: drag.height)
        .zIndex(drag != .zero ? 10 : (selected ? 2 : 0))
        .onTapGesture { editor.selection = selection }
        .gesture(
            DragGesture(minimumDistance: 4)
                .onChanged { v in
                    editor.selection = selection
                    drag = v.translation
                    let proposed = max(0, start + Double(v.translation.width) / editor.pps)
                    let s1 = editor.snap(proposed, excluding: selection.id)
                    let s2 = editor.snap(proposed + duration, excluding: selection.id) - duration
                    snappedStart = abs(s1 - proposed) <= abs(s2 - proposed) ? s1 : max(0, s2)
                }
                .onEnded { v in
                    let newStart = snappedStart ?? start
                    let laneDelta = Int((v.translation.height / laneStep).rounded())
                    drag = .zero
                    snappedStart = nil
                    editor.moveLaneItem(selection, start: newStart, lane: lane + laneDelta)
                }
        )
        .contextMenu { ClipContextMenu(editor: editor, selection: selection) }
    }

    private func commitTrimL() {
        let d = editor.snap(start + Double(trimL) / editor.pps, excluding: selection.id) - start
        trimL = 0
        if abs(d) > 0.001 { editor.trim(selection, deltaStart: d, deltaEnd: 0) }
    }

    private func commitTrimR() {
        let end = start + duration
        let d = editor.snap(end + Double(trimR) / editor.pps, excluding: selection.id) - end
        trimR = 0
        if abs(d) > 0.001 { editor.trim(selection, deltaStart: 0, deltaEnd: d) }
    }
}

struct ClipContextMenu: View {
    @ObservedObject var editor: EditorState
    let selection: Selection

    var body: some View {
        Button("Am Abspielkopf teilen") { editor.selection = selection; editor.splitAtPlayhead() }
        Button("Duplizieren") { editor.selection = selection; editor.duplicateSelection() }
        Button("Löschen") { editor.selection = selection; editor.deleteSelection() }
        switch selection {
        case .main, .overlay:
            Divider()
            Button("Standbild einfügen") { editor.selection = selection; editor.freezeFrame() }
            Button("Rückwärts") { editor.selection = selection; editor.reverseSelected() }
            Button("Audio trennen") { editor.selection = selection; editor.detachAudio() }
        default:
            EmptyView()
        }
    }
}

// MARK: - Clip-Inhalt (Filmstreifen, Wellenform)

struct ClipContent: View {
    @ObservedObject var editor: EditorState
    @ObservedObject var thumbs = ThumbStore.shared
    let clip: Clip
    let height: CGFloat
    let width: CGFloat

    var body: some View {
        let media = editor.project.mediaItem(clip.mediaID)
        ZStack(alignment: .topLeading) {
            if let m = media {
                if m.isVisual {
                    filmstrip(m)
                }
                if m.hasAudio, let wave = thumbs.waves[m.id], !wave.isEmpty {
                    WaveformShape(peaks: wave, sourceStart: clip.sourceStart, sourceDuration: clip.sourceDuration)
                        .fill(m.isVisual ? Color.white.opacity(0.35) : Color.white.opacity(0.75))
                        .frame(width: width, height: m.isVisual ? height * 0.35 : height - 14)
                        .offset(y: m.isVisual ? height * 0.65 : 12)
                        .opacity(clip.muted ? 0.3 : 1)
                }
                if !m.exists {
                    Text("Datei fehlt").font(.system(size: 10, weight: .bold)).foregroundColor(.red).padding(4)
                        .offset(y: height - 20)
                }
            }
            HStack(spacing: 4) {
                if clip.muted { Image(systemName: "speaker.slash.fill") }
                if abs(clip.speed - 1) > 0.001 { Text(String(format: "%.2gx", clip.speed)) }
                if clip.reversed { Image(systemName: "backward.fill") }
                if clip.filter.preset != "none" || !clip.adjust.isIdentity { Image(systemName: "camera.filters") }
                if !clip.effects.isEmpty { Image(systemName: "sparkles") }
                if clip.removeBackground || clip.chroma.enabled { Image(systemName: "person.crop.rectangle") }
                if clip.mask.kind != .none { Image(systemName: "circle.dashed") }
                Text(clip.name ?? media?.name ?? "").lineLimit(1)
            }
            .font(.system(size: 9, weight: .semibold))
            .foregroundColor(.white)
            .padding(.horizontal, 4)
            .padding(.vertical, 2)
            .background(RoundedRectangle(cornerRadius: 3).fill(Color.black.opacity(0.45)))
            .padding(3)
            // Keyframes
            ForEach(clip.keyframes) { k in
                Image(systemName: "diamond.fill")
                    .font(.system(size: 8))
                    .foregroundColor(.yellow)
                    .offset(x: CGFloat(k.time * editor.pps) - 4, y: height - 12)
            }
        }
        .frame(width: width, height: height, alignment: .topLeading)
        .clipped()
        .onAppear { if let m = media { thumbs.ensure(m) } }
    }

    @ViewBuilder
    private func filmstrip(_ m: MediaItem) -> some View {
        let frames = thumbs.strips[m.id] ?? []
        let aspect = m.width > 0 && m.height > 0 ? CGFloat(m.width / m.height) : 16 / 9
        let thumbW = max(20, height * aspect)
        let count = max(1, Int(ceil(width / thumbW)))
        HStack(spacing: 0) {
            ForEach(0..<min(count, 200), id: \.self) { i in
                let img = frameImage(frames, m, index: i, count: count)
                Group {
                    if let img = img {
                        Image(nsImage: img).resizable().aspectRatio(contentMode: .fill)
                    } else {
                        Color.black.opacity(0.2)
                    }
                }
                .frame(width: thumbW, height: height)
                .clipped()
            }
        }
        .opacity(0.9)
    }

    private func frameImage(_ frames: [NSImage], _ m: MediaItem, index: Int, count: Int) -> NSImage? {
        guard !frames.isEmpty else { return nil }
        if m.kind == .image || frames.count == 1 { return frames[0] }
        let srcT = clip.sourceStart + clip.sourceDuration * (Double(index) + 0.5) / Double(count)
        let f = srcT / max(0.01, m.duration)
        let i = min(frames.count - 1, max(0, Int(f * Double(frames.count))))
        return frames[i]
    }
}

struct WaveformShape: Shape {
    let peaks: [Float]
    let sourceStart: Double
    let sourceDuration: Double

    func path(in rect: CGRect) -> Path {
        var p = Path()
        let perSec = ThumbStore.wavePerSecond
        let first = Int(sourceStart * perSec)
        let last = min(peaks.count, Int((sourceStart + sourceDuration) * perSec))
        guard last > first else { return p }
        let n = last - first
        let columns = max(1, Int(rect.width / 2))
        let mid = rect.midY
        for c in 0..<columns {
            let a = first + c * n / columns
            let b = max(a + 1, first + (c + 1) * n / columns)
            var mx: Float = 0
            for i in a..<min(b, peaks.count) { mx = max(mx, peaks[i]) }
            let h = max(0.5, CGFloat(mx) * rect.height / 2)
            let x = rect.minX + CGFloat(c) * rect.width / CGFloat(columns)
            p.addRect(CGRect(x: x, y: mid - h, width: max(1, rect.width / CGFloat(columns) - 0.5), height: h * 2))
        }
        return p
    }
}

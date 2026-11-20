import SwiftUI
import AVFoundation
import AppKit

final class PlayerNSView: NSView {
    let playerLayer = AVPlayerLayer()

    init(player: AVPlayer) {
        super.init(frame: .zero)
        wantsLayer = true
        layer = CALayer()
        layer?.backgroundColor = NSColor.black.cgColor
        playerLayer.player = player
        playerLayer.videoGravity = .resizeAspect
        playerLayer.backgroundColor = NSColor.black.cgColor
        layer?.addSublayer(playerLayer)
    }

    required init?(coder: NSCoder) { fatalError() }

    override func layout() {
        super.layout()
        CATransaction.begin()
        CATransaction.setDisableActions(true)
        playerLayer.frame = bounds
        CATransaction.commit()
    }
}

struct PlayerLayerView: NSViewRepresentable {
    let player: AVPlayer
    func makeNSView(context: Context) -> PlayerNSView { PlayerNSView(player: player) }
    func updateNSView(_ nsView: PlayerNSView, context: Context) {
        if nsView.playerLayer.player !== player { nsView.playerLayer.player = player }
    }
}

struct PreviewArea: View {
    @ObservedObject var editor: EditorState

    var body: some View {
        VStack(spacing: 0) {
            GeometryReader { geo in
                let canvas = editor.project.canvasSize
                let avail = CGSize(width: max(10, geo.size.width - 24), height: max(10, geo.size.height - 24))
                let f = min(avail.width / canvas.width, avail.height / canvas.height)
                let size = CGSize(width: canvas.width * f, height: canvas.height * f)
                ZStack {
                    Theme.bg
                    ZStack {
                        PlayerLayerView(player: editor.player)
                        CanvasOverlay(editor: editor, clock: editor.clock, size: size)
                        if editor.project.main.isEmpty && editor.project.overlays.isEmpty && editor.project.texts.isEmpty {
                            VStack(spacing: 10) {
                                Image(systemName: "film.stack").font(.system(size: 36))
                                Text("Importiere Videos, Fotos oder Musik\nund ziehe sie hierher oder in die Timeline.")
                                    .multilineTextAlignment(.center)
                                    .font(.system(size: 13))
                            }
                            .foregroundColor(.white.opacity(0.55))
                            .allowsHitTesting(false)
                        }
                    }
                    .frame(width: size.width, height: size.height)
                    .clipped()
                    .shadow(color: .black.opacity(0.5), radius: 10)
                }
                .frame(width: geo.size.width, height: geo.size.height)
            }
            TransportBar(editor: editor, clock: editor.clock)
        }
        .background(Theme.bg)
    }
}

/// Auswahlrahmen über der Vorschau: Verschieben, Skalieren, Auswählen per Klick
struct CanvasOverlay: View {
    @ObservedObject var editor: EditorState
    @ObservedObject var clock: PlaybackClock
    let size: CGSize

    @State private var dragStart: Transform2D?
    @State private var scaleStart: Transform2D?

    private struct Box {
        let id: UUID
        let center: CGPoint
        let size: CGSize
        let rotation: Double
        let selection: Selection
    }

    private func boxes() -> [Box] {
        let t = clock.time
        let p = editor.project
        let canvas = p.canvasSize
        let k = size.width / canvas.width
        let unit = min(canvas.width, canvas.height) / 1080
        var result: [Box] = []
        func clipBox(_ c: Clip, start: Double, sel: Selection) {
            guard let m = p.mediaItem(c.mediaID), m.isVisual, m.width > 0, m.height > 0 else { return }
            let tr = KeyframeMath.transform(base: c.transform, keyframes: c.keyframes, at: t - start)
            let iw = m.width * c.crop.w, ih = m.height * c.crop.h
            let base = c.fitMode == .fit ? min(canvas.width / iw, canvas.height / ih) : max(canvas.width / iw, canvas.height / ih)
            let s = Double(base) * tr.scale
            result.append(Box(id: c.id, center: CGPoint(x: tr.x * Double(size.width), y: tr.y * Double(size.height)),
                              size: CGSize(width: iw * s * Double(k), height: ih * s * Double(k)), rotation: tr.rotation, selection: sel))
        }
        let slots = p.mainSlots
        for (i, c) in p.main.enumerated() where t >= slots[i].start && t < slots[i].end {
            clipBox(c, start: slots[i].start, sel: .main(c.id))
        }
        for c in p.overlays.sorted(by: { $0.lane < $1.lane }) where t >= c.start && t < c.end {
            clipBox(c, start: c.start, sel: .overlay(c.id))
        }
        for x in p.texts.sorted(by: { $0.lane < $1.lane }) where t >= x.start && t < x.end {
            let tr = KeyframeMath.transform(base: x.transform, keyframes: x.keyframes, at: t - x.start)
            var sz: CGSize
            switch x.kind {
            case .symbol:
                sz = CGSize(width: x.style.fontSize * 2 * Double(unit), height: x.style.fontSize * 2 * Double(unit))
            default:
                sz = TextRenderer.shared.measure(x.text, style: x.style, scale: unit)
                if x.style.background { sz.width += CGFloat(x.style.backgroundPadding) * 2 * unit; sz.height += CGFloat(x.style.backgroundPadding) * 1.2 * unit }
            }
            let s = tr.scale * Double(k)
            result.append(Box(id: x.id, center: CGPoint(x: tr.x * Double(size.width), y: tr.y * Double(size.height)),
                              size: CGSize(width: Double(sz.width) * s, height: Double(sz.height) * s), rotation: tr.rotation, selection: .text(x.id)))
        }
        return result
    }

    var body: some View {
        let all = boxes()
        let selected = all.first { $0.id == editor.selection?.id }
        ZStack(alignment: .topLeading) {
            Color.black.opacity(0.001)
            if let b = selected {
                Rectangle()
                    .stroke(Theme.accent, style: StrokeStyle(lineWidth: 1.5, dash: [5, 3]))
                    .frame(width: max(8, b.size.width), height: max(8, b.size.height))
                    .rotationEffect(.degrees(b.rotation))
                    .position(b.center)
                    .allowsHitTesting(false)
                ForEach(0..<4, id: \.self) { i in
                    Circle()
                        .fill(Color.white)
                        .frame(width: 8, height: 8)
                        .overlay(Circle().stroke(Theme.accent, lineWidth: 1.5))
                        .position(corner(b, i))
                        .allowsHitTesting(false)
                }
            }
        }
        .frame(width: size.width, height: size.height)
        .contentShape(Rectangle())
        .gesture(
            DragGesture(minimumDistance: 0)
                .onChanged { v in
                    guard let id = editor.selection?.id, selected != nil else { return }
                    if editor.isPlaying { editor.pause() }
                    if dragStart == nil {
                        // Drag beginnt nur, wenn innerhalb des Auswahlrahmens
                        if let b = selected, hit(b, v.startLocation) {
                            dragStart = editor.currentTransform(id)
                        } else {
                            return
                        }
                    }
                    guard let s = dragStart else { return }
                    let nx = s.x + Double(v.translation.width / size.width)
                    let ny = s.y + Double(v.translation.height / size.height)
                    editor.setTransform(id, key: "canvasDrag\(id)") { tr in
                        tr.x = abs(nx - 0.5) < 0.008 ? 0.5 : nx
                        tr.y = abs(ny - 0.5) < 0.008 ? 0.5 : ny
                    }
                }
                .onEnded { v in
                    let moved = abs(v.translation.width) + abs(v.translation.height) > 3
                    if dragStart == nil || !moved {
                        // Klick: Element unter dem Mauszeiger auswählen (oberstes zuerst)
                        if let b = all.reversed().first(where: { hit($0, v.location) }) {
                            editor.selection = b.selection
                        }
                    }
                    dragStart = nil
                }
        )
        .simultaneousGesture(
            MagnificationGesture()
                .onChanged { m in
                    guard let id = editor.selection?.id, selected != nil else { return }
                    if scaleStart == nil { scaleStart = editor.currentTransform(id) }
                    guard let s = scaleStart else { return }
                    editor.setTransform(id, key: "canvasScale\(id)") { $0.scale = max(0.05, min(10, s.scale * Double(m))) }
                }
                .onEnded { _ in scaleStart = nil }
        )
    }

    private func hit(_ b: Box, _ p: CGPoint) -> Bool {
        let w = max(24, b.size.width), h = max(24, b.size.height)
        return abs(p.x - b.center.x) <= w / 2 && abs(p.y - b.center.y) <= h / 2
    }

    private func corner(_ b: Box, _ i: Int) -> CGPoint {
        let w = max(8, b.size.width) / 2, h = max(8, b.size.height) / 2
        let pts = [CGPoint(x: -w, y: -h), CGPoint(x: w, y: -h), CGPoint(x: w, y: h), CGPoint(x: -w, y: h)]
        let a = b.rotation * Double.pi / 180
        let p = pts[i]
        let x = Double(p.x) * cos(a) - Double(p.y) * sin(a)
        let y = Double(p.x) * sin(a) + Double(p.y) * cos(a)
        return CGPoint(x: b.center.x + CGFloat(x), y: b.center.y + CGFloat(y))
    }
}

struct TransportBar: View {
    @ObservedObject var editor: EditorState
    @ObservedObject var clock: PlaybackClock

    var body: some View {
        GeometryReader { geo in
            let compact = geo.size.width < 640
            HStack(spacing: compact ? 4 : 10) {
                Text(compact ? formatTime(clock.time) : "\(formatTime(clock.time)) / \(formatTime(editor.duration))")
                    .font(.system(size: 12, design: .monospaced))
                    .foregroundColor(.white.opacity(0.85))
                    .lineLimit(1)
                    .fixedSize()
                Spacer(minLength: 4)
                if !compact {
                    IconButton(symbol: "backward.end.fill", help: "Zum Anfang (Pos1)") { editor.jumpToStart() }
                }
                IconButton(symbol: "backward.frame.fill", help: "Ein Bild zurück (←)") { editor.step(frames: -1) }
                Button {
                    editor.togglePlay()
                } label: {
                    Image(systemName: editor.isPlaying ? "pause.fill" : "play.fill")
                        .font(.system(size: 16))
                        .frame(width: 40, height: 30)
                        .background(Circle().fill(Theme.accent))
                        .foregroundColor(.black)
                }
                .buttonStyle(.plain)
                .help("Abspielen / Pause (Leertaste)")
                IconButton(symbol: "forward.frame.fill", help: "Ein Bild vor (→)") { editor.step(frames: 1) }
                if !compact {
                    IconButton(symbol: "forward.end.fill", help: "Zum Ende (Ende)") { editor.jumpToEnd() }
                }
                Spacer(minLength: 4)
                Menu {
                    Section(header: Text("Vorschauqualität")) {
                        ForEach(PreviewQuality.allCases) { q in
                            Button {
                                editor.previewQuality = q
                            } label: {
                                Text((editor.previewQuality == q ? "✓ " : "   ") + q.title)
                            }
                        }
                    }
                    Section(header: Text("Format")) {
                        ForEach(AspectPreset.allCases) { a in
                            Button {
                                editor.update { $0.aspect = a }
                            } label: {
                                Text((editor.project.aspect == a ? "✓ " : "   ") + "\(a.title)  –  \(a.subtitle)")
                            }
                        }
                    }
                    Divider()
                    Button("Aktuelles Bild speichern …") { saveFrame() }
                } label: {
                    Label(compact ? editor.project.aspect.title : "\(editor.project.aspect.title) · \(editor.previewQuality.title)", systemImage: "slider.horizontal.3")
                        .font(.system(size: 11))
                }
                .menuStyle(.borderlessButton)
                .fixedSize()
                if !compact {
                    IconButton(symbol: "camera", help: "Aktuelles Bild als PNG speichern") { saveFrame() }
                }
            }
            .padding(.horizontal, 10)
            .frame(width: geo.size.width, height: 40)
        }
        .frame(height: 40)
        .background(Theme.panel)
    }

    private func saveFrame() {
        let panel = NSSavePanel()
        panel.allowedContentTypes = [.png, .jpeg]
        panel.nameFieldStringValue = "\(editor.project.name) Standbild.png"
        if panel.runModal() == .OK, let url = panel.url { editor.exportFrame(to: url) }
    }
}

import SwiftUI
import AppKit

struct InspectorPanel: View {
    @ObservedObject var editor: EditorState

    var body: some View {
        VStack(spacing: 0) {
            switch editor.selection {
            case .main(let id)?, .overlay(let id)?:
                if let c = editor.clip(id), let m = editor.project.mediaItem(c.mediaID) {
                    ClipInspector(editor: editor, clock: editor.clock, clip: c, media: m)
                } else { ProjectInspector(editor: editor) }
            case .audio(let id)?:
                if let c = editor.clip(id) {
                    AudioInspector(editor: editor, clip: c)
                } else { ProjectInspector(editor: editor) }
            case .text(let id)?:
                if let t = editor.text(id) {
                    TextInspector(editor: editor, clock: editor.clock, text: t)
                } else { ProjectInspector(editor: editor) }
            case .effect(let id)?:
                if let e = editor.effect(id) {
                    EffectInspector(editor: editor, effect: e)
                } else { ProjectInspector(editor: editor) }
            case nil:
                ProjectInspector(editor: editor)
            }
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .top)
        .background(Theme.panel)
    }
}

struct InspectorHeader: View {
    let title: String
    let symbol: String
    var onDelete: (() -> Void)?

    var body: some View {
        HStack {
            Image(systemName: symbol).foregroundColor(Theme.accent)
            Text(title).font(.system(size: 13, weight: .semibold)).lineLimit(1)
            Spacer()
            if let d = onDelete {
                IconButton(symbol: "trash", help: "Löschen", action: d)
            }
        }
        .padding(.horizontal, 12)
        .frame(height: 40)
    }
}

struct TabStrip<T: Hashable & Identifiable>: View {
    let tabs: [T]
    @Binding var selection: T
    let title: (T) -> String

    var body: some View {
        ScrollView(.horizontal, showsIndicators: false) {
            HStack(spacing: 4) {
                ForEach(tabs) { t in
                    Button { selection = t } label: {
                        Text(title(t))
                            .font(.system(size: 11, weight: selection == t ? .semibold : .regular))
                            .padding(.horizontal, 9).padding(.vertical, 5)
                            .background(RoundedRectangle(cornerRadius: 6).fill(selection == t ? Theme.accent.opacity(0.2) : Theme.panel2))
                            .foregroundColor(selection == t ? Theme.accent : .white.opacity(0.8))
                    }
                    .buttonStyle(.plain)
                }
            }
            .padding(.horizontal, 10)
        }
        .frame(height: 32)
    }
}

// MARK: - Transformation (gemeinsam für Clip & Text)

struct TransformSection: View {
    @ObservedObject var editor: EditorState
    @ObservedObject var clock: PlaybackClock
    let id: UUID

    var body: some View {
        let kfCount = editor.keyframes(id).count
        let hasKF = editor.hasKeyframe(id)
        SectionBox(title: "Position & Größe", trailing: AnyView(
            HStack(spacing: 2) {
                IconButton(symbol: hasKF ? "diamond.fill" : "diamond", help: "Keyframe am Abspielkopf setzen/entfernen", active: hasKF) { editor.toggleKeyframe(id) }
                if kfCount > 0 {
                    IconButton(symbol: "xmark.circle", help: "Alle Keyframes entfernen") { editor.clearKeyframes(id) }
                }
            }
        )) {
            if kfCount > 0 {
                Text("\(kfCount) Keyframe(s) – Änderungen erzeugen Keyframes am Abspielkopf.")
                    .font(.system(size: 9)).foregroundColor(.yellow.opacity(0.8))
            }
            SliderRow(title: "Position X", value: editor.transformBinding(id, \.x), range: -0.5...1.5, defaultValue: 0.5) { String(format: "%.0f", ($0 - 0.5) * 200) }
            SliderRow(title: "Position Y", value: editor.transformBinding(id, \.y), range: -0.5...1.5, defaultValue: 0.5) { String(format: "%.0f", ($0 - 0.5) * 200) }
            SliderRow(title: "Skalierung", value: editor.transformBinding(id, \.scale), range: 0.05...5, defaultValue: 1) { String(format: "%.0f%%", $0 * 100) }
            SliderRow(title: "Drehung", value: editor.transformBinding(id, \.rotation), range: -180...180, defaultValue: 0) { String(format: "%.0f°", $0) }
            SliderRow(title: "Deckkraft", value: editor.transformBinding(id, \.opacity), range: 0...1, defaultValue: 1) { String(format: "%.0f%%", $0 * 100) }
            HStack(spacing: 6) {
                PillButton(title: "Zentrieren", symbol: "plus.viewfinder") {
                    editor.setTransform(id, key: "center\(id)") { $0.x = 0.5; $0.y = 0.5 }
                }
                PillButton(title: "↻ 90°", symbol: nil) {
                    editor.setTransform(id, key: "rot\(id)") { tr in
                        var r = tr.rotation + 90
                        if r > 180 { r -= 360 }
                        tr.rotation = r
                    }
                }
                PillButton(title: "Reset", symbol: nil) {
                    editor.setTransform(id, key: "reset\(id)") { tr in
                        let o = tr.opacity
                        tr = Transform2D()
                        tr.opacity = o
                    }
                }
            }
        }
    }
}

struct AnimationSection: View {
    let animIn: Binding<AnimSetting>
    let animOut: Binding<AnimSetting>
    let loop: Binding<LoopAnim>
    var allowTypewriter: Bool = false

    var body: some View {
        let kinds = AnimKind.allCases.filter { allowTypewriter || $0 != .typewriter }
        VStack(spacing: 10) {
            SectionBox(title: "Einblenden") {
                animGrid(kinds, selection: animIn)
                if animIn.wrappedValue.kind != .none {
                    SliderRow(title: "Dauer", value: animIn.duration, range: 0.1...3, defaultValue: 0.5) { String(format: "%.1f s", $0) }
                }
            }
            SectionBox(title: "Ausblenden") {
                animGrid(kinds.filter { $0 != .typewriter && $0 != .pop }, selection: animOut)
                if animOut.wrappedValue.kind != .none {
                    SliderRow(title: "Dauer", value: animOut.duration, range: 0.1...3, defaultValue: 0.5) { String(format: "%.1f s", $0) }
                }
            }
            SectionBox(title: "Dauerschleife") {
                LazyVGrid(columns: [GridItem(.adaptive(minimum: 78), spacing: 6)], spacing: 6) {
                    ForEach(LoopAnim.allCases) { l in
                        Button { loop.wrappedValue = l } label: {
                            Text(l.title).font(.system(size: 10)).frame(maxWidth: .infinity).padding(.vertical, 7)
                                .background(RoundedRectangle(cornerRadius: 6).fill(loop.wrappedValue == l ? Theme.accent.opacity(0.25) : Theme.panel3))
                                .foregroundColor(loop.wrappedValue == l ? Theme.accent : .white)
                        }
                        .buttonStyle(.plain)
                    }
                }
            }
        }
    }

    private func animGrid(_ kinds: [AnimKind], selection: Binding<AnimSetting>) -> some View {
        LazyVGrid(columns: [GridItem(.adaptive(minimum: 78), spacing: 6)], spacing: 6) {
            ForEach(kinds) { k in
                Button { selection.wrappedValue.kind = k } label: {
                    Text(k.title).font(.system(size: 10)).frame(maxWidth: .infinity).padding(.vertical, 7)
                        .background(RoundedRectangle(cornerRadius: 6).fill(selection.wrappedValue.kind == k ? Theme.accent.opacity(0.25) : Theme.panel3))
                        .foregroundColor(selection.wrappedValue.kind == k ? Theme.accent : .white)
                }
                .buttonStyle(.plain)
            }
        }
    }
}

// MARK: - Clip (Video / Bild)

enum ClipTab: String, CaseIterable, Identifiable {
    case basic, audio, speed, anim, color, effects, mask, cutout
    var id: String { rawValue }
    var title: String {
        switch self {
        case .basic: return "Bild"
        case .audio: return "Audio"
        case .speed: return "Tempo"
        case .anim: return "Animation"
        case .color: return "Farbe"
        case .effects: return "Effekte"
        case .mask: return "Maske"
        case .cutout: return "Freistellen"
        }
    }
}

struct ClipInspector: View {
    @ObservedObject var editor: EditorState
    @ObservedObject var clock: PlaybackClock
    let clip: Clip
    let media: MediaItem
    @State private var tab: ClipTab = .basic

    var isOverlay: Bool { if case .overlay? = editor.selection { return true }; return false }

    var body: some View {
        let tabs = ClipTab.allCases.filter { t in
            if t == .audio && !(media.kind == .video && media.hasAudio) { return false }
            return true
        }
        VStack(spacing: 0) {
            InspectorHeader(title: clip.name ?? media.name, symbol: media.kind == .image ? "photo" : "film") { editor.deleteSelection() }
            TabStrip(tabs: tabs, selection: $tab) { $0.title }
            Divider().background(Theme.border)
            ScrollView {
                VStack(spacing: 10) {
                    switch tab {
                    case .basic: basic
                    case .audio: AudioControls(editor: editor, clip: clip)
                    case .speed: speed
                    case .anim:
                        AnimationSection(animIn: editor.clipBinding(clip.id, \.animIn, fallback: AnimSetting()),
                                         animOut: editor.clipBinding(clip.id, \.animOut, fallback: AnimSetting()),
                                         loop: editor.clipBinding(clip.id, \.loop, fallback: .none))
                    case .color: color
                    case .effects: effects
                    case .mask: mask
                    case .cutout: cutout
                    }
                }
                .padding(10)
            }
        }
        .onChange(of: clip.id) { _ in if !tabs.contains(tab) { tab = .basic } }
    }

    private func b<T>(_ kp: WritableKeyPath<Clip, T>, _ fallback: T) -> Binding<T> { editor.clipBinding(clip.id, kp, fallback: fallback) }

    @ViewBuilder private var basic: some View {
        TransformSection(editor: editor, clock: clock, id: clip.id)
        SectionBox(title: "Darstellung") {
            Picker("Einpassen", selection: b(\.fitMode, .fit)) {
                Text("Einpassen").tag(FitMode.fit)
                Text("Füllen").tag(FitMode.fill)
            }
            .pickerStyle(.segmented)
            .labelsHidden()
            HStack {
                ToggleRow(title: "Horizontal spiegeln", isOn: b(\.flipH, false))
            }
            ToggleRow(title: "Vertikal spiegeln", isOn: b(\.flipV, false))
            if isOverlay {
                Picker("Mischmodus", selection: b(\.blend, .normal)) {
                    ForEach(BlendMode.allCases) { m in Text(m.title).tag(m) }
                }
                .font(.system(size: 11))
            }
        }
        SectionBox(title: "Zuschneiden") {
            let crop = b(\.crop, CropRect())
            SliderRow(title: "Links", value: Binding(get: { crop.wrappedValue.x }, set: { v in
                var c = crop.wrappedValue; let right = c.x + c.w; c.x = min(v, right - 0.05); c.w = right - c.x; crop.wrappedValue = c
            }), range: 0...0.95, defaultValue: 0) { String(format: "%.0f%%", $0 * 100) }
            SliderRow(title: "Rechts", value: Binding(get: { 1 - crop.wrappedValue.x - crop.wrappedValue.w }, set: { v in
                var c = crop.wrappedValue; c.w = max(0.05, 1 - c.x - v); crop.wrappedValue = c
            }), range: 0...0.95, defaultValue: 0) { String(format: "%.0f%%", $0 * 100) }
            SliderRow(title: "Oben", value: Binding(get: { crop.wrappedValue.y }, set: { v in
                var c = crop.wrappedValue; let bottom = c.y + c.h; c.y = min(v, bottom - 0.05); c.h = bottom - c.y; crop.wrappedValue = c
            }), range: 0...0.95, defaultValue: 0) { String(format: "%.0f%%", $0 * 100) }
            SliderRow(title: "Unten", value: Binding(get: { 1 - crop.wrappedValue.y - crop.wrappedValue.h }, set: { v in
                var c = crop.wrappedValue; c.h = max(0.05, 1 - c.y - v); crop.wrappedValue = c
            }), range: 0...0.95, defaultValue: 0) { String(format: "%.0f%%", $0 * 100) }
            if !clip.crop.isFull {
                PillButton(title: "Zuschnitt zurücksetzen", symbol: "crop") { crop.wrappedValue = CropRect() }
            }
        }
        if media.kind == .image {
            SectionBox(title: "Dauer") {
                SliderRow(title: "Anzeigedauer", value: Binding(get: { clip.sourceDuration }, set: { v in
                    editor.modifyClip(clip.id, key: "imgdur\(clip.id)") { $0.sourceDuration = v; $0.sourceStart = 0 }
                }), range: 0.2...30, defaultValue: 4) { String(format: "%.1f s", $0) }
            }
        }
    }

    @ViewBuilder private var speed: some View {
        SectionBox(title: "Geschwindigkeit") {
            SliderRow(title: "Tempo", value: Binding(get: { log10(clip.speed) }, set: { editor.setSpeed(clip.id, pow(10, $0)) }),
                      range: -1...1, defaultValue: 0) { String(format: "%.2fx", pow(10, $0)) }
            LazyVGrid(columns: [GridItem(.adaptive(minimum: 52), spacing: 6)], spacing: 6) {
                ForEach([0.1, 0.25, 0.5, 0.75, 1, 1.5, 2, 3, 5, 10], id: \.self) { s in
                    Button { editor.setSpeed(clip.id, s) } label: {
                        Text(String(format: "%gx", s)).font(.system(size: 10)).frame(maxWidth: .infinity).padding(.vertical, 6)
                            .background(RoundedRectangle(cornerRadius: 6).fill(abs(clip.speed - s) < 0.001 ? Theme.accent.opacity(0.25) : Theme.panel3))
                    }
                    .buttonStyle(.plain)
                }
            }
            Text("Dauer auf der Timeline: \(formatTime(clip.duration))").font(.system(size: 10)).foregroundColor(Theme.secondaryText)
            Text("Die Tonhöhe bleibt bei Tempoänderungen erhalten.").font(.system(size: 9)).foregroundColor(Theme.secondaryText)
        }
        if media.kind == .video {
            SectionBox(title: "Weitere") {
                PillButton(title: clip.reversed ? "Wieder vorwärts abspielen" : "Rückwärts abspielen", symbol: "backward.fill") { editor.reverseSelected() }
                PillButton(title: "Standbild am Abspielkopf", symbol: "pause.rectangle") { editor.freezeFrame() }
            }
        }
    }

    @ViewBuilder private var color: some View {
        SectionBox(title: "Filter: \(FilterCatalog.title(clip.filter.preset))") {
            SliderRow(title: "Intensität", value: b(\.filter.intensity, 1), range: 0...1, defaultValue: 1) { String(format: "%.0f%%", $0 * 100) }
            PillButton(title: "Filter auswählen …", symbol: "camera.filters") { editor.leftTab = .filters }
        }
        SectionBox(title: "Anpassen", trailing: AnyView(
            Button("Alle zurücksetzen") { editor.modifyClip(clip.id) { $0.adjust = Adjustments() } }
                .buttonStyle(.borderless).font(.system(size: 10))
        )) {
            adjust("Helligkeit", \.brightness)
            adjust("Kontrast", \.contrast)
            adjust("Sättigung", \.saturation)
            adjust("Belichtung", \.exposure)
            adjust("Temperatur", \.temperature)
            adjust("Farbton (Tint)", \.tint)
            adjust("Lichter", \.highlights)
            adjust("Schatten", \.shadows)
            adjust("Dynamik", \.vibrance)
            adjust("Farbverschiebung", \.hue)
            adjust("Schärfe", \.sharpen)
            adjust("Vignette", \.vignette)
            adjust("Körnung", \.grain, range: 0...100)
            adjust("Verblassen", \.fade, range: 0...100)
        }
    }

    private func adjust(_ title: String, _ kp: WritableKeyPath<Adjustments, Double>, range: ClosedRange<Double> = -100...100) -> some View {
        let full = (\Clip.adjust).appending(path: kp)
        return SliderRow(title: title, value: b(full, 0), range: range, defaultValue: 0)
    }

    @ViewBuilder private var effects: some View {
        SectionBox(title: "Clip-Effekte") {
            if clip.effects.isEmpty {
                Text("Noch keine Effekte auf diesem Clip.").font(.system(size: 10)).foregroundColor(Theme.secondaryText)
            }
            ForEach(clip.effects) { fx in
                VStack(alignment: .leading, spacing: 4) {
                    HStack {
                        Image(systemName: fx.kind.symbol).foregroundColor(Theme.accent)
                        Text(fx.kind.title).font(.system(size: 11, weight: .medium))
                        Spacer()
                        Button {
                            editor.modifyClip(clip.id) { $0.effects.removeAll { $0.id == fx.id } }
                        } label: { Image(systemName: "xmark.circle.fill") }
                        .buttonStyle(.borderless)
                    }
                    SliderRow(title: "Stärke", value: Binding(get: { fx.intensity }, set: { v in
                        editor.modifyClip(clip.id, key: "fx\(fx.id)") { c in
                            if let i = c.effects.firstIndex(where: { $0.id == fx.id }) { c.effects[i].intensity = v }
                        }
                    }), range: 0...1, defaultValue: 0.5) { String(format: "%.0f%%", $0 * 100) }
                }
                .padding(6)
                .background(RoundedRectangle(cornerRadius: 6).fill(Theme.panel3))
            }
            Menu {
                ForEach(EffectKind.allCases) { k in
                    Button(k.title) { editor.modifyClip(clip.id) { $0.effects.append(EffectSetting(kind: k)) } }
                }
            } label: {
                Label("Effekt hinzufügen", systemImage: "plus")
            }
            .menuStyle(.borderlessButton)
        }
    }

    @ViewBuilder private var mask: some View {
        let m = b(\.mask, MaskSetting())
        SectionBox(title: "Maske") {
            LazyVGrid(columns: [GridItem(.adaptive(minimum: 70), spacing: 6)], spacing: 6) {
                ForEach(MaskKind.allCases) { k in
                    TileButton(symbol: k.symbol, title: k.title, selected: clip.mask.kind == k) {
                        var s = m.wrappedValue; s.kind = k; m.wrappedValue = s
                    }
                }
            }
            if clip.mask.kind != .none {
                SliderRow(title: "Position X", value: m.x, range: 0...1, defaultValue: 0.5) { String(format: "%.0f", ($0 - 0.5) * 200) }
                SliderRow(title: "Position Y", value: m.y, range: 0...1, defaultValue: 0.5) { String(format: "%.0f", ($0 - 0.5) * 200) }
                if clip.mask.kind != .linear {
                    SliderRow(title: "Größe", value: m.size, range: 0.02...2, defaultValue: 0.5) { String(format: "%.0f%%", $0 * 100) }
                }
                if clip.mask.kind == .circle || clip.mask.kind == .rectangle {
                    SliderRow(title: "Seitenverhältnis", value: m.aspect, range: 0.2...5, defaultValue: 1) { String(format: "%.2f", $0) }
                }
                SliderRow(title: "Drehung", value: m.rotation, range: -180...180, defaultValue: 0) { String(format: "%.0f°", $0) }
                SliderRow(title: "Weiche Kante", value: m.feather, range: 0...1, defaultValue: 0.05) { String(format: "%.0f%%", $0 * 100) }
                ToggleRow(title: "Umkehren", isOn: m.invert)
            }
        }
    }

    @ViewBuilder private var cutout: some View {
        SectionBox(title: "Hintergrund entfernen (KI)") {
            ToggleRow(title: "Person automatisch freistellen", isOn: b(\.removeBackground, false))
            Text("Erkennt Personen in jedem Bild und entfernt den Hintergrund. Ideal für Überlagerungen.")
                .font(.system(size: 9)).foregroundColor(Theme.secondaryText)
        }
        SectionBox(title: "Chroma-Key (Greenscreen)") {
            let ck = b(\.chroma, ChromaKey())
            ToggleRow(title: "Aktivieren", isOn: ck.enabled)
            ColorRow(title: "Schlüsselfarbe", color: ck.color)
            HStack(spacing: 6) {
                PillButton(title: "Grün") { var c = ck.wrappedValue; c.color = RGBA(0, 0.8, 0.1); c.enabled = true; ck.wrappedValue = c }
                PillButton(title: "Blau") { var c = ck.wrappedValue; c.color = RGBA(0, 0.3, 0.95); c.enabled = true; ck.wrappedValue = c }
            }
            SliderRow(title: "Toleranz", value: ck.tolerance, range: 0...1, defaultValue: 0.4) { String(format: "%.0f%%", $0 * 100) }
            SliderRow(title: "Weichheit", value: ck.softness, range: 0...1, defaultValue: 0.1) { String(format: "%.0f%%", $0 * 100) }
        }
    }
}

struct AudioControls: View {
    @ObservedObject var editor: EditorState
    let clip: Clip

    var body: some View {
        SectionBox(title: "Lautstärke") {
            SliderRow(title: "Lautstärke", value: editor.clipBinding(clip.id, \.volume, fallback: 1), range: 0...1, defaultValue: 1) { String(format: "%.0f%%", $0 * 100) }
            ToggleRow(title: "Stumm", isOn: editor.clipBinding(clip.id, \.muted, fallback: false))
            SliderRow(title: "Einblenden", value: editor.clipBinding(clip.id, \.fadeIn, fallback: 0), range: 0...min(10, clip.duration / 2), defaultValue: 0) { String(format: "%.1f s", $0) }
            SliderRow(title: "Ausblenden", value: editor.clipBinding(clip.id, \.fadeOut, fallback: 0), range: 0...min(10, clip.duration / 2), defaultValue: 0) { String(format: "%.1f s", $0) }
        }
        if let m = editor.project.mediaItem(clip.mediaID), m.kind == .video {
            SectionBox(title: "Werkzeuge") {
                PillButton(title: "Audio trennen (eigene Spur)", symbol: "waveform.badge.minus") { editor.detachAudio() }
            }
        }
    }
}

// MARK: - Audio-Clip

struct AudioInspector: View {
    @ObservedObject var editor: EditorState
    let clip: Clip

    var body: some View {
        VStack(spacing: 0) {
            InspectorHeader(title: clip.name ?? "Audio", symbol: "waveform") { editor.deleteSelection() }
            Divider().background(Theme.border)
            ScrollView {
                VStack(spacing: 10) {
                    AudioControls(editor: editor, clip: clip)
                    SectionBox(title: "Tempo") {
                        SliderRow(title: "Tempo", value: Binding(get: { log10(clip.speed) }, set: { editor.setSpeed(clip.id, pow(10, $0)) }),
                                  range: -1...1, defaultValue: 0) { String(format: "%.2fx", pow(10, $0)) }
                        Text("Dauer: \(formatTime(clip.duration))").font(.system(size: 10)).foregroundColor(Theme.secondaryText)
                    }
                    SectionBox(title: "Name") {
                        TextField("Name", text: editor.clipBinding(clip.id, \.name, fallback: nil).unwrapped(""))
                            .textFieldStyle(.roundedBorder)
                    }
                }
                .padding(10)
            }
        }
    }
}

extension Binding where Value == String? {
    func unwrapped(_ fallback: String) -> Binding<String> {
        Binding<String>(get: { self.wrappedValue ?? fallback }, set: { self.wrappedValue = $0 })
    }
}

// MARK: - Text

enum TextTabKind: String, CaseIterable, Identifiable {
    case text, style, position, anim, voice
    var id: String { rawValue }
    var title: String {
        switch self {
        case .text: return "Text"
        case .style: return "Stil"
        case .position: return "Position"
        case .anim: return "Animation"
        case .voice: return "Vorlesen"
        }
    }
}

struct TextInspector: View {
    @ObservedObject var editor: EditorState
    @ObservedObject var clock: PlaybackClock
    let text: TextClip
    @State private var tab: TextTabKind = .text
    @State private var voiceID = ""

    private func s<T>(_ kp: WritableKeyPath<TextStyle, T>, _ fallback: T) -> Binding<T> {
        editor.textBinding(text.id, (\TextClip.style).appending(path: kp), fallback: fallback)
    }

    var body: some View {
        let tabs: [TextTabKind] = text.kind == .text ? TextTabKind.allCases : [.text, .position, .anim]
        VStack(spacing: 0) {
            InspectorHeader(title: text.kind == .text ? (text.isCaption ? "Untertitel" : "Text") : "Sticker",
                            symbol: text.kind == .text ? "textformat" : "face.smiling") { editor.deleteSelection() }
            TabStrip(tabs: tabs, selection: $tab) { $0.title }
            Divider().background(Theme.border)
            ScrollView {
                VStack(spacing: 10) {
                    switch tab {
                    case .text: content
                    case .style: style
                    case .position:
                        TransformSection(editor: editor, clock: clock, id: text.id)
                        SectionBox(title: "Zeit") {
                            SliderRow(title: "Dauer", value: editor.textBinding(text.id, \.duration, fallback: 3), range: 0.1...60, defaultValue: 3) { String(format: "%.1f s", $0) }
                        }
                    case .anim:
                        AnimationSection(animIn: editor.textBinding(text.id, \.animIn, fallback: AnimSetting()),
                                         animOut: editor.textBinding(text.id, \.animOut, fallback: AnimSetting()),
                                         loop: editor.textBinding(text.id, \.loop, fallback: .none),
                                         allowTypewriter: text.kind == .text)
                    case .voice: voice
                    }
                }
                .padding(10)
            }
        }
        .onChange(of: text.id) { _ in if !tabs.contains(tab) { tab = .text } }
    }

    @ViewBuilder private var content: some View {
        switch text.kind {
        case .text:
            SectionBox(title: "Inhalt") {
                TextEditor(text: editor.textBinding(text.id, \.text, fallback: ""))
                    .font(.system(size: 13))
                    .frame(minHeight: 70)
                    .background(Theme.panel3)
                    .cornerRadius(6)
            }
            SectionBox(title: "Schrift") {
                Menu {
                    ForEach(TextCatalog.fonts, id: \.self) { f in
                        Button(f) { editor.modifyText(text.id) { $0.style.fontFamily = f } }
                    }
                    Divider()
                    Menu("Alle Schriften") {
                        ForEach(NSFontManager.shared.availableFontFamilies, id: \.self) { f in
                            Button(f) { editor.modifyText(text.id) { $0.style.fontFamily = f } }
                        }
                    }
                } label: {
                    Text(text.style.fontFamily).font(.custom(text.style.fontFamily, size: 13))
                }
                SliderRow(title: "Größe", value: s(\.fontSize, 72), range: 12...300, defaultValue: 72) { String(format: "%.0f", $0) }
                HStack(spacing: 6) {
                    IconButton(symbol: "bold", help: "Fett", active: text.style.bold) { editor.modifyText(text.id) { $0.style.bold.toggle() } }
                    IconButton(symbol: "italic", help: "Kursiv", active: text.style.italic) { editor.modifyText(text.id) { $0.style.italic.toggle() } }
                    IconButton(symbol: "textformat.size.larger", help: "GROSSBUCHSTABEN", active: text.style.uppercase) { editor.modifyText(text.id) { $0.style.uppercase.toggle() } }
                    Spacer()
                    IconButton(symbol: "text.alignleft", help: "Links", active: text.style.alignment == 0) { editor.modifyText(text.id) { $0.style.alignment = 0 } }
                    IconButton(symbol: "text.aligncenter", help: "Zentriert", active: text.style.alignment == 1) { editor.modifyText(text.id) { $0.style.alignment = 1 } }
                    IconButton(symbol: "text.alignright", help: "Rechts", active: text.style.alignment == 2) { editor.modifyText(text.id) { $0.style.alignment = 2 } }
                }
                ColorRow(title: "Farbe", color: s(\.color, .white))
            }
        case .emoji:
            SectionBox(title: "Emoji") {
                TextField("Emoji", text: editor.textBinding(text.id, \.text, fallback: ""))
                    .textFieldStyle(.roundedBorder)
                SliderRow(title: "Größe", value: s(\.fontSize, 160), range: 20...600, defaultValue: 160) { String(format: "%.0f", $0) }
            }
        case .symbol:
            SectionBox(title: "Symbol") {
                LazyVGrid(columns: [GridItem(.adaptive(minimum: 32), spacing: 4)], spacing: 4) {
                    ForEach(StickerCatalog.symbols, id: \.self) { n in
                        Button { editor.modifyText(text.id) { $0.text = n } } label: {
                            Image(systemName: n).frame(width: 32, height: 32)
                                .background(RoundedRectangle(cornerRadius: 5).fill(text.text == n ? Theme.accent.opacity(0.3) : Theme.panel3))
                        }
                        .buttonStyle(.plain)
                    }
                }
                ColorRow(title: "Farbe", color: s(\.color, .white))
                SliderRow(title: "Größe", value: s(\.fontSize, 110), range: 20...600, defaultValue: 110) { String(format: "%.0f", $0) }
            }
        }
        SectionBox(title: "Zeit") {
            HStack {
                Text("Start \(formatTime(text.start))  ·  Dauer").font(.system(size: 10)).foregroundColor(Theme.secondaryText)
                Spacer()
            }
            SliderRow(title: "Dauer", value: editor.textBinding(text.id, \.duration, fallback: 3), range: 0.1...60, defaultValue: 3) { String(format: "%.1f s", $0) }
        }
    }

    @ViewBuilder private var style: some View {
        SectionBox(title: "Vorlagen") {
            LazyVGrid(columns: [GridItem(.adaptive(minimum: 70), spacing: 6)], spacing: 6) {
                ForEach(TextCatalog.presets) { p in
                    Button {
                        let keep = (text.style.fontSize, text.style.alignment)
                        editor.modifyText(text.id) { t in
                            t.style = p.style
                            t.style.fontSize = keep.0
                            t.style.alignment = keep.1
                        }
                    } label: {
                        ZStack {
                            Theme.panel3
                            if let img = PreviewImages.textPreview(p.style) {
                                Image(nsImage: img).resizable().aspectRatio(contentMode: .fit).padding(4)
                            }
                        }
                        .frame(height: 36)
                        .cornerRadius(5)
                    }
                    .buttonStyle(.plain)
                    .help(p.title)
                }
            }
        }
        SectionBox(title: "Kontur") {
            SliderRow(title: "Stärke", value: s(\.strokeWidth, 0), range: 0...30, defaultValue: 0) { String(format: "%.0f", $0) }
            ColorRow(title: "Farbe", color: s(\.strokeColor, .black))
        }
        SectionBox(title: "Schatten / Leuchten") {
            ToggleRow(title: "Aktiv", isOn: s(\.shadow, false))
            if text.style.shadow {
                ColorRow(title: "Farbe", color: s(\.shadowColor, RGBA(0, 0, 0, 0.8)))
                SliderRow(title: "Weichheit", value: s(\.shadowBlur, 8), range: 0...60, defaultValue: 8) { String(format: "%.0f", $0) }
                SliderRow(title: "Abstand", value: s(\.shadowOffset, 4), range: 0...40, defaultValue: 4) { String(format: "%.0f", $0) }
            }
        }
        SectionBox(title: "Hintergrund") {
            ToggleRow(title: "Aktiv", isOn: s(\.background, false))
            if text.style.background {
                ColorRow(title: "Farbe", color: s(\.backgroundColor, RGBA(0, 0, 0, 0.6)))
                SliderRow(title: "Innenabstand", value: s(\.backgroundPadding, 18), range: 0...80, defaultValue: 18) { String(format: "%.0f", $0) }
                SliderRow(title: "Eckenradius", value: s(\.backgroundCorner, 14), range: 0...80, defaultValue: 14) { String(format: "%.0f", $0) }
            }
        }
        SectionBox(title: "Abstände") {
            SliderRow(title: "Zeichenabstand", value: s(\.letterSpacing, 0), range: -10...40, defaultValue: 0) { String(format: "%.0f", $0) }
            SliderRow(title: "Zeilenabstand", value: s(\.lineSpacing, 0), range: -20...80, defaultValue: 0) { String(format: "%.0f", $0) }
        }
    }

    @ViewBuilder private var voice: some View {
        SectionBox(title: "Text vorlesen lassen") {
            let voices = SpeechSynth.voices(prefix: "")
            Picker("Stimme", selection: $voiceID) {
                Text("Standard").tag("")
                ForEach(voices, id: \.identifier) { v in Text("\(v.name) (\(v.language))").tag(v.identifier) }
            }
            .font(.system(size: 11))
            PillButton(title: "Sprache erzeugen", symbol: "speaker.wave.2.fill", prominent: true) {
                editor.seek(to: text.start)
                editor.textToSpeech(text.text, voiceID: voiceID.isEmpty ? nil : voiceID, rate: 0.5, pitch: 1)
            }
            Text("Die Sprachdatei wird am Anfang des Textes in die Audiospur eingefügt.").font(.system(size: 9)).foregroundColor(Theme.secondaryText)
        }
    }
}

// MARK: - Effekt-Ebene

struct EffectInspector: View {
    @ObservedObject var editor: EditorState
    let effect: EffectClip

    var body: some View {
        VStack(spacing: 0) {
            InspectorHeader(title: "Effekt: \(effect.kind.title)", symbol: effect.kind.symbol) { editor.deleteSelection() }
            Divider().background(Theme.border)
            ScrollView {
                VStack(spacing: 10) {
                    SectionBox(title: "Einstellungen") {
                        SliderRow(title: "Stärke", value: editor.effectBinding(effect.id, \.intensity, fallback: 0.6), range: 0...1, defaultValue: 0.6) { String(format: "%.0f%%", $0 * 100) }
                        SliderRow(title: "Dauer", value: editor.effectBinding(effect.id, \.duration, fallback: 3), range: 0.1...60, defaultValue: 3) { String(format: "%.1f s", $0) }
                    }
                    SectionBox(title: "Effekt ändern") {
                        LazyVGrid(columns: [GridItem(.adaptive(minimum: 74), spacing: 6)], spacing: 6) {
                            ForEach(EffectKind.allCases) { k in
                                TileButton(symbol: k.symbol, title: k.title, selected: effect.kind == k) {
                                    editor.modifyEffect(effect.id) { $0.kind = k }
                                }
                            }
                        }
                    }
                }
                .padding(10)
            }
        }
    }
}

// MARK: - Projekt

struct ProjectInspector: View {
    @ObservedObject var editor: EditorState

    var body: some View {
        VStack(spacing: 0) {
            InspectorHeader(title: "Projekt", symbol: "film.stack")
            Divider().background(Theme.border)
            ScrollView {
                VStack(spacing: 10) {
                    SectionBox(title: "Name") {
                        TextField("Projektname", text: editor.projectBinding(\.name))
                            .textFieldStyle(.roundedBorder)
                    }
                    SectionBox(title: "Format") {
                        LazyVGrid(columns: [GridItem(.adaptive(minimum: 62), spacing: 6)], spacing: 6) {
                            ForEach(AspectPreset.allCases) { a in
                                Button { editor.update { $0.aspect = a } } label: {
                                    VStack(spacing: 4) {
                                        let r = a.canvas.width / a.canvas.height
                                        RoundedRectangle(cornerRadius: 2)
                                            .stroke(editor.project.aspect == a ? Theme.accent : Color.white.opacity(0.7), lineWidth: 1.5)
                                            .frame(width: r >= 1 ? 30 : 30 * r, height: r >= 1 ? 30 / r : 30)
                                            .frame(height: 32)
                                        Text(a.title).font(.system(size: 10))
                                    }
                                    .frame(maxWidth: .infinity)
                                    .padding(.vertical, 6)
                                    .background(RoundedRectangle(cornerRadius: 6).fill(editor.project.aspect == a ? Theme.accent.opacity(0.15) : Theme.panel3))
                                }
                                .buttonStyle(.plain)
                                .help(a.subtitle)
                            }
                        }
                        Picker("Bildrate", selection: editor.projectBinding(\.fps)) {
                            ForEach([24, 25, 30, 50, 60], id: \.self) { f in Text("\(f) fps").tag(f) }
                        }
                        .font(.system(size: 11))
                    }
                    SectionBox(title: "Hintergrund") {
                        Picker("", selection: editor.projectBinding(\.background.mode)) {
                            Text("Farbe").tag(BackgroundMode.color)
                            Text("Unscharf").tag(BackgroundMode.blur)
                        }
                        .pickerStyle(.segmented)
                        .labelsHidden()
                        if editor.project.background.mode == .color {
                            ColorRow(title: "Farbe", color: editor.projectBinding(\.background.color))
                            HStack(spacing: 6) {
                                ForEach([RGBA.black, RGBA.white, RGBA(0.1, 0.1, 0.3), RGBA(0.95, 0.3, 0.5), RGBA(0.1, 0.8, 0.75), RGBA(1, 0.8, 0.2)], id: \.self) { c in
                                    Button { editor.update { $0.background.color = c } } label: {
                                        Circle().fill(c.swiftUI).frame(width: 20, height: 20).overlay(Circle().stroke(Color.white.opacity(0.3)))
                                    }
                                    .buttonStyle(.plain)
                                }
                            }
                        } else {
                            SliderRow(title: "Unschärfe", value: editor.projectBinding(\.background.blur), range: 0...1, defaultValue: 0.5) { String(format: "%.0f%%", $0 * 100) }
                        }
                        Text("Sichtbar, wenn ein Clip nicht das ganze Bild füllt.").font(.system(size: 9)).foregroundColor(Theme.secondaryText)
                    }
                    SectionBox(title: "Info") {
                        infoRow("Dauer", formatTime(editor.duration))
                        infoRow("Auflösung", "\(Int(editor.project.canvasSize.width)) × \(Int(editor.project.canvasSize.height))")
                        infoRow("Clips", "\(editor.project.main.count) Haupt · \(editor.project.overlays.count) Überlagerung · \(editor.project.audio.count) Audio")
                        infoRow("Texte & Sticker", "\(editor.project.texts.count)")
                        infoRow("Effekt-Ebenen", "\(editor.project.effects.count)")
                    }
                    Text("Tipp: Klicke auf einen Clip in der Timeline, um ihn zu bearbeiten.")
                        .font(.system(size: 10)).foregroundColor(Theme.secondaryText)
                }
                .padding(10)
            }
        }
    }

    private func infoRow(_ a: String, _ b: String) -> some View {
        HStack {
            Text(a).font(.system(size: 10)).foregroundColor(Theme.secondaryText)
            Spacer()
            Text(b).font(.system(size: 10)).multilineTextAlignment(.trailing)
        }
    }
}

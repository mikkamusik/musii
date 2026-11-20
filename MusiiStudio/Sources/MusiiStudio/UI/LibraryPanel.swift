import SwiftUI
import AppKit
import AVFoundation
import UniformTypeIdentifiers

struct LibraryPanel: View {
    @ObservedObject var editor: EditorState

    var body: some View {
        HStack(spacing: 0) {
            VStack(spacing: 2) {
                ForEach(LeftTab.allCases) { tab in
                    Button {
                        editor.leftTab = tab
                    } label: {
                        VStack(spacing: 3) {
                            Image(systemName: tab.symbol).font(.system(size: 16))
                            Text(tab.title).font(.system(size: 9))
                        }
                        .frame(width: 62, height: 50)
                        .foregroundColor(editor.leftTab == tab ? Theme.accent : .white.opacity(0.75))
                        .background(RoundedRectangle(cornerRadius: 8).fill(editor.leftTab == tab ? Theme.accent.opacity(0.12) : Color.clear))
                        .contentShape(Rectangle())
                    }
                    .buttonStyle(.plain)
                }
                Spacer()
            }
            .padding(.vertical, 8)
            .padding(.horizontal, 4)
            .background(Theme.panel)
            Divider().background(Theme.border)
            Group {
                switch editor.leftTab {
                case .media: MediaTab(editor: editor)
                case .audio: AudioTab(editor: editor, recorder: editor.recorder)
                case .text: TextTab(editor: editor)
                case .stickers: StickerTab(editor: editor)
                case .effects: EffectsTab(editor: editor)
                case .transitions: TransitionsTab(editor: editor)
                case .filters: FiltersTab(editor: editor)
                case .captions: CaptionsTab(editor: editor)
                }
            }
            .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .top)
            .background(Theme.panel)
        }
    }
}

func openMediaPanel(audioOnly: Bool = false) -> [URL] {
    let panel = NSOpenPanel()
    panel.allowsMultipleSelection = true
    panel.canChooseDirectories = false
    panel.allowedContentTypes = audioOnly ? [.audio, .mp3, .wav, .aiff, .mpeg4Audio] : MediaImporter.allowedTypes
    panel.message = audioOnly ? "Musik oder Audio auswählen" : "Videos, Fotos oder Audio auswählen"
    return panel.runModal() == .OK ? panel.urls : []
}

struct TabHeader: View {
    let title: String
    var body: some View {
        Text(title)
            .font(.system(size: 14, weight: .semibold))
            .frame(maxWidth: .infinity, alignment: .leading)
            .padding(.horizontal, 12)
            .padding(.top, 12)
            .padding(.bottom, 6)
    }
}

// MARK: - Medien

struct MediaTab: View {
    @ObservedObject var editor: EditorState
    @ObservedObject var thumbs = ThumbStore.shared
    @State private var targeted = false

    var body: some View {
        VStack(spacing: 0) {
            TabHeader(title: "Medien")
            HStack(spacing: 8) {
                PillButton(title: "Importieren", symbol: "square.and.arrow.down", prominent: true) {
                    editor.importMedia(openMediaPanel(), addToTimeline: false)
                }
                PillButton(title: "Direkt in Timeline", symbol: "plus.rectangle.on.rectangle") {
                    editor.importMedia(openMediaPanel(), addToTimeline: true)
                }
            }
            .padding(.horizontal, 12)
            ScrollView {
                if editor.project.media.isEmpty {
                    EmptyHint(symbol: "square.and.arrow.down.on.square", text: "Dateien hierher ziehen\noder „Importieren“ klicken.\n\nVideo: MP4, MOV, M4V …\nFoto: JPG, PNG, HEIC …\nAudio: MP3, M4A, WAV …")
                        .padding(.top, 30)
                }
                LazyVGrid(columns: [GridItem(.adaptive(minimum: 110), spacing: 8)], spacing: 8) {
                    ForEach(editor.project.media.filter { !$0.generated || $0.kind != .audio }) { m in
                        MediaCell(editor: editor, media: m, poster: thumbs.poster(m.id))
                    }
                }
                .padding(12)
            }
            .overlay(RoundedRectangle(cornerRadius: 8).stroke(Theme.accent, lineWidth: targeted ? 2 : 0).padding(4))
            .onDrop(of: [UTType.fileURL], isTargeted: $targeted) { providers in
                loadDroppedURLs(providers) { editor.importMedia($0, addToTimeline: false) }
                return true
            }
        }
    }
}

struct MediaCell: View {
    @ObservedObject var editor: EditorState
    let media: MediaItem
    let poster: NSImage?
    @State private var hover = false

    var body: some View {
        VStack(alignment: .leading, spacing: 4) {
            ZStack(alignment: .bottomTrailing) {
                ZStack {
                    Theme.panel3
                    if let p = poster {
                        Image(nsImage: p).resizable().aspectRatio(contentMode: .fill)
                    } else {
                        Image(systemName: media.kind == .audio ? "music.note" : (media.kind == .image ? "photo" : "film"))
                            .font(.system(size: 22)).foregroundColor(Theme.secondaryText)
                    }
                }
                .frame(height: 70)
                .clipped()
                if media.kind != .image {
                    Text(formatTime(media.duration))
                        .font(.system(size: 9, design: .monospaced))
                        .padding(.horizontal, 4).padding(.vertical, 1)
                        .background(Color.black.opacity(0.6))
                        .cornerRadius(3)
                        .padding(4)
                }
                if hover {
                    Button {
                        editor.addToTimelineAuto(media)
                    } label: {
                        Image(systemName: "plus.circle.fill").font(.system(size: 22)).foregroundColor(Theme.accent)
                            .background(Circle().fill(Color.black))
                    }
                    .buttonStyle(.plain)
                    .help("Zur Timeline hinzufügen")
                    .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topTrailing)
                    .padding(4)
                }
            }
            .frame(height: 70)
            .cornerRadius(6)
            .overlay(RoundedRectangle(cornerRadius: 6).stroke(media.exists ? Color.clear : Color.red, lineWidth: 1.5))
            Text(media.name).font(.system(size: 10)).lineLimit(1).foregroundColor(.white.opacity(0.8))
        }
        .onHover { hover = $0 }
        .onTapGesture(count: 2) { editor.addToTimelineAuto(media) }
        .contextMenu {
            if media.isVisual {
                Button("Zur Hauptspur hinzufügen") { editor.addToMain(media) }
                Button("Als Überlagerung (Bild-in-Bild)") { editor.addOverlay(media) }
            }
            if media.hasAudio {
                Button(media.kind == .video ? "Nur Ton als Audio-Spur" : "Zur Audio-Spur hinzufügen") { editor.addAudio(media, at: editor.clock.time) }
            }
            Divider()
            Button("Im Finder zeigen") { NSWorkspace.shared.activateFileViewerSelecting([media.url]) }
            Button("Aus Projekt entfernen") { editor.deleteMedia(media) }
        }
        .help(media.name)
    }
}

// MARK: - Audio

struct AudioTab: View {
    @ObservedObject var editor: EditorState
    @ObservedObject var recorder: VoiceRecorder
    @State private var ttsText = ""
    @State private var voiceID: String = ""
    @State private var rate: Double = 0.5
    @State private var pitch: Double = 1
    @State private var language = "de"

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 12) {
                TabHeader(title: "Audio").padding(.horizontal, -12)
                PillButton(title: "Musik / Audio importieren", symbol: "music.note.list", prominent: true) {
                    let urls = openMediaPanel(audioOnly: true)
                    guard !urls.isEmpty else { return }
                    editor.importMedia(urls, addToTimeline: true)
                }
                let audioMedia = editor.project.media.filter { $0.kind == .audio }
                if !audioMedia.isEmpty {
                    SectionBox(title: "Audio im Projekt") {
                        ForEach(audioMedia) { m in
                            HStack {
                                Image(systemName: "waveform").foregroundColor(Theme.accent)
                                VStack(alignment: .leading) {
                                    Text(m.name).font(.system(size: 11)).lineLimit(1)
                                    Text(formatTime(m.duration)).font(.system(size: 9)).foregroundColor(Theme.secondaryText)
                                }
                                Spacer()
                                Button { editor.addAudio(m, at: editor.clock.time) } label: { Image(systemName: "plus.circle.fill") }
                                    .buttonStyle(.borderless)
                                    .help("Am Abspielkopf einfügen")
                            }
                        }
                    }
                }

                SectionBox(title: "Sprachaufnahme (Voiceover)") {
                    HStack(spacing: 12) {
                        Button {
                            if recorder.isRecording { editor.stopVoiceRecording() } else { editor.startVoiceRecording() }
                        } label: {
                            ZStack {
                                Circle().fill(recorder.isRecording ? Color.red : Theme.panel3).frame(width: 44, height: 44)
                                Image(systemName: recorder.isRecording ? "stop.fill" : "mic.fill").foregroundColor(.white)
                            }
                        }
                        .buttonStyle(.plain)
                        VStack(alignment: .leading, spacing: 4) {
                            Text(recorder.isRecording ? "Aufnahme läuft … \(formatTime(recorder.elapsed))" : "Startet am Abspielkopf")
                                .font(.system(size: 11))
                            GeometryReader { g in
                                ZStack(alignment: .leading) {
                                    Capsule().fill(Theme.panel3)
                                    Capsule().fill(Theme.accent).frame(width: g.size.width * CGFloat(recorder.level))
                                }
                            }
                            .frame(height: 6)
                        }
                    }
                }

                SectionBox(title: "Text zu Sprache") {
                    TextEditor(text: $ttsText)
                        .font(.system(size: 12))
                        .frame(height: 70)
                        .background(Theme.panel3)
                        .cornerRadius(6)
                    Picker("Sprache", selection: $language) {
                        Text("Deutsch").tag("de")
                        Text("Englisch").tag("en")
                        Text("Französisch").tag("fr")
                        Text("Spanisch").tag("es")
                        Text("Italienisch").tag("it")
                        Text("Türkisch").tag("tr")
                        Text("Alle").tag("")
                    }
                    .font(.system(size: 11))
                    let voices = SpeechSynth.voices(prefix: language)
                    Picker("Stimme", selection: $voiceID) {
                        Text("Standard").tag("")
                        ForEach(voices, id: \.identifier) { v in
                            Text("\(v.name) (\(v.language))").tag(v.identifier)
                        }
                    }
                    .font(.system(size: 11))
                    SliderRow(title: "Tempo", value: $rate, range: 0.1...0.9, defaultValue: 0.5) { String(format: "%.0f%%", $0 / 0.5 * 100) }
                    SliderRow(title: "Tonhöhe", value: $pitch, range: 0.5...2, defaultValue: 1) { String(format: "%.2f", $0) }
                    PillButton(title: "Sprache erzeugen & einfügen", symbol: "waveform.and.mic", prominent: true) {
                        editor.textToSpeech(ttsText, voiceID: voiceID.isEmpty ? (voices.first?.identifier) : voiceID, rate: Float(rate), pitch: Float(pitch))
                    }
                    Text("Weitere Stimmen: Systemeinstellungen › Bedienungshilfen › Gesprochene Inhalte › Systemstimme › Anpassen.")
                        .font(.system(size: 9)).foregroundColor(Theme.secondaryText)
                }

                SectionBox(title: "Werkzeuge") {
                    PillButton(title: "Audio vom ausgewählten Video trennen", symbol: "waveform.badge.minus") { editor.detachAudio() }
                }
            }
            .padding(12)
        }
    }
}

// MARK: - Text

struct TextTab: View {
    @ObservedObject var editor: EditorState

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 12) {
                TabHeader(title: "Text").padding(.horizontal, -12)
                PillButton(title: "Text hinzufügen", symbol: "plus", prominent: true) {
                    editor.addText(style: TextStyle())
                }
                SectionBox(title: "Vorlagen") {
                    LazyVGrid(columns: [GridItem(.adaptive(minimum: 96), spacing: 8)], spacing: 8) {
                        ForEach(TextCatalog.presets) { p in
                            Button {
                                if case .text(let id)? = editor.selection, editor.text(id)?.kind == .text {
                                    editor.modifyText(id) { $0.style = p.style }
                                } else {
                                    editor.addText(style: p.style)
                                }
                            } label: {
                                VStack(spacing: 4) {
                                    ZStack {
                                        Theme.panel3
                                        if let img = PreviewImages.textPreview(p.style) {
                                            Image(nsImage: img).resizable().aspectRatio(contentMode: .fit).padding(6)
                                        }
                                    }
                                    .frame(height: 50)
                                    .cornerRadius(6)
                                    Text(p.title).font(.system(size: 10)).foregroundColor(.white.opacity(0.8))
                                }
                            }
                            .buttonStyle(.plain)
                        }
                    }
                }
                Text("Tipp: Ist ein Text ausgewählt, wendet ein Klick auf eine Vorlage deren Stil an. Im Vorschaufenster kannst du Texte verschieben und mit zwei Fingern skalieren.")
                    .font(.system(size: 10)).foregroundColor(Theme.secondaryText)
            }
            .padding(12)
        }
    }
}

// MARK: - Sticker

struct StickerTab: View {
    @ObservedObject var editor: EditorState

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 12) {
                TabHeader(title: "Sticker").padding(.horizontal, -12)
                ForEach(StickerCatalog.emojiGroups, id: \.0) { group in
                    SectionBox(title: group.0) {
                        LazyVGrid(columns: [GridItem(.adaptive(minimum: 36), spacing: 4)], spacing: 4) {
                            ForEach(group.1, id: \.self) { e in
                                Button { editor.addEmoji(e) } label: {
                                    Text(e).font(.system(size: 24)).frame(width: 36, height: 36)
                                        .background(RoundedRectangle(cornerRadius: 6).fill(Theme.panel3))
                                }
                                .buttonStyle(.plain)
                            }
                        }
                    }
                }
                SectionBox(title: "Symbole") {
                    LazyVGrid(columns: [GridItem(.adaptive(minimum: 36), spacing: 4)], spacing: 4) {
                        ForEach(StickerCatalog.symbols, id: \.self) { s in
                            Button { editor.addSymbol(s) } label: {
                                Image(systemName: s).font(.system(size: 18)).frame(width: 36, height: 36)
                                    .background(RoundedRectangle(cornerRadius: 6).fill(Theme.panel3))
                            }
                            .buttonStyle(.plain)
                        }
                    }
                }
                SectionBox(title: "Eigene Bilder") {
                    Text("PNG-Dateien mit Transparenz als Sticker: im Tab „Medien“ importieren und per Rechtsklick „Als Überlagerung“ hinzufügen.")
                        .font(.system(size: 10)).foregroundColor(Theme.secondaryText)
                }
            }
            .padding(12)
        }
    }
}

// MARK: - Effekte

struct EffectsTab: View {
    @ObservedObject var editor: EditorState
    @State private var onClip = false

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 12) {
                TabHeader(title: "Effekte").padding(.horizontal, -12)
                Picker("", selection: $onClip) {
                    Text("Als Ebene").tag(false)
                    Text("Auf ausgewählten Clip").tag(true)
                }
                .pickerStyle(.segmented)
                .labelsHidden()
                Text(onClip ? "Der Effekt wird dem ausgewählten Clip hinzugefügt." : "Der Effekt wird als eigene Ebene am Abspielkopf eingefügt und wirkt auf alles darunter.")
                    .font(.system(size: 10)).foregroundColor(Theme.secondaryText)
                LazyVGrid(columns: [GridItem(.adaptive(minimum: 80), spacing: 8)], spacing: 8) {
                    ForEach(EffectKind.allCases) { k in
                        TileButton(symbol: k.symbol, title: k.title) {
                            if onClip { editor.addEffectToSelectedClip(k) } else { editor.addEffectLayer(k) }
                        }
                    }
                }
            }
            .padding(12)
        }
    }
}

// MARK: - Übergänge

struct TransitionsTab: View {
    @ObservedObject var editor: EditorState

    var body: some View {
        let currentClip: Clip? = {
            if case .main(let id)? = editor.selection { return editor.clip(id) }
            return nil
        }()
        ScrollView {
            VStack(alignment: .leading, spacing: 12) {
                TabHeader(title: "Übergänge").padding(.horizontal, -12)
                Text(editor.project.main.count < 2 ? "Füge mindestens zwei Clips zur Hauptspur hinzu." :
                        "Wähle einen Clip auf der Hauptspur (oder klicke auf das ＋ zwischen zwei Clips) und dann einen Übergang.")
                    .font(.system(size: 10)).foregroundColor(Theme.secondaryText)
                if let c = currentClip, let t = c.transition, let i = editor.project.mainIndex(of: c.id) {
                    SectionBox(title: "Aktueller Übergang: \(t.kind.title)") {
                        SliderRow(title: "Dauer", value: Binding(get: { t.duration }, set: { v in
                            editor.modifyClip(c.id, key: "transdur\(c.id)") { $0.transition?.duration = v }
                        }), range: 0.1...3, defaultValue: 0.6) { String(format: "%.1f s", $0) }
                        if editor.project.transitionTicks(after: i) < TimeGrid.ticks(t.duration) {
                            Text("Begrenzt durch die Clip-Länge.").font(.system(size: 9)).foregroundColor(Theme.secondaryText)
                        }
                    }
                }
                LazyVGrid(columns: [GridItem(.adaptive(minimum: 80), spacing: 8)], spacing: 8) {
                    ForEach(TransitionKind.allCases) { k in
                        TileButton(symbol: k.symbol, title: k.title, selected: (currentClip?.transition?.kind ?? TransitionKind.none) == k && currentClip != nil) {
                            editor.applyTransition(k)
                        }
                    }
                }
                PillButton(title: "Ausgewählten Übergang auf alle anwenden", symbol: "square.stack.3d.forward.dottedline") {
                    editor.applyTransition(currentClip?.transition?.kind ?? .dissolve, toAll: true)
                }
            }
            .padding(12)
        }
    }
}

// MARK: - Filter

struct FiltersTab: View {
    @ObservedObject var editor: EditorState
    @ObservedObject var thumbs = ThumbStore.shared

    var body: some View {
        let clip = editor.selectedClip
        let media = editor.selectedMedia
        let base = media.flatMap { thumbs.poster($0.id) }
        ScrollView {
            VStack(alignment: .leading, spacing: 12) {
                TabHeader(title: "Filter").padding(.horizontal, -12)
                if let c = clip, media?.isVisual == true {
                    SectionBox(title: "Stärke: \(FilterCatalog.title(c.filter.preset))") {
                        SliderRow(title: "Intensität", value: editor.clipBinding(c.id, \.filter.intensity, fallback: 1), range: 0...1, defaultValue: 1) { String(format: "%.0f%%", $0 * 100) }
                    }
                } else {
                    Text("Wähle einen Video- oder Bild-Clip aus, um einen Filter anzuwenden.")
                        .font(.system(size: 10)).foregroundColor(Theme.secondaryText)
                }
                LazyVGrid(columns: [GridItem(.adaptive(minimum: 84), spacing: 8)], spacing: 8) {
                    ForEach(FilterCatalog.all) { f in
                        Button { editor.applyFilter(f.id) } label: {
                            VStack(spacing: 3) {
                                ZStack {
                                    Theme.panel3
                                    if let img = PreviewImages.filterPreview(f.id, base: base) {
                                        Image(nsImage: img).resizable().aspectRatio(contentMode: .fill)
                                    }
                                }
                                .frame(height: 54)
                                .clipped()
                                .cornerRadius(6)
                                .overlay(RoundedRectangle(cornerRadius: 6).stroke(Theme.accent, lineWidth: clip?.filter.preset == f.id ? 2 : 0))
                                Text(f.title).font(.system(size: 10)).lineLimit(1).foregroundColor(.white.opacity(0.85))
                            }
                        }
                        .buttonStyle(.plain)
                    }
                }
                PillButton(title: "Filter auf alle Clips der Hauptspur", symbol: "square.stack.3d.up") {
                    editor.applyFilter(clip?.filter.preset ?? "none", toAll: true)
                }
            }
            .padding(12)
        }
    }
}

// MARK: - Untertitel

struct CaptionsTab: View {
    @ObservedObject var editor: EditorState
    @ObservedObject var settings = AppSettings.shared
    @State private var presetID = "subtitle"

    var body: some View {
        let style = TextCatalog.presets.first { $0.id == presetID }?.style ?? TextStyle()
        let count = editor.project.texts.filter { $0.isCaption }.count
        ScrollView {
            VStack(alignment: .leading, spacing: 12) {
                TabHeader(title: "Automatische Untertitel").padding(.horizontal, -12)
                Text("Erkennt gesprochene Sprache in deinen Clips und erstellt daraus Untertitel – mit macOS-Spracherkennung.")
                    .font(.system(size: 10)).foregroundColor(Theme.secondaryText)
                SectionBox(title: "Einstellungen") {
                    Picker("Sprache", selection: $settings.captionLanguage) {
                        ForEach(CaptionGenerator.languages, id: \.0) { l in Text(l.1).tag(l.0) }
                    }
                    .font(.system(size: 11))
                    Picker("Stil", selection: $presetID) {
                        ForEach(TextCatalog.presets) { p in Text(p.title).tag(p.id) }
                    }
                    .font(.system(size: 11))
                    if let img = PreviewImages.textPreview(style, text: "Untertitel") {
                        Image(nsImage: img).resizable().aspectRatio(contentMode: .fit).frame(height: 36)
                            .frame(maxWidth: .infinity)
                            .padding(6)
                            .background(Theme.panel3).cornerRadius(6)
                    }
                }
                PillButton(title: "Untertitel erstellen", symbol: "captions.bubble.fill", prominent: true) {
                    editor.generateCaptions(locale: settings.captionLanguage, style: style)
                }
                if count > 0 {
                    SectionBox(title: "\(count) Untertitel im Projekt") {
                        PillButton(title: "Stil auf alle Untertitel anwenden", symbol: "paintbrush") { editor.restyleCaptions(style) }
                        PillButton(title: "Alle Untertitel löschen", symbol: "trash") {
                            editor.update { $0.texts.removeAll { $0.isCaption } }
                        }
                    }
                }
                Text("Einzelne Untertitel kannst du in der Timeline auswählen und rechts im Text-Bereich korrigieren.")
                    .font(.system(size: 10)).foregroundColor(Theme.secondaryText)
            }
            .padding(12)
        }
    }
}

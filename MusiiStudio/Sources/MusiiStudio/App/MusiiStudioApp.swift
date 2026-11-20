import SwiftUI
import AppKit

final class AppModel: ObservableObject {
    static let shared = AppModel()
    @Published var editor: EditorState?

    func open(_ id: UUID) {
        guard let p = ProjectStore.shared.load(id) else { return }
        editor?.saveNow()
        editor?.pause()
        editor = EditorState(project: p)
    }

    func newProject(aspect: AspectPreset, importing urls: [URL]) {
        let df = DateFormatter()
        df.dateFormat = "dd.MM.yyyy HH:mm"
        let p = ProjectStore.shared.create(name: "Projekt \(df.string(from: Date()))", aspect: aspect)
        open(p.id)
        if !urls.isEmpty { editor?.importMedia(urls, addToTimeline: true) }
    }

    func closeEditor() {
        editor?.saveNow()
        editor?.pause()
        editor?.player.replaceCurrentItem(with: nil)
        editor = nil
        ProjectStore.shared.reload()
    }
}

struct RootView: View {
    @ObservedObject var model: AppModel

    var body: some View {
        Group {
            if let e = model.editor {
                EditorView(model: model, editor: e)
            } else {
                HomeView(model: model)
            }
        }
        .frame(minWidth: 1180, minHeight: 720)
        .preferredColorScheme(.dark)
    }
}

struct MusiiStudioApp: App {
    @NSApplicationDelegateAdaptor(AppDelegate.self) var delegate

    var body: some Scene {
        WindowGroup {
            RootView(model: AppModel.shared)
        }
        .commands { StudioCommands() }
    }
}

struct StudioCommands: Commands {
    private var editor: EditorState? { AppModel.shared.editor }

    private func textIsFocused() -> Bool {
        NSApp.keyWindow?.firstResponder is NSText
    }

    var body: some Commands {
        CommandGroup(replacing: .newItem) {
            Button("Neues Projekt") { AppModel.shared.newProject(aspect: .r16x9, importing: []) }
                .keyboardShortcut("n", modifiers: .command)
            Button("Medien importieren …") {
                let urls = openMediaPanel()
                if let e = AppModel.shared.editor { e.importMedia(urls, addToTimeline: false) }
                else if !urls.isEmpty { AppModel.shared.newProject(aspect: .r16x9, importing: urls) }
            }
            .keyboardShortcut("i", modifiers: .command)
            Button("Zur Projektübersicht") { AppModel.shared.closeEditor() }
                .keyboardShortcut("h", modifiers: [.command, .shift])
        }
        CommandGroup(replacing: .saveItem) {
            Button("Speichern") { editor?.saveNow() }
                .keyboardShortcut("s", modifiers: .command)
            Button("Exportieren …") { editor?.showExport = true }
                .keyboardShortcut("e", modifiers: .command)
        }
        CommandGroup(replacing: .undoRedo) {
            Button("Rückgängig") {
                if textIsFocused() { NSApp.sendAction(Selector(("undo:")), to: nil, from: nil) } else { editor?.undo() }
            }
            .keyboardShortcut("z", modifiers: .command)
            Button("Wiederholen") {
                if textIsFocused() { NSApp.sendAction(Selector(("redo:")), to: nil, from: nil) } else { editor?.redo() }
            }
            .keyboardShortcut("z", modifiers: [.command, .shift])
        }
        CommandMenu("Clip") {
            Button("Am Abspielkopf teilen") { editor?.splitAtPlayhead() }
                .keyboardShortcut("b", modifiers: .command)
            Button("Duplizieren") { editor?.duplicateSelection() }
                .keyboardShortcut("d", modifiers: .command)
            Button("Löschen") { editor?.deleteSelection() }
            Divider()
            Button("Standbild einfügen") { editor?.freezeFrame() }
                .keyboardShortcut("f", modifiers: [.command, .option])
            Button("Rückwärts abspielen") { editor?.reverseSelected() }
                .keyboardShortcut("r", modifiers: [.command, .option])
            Button("Audio trennen") { editor?.detachAudio() }
                .keyboardShortcut("a", modifiers: [.command, .option])
            Button("Keyframe setzen/entfernen") {
                if let e = editor, let id = e.selection?.id { e.toggleKeyframe(id) }
            }
            .keyboardShortcut("k", modifiers: .option)
            Divider()
            Button("Text hinzufügen") { editor?.addText(style: TextStyle()) }
                .keyboardShortcut("t", modifiers: [.command, .option])
        }
        CommandMenu("Wiedergabe") {
            Button("Abspielen / Pause  (Leertaste)") { editor?.togglePlay() }
            Button("Zum Anfang") { editor?.jumpToStart() }
            Button("Zum Ende") { editor?.jumpToEnd() }
            Button("Ein Bild vor  (→)") { editor?.step(frames: 1) }
            Button("Ein Bild zurück  (←)") { editor?.step(frames: -1) }
        }
        CommandMenu("Ansicht") {
            Button("Timeline hineinzoomen") { if let e = editor { e.pps = min(600, e.pps * 1.4) } }
                .keyboardShortcut("+", modifiers: .command)
            Button("Timeline herauszoomen") { if let e = editor { e.pps = max(4, e.pps / 1.4) } }
                .keyboardShortcut("-", modifiers: .command)
            Button("Ganzes Projekt anzeigen") { NotificationCenter.default.post(name: .musiiFitTimeline, object: nil) }
                .keyboardShortcut("0", modifiers: .command)
            Divider()
            ForEach(PreviewQuality.allCases) { q in
                Button("Vorschauqualität: \(q.title)") { editor?.previewQuality = q }
            }
        }
    }
}

final class AppDelegate: NSObject, NSApplicationDelegate {
    private var monitor: Any?

    func applicationDidFinishLaunching(_ notification: Notification) {
        NSApp.setActivationPolicy(.regular)
        NSApp.activate(ignoringOtherApps: true)
        ProjectStore.shared.reload()
        Task { _ = try? await BlackVideo.ensure() }
        monitor = NSEvent.addLocalMonitorForEvents(matching: .keyDown) { event in
            AppDelegate.handleKey(event) ? nil : event
        }
        DispatchQueue.main.asyncAfter(deadline: .now() + 0.3) {
            if let w = NSApp.windows.first, w.frame.width < 1300 {
                let screen = w.screen?.visibleFrame ?? NSRect(x: 0, y: 0, width: 1440, height: 900)
                let width = min(1560, screen.width - 40), height = min(960, screen.height - 40)
                w.setFrame(NSRect(x: screen.midX - width / 2, y: screen.midY - height / 2, width: width, height: height), display: true)
            }
        }
        if let path = ProcessInfo.processInfo.environment["MUSII_SNAPSHOT_DIR"] {
            Snapshot.run(outputDir: URL(fileURLWithPath: path))
        }
    }

    func applicationShouldTerminateAfterLastWindowClosed(_ sender: NSApplication) -> Bool { true }

    func applicationWillTerminate(_ notification: Notification) {
        AppModel.shared.editor?.saveNow()
    }

    static func handleKey(_ event: NSEvent) -> Bool {
        guard let editor = AppModel.shared.editor else { return false }
        guard let window = NSApp.keyWindow, window.sheetParent == nil, !window.isSheet else { return false }
        if window.firstResponder is NSText { return false }
        let mods = event.modifierFlags.intersection([.command, .control, .option])
        guard mods.isEmpty else { return false }
        let shift = event.modifierFlags.contains(.shift)
        switch event.keyCode {
        case 49: editor.togglePlay(); return true                         // Leertaste
        case 123: editor.step(frames: shift ? -10 : -1); return true      // ←
        case 124: editor.step(frames: shift ? 10 : 1); return true        // →
        case 51, 117: editor.deleteSelection(); return true               // ⌫ / Entf
        case 115: editor.jumpToStart(); return true                       // Pos1
        case 119: editor.jumpToEnd(); return true                         // Ende
        case 53: editor.selection = nil; return true                      // Esc
        default: break
        }
        switch event.charactersIgnoringModifiers?.lowercased() {
        case "s": editor.splitAtPlayhead(); return true
        case "k": editor.pause(); return true
        case "l": editor.play(); return true
        case "j": editor.step(frames: -Int(editor.project.fps)); return true
        default: return false
        }
    }
}

// MARK: - Bildschirmfotos für automatische Tests

enum Snapshot {
    static func capture(_ name: String, dir: URL) {
        guard let window = NSApp.windows.first(where: { $0.isVisible }) ?? NSApp.windows.first,
              let view = window.contentView else { return }
        let rect = view.bounds
        guard let rep = view.bitmapImageRepForCachingDisplay(in: rect) else { return }
        view.cacheDisplay(in: rect, to: rep)
        if let data = rep.representation(using: .png, properties: [:]) {
            try? data.write(to: dir.appendingPathComponent(name))
        }
    }

    static func run(outputDir: URL) {
        try? FileManager.default.createDirectory(at: outputDir, withIntermediateDirectories: true)
        DispatchQueue.main.asyncAfter(deadline: .now() + 3) {
            capture("1-start.png", dir: outputDir)
            let demo = ProcessInfo.processInfo.environment["MUSII_DEMO_DIR"].map { URL(fileURLWithPath: $0) }
            let urls = demo.flatMap { try? FileManager.default.contentsOfDirectory(at: $0, includingPropertiesForKeys: nil) }?
                .filter { MediaImporter.kind(for: $0) != nil }
                .sorted { $0.lastPathComponent < $1.lastPathComponent } ?? []
            AppModel.shared.newProject(aspect: .r16x9, importing: urls)
            DispatchQueue.main.asyncAfter(deadline: .now() + 5) {
                if let e = AppModel.shared.editor {
                    var style = TextCatalog.presets[1].style
                    style.fontSize = 90
                    e.addText(style: style, text: "Musii Studio", y: 0.2)
                    e.addEmoji("🔥")
                    e.applyTransition(.dissolve, toAll: true)
                    e.addEffectLayer(.sparkle)
                    e.seek(to: 1.2)
                    if let first = e.project.main.first { e.selection = .main(first.id) }
                }
                DispatchQueue.main.asyncAfter(deadline: .now() + 4) {
                    capture("2-editor.png", dir: outputDir)
                    AppModel.shared.editor?.leftTab = .effects
                    if let t = AppModel.shared.editor?.project.texts.first { AppModel.shared.editor?.selection = .text(t.id) }
                    DispatchQueue.main.asyncAfter(deadline: .now() + 2) {
                        capture("3-text.png", dir: outputDir)
                        AppModel.shared.editor?.showExport = true
                        DispatchQueue.main.asyncAfter(deadline: .now() + 2) {
                            if let sheet = NSApp.windows.first(where: { $0.isSheet }), let v = sheet.contentView,
                               let rep = v.bitmapImageRepForCachingDisplay(in: v.bounds) {
                                v.cacheDisplay(in: v.bounds, to: rep)
                                try? rep.representation(using: .png, properties: [:])?.write(to: outputDir.appendingPathComponent("4-export.png"))
                            }
                            AppModel.shared.editor?.showExport = false
                            DispatchQueue.main.asyncAfter(deadline: .now() + 1) {
                                AppModel.shared.closeEditor()
                                DispatchQueue.main.asyncAfter(deadline: .now() + 2) {
                                    capture("5-projekte.png", dir: outputDir)
                                    NSApp.terminate(nil)
                                }
                            }
                        }
                    }
                }
            }
        }
    }
}

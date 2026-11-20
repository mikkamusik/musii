import SwiftUI
import AppKit
import UniformTypeIdentifiers

final class ExportModel: ObservableObject {
    @Published var running = false
    @Published var progress: Double = 0
    @Published var resultURL: URL?
    @Published var error: String?
    private var job: ExportJob?
    private var started = Date()
    @Published var remaining: String = ""

    func start(project: Project, settings: ExportSettings, url: URL) {
        running = true
        progress = 0
        resultURL = nil
        error = nil
        started = Date()
        let job = ExportJob()
        self.job = job
        Task {
            do {
                try await job.run(project: project, settings: settings, to: url) { p in
                    DispatchQueue.main.async {
                        self.progress = p
                        let elapsed = Date().timeIntervalSince(self.started)
                        if p > 0.03 {
                            let rest = elapsed / p * (1 - p)
                            self.remaining = "noch ca. \(Int(rest.rounded())) s"
                        }
                    }
                }
                await MainActor.run {
                    self.running = false
                    self.resultURL = url
                }
            } catch is CancellationError {
                await MainActor.run { self.running = false }
            } catch {
                await MainActor.run {
                    self.running = false
                    self.error = error.localizedDescription
                }
            }
        }
    }

    func cancel() { job?.cancel() }
}

struct ExportSheet: View {
    @ObservedObject var editor: EditorState
    @ObservedObject var settings = AppSettings.shared
    @StateObject private var model = ExportModel()
    @Environment(\.presentationMode) private var presentationMode

    var body: some View {
        let s = settings.exportSettings
        let size = ExportJob.renderSize(project: editor.project, resolution: s.resolution)
        let bitrate = ExportJob.bitrate(size: size, fps: s.fps, codec: s.codec, quality: s.quality)
        let mb = Double(bitrate) / 8 / 1_000_000 * max(1, editor.duration) + (editor.duration * 0.032)
        VStack(alignment: .leading, spacing: 14) {
            HStack {
                Image(systemName: "square.and.arrow.up.fill").foregroundColor(Theme.accent).font(.system(size: 20))
                Text("Exportieren").font(.system(size: 18, weight: .semibold))
                Spacer()
                Text("Ohne Wasserzeichen · ohne Limit").font(.system(size: 11)).foregroundColor(Theme.accent)
            }
            if model.running {
                VStack(alignment: .leading, spacing: 10) {
                    Text("Video wird erstellt … \(Int(model.progress * 100)) %").font(.system(size: 13))
                    ProgressView(value: model.progress)
                    Text(model.remaining).font(.system(size: 11)).foregroundColor(Theme.secondaryText)
                    HStack {
                        Spacer()
                        Button("Abbrechen") { model.cancel() }
                    }
                }
                .frame(height: 140)
            } else if let url = model.resultURL {
                VStack(alignment: .leading, spacing: 12) {
                    Label("Export abgeschlossen!", systemImage: "checkmark.circle.fill").foregroundColor(.green).font(.system(size: 14, weight: .semibold))
                    Text(url.path).font(.system(size: 11)).foregroundColor(Theme.secondaryText).lineLimit(2)
                    HStack {
                        Button("Im Finder zeigen") { NSWorkspace.shared.activateFileViewerSelecting([url]) }
                        Button("Abspielen") { NSWorkspace.shared.open(url) }
                        Spacer()
                        Button("Fertig") { presentationMode.wrappedValue.dismiss() }.keyboardShortcut(.defaultAction)
                    }
                }
                .frame(height: 140)
            } else {
                Form {
                    Picker("Format", selection: $settings.exportSettings.format) {
                        ForEach(ExportFormat.allCases) { f in Text(f.title).tag(f) }
                    }
                    if s.format == .mp4 || s.format == .mov {
                        Picker("Auflösung", selection: $settings.exportSettings.resolution) {
                            ForEach(ExportResolution.allCases) { r in Text(r.title).tag(r) }
                        }
                        Picker("Bildrate", selection: $settings.exportSettings.fps) {
                            ForEach([24, 25, 30, 50, 60], id: \.self) { f in Text("\(f) fps").tag(f) }
                        }
                        Picker("Codec", selection: $settings.exportSettings.codec) {
                            ForEach(ExportCodec.allCases) { c in Text(c.title).tag(c) }
                        }
                        if s.codec != .prores {
                            Picker("Qualität", selection: $settings.exportSettings.quality) {
                                ForEach(ExportQuality.allCases) { q in Text(q.title).tag(q) }
                            }
                        }
                    }
                }
                .font(.system(size: 12))
                HStack(spacing: 16) {
                    info("Größe", s.format == .gif ? "max. 540 px" : "\(Int(size.width)) × \(Int(size.height))")
                    info("Dauer", formatTime(editor.duration))
                    if s.format == .mp4 || s.format == .mov, s.codec != .prores {
                        info("Datei ca.", mb > 1000 ? String(format: "%.1f GB", mb / 1000) : String(format: "%.0f MB", mb))
                    }
                }
                if let e = model.error {
                    Text("Fehler: \(e)").font(.system(size: 11)).foregroundColor(.red)
                }
                HStack {
                    Button("Abbrechen") { presentationMode.wrappedValue.dismiss() }
                        .keyboardShortcut(.cancelAction)
                    Spacer()
                    Button {
                        chooseAndExport()
                    } label: {
                        Text("Exportieren …").padding(.horizontal, 10)
                    }
                    .keyboardShortcut(.defaultAction)
                    .disabled(editor.duration <= 0)
                }
            }
        }
        .padding(20)
        .frame(width: 460)
        .background(Theme.panel)
        .preferredColorScheme(.dark)
        .onAppear { editor.pause() }
    }

    private func info(_ a: String, _ b: String) -> some View {
        VStack(alignment: .leading, spacing: 2) {
            Text(a).font(.system(size: 10)).foregroundColor(Theme.secondaryText)
            Text(b).font(.system(size: 12, weight: .medium))
        }
    }

    private func chooseAndExport() {
        let s = settings.exportSettings
        let panel = NSSavePanel()
        let ext: String
        switch s.format {
        case .mp4: ext = "mp4"; panel.allowedContentTypes = [.mpeg4Movie]
        case .mov: ext = "mov"; panel.allowedContentTypes = [.quickTimeMovie]
        case .gif: ext = "gif"; panel.allowedContentTypes = [.gif]
        case .m4a: ext = "m4a"; panel.allowedContentTypes = [.mpeg4Audio]
        }
        let safeName = editor.project.name.replacingOccurrences(of: "/", with: "-")
        panel.nameFieldStringValue = "\(safeName).\(ext)"
        panel.directoryURL = FileManager.default.urls(for: .moviesDirectory, in: .userDomainMask).first
        panel.canCreateDirectories = true
        guard panel.runModal() == .OK, let url = panel.url else { return }
        editor.saveNow()
        model.start(project: editor.project, settings: s, url: url)
    }
}

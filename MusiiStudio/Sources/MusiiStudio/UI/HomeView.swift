import SwiftUI
import AppKit
import UniformTypeIdentifiers

struct HomeView: View {
    @ObservedObject var model: AppModel
    @ObservedObject var store = ProjectStore.shared
    @State private var renaming: ProjectSummary?
    @State private var newName = ""
    @State private var deleting: ProjectSummary?
    @State private var targeted = false

    var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            HStack(spacing: 12) {
                AppLogo(size: 40)
                VStack(alignment: .leading, spacing: 2) {
                    Text("Musii Studio").font(.system(size: 22, weight: .bold))
                    Text("Videoschnitt – alle Funktionen, kostenlos, ohne Wasserzeichen").font(.system(size: 12)).foregroundColor(Theme.secondaryText)
                }
                Spacer()
                Button {
                    let panel = NSOpenPanel()
                    panel.allowedContentTypes = [.json]
                    if panel.runModal() == .OK, let u = panel.url {
                        if let p = try? store.importProject(from: u) { model.open(p.id) }
                    }
                } label: { Label("Projekt importieren", systemImage: "tray.and.arrow.down") }
            }
            .padding(24)

            Text("Neues Projekt").font(.system(size: 15, weight: .semibold)).padding(.horizontal, 24)
            ScrollView(.horizontal, showsIndicators: false) {
                HStack(spacing: 12) {
                    NewProjectCard(title: "Medien importieren", subtitle: "Format automatisch", symbol: "plus", big: true) {
                        let urls = openMediaPanel()
                        guard !urls.isEmpty else { return }
                        model.newProject(aspect: .r16x9, importing: urls)
                    }
                    ForEach(AspectPreset.allCases) { a in
                        NewProjectCard(title: a.title, subtitle: a.subtitle, symbol: nil, aspect: a) {
                            model.newProject(aspect: a, importing: [])
                        }
                    }
                }
                .padding(.horizontal, 24)
                .padding(.vertical, 12)
            }

            HStack {
                Text("Meine Projekte").font(.system(size: 15, weight: .semibold))
                Text("\(store.summaries.count)").font(.system(size: 12)).foregroundColor(Theme.secondaryText)
                Spacer()
                Button {
                    NSWorkspace.shared.open(AppPaths.projects)
                } label: { Label("Ordner öffnen", systemImage: "folder") }
                .buttonStyle(.borderless)
            }
            .padding(.horizontal, 24)
            .padding(.top, 8)

            ScrollView {
                if store.summaries.isEmpty {
                    EmptyHint(symbol: "film", text: "Noch keine Projekte.\nStarte oben ein neues Projekt oder ziehe Videos in dieses Fenster.")
                        .padding(.top, 40)
                }
                LazyVGrid(columns: [GridItem(.adaptive(minimum: 200), spacing: 16)], spacing: 16) {
                    ForEach(store.summaries) { s in
                        ProjectCard(summary: s, thumb: store.thumbs[s.id])
                            .onTapGesture(count: 2) { model.open(s.id) }
                            .onTapGesture { model.open(s.id) }
                            .contextMenu {
                                Button("Öffnen") { model.open(s.id) }
                                Button("Umbenennen …") { newName = s.name; renaming = s }
                                Button("Duplizieren") { store.duplicate(s.id) }
                                Button("Als Datei sichern …") {
                                    guard let p = store.load(s.id) else { return }
                                    let panel = NSSavePanel()
                                    panel.allowedContentTypes = [.json]
                                    panel.nameFieldStringValue = "\(s.name).json"
                                    if panel.runModal() == .OK, let u = panel.url { try? store.exportProject(p, to: u) }
                                }
                                Button("Im Finder zeigen") { NSWorkspace.shared.open(AppPaths.projectFolder(s.id)) }
                                Divider()
                                Button("Löschen …") { deleting = s }
                            }
                    }
                }
                .padding(24)
            }
        }
        .background(Theme.bg)
        .overlay(RoundedRectangle(cornerRadius: 12).stroke(Theme.accent, lineWidth: targeted ? 3 : 0).padding(6))
        .onDrop(of: [UTType.fileURL], isTargeted: $targeted) { providers in
            loadDroppedURLs(providers) { urls in
                guard !urls.isEmpty else { return }
                model.newProject(aspect: .r16x9, importing: urls)
            }
            return true
        }
        .onAppear { store.reload() }
        .sheet(item: $renaming) { s in
            VStack(alignment: .leading, spacing: 12) {
                Text("Projekt umbenennen").font(.headline)
                TextField("Name", text: $newName).textFieldStyle(.roundedBorder).frame(width: 300)
                HStack {
                    Spacer()
                    Button("Abbrechen") { renaming = nil }.keyboardShortcut(.cancelAction)
                    Button("Umbenennen") { store.rename(s.id, to: newName); renaming = nil }.keyboardShortcut(.defaultAction)
                }
            }
            .padding(20)
            .preferredColorScheme(.dark)
        }
        .alert(item: $deleting) { s in
            Alert(title: Text("„\(s.name)“ löschen?"),
                  message: Text("Das Projekt wird endgültig gelöscht. Deine Originaldateien bleiben erhalten."),
                  primaryButton: .destructive(Text("Löschen")) { store.delete(s.id) },
                  secondaryButton: .cancel(Text("Abbrechen")))
        }
    }
}

struct AppLogo: View {
    let size: CGFloat
    var body: some View {
        ZStack {
            RoundedRectangle(cornerRadius: size * 0.24)
                .fill(LinearGradient(colors: [Theme.accent, Theme.accent2], startPoint: .topLeading, endPoint: .bottomTrailing))
            Image(systemName: "play.fill").font(.system(size: size * 0.42, weight: .bold)).foregroundColor(.white)
                .offset(x: size * 0.03)
        }
        .frame(width: size, height: size)
    }
}

struct NewProjectCard: View {
    let title: String
    let subtitle: String
    let symbol: String?
    var big: Bool = false
    var aspect: AspectPreset? = nil
    let action: () -> Void
    @State private var hover = false

    var body: some View {
        Button(action: action) {
            VStack(spacing: 8) {
                ZStack {
                    if let s = symbol {
                        Image(systemName: s).font(.system(size: 26, weight: .semibold)).foregroundColor(.black)
                            .frame(width: 52, height: 52)
                            .background(Circle().fill(Theme.accent))
                    } else if let a = aspect {
                        let r = a.canvas.width / a.canvas.height
                        RoundedRectangle(cornerRadius: 4)
                            .stroke(Color.white.opacity(0.85), lineWidth: 2)
                            .frame(width: r >= 1 ? 54 : 54 * r, height: r >= 1 ? 54 / r : 54)
                    }
                }
                .frame(height: 60)
                Text(title).font(.system(size: 13, weight: .semibold))
                Text(subtitle).font(.system(size: 10)).foregroundColor(Theme.secondaryText).lineLimit(1)
            }
            .frame(width: big ? 170 : 120, height: 130)
            .background(RoundedRectangle(cornerRadius: 12).fill(hover ? Theme.panel3 : Theme.panel2))
            .overlay(RoundedRectangle(cornerRadius: 12).stroke(big ? Theme.accent.opacity(0.6) : Theme.border, lineWidth: 1))
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .onHover { hover = $0 }
    }
}

struct ProjectCard: View {
    let summary: ProjectSummary
    let thumb: NSImage?
    @State private var hover = false

    var body: some View {
        VStack(alignment: .leading, spacing: 6) {
            ZStack(alignment: .bottomTrailing) {
                ZStack {
                    Theme.panel3
                    if let t = thumb {
                        Image(nsImage: t).resizable().aspectRatio(contentMode: .fill)
                    } else {
                        Image(systemName: "film").font(.system(size: 30)).foregroundColor(Theme.secondaryText)
                    }
                }
                .frame(height: 120)
                .clipped()
                Text(formatTime(summary.duration))
                    .font(.system(size: 10, design: .monospaced))
                    .padding(.horizontal, 5).padding(.vertical, 2)
                    .background(Color.black.opacity(0.6)).cornerRadius(4)
                    .padding(6)
            }
            .cornerRadius(10)
            .overlay(RoundedRectangle(cornerRadius: 10).stroke(hover ? Theme.accent : Color.clear, lineWidth: 2))
            Text(summary.name).font(.system(size: 13, weight: .medium)).lineLimit(1)
            Text("\(summary.aspect.title) · \(summary.modified.formatted(date: .abbreviated, time: .shortened))")
                .font(.system(size: 10)).foregroundColor(Theme.secondaryText)
        }
        .contentShape(Rectangle())
        .onHover { hover = $0 }
    }
}

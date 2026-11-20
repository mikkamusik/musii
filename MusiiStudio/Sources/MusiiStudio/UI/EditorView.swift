import SwiftUI
import AppKit

struct EditorView: View {
    @ObservedObject var model: AppModel
    @ObservedObject var editor: EditorState
    @State private var timelineHeight: CGFloat = 300

    var body: some View {
        VStack(spacing: 0) {
            TopBar(model: model, editor: editor)
            Divider().background(Theme.border)
            GeometryReader { geo in
                VStack(spacing: 0) {
                    HStack(spacing: 0) {
                        let narrow = geo.size.width < 1360
                        LibraryPanel(editor: editor)
                            .frame(width: narrow ? 300 : 360)
                            .clipped()
                        Divider().background(Theme.border)
                        PreviewArea(editor: editor)
                            .frame(minWidth: 200, maxWidth: .infinity)
                            .clipped()
                        Divider().background(Theme.border)
                        InspectorPanel(editor: editor)
                            .frame(width: narrow ? 280 : 310)
                            .clipped()
                    }
                    .frame(width: geo.size.width, height: max(260, geo.size.height - timelineHeight))
                    .clipped()
                    SplitterBar(height: $timelineHeight, total: geo.size.height)
                    TimelinePanel(editor: editor)
                        .frame(height: min(max(160, timelineHeight), geo.size.height - 260))
                }
            }
        }
        .background(Theme.bg)
        .overlay(BusyOverlay(editor: editor))
        .sheet(isPresented: $editor.showExport) {
            ExportSheet(editor: editor)
        }
        .alert(isPresented: Binding(get: { editor.errorMessage != nil }, set: { if !$0 { editor.errorMessage = nil } })) {
            Alert(title: Text("Hinweis"), message: Text(editor.errorMessage ?? ""), dismissButton: .default(Text("OK")))
        }
        .overlay(alignment: .top) {
            if let info = editor.infoMessage {
                Text(info)
                    .font(.system(size: 12, weight: .medium))
                    .padding(.horizontal, 14).padding(.vertical, 8)
                    .background(Capsule().fill(Theme.panel3))
                    .overlay(Capsule().stroke(Theme.accent.opacity(0.6)))
                    .padding(.top, 54)
                    .transition(.opacity)
                    .onAppear {
                        DispatchQueue.main.asyncAfter(deadline: .now() + 3) {
                            if editor.infoMessage == info { editor.infoMessage = nil }
                        }
                    }
            }
        }
    }
}

struct SplitterBar: View {
    @Binding var height: CGFloat
    let total: CGFloat
    @State private var start: CGFloat?

    var body: some View {
        Rectangle()
            .fill(Theme.border)
            .frame(height: 5)
            .overlay(Capsule().fill(Color.white.opacity(0.25)).frame(width: 40, height: 3))
            .contentShape(Rectangle())
            .onHover { inside in
                if inside { NSCursor.resizeUpDown.push() } else { NSCursor.pop() }
            }
            .gesture(DragGesture(coordinateSpace: .global)
                .onChanged { v in
                    if start == nil { start = height }
                    height = min(max(160, (start ?? height) - v.translation.height), total - 260)
                }
                .onEnded { _ in start = nil })
    }
}

struct TopBar: View {
    @ObservedObject var model: AppModel
    @ObservedObject var editor: EditorState

    var body: some View {
        HStack(spacing: 10) {
            Button {
                model.closeEditor()
            } label: {
                HStack(spacing: 6) {
                    Image(systemName: "chevron.left")
                    AppLogo(size: 22)
                    Text("Projekte").font(.system(size: 12))
                }
            }
            .buttonStyle(.plain)
            .help("Zur Projektübersicht")
            Divider().frame(height: 20)
            TextField("Projektname", text: editor.projectBinding(\.name))
                .textFieldStyle(.plain)
                .font(.system(size: 13, weight: .semibold))
                .frame(maxWidth: 260)
            Spacer()
            IconButton(symbol: "arrow.uturn.backward", help: "Rückgängig (⌘Z)", enabled: editor.canUndo) { editor.undo() }
            IconButton(symbol: "arrow.uturn.forward", help: "Wiederholen (⇧⌘Z)", enabled: editor.canRedo) { editor.redo() }
            Divider().frame(height: 20)
            Menu {
                ForEach(AspectPreset.allCases) { a in
                    Button("\(a.title) – \(a.subtitle)") { editor.update { $0.aspect = a } }
                }
            } label: {
                Label(editor.project.aspect.title, systemImage: "aspectratio")
            }
            .menuStyle(.borderlessButton)
            .fixedSize()
            Button {
                editor.showExport = true
            } label: {
                HStack(spacing: 6) {
                    Image(systemName: "square.and.arrow.up")
                    Text("Exportieren")
                }
                .font(.system(size: 13, weight: .semibold))
                .padding(.horizontal, 14)
                .padding(.vertical, 6)
                .background(RoundedRectangle(cornerRadius: 7).fill(Theme.accent))
                .foregroundColor(.black)
            }
            .buttonStyle(.plain)
            .help("Exportieren (⌘E)")
        }
        .padding(.horizontal, 12)
        .frame(height: 46)
        .background(Theme.panel)
    }
}

struct BusyOverlay: View {
    @ObservedObject var editor: EditorState

    var body: some View {
        Group {
            if let b = editor.busy {
                ZStack {
                    Color.black.opacity(0.45)
                    VStack(spacing: 12) {
                        Text(b.title).font(.system(size: 14, weight: .medium))
                        if let p = b.progress {
                            ProgressView(value: p).frame(width: 260)
                            Text("\(Int(p * 100)) %").font(.system(size: 11)).foregroundColor(Theme.secondaryText)
                        } else {
                            ProgressView().controlSize(.small)
                        }
                    }
                    .padding(24)
                    .background(RoundedRectangle(cornerRadius: 12).fill(Theme.panel2))
                }
            }
        }
    }
}

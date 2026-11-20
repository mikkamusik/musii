import Foundation
import AppKit
import AVFoundation
import ImageIO

struct ProjectSummary: Identifiable, Equatable {
    let id: UUID
    var name: String
    var modified: Date
    var duration: Double
    var aspect: AspectPreset
    var clipCount: Int
}

final class ProjectStore: ObservableObject {
    static let shared = ProjectStore()

    @Published private(set) var summaries: [ProjectSummary] = []
    @Published private(set) var thumbs: [UUID: NSImage] = [:]

    private let encoder: JSONEncoder = {
        let e = JSONEncoder()
        e.dateEncodingStrategy = .iso8601
        e.outputFormatting = [.prettyPrinted, .sortedKeys]
        return e
    }()
    private let decoder: JSONDecoder = {
        let d = JSONDecoder()
        d.dateDecodingStrategy = .iso8601
        return d
    }()

    private func file(_ id: UUID) -> URL { AppPaths.projectFolder(id).appendingPathComponent("projekt.json") }
    private func thumbFile(_ id: UUID) -> URL { AppPaths.projectFolder(id).appendingPathComponent("vorschau.jpg") }

    func reload() {
        let fm = FileManager.default
        let dirs = (try? fm.contentsOfDirectory(at: AppPaths.projects, includingPropertiesForKeys: nil)) ?? []
        var list: [ProjectSummary] = []
        var images: [UUID: NSImage] = [:]
        for d in dirs {
            guard let id = UUID(uuidString: d.lastPathComponent), let p = load(id) else { continue }
            list.append(ProjectSummary(id: p.id, name: p.name, modified: p.modified, duration: p.duration, aspect: p.aspect,
                                       clipCount: p.main.count + p.overlays.count + p.audio.count + p.texts.count))
            if let img = NSImage(contentsOf: thumbFile(id)) { images[id] = img }
        }
        summaries = list.sorted { $0.modified > $1.modified }
        thumbs = images
    }

    func load(_ id: UUID) -> Project? {
        guard let data = try? Data(contentsOf: file(id)) else { return nil }
        return try? decoder.decode(Project.self, from: data)
    }

    func save(_ project: Project) {
        var p = project
        p.modified = Date()
        guard let data = try? encoder.encode(p) else { return }
        try? data.write(to: file(p.id), options: .atomic)
        makeThumbnail(p)
    }

    func create(name: String, aspect: AspectPreset) -> Project {
        var p = Project(name: name)
        p.aspect = aspect
        save(p)
        reload()
        return p
    }

    func delete(_ id: UUID) {
        try? FileManager.default.removeItem(at: AppPaths.projectFolder(id))
        reload()
    }

    func rename(_ id: UUID, to name: String) {
        guard var p = load(id) else { return }
        p.name = name
        save(p)
        reload()
    }

    func duplicate(_ id: UUID) {
        guard var p = load(id) else { return }
        let oldFolder = AppPaths.generatedMedia(p.id).path
        p.id = UUID()
        p.name += " Kopie"
        p.created = Date()
        // erzeugte Medien mitkopieren
        let newFolder = AppPaths.generatedMedia(p.id)
        for i in p.media.indices where p.media[i].path.hasPrefix(oldFolder) {
            let src = URL(fileURLWithPath: p.media[i].path)
            let dst = newFolder.appendingPathComponent(src.lastPathComponent)
            try? FileManager.default.copyItem(at: src, to: dst)
            p.media[i].path = dst.path
        }
        save(p)
        reload()
    }

    func importProject(from url: URL) throws -> Project {
        let data = try Data(contentsOf: url)
        var p = try decoder.decode(Project.self, from: data)
        p.id = UUID()
        save(p)
        reload()
        return p
    }

    func exportProject(_ p: Project, to url: URL) throws {
        let data = try encoder.encode(p)
        try data.write(to: url, options: .atomic)
    }

    private func makeThumbnail(_ p: Project) {
        guard let first = p.main.first, let media = p.mediaItem(first.mediaID), media.exists else { return }
        let target = thumbFile(p.id)
        let id = p.id
        DispatchQueue.global(qos: .utility).async {
            var cg: CGImage?
            if media.kind == .video {
                let gen = AVAssetImageGenerator(asset: AVURLAsset(url: media.url))
                gen.appliesPreferredTrackTransform = true
                gen.maximumSize = CGSize(width: 480, height: 480)
                cg = try? gen.copyCGImage(at: CMTime(seconds: min(first.sourceStart + 0.5, max(0, media.duration - 0.1)), preferredTimescale: 600), actualTime: nil)
            } else if media.kind == .image, let src = CGImageSourceCreateWithURL(media.url as CFURL, nil) {
                cg = CGImageSourceCreateThumbnailAtIndex(src, 0, [
                    kCGImageSourceCreateThumbnailFromImageAlways: true,
                    kCGImageSourceCreateThumbnailWithTransform: true,
                    kCGImageSourceThumbnailMaxPixelSize: 480,
                ] as CFDictionary)
            }
            guard let image = cg else { return }
            let rep = NSBitmapImageRep(cgImage: image)
            guard let data = rep.representation(using: .jpeg, properties: [.compressionFactor: 0.8]) else { return }
            try? data.write(to: target, options: .atomic)
            DispatchQueue.main.async {
                self.thumbs[id] = NSImage(cgImage: image, size: NSSize(width: image.width, height: image.height))
            }
        }
    }
}

// MARK: - Einstellungen

final class AppSettings: ObservableObject {
    static let shared = AppSettings()
    @Published var exportSettings: ExportSettings {
        didSet { save() }
    }
    @Published var captionLanguage: String {
        didSet { UserDefaults.standard.set(captionLanguage, forKey: "captionLanguage") }
    }

    init() {
        if let d = UserDefaults.standard.data(forKey: "exportSettings"), let s = try? JSONDecoder().decode(ExportSettings.self, from: d) {
            exportSettings = s
        } else {
            exportSettings = ExportSettings()
        }
        captionLanguage = UserDefaults.standard.string(forKey: "captionLanguage") ?? "de-DE"
    }

    private func save() {
        if let d = try? JSONEncoder().encode(exportSettings) { UserDefaults.standard.set(d, forKey: "exportSettings") }
    }
}

import Foundation
import AVFoundation
import Speech

// MARK: - Automatische Untertitel (Spracherkennung)

enum CaptionGenerator {
    struct Word {
        let text: String
        let start: Double
        let duration: Double
    }

    struct Caption {
        let text: String
        let start: Double
        let end: Double
    }

    static let languages: [(String, String)] = [
        ("de-DE", "Deutsch"), ("en-US", "Englisch (US)"), ("en-GB", "Englisch (UK)"), ("fr-FR", "Französisch"),
        ("es-ES", "Spanisch"), ("it-IT", "Italienisch"), ("tr-TR", "Türkisch"), ("pl-PL", "Polnisch"),
        ("nl-NL", "Niederländisch"), ("pt-BR", "Portugiesisch"), ("ru-RU", "Russisch"), ("ar-SA", "Arabisch"),
    ]

    private static var active: [AnyObject] = []
    private static let activeLock = NSLock()

    static func authorize() async -> Bool {
        await withCheckedContinuation { (c: CheckedContinuation<Bool, Never>) in
            SFSpeechRecognizer.requestAuthorization { status in
                c.resume(returning: status == .authorized)
            }
        }
    }

    static func recognize(url: URL, locale: Locale) async throws -> [Word] {
        guard let recognizer = SFSpeechRecognizer(locale: locale) else {
            throw StudioError.message("Spracherkennung für diese Sprache nicht verfügbar.")
        }
        guard recognizer.isAvailable else {
            throw StudioError.message("Spracherkennung ist gerade nicht verfügbar (Internet/Siri prüfen).")
        }
        let request = SFSpeechURLRecognitionRequest(url: url)
        request.shouldReportPartialResults = false
        if recognizer.supportsOnDeviceRecognition { request.requiresOnDeviceRecognition = true }
        if #available(macOS 13, *) { request.addsPunctuation = true }

        return try await withCheckedThrowingContinuation { (c: CheckedContinuation<[Word], Error>) in
            var done = false
            let lock = NSLock()
            activeLock.lock(); active.append(recognizer); activeLock.unlock()
            func finish(_ r: Result<[Word], Error>) {
                lock.lock(); defer { lock.unlock() }
                guard !done else { return }
                done = true
                activeLock.lock(); active.removeAll { $0 === recognizer }; activeLock.unlock()
                c.resume(with: r)
            }
            let task = recognizer.recognitionTask(with: request) { result, error in
                if let result = result, result.isFinal {
                    let words = result.bestTranscription.segments.map {
                        Word(text: $0.substring, start: $0.timestamp, duration: $0.duration)
                    }
                    finish(.success(words))
                } else if let error = error {
                    let ns = error as NSError
                    // "Keine Sprache erkannt" ist kein Fehler
                    if ns.code == 1110 || ns.code == 203 { finish(.success([])) } else { finish(.failure(error)) }
                }
            }
            activeLock.lock(); active.append(task); activeLock.unlock()
        }
    }

    static func group(_ words: [Word], maxWords: Int = 6, maxDuration: Double = 3.2) -> [Caption] {
        var result: [Caption] = []
        var current: [Word] = []
        func flush() {
            guard let f = current.first, let l = current.last else { return }
            let text = current.map { $0.text }.joined(separator: " ")
            result.append(Caption(text: text, start: f.start, end: max(l.start + l.duration, f.start + 0.4)))
            current = []
        }
        for w in words {
            if let f = current.first, let l = current.last {
                let gap = w.start - (l.start + l.duration)
                if current.count >= maxWords || (w.start + w.duration - f.start) > maxDuration || gap > 0.8 {
                    flush()
                }
            }
            current.append(w)
            if let last = w.text.last, ".!?".contains(last) { flush() }
        }
        flush()
        // Lücken schließen, damit Untertitel nicht flackern
        for i in 0..<max(0, result.count - 1) {
            let next = result[i + 1].start
            if next - result[i].end < 0.35 {
                result[i] = Caption(text: result[i].text, start: result[i].start, end: next)
            }
        }
        return result
    }

    /// Erkennt Sprache in einem Medienbereich (in Stücken von max. 50 s)
    static func captions(media: MediaItem, sourceStart: Double, sourceDuration: Double, locale: Locale,
                         progress: @escaping (Double) -> Void) async throws -> [Caption] {
        var words: [Word] = []
        let piece = 50.0
        var offset = 0.0
        let tmp = FileManager.default.temporaryDirectory
        while offset < sourceDuration - 0.05 {
            let len = min(piece, sourceDuration - offset)
            let url = tmp.appendingPathComponent("musii-asr-\(UUID().uuidString).m4a")
            try await MediaTools.extractAudio(media: media, start: sourceStart + offset, duration: len, to: url)
            let w = try await recognize(url: url, locale: locale)
            words.append(contentsOf: w.map { Word(text: $0.text, start: $0.start + offset, duration: $0.duration) })
            try? FileManager.default.removeItem(at: url)
            offset += len
            progress(min(1, offset / max(0.01, sourceDuration)))
        }
        return group(words)
    }
}

// MARK: - Text zu Sprache

final class SpeechSynth: NSObject, AVSpeechSynthesizerDelegate {
    private static var running: [SpeechSynth] = []
    private let synth = AVSpeechSynthesizer()
    private var file: AVAudioFile?
    private var continuation: CheckedContinuation<Void, Error>?
    private var url: URL
    private var finished = false
    private var lastBuffer = Date()

    private init(url: URL) {
        self.url = url
        super.init()
        synth.delegate = self
    }

    static func voices(prefix: String) -> [AVSpeechSynthesisVoice] {
        AVSpeechSynthesisVoice.speechVoices()
            .filter { prefix.isEmpty || $0.language.hasPrefix(prefix) }
            .sorted { ($0.language, $0.name) < ($1.language, $1.name) }
    }

    static func render(text: String, voiceID: String?, rate: Float, pitch: Float, to url: URL) async throws {
        let s = SpeechSynth(url: url)
        running.append(s)
        defer { running.removeAll { $0 === s } }
        try await s.run(text: text, voiceID: voiceID, rate: rate, pitch: pitch)
    }

    private func run(text: String, voiceID: String?, rate: Float, pitch: Float) async throws {
        try? FileManager.default.removeItem(at: url)
        let utt = AVSpeechUtterance(string: text)
        if let id = voiceID, let v = AVSpeechSynthesisVoice(identifier: id) { utt.voice = v }
        utt.rate = rate
        utt.pitchMultiplier = pitch
        try await withCheckedThrowingContinuation { (c: CheckedContinuation<Void, Error>) in
            DispatchQueue.main.async {
                self.continuation = c
                self.synth.write(utt) { [weak self] buffer in
                    guard let self = self else { return }
                    guard let pcm = buffer as? AVAudioPCMBuffer else { return }
                    if pcm.frameLength == 0 { self.complete(nil); return }
                    self.lastBuffer = Date()
                    do {
                        if self.file == nil {
                            self.file = try AVAudioFile(forWriting: self.url, settings: pcm.format.settings,
                                                        commonFormat: pcm.format.commonFormat, interleaved: pcm.format.isInterleaved)
                        }
                        try self.file?.write(from: pcm)
                    } catch {
                        self.complete(error)
                    }
                }
                self.watchdog()
            }
        }
    }

    private func watchdog() {
        DispatchQueue.main.asyncAfter(deadline: .now() + 1) { [weak self] in
            guard let self = self, !self.finished else { return }
            if self.file != nil && Date().timeIntervalSince(self.lastBuffer) > 4 {
                self.complete(nil)
            } else if self.file == nil && Date().timeIntervalSince(self.lastBuffer) > 30 {
                self.complete(StudioError.message("Sprachausgabe hat nicht geantwortet."))
            } else {
                self.watchdog()
            }
        }
    }

    private func complete(_ error: Error?) {
        DispatchQueue.main.async {
            guard !self.finished else { return }
            self.finished = true
            self.file = nil // schließt die Datei
            if let e = error {
                self.continuation?.resume(throwing: e)
            } else if !FileManager.default.fileExists(atPath: self.url.path) {
                self.continuation?.resume(throwing: StudioError.message("Es wurde kein Ton erzeugt (Stimme installiert?)."))
            } else {
                self.continuation?.resume()
            }
            self.continuation = nil
        }
    }

    func speechSynthesizer(_ synthesizer: AVSpeechSynthesizer, didFinish utterance: AVSpeechUtterance) {
        DispatchQueue.main.asyncAfter(deadline: .now() + 0.5) { [weak self] in self?.complete(nil) }
    }
}

// MARK: - Sprachaufnahme (Voiceover)

final class VoiceRecorder: NSObject, ObservableObject {
    @Published var isRecording = false
    @Published var level: Float = 0
    @Published var elapsed: Double = 0

    private var recorder: AVAudioRecorder?
    private var timer: Timer?
    private(set) var url: URL?
    private var startDate = Date()

    func requestPermission() async -> Bool {
        switch AVCaptureDevice.authorizationStatus(for: .audio) {
        case .authorized: return true
        case .notDetermined: return await AVCaptureDevice.requestAccess(for: .audio)
        default: return false
        }
    }

    func start(to url: URL) throws {
        let settings: [String: Any] = [
            AVFormatIDKey: kAudioFormatMPEG4AAC,
            AVSampleRateKey: 48000,
            AVNumberOfChannelsKey: 1,
            AVEncoderAudioQualityKey: AVAudioQuality.high.rawValue,
        ]
        let r = try AVAudioRecorder(url: url, settings: settings)
        r.isMeteringEnabled = true
        guard r.record() else { throw StudioError.message("Aufnahme konnte nicht gestartet werden (Mikrofon-Zugriff?).") }
        recorder = r
        self.url = url
        startDate = Date()
        isRecording = true
        timer = Timer.scheduledTimer(withTimeInterval: 0.05, repeats: true) { [weak self] _ in
            guard let self = self, let r = self.recorder else { return }
            r.updateMeters()
            let db = r.averagePower(forChannel: 0)
            self.level = max(0, min(1, (db + 50) / 50))
            self.elapsed = Date().timeIntervalSince(self.startDate)
        }
    }

    func stop() -> URL? {
        timer?.invalidate(); timer = nil
        recorder?.stop()
        recorder = nil
        isRecording = false
        level = 0
        return url
    }
}

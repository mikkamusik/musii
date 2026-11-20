import AppKit
import SwiftUI

if let i = CommandLine.arguments.firstIndex(of: "--selftest") {
    let out = i + 1 < CommandLine.arguments.count
        ? URL(fileURLWithPath: CommandLine.arguments[i + 1])
        : FileManager.default.temporaryDirectory.appendingPathComponent("musii-selftest")
    SelfTest.start(outputDir: out)
} else {
    MusiiStudioApp.main()
}

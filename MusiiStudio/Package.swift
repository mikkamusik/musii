// swift-tools-version:5.7
import PackageDescription

let package = Package(
    name: "MusiiStudio",
    platforms: [.macOS(.v12)],
    targets: [
        .executableTarget(
            name: "MusiiStudio",
            path: "Sources/MusiiStudio"
        )
    ]
)

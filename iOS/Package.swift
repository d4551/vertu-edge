// swift-tools-version: 5.9
import PackageDescription

let package = Package(
    name: "VertuEdge",
    platforms: [.iOS(.v16)],
    products: [
        .library(name: "VertuEdge", targets: ["VertuEdge"])
    ],
    dependencies: [
        .package(url: "https://github.com/nicklockwood/SwiftFormat", from: "0.54.0")
    ],
    targets: [
        .target(
            name: "VertuEdge",
            path: "Sources/VertuEdge"
        ),
        .testTarget(
            name: "VertuEdgeTests",
            dependencies: ["VertuEdge"],
            path: "Tests/VertuEdgeTests"
        )
    ]
)

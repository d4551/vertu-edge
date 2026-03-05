// swift-tools-version: 6.0
import PackageDescription

let package = Package(
    name: "VertuEdge",
    defaultLocalization: "en",
    platforms: [.iOS(.v17), .macOS(.v14)],
    products: [
        .library(name: "VertuEdgeCore", targets: ["VertuEdgeCore"]),
        .library(name: "VertuEdgeDriver", targets: ["VertuEdgeDriver"]),
        .library(name: "VertuEdgeUI", targets: ["VertuEdgeUI"]),
    ],
    targets: [
        .target(
            name: "VertuEdgeCore"
        ),
        .target(
            name: "VertuEdgeDriver",
            dependencies: ["VertuEdgeCore"]
        ),
        .target(
            name: "VertuEdgeUI",
            dependencies: ["VertuEdgeCore", "VertuEdgeDriver"],
            resources: [.process("Resources")]
        ),
        .testTarget(
            name: "VertuEdgeDriverTests",
            dependencies: ["VertuEdgeCore", "VertuEdgeDriver"]
        ),
    ]
)

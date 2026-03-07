// swift-tools-version: 6.0
import PackageDescription

let package = Package(
    name: "VertuEdge",
    defaultLocalization: "en",
    platforms: [.iOS(.v17), .macOS(.v14)],
    products: [
        .library(name: "VertuEdgeCore", targets: ["VertuEdgeCore"]),
        .library(name: "VertuEdgeDriver", targets: ["VertuEdgeDriver"]),
        .library(name: "VertuEdgeDriverXCTest", targets: ["VertuEdgeDriverXCTest"]),
        .library(name: "VertuEdgeUI", targets: ["VertuEdgeUI"]),
    ],
    targets: [
        .target(
            name: "VertuEdgeCore",
            plugins: ["DeviceAiProfilePlugin"]
        ),
        .target(
            name: "VertuEdgeDriver",
            dependencies: ["VertuEdgeCore"]
        ),
        .target(
            name: "VertuEdgeDriverXCTest",
            dependencies: ["VertuEdgeCore", "VertuEdgeDriver"]
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
        .plugin(
            name: "DeviceAiProfilePlugin",
            capability: .buildTool()
        ),
    ]
)

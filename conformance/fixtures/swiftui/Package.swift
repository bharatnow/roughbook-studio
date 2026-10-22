// swift-tools-version: 6.0
import PackageDescription

let package = Package(
    name: "Harbor",
    platforms: [.iOS(.v17), .macOS(.v14)],
    products: [
        .library(name: "Harbor", targets: ["Harbor"])
    ],
    targets: [
        .target(name: "Harbor"),
        .testTarget(name: "HarborTests", dependencies: ["Harbor"])
    ]
)

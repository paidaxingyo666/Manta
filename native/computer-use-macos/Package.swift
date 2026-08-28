// swift-tools-version: 6.0

import PackageDescription

let package = Package(
    name: "MantaComputerUseMacOS",
    platforms: [
        .macOS(.v14)
    ],
    products: [
        .library(
            name: "MantaComputerUseMacOSCore",
            targets: ["MantaComputerUseMacOSCore"]
        ),
        .executable(
            name: "manta-computer-use-macos",
            targets: ["MantaComputerUseMacOS"]
        )
    ],
    targets: [
        .target(
            name: "MantaComputerUseMacOSCore",
            path: "Sources/MantaComputerUseMacOSCore"
        ),
        .executableTarget(
            name: "MantaComputerUseMacOS",
            dependencies: ["MantaComputerUseMacOSCore"],
            path: "Sources/MantaComputerUseMacOS"
        ),
        .testTarget(
            name: "MantaComputerUseMacOSTests",
            dependencies: ["MantaComputerUseMacOSCore"],
            path: "Tests/MantaComputerUseMacOSTests"
        )
    ]
)

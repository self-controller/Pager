// swift-tools-version: 6.0

import PackageDescription

let package = Package(
    name: "Pager",
    platforms: [
        // IrohLib's floor.
        .iOS("17.5"),
    ],
    products: [
        // xtool builds the package's one library product into the app.
        .library(name: "Pager", targets: ["Pager"]),
    ],
    dependencies: [
        // iroh for Swift (iroh-ffi): the 1.x wire protocol, as the computer's `iroh` crate speaks it.
        .package(url: "https://github.com/n0-computer/iroh-ffi", exact: "1.2.0"),
    ],
    targets: [
        .target(
            name: "Pager",
            dependencies: [.product(name: "IrohLib", package: "iroh-ffi")],
            // The web UI, built by build-web.sh (not in git).
            resources: [.copy("Resources/web")]
        ),
    ],
    swiftLanguageModes: [.v5]
)

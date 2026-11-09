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
            resources: [.copy("Resources/web")],
            linkerSettings: [
                // On Linux the link runs through clang with --sysroot, which stamps the SDK as the
                // deployment target (17.5). iOS 26 keeps a binary stamped below 26 in compatibility
                // mode: no Liquid Glass. ld64.lld takes the last -platform_version, so this one wins:
                // floor 17.5, SDK 27.2, the SDK xtool built from Xcode 27.2. Bump the last number with
                // the SDK.
                .unsafeFlags(["-Xlinker", "-platform_version", "-Xlinker", "ios", "-Xlinker", "17.5", "-Xlinker", "27.2"]),
            ]
        ),
    ],
    swiftLanguageModes: [.v5]
)

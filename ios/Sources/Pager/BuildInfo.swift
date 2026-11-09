import MachO

/// What the app's binary says about how it was built, for Diagnostics. There's no Mac to run `otool`
/// on, so the app reads its own load commands. iOS 26 draws the new design (the Liquid Glass tab bar)
/// only for a binary built against SDK 26 or later; below that it keeps the compatibility look.
enum BuildInfo {
    /// The SDK the binary was linked against, from its `LC_BUILD_VERSION`, such as "27.2"; nil if the
    /// binary has none.
    static var linkedSDK: String? {
        guard let header = _dyld_get_image_header(0), header.pointee.magic == MH_MAGIC_64 else {
            return nil
        }
        let raw = UnsafeRawPointer(header)
        var offset = MemoryLayout<mach_header_64>.size
        for _ in 0..<header.pointee.ncmds {
            let command = raw.load(fromByteOffset: offset, as: load_command.self)
            if command.cmd == UInt32(LC_BUILD_VERSION) {
                let build = raw.load(fromByteOffset: offset, as: build_version_command.self)
                return version(build.sdk)
            }
            offset += Int(command.cmdsize)
        }
        return nil
    }

    /// A packed xxxx.yy.zz version as "major.minor", with ".patch" when it isn't 0.
    private static func version(_ packed: UInt32) -> String {
        let major = packed >> 16
        let minor = (packed >> 8) & 0xff
        let patch = packed & 0xff
        return patch == 0 ? "\(major).\(minor)" : "\(major).\(minor).\(patch)"
    }
}

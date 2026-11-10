import SwiftUI
import UIKit

/// What this phone knows about its computer, and a timed download. Opened from the first screen, or
/// with a three-tap of two fingers over the library (there's no web inspector without a Mac).
struct DiagnosticsView: View {
    let client: IrohClient
    /// The tab bar, once paired: its layout, for the device check.
    var tabs: TabsController?
    /// The phone's copy of the library and the changes waiting to be sent, once paired.
    var copy: PhoneCopy?
    var outbox: Outbox?
    @Environment(\.dismiss) private var dismiss
    @State private var info: IrohClient.Diagnostics?
    /// The layout with the bar shown (false) and hidden (true), and whether it is hidden now.
    @State private var layout: [Bool: LayoutSnapshot] = [:]
    @State private var barHidden = false
    @State private var download: String?
    @State private var busy = false
    /// The copy's stored answers, their size, and the changes waiting.
    @State private var kept: (entries: Int, bytes: Int, waiting: Int)?

    var body: some View {
        NavigationStack {
            List {
                Section("This phone") {
                    row("ID", info?.phoneId)
                    row("Paired", info.map { $0.paired ? "yes" : "no" })
                }
                Section("Your computer") {
                    row("ID", info?.computerId)
                    row("Relay", info?.relay)
                    row("Relay token", info.map { $0.relayToken ? "set" : "none (n0's relays)" })
                    row("Connection", info?.connection)
                    row("Round trip", info?.rtt)
                    row("Last error", info?.lastError)
                }
                if copy != nil {
                    Section {
                        row("Computer", info.map { Self.reach($0.reach) })
                        row("Last reached", info.map { $0.lastOnline.map { $0.formatted(date: .abbreviated, time: .shortened) } ?? "never" })
                        row("Stored answers", kept.map { "\($0.entries)" })
                        row("Size", kept.map { ByteCountFormatter.string(fromByteCount: Int64($0.bytes), countStyle: .file) })
                        row("Changes waiting", kept.map { "\($0.waiting)" })
                    } header: {
                        Text("This phone's copy")
                    } footer: {
                        Text("Books you chose Download for, and the library's lists and covers, are read from here when your computer can't be reached. Changes waiting are places and highlights made meanwhile; they go to the computer when it is reached.")
                    }
                }
                if tabs != nil {
                    Section {
                        row("iOS", UIDevice.current.systemVersion)
                        row("Built for SDK", BuildInfo.linkedSDK ?? "—")
                        row("Tab bar now", barHidden ? "hidden" : "shown")
                        layoutRows("shown", layout[false])
                        layoutRows("hidden", layout[true])
                    } header: {
                        Text("Layout")
                    } footer: {
                        Text("Each set is taken as the bar last showed or hid. With the bar shown and hidden, env(bottom) should be the same (34 on Face ID iPhones), or the reader repaginates when its chrome hides. Built for SDK below 26 means iOS 26 shows the old, flat compatibility bar, not the glass one.")
                    }
                }
                Section {
                    Button(busy ? "Downloading…" : "Time a download") {
                        busy = true
                        Task {
                            do {
                                download = try await client.timeDownload()
                            } catch {
                                download = IrohClient.message(error)
                            }
                            busy = false
                            info = await client.diagnostics()
                        }
                    }
                    .disabled(busy)
                    if let download {
                        Text(download).font(.footnote).textSelection(.enabled)
                    }
                    Button("Reconnect") {
                        Task {
                            await client.reset()
                            info = await client.diagnostics()
                        }
                    }
                } footer: {
                    Text("The download fetches your largest book's every section, the way reading it does.")
                }
            }
            .navigationTitle("Diagnostics")
            .toolbar {
                ToolbarItem(placement: .confirmationAction) {
                    Button("Done") { dismiss() }
                }
            }
            .refreshable {
                info = await client.diagnostics()
                await refreshLayout()
                await refreshCopy()
            }
            .task {
                await refreshLayout()
                info = await client.diagnostics()
                await refreshCopy()
            }
        }
    }

    @ViewBuilder
    private func layoutRows(_ state: String, _ snapshot: LayoutSnapshot?) -> some View {
        row("Footprint (\(state))", snapshot?.footprint.map(points))
        row("Web view safe bottom (\(state))", snapshot.map { points($0.webViewSafeBottom) })
        row("Window safe bottom (\(state))", snapshot?.windowSafeBottom.map(points))
        row("Page env(bottom) (\(state))", snapshot?.pageSafeBottom)
        row("Page --size-bottom-nav (\(state))", snapshot?.pageBottomNav)
    }

    private static func reach(_ reach: Reach) -> String {
        switch reach {
        case .online: return "reachable"
        case .offline: return "out of reach"
        case .unknown: return "not tried yet"
        }
    }

    private func refreshCopy() async {
        guard let copy, let outbox else { return }
        let totals = await copy.totals()
        kept = (totals.entries, totals.bytes, await outbox.count)
    }

    private func points(_ value: CGFloat) -> String {
        String(format: "%.1f pt", Double(value))
    }

    /// The layout now, kept for the bar's state, with the other state's last.
    private func refreshLayout() async {
        guard let tabs else { return }
        await tabs.refreshSnapshot()
        barHidden = tabs.isBarHidden
        layout = tabs.snapshots
    }

    private func row(_ label: String, _ value: String?) -> some View {
        LabeledContent(label) {
            Text(value ?? "—")
                .font(.system(.footnote, design: .monospaced))
                .textSelection(.enabled)
                .lineLimit(3)
        }
    }
}

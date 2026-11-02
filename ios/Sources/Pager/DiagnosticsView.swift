import SwiftUI

/// What this phone knows about its computer, and a timed download. Opened from the first screen, or
/// with a three-tap of two fingers over the library (there's no web inspector without a Mac).
struct DiagnosticsView: View {
    let client: IrohClient
    @Environment(\.dismiss) private var dismiss
    @State private var info: IrohClient.Diagnostics?
    @State private var download: String?
    @State private var busy = false

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
            .refreshable { info = await client.diagnostics() }
            .task { info = await client.diagnostics() }
        }
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

import IrohLib
import Network
import SwiftUI

@main
struct PagerApp: App {
    @Environment(\.scenePhase) private var phase
    @StateObject private var model = AppModel()

    var body: some Scene {
        WindowGroup {
            RootView()
                .environmentObject(model)
                .onOpenURL { model.open($0) }
        }
        .onChange(of: phase) { _, now in
            model.phaseChanged(now)
        }
    }
}

/// What the app shows, and what opening a pairing link does.
@MainActor
final class AppModel: ObservableObject {
    static let home = URL(string: "pager-app://localhost/")!

    /// Whether a pairing link was ever opened here (a computer to dial).
    @Published private(set) var hasComputer = Store.ticket != nil
    @Published private(set) var start = AppModel.home
    @Published private(set) var reload = UUID()
    @Published var showDiagnostics = false
    @Published var linkError: String?

    let client = IrohClient()
    /// The phone's copy of the library, and the changes waiting to be sent (README, "The copy").
    let copy = PhoneCopy()
    let outbox = Outbox()
    private(set) lazy var handler = PagerSchemeHandler(client: client, copy: copy, outbox: outbox)
    /// The tab bar around the web view, once made (Diagnostics reads its layout).
    weak var tabs: TabsController?
    private let network = NWPathMonitor()

    init() {
        let client = client
        let copy = copy
        Task { [weak self] in
            await client.setOnReach { online in
                Task { @MainActor in self?.reachChanged(online) }
            }
            await copy.prune()
        }
        // Wi-Fi joined, or signal back: look for the computer again without waiting for the backoff.
        network.pathUpdateHandler = { path in
            guard path.status == .satisfied else { return }
            Task { await client.networkChanged() }
        }
        network.start(queue: DispatchQueue.global(qos: .utility))
    }

    /// The computer came within reach, or went out of it: held streams end, and the page is told, so
    /// it sends what waited and shows or hides its offline line.
    private func reachChanged(_ online: Bool) {
        handler.reachChanged(online)
        tabs?.webView.evaluateJavaScript("window.__pager?.online?.(\(online))", completionHandler: nil)
    }

    /// The computer a ticket leads to: its endpoint ID.
    private static func computer(_ ticket: String?) -> String? {
        guard let ticket else { return nil }
        return (try? EndpointTicket.fromString(str: ticket))?.endpointAddr().id().description
    }

    /// A `pager://pair` link, from the Camera or pasted: keep where the computer is, dial it afresh,
    /// and open the pairing page with the code filled in. The computer then asks "Allow?".
    func open(_ url: URL) {
        guard let link = PairLink(url), (try? EndpointTicket.fromString(str: link.ticket)) != nil else {
            linkError = "That isn't a Pager pairing link. On your computer, open Settings, then Phone, then Pair a phone, and scan the code it shows."
            return
        }
        linkError = nil
        // Another computer: this phone's downloads and waiting changes belong to the old one's library.
        let before = Self.computer(Store.ticket)
        let another = before != nil && before != Self.computer(link.ticket)
        Store.ticket = link.ticket
        Store.relay = nil
        Store.relayToken = link.relayToken
        let code = link.code.addingPercentEncoding(withAllowedCharacters: .alphanumerics.union(CharacterSet(charactersIn: "-"))) ?? ""
        Task {
            if another {
                await copy.wipe()
                await outbox.clear()
            }
            await client.reset()
            start = URL(string: "pager-app://localhost/pair#code=\(code)")!
            hasComputer = true
            reload = UUID()
        }
    }

    func phaseChanged(_ phase: ScenePhase) {
        switch phase {
        case .background:
            Task {
                await client.disconnect()
                await copy.flush()
            }
        case .active:
            Task { await client.wake() }
        default:
            break
        }
    }
}

struct RootView: View {
    @EnvironmentObject private var model: AppModel

    var body: some View {
        Group {
            if model.hasComputer {
                PagerTabs(
                    start: model.start,
                    reload: model.reload,
                    handler: model.handler,
                    onDiagnostics: { model.showDiagnostics = true },
                    onMake: { model.tabs = $0 }
                )
                .ignoresSafeArea()
            } else {
                FirstRunView()
            }
        }
        .sheet(isPresented: $model.showDiagnostics) {
            DiagnosticsView(client: model.client, tabs: model.tabs, copy: model.copy, outbox: model.outbox)
        }
    }
}

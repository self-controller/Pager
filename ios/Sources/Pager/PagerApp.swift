import IrohLib
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
    private(set) lazy var handler = PagerSchemeHandler(client: client)
    /// The tab bar around the web view, once made (Diagnostics reads its layout).
    weak var tabs: TabsController?

    /// A `pager://pair` link, from the Camera or pasted: keep where the computer is, dial it afresh,
    /// and open the pairing page with the code filled in. The computer then asks "Allow?".
    func open(_ url: URL) {
        guard let link = PairLink(url), (try? EndpointTicket.fromString(str: link.ticket)) != nil else {
            linkError = "That isn't a Pager pairing link. On your computer, open Settings, then Phone, then Pair a phone, and scan the code it shows."
            return
        }
        linkError = nil
        Store.ticket = link.ticket
        Store.relay = nil
        Store.relayToken = link.relayToken
        let code = link.code.addingPercentEncoding(withAllowedCharacters: .alphanumerics.union(CharacterSet(charactersIn: "-"))) ?? ""
        Task {
            await client.reset()
            start = URL(string: "pager-app://localhost/pair#code=\(code)")!
            hasComputer = true
            reload = UUID()
        }
    }

    func phaseChanged(_ phase: ScenePhase) {
        if phase == .background {
            Task { await client.disconnect() }
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
            DiagnosticsView(client: model.client, tabs: model.tabs)
        }
    }
}

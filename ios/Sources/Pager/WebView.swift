import SwiftUI
import WebKit

/// The Pager UI in one web view (PagerWebView) on the app's own scheme, inside the system tab bar
/// (TabsController). It loads nothing else: a link elsewhere opens in Safari, so no outside page can
/// ever send requests through the scheme handler. The tab bar controller is made once: making it
/// again while a full-screen modal covers it breaks the glass (Apple forums 824566).
struct PagerTabs: UIViewControllerRepresentable {
    let start: URL
    /// A new value loads `start` again (a pairing link was opened).
    let reload: UUID
    let handler: PagerSchemeHandler
    let onDiagnostics: () -> Void
    /// The controller, once made (Diagnostics reads its layout).
    let onMake: (TabsController) -> Void

    func makeCoordinator() -> Coordinator {
        Coordinator(onDiagnostics: onDiagnostics)
    }

    func makeUIViewController(context: Context) -> TabsController {
        let view = PagerWebView.make(handler: handler, coordinator: context.coordinator)
        let tabs = TabsController(webView: view, start: start)
        context.coordinator.loaded = reload
        view.load(URLRequest(url: start))
        onMake(tabs)
        return tabs
    }

    func updateUIViewController(_ tabs: TabsController, context: Context) {
        context.coordinator.onDiagnostics = onDiagnostics
        if context.coordinator.loaded != reload {
            context.coordinator.loaded = reload
            tabs.webView.load(URLRequest(url: start))
        }
    }

    @MainActor
    final class Coordinator: NSObject, WKNavigationDelegate, WKUIDelegate {
        var onDiagnostics: () -> Void
        var loaded: UUID?

        init(onDiagnostics: @escaping () -> Void) {
            self.onDiagnostics = onDiagnostics
        }

        @objc func showDiagnostics() {
            onDiagnostics()
        }

        /// A new page (the first, a pairing link, a reload) starts with no reader open.
        func webView(_ webView: WKWebView, didCommit navigation: WKNavigation!) {
            (webView as? PagerWebView)?.pageLoaded()
        }

        // The async form: a closure-taking one whose attributes differ from the SDK's would compile as an
        // unrelated method and never be asked, letting every navigation through.
        func webView(_ webView: WKWebView, decidePolicyFor action: WKNavigationAction) async -> WKNavigationActionPolicy {
            guard let url = action.request.url else { return .cancel }
            if url.scheme == PagerSchemeHandler.scheme {
                return .allow
            }
            Self.openOutside(url)
            return .cancel
        }

        /// `target="_blank"` and window.open: never a new web view.
        func webView(_ webView: WKWebView, createWebViewWith configuration: WKWebViewConfiguration, for action: WKNavigationAction, windowFeatures: WKWindowFeatures) -> WKWebView? {
            if let url = action.request.url, url.scheme != PagerSchemeHandler.scheme {
                Self.openOutside(url)
            }
            return nil
        }

        private static func openOutside(_ url: URL) {
            guard let scheme = url.scheme?.lowercased(), ["http", "https", "mailto"].contains(scheme) else { return }
            UIApplication.shared.open(url)
        }
    }
}

extension PagerWebView {
    /// The app's web view, set up once: the scheme handler, the coordinator's navigation policy, no
    /// link previews, the edge swipe back, and the two-finger triple tap for Diagnostics.
    static func make(handler: PagerSchemeHandler, coordinator: PagerTabs.Coordinator) -> PagerWebView {
        let config = WKWebViewConfiguration()
        config.setURLSchemeHandler(handler, forURLScheme: PagerSchemeHandler.scheme)
        config.websiteDataStore = .default()
        let view = PagerWebView(configuration: config)
        view.navigationDelegate = coordinator
        view.uiDelegate = coordinator
        // A swipe in from the left edge goes back, in a book too, where it leaves the book; the
        // swipe from the right edge (forward) is off while the reader is open (PagerWebView).
        view.allowsBackForwardNavigationGestures = true
        // A long press on a link doesn't preview the page it leads to.
        view.allowsLinkPreview = false
        // The library and settings scroll the whole page and bounce as usual; the reader, a fixed page
        // that turns sideways, doesn't (PagerWebView, while the reader is open).
        view.scrollView.alwaysBounceHorizontal = false
        // The page lays itself out around the notch and home indicator (viewport-fit=cover).
        view.scrollView.contentInsetAdjustmentBehavior = .never
        // Clear until the page paints, over the page colour PagerWebView set.
        view.isOpaque = false
        #if DEBUG
        // Safari's Web Inspector on a Mac, or ios-webkit-debug-proxy, can attach to debug builds.
        view.isInspectable = true
        #endif
        // Two fingers, three taps: this app's diagnostics.
        let tap = UITapGestureRecognizer(target: coordinator, action: #selector(PagerTabs.Coordinator.showDiagnostics))
        tap.numberOfTouchesRequired = 2
        tap.numberOfTapsRequired = 3
        view.addGestureRecognizer(tap)
        return view
    }
}

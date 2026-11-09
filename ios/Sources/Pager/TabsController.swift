import UIKit
import WebKit

/// The app's tabs, in the bar's order. Their names are the page's (`NativeTab` in src/lib/native.ts)
/// and their order is NAV's (src/components/shell/nav.ts): keep the three in step.
enum PagerTab: String, CaseIterable {
    case library, highlights, assistant, settings

    var title: String {
        switch self {
        case .library: return "Library"
        case .highlights: return "Highlights"
        case .assistant: return "Assistant"
        case .settings: return "Settings"
        }
    }

    /// SF Symbols: the tab's icon, and its icon while selected.
    var symbols: (normal: String, selected: String) {
        switch self {
        case .library: return ("books.vertical", "books.vertical.fill")
        case .highlights: return ("highlighter", "highlighter")
        case .assistant: return ("sparkles", "sparkles")
        case .settings: return ("gearshape", "gearshape.fill")
        }
    }
}

/// One tab's page: clear and empty. The one web view moves into whichever page is about to appear.
@MainActor
final class TabPage: UIViewController {
    let pagerTab: PagerTab
    var willAppear: ((TabPage) -> Void)?

    init(_ tab: PagerTab) {
        self.pagerTab = tab
        super.init(nibName: nil, bundle: nil)
        let symbols = tab.symbols
        tabBarItem = UITabBarItem(title: tab.title, image: Self.symbol(symbols.normal), selectedImage: Self.symbol(symbols.selected))
    }

    required init?(coder: NSCoder) {
        fatalError("TabPage is made in code")
    }

    override func viewDidLoad() {
        super.viewDidLoad()
        view.backgroundColor = .clear
    }

    override func viewWillAppear(_ animated: Bool) {
        super.viewWillAppear(animated)
        willAppear?(self)
    }

    private static func symbol(_ name: String) -> UIImage? {
        let image = UIImage(systemName: name)
        if image == nil {
            assertionFailure("No SF Symbol named \(name)")
        }
        return image
    }
}

/// What Diagnostics shows of the layout, taken with the bar shown and with it hidden: the page's
/// `env(safe-area-inset-bottom)` must not change between the two, or the reader repaginates.
struct LayoutSnapshot {
    /// The bar's footprint: points from its top to the bottom of the screen.
    var footprint: CGFloat?
    /// The web view's own safe area at the bottom (UIKit's, before PagerWebView pins it to the window's).
    var webViewSafeBottom: CGFloat
    var windowSafeBottom: CGFloat?
    /// The page's `env(safe-area-inset-bottom)` and `--size-bottom-nav`, as CSS computed them.
    var pageSafeBottom: String
    var pageBottomNav: String
}

/// The system tab bar around the one web view: on iOS 26 and later the Liquid Glass bar. The page
/// owns which tab it is in and whether the bar shows (its `tabs` message); the bar shows that and
/// reports taps (`window.__pager.tab`). The page lays itself out under the bar and keeps its space,
/// whose size the app sends it (`window.__pager.tabBar`).
@MainActor
final class TabsController: UITabBarController, UITabBarControllerDelegate {
    let webView: PagerWebView
    private let pages = PagerTab.allCases.map { TabPage($0) }
    /// Whether the bar starts hidden: the pairing page has none.
    private let startsHidden: Bool
    /// The bar's footprint, last measured while it showed. Kept while it hides: the page keeps the
    /// bar's space, so the reader never reflows.
    private(set) var footprint: CGFloat?
    /// The footprint the page was sent this page load.
    private var sentFootprint: CGFloat?
    /// Whether the page has sent `tabs` since it loaded, so its `__pager.tabBar` is in place.
    private var pageListening = false
    /// Diagnostics' snapshots: with the bar shown (false) and hidden (true).
    private(set) var snapshots: [Bool: LayoutSnapshot] = [:]
    private var snapshotTask: Task<Void, Never>?

    init(webView: PagerWebView, start: URL) {
        self.webView = webView
        startsHidden = start.path == "/pair"
        super.init(nibName: nil, bundle: nil)
        webView.onTabs = { [weak self] tab, hidden in self?.pageTabs(tab, hidden: hidden) }
        webView.onTheme = { [weak self] color, style in self?.theme(color, style) }
        webView.onPageLoaded = { [weak self] url in self?.pageLoaded(url) }
    }

    required init?(coder: NSCoder) {
        fatalError("TabsController is made in code")
    }

    override func viewDidLoad() {
        super.viewDidLoad()
        delegate = self
        for page in pages {
            page.willAppear = { [weak self] page in self?.adopt(page) }
        }
        setViewControllers(pages, animated: false)
        selectedIndex = 0
        // Tint only: a background or a UITabBarAppearance would take the glass away. The current tab
        // in --fg-primary, the others in --fg-secondary (tokens.css), never the accent.
        tabBar.tintColor = Self.dynamic(light: 0x111111, dark: 0xE5E5E5)
        tabBar.unselectedItemTintColor = Self.dynamic(light: 0x616161, dark: 0xA3A3A3)
        if #available(iOS 26, *) {
            tabBarMinimizeBehavior = .never
        }
        // Before the page says: the last page colour, and the bar as a cold start shows it.
        let stored = Store.pageColor.flatMap(PagerWebView.color)
        theme(stored ?? .systemBackground, stored.map(Self.style))
        setBarHidden(startsHidden, animated: false)
    }

    // MARK: The page's messages

    /// `tabs`: select the page's tab (nil keeps the selection) and show or hide the bar. A selection
    /// made here doesn't call the delegate, so it never comes back to the page as a tap.
    private func pageTabs(_ tab: PagerTab?, hidden: Bool) {
        loadViewIfNeeded()
        if let tab, let index = PagerTab.allCases.firstIndex(of: tab), index != selectedIndex {
            selectedIndex = index
        }
        let changed = hidden != barHidden
        setBarHidden(hidden, animated: true)
        let first = !pageListening
        pageListening = true
        sendFootprint()
        if changed || first {
            takeSnapshot(after: 0.6)
        }
    }

    /// `theme`: the bar follows the page's light or dark, even against the phone's setting. Only the
    /// bar: the web view's own style sets the page's `prefers-color-scheme`, which the page's "System"
    /// theme reads, so overriding it would lock the page in the scheme it last chose.
    private func theme(_ color: UIColor, _ style: UIUserInterfaceStyle?) {
        loadViewIfNeeded()
        view.backgroundColor = color
        if let style {
            tabBar.overrideUserInterfaceStyle = style
        }
    }

    /// A new page (the first, a pairing link, a reload): its `__pager` isn't in place until it says.
    private func pageLoaded(_ url: URL?) {
        pageListening = false
        sentFootprint = nil
        if url?.path == "/pair" {
            setBarHidden(true, animated: false)
        }
    }

    // MARK: Taps

    /// A tap on a tab, the selected one included: the page decides what it opens (tab memory).
    func tabBarController(_ tabBarController: UITabBarController, didSelect viewController: UIViewController) {
        guard let page = viewController as? TabPage else { return }
        webView.evaluateJavaScript("window.__pager?.tab?.(\"\(page.pagerTab.rawValue)\")", completionHandler: nil)
    }

    /// The web view moves into the page about to appear, pinned to its edges (not its safe area):
    /// the page lays itself out under the status bar and the floating bar. Moving a WKWebView keeps
    /// its page and state.
    private func adopt(_ page: TabPage) {
        if webView.superview !== page.view {
            webView.frame = page.view.bounds
            webView.autoresizingMask = [.flexibleWidth, .flexibleHeight]
            page.view.addSubview(webView)
        }
        page.setContentScrollView(webView.scrollView, for: .bottom)
    }

    // MARK: The bar

    private var barHidden: Bool {
        if #available(iOS 18, *) {
            return isTabBarHidden
        }
        return tabBar.isHidden
    }

    private func setBarHidden(_ hidden: Bool, animated: Bool) {
        guard hidden != barHidden else { return }
        if #available(iOS 18, *) {
            setTabBarHidden(hidden, animated: animated)
        } else {
            tabBar.isHidden = hidden
        }
    }

    override func viewDidLayoutSubviews() {
        super.viewDidLayoutSubviews()
        guard !barHidden else { return }
        let top: CGFloat
        if #available(iOS 26, *) {
            top = contentLayoutGuide.layoutFrame.maxY
        } else {
            top = tabBar.frame.minY
        }
        let value = view.bounds.maxY - top
        // Not laid out yet, or nonsense: keep the last.
        guard value > 0, value < view.bounds.height / 2 else { return }
        footprint = value
        sendFootprint()
    }

    /// Tells the page the bar's footprint, once it listens and when it's new for this page load.
    private func sendFootprint() {
        guard pageListening, let footprint, footprint != sentFootprint else { return }
        sentFootprint = footprint
        webView.evaluateJavaScript("window.__pager?.tabBar?.(\(Double(footprint)))", completionHandler: nil)
    }

    // MARK: Diagnostics

    /// The layout now, kept as the snapshot for the bar's current state.
    @discardableResult
    func refreshSnapshot() async -> LayoutSnapshot {
        let hidden = barHidden
        let js = """
        (() => {
          const p = document.createElement("div");
          p.style.cssText = "position:fixed;left:0;bottom:0;width:0;height:0;visibility:hidden;" +
            "padding-bottom:env(safe-area-inset-bottom);margin-bottom:var(--size-bottom-nav, 0px)";
          document.body.appendChild(p);
          const s = getComputedStyle(p);
          const out = s.paddingBottom + "|" + s.marginBottom;
          p.remove();
          return out;
        })()
        """
        let page: String = await withCheckedContinuation { done in
            webView.evaluateJavaScript(js) { value, _ in
                done.resume(returning: value as? String ?? "")
            }
        }
        let parts = page.split(separator: "|", omittingEmptySubsequences: false).map(String.init)
        let snapshot = LayoutSnapshot(
            footprint: footprint,
            webViewSafeBottom: webView.systemSafeAreaInsets.bottom,
            windowSafeBottom: view.window?.safeAreaInsets.bottom,
            pageSafeBottom: parts.first ?? "—",
            pageBottomNav: parts.count > 1 ? parts[1] : "—"
        )
        snapshots[hidden] = snapshot
        return snapshot
    }

    /// A snapshot once the bar has finished showing or hiding.
    private func takeSnapshot(after seconds: Double) {
        snapshotTask?.cancel()
        snapshotTask = Task { [weak self] in
            try? await Task.sleep(nanoseconds: UInt64(seconds * 1_000_000_000))
            guard !Task.isCancelled else { return }
            await self?.refreshSnapshot()
        }
    }

    /// Whether the bar is hidden now (Diagnostics).
    var isBarHidden: Bool { barHidden }

    // MARK: Colours

    private static func dynamic(light: UInt32, dark: UInt32) -> UIColor {
        UIColor { traits in rgb(traits.userInterfaceStyle == .dark ? dark : light) }
    }

    private static func rgb(_ value: UInt32) -> UIColor {
        UIColor(
            red: CGFloat((value >> 16) & 0xFF) / 255,
            green: CGFloat((value >> 8) & 0xFF) / 255,
            blue: CGFloat(value & 0xFF) / 255,
            alpha: 1
        )
    }

    /// A cold start's guess at the page's scheme, from the page colour last kept: dark under 50% luminance.
    private static func style(_ color: UIColor) -> UIUserInterfaceStyle {
        var r: CGFloat = 0, g: CGFloat = 0, b: CGFloat = 0, a: CGFloat = 0
        color.getRed(&r, green: &g, blue: &b, alpha: &a)
        return 0.2126 * r + 0.7152 * g + 0.0722 * b < 0.5 ? .dark : .light
    }
}

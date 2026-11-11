import UIKit
import WebKit

/// The WKWebView the UI runs in, and its bridge to the page. The page posts small messages on
/// `window.webkit.messageHandlers.pager` (src/lib/native.ts): haptics, its page colour and scheme,
/// whether the reader is open, which of Pager's items the text menu gets for the current selection,
/// and its tab (TabsController). The menu items are added here, not in a view controller: since
/// iOS 18.2 the menu is built by the web view.
@MainActor
final class PagerWebView: WKWebView {
    /// Pager's items in the text menu. Their names are the page's (`NativeMenuItem` in native.ts).
    enum MenuItem: String {
        case highlight, note, reattach

        var title: String {
            switch self {
            case .highlight: return "Highlight"
            case .note: return "Note"
            case .reattach: return "Reattach Here"
            }
        }

        var symbol: String {
            switch self {
            case .highlight: return "highlighter"
            case .note: return "note.text"
            case .reattach: return "link"
            }
        }
    }

    /// The highlight colours, under the page's names (`HighlightColor`), each with its swatch.
    enum HighlightColor: String {
        case yellow, green, blue, pink, purple

        var title: String {
            rawValue.capitalized
        }

        /// The swatch the page shows for it (`--hl-*-line`), as 0xRRGGBB.
        var rgb: UInt32 {
            switch self {
            case .yellow: return 0xC9A227
            case .green: return 0x4F8F4F
            case .blue: return 0x466FB0
            case .pink: return 0xB5557F
            case .purple: return 0x7D5BB3
            }
        }

        var swatch: UIColor {
            UIColor(
                red: CGFloat((rgb >> 16) & 0xFF) / 255,
                green: CGFloat((rgb >> 8) & 0xFF) / 255,
                blue: CGFloat(rgb & 0xFF) / 255,
                alpha: 1
            )
        }
    }

    private static let menuID = UIMenu.Identifier(rawValue: "dev.pager.annotate")

    private let haptics = Haptics()
    /// Pager's items for the current selection: none unless it's in the reader's text.
    private var menuItems: [MenuItem] = []
    /// The colours Highlight offers, in the page's order (the last-used first); none for one plain Highlight.
    private var menuColors: [HighlightColor] = []

    /// The page's `tabs` message: its tab (nil keeps the bar's selection) and whether the bar hides.
    var onTabs: ((PagerTab?, Bool) -> Void)?
    /// The page's colour and, once the page has said, its scheme.
    var onTheme: ((UIColor, UIUserInterfaceStyle?) -> Void)?
    /// A new page load, at this URL.
    var onPageLoaded: ((URL?) -> Void)?

    init(configuration: WKWebViewConfiguration) {
        // Registered before the view takes the configuration. The controller keeps its handlers
        // strongly and the view keeps the controller, so the handler holds the view weakly.
        let proxy = WeakMessageHandler()
        configuration.userContentController.add(proxy, name: "pager")
        super.init(frame: .zero, configuration: configuration)
        proxy.target = self
        // The last page colour, before the page loads; the system's until the page has sent one.
        paint(Store.pageColor.flatMap { PagerWebView.color($0) } ?? .systemBackground)
    }

    required init?(coder: NSCoder) {
        fatalError("PagerWebView is made in code")
    }

    /// WebKit's swipe from the far edge: forward in the page's history. It is one of the two
    /// screen-edge recognizers that `allowsBackForwardNavigationGestures` puts on this view, and there
    /// is no setting for one without the other, so it is found by its edge (the right one, or the
    /// left in a right-to-left layout, as WebKit chooses it). If some iOS keeps them elsewhere, none
    /// is found and the forward swipe stays on.
    private func setForwardSwipe(enabled: Bool) {
        let leftToRight = UIView.userInterfaceLayoutDirection(for: semanticContentAttribute) == .leftToRight
        let forward: UIRectEdge = leftToRight ? .right : .left
        for case let swipe as UIScreenEdgePanGestureRecognizer in gestureRecognizers ?? [] where swipe.edges == forward {
            swipe.isEnabled = enabled
        }
    }

    /// A page load (the first, a pairing link, a reload): nothing of the last page's state holds.
    func pageLoaded() {
        allowsBackForwardNavigationGestures = true
        setForwardSwipe(enabled: true)
        scrollView.bounces = true
        menuItems = []
        menuColors = []
        onPageLoaded?(url)
    }

    // MARK: The safe area

    /// The page's safe area is the screen's. Inside the tab bar controller UIKit grows this view's
    /// bottom inset by the bar and shrinks it when the bar hides; WebKit would pass that on to
    /// `env(safe-area-inset-bottom)`, and every time the reader's chrome hid or showed, the page box
    /// would change and the book repaginate. The page keeps the bar's space itself (`--native-tab-bar`).
    override var safeAreaInsets: UIEdgeInsets {
        window?.safeAreaInsets ?? super.safeAreaInsets
    }

    /// UIKit's own safe area for this view, the bar included (Diagnostics).
    var systemSafeAreaInsets: UIEdgeInsets {
        super.safeAreaInsets
    }

    // MARK: Messages from the page

    /// One message from the page, through WeakMessageHandler.
    func received(_ message: WKScriptMessage) {
        // The app's own page only, never a frame inside it.
        guard message.frameInfo.isMainFrame,
              message.frameInfo.request.url?.scheme == PagerSchemeHandler.scheme,
              let body = message.body as? [String: Any],
              let type = body["t"] as? String
        else { return }
        switch type {
        case "haptic.prepare":
            haptics.prepare(body["kind"] as? String ?? "")
        case "haptic.fire":
            haptics.play(body["kind"] as? String ?? "")
        case "theme":
            guard let hex = body["background"] as? String, let color = PagerWebView.color(hex) else { return }
            if Store.pageColor != hex {
                Store.pageColor = hex
            }
            paint(color)
            let scheme: UIUserInterfaceStyle? = switch body["scheme"] as? String {
            case "dark": .dark
            case "light": .light
            default: nil
            }
            onTheme?(color, scheme)
        case "reader":
            // While a book is open the fixed page doesn't bounce. The swipe in from the left edge
            // still goes back, and out of the book: a visit to a book is one step in the page's
            // history however many chapters were turned (src/components/reader/trail.ts). The swipe
            // from the right edge goes forward in that history; in a book it would take the swipes
            // that turn to the next page from the edge, so it is off there.
            let open = body["open"] as? Bool ?? false
            scrollView.bounces = !open
            setForwardSwipe(enabled: !open)
        case "selection":
            menuItems = (body["items"] as? [String] ?? []).compactMap { MenuItem(rawValue: $0) }
            // Only the names this app knows, each once, in the page's order.
            var colors: [HighlightColor] = []
            for name in body["colors"] as? [String] ?? [] {
                if let color = HighlightColor(rawValue: name), !colors.contains(color) {
                    colors.append(color)
                }
            }
            menuColors = colors
        case "tabs":
            // `tab` is null off the shell's pages; a name this app doesn't know keeps the selection too.
            let tab = (body["tab"] as? String).flatMap { PagerTab(rawValue: $0) }
            onTabs?(tab, body["hidden"] as? Bool ?? false)
        default:
            break
        }
    }

    // MARK: The text menu

    /// The system's menu (Copy, Look Up, Translate, Share…), with Pager's items first when the
    /// selection is in the reader's text. Highlight opens the colours, the last-used first; without
    /// colours from the page it is one action, in the last-used colour.
    override func buildMenu(with builder: any UIMenuBuilder) {
        super.buildMenu(with: builder)
        guard builder.system == UIMenuSystem.context, !menuItems.isEmpty, builder.menu(for: Self.menuID) == nil else { return }
        if menuItems.contains(.highlight) {
            haptics.prepare("soft")
        }
        let colors = menuColors
        let children = menuItems.map { item -> UIMenuElement in
            let image = UIImage(systemName: item.symbol)
            guard item == .highlight, !colors.isEmpty else {
                return UIAction(title: item.title, image: image) { [weak self] _ in
                    self?.choose(item)
                }
            }
            let swatches = colors.map { color in
                let dot = UIImage(systemName: "circle.fill")?.withTintColor(color.swatch, renderingMode: .alwaysOriginal)
                return UIAction(title: color.title, image: dot) { [weak self] _ in
                    self?.choose(item, color: color)
                }
            }
            return UIMenu(title: item.title, image: image, children: swatches)
        }
        builder.insertChild(UIMenu(title: "", identifier: Self.menuID, options: .displayInline, children: children), atStartOfMenu: .root)
    }

    /// The page runs the item on its selection (useNativeMenu.ts), a highlight in `color` when one
    /// was picked. The names are these enums' own, so nothing from outside reaches the script.
    private func choose(_ item: MenuItem, color: HighlightColor? = nil) {
        let arguments = [item.rawValue, color?.rawValue].compactMap { $0 }.map { "\"\($0)\"" }.joined(separator: ", ")
        evaluateJavaScript("window.__pager?.menu?.(\(arguments))", completionHandler: nil)
    }

    // MARK: Colour

    /// The colour behind and around the page: the view, its scroll view, and past the page's edges.
    private func paint(_ color: UIColor) {
        backgroundColor = color
        scrollView.backgroundColor = color
        underPageBackgroundColor = color
    }

    /// `#rrggbb`, as the page sends it; nil for anything else.
    static func color(_ hex: String) -> UIColor? {
        let digits = hex.dropFirst()
        guard hex.first == "#", digits.count == 6, digits.allSatisfy(\.isHexDigit), let rgb = UInt32(digits, radix: 16) else {
            return nil
        }
        return UIColor(
            red: CGFloat((rgb >> 16) & 0xFF) / 255,
            green: CGFloat((rgb >> 8) & 0xFF) / 255,
            blue: CGFloat(rgb & 0xFF) / 255,
            alpha: 1
        )
    }
}

/// Passes the page's messages to the web view without keeping it alive.
@MainActor
private final class WeakMessageHandler: NSObject, WKScriptMessageHandler {
    weak var target: PagerWebView?

    func userContentController(_ controller: WKUserContentController, didReceive message: WKScriptMessage) {
        target?.received(message)
    }
}

/// The Taptic Engine for the page: one long-lived generator per kind, readied on touch-down and played
/// on commit. The page spaces them out and honours Settings → Haptics.
@MainActor
private final class Haptics {
    private let selection = UISelectionFeedbackGenerator()
    private let light = UIImpactFeedbackGenerator(style: .light)
    private let soft = UIImpactFeedbackGenerator(style: .soft)
    private let notification = UINotificationFeedbackGenerator()

    func prepare(_ kind: String) {
        switch kind {
        case "selection": selection.prepare()
        case "light": light.prepare()
        case "soft": soft.prepare()
        case "success", "error": notification.prepare()
        default: break
        }
    }

    func play(_ kind: String) {
        switch kind {
        case "selection": selection.selectionChanged()
        case "light": light.impactOccurred()
        case "soft": soft.impactOccurred()
        case "success": notification.notificationOccurred(.success)
        case "error": notification.notificationOccurred(.error)
        default: break
        }
    }
}

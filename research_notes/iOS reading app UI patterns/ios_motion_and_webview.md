# iOS motion, haptics and system behaviors behind great reading apps, and what a React UI in WKWebView can reproduce (late 2026)

Scope note: the brief says "iOS 26 / Safari 26". The MDN compat data (v8.1.7, 2026-10-22) lists **Safari/iOS 27 as the current release since 2026-09-14** (27.2 is in beta). The notes therefore give the Safari version in which each feature shipped. For Pager, the floor that matters is **iOS 17.5**, because that is the app's minimum. "Confirmed" items carry a source. "Inferences" are my own reasoning or arithmetic. Unless marked otherwise, the computed numbers come from my own scripts that apply the cited formulas.

## 1. Scroll physics: deceleration, rubber band, bounce-back, paging, scroll-to-top

### Takeaway
UIScrollView momentum is an exponential decay per millisecond. The rate is 0.998 for `.normal` and 0.99 for `.fast`, so the rest point is `x0 + (v0/1000)·d/(1−d)` (Apple's WWDC18 "project" form). The edge resistance follows the community-derived curve `(1 − 1/(x·0.55/d + 1))·d`. Apple documents none of these constants. They come from reverse engineering, and the WWDC18 projection helper agrees with them. Inside WKWebView, the document scroller and native overflow scrollers already use these physics. A web UI only has to re-implement them for scrolling that JS drives itself, such as drags, drawers and custom page turns.

### Cited Findings
- Apple's docs define `UIScrollView.DecelerationRate.normal` ("the default deceleration rate") and `.fast`, and say nothing more. They give **no numeric values** — [Apple: UIScrollView.DecelerationRate](https://developer.apple.com/documentation/uikit/uiscrollview/decelerationrate-swift.struct)
- Third-party sources give the values as **normal = 0.998** and **fast = 0.99**. In a react-native-webview discussion, setting 0.99 ("fast") on a web view "decelerated too quickly compared with Safari", and 0.998 "corresponds to normal" — [pub.dev IOSUIScrollViewDecelerationRate](https://pub.dev/documentation/esewa/latest/esewa/IOSUIScrollViewDecelerationRate-class.html); [react-native-webview PR #2815](https://github.com/react-native-webview/react-native-webview/pull/2815)
- The reverse-engineered model treats the rate as a factor applied **per millisecond**: v(t) = v0·d^(1000·t), with t in seconds. Integrating gives the rest point. The author calls a scroll finished when it is within ε of the rest point, for example half a pixel — [Lobanov, "How UIScrollView works" (mirror)](https://teletype.in/@swift-discipline/how-uiscrollview-works); [original on Medium](https://medium.com/@esskeetit/how-uiscrollview-works-e418adc47060)
- The exact rest-distance coefficient and Apple's WWDC approximation are **499.5 vs 499.0** for `.normal` (0.998) and **99.5 vs 99.0** for `.fast` (0.99). The two converge as d → 1, and the WWDC form uses `d/(1−d)` in place of `−1/ln d` — [Lobanov, "UIScrollView deceleration" (mirror)](https://teletype.in/@swift-discipline/uiscrollview-deceleration)
- In WWDC18 "Designing Fluid Interfaces", the end of a gesture is computed with a projection function that takes the velocity and `UIScrollView.DecelerationRate`. The result becomes the "imaginary, projected position" used to pick the nearest snap target (the FaceTime PiP corner). The session says projection is "incredibly useful for things being dragged or swiped, where you really need to respect the momentum" — [WWDC18 803](https://developer.apple.com/videos/play/wwdc2018/803/)
- The commonly quoted slide code is `project(v, d) = (v/1000)·d/(1−d)`. The WWDC18 transcript does not contain it, but the Wave library uses 0.998 as the default rate in its `project` helper — [WWDC18 803](https://developer.apple.com/videos/play/wwdc2018/803/) (code not in the transcript); [Wave utilities](https://www.mintlify.com/jtrivedi/Wave/api/utilities)
- The rubber band formula is `b = (1 − 1/((x·c/d) + 1))·d` with **c = 0.55**. Here x is the overscroll distance and d the scroll-view dimension (960 pt in the gist, an old iPhone height). The offset grows ever more slowly and never reaches d. A smaller c makes the edge feel stiffer — [originell gist](https://gist.github.com/originell/6961057); [Lobanov](https://teletype.in/@swift-discipline/how-uiscrollview-works)
- **Bounce-back** is modelled as a **critically damped spring (ζ = 1)**, so there is no oscillation at the edge. The model uses a different stiffness for a collision during momentum than for a release outside the bounds. When the finger lifts while the view is out of bounds, there is no deceleration phase: the view springs straight back — [Lobanov](https://teletype.in/@swift-discipline/how-uiscrollview-works)
- **Custom paging** works as follows: project the end point with `.normal`, choose the nearest anchor, then animate a spring to it. The spring's initial offset is the distance to the anchor, and the gesture velocity carries over. Standard `isPagingEnabled` uses fixed page sizes — [Lobanov](https://teletype.in/@swift-discipline/how-uiscrollview-works)
- WWDC18 gives the **hysteresis** before a drag is recognized: it "is usually **10 points** in iOS". It also stresses 1:1 tracking and detects a pause from the spike in the finger's acceleration, not from a timer — [WWDC18 803](https://developer.apple.com/videos/play/wwdc2018/803/)
- **Scroll-to-top**: a tap on the status bar asks "the scroll view closest to the status bar" to scroll to the top. Nothing happens if `scrollsToTop` is false, if the delegate returns false from `scrollViewShouldScrollToTop(_:)`, or if the content is already at the top. Afterwards the delegate receives `scrollViewDidScrollToTop(_:)`. The default is true. "On iPhone, the scroll-to-top gesture has no effect if there's more than one scroll view onscreen that has scrollsToTop set to true." — [Apple: scrollsToTop](https://developer.apple.com/documentation/uikit/uiscrollview/scrollstotop)

### Inferences
- My arithmetic with d = 0.998 and exact rest distance −v0/(1000·ln d):
  - **v0 = 500 / 1000 / 3000 pt/s** coasts **250 / 500 / 1499 pt** and takes about **3.1 / 3.5 / 4.0 s** to come within 0.5 pt.
  - With d = 0.99 the same flicks coast **50 / 100 / 299 pt** in about **0.46 / 0.53 / 0.64 s**.
  - For a web flick or drawer, use `.normal` to project the end point. Use `.fast`-like values for paging-style UIs.
- My arithmetic for the rubber band on an 844-pt viewport (c = 0.55): pulls of **50 / 100 / 200 / 400 / 844 pt** display as **26.6 / 51.6 / 97.3 / 174.5 / 299.5 pt**. At small pulls the content moves about half the finger distance.
- For a JS bounce-back after release, use a critically damped spring (bounce 0) and pass in the release velocity. A response of about 0.3–0.5 s matches the cited model. The exact Apple stiffness is unknown.
- In WKWebView the document scroller is a real UIScrollView. On iOS, composited `overflow: auto` areas are also native scroll views (an inference from WebKit's architecture, not checked against source this session). Native-feel scrolling is therefore free as long as content scrolls natively and is not moved by JS transforms.
- Scroll-to-top only reaches the WKWebView's own `scrollView`. If the app's root does not scroll (`overflow: hidden` with an inner scroller), a status-bar tap does nothing unless native code forwards it to JS. See section 7.

### Gaps
- Apple publishes none of the deceleration values, the 0.55 constant, the bounce-back stiffness or the paging spring. Everything above is reverse engineered.
- The original 0.55 source (reportedly a tweet) and the WWDC18 slide code could not be fetched. Medium returned 403, and the teletype mirrors rendered the formulas as images. The values are confirmed through numeric agreement (499.5/499.0) and the gist.
- The bounce-back spring constants and the timing of UIScrollView's `isPagingEnabled` snap: no source found.

## 2. Springs: fluid-interface principles, SwiftUI/UIKit parameters, conversion to web libraries and CSS `linear()`

### Takeaway
Apple's modern spring model has two parameters, a **perceptual duration** T and a **bounce** b, and mass is fixed at 1. In physics terms, k = (2π/T)² and ζ = 1 − b. The SwiftUI presets are `.smooth` (T 0.5, b 0), `.snappy` (T 0.5, b 0.15) and `.bouncy` (T 0.5, b 0.3). The pre-iOS 17 default was `spring(response: 0.5, dampingFraction: 0.825)`. These map exactly onto react-spring (`frequency` = T, `damping` = ζ) and Motion (stiffness/damping, or `visualDuration` = T/1.2 with the same bounce). CSS can only approximate them, by sampling into `linear()`, and CSS transitions do not carry velocity into an interruption.

### Cited Findings
- **WWDC18 principles**:
  - Springs are described by "damping ratio and frequency response", and Apple avoids the word "duration" for elastic behaviors.
  - "We recommend starting with **100% damping**". When the gesture itself has momentum, "reward that momentum with a little bit of overshoot". In Music, dismissing Now Playing without momentum uses 100% damping, and a swipe-dismiss uses **80% damping**.
  - The interface should be "fully redirectable", and hand-offs should happen "in smooth curves".
  — [WWDC18 803](https://developer.apple.com/videos/play/wwdc2018/803/)
- **WWDC23 "Animate with springs"**:
  - Springs take two parameters, duration and bounce, and **bounce ranges from −1.0 to 1.0**. "A small bounce, like around **15%**, doesn't feel very bouncy yet"; at "**30%** you do start to feel some noticeable bounciness"; "be cautious about using values higher than around **0.4**".
  - Springs are "the default animation in SwiftUI". Without a bounce argument you get "bounce 0", the "great general purpose spring".
  - On retargeting, "a spring animation uses the velocity it had when it was retargeted as the initial velocity", and SwiftUI tracks gesture velocities automatically.
  - Duration is a **perceptual** duration. The **settling** duration is different and "can be a bit unpredictable", so UI changes should not wait for it.
  — [WWDC23 10158](https://developer.apple.com/videos/play/wwdc2023/10158/)
- WWDC23 conversion slide: mass = 1 and stiffness = (2π ÷ duration)². The slide's damping expression did not survive text extraction intact; the exact relation is confirmed by Apple's worked example in the next item — [WWDC23 10158](https://developer.apple.com/videos/play/wwdc2023/10158/)
- Apple's `Spring` docs (iOS 17+) give worked examples. **`Spring(duration: 0.5, bounce: 0.3)` → (mass, stiffness, damping) = (1.0, 157.9, 17.6)**, and `Spring(mass: 1, stiffness: 100, damping: 10)` → (duration, bounce) = (0.63, 0.5). Other initializers are `init(response:dampingRatio:)` and `init(settlingDuration:dampingRatio:epsilon:)`. Response is "the stiffness of the spring, defined as an approximate duration in seconds" — [Apple: Spring](https://developer.apple.com/documentation/swiftui/spring)
- **Presets** (declared defaults, from Apple's docs):
  - `smooth(duration: 0.5, extraBounce: 0.0)`: "base bounce of 0" — [Apple: smooth](https://developer.apple.com/documentation/swiftui/animation/smooth(duration:extrabounce:))
  - `snappy(duration: 0.5, extraBounce: 0.0)`: "base bounce of **0.15**" — [Apple: snappy](https://developer.apple.com/documentation/swiftui/animation/snappy(duration:extrabounce:))
  - `bouncy(duration: 0.5, extraBounce: 0.0)`: "base bounce of **0.3**" — [Apple: bouncy](https://developer.apple.com/documentation/swiftui/animation/bouncy(duration:extrabounce:))
  - The docs define the duration as perceptual: "approximately equal to the settling duration, but for very bouncy springs, will be the duration of the period of oscillation".
- **Legacy SwiftUI springs**:
  - `spring(response: Double = 0.5, dampingFraction: Double = 0.825, blendDuration: 0)`. When springs on the same property replace each other, velocity is preserved — [Apple](https://developer.apple.com/documentation/swiftui/animation/spring(response:dampingfraction:blendduration:))
  - `interactiveSpring(response: 0.15, dampingFraction: 0.86, blendDuration: 0.25)` — [Apple](https://developer.apple.com/documentation/swiftui/animation/interactivespring(response:dampingfraction:blendduration:))
  - Some secondary sources state the default damping as 0.75. That is wrong according to Apple's declaration — [Create with Swift](https://www.createwithswift.com/understanding-spring-animations-in-swiftui/)
- **UIKit (iOS 17+)**: `UIView.animate(springDuration: 0.5, bounce: 0.0, initialSpringVelocity: 0.0, delay: 0.0, options: [], animations:completion:)` — [Apple](https://developer.apple.com/documentation/uikit/uiview/animate(springduration:bounce:initialspringvelocity:delay:options:animations:completion:)). Core Animation has `CASpringAnimation(perceptualDuration:bounce:)` — [WWDC23 10158](https://developer.apple.com/videos/play/wwdc2023/10158/)
- **Motion (Framer Motion) source, Oct 2026**:
  - For a bounce, `bounceToDampingRatio` "maps bounce to a damping ratio as SwiftUI does": ζ = 1 − b for b ≥ 0, and ζ = 1/(1 + b) for b < 0, floored at 0.05.
  - With `visualDuration` set, `stiffness = (2π / (visualDuration × 1.2))²` and `damping = 2ζ√stiffness`.
  - Source defaults: stiffness **100**, damping **10**, mass **1**; `bounce` default **0.3**; `visualDuration` default **0.3 s**.
  - `spring()` can emit a CSS easing string (`"<ms>ms " + linear(...)`).
  — [motion-dom spring.ts](https://github.com/motiondivision/motion/blob/main/packages/motion-dom/src/animation/generators/spring.ts)
- **Motion docs**:
  - Options include stiffness, damping, mass, `velocity` (default: "the current value's velocity"), `restSpeed` 0.1, `restDelta` 0.01, `visualDuration`, `bounce` and `duration` (800 ms).
  - The docs give the bounce default as 0.25, which conflicts with the source's 0.3. The docs also list a stiffness default that differs from the source.
  - Setting any physics option overrides the time-based options.
  — [motion.dev/docs/spring](https://motion.dev/docs/spring)
- **react-spring source**: when `frequency` is set, `tension = (2π/frequency)²·mass` and `friction = 4π·damping·mass/frequency`. `damping` is the damping ratio, default 1. Doc comment: "The natural frequency (in seconds)" — [react-spring AnimationConfig.ts](https://github.com/pmndrs/react-spring/blob/main/packages/core/src/AnimationConfig.ts). Defaults: tension 170, friction 26, mass 1. Presets: gentle 120/14, wobbly 180/12, stiff 210/20, slow 280/60, molasses 280/120 — [react-spring config](https://www.react-spring.dev/docs/advanced/config)
- **CSS `linear()`** approximates spring and bounce curves that cubic-bezier cannot express. Jake Archibald's and Adam Argyle's Linear Easing Generator converts a JS easing function, spring presets included, into a simplified `linear()` — [Chrome for Developers](https://developer.chrome.com/docs/css-ui/css-linear-easing-function); [Josh Comeau](https://joshwcomeau.com/animation/linear-timing-function). Safari has supported `linear()` since **17.2** — [MDN BCD](https://unpkg.com/@mdn/browser-compat-data/data.json)

### Inferences
- **Conversion formulas** (mass 1, T = perceptual duration or response):
  - ω0 = 2π/T
  - k = ω0² (Motion `stiffness`, react-spring `tension`)
  - c = 2ζω0 = 4πζ/T (Motion `damping`, react-spring `friction`)
  - ζ = 1 − b (b ≥ 0), or ζ = 1/(1 + b) (b < 0)
  - Check: T = 0.5, b = 0.3 gives k = 157.9 and c = 17.59, matching Apple's (157.9, 17.6).
- **Computed equivalents** (my script; settle times are from rest to a unit step with zero initial velocity):

| Apple spring | k = tension | c = friction | Motion `visualDuration` (same `bounce`) | overshoot | settle to 1% | settle to 0.1% |
|---|---|---|---|---|---|---|
| `.smooth` (0.5, b 0) | 157.9 | 25.13 | 0.417 s | 0% | 528 ms | 734 ms |
| `.snappy` (0.5, b 0.15) | 157.9 | 21.36 | 0.417 s | 0.6% | 355 ms | 696 ms |
| `.bouncy` (0.5, b 0.3) | 157.9 | 17.59 | 0.417 s | 4.6% | 523 ms | 818 ms |
| legacy `.spring()` (0.5, ζ 0.825) | 157.9 | 20.73 | 0.417 s | 1.0% | 459 ms | 688 ms |
| `interactiveSpring` (0.15, ζ 0.86) | 1754.6 | 72.05 | 0.125 s | 0.5% | 109 ms | 209 ms |

- In react-spring, the exact match is `config: { frequency: T, damping: ζ }`, e.g. `.snappy` = `{ frequency: 0.5, damping: 0.85 }`. In Motion it is `{ type: "spring", stiffness: k, damping: c, mass: 1 }`, or `{ type: "spring", visualDuration: T/1.2, bounce: b }`.
- **CSS `linear()` approximations** (my samples of the analytic spring, simplified to ±0.002, run to 0.1% settle). Use them for non-interactive transitions:
  - `.smooth`, **734 ms**: `linear(0, 0.018 2.2%, 0.062 4.4%, 0.123 6.5%, 0.411 15.2%, 0.478 17.4%, 0.54 19.6%, 0.597 21.8%, 0.648 24%, 0.694 26.1%, 0.735 28.3%, 0.771 30.5%, 0.831 34.9%, 0.876 39.2%, 0.91 43.6%, 0.945 50.1%, 0.976 61%, 1)`
  - `.snappy`, **696 ms**: `linear(0, 0.018 2.3%, 0.064 4.6%, 0.129 6.9%, 0.205 9.2%, 0.448 16.1%, 0.523 18.4%, 0.593 20.7%, 0.657 23%, 0.714 25.3%, 0.764 27.6%, 0.807 29.9%, 0.845 32.2%, 0.877 34.5%, 0.904 36.8%, 0.945 41.3%, 0.972 45.9%, 0.994 52.8%, 1)`
  - `.bouncy`, **818 ms**: `linear(0, 0.018 2%, 0.067 3.9%, 0.136 5.9%, 0.219 7.8%, 0.491 13.7%, 0.577 15.6%, 0.657 17.6%, 0.729 19.5%, 0.793 21.5%, 0.849 23.5%, 0.896 25.4%, 0.936 27.4%, 0.968 29.3%, 0.993 31.3%, 1.012 33.2%, 1.026 35.2%, 1.042 39.1%, 1.045 45%, 0.999 76.2%, 1)`
  - The CSS duration is the settle time, **not** T. A 0.5 s Apple spring needs about a 700–820 ms CSS duration, and most of the motion happens in the first ~40%.
- **Interruptibility on the web**: CSS transitions and `linear()` curves restart from the current value with no velocity, so a reversed drawer "kinks". Any surface the user can grab mid-flight (TOC drawer, settings sheet, chrome reveal) should use a JS spring that carries velocity: Motion's `velocity` defaults to the current velocity, and react-spring does the same. Keep CSS `linear()` for fire-and-forget transitions such as popover entry and fades.
- Tuning rule adapted from WWDC18: bounce 0 when the user taps, a small bounce (about 0.1–0.2, i.e. ζ ≈ 0.8–0.9) only when a flick with momentum ends the gesture.

### Gaps
- The WWDC23 slide's exact damping expression came through garbled. The relation above is confirmed by Apple's worked example and by Motion's "as SwiftUI does" mapping, not by the slide text.
- Apple does not publish the springs behind system transitions (navigation push, sheet detents, the iOS 26 glass morphs). WWDC23 says only that the presets are "based on spring values that are used in iOS".

## 3. System chrome behaviors used by readers (bars, iOS 26 Liquid Glass, large titles, sheets, back gestures)

### Takeaway
The building blocks are: hide the bars on tap (the classic reader "immersive" toggle) and on swipe; in iOS 26, minimize the tab bar on scroll, blur or fade content under the glass bars (a "scroll edge effect"), group glass toolbars, swipe back from anywhere in the content, and use sheets whose glass look changes with height. All of these are native-only APIs. A web UI can only imitate their look and motion, and only while the web content owns the scrolling.

### Cited Findings
- `hidesBarsOnSwipe` (iOS 8+): an upward swipe hides the navigation bar and toolbar, and a downward swipe shows them. A toolbar with no items stays visible. Default false — [Apple](https://developer.apple.com/documentation/uikit/uinavigationcontroller/hidesbarsonswipe)
- `hidesBarsOnTap` (iOS 8+): the controller toggles both bars "in response to an otherwise unhandled tap in the content area". Default false — [Apple](https://developer.apple.com/documentation/uikit/uinavigationcontroller/hidesbarsontap)
- **iOS 26, UIKit (WWDC25 "Build a UIKit app with the new design")**:
  - **Scroll edge effect**: "All scroll views underneath navigation or toolbars automatically apply a visual treatment… called an edge effect". `scrollView.topEdgeEffect.style = .hard` gives an iOS 18-like bar look. `UIScrollEdgeElementContainerInteraction` (with `scrollView` and `edge`) extends the effect to custom overlay containers.
  - **Tab bar**: `tabBarController.tabBarMinimizeBehavior = .onScrollDown`, and "the tab bar re-expands when scrolling in the opposite direction". The `UITabAccessory` bottom accessory moves inline when the bar minimizes.
  - **Bars**: bar items are auto-grouped on shared glass. `.fixedSpace(0)` splits groups, `hidesSharedBackground = false` merges them, and `style = .prominent` tints. Large titles now sit in the scroll view and scroll under the bar. The bar background is transparent by default, and a custom `UIBarAppearance` or background "interferes with the glass".
  - **Sheets**: "adapt their appearance from smaller to larger heights", and custom backgrounds should be removed. `preferredTransition = .zoom { barButtonItem }` morphs a sheet from its button.
  - **Back gesture**: the new **content backswipe** lets you "swipe back anywhere within the content area". Custom gestures gain priority by setting failure requirements on `interactiveContentPopGestureRecognizer`. Navigation transitions are now interruptible.
  - The session never mentions web views.
  — [WWDC25 284](https://developer.apple.com/videos/play/wwdc2025/284/)
- SwiftUI `tabBarMinimizeBehavior(_:)` (iOS 26) — [Apple](https://developer.apple.com/documentation/swiftui/view/tabbarminimizebehavior(_:)). Secondary sources say `.onScrollDown` works only on iPhone and the default `.automatic` does not minimize on iOS. Developers report bugs: a paged TabView blocks minimizing, and the accessory collapses only when the content is tall enough — [Create with Swift](https://www.createwithswift.com/making-the-tab-bar-collapse-while-scrolling/); [Hacking with Swift](https://www.hackingwithswift.com/quick-start/swiftui/how-to-make-a-tabview-minimize-on-scroll); [Apple forums 809945](https://developer.apple.com/forums/thread/809945)
- SwiftUI `scrollEdgeEffectStyle(_:for:)` (iOS 26): scroll views get an automatic edge effect by default, and `.hard` is an explicit option — [Apple](https://developer.apple.com/documentation/swiftui/view/scrolledgeeffectstyle(_:for:))
- SwiftUI `presentationDetents(_:)` (iOS 16+): sheets support `.large` by default, and with more than one detent "people can drag the sheet to resize it", e.g. `[.medium, .large]` — [Apple](https://developer.apple.com/documentation/swiftui/view/presentationdetents(_:))
- From iOS/Safari 26, `<meta name="theme-color">` "is only used for installed web apps" — [MDN BCD](https://unpkg.com/@mdn/browser-compat-data/data.json). Safari 26 added `WKWebView.obscuredContentInsets`, which adjusts the layout viewport around browser UI such as tab bars and toolbars — [WebKit: Safari 26.0](https://webkit.org/blog/17333/webkit-features-in-safari-26-0/); [Apple: obscuredContentInsets](https://developer.apple.com/documentation/webkit/wkwebview/obscuredcontentinsets) (iOS 26.0+)

### Inferences
- **Native edge effects over the web view**: if the SwiftUI shell puts native glass bars over the WKWebView, the iOS 26 edge effect tracks the WKWebView's own `scrollView`. Pager's reader keeps the root fixed (`overflow: hidden`) and scrolls an inner element, so a native edge effect would not follow the reading scroll. In the web UI, imitate it with a gradient mask or `backdrop-filter` strip (unprefixed since Safari 18, prefixed since 9) under the web bars.
- **Web equivalents** of the hide/minimize behaviors:
  - Tap in the content (outside links and selections) toggles the chrome, like `hidesBarsOnTap`.
  - Scroll down hides and scroll up shows, after ≥ 10 pt of travel (the iOS hysteresis), like `hidesBarsOnSwipe` / `tabBarMinimizeBehavior`.
  - Animate with `.smooth` / `.snappy` springs.
  - Scroll-driven animations (26+) can drive a scroll-linked fade. A show/hide that depends on direction still needs JS.
- **Sheets and detents**: a native SwiftUI sheet with `presentationDetents([.medium, .large])` gets Apple's detent spring, the iOS 26 glass and the drag-to-dismiss for free. A web sheet needs 1:1 drag, projection (d = 0.998), nearest-detent selection and a velocity-carrying spring.
- **Back gesture conflict**: content backswipe (iOS 26 native navigation) and `allowsBackForwardNavigationGestures` both compete with horizontal page-turn swipes in a paginated reader.

### Gaps
- Exact iOS 26 values: tab-bar minimize thresholds, edge-effect blur radius and fade height, sheet-detent spring parameters and the large-title collapse distance. None are documented, and I found no measurements.
- Whether the iOS 26 scroll edge effect applies automatically to a WKWebView's `scrollView` placed under SwiftUI bars: not verified.

## 4. Haptics: generators, SwiftUI `.sensoryFeedback`, HIG rules, reading-app uses

### Takeaway
iOS offers three semantic families:
- **selection**: values changing
- **impact**: light, medium, heavy, rigid or soft, for collisions and snaps
- **notification**: success, warning or error, for outcomes

Call `prepare()` ahead of time for low latency. The HIG asks for consistent and sparing use, and asks apps to make haptics optional. The web platform has **no haptics API on iOS**: `navigator.vibrate` is unsupported. The `<input switch>` hack reportedly stopped working in iOS 26.5, so Pager needs a native bridge.

### Cited Findings
- `UIFeedbackGenerator` (iOS 10+) is the abstract superclass of `UIImpactFeedbackGenerator` (a UI object "collides with something or snaps into place"), `UISelectionFeedbackGenerator`, `UINotificationFeedbackGenerator` and `UICanvasFeedbackGenerator`. It also has `convenience init(view:)`, which attaches the generator to a view — [Apple](https://developer.apple.com/documentation/uikit/uifeedbackgenerator)
- `prepare()` puts the generator "into a prepared state for a short period of time… with lower latency". Calling `prepare()` and firing immediately "does not improve latency". The Taptic Engine goes idle after feedback fires, after "a short period of time… (typically seconds)", or when the generator is deallocated. Call `prepare()` again right after firing if more feedback may follow within seconds. Repeated prepares without ever firing may be ignored — [Apple](https://developer.apple.com/documentation/uikit/uifeedbackgenerator/prepare())
- **HIG**:
  - Use system patterns according to their documented meanings, consistently, in harmony with the visuals ("match the intensity and sharpness of a haptic with… the animation"), and avoid overuse ("the best haptic experience is one that people may not be conscious of, but miss when it's turned off").
  - Prefer short haptics for discrete events, and "make haptics optional".
  - Impact: "a tap when a view snaps into place or a thud when two heavy objects collide". Light, medium and heavy mean collisions of small, medium and large objects; rigid means hard objects and soft means flexible ones.
  - Selection: "a UI element's values are changing". Notification: success means "a task or action has completed".
  - Standard toggles, sliders and pickers "play Apple-designed system haptics by default".
  — [HIG: Playing haptics](https://developer.apple.com/design/human-interface-guidelines/playing-haptics)
- SwiftUI `SensoryFeedback` (iOS 17+) for `View.sensoryFeedback`:
  - `start`, `stop`
  - `alignment` ("alignment of a dragged item"), `increase`, `decrease`, `levelChange`, `selection`, `pathComplete`
  - `success`, `warning`, `error`
  - `impact`, `impact(weight:intensity:)`, `impact(flexibility:intensity:)`
  - newer `press(_:)`, `release(_:)`, `selection(_:)` variants
  — [Apple: SensoryFeedback](https://developer.apple.com/documentation/swiftui/sensoryfeedback)
- Web: `navigator.vibrate` is **not supported** on Safari iOS or the iOS WebView — [MDN BCD](https://unpkg.com/@mdn/browser-compat-data/data.json)
- The **`<input type="checkbox" switch>` hack**: the switch control (Safari **17.4**) plays a haptic when toggled, and libraries click a hidden `<label>` to trigger it. The ios-haptics README (v3.1.1) says it "only works on ios 17.4 to 26.4, as apple patched it in ios 26.5". WebKit bug 285120 proposed requiring user activation because the hack allows "vibration from JS", and is marked resolved fixed — [ios-haptics README](https://unpkg.com/ios-haptics@3.1.1/README.md); [WebKit bug 285120](https://bugs.webkit.org/show_bug.cgi?id=285120); [MDN BCD (input switch 17.4)](https://unpkg.com/@mdn/browser-compat-data/data.json)

### Inferences
Suggested reading-app mapping (my judgment, derived from the HIG meanings):

| Event | Haptic | Note |
|---|---|---|
| Crossing a sheet or drawer detent, or a page-turn snap committing | `UIImpactFeedbackGenerator(.light)` or `.rigid` at low intensity (HIG: "snaps into place") | Fire once on commit, not on every frame |
| Font-size or line-height slider detents, theme segmented control, TOC scrubber passing a chapter | `UISelectionFeedbackGenerator.selectionChanged()` (HIG: "values are changing") | Already the system behavior for native sliders and pickers |
| Highlight created | `.impact(.soft)` / light | Mild "placed" feel |
| Note saved, book or download finished | `UINotificationFeedbackGenerator.success` | Sparingly. Finishing every chapter with success would be overuse, so consider no haptic, or only at the end of the book |
| Failure, e.g. a sync error | `.error` | |
| Hitting the first or last page edge | No haptic; the rubber band is the feedback | `.rigid` light if anything |

- Prepare the generators on `touchstart` or `pointerdown` from the web, because firing happens later. Re-prepare after each fire while a gesture is in progress.
- Respect a user toggle ("Haptics" in reading settings) as the HIG requires. The system "System Haptics" switch also silences these generators (general iOS behavior, not re-verified).

### Gaps
- I found no published Taptic Engine latency figures, prepared or unprepared.
- Whether the `<input switch>` haptic ever worked inside a third-party WKWebView, and whether 26.5 really removed it: not independently verified.
- Apple Books' own haptic choices were not documented.

## 5. Text selection on iOS and in WKWebView: native handles, edit menu, customizing or suppressing

### Takeaway
Keep the native selection handles: they give a precise loupe-assisted feel that a web UI cannot match. Customize the **edit menu** natively by subclassing WKWebView and overriding `buildMenu(with:)`. Since iOS 18.2, an override on the view controller is no longer called. If the menu must be drawn by the web, suppress the native one and wait for the selection to settle before showing yours. Use `-webkit-touch-callout: none` only for the long-press callout on links and images. It does not suppress the selection menu.

### Cited Findings
- iOS 18.2 change: a view controller's `buildMenu(with:)` override stopped being called when a WKWebView is first responder, because the web view consumes `buildMenuWithBuilder`. The accepted workaround is to **subclass WKWebView, override `buildMenu(with:)`, call `super` first, then add or remove items**. Apple asked for a Feedback report, and no fix is recorded — [Apple forums 770127](https://developer.apple.com/forums/thread/770127)
- The older route was `UIMenuController.shared.menuItems` plus `canPerformAction`. It is deprecated since iOS 16, though `canPerformAction` still works. A custom item does not receive the selected text, so read it with `evaluateJavaScript("window.getSelection().toString()")`. `builder.remove(menu: .lookup)` strips standard groups — [StackOverflow archive via search](https://kiwix.lema.org/stackoverflow.com_en_all_2023-11/questions/73763156/customize-menu-using-uieditmenuinteraction-in-wkwebview-ios-16); [Removing "Search Web" from a context menu](https://vicegax.substack.com/p/removing-search-web-from-a-context)
- Readium (a WKWebView EPUB navigator):
  - Adds actions through `EditingAction` with a `#selector` handled up the responder chain, then reads `navigator.currentSelection` and calls `clearSelection()`.
  - "You cannot customize the style of the native iOS text selection menu".
  - For a fully custom menu, return false from `shouldShowMenuForSelection` and position your own view using `selection.frame`.
  — [Readium swift-toolkit #385](https://github.com/readium/swift-toolkit/discussions/385)
- `-webkit-touch-callout: none` stops tap-and-hold from opening the callout on links and images. `-webkit-user-select: none` stops accidental selection on chrome, but text inputs must stay selectable — [dev.to: native-like PWAs for iOS](https://dev.to/oskarlarsson/designing-native-like-progressive-web-apps-for-ios-510o)
- Support data:
  - `-webkit-touch-callout` iOS 2+ (iOS-only)
  - `user-select` **prefixed only** (`-webkit-user-select`) on iOS
  - `selectionchange` iOS 5+
  - `caretRangeFromPoint` iOS 4+; `caretPositionFromPoint` **26.2**
  - `Selection.direction` 17
  - **`::selection` is listed as not supported on Safari iOS**
  - CSS Custom Highlight API (`Highlight`, `::highlight()`) **17.2**, but the highlight "is ignored when combined with `user-select: none`" (WebKit bug 278455)
  — [MDN BCD](https://unpkg.com/@mdn/browser-compat-data/data.json)
- Safari 26.0: "native selection UI inside scrolled content", plus selection fixes in overflow containers, around absolutely positioned elements and during autoscroll — [WebKit: Safari 26.0](https://webkit.org/blog/17333/webkit-features-in-safari-26-0/). Safari 27 fixes "touch-handle text selection blocked by JavaScript touch handling" and selection jumping or being lost in some `contenteditable` and `user-select: none` cases — [WebKit: Safari 27 beta](https://webkit.org/blog/17967/)
- `WKSelectionGranularity` is deprecated in Safari 26 — [WebKit: Safari 26.0](https://webkit.org/blog/17333/webkit-features-in-safari-26-0/)

### Inferences
- **Recommended pattern for a reader**: use the native menu with custom items via `buildMenu`. For example: insert Highlight, Note, Copy and Define at the front, and remove Share, Search Web, Translate and similar items if wanted. Each action calls JS (`callAsyncJavaScript("pagerSelectionAction(kind)")`), and JS turns the current `Range` into an annotation. This avoids "double menus" and handle jank. Keep the web annotation popover for tapping an **existing** highlight.
- **If the web draws the menu**:
  - Suppress the native menu in the subclass (remove all menus in `buildMenu`, or return false in `canPerformAction`). Not verified that this hides the bar entirely on iOS 17.5–27.
  - Show the web menu only after the selection is stable, for example on the first `selectionchange` with no change for about 150–250 ms. Handle drags fire `selectionchange` continuously, and touch events may not reach JS while native handles are dragged (unverified).
  - Place it above the selection, or below it if that would hit the top bar.
- Do not attach `touchstart`/`touchmove` handlers that call `preventDefault()` on reading text. Safari 27's fix list shows that JS touch handling can block the native selection handles.
- Because iOS ignores `::selection` (per BCD), the selection tint follows the app's tint and accent. Set the WKWebView's `tintColor` from native to theme the handles and selection (UIKit tint behavior, not re-verified for WKWebView).

### Gaps
- No primary Apple doc describes WKWebView edit-menu customization end to end, including `UIEditMenuInteraction` delegate hooks on WKWebView. The evidence is forum and StackOverflow posts.
- Whether iOS 26/27 changed `buildMenu` again: not found.

## 6. WebKit capabilities that matter for feel (versions per MDN BCD 8.1.7, 2026-10-22, plus WebKit release notes)

### Takeaway
At Pager's iOS 17.5 floor you can rely on:
- `overscroll-behavior` (16, partial)
- scroll snap (11; `scroll-snap-stop` 15)
- smooth `scroll-behavior` (15.4)
- `linear()` (17.2)
- `@starting-style` (17.5)
- Popover (17; light-dismiss broken on iOS until 18.3)
- `<dialog>` (15.4)
- `env(safe-area-inset-*)` with `viewport-fit=cover` (11)
- `dvh` (15.4)
- `visualViewport` (13)
- the Highlight API (17.2)

Only with feature detection:
- View Transitions (same-document 18.0; cross-document, types and classes 18.2)
- `content-visibility` (18.0; fully 26)
- scroll-driven animations (**26.0**)
- `scrollend` (**26.2**)
- anchor positioning (26)
- scroll anchoring with `overflow-anchor` (**27**)

### Cited Findings
Safari / iOS / iOS WebView versions from [MDN browser-compat-data 8.1.7](https://unpkg.com/@mdn/browser-compat-data/data.json):

| Feature | iOS Safari / WKWebView | Notes |
|---|---|---|
| `overscroll-behavior` (+ `-x`/`-y`) | 16 (partial) | "no effect on scroll containers that have no scrollable overflow" |
| `scroll-snap-type` / `-align` | 11 (prefixed 9) | `scroll-snap-stop` 15 |
| `scroll-behavior: smooth` | 15.4 | `scrollIntoView` smooth since 15.4 |
| `scrollend` event | **26.2** | |
| `animation-timeline` `scroll()`/`view()`, `animation-range`, `scroll-timeline`, `view-timeline`, `timeline-scope`, `ScrollTimeline`/`ViewTimeline` | **26.0** | |
| `document.startViewTransition`, `view-transition-name` | **18.0** | |
| Cross-document `@view-transition`, `startViewTransition({types})`, `view-transition-class`, `:active-view-transition-type` | **18.2** | `view-transition-name: match-element` 18.4 |
| `linear()` easing | **17.2** | |
| `@starting-style` | **17.5** | |
| `popover` attribute / `showPopover` | **17.0** | Partial until **18.3**: "on iOS… popovers are not dismissed when the user taps outside" (bug 267688). `popover="hint"` not shipped |
| `<dialog>` | 15.4 | `requestClose()` 18.4; `closedby` not shipped |
| `content-visibility` | 18.0 | `auto` fully only from **26** (before that, skipped content was not findable via find-in-page) |
| `contain-intrinsic-size` | 17 | |
| `env()` | iOS 11.3 (`constant()` in 11.0) | `safe-area-inset-*` and `viewport-fit` 11 |
| `dvh`/`svh`/`lvh` | 15.4 | |
| `VisualViewport` | 13 | `interactive-widget` viewport key and VirtualKeyboard API **not supported** |
| `touch-action: manipulation` | iOS 9.3 | |
| `-webkit-tap-highlight-color` | iOS 4 | |
| `-webkit-touch-callout` | iOS 2 | iOS only |
| `user-select` | `-webkit-` prefix only on iOS | |
| `::selection` | not supported on iOS | |
| Highlight API / `::highlight()` | 17.2 | Ignored with `user-select: none` |
| `columns` (unprefixed) | 9 | `column-fill` 9; `break-inside` 10 |
| `hyphens` (unprefixed) | 17 | |
| `text-wrap` | 17.4 | `text-wrap-style` 17.5; `text-wrap: pretty` **26** |
| `hanging-punctuation` | 10 partial, full **26.5** | |
| `text-box-trim` | 18.2 | |
| `text-autospace` | 18.4 | |
| Anchor positioning (`anchor-name`, `position-try-fallbacks`) | **26** | `position-anchor` partial until 27 |
| `overflow-anchor` (scroll anchoring) | **27** | |
| `backdrop-filter` | 18 (prefixed 9) | |
| `PointerEvent.getCoalescedEvents` / `getPredictedEvents` | 18.2 | |
| Screen Wake Lock | 18.4 (16.4 partial) | |
| `prefers-reduced-motion` | 10.3 | |
| `requestIdleCallback` | not on iOS | |
| `interpolate-size` / `calc-size()` | not supported | |
| `navigator.vibrate` | not supported | |

- Safari release dates per BCD: 26.2 (2025-12-12), 26.4 (2026-03-24), 26.5 (2026-05-11), 26.6 (2026-07-27), **27 (2026-09-14, current)**, 27.2 in beta — [MDN BCD](https://unpkg.com/@mdn/browser-compat-data/data.json)
- Safari 26.0 shipped scroll-driven animations (`animation-timeline: view()`, `animation-range` and related properties), anchor positioning, `text-wrap: pretty`, a fix for `content-visibility: auto` find-in-page, SwiftUI `WebView`/`WebPage` (with `webViewScrollPosition`, `webViewMagnificationGestures`, `findNavigator`, `URLSchemeHandler`), `obscuredContentInsets`, and `backdrop-filter` on content behind a transparent web view. Its notes list only view-transition **fixes**, no new view-transition features — [WebKit: Safari 26.0](https://webkit.org/blog/17333/webkit-features-in-safari-26-0/); [WebKit: WWDC25 / Safari 26 beta](https://webkit.org/blog/16993/news-from-wwdc25-web-technology-coming-this-fall-in-safari-26-beta/)
- Safari 27 (WWDC26) added:
  - **Scroll anchoring** (`overflow-anchor`, default `auto`)
  - Fixes for momentum scrolling, `scrollTo` during momentum, rubber-banding, `scroll-snap-type: mandatory` with smooth scrolling on iOS, and `scrollIntoView()` on scrollable elements
  - Two view-transition snapshot fixes
  - New WKWebView API: `WKJSHandle` (JS object references from native), `WKSerializedNode`, `WKContentWorldConfiguration`, `WKWebView.load(url:)`, `willSubmitForm`
  — [WebKit: Safari 27 beta](https://webkit.org/blog/17967/)
- A secondary blog claims threaded scroll-driven animations landed in 26.4 and accuracy fixes in 26.5. This is **unverified** — [buildmvpfast](https://www.buildmvpfast.com/blog/css-scroll-driven-animations-replace-js-2026)
- **Overscroll on the root**: a WebKit bug from March 2022 tracked making `overscroll-behavior` on `html` work for the main document on iOS — [WebKit bug 237696](https://bugs.webkit.org/show_bug.cgi?id=237696). Developers describe Safari 16 as the first version that can suppress bounce in CSS — [Ionic forum](https://forum.ionicframework.com/t/how-to-prevent-bounce-elastic-scroll-in-ios-prior-to-v16/235561)
- **CSS multi-column pagination in WebKit** (Readium CSS):
  - Safari needs the single-column width set to the full viewport ("otherwise it won't fragment content").
  - `column-gap` must be in **px** "so that it won't resize with font size", and "you must account for this gap when scrolling".
  - Font size must be enforced on `:root` because the layout uses `rem`.
  - Vertical writing falls back to a scrolled "fragmented model".
  — [Readium CSS: injection & pagination](https://readium.org/css/docs/CSS03-injection_and_pagination.html); [Readium CSS API](https://readium.org/css/docs/CSS19-api.html)

### Inferences
- **Root versus inner scrollers**:
  - With a fixed app shell, `overscroll-behavior: none` on `html, body` stops the whole page from rubber-banding (Safari 16+). The BCD caveat (no effect without scrollable overflow) means a non-scrolling root may still bounce through the native WKWebView scroll view. Setting `webView.scrollView.bounces = false` natively is the reliable fix.
  - On inner scrollers, keep the native rubber band (it is part of the feel) and use `overscroll-behavior: contain` to stop scroll chaining.
  - iOS rubber-banding cannot be restyled; it can only be turned on or off.
- **Paginated mode**: CSS scroll snap on the horizontal column scroller (`scroll-snap-type: x mandatory`, `scroll-snap-stop: always`, snap points per page) gives native momentum and snapping physics for page swipes. That beats JS-driven `scrollLeft` jumps or transforms. Detect page changes with `scrollend` (26.2+) and fall back to a debounce. Programmatic `scrollTo({behavior: 'smooth'})` with mandatory snap had iOS bugs that Safari 27 fixed, so test on iOS 17.5 and 18.
- View Transitions (18+) suit chapter-to-chapter and library-to-reader cross-fades. Feature-detect and fall back to a plain swap on 17.5.
- `@starting-style` and `linear()` give popovers and drawers spring-like entries on every supported OS.

### Gaps
- Primary WebKit release notes for Safari 16, 17.2, 17.5, 18.0 and 18.2 were not fetched individually. Their versions come from MDN BCD, which is a reliable aggregate.
- I found no authoritative list of WebKit-specific multi-column bugs, for example `scrollWidth` rounding or a blank last column. Only Readium's guidance was found.

## 7. WKWebView settings that affect feel, including 120 Hz ProMotion

### Takeaway
The relevant settings are:
- `scrollView.bounces` / `alwaysBounce*`, `contentInsetAdjustmentBehavior`, `scrollsToTop`
- `allowsBackForwardNavigationGestures`, `allowsLinkPreview = false`
- `isInspectable` (16.4+), `isOpaque` and background colors
- `obscuredContentInsets` (26+)

**rAF in WKWebView stays capped at 60 Hz** on ProMotion devices as of the latest reports (WebKit bug 294338, still NEW in Sept 2026). `CADisableMinimumFrameDurationOnPhone` does not lift the cap. The only known unlock is a private WebKit preference.

### Cited Findings
- `allowsLinkPreview`: default **true** since iOS 10. With it on, pressing links and detected data shows previews, and "pop navigation switches the user… to Safari" — [Apple](https://developer.apple.com/documentation/webkit/wkwebview/allowslinkpreview)
- `isInspectable` (iOS 16.4+): defaults to `false`; set it to `true` to allow Safari Web Inspector — [Apple](https://developer.apple.com/documentation/webkit/wkwebview/isinspectable)
- Capacitor's iOS options mirror these knobs:
  - `contentInset` (`automatic|scrollableAxes|never|always`, default **`never`**)
  - `scrollEnabled`, `allowsLinkPreview`, `backgroundColor`
  - `limitsNavigationsToAppBoundDomains`
  - `webContentsDebuggingEnabled` (iOS 16.4+, defaults to true in dev builds)
  - a custom `iosScheme`, which "can't be set to schemes that the WKWebView already handles"
  — [Capacitor config](https://capacitorjs.com/docs/config)
- Keyboard: Capacitor's Keyboard plugin offers iOS `resize` modes (default `native`, alternatives such as `body`) that can be changed at runtime, plus `autoBackdropColor` for the area behind the keyboard. One iOS overlap problem was fixed by switching to `body` — [Capacitor Keyboard](https://capacitorjs.com/docs/apis/keyboard); [Ionic forum 236395](https://forum.ionicframework.com/t/page-content-overlaps-device-status-bar-when-soft-keyboard-is-open-only-on-ios/236395)
- iOS 26 keyboard bugs:
  - `visualViewport.offsetTop` can stay > 0 after the keyboard closes, which misaligns fixed headers and footers (Safari and WKWebView) — [Apple forums 800125](https://developer.apple.com/forums/thread/800125)
  - With the keyboard up, an interactive swipe-back can leave a fixed header offset by about the keyboard height. Workaround: `blur()` before navigating — [Apple forums 797097](https://developer.apple.com/forums/thread/797097)
  - An older iOS 12 bug, where the web view did not return after the keyboard, had the community workaround `webView.setNeedsLayout()` — [WebKit bug 192564](https://bugs.webkit.org/show_bug.cgi?id=192564)
- **120 Hz**: [WebKit bug 294338](https://bugs.webkit.org/show_bug.cgi?id=294338), "Allow WKWebView to Support 120Hz Refresh Rate on ProMotion Devices", is NEW and unassigned (rdar 153131340, last modified 2026-09-17). It reports:
  - In Safari, turning off "Prefer Page Rendering Updates Near 60fps" gives 120 Hz, but this does not apply to WKWebView apps.
  - WKWebView stayed at 60 fps even with the Info.plist key `CADisableMinimumFrameDurationOnPhone`.
  - A July 2026 comment found an internal preference, **`PreferPageRenderingUpdatesNear60FPSEnabled`**. Disabling it gave 120 fps in WKWebView on a device, and the commenter proposed a public `WKPreferences` API. There is no maintainer reply.
  - A 2026 comment says Capacitor and Tauri plugins unlock 120 Hz "by calling private WebKit APIs", which the commenter calls fragile.
- An Apple Frameworks Engineer pointed a forum asker to bug 294338, offering no workaround — [Apple forums 796512](https://developer.apple.com/forums/thread/796512). An earlier thread (FB16411517, Jan 2025) got no Apple answer — [Apple forums 773222](https://developer.apple.com/forums/thread/773222)
- Historic note: one post on WebKit bug 173434 reported 120 Hz rAF unsupported on iPhone 16 Pro while working on other Pro iPhones with the flag off. The thread is noisy, so treat device specifics as uncertain — [webkit-unassigned list](https://lists.webkit.org/pipermail/webkit-unassigned/2024-September/1186035.html)

### Inferences
- **What still runs smoothly at 60 Hz rAF**:
  - Native scrolling, which is UIScrollView in the UI process.
  - CSS transitions and animations on `transform`/`opacity`, and WAAPI animations of those properties. WebKit on iOS hands these to Core Animation, so they *may* run at the display rate even while rAF is capped (an inference from WebKit's UI-side compositing; not verified with a measurement).
  - The practical rule: move as much motion as possible to native scroll, CSS or WAAPI. Keep rAF/JS springs for gestures that need 1:1 tracking, where 60 Hz is acceptable.
- **Private SPI**: do not ship the private `PreferPageRenderingUpdatesNear60FPSEnabled` toggle (`_features`/`_setEnabled:forFeature:` style SPI). It carries App Store review risk and may break.
- **Info.plist**: setting `CADisableMinimumFrameDurationOnPhone = YES` still helps the native SwiftUI parts, such as native sheets, reach 120 Hz on iPhone. That is general ProMotion behavior, not re-verified here.
- **Root bounce**: with an `overflow: hidden` shell, set `webView.scrollView.bounces = false` (and `alwaysBounceVertical = false`). Otherwise the whole UI, tab bar included, rubber-bands on a vertical drag, which is a classic web-view tell.
- **Status-bar tap**: set `webView.scrollView.scrollsToTop = false` when the root does not scroll. To forward the gesture, add a hidden helper `UIScrollView` with `scrollsToTop = true` whose delegate returns false from `scrollViewShouldScrollToTop` and posts "scrollToTop" to JS. This is a known community pattern, unverified here, and it relies on the "only one scrollsToTop view" rule from section 1.
- **Background colors**: set `isOpaque = false` plus a background matching the reader theme, so there is no white flash at launch or during bounces. Update it from JS when the theme changes. `underPageBackgroundColor` (iOS 15+) is the property for the over-scroll area; the name comes from prior knowledge and was not re-fetched.

### Gaps
- No public API or Apple statement says whether iOS 27 lets WKWebView rAF reach 120 Hz. The Safari 27 notes do not mention frame rate.
- I found no measurements of CSS/WAAPI animation frame rates inside WKWebView on ProMotion.

## 8. Bridging JS to native haptics (WKScriptMessageHandler) and its latency

### Takeaway
`window.webkit.messageHandlers.<name>.postMessage(...)` into a `WKScriptMessageHandler` is the standard bridge. One round trip measured **0.63 ms** on an iPad Air 2 with iOS 9, so on current hardware a one-way haptic call is very likely well under one 16.7 ms frame. Prepare the generator early, from a touch-down message, so the Taptic Engine's own latency stays low.

### Cited Findings
- WKWebView message-handler round trip: **2.94 (iOS 8.4) → 0.63 (iOS 9.0 b5)**, units implied ms, on an iPad Air 2. Same table, iOS 9: WKWebView `location.hash` 0.58, `document.title` 0.63, `alert()` 0.46, `prompt()` 0.45, JS-execution round trip 0.39. The iOS 9 gain came from reusing the JSContext in `didPostMessage` — [persistent.info, Aug 2015](https://blog.persistent.info/2015/08/wkwebview-communication-latency.html); [Jan 2015](https://blog.persistent.info/2015/01/wkwebview-communication-latency.html)
- A Rust/WebKit binding measured an average **≈0.11 ms** per message over 100,000 messages on a 2017 MacBook, about 2× worse when the payload is read. The method is questionable (its average is computed in whole ms) — [darwin-webkit benchmark](https://rust-digger.code-maven.com/src/darwin-webkit-0.2.0/docs/COUNT_BENCHMARK.md)
- `WKScriptMessageHandlerWithReply` (promise-returning handlers) exists in WebKit's Cocoa API — [WebKit source header](https://webkit.googlesource.com/WebKit/+/49e061d8a3dbe8c30f3935dcdd27d7b6b9ae2882/Source/WebKit/UIProcess/API/Cocoa/WKScriptMessageHandlerWithReply.h). Safari 27 adds `WKJSHandle` (JS object references from native) and `WKContentWorldConfiguration` — [WebKit: Safari 27 beta](https://webkit.org/blog/17967/)
- The Taptic Engine needs time after `prepare()` to reach low latency, and stays prepared for "typically seconds" — [Apple: prepare()](https://developer.apple.com/documentation/uikit/uifeedbackgenerator/prepare())

### Inferences
- Bridge design:
  - Use fire-and-forget `postMessage({t: "selection"})` with no reply, through a handler registered in the page content world.
  - On the native side, keep long-lived generators: one each of selection, impact-light, impact-rigid, impact-soft and notification. Use the iOS 17.5 view-attached initializer where available.
  - Send `{t: "prepare", kind}` on `pointerdown`/`touchstart` and fire on commit.
  - Batch-limit to at most one haptic per animation frame.
- Expected end-to-end latency (IPC plus main thread plus Taptic): low single-digit ms. A JS-to-native hop is not a perceptible problem. An unprepared Taptic Engine might be (unknown magnitude).

### Gaps
- No modern (iOS 17–27, A15+) measurement of WKScriptMessageHandler latency was found. The figures above are from 2015–2017.

## 9. Field reports and the common "web view tells"

### Takeaway
Teams that shipped hybrid apps converge on a fixed list of fixes:
- kill the tap delay, the tap highlight and accidental selection or callouts
- stop root rubber-banding
- respect safe areas
- size inputs at ≥ 16 px
- hover only on hover devices
- handle the keyboard through `visualViewport`
- test on devices

The biggest teams (Notion) went native for high-interaction screens instead. I found no engineering write-ups from Readwise Reader or Libby.

### Cited Findings
- **Tap delay**: WebKit on iOS had a **350 ms** delay before single taps fired, so that double-tap-zoom could be detected. WebKit removed it for pages that are not zoomable or are already mobile-scaled (`width=device-width, initial-scale=1`). Later WebKit detected more fast-tap cases automatically — [WebKit: More Responsive Tapping on iOS (2015)](https://webkit.org/blog/5610/more-responsive-tapping-on-iOS/); [WebKit: New Interaction Behaviors in iOS 10](https://webkit.org/?p=7367). `touch-action: manipulation` has been supported since iOS 9.3 — [MDN BCD](https://unpkg.com/@mdn/browser-compat-data/data.json)
- **Native-feel guides** recommend:
  - `-webkit-tap-highlight-color: transparent`
  - `-webkit-user-select: none` on non-content (keep text inputs selectable)
  - `-webkit-touch-callout: none` on links and images in chrome
  - `overscroll-behavior: none` on `html, body`
  - inputs ≥ 16 px to avoid focus zoom
  - `:active` feedback instead of the gray tap box
  - hover styles inside `@media (hover: hover)`
  - `viewport-fit=cover` with `env(safe-area-inset-*)`, and `100dvh`
  - testing on real devices, because emulators miss sticky hover, tap delay, rubber-banding, safe areas and the keyboard
  — [dev.to: Designing native-like PWAs for iOS](https://dev.to/oskarlarsson/designing-native-like-progressive-web-apps-for-ios-510o); [egghead: disable selection and callouts](https://egghead.io/lessons/react-disable-text-selection-and-touch-callouts-in-a-pwa-on-ios)
- **Notion**: the mobile apps "used to be simple wrappers" around a WebView. From 2020 the team moved high-interaction screens to native code. The native Home tab (2022) gave about **3×** faster perceived startup on Android and **2×** on iOS, and native Search (2023) loaded more than 80% faster. Web views are being replaced "one piece at a time" — [Notion blog](https://www.notion.com/blog/notion-on-android-is-now-more-than-twice-as-fast-to-launch); [Notion release notes 2022-07-20](https://www.notion.com/releases/2022-07-20); [Pragmatic Engineer podcast](https://ppacc.player.fm/series/the-pragmatic-engineer/notion-going-native-on-ios-and-android)
- **Keyboard tells**: fixed elements end up misaligned after the keyboard closes (iOS 26 `visualViewport.offsetTop` bug), and headers stay offset after a swipe-back with the keyboard open — [Apple forums 800125](https://developer.apple.com/forums/thread/800125); [Apple forums 797097](https://developer.apple.com/forums/thread/797097)
- **Readium** (the open-source EPUB engine used by many iOS readers) paginates with CSS columns inside WKWebView and keeps the native selection menu, extended through `EditingAction` — [Readium CSS](https://readium.org/css/docs/CSS03-injection_and_pagination.html); [Readium #385](https://github.com/readium/swift-toolkit/discussions/385)

### Inferences
Tells beyond the cited list (my judgment):
- Whole-app rubber band, including the tab bar.
- White or black flash at launch or on over-scroll.
- 60 Hz JS-driven animations next to 120 Hz native ones.
- Drawers that cannot be grabbed mid-animation, or that lose velocity when released.
- Ease-in-out CSS curves instead of springs.
- Page turns that jump (`scrollLeft =`) instead of gliding with momentum.
- Link previews popping into Safari.
- Double selection menus (native and custom).
- Missing haptics on detents and toggles.
- Hover states that stick.
- Status-bar tap doing nothing.
- Edge back-swipe hijacking page turns.
- Focus zoom on small inputs.

### Gaps
- Readwise Reader, Libby and Linear: I found no public engineering write-ups on their hybrid or web-view techniques. Linear's iOS app is reportedly native, but this was not verified this session.

## 10. Implications for Pager

### Takeaway
Pager already does a few things right:
- `viewport-fit=cover` with `env(safe-area-inset-*)`
- `contentInsetAdjustmentBehavior = .never`
- `width=device-width, initial-scale=1.0`, so no tap delay
- `selectionchange`-based selection tracking

The largest gains would come from four changes: (1) stop the root bouncing and enable native momentum snapping for page turns; (2) springs that carry velocity for the drawers and sheets; (3) a native haptics bridge; (4) native edit-menu items through a WKWebView subclass. All of it works on iOS 17.5, with progressive extras on 18 and 26.

### Cited Findings
- Current shell (`/home/david/Desktop/projects/Pager/ios/Sources/Pager/WebView.swift`):
  - `allowsBackForwardNavigationGestures = true`
  - `scrollView.contentInsetAdjustmentBehavior = .never`
  - `isOpaque = false`, `backgroundColor = .systemBackground`
  - no message handlers
  - no `allowsLinkPreview`, `isInspectable` or `bounces` settings
  - a plain `WKWebView`, not a subclass
- Current `/home/david/Desktop/projects/Pager/ios/Info.plist` has no `CADisableMinimumFrameDurationOnPhone`.
- Current web UI:
  - `index.html` viewport: `width=device-width, initial-scale=1.0, viewport-fit=cover`.
  - The paginated reader jumps with `el.scrollLeft = scrollLeftFor(...)` (`/home/david/Desktop/projects/Pager/src/components/reader/usePagination.ts`).
  - Selection uses `selectionchange` + rAF (`/home/david/Desktop/projects/Pager/src/tools/useSelection.ts`).
  - The tab bar is a fixed web element (`/home/david/Desktop/projects/Pager/src/components/shell/BottomTabBar.tsx`).
  - The reader is `overflow-hidden` at `calc(100dvh − …)` (`/home/david/Desktop/projects/Pager/src/pages/ReaderPage.tsx`).
  - `package.json` has no animation library.

### Inferences
The checklist below follows sections 1–9.

**WKWebView / Swift shell**
1. Make `PagerWebView: WKWebView` and override `buildMenu(with:)`. Call `super`, insert a "Pager" group (Highlight, Note, Copy, Define), remove `.share`, `.lookup` and the web-search and translate items as desired, and dispatch the action with `callAsyncJavaScript`. This is required since iOS 18.2 (section 5).
2. `allowsLinkPreview = false`, so pressing a link never peeks into Safari. `isInspectable = true` under `#if DEBUG` (16.4+).
3. `scrollView.bounces = false` and `alwaysBounceVertical = false` for the fixed shell. Native rubber band stays on the inner reader and list scrollers.
4. `scrollView.scrollsToTop = false`, plus a status-bar-tap forwarder (a hidden helper scroll view) that posts `scrollToTop` to JS for the active inner scroller. Unverified pattern; test it.
5. Turn `allowsBackForwardNavigationGestures` off while the paginated reader is open, by a bridge message from the route, so edge swipes turn pages. Keep it on elsewhere.
6. Haptics handler `pager.haptic`: `prepare(kind)` / `fire(kind)` with the kinds selection, light, rigid, soft, success and error. Use long-lived generators, honor a user "Haptics" setting, and limit to one per frame.
7. Theme sync handler: set the web view's `backgroundColor` / `underPageBackgroundColor` (and status-bar style) to the reader theme to avoid flashes.
8. Info.plist `CADisableMinimumFrameDurationOnPhone = YES`, for native parts only. Accept 60 Hz rAF in WKWebView and do not ship the private 120 Hz SPI (bug 294338 is still open).
9. Optional, for iOS 26+: `obscuredContentInsets` if native glass bars ever overlay the web view. Optionally present reading settings as a native SwiftUI sheet with `presentationDetents([.medium, .large])` to get the real detent spring and glass.

**CSS**
10. `html, body { overscroll-behavior: none }`; reader and list scrollers `overscroll-behavior: contain`.
11. Global `-webkit-tap-highlight-color: transparent`. Chrome (bars, tabs, buttons) gets `-webkit-user-select: none; -webkit-touch-callout: none`. Reading text gets `-webkit-user-select: text`. Controls get `touch-action: manipulation`. Inputs have `font-size ≥ 16px`, and hover styles go inside `@media (hover: hover)`.
12. Paginated mode:
    - Replace the `scrollLeft` jumps with a native horizontal scroller: `scroll-snap-type: x mandatory; scroll-snap-stop: always`, one snap point per page.
    - Keep `column-gap` in px, the single-column width at 100% of the viewport (Readium rule), and include the gap in the page math.
    - Detect page changes with `scrollend` (26.2+) and fall back to a debounced `scroll`.
    - Fire a light haptic on page commit only if it does not get tiring (make it optional).
13. Transitions:
    - Popover, menu and TOC drawer entry with `@starting-style` (17.5) and the `linear()` spring strings from section 2 (`.snappy` ≈ 696 ms curve).
    - Gate on `prefers-reduced-motion`, falling back to opacity only.
    - View Transitions only behind `if (document.startViewTransition)` (18.0+).
    - Scroll-driven progress in the page footer behind `@supports (animation-timeline: scroll())` (26+).
14. Annotations: paint highlights with the CSS Custom Highlight API (17.2+), never on `user-select: none` content. Use `text-wrap: pretty` (26), `hyphens: auto` (17) and `hanging-punctuation` (full in 26.5) as progressive typography. Use `content-visibility: auto` for long scroll-mode chapters (18+; find-in-page correct from 26).
15. Keep Pager's own outside-tap dismissal for popovers. Native popover light-dismiss is broken on iOS before 18.3.

**JS / React**
16. Add a small spring utility, or Motion. Use the Apple mapping: `stiffness = (2π/T)²`, `damping = 4π(1−bounce)/T`; or Motion `visualDuration = T/1.2`.
    - Use cases: TOC drawer, settings sheet, chrome show/hide and annotation popover.
    - Defaults: `.smooth` (T 0.5, b 0) for programmatic moves; `interactiveSpring` (T 0.15, ζ 0.86) while dragging; b ≈ 0.15 only when a flick ends the gesture.
    - Always pass the release velocity.
17. Draggable drawer and sheet:
    - 1:1 tracking after 10 pt of hysteresis, with the rubber band `(1 − 1/(x·0.55/d + 1))·d` past the limits.
    - On release, project with `x + (v/1000)·0.998/(1−0.998)`, pick the nearest detent and spring to it.
    - Selection haptic on each detent crossing.
18. Reader chrome:
    - A tap in the reading area (not on a link or selection) toggles the bars, like `hidesBarsOnTap`.
    - In scroll mode, hide the bars on scroll down after ≥ 10 pt and show them on scroll up, like `hidesBarsOnSwipe` / `tabBarMinimizeBehavior`.
    - Animate with `.smooth`.
19. Selection UI: rely on native handles and the native menu (item 1). Show the web annotation popover only for taps on existing highlights. If a web selection toolbar is kept, show it only after the selection has been stable for about 200 ms, and never call `preventDefault()` on touch events over text.
20. Keyboard (note editor): position with `visualViewport` `resize`/`scroll` (no `interactive-widget` on iOS), `blur()` before route changes, and re-check `visualViewport.offsetTop` after the keyboard closes (iOS 26 bug).

### Gaps
- Items 4, 7 (`underPageBackgroundColor`), 12 (snap behavior on iOS 17.5–18 with dynamic column counts) and the selection-menu suppression variant need on-device verification. The Linux dev environment cannot run them.
- Whether a native SwiftUI settings sheet is worth the split UI stack is a product decision. This research cannot settle it.

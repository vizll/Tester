import SwiftUI
import UIKit
import WebKit

/// Hosts Tester in a full-screen web view. External links open in Safari, saved files go to the share
/// sheet, and the status bar follows the page's style.
final class WebViewController: UIViewController, WKNavigationDelegate, WKUIDelegate {
    private var webView: WKWebView!
    private var pageIsDark = false
    /// the page has loaded your data and can take queued to-dos
    private var pageReady = false
    private var flushing = false
    private var wantsVoice = false
    private var observers: [NSObjectProtocol] = []
    private static let home = URL(string: "\(AppSchemeHandler.scheme)://localhost/index.html")!
    private static let external: Set<String> = ["http", "https", "mailto", "tel", "sms"]

    override func loadView() {
        let config = WKWebViewConfiguration()
        let root = Bundle.main.resourceURL!.appendingPathComponent("www", isDirectory: true)
        config.setURLSchemeHandler(AppSchemeHandler(root: root), forURLScheme: AppSchemeHandler.scheme)
        config.websiteDataStore = .default()
        config.allowsInlineMediaPlayback = true
        config.mediaTypesRequiringUserActionForPlayback = []
        config.dataDetectorTypes = []

        let content = config.userContentController
        let bridge = ScriptBridge(owner: self)
        content.add(bridge, name: "testerSave")
        content.add(bridge, name: "testerChrome")
        content.add(bridge, name: "testerWidgets")
        content.addUserScript(WKUserScript(source: Shell.startScript, injectionTime: .atDocumentStart, forMainFrameOnly: true))
        content.addUserScript(WKUserScript(source: Shell.endScript, injectionTime: .atDocumentEnd, forMainFrameOnly: true))

        let web = WKWebView(frame: .zero, configuration: config)
        web.navigationDelegate = self
        web.uiDelegate = self
        web.isOpaque = false
        let background = UIColor(named: "LaunchBackground") ?? .systemBackground
        web.backgroundColor = background
        web.scrollView.backgroundColor = background
        web.scrollView.contentInsetAdjustmentBehavior = .never   // the page pads itself with env(safe-area-inset-*)
        web.allowsBackForwardNavigationGestures = false
        web.allowsLinkPreview = false
        if #available(iOS 16.4, *) { web.isInspectable = true }   // Safari → Develop, for debugging
        webView = web
        view = web
    }

    override func viewDidLoad() {
        super.viewDidLoad()
        webView.load(URLRequest(url: Self.home))
        let center = NotificationCenter.default
        observers.append(center.addObserver(forName: .testerInboxChanged, object: nil, queue: .main) { [weak self] _ in self?.flushQueues() })
        observers.append(center.addObserver(forName: .testerVoiceRequested, object: nil, queue: .main) { [weak self] _ in
            _ = TesterStore.shared.consumeVoiceRequest()
            self?.presentVoice()
        })
    }

    override func viewDidAppear(_ animated: Bool) {
        super.viewDidAppear(animated)
        if wantsVoice { presentVoice() }
    }

    deinit { observers.forEach { NotificationCenter.default.removeObserver($0) } }

    // MARK: - Widgets, Siri and voice to-dos

    /// Opened by a widget, a control or a link: testerapp://voice, testerapp://add?text=…, testerapp://setup
    func handle(url: URL) {
        guard url.scheme?.lowercased() == "testerapp" else { return }
        switch url.host?.lowercased() ?? "" {
        case "voice":
            presentVoice()
        case "setup":
            presentSetup()
        case "add":
            let text = URLComponents(url: url, resolvingAgainstBaseURL: false)?.queryItems?.first(where: { $0.name == "text" })?.value ?? ""
            if TesterStore.shared.enqueue(text) != nil { flushQueues() }
        default:
            break
        }
    }

    /// Called whenever Tester comes to the front.
    func appBecameActive() {
        flushQueues()
        if TesterStore.shared.consumeVoiceRequest() { presentVoice() }
        if pageReady { webView.evaluateJavaScript("window.TesterNative && TesterNative.refresh()", completionHandler: nil) }
    }

    func presentVoice() {
        guard isViewLoaded, view.window != nil else { wantsVoice = true; return }
        wantsVoice = false
        if let shown = presentedViewController {
            if shown is VoiceSheetController { return }
            shown.dismiss(animated: true) { [weak self] in self?.presentVoice() }
            return
        }
        let sheet = VoiceSheetController(rootView: AnyView(EmptyView()))
        sheet.rootView = AnyView(VoiceCaptureView(
            onAdd: { [weak self] text in
                TesterStore.shared.enqueue(text)
                self?.flushQueues()
            },
            onClose: { [weak sheet] in sheet?.dismiss(animated: true) },
            onSetup: { [weak self, weak sheet] in sheet?.dismiss(animated: true) { self?.presentSetup() } }
        ))
        sheet.modalPresentationStyle = .pageSheet
        if let s = sheet.sheetPresentationController {
            s.detents = [.custom(identifier: .init(rawValue: "voice")) { _ in 470 }, .large()]
            s.prefersGrabberVisible = false
            s.preferredCornerRadius = 28
        }
        present(sheet, animated: true)
    }

    func presentSetup() {
        guard isViewLoaded, view.window != nil else { return }
        if presentedViewController != nil {
            presentedViewController?.dismiss(animated: true) { [weak self] in self?.presentSetup() }
            return
        }
        let guide = UIHostingController(rootView: AnyView(EmptyView()))
        guide.rootView = AnyView(SetupGuideView(
            onTry: { [weak self, weak guide] in guide?.dismiss(animated: true) { self?.presentVoice() } },
            onClose: { [weak guide] in guide?.dismiss(animated: true) }
        ))
        guide.modalPresentationStyle = .pageSheet
        present(guide, animated: true)
    }

    fileprivate func pageDidBoot() {
        pageReady = true
        flushQueues()
    }

    fileprivate func saveWidgetSnapshot(_ json: String) {
        DispatchQueue.global(qos: .utility).async { TesterStore.shared.saveSnapshot(json: json) }
    }

    /// Adds queued to-dos and applies widget checkmarks inside the page.
    func flushQueues() {
        guard pageReady, !flushing else { return }
        let store = TesterStore.shared
        let inbox = store.inbox
        let completions = store.completions
        guard !inbox.isEmpty || !completions.isEmpty else { return }
        let payload: [String: Any] = [
            "inbox": inbox.map { ["id": $0.id, "text": $0.text] },
            "completions": completions.map { ["id": $0.id] }
        ]
        guard let data = try? JSONSerialization.data(withJSONObject: payload), let json = String(data: data, encoding: .utf8) else { return }
        flushing = true
        webView.evaluateJavaScript("window.TesterNative ? TesterNative.apply(\(json)) : ''") { [weak self] result, _ in
            self?.flushing = false
            guard let text = result as? String, let out = text.data(using: .utf8),
                  let obj = try? JSONSerialization.jsonObject(with: out) as? [String: Any] else { return }
            let added = Set(((obj["added"] as? [[String: Any]]) ?? []).compactMap { $0["inbox"] as? String })
            let completed = Set(((obj["completed"] as? [String]) ?? []))
            store.removeInbox(ids: added)
            store.removeCompletions(ids: completed)
            // anything queued while this ran
            if store.inbox.contains(where: { !added.contains($0.id) }) { self?.flushQueues() }
        }
    }

    override var preferredStatusBarStyle: UIStatusBarStyle { pageIsDark ? .lightContent : .darkContent }

    fileprivate func setPage(dark: Bool) {
        guard dark != pageIsDark else { return }
        pageIsDark = dark
        setNeedsStatusBarAppearanceUpdate()
    }

    // MARK: - Navigation

    func webView(_ webView: WKWebView, decidePolicyFor navigationAction: WKNavigationAction,
                 decisionHandler: @escaping (WKNavigationActionPolicy) -> Void) {
        guard let url = navigationAction.request.url, let scheme = url.scheme?.lowercased() else {
            decisionHandler(.allow); return
        }
        if scheme == AppSchemeHandler.scheme || scheme == "about" || scheme == "blob" || scheme == "data" {
            decisionHandler(.allow); return
        }
        let mainFrame = navigationAction.targetFrame?.isMainFrame ?? true
        if mainFrame && Self.external.contains(scheme) {
            UIApplication.shared.open(url)
            decisionHandler(.cancel); return
        }
        decisionHandler(.allow)   // e.g. an embedded Google Calendar inside its widget
    }

    // target="_blank" links (quick links, class resources, assignment links) open in Safari
    func webView(_ webView: WKWebView, createWebViewWith configuration: WKWebViewConfiguration,
                 for navigationAction: WKNavigationAction, windowFeatures: WKWindowFeatures) -> WKWebView? {
        if let url = navigationAction.request.url, Self.external.contains(url.scheme?.lowercased() ?? "") {
            UIApplication.shared.open(url)
        }
        return nil
    }

    func webViewWebContentProcessDidTerminate(_ webView: WKWebView) {
        pageReady = false
        webView.reload()
    }

    // MARK: - JavaScript dialogs

    func webView(_ webView: WKWebView, runJavaScriptAlertPanelWithMessage message: String,
                 initiatedByFrame frame: WKFrameInfo, completionHandler: @escaping () -> Void) {
        let alert = UIAlertController(title: nil, message: message, preferredStyle: .alert)
        alert.addAction(UIAlertAction(title: "OK", style: .default) { _ in completionHandler() })
        present(alert, animated: true)
    }

    func webView(_ webView: WKWebView, runJavaScriptConfirmPanelWithMessage message: String,
                 initiatedByFrame frame: WKFrameInfo, completionHandler: @escaping (Bool) -> Void) {
        let alert = UIAlertController(title: nil, message: message, preferredStyle: .alert)
        alert.addAction(UIAlertAction(title: "Cancel", style: .cancel) { _ in completionHandler(false) })
        alert.addAction(UIAlertAction(title: "OK", style: .default) { _ in completionHandler(true) })
        present(alert, animated: true)
    }

    func webView(_ webView: WKWebView, runJavaScriptTextInputPanelWithPrompt prompt: String, defaultText: String?,
                 initiatedByFrame frame: WKFrameInfo, completionHandler: @escaping (String?) -> Void) {
        let alert = UIAlertController(title: nil, message: prompt, preferredStyle: .alert)
        alert.addTextField { $0.text = defaultText }
        alert.addAction(UIAlertAction(title: "Cancel", style: .cancel) { _ in completionHandler(nil) })
        alert.addAction(UIAlertAction(title: "OK", style: .default) { _ in completionHandler(alert.textFields?.first?.text) })
        present(alert, animated: true)
    }

    // MARK: - Saving files (backups, exported study sets)

    fileprivate func save(filename: String, base64: String) {
        guard let data = Data(base64Encoded: base64) else { return }
        var name = filename.replacingOccurrences(of: "/", with: "-").trimmingCharacters(in: .whitespaces)
        if name.isEmpty { name = "Tester-export" }
        let url = FileManager.default.temporaryDirectory.appendingPathComponent(name)
        do { try data.write(to: url, options: .atomic) } catch { return }
        let sheet = UIActivityViewController(activityItems: [url], applicationActivities: nil)
        if let popover = sheet.popoverPresentationController {   // iPad
            popover.sourceView = view
            popover.sourceRect = CGRect(x: view.bounds.midX, y: view.bounds.midY, width: 1, height: 1)
            popover.permittedArrowDirections = []
        }
        present(sheet, animated: true)
    }
}

/// Receives messages from the page. Holds the controller weakly so the web view doesn't leak it.
private final class ScriptBridge: NSObject, WKScriptMessageHandler {
    weak var owner: WebViewController?
    init(owner: WebViewController) { self.owner = owner }

    func userContentController(_ userContentController: WKUserContentController, didReceive message: WKScriptMessage) {
        guard let body = message.body as? [String: Any] else { return }
        switch message.name {
        case "testerSave":
            if let name = body["filename"] as? String, let data = body["data"] as? String { owner?.save(filename: name, base64: data) }
        case "testerChrome":
            owner?.setPage(dark: (body["dark"] as? Bool) ?? false)
        case "testerWidgets":
            switch (body["type"] as? String) ?? "" {
            case "ready": owner?.pageDidBoot()
            case "snapshot": if let json = body["json"] as? String { owner?.saveWidgetSnapshot(json) }
            case "voice": owner?.presentVoice()
            case "setup": owner?.presentSetup()
            default: break
            }
        default:
            break
        }
    }
}

/// Marks the voice sheet so it isn't stacked twice.
final class VoiceSheetController: UIHostingController<AnyView> {}

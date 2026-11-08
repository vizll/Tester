import UIKit
import WebKit

/// Hosts Tester in a full-screen web view. External links open in Safari, saved files go to the share
/// sheet, and the status bar follows the page's style.
final class WebViewController: UIViewController, WKNavigationDelegate, WKUIDelegate {
    private var webView: WKWebView!
    private var pageIsDark = false
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
        default:
            break
        }
    }
}

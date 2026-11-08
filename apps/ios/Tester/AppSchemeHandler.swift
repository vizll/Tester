import Foundation
import WebKit

/// Serves the bundled web app (the `www` folder) at tester://localhost/… so it gets a stable,
/// private origin: IndexedDB and localStorage persist between launches, and fetch/workers/WASM load
/// from inside the app with no network and no local server.
final class AppSchemeHandler: NSObject, WKURLSchemeHandler {
    static let scheme = "tester"
    private let root: URL

    private static let mime: [String: String] = [
        "html": "text/html; charset=utf-8", "js": "text/javascript; charset=utf-8", "mjs": "text/javascript; charset=utf-8",
        "css": "text/css; charset=utf-8", "json": "application/json", "wasm": "application/wasm",
        "png": "image/png", "jpg": "image/jpeg", "jpeg": "image/jpeg", "gif": "image/gif", "svg": "image/svg+xml",
        "webp": "image/webp", "ico": "image/x-icon", "txt": "text/plain; charset=utf-8", "md": "text/plain; charset=utf-8",
        "gz": "application/gzip", "woff": "font/woff", "woff2": "font/woff2", "mp3": "audio/mpeg", "wav": "audio/wav"
    ]

    init(root: URL) {
        self.root = root.standardizedFileURL
        super.init()
    }

    func webView(_ webView: WKWebView, start urlSchemeTask: WKURLSchemeTask) {
        guard let url = urlSchemeTask.request.url else {
            urlSchemeTask.didFailWithError(URLError(.badURL))
            return
        }
        var path = url.path
        if path.isEmpty || path == "/" { path = "/index.html" }
        let file = root.appendingPathComponent(String(path.drop(while: { $0 == "/" }))).standardizedFileURL

        // stay inside the bundled folder
        guard file.path.hasPrefix(root.path + "/"), let data = try? Data(contentsOf: file) else {
            respond(urlSchemeTask, url: url, status: 404, type: "text/plain; charset=utf-8", body: Data("Not found".utf8))
            return
        }
        let type = Self.mime[file.pathExtension.lowercased()] ?? "application/octet-stream"
        respond(urlSchemeTask, url: url, status: 200, type: type, body: data)
    }

    func webView(_ webView: WKWebView, stop urlSchemeTask: WKURLSchemeTask) {
        // responses are delivered synchronously, so there is nothing to cancel
    }

    private func respond(_ task: WKURLSchemeTask, url: URL, status: Int, type: String, body: Data) {
        let headers = [
            "Content-Type": type,
            "Content-Length": String(body.count),
            "Cache-Control": "no-cache",
            "Access-Control-Allow-Origin": "*"
        ]
        guard let response = HTTPURLResponse(url: url, statusCode: status, httpVersion: "HTTP/1.1", headerFields: headers) else {
            task.didFailWithError(URLError(.cannotParseResponse))
            return
        }
        task.didReceive(response)
        task.didReceive(body)
        task.didFinish()
    }
}

import Foundation
import WidgetKit

/// What the Home Screen widgets show. The app writes it whenever your planner changes; widgets only read it.
struct WidgetSnapshot: Codable {
    struct Due: Codable, Hashable, Identifiable {
        var id: String
        var kind: String          // assignment, exam, reminder
        var title: String
        var date: String          // yyyy-MM-dd
        var time: String?         // HH:mm
        var subject: String?
        var color: String?        // #rrggbb
        var status: String?       // todo, progress, submitted, done
        var overdue: Bool?
    }
    struct Todo: Codable, Hashable, Identifiable {
        var id: String
        var text: String
        var due: String?
        var priority: String?
        var pending: Bool?        // added by voice/Siri, not in the app yet
    }
    var v: Int?
    var updated: Double?
    var today: String?
    var due: [Due]?
    var todos: [Todo]?
    var todosOpen: Int?
    var dueSoon: Int?
    var name: String?

    var dueItems: [Due] { due ?? [] }
    var todoItems: [Todo] { todos ?? [] }
    var hasData: Bool { updated != nil }
}

/// A to-do waiting to be added to Tester (from Siri, Shortcuts, the Action button or the voice sheet).
struct InboxItem: Codable, Hashable { var id: String; var text: String; var at: Double }
/// A checkmark tapped on a widget, waiting to be applied in the app.
struct Completion: Codable, Hashable { var id: String; var at: Double }

extension Notification.Name {
    static let testerInboxChanged = Notification.Name("TesterInboxChanged")
    static let testerVoiceRequested = Notification.Name("TesterVoiceRequested")
}

/// Files shared between the app and its widgets, in the app group container. SideStore and AltStore
/// rename app groups when they sign the app and list the new names under `ALTAppGroups` in Info.plist,
/// so the group is looked up at runtime.
final class TesterStore {
    static let shared = TesterStore()
    static let baseGroup = "group.app.tester.desk"

    let directory: URL
    /// false when no app group is available (then widgets can't see the app's data)
    let isShared: Bool
    private let lock = NSLock()

    private init() {
        let fm = FileManager.default
        var chosen: URL?
        for group in TesterStore.candidateGroups() {
            guard let base = fm.containerURL(forSecurityApplicationGroupIdentifier: group) else { continue }
            let dir = base.appendingPathComponent("Tester", isDirectory: true)
            do {
                try fm.createDirectory(at: dir, withIntermediateDirectories: true)
                let probe = dir.appendingPathComponent(".probe")
                try Data("ok".utf8).write(to: probe, options: .atomic)
                chosen = dir
                break
            } catch { continue }
        }
        if let chosen {
            directory = chosen
            isShared = true
        } else {
            let support = fm.urls(for: .applicationSupportDirectory, in: .userDomainMask).first ?? fm.temporaryDirectory
            directory = support.appendingPathComponent("TesterShared", isDirectory: true)
            try? fm.createDirectory(at: directory, withIntermediateDirectories: true)
            isShared = false
        }
    }

    private static func candidateGroups() -> [String] {
        var bundles = [Bundle.main]
        if Bundle.main.bundleURL.pathExtension == "appex" {
            let host = Bundle.main.bundleURL.deletingLastPathComponent().deletingLastPathComponent()
            if let app = Bundle(url: host) { bundles.append(app) }
        }
        var found: [String] = []
        for bundle in bundles {
            if let groups = bundle.object(forInfoDictionaryKey: "ALTAppGroups") as? [String] {
                found += groups.filter { $0.lowercased().contains("tester") } + groups
            }
        }
        found.append(baseGroup)
        var seen = Set<String>()
        return found.filter { seen.insert($0).inserted }
    }

    // MARK: - Files

    private func url(_ name: String) -> URL { directory.appendingPathComponent(name) }

    private func read<T: Decodable>(_ name: String, as type: T.Type) -> T? {
        guard let data = try? Data(contentsOf: url(name)) else { return nil }
        return try? JSONDecoder().decode(T.self, from: data)
    }

    private func write<T: Encodable>(_ value: T, to name: String) {
        guard let data = try? JSONEncoder().encode(value) else { return }
        try? data.write(to: url(name), options: .atomic)
    }

    func reloadWidgets() {
        WidgetCenter.shared.reloadAllTimelines()
    }

    // MARK: - Snapshot (app → widgets)

    var snapshot: WidgetSnapshot {
        lock.lock(); defer { lock.unlock() }
        return read("snapshot.json", as: WidgetSnapshot.self) ?? WidgetSnapshot()
    }

    /// Saves the page's summary. Items still waiting in the inbox stay visible on the widget.
    func saveSnapshot(json: String) {
        guard let data = json.data(using: .utf8), var snap = try? JSONDecoder().decode(WidgetSnapshot.self, from: data) else { return }
        lock.lock()
        let pending = read("inbox.json", as: [InboxItem].self) ?? []
        let done = Set((read("completions.json", as: [Completion].self) ?? []).map(\.id))
        snap.todos = pending.map { WidgetSnapshot.Todo(id: $0.id, text: $0.text, due: nil, priority: nil, pending: true) }
            + snap.todoItems.filter { !done.contains($0.id) }
        snap.due = snap.dueItems.filter { !done.contains($0.id) }
        write(snap, to: "snapshot.json")
        lock.unlock()
        reloadWidgets()
    }

    // MARK: - Inbox (Siri / Shortcuts / voice → app)

    var inbox: [InboxItem] {
        lock.lock(); defer { lock.unlock() }
        return read("inbox.json", as: [InboxItem].self) ?? []
    }

    @discardableResult
    func enqueue(_ text: String) -> InboxItem? {
        let clean = TesterStore.clean(text)
        guard !clean.isEmpty else { return nil }
        let item = InboxItem(id: "pending-" + UUID().uuidString, text: clean, at: Date().timeIntervalSince1970)
        lock.lock()
        var list = read("inbox.json", as: [InboxItem].self) ?? []
        list.append(item)
        write(list, to: "inbox.json")
        var snap = read("snapshot.json", as: WidgetSnapshot.self) ?? WidgetSnapshot()
        snap.todos = [WidgetSnapshot.Todo(id: item.id, text: clean, due: nil, priority: nil, pending: true)] + snap.todoItems
        snap.todosOpen = (snap.todosOpen ?? 0) + 1
        write(snap, to: "snapshot.json")
        lock.unlock()
        reloadWidgets()
        return item
    }

    func removeInbox(ids: Set<String>) {
        guard !ids.isEmpty else { return }
        lock.lock(); defer { lock.unlock() }
        let list = (read("inbox.json", as: [InboxItem].self) ?? []).filter { !ids.contains($0.id) }
        write(list, to: "inbox.json")
    }

    // MARK: - Completions (widget checkmarks → app)

    var completions: [Completion] {
        lock.lock(); defer { lock.unlock() }
        return read("completions.json", as: [Completion].self) ?? []
    }

    func complete(_ id: String) {
        lock.lock()
        if id.hasPrefix("pending-") {
            let list = (read("inbox.json", as: [InboxItem].self) ?? []).filter { $0.id != id }
            write(list, to: "inbox.json")
        } else {
            var list = read("completions.json", as: [Completion].self) ?? []
            if !list.contains(where: { $0.id == id }) { list.append(Completion(id: id, at: Date().timeIntervalSince1970)) }
            write(list, to: "completions.json")
        }
        var snap = read("snapshot.json", as: WidgetSnapshot.self) ?? WidgetSnapshot()
        let before = snap.todoItems.count
        snap.todos = snap.todoItems.filter { $0.id != id }
        if snap.todoItems.count < before { snap.todosOpen = max(0, (snap.todosOpen ?? 1) - 1) }
        snap.due = snap.dueItems.filter { $0.id != id }
        write(snap, to: "snapshot.json")
        lock.unlock()
        reloadWidgets()
    }

    func removeCompletions(ids: Set<String>) {
        guard !ids.isEmpty else { return }
        lock.lock(); defer { lock.unlock() }
        let list = (read("completions.json", as: [Completion].self) ?? []).filter { !ids.contains($0.id) }
        write(list, to: "completions.json")
    }

    // MARK: - Voice requests (Action button / control / widget → app)

    func requestVoice() {
        lock.lock(); defer { lock.unlock() }
        try? Data(String(Date().timeIntervalSince1970).utf8).write(to: url("voice-request"), options: .atomic)
    }

    /// true once if a voice to-do was asked for in the last minute
    func consumeVoiceRequest() -> Bool {
        lock.lock(); defer { lock.unlock() }
        let file = url("voice-request")
        guard let data = try? Data(contentsOf: file) else { return false }
        try? FileManager.default.removeItem(at: file)
        let at = Double(String(decoding: data, as: UTF8.self)) ?? 0
        return Date().timeIntervalSince1970 - at < 60
    }

    // MARK: - Helpers

    /// Tidies dictated text: trims, drops a trailing full stop and capitalises the first letter.
    static func clean(_ text: String) -> String {
        var t = text.trimmingCharacters(in: .whitespacesAndNewlines)
        while let last = t.last, ".。!".contains(last) { t.removeLast() }
        t = t.trimmingCharacters(in: .whitespacesAndNewlines)
        if let first = t.first { t = first.uppercased() + t.dropFirst() }
        return String(t.prefix(400))
    }
}

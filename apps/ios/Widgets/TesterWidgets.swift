import AppIntents
import SwiftUI
import WidgetKit

@main
struct TesterWidgetBundle: WidgetBundle {
    var body: some Widget {
        UpNextWidget()
        TodoWidget()
        VoiceWidget()
        if #available(iOS 18.0, *) {
            VoiceTodoControl()
        }
    }
}

// MARK: - Timeline

struct TesterEntry: TimelineEntry {
    let date: Date
    let snapshot: WidgetSnapshot
    let shared: Bool
}

struct TesterProvider: TimelineProvider {
    func placeholder(in context: Context) -> TesterEntry {
        TesterEntry(date: Date(), snapshot: .sample, shared: true)
    }

    func getSnapshot(in context: Context, completion: @escaping (TesterEntry) -> Void) {
        let snap = TesterStore.shared.snapshot
        completion(TesterEntry(date: Date(), snapshot: (context.isPreview && !snap.hasData) ? .sample : snap, shared: true))
    }

    func getTimeline(in context: Context, completion: @escaping (Timeline<TesterEntry>) -> Void) {
        let store = TesterStore.shared
        let snap = store.snapshot
        let now = Date()
        var entries = [TesterEntry(date: now, snapshot: snap, shared: store.isShared)]
        // "Tomorrow" becomes "Today" at midnight without waiting for the app
        let midnight = Calendar.current.startOfDay(for: now.addingTimeInterval(86_400))
        let next = now.addingTimeInterval(30 * 60)
        if midnight < next { entries.append(TesterEntry(date: midnight, snapshot: snap, shared: store.isShared)) }
        completion(Timeline(entries: entries, policy: .after(next)))
    }
}

extension WidgetSnapshot {
    static var sample: WidgetSnapshot {
        let cal = Calendar.current
        func day(_ n: Int) -> String { DateText.iso(cal.date(byAdding: .day, value: n, to: Date()) ?? Date()) }
        var s = WidgetSnapshot()
        s.v = 1
        s.updated = Date().timeIntervalSince1970
        s.due = [
            .init(id: "1", kind: "assignment", title: "Lab report", date: day(0), time: "23:59", subject: "Chemistry", color: "#21a67a", status: "progress", overdue: false),
            .init(id: "2", kind: "exam", title: "Unit 4 test", date: day(1), time: nil, subject: "Algebra II", color: "#5b6ee1", status: nil, overdue: false),
            .init(id: "3", kind: "assignment", title: "Essay outline", date: day(3), time: nil, subject: "English", color: "#e0791f", status: "todo", overdue: false),
            .init(id: "4", kind: "assignment", title: "Reading notes ch. 7", date: day(5), time: nil, subject: "History", color: "#c2417a", status: "todo", overdue: false)
        ]
        s.todos = [
            .init(id: "a", text: "Chem homework", due: day(0), priority: "high", pending: nil),
            .init(id: "b", text: "Print study guide", due: nil, priority: nil, pending: nil),
            .init(id: "c", text: "Email Ms. Rivera", due: day(1), priority: nil, pending: nil),
            .init(id: "d", text: "Pack gym clothes", due: nil, priority: nil, pending: nil)
        ]
        s.todosOpen = 4
        s.dueSoon = 4
        return s
    }
}

// MARK: - Look

enum WBrand {
    static let teal = Color(red: 0.20, green: 0.62, blue: 0.56)
    static let violet = Color(red: 0.47, green: 0.40, blue: 0.82)
    static let red = Color(red: 0.86, green: 0.27, blue: 0.30)

    static func accent(_ scheme: ColorScheme) -> Color {
        scheme == .dark ? Color(red: 0.50, green: 0.83, blue: 0.77) : Color(red: 0.13, green: 0.47, blue: 0.43)
    }
    static func ink(_ scheme: ColorScheme) -> Color {
        scheme == .dark ? Color(red: 0.93, green: 0.94, blue: 0.97) : Color(red: 0.11, green: 0.14, blue: 0.20)
    }
    static func soft(_ scheme: ColorScheme) -> Color { ink(scheme).opacity(0.58) }
    static func card(_ scheme: ColorScheme) -> Color { scheme == .dark ? Color.white.opacity(0.07) : Color.white.opacity(0.55) }
}

struct WidgetGradient: View {
    @Environment(\.colorScheme) private var scheme
    var body: some View {
        ZStack {
            LinearGradient(
                colors: scheme == .dark
                    ? [Color(red: 0.055, green: 0.07, blue: 0.125), Color(red: 0.118, green: 0.094, blue: 0.22)]
                    : [Color(red: 0.882, green: 0.949, blue: 0.929), Color(red: 0.89, green: 0.863, blue: 0.965)],
                startPoint: .topLeading, endPoint: .bottomTrailing)
            RadialGradient(colors: [WBrand.teal.opacity(scheme == .dark ? 0.22 : 0.16), .clear], center: .topLeading, startRadius: 0, endRadius: 220)
        }
    }
}

extension Color {
    init?(hex: String?) {
        guard var h = hex?.trimmingCharacters(in: .whitespaces), !h.isEmpty else { return nil }
        if h.hasPrefix("#") { h.removeFirst() }
        if h.count == 3 { h = h.map { "\($0)\($0)" }.joined() }
        guard h.count == 6, let v = UInt32(h, radix: 16) else { return nil }
        self.init(red: Double((v >> 16) & 0xff) / 255, green: Double((v >> 8) & 0xff) / 255, blue: Double(v & 0xff) / 255)
    }
}

/// Dates in the snapshot are plain yyyy-MM-dd strings in the user's own time zone.
enum DateText {
    static func iso(_ date: Date) -> String {
        let c = Calendar.current.dateComponents([.year, .month, .day], from: date)
        return String(format: "%04d-%02d-%02d", c.year ?? 2000, c.month ?? 1, c.day ?? 1)
    }

    static func date(_ iso: String?) -> Date? {
        guard let iso, iso.count >= 10 else { return nil }
        let parts = iso.prefix(10).split(separator: "-").compactMap { Int($0) }
        guard parts.count == 3 else { return nil }
        return Calendar.current.date(from: DateComponents(year: parts[0], month: parts[1], day: parts[2]))
    }

    static func daysFrom(_ now: Date, to iso: String?) -> Int? {
        guard let d = date(iso) else { return nil }
        let cal = Calendar.current
        return cal.dateComponents([.day], from: cal.startOfDay(for: now), to: cal.startOfDay(for: d)).day
    }

    static func time(_ hhmm: String?) -> String? {
        guard let hhmm, hhmm.count >= 4 else { return nil }
        let p = hhmm.split(separator: ":").compactMap { Int($0) }
        guard p.count == 2, let d = Calendar.current.date(bySettingHour: p[0], minute: p[1], second: 0, of: Date()) else { return nil }
        let f = DateFormatter()
        f.locale = Locale.current
        f.setLocalizedDateFormatFromTemplate("jmm")
        return f.string(from: d)
    }

    /// "Today", "Tomorrow", "Fri", "Nov 12" or "3 days late"
    static func relative(_ iso: String?, now: Date, short: Bool = false) -> String {
        guard let n = daysFrom(now, to: iso), let d = date(iso) else { return "No date" }
        switch n {
        case ..<(-1): return short ? "\(-n)d late" : "\(-n) days late"
        case -1: return short ? "Late" : "Yesterday"
        case 0: return "Today"
        case 1: return short ? "Tmrw" : "Tomorrow"
        case 2...6:
            let f = DateFormatter(); f.locale = Locale.current; f.setLocalizedDateFormatFromTemplate(short ? "EEE" : "EEEE")
            return f.string(from: d)
        default:
            let f = DateFormatter(); f.locale = Locale.current; f.setLocalizedDateFormatFromTemplate("MMMd")
            return f.string(from: d)
        }
    }
}

extension WidgetSnapshot.Due {
    func isLate(_ now: Date) -> Bool {
        guard let n = DateText.daysFrom(now, to: date) else { return false }
        if n < 0 { return true }
        if n == 0, let time, time.count >= 4 {
            let p = time.split(separator: ":").compactMap { Int($0) }
            if p.count == 2, let due = Calendar.current.date(bySettingHour: p[0], minute: p[1], second: 0, of: now) { return due < now }
        }
        return n == 0 && (overdue ?? false)
    }

    func dayOffset(_ now: Date) -> Int { DateText.daysFrom(now, to: date) ?? 0 }

    var tint: Color { Color(hex: color) ?? WBrand.teal }

    var kindLabel: String {
        switch kind {
        case "exam": return "Exam"
        case "reminder": return "Reminder"
        default: return status == "progress" ? "In progress" : ""
        }
    }
}

/// Items still to come (late first), as of the entry's date.
func upcoming(_ snap: WidgetSnapshot, now: Date) -> [WidgetSnapshot.Due] {
    snap.dueItems
        .filter { $0.dayOffset(now) >= 0 || $0.isLate(now) }
        .sorted { a, b in
            let la = a.isLate(now), lb = b.isLate(now)
            if la != lb { return la }
            if a.date != b.date { return a.date < b.date }
            return (a.time ?? "99") < (b.time ?? "99")
        }
}

func dueTodayCount(_ items: [WidgetSnapshot.Due], now: Date) -> Int {
    items.filter { $0.isLate(now) || $0.dayOffset(now) == 0 }.count
}

struct OpenTesterHint: View {
    @Environment(\.colorScheme) private var scheme
    var text = "Open Tester once to show your planner here."
    var body: some View {
        VStack(alignment: .leading, spacing: 6) {
            Image(systemName: "sparkles").font(.title3).foregroundStyle(WBrand.accent(scheme))
            Text(text).font(.system(size: 13, weight: .semibold, design: .rounded)).foregroundStyle(WBrand.ink(scheme))
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .leading)
    }
}

// MARK: - Up Next (what's due)

struct UpNextWidget: Widget {
    var body: some WidgetConfiguration {
        StaticConfiguration(kind: "app.tester.upnext", provider: TesterProvider()) { entry in
            UpNextView(entry: entry)
                .containerBackground(for: .widget) { WidgetGradient() }
                .widgetURL(URL(string: "testerapp://open"))
        }
        .configurationDisplayName("Up Next")
        .description("Assignments, exams and reminders coming up, with late work first.")
        .supportedFamilies([.systemSmall, .systemMedium, .systemLarge, .accessoryRectangular, .accessoryCircular, .accessoryInline])
    }
}

struct UpNextView: View {
    @Environment(\.widgetFamily) private var family
    @Environment(\.colorScheme) private var scheme
    let entry: TesterEntry

    private var items: [WidgetSnapshot.Due] { upcoming(entry.snapshot, now: entry.date) }

    var body: some View {
        switch family {
        case .accessoryInline: inline
        case .accessoryCircular: circular
        case .accessoryRectangular: rectangular
        case .systemMedium: medium
        case .systemLarge: large
        default: small
        }
    }

    // Lock Screen

    private var inline: some View {
        let first = items.first
        let text = first.map { "\($0.title) · \(DateText.relative($0.date, now: entry.date, short: true))" } ?? "Nothing due"
        return Label(text, systemImage: "checklist")
    }

    private var circular: some View {
        let today = dueTodayCount(items, now: entry.date)
        return ZStack {
            AccessoryWidgetBackground()
            VStack(spacing: -2) {
                Text("\(today)").font(.system(size: 22, weight: .bold, design: .rounded))
                Text("due").font(.system(size: 10, weight: .semibold, design: .rounded))
            }
        }
    }

    private var rectangular: some View {
        VStack(alignment: .leading, spacing: 1) {
            Label("Up next", systemImage: "checklist")
                .font(.system(size: 12, weight: .bold, design: .rounded))
            if items.isEmpty {
                Text("All caught up").font(.system(size: 14, weight: .semibold, design: .rounded))
            } else {
                ForEach(items.prefix(2)) { item in
                    HStack(spacing: 4) {
                        Text(item.title).lineLimit(1)
                        Spacer(minLength: 2)
                        Text(DateText.relative(item.date, now: entry.date, short: true)).foregroundStyle(.secondary)
                    }
                    .font(.system(size: 13, weight: .medium, design: .rounded))
                }
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .widgetAccentable()
    }

    // Home Screen

    private var header: some View {
        HStack(alignment: .firstTextBaseline) {
            Text("UP NEXT")
                .font(.system(size: 11, weight: .heavy, design: .rounded))
                .tracking(1)
                .foregroundStyle(WBrand.accent(scheme))
            Spacer()
            let today = dueTodayCount(items, now: entry.date)
            if today > 0 {
                Text("\(today) today")
                    .font(.system(size: 11, weight: .bold, design: .rounded))
                    .padding(.horizontal, 7).padding(.vertical, 2)
                    .background(Capsule().fill(WBrand.accent(scheme).opacity(0.16)))
                    .foregroundStyle(WBrand.accent(scheme))
            }
        }
    }

    private var empty: some View {
        VStack(alignment: .leading, spacing: 4) {
            Image(systemName: "checkmark.seal.fill").font(.title2).foregroundStyle(WBrand.accent(scheme))
            Text("All caught up").font(.system(size: 15, weight: .bold, design: .rounded)).foregroundStyle(WBrand.ink(scheme))
            Text("Nothing due soon.").font(.system(size: 12, design: .rounded)).foregroundStyle(WBrand.soft(scheme))
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .leading)
    }

    @ViewBuilder private func list(_ count: Int, subject: Bool) -> some View {
        if !entry.snapshot.hasData {
            OpenTesterHint(text: entry.shared ? "Open Tester once to show what’s due." : "Open Tester to finish setting up widgets.")
        } else if items.isEmpty {
            empty
        } else {
            VStack(alignment: .leading, spacing: subject ? 9 : 7) {
                ForEach(items.prefix(count)) { item in DueRow(item: item, now: entry.date, showSubject: subject) }
                if items.count > count {
                    Text("+\(items.count - count) more")
                        .font(.system(size: 11, weight: .semibold, design: .rounded))
                        .foregroundStyle(WBrand.soft(scheme))
                }
            }
            .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)
        }
    }

    private var small: some View {
        VStack(alignment: .leading, spacing: 8) {
            header
            list(3, subject: false)
        }
    }

    private var medium: some View {
        HStack(alignment: .top, spacing: 14) {
            DateBlock(now: entry.date, count: items.count)
                .frame(width: 92, alignment: .leading)
            VStack(alignment: .leading, spacing: 8) {
                header
                list(3, subject: true)
            }
        }
    }

    private var large: some View {
        VStack(alignment: .leading, spacing: 12) {
            HStack(alignment: .bottom) {
                DateBlock(now: entry.date, count: items.count)
                Spacer()
            }
            header
            list(7, subject: true)
        }
    }
}

struct DateBlock: View {
    @Environment(\.colorScheme) private var scheme
    let now: Date
    let count: Int
    var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            Text(now, format: .dateTime.weekday(.wide))
                .font(.system(size: 12, weight: .heavy, design: .rounded))
                .textCase(.uppercase)
                .foregroundStyle(WBrand.accent(scheme))
            Text(now, format: .dateTime.day())
                .font(.system(size: 44, weight: .bold, design: .rounded))
                .foregroundStyle(WBrand.ink(scheme))
                .minimumScaleFactor(0.7)
            Text(count == 0 ? "All clear" : count == 1 ? "1 thing due" : "\(count) things due")
                .font(.system(size: 11, weight: .semibold, design: .rounded))
                .foregroundStyle(WBrand.soft(scheme))
                .lineLimit(1)
                .minimumScaleFactor(0.8)
        }
    }
}

struct DueRow: View {
    @Environment(\.colorScheme) private var scheme
    let item: WidgetSnapshot.Due
    let now: Date
    let showSubject: Bool

    var body: some View {
        let late = item.isLate(now)
        HStack(alignment: .center, spacing: 8) {
            RoundedRectangle(cornerRadius: 2, style: .continuous)
                .fill(item.tint)
                .frame(width: 4)
            VStack(alignment: .leading, spacing: 1) {
                Text(item.title)
                    .font(.system(size: 13, weight: .semibold, design: .rounded))
                    .foregroundStyle(WBrand.ink(scheme))
                    .lineLimit(1)
                HStack(spacing: 4) {
                    Text(when(late))
                        .foregroundStyle(late ? WBrand.red : WBrand.soft(scheme))
                        .fontWeight(late ? .bold : .medium)
                    if showSubject, let subject = item.subject, !subject.isEmpty {
                        Text("·").foregroundStyle(WBrand.soft(scheme))
                        Text(subject).foregroundStyle(WBrand.soft(scheme))
                    }
                }
                .font(.system(size: 11, design: .rounded))
                .lineLimit(1)
            }
            Spacer(minLength: 0)
            if item.kind == "exam" {
                Image(systemName: "graduationcap.fill").font(.system(size: 11)).foregroundStyle(item.tint)
            }
        }
        .fixedSize(horizontal: false, vertical: true)
    }

    private func when(_ late: Bool) -> String {
        var s = late ? (DateText.daysFrom(now, to: item.date) == 0 ? "Late today" : DateText.relative(item.date, now: now)) : DateText.relative(item.date, now: now, short: !showSubject)
        if !late, let t = DateText.time(item.time), item.dayOffset(now) <= 1 { s += " \(t)" }
        let k = item.kindLabel
        if !k.isEmpty && showSubject { s = "\(k) · " + s }
        return s
    }
}

// MARK: - To-Do (tick things off)

struct TodoWidget: Widget {
    var body: some WidgetConfiguration {
        StaticConfiguration(kind: "app.tester.todos", provider: TesterProvider()) { entry in
            TodoView(entry: entry)
                .containerBackground(for: .widget) { WidgetGradient() }
                .widgetURL(URL(string: "testerapp://open"))
        }
        .configurationDisplayName("To-Do")
        .description("Tick off to-dos, or tap the mic to add one by voice.")
        .supportedFamilies([.systemSmall, .systemMedium, .systemLarge, .accessoryRectangular])
    }
}

struct TodoView: View {
    @Environment(\.widgetFamily) private var family
    @Environment(\.colorScheme) private var scheme
    let entry: TesterEntry

    private var todos: [WidgetSnapshot.Todo] { entry.snapshot.todoItems }
    private var limit: Int {
        switch family {
        case .systemLarge: return 8
        case .systemMedium: return 3
        default: return 3
        }
    }

    var body: some View {
        if family == .accessoryRectangular {
            VStack(alignment: .leading, spacing: 1) {
                Label("To-do", systemImage: "checklist").font(.system(size: 12, weight: .bold, design: .rounded))
                if todos.isEmpty { Text("All done").font(.system(size: 14, weight: .semibold, design: .rounded)) }
                ForEach(todos.prefix(2)) { t in
                    Text("○ \(t.text)").font(.system(size: 13, weight: .medium, design: .rounded)).lineLimit(1)
                }
            }
            .frame(maxWidth: .infinity, alignment: .leading)
            .widgetAccentable()
        } else {
            VStack(alignment: .leading, spacing: family == .systemSmall ? 7 : 8) {
                HStack(alignment: .center) {
                    Text("TO-DO")
                        .font(.system(size: 11, weight: .heavy, design: .rounded))
                        .tracking(1)
                        .foregroundStyle(WBrand.accent(scheme))
                    if let open = entry.snapshot.todosOpen, open > 0 {
                        Text("\(open)")
                            .font(.system(size: 11, weight: .bold, design: .rounded))
                            .foregroundStyle(WBrand.soft(scheme))
                    }
                    Spacer()
                    Button(intent: VoiceTodoIntent()) {
                        Image(systemName: "mic.fill")
                            .font(.system(size: 12, weight: .bold))
                            .foregroundStyle(.white)
                            .frame(width: 28, height: 28)
                            .background(Circle().fill(LinearGradient(colors: [WBrand.teal, WBrand.violet], startPoint: .topLeading, endPoint: .bottomTrailing)))
                    }
                    .buttonStyle(.plain)
                    .accessibilityLabel("Add a to-do by voice")
                }
                if !entry.snapshot.hasData && todos.isEmpty {
                    OpenTesterHint(text: entry.shared ? "Open Tester once to show your to-dos." : "Open Tester to finish setting up widgets.")
                } else if todos.isEmpty {
                    VStack(alignment: .leading, spacing: 4) {
                        Text("All done 🎉").font(.system(size: 15, weight: .bold, design: .rounded)).foregroundStyle(WBrand.ink(scheme))
                        Text("Tap the mic and say your next one.").font(.system(size: 12, design: .rounded)).foregroundStyle(WBrand.soft(scheme))
                    }
                    .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .leading)
                } else {
                    VStack(alignment: .leading, spacing: family == .systemSmall ? 6 : 7) {
                        ForEach(todos.prefix(limit)) { t in TodoRow(todo: t, now: entry.date, compact: family == .systemSmall) }
                        if todos.count > limit {
                            Text("+\(todos.count - limit) more")
                                .font(.system(size: 11, weight: .semibold, design: .rounded))
                                .foregroundStyle(WBrand.soft(scheme))
                        }
                    }
                    .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)
                }
            }
        }
    }
}

struct TodoRow: View {
    @Environment(\.colorScheme) private var scheme
    let todo: WidgetSnapshot.Todo
    let now: Date
    let compact: Bool

    var body: some View {
        HStack(alignment: .center, spacing: 8) {
            Button(intent: CompleteTodoIntent(itemID: todo.id)) {
                Image(systemName: "circle")
                    .font(.system(size: compact ? 16 : 18, weight: .medium))
                    .foregroundStyle(todo.priority == "high" ? WBrand.red : WBrand.accent(scheme))
            }
            .buttonStyle(.plain)
            .accessibilityLabel("Complete \(todo.text)")
            VStack(alignment: .leading, spacing: 0) {
                Text(todo.text)
                    .font(.system(size: 13, weight: .semibold, design: .rounded))
                    .foregroundStyle(WBrand.ink(scheme))
                    .lineLimit(1)
                if !compact, let due = todo.due, !due.isEmpty {
                    let late = (DateText.daysFrom(now, to: due) ?? 0) < 0
                    Text(DateText.relative(due, now: now))
                        .font(.system(size: 11, weight: late ? .bold : .medium, design: .rounded))
                        .foregroundStyle(late ? WBrand.red : WBrand.soft(scheme))
                }
            }
            Spacer(minLength: 0)
            if todo.pending == true {
                Image(systemName: "waveform").font(.system(size: 10, weight: .bold)).foregroundStyle(WBrand.soft(scheme))
            }
        }
    }
}

// MARK: - Voice To-Do (one-tap mic)

struct VoiceWidget: Widget {
    var body: some WidgetConfiguration {
        StaticConfiguration(kind: "app.tester.voice", provider: TesterProvider()) { entry in
            VoiceWidgetView(entry: entry)
                .containerBackground(for: .widget) { WidgetGradient() }
                .widgetURL(URL(string: "testerapp://voice"))
        }
        .configurationDisplayName("Voice To-Do")
        .description("One tap, say it, and it’s on your list.")
        .supportedFamilies([.systemSmall, .accessoryCircular])
    }
}

struct VoiceWidgetView: View {
    @Environment(\.widgetFamily) private var family
    @Environment(\.colorScheme) private var scheme
    let entry: TesterEntry

    private var subtitle: String {
        guard let open = entry.snapshot.todosOpen else { return "Say it, it’s added" }
        return open == 0 ? "List is clear" : "\(open) on your list"
    }

    var body: some View {
        if family == .accessoryCircular {
            ZStack {
                AccessoryWidgetBackground()
                Image(systemName: "mic.fill").font(.system(size: 22, weight: .semibold))
            }
            .widgetAccentable()
            .accessibilityLabel("Voice to-do")
        } else {
            VStack(alignment: .leading, spacing: 0) {
                ZStack {
                    Circle()
                        .fill(LinearGradient(colors: [WBrand.teal, WBrand.violet], startPoint: .topLeading, endPoint: .bottomTrailing))
                        .frame(width: 58, height: 58)
                        .shadow(color: WBrand.violet.opacity(0.35), radius: 10, y: 4)
                    Image(systemName: "mic.fill").font(.system(size: 24, weight: .bold)).foregroundStyle(.white)
                }
                Spacer(minLength: 6)
                Text("Voice to-do")
                    .font(.system(size: 16, weight: .bold, design: .rounded))
                    .foregroundStyle(WBrand.ink(scheme))
                Text(subtitle)
                    .font(.system(size: 12, weight: .medium, design: .rounded))
                    .foregroundStyle(WBrand.soft(scheme))
            }
            .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .leading)
        }
    }
}

// MARK: - Control (iOS 18+: Action button, Control Center, Lock Screen)

@available(iOS 18.0, *)
struct VoiceTodoControl: ControlWidget {
    var body: some ControlWidgetConfiguration {
        StaticControlConfiguration(kind: "app.tester.voice-control") {
            ControlWidgetButton(action: VoiceTodoIntent()) {
                Label("Voice To-Do", systemImage: "mic.fill")
            }
        }
        .displayName("Voice To-Do")
        .description("Say a to-do and Tester adds it.")
    }
}

import AppIntents
import Foundation

/// "Add To-Do" — adds text to your Tester to-do list without opening the app. Pair it with
/// Shortcuts' "Dictate Text" for a hands-free Action button or Back Tap, or ask Siri.
struct AddTodoIntent: AppIntent {
    static var title: LocalizedStringResource = "Add To-Do"
    static var description = IntentDescription("Adds a to-do to your Tester list. Dates like “tomorrow” or “fri” become the due date.")

    @Parameter(title: "To-do", requestValueDialog: IntentDialog("What do you need to do?"))
    var text: String

    static var parameterSummary: some ParameterSummary {
        Summary("Add \(\.$text) to Tester")
    }

    init() {}
    init(text: String) { self.text = text }

    func perform() async throws -> some IntentResult & ProvidesDialog {
        guard let item = TesterStore.shared.enqueue(text) else {
            return .result(dialog: "I didn’t catch a to-do.")
        }
        await MainActor.run { NotificationCenter.default.post(name: .testerInboxChanged, object: nil) }
        return .result(dialog: "Added “\(item.text)” to Tester.")
    }
}

/// "Voice To-Do" — opens Tester listening. Say the to-do ("Chem homework") and it's added.
struct VoiceTodoIntent: AppIntent {
    static var title: LocalizedStringResource = "Voice To-Do"
    static var description = IntentDescription("Opens Tester listening. Say your to-do and it’s added to your list.")
    static var openAppWhenRun: Bool = true

    init() {}

    func perform() async throws -> some IntentResult {
        TesterStore.shared.requestVoice()
        await MainActor.run { NotificationCenter.default.post(name: .testerVoiceRequested, object: nil) }
        return .result()
    }
}

/// The checkmark on the To-do widget.
struct CompleteTodoIntent: AppIntent {
    static var title: LocalizedStringResource = "Complete To-Do"
    static var isDiscoverable: Bool = false

    @Parameter(title: "Item")
    var itemID: String

    init() {}
    init(itemID: String) { self.itemID = itemID }

    func perform() async throws -> some IntentResult {
        TesterStore.shared.complete(itemID)
        await MainActor.run { NotificationCenter.default.post(name: .testerInboxChanged, object: nil) }
        return .result()
    }
}

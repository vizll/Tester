import AppIntents
import SwiftUI
import UIKit

/// Siri and Shortcuts phrases. These also appear in Settings → Action Button → Shortcut → Tester,
/// and in the Shortcuts app with no setup.
struct TesterShortcuts: AppShortcutsProvider {
    static var appShortcuts: [AppShortcut] {
        AppShortcut(
            intent: VoiceTodoIntent(),
            phrases: [
                "Voice to-do in \(.applicationName)",
                "New \(.applicationName) voice to-do",
                "Listen for a to-do in \(.applicationName)"
            ],
            shortTitle: "Voice To-Do",
            systemImageName: "mic.fill"
        )
        AppShortcut(
            intent: AddTodoIntent(),
            phrases: [
                "Add a to-do in \(.applicationName)",
                "Add to my \(.applicationName) to-do list",
                "New \(.applicationName) to-do"
            ],
            shortTitle: "Add To-Do",
            systemImageName: "checklist"
        )
    }
    static var shortcutTileColor: ShortcutTileColor = .teal
}

/// "Widgets & Action button" guide, opened from Customize → General → iPhone extras or the voice sheet.
struct SetupGuideView: View {
    @Environment(\.colorScheme) private var scheme
    let onTry: () -> Void
    let onClose: () -> Void
    @State private var tab = 0

    var body: some View {
        NavigationView {
            ScrollView {
                VStack(alignment: .leading, spacing: 18) {
                    Text("Add a to-do without typing: hold the Action button (or tap the back of your iPhone), say “Chem homework”, and it’s on your list.")
                        .font(.callout)
                        .foregroundStyle(.secondary)

                    Picker("Trigger", selection: $tab) {
                        Text("Action button").tag(0)
                        Text("Back Tap").tag(1)
                        Text("Siri").tag(2)
                    }
                    .pickerStyle(.segmented)

                    switch tab {
                    case 0:
                        card("Quickest: opens Tester listening", icon: "mic.fill", steps: [
                            "Open Settings → Action Button.",
                            "Swipe to Shortcut, tap Choose a Shortcut.",
                            "Pick Tester → Voice To-Do.",
                            "Hold the Action button, say your to-do. Tester stops when you pause and adds it."
                        ])
                        card("Stay where you are (no app opening)", icon: "bolt.fill", steps: [
                            "In the Shortcuts app tap + to make a new shortcut.",
                            "Add the action Dictate Text (set Stop Listening to After Pause).",
                            "Add Tester’s Add To-Do action; its To-do field fills with Dictated Text.",
                            "Name it “Voice To-Do”, then choose it in Settings → Action Button → Shortcut."
                        ])
                        tip("On iOS 18 or later you can also pick Controls → Tester → Voice To-Do for the Action button, Control Center or the Lock Screen.")
                    case 1:
                        card("Double or triple tap the back", icon: "hand.tap.fill", steps: [
                            "In the Shortcuts app, open App Shortcuts → Tester and add Voice To-Do to your shortcuts (or build the Dictate Text version from the Action button tab).",
                            "Open Settings → Accessibility → Touch → Back Tap.",
                            "Choose Double Tap or Triple Tap.",
                            "Scroll to Shortcuts and pick Voice To-Do."
                        ])
                        tip("Back Tap works on iPhone 8 and later, even in a case.")
                    default:
                        card("Just ask", icon: "waveform", steps: [
                            "Say “Hey Siri, add a to-do in Tester”.",
                            "Siri asks “What do you need to do?” — say “Chem homework”.",
                            "It’s added without opening the app. Dates work too: “Chem homework due Friday”."
                        ])
                        tip("“Voice to-do in Tester” opens Tester listening instead.")
                    }

                    card("Widgets", icon: "square.grid.2x2.fill", steps: [
                        "Touch and hold an empty spot on your Home Screen, tap Edit → Add Widget.",
                        "Search for Tester. Up Next shows what’s due; To-Do lets you tick things off; Voice To-Do is a one-tap mic.",
                        "Lock Screen: tap the clock while customizing and add Up Next or Voice To-Do."
                    ])
                    tip("If a widget says “Open Tester once”, open the app so it can share your list. When sideloading, keep app extensions enabled in SideStore.")

                    Button(action: onTry) {
                        Label("Try a voice to-do now", systemImage: "mic.fill")
                            .frame(maxWidth: .infinity)
                    }
                    .buttonStyle(PillStyle(filled: true))
                    .padding(.top, 4)
                }
                .padding(20)
            }
            .background(Brand.background(scheme).ignoresSafeArea())
            .navigationTitle("Hands-free to-dos")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .confirmationAction) { Button("Done", action: onClose) }
            }
        }
        .navigationViewStyle(.stack)
    }

    private func card(_ title: String, icon: String, steps: [String]) -> some View {
        VStack(alignment: .leading, spacing: 12) {
            Label(title, systemImage: icon)
                .font(.system(.headline, design: .rounded))
                .foregroundStyle(Brand.accent(scheme))
            ForEach(Array(steps.enumerated()), id: \.offset) { index, step in
                HStack(alignment: .firstTextBaseline, spacing: 10) {
                    Text("\(index + 1)")
                        .font(.system(.caption, design: .rounded).weight(.bold))
                        .foregroundStyle(.white)
                        .frame(width: 22, height: 22)
                        .background(Circle().fill(LinearGradient(colors: [Brand.teal, Brand.violet], startPoint: .topLeading, endPoint: .bottomTrailing)))
                    Text(step).font(.subheadline).fixedSize(horizontal: false, vertical: true)
                }
            }
        }
        .padding(16)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(RoundedRectangle(cornerRadius: 18, style: .continuous).fill(Color(uiColor: .systemBackground).opacity(scheme == .dark ? 0.35 : 0.7)))
    }

    private func tip(_ text: String) -> some View {
        Label(text, systemImage: "lightbulb")
            .font(.footnote)
            .foregroundStyle(.secondary)
    }
}

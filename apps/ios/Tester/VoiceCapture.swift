import AVFoundation
import Speech
import SwiftUI
import UIKit

/// Listens for one to-do ("Chem homework"), turns it into text on the device when possible, and stops
/// by itself after a short pause.
@MainActor
final class SpeechListener: ObservableObject {
    enum Phase: Equatable { case starting, listening, finished(String), failed(String), denied(String) }

    @Published var phase: Phase = .starting
    @Published var transcript = ""
    @Published var level: CGFloat = 0

    private let engine = AVAudioEngine()
    private var request: SFSpeechAudioBufferRecognitionRequest?
    private var task: SFSpeechRecognitionTask?
    private var silenceTimer: Timer?
    private var limitTimer: Timer?
    private var running = false

    func start() {
        transcript = ""
        phase = .starting
        SFSpeechRecognizer.requestAuthorization { status in
            Task { @MainActor in
                guard status == .authorized else {
                    self.phase = .denied("Turn on Speech Recognition for Tester in Settings to add to-dos by voice.")
                    return
                }
                AVAudioApplication.requestRecordPermission { granted in
                    Task { @MainActor in
                        if granted { self.begin() } else { self.phase = .denied("Turn on the Microphone for Tester in Settings to add to-dos by voice.") }
                    }
                }
            }
        }
    }

    private func recognizer() -> SFSpeechRecognizer? {
        if let r = SFSpeechRecognizer(locale: Locale.current), r.isAvailable { return r }
        if let r = SFSpeechRecognizer(locale: Locale(identifier: "en-US")), r.isAvailable { return r }
        return nil
    }

    private func begin() {
        guard let recognizer = recognizer() else {
            phase = .failed("Speech recognition isn’t available right now. Check your connection and try again.")
            return
        }
        let session = AVAudioSession.sharedInstance()
        do {
            try session.setCategory(.record, mode: .measurement, options: [.duckOthers])
            try session.setActive(true, options: .notifyOthersOnDeactivation)
        } catch {
            phase = .failed("The microphone is busy. Try again in a moment.")
            return
        }

        let request = SFSpeechAudioBufferRecognitionRequest()
        request.shouldReportPartialResults = true
        request.taskHint = .dictation
        request.addsPunctuation = false
        if recognizer.supportsOnDeviceRecognition { request.requiresOnDeviceRecognition = true }
        self.request = request

        let input = engine.inputNode
        let format = input.outputFormat(forBus: 0)
        guard format.sampleRate > 0, format.channelCount > 0 else {
            phase = .failed("No microphone found.")
            return
        }
        input.removeTap(onBus: 0)
        input.installTap(onBus: 0, bufferSize: 1024, format: format) { [weak self] buffer, _ in
            request.append(buffer)
            let level = SpeechListener.rms(buffer)
            Task { @MainActor in self?.level = level }
        }
        engine.prepare()
        do { try engine.start() } catch {
            phase = .failed("Couldn’t start the microphone.")
            cleanUp()
            return
        }
        running = true
        phase = .listening
        UIImpactFeedbackGenerator(style: .medium).impactOccurred()

        task = recognizer.recognitionTask(with: request) { [weak self] result, error in
            let text = result?.bestTranscription.formattedString
            let isFinal = result?.isFinal ?? false
            Task { @MainActor in
                guard let self, self.running else { return }
                if let text, !text.isEmpty {
                    self.transcript = text
                    self.armSilenceTimer()
                }
                if isFinal || (error != nil && result == nil) { self.finish() }
            }
        }
        // stop after 15 s at most, or 6 s if nothing was said
        limitTimer = Timer.scheduledTimer(withTimeInterval: 6, repeats: false) { [weak self] _ in
            Task { @MainActor in
                guard let self, self.running else { return }
                if self.transcript.isEmpty { self.finish() }
                else { self.limitTimer = Timer.scheduledTimer(withTimeInterval: 9, repeats: false) { [weak self] _ in Task { @MainActor in self?.finish() } } }
            }
        }
    }

    private func armSilenceTimer() {
        silenceTimer?.invalidate()
        silenceTimer = Timer.scheduledTimer(withTimeInterval: 1.4, repeats: false) { [weak self] _ in
            Task { @MainActor in self?.finish() }
        }
    }

    /// Stops listening and keeps what was heard.
    func finish() {
        guard running else { return }
        running = false
        let text = TesterStore.clean(transcript)
        cleanUp()
        if text.isEmpty { phase = .failed("Didn’t catch that.") }
        else {
            phase = .finished(text)
            UINotificationFeedbackGenerator().notificationOccurred(.success)
        }
    }

    func cancel() {
        running = false
        cleanUp()
    }

    private func cleanUp() {
        silenceTimer?.invalidate(); silenceTimer = nil
        limitTimer?.invalidate(); limitTimer = nil
        if engine.isRunning { engine.stop() }
        engine.inputNode.removeTap(onBus: 0)
        request?.endAudio(); request = nil
        task?.cancel(); task = nil
        level = 0
        try? AVAudioSession.sharedInstance().setActive(false, options: .notifyOthersOnDeactivation)
    }

    nonisolated static func rms(_ buffer: AVAudioPCMBuffer) -> CGFloat {
        guard let data = buffer.floatChannelData?[0] else { return 0 }
        let n = Int(buffer.frameLength)
        guard n > 0 else { return 0 }
        var sum: Float = 0
        for i in 0..<n { sum += data[i] * data[i] }
        let rms = sqrt(sum / Float(n))
        return CGFloat(min(1, max(0, (20 * log10(max(rms, 0.000_01)) + 50) / 40)))
    }
}

// MARK: - The listening sheet

struct VoiceCaptureView: View {
    @StateObject private var listener = SpeechListener()
    @Environment(\.colorScheme) private var scheme
    let onAdd: (String) -> Void
    let onClose: () -> Void
    let onSetup: () -> Void
    @State private var added = false

    var body: some View {
        VStack(spacing: 18) {
            Capsule().fill(Color.secondary.opacity(0.35)).frame(width: 38, height: 5).padding(.top, 8)
            Text(header)
                .font(.system(.footnote, design: .rounded).weight(.bold))
                .tracking(1.2)
                .textCase(.uppercase)
                .foregroundStyle(Brand.accent(scheme))
            micOrb
            Text(bodyText)
                .font(.system(size: transcriptSize, weight: .semibold, design: .rounded))
                .multilineTextAlignment(.center)
                .foregroundStyle(listener.transcript.isEmpty && !isDone ? Color.secondary : Color.primary)
                .lineLimit(4)
                .minimumScaleFactor(0.6)
                .frame(maxWidth: .infinity, minHeight: 64)
                .padding(.horizontal, 24)
                .animation(.easeOut(duration: 0.15), value: listener.transcript)
            buttons
            Button(action: onSetup) {
                Label("Use the Action button or Back Tap", systemImage: "hand.tap")
                    .font(.footnote.weight(.semibold))
            }
            .foregroundStyle(Color.secondary)
            .padding(.bottom, 10)
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .top)
        .background(Brand.background(scheme).ignoresSafeArea())
        .onAppear { listener.start() }
        .onDisappear { listener.cancel() }
        .onChange(of: listener.phase) { phase in
            if case .finished(let text) = phase, !added {
                added = true
                onAdd(text)
                DispatchQueue.main.asyncAfter(deadline: .now() + 0.9) { onClose() }
            }
        }
    }

    private var isDone: Bool { if case .finished = listener.phase { return true }; return false }

    private var header: String {
        switch listener.phase {
        case .starting: return "Getting ready"
        case .listening: return "Listening…"
        case .finished: return "Added to your to-dos"
        case .failed, .denied: return "Voice to-do"
        }
    }

    private var bodyText: String {
        switch listener.phase {
        case .starting, .listening: return listener.transcript.isEmpty ? "Say a to-do, like “Chem homework due Friday”" : listener.transcript
        case .finished(let text): return text
        case .failed(let message), .denied(let message): return message
        }
    }

    private var transcriptSize: CGFloat {
        switch listener.phase {
        case .failed, .denied: return 17
        default: return listener.transcript.isEmpty && !isDone ? 19 : 26
        }
    }

    private var micOrb: some View {
        let listening = listener.phase == .listening
        return ZStack {
            Circle()
                .fill(Brand.accent(scheme).opacity(0.16))
                .frame(width: 150, height: 150)
                .scaleEffect(listening ? 0.82 + listener.level * 0.4 : 0.8)
                .animation(.easeOut(duration: 0.12), value: listener.level)
            Circle()
                .fill(Brand.accent(scheme).opacity(0.22))
                .frame(width: 118, height: 118)
                .scaleEffect(listening ? 0.9 + listener.level * 0.2 : 0.9)
                .animation(.easeOut(duration: 0.12), value: listener.level)
            Circle()
                .fill(LinearGradient(colors: [Brand.teal, Brand.violet], startPoint: .topLeading, endPoint: .bottomTrailing))
                .frame(width: 88, height: 88)
                .shadow(color: Brand.violet.opacity(0.35), radius: 14, y: 6)
            Image(systemName: isDone ? "checkmark" : "mic.fill")
                .font(.system(size: 34, weight: .bold))
                .foregroundStyle(.white)
                .transition(.scale.combined(with: .opacity))
        }
        .frame(height: 160)
        .onTapGesture { if listening { listener.finish() } }
        .accessibilityLabel(listening ? "Stop listening" : "Microphone")
    }

    @ViewBuilder private var buttons: some View {
        switch listener.phase {
        case .starting, .listening:
            HStack(spacing: 12) {
                Button("Cancel") { listener.cancel(); onClose() }
                    .buttonStyle(PillStyle(filled: false))
                Button("Done") { listener.finish() }
                    .buttonStyle(PillStyle(filled: true))
                    .disabled(listener.transcript.isEmpty)
                    .opacity(listener.transcript.isEmpty ? 0.5 : 1)
            }
        case .finished:
            EmptyView()
        case .failed:
            HStack(spacing: 12) {
                Button("Close") { onClose() }.buttonStyle(PillStyle(filled: false))
                Button("Try again") { listener.start() }.buttonStyle(PillStyle(filled: true))
            }
        case .denied:
            HStack(spacing: 12) {
                Button("Close") { onClose() }.buttonStyle(PillStyle(filled: false))
                Button("Open Settings") {
                    if let url = URL(string: UIApplication.openSettingsURLString) { UIApplication.shared.open(url) }
                }.buttonStyle(PillStyle(filled: true))
            }
        }
    }
}

struct PillStyle: ButtonStyle {
    var filled: Bool
    func makeBody(configuration: Configuration) -> some View {
        PillLabel(label: configuration.label, filled: filled, pressed: configuration.isPressed)
    }
}

struct PillLabel<Content: View>: View {
    let label: Content
    let filled: Bool
    let pressed: Bool
    @Environment(\.colorScheme) private var scheme
    var body: some View {
        label
            .font(.system(.body, design: .rounded).weight(.semibold))
            .padding(.horizontal, 26)
            .frame(minWidth: 120, minHeight: 48)
            .foregroundStyle(filled ? Color.white : Color.primary)
            .background(
                Capsule().fill(filled ? AnyShapeStyle(LinearGradient(colors: [Brand.teal, Brand.violet], startPoint: .leading, endPoint: .trailing))
                                      : AnyShapeStyle(Color.primary.opacity(scheme == .dark ? 0.12 : 0.07)))
            )
            .scaleEffect(pressed ? 0.96 : 1)
            .animation(.easeOut(duration: 0.12), value: pressed)
    }
}

/// Tester's calm look, shared by the voice sheet and the setup guide.
enum Brand {
    static let teal = Color(red: 0.20, green: 0.62, blue: 0.56)
    static let violet = Color(red: 0.47, green: 0.40, blue: 0.82)
    static func accent(_ scheme: ColorScheme) -> Color {
        scheme == .dark ? Color(red: 0.50, green: 0.83, blue: 0.77) : Color(red: 0.16, green: 0.52, blue: 0.47)
    }
    static func background(_ scheme: ColorScheme) -> LinearGradient {
        scheme == .dark
            ? LinearGradient(colors: [Color(red: 0.055, green: 0.07, blue: 0.125), Color(red: 0.118, green: 0.094, blue: 0.22)], startPoint: .top, endPoint: .bottom)
            : LinearGradient(colors: [Color(red: 0.88, green: 0.95, blue: 0.93), Color(red: 0.89, green: 0.86, blue: 0.965)], startPoint: .top, endPoint: .bottom)
    }
}

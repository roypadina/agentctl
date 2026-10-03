import SwiftUI
import AppKit

/// Custom About window (the standard panel's fixed-height credits box clipped the text).
final class AboutWindow {
    static let shared = AboutWindow()
    private var window: NSWindow?

    func show() {
        if window == nil {
            let w = NSWindow(contentViewController: NSHostingController(rootView: AboutView()))
            w.title = "About Agentctl"
            w.styleMask = [.titled, .closable]
            w.isReleasedWhenClosed = false
            w.center()
            window = w
        }
        NSApp.activate(ignoringOtherApps: true)
        window?.makeKeyAndOrderFront(nil)
    }
}

struct AboutView: View {
    private let info = Bundle.main.infoDictionary ?? [:]

    var body: some View {
        VStack(spacing: 12) {
            Image(nsImage: NSApp.applicationIconImage).resizable().frame(width: 96, height: 96)

            VStack(spacing: 2) {
                Text("Agentctl").font(.title.bold())
                Text("Version \(info["CFBundleShortVersionString"] as? String ?? "") (\(info["CFBundleVersion"] as? String ?? ""))")
                    .font(.callout).foregroundColor(.secondary)
            }

            VStack(spacing: 8) {
                Text("Made by Roy Padina").font(.headline)
                Text("I'm a software engineer from Israel who builds small, focused Mac tools to fix the little annoyances in my own day — then shares them free and open source.")
                Text("If this app saves you time, a coffee on Ko-fi keeps the next one coming. ☕")
            }
            .multilineTextAlignment(.center)
            .fixedSize(horizontal: false, vertical: true)

            HStack {
                Link(destination: AppLinks.kofi) { Text("Support on Ko-fi ☕").frame(minWidth: 140) }
                    .buttonStyle(.borderedProminent).controlSize(.large)
                Link(destination: AppLinks.github) { Text("GitHub").frame(minWidth: 70) }
                    .buttonStyle(.bordered).controlSize(.large)
            }

            Link("Report an issue", destination: AppLinks.github.appendingPathComponent("issues")).font(.callout)

            Text("© Roy Padina · MIT").font(.caption).foregroundColor(.secondary)
        }
        .padding(24)
        .frame(width: 380)
    }
}

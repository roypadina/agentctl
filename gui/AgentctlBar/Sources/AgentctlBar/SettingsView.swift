import SwiftUI
import AppKit

extension Color {
    /// "#RRGGBB" from this Color via sRGB NSColor. Returns nil if it can't be expressed in sRGB.
    func toHex() -> String? {
        guard let rgb = NSColor(self).usingColorSpace(.sRGB) else { return nil }
        let r = Int(round(rgb.redComponent * 255))
        let g = Int(round(rgb.greenComponent * 255))
        let b = Int(round(rgb.blueComponent * 255))
        return String(format: "#%02X%02X%02X", r, g, b)
    }
}

private struct EGroup: Identifiable { let id = UUID(); var name: String; var path: String; var color: String }
private struct ETool: Identifiable { let id = UUID(); var name: String; var runs: String; var label: String; var color: String }
private struct EIde: Identifiable { let id = UUID(); var key: String; var label: String; var cmd: String }

enum AppLinks {
    static let kofi = URL(string: "https://ko-fi.com/roypadina")!
    static let github = URL(string: "https://github.com/roypadina/agentctl")!
}

/// Full config editor. Writes the same config the TUI reads (via `agentctl gui config-save`).
struct SettingsView: View {
    var onSaved: () -> Void = {}
    @Environment(\.dismiss) private var dismiss

    @State private var groups: [EGroup] = []
    @State private var tools: [ETool] = []
    @State private var ides: [EIde] = []
    @State private var defaultTool = "cld"
    @State private var terminal = "default"
    @State private var custom = ""
    @State private var hotkey = ""
    @State private var terminalOpts: [TerminalOpt] = []
    @State private var loaded = false
    /// A save is out. The sheet stays open until it lands, so a failure can be shown where the
    /// edits still are.
    @State private var saving = false
    @State private var saveError: String?

    var body: some View {
        VStack(spacing: 0) {
            HStack {
                Text("Settings").font(.headline)
                Spacer()
                Text("shared with the terminal").font(.caption).foregroundColor(.secondary)
            }.padding(12)
            Divider()
            ScrollView {
                VStack(alignment: .leading, spacing: 16) {
                    terminalSection
                    groupsSection
                    toolsSection
                    idesSection
                    aboutSection
                }.padding(14)
            }
            Divider()
            HStack(spacing: 8) {
                if let e = saveError {
                    Label(e, systemImage: "exclamationmark.triangle.fill")
                        .font(.caption).foregroundColor(Tone.alarm).lineLimit(2)
                }
                Spacer()
                if saving { ProgressView().controlSize(.small) }
                Button("Cancel") { dismiss() }
                Button("Save") { save() }.keyboardShortcut(.defaultAction).disabled(saving)
            }.padding(12)
        }
        .frame(width: 580, height: 640)
        .task { await load() }
    }

    // ── sections ──
    private var terminalSection: some View {
        VStack(alignment: .leading, spacing: 6) {
            sectionTitle("Open sessions in")
            Picker("Terminal", selection: $terminal) {
                ForEach(terminalOpts) { Text($0.installed ? $0.label : "\($0.label) (not installed)").tag($0.id) }
            }.labelsHidden().frame(width: 260)
            if terminal == "custom" {
                TextField("launch command — {{script}} / {{cmd}} / {{dir}}", text: $custom)
            }
            Divider().padding(.vertical, 2)
            sectionTitle("Launch shortcut (open the window)")
            HStack {
                HotkeyRecorder(spec: $hotkey).frame(width: 200, height: 24)
                Button("Clear") { hotkey = "" }.disabled(hotkey.isEmpty)
                Text("click, then press the combo").font(.caption).foregroundColor(.secondary)
            }
        }
    }

    private var groupsSection: some View {
        VStack(alignment: .leading, spacing: 6) {
            HStack { sectionTitle("Groups"); Spacer(); addButton { groups.append(EGroup(name: "", path: "", color: "#6C91BF")) } }
            ForEach($groups) { $g in
                HStack(spacing: 6) {
                    TextField("name", text: $g.name).frame(width: 100)
                    TextField("~/path", text: $g.path)
                    Button("…") { if let p = pickFolder() { $g.path.wrappedValue = p } }
                    ColorPicker("", selection: colorBinding($g.color)).labelsHidden().frame(width: 40)
                    TextField("#hex", text: $g.color).frame(width: 78)
                    removeButton { groups.removeAll { $0.id == g.id } }
                }
            }
            if groups.isEmpty { hint("No groups — add one and point it at a folder that holds your projects.") }
        }
    }

    private var toolsSection: some View {
        VStack(alignment: .leading, spacing: 6) {
            HStack {
                sectionTitle("Tools"); Spacer()
                Picker("Default", selection: $defaultTool) {
                    ForEach(tools.map { $0.name.isEmpty ? "—" : $0.name }, id: \.self) { Text($0).tag($0) }
                }.frame(width: 150)
                addButton { tools.append(ETool(name: "", runs: "", label: "", color: "#6C91BF")) }
            }
            ForEach($tools) { $t in
                HStack(spacing: 6) {
                    TextField("name", text: $t.name).frame(width: 70)
                    TextField("runs (shell command)", text: $t.runs)
                    removeButton { tools.removeAll { $0.id == t.id } }
                }
            }
            if tools.isEmpty { hint("No tools — e.g. name \"cld\", runs \"claude --dangerously-skip-permissions\".") }
        }
    }

    private var idesSection: some View {
        VStack(alignment: .leading, spacing: 6) {
            HStack { sectionTitle("IDEs (terminal keybinds)"); Spacer(); addButton { ides.append(EIde(key: "ctrl-", label: "", cmd: "")) } }
            ForEach($ides) { $i in
                HStack(spacing: 6) {
                    TextField("ctrl-x", text: $i.key).frame(width: 64)
                    TextField("label", text: $i.label).frame(width: 80)
                    TextField("cmd ($dir)", text: $i.cmd)
                    removeButton { ides.removeAll { $0.id == i.id } }
                }
            }
        }
    }

    private var aboutSection: some View {
        VStack(alignment: .leading, spacing: 8) {
            Divider()
            sectionTitle("About")
            HStack(spacing: 12) {
                Image(nsImage: NSApp.applicationIconImage).resizable().frame(width: 40, height: 40)
                VStack(alignment: .leading, spacing: 2) {
                    Text("Agentctl").font(.headline)
                    Text("Version \(Bundle.main.object(forInfoDictionaryKey: "CFBundleShortVersionString") as? String ?? "—")")
                        .font(.caption).foregroundColor(.secondary)
                }
                Spacer()
                Button("About Agentctl…") { AboutWindow.shared.show() }
                Button("Support on Ko-fi ☕") { NSWorkspace.shared.open(AppLinks.kofi) }.buttonStyle(.borderedProminent)
            }
        }
    }

    // ── bits ──
    private func sectionTitle(_ s: String) -> some View { Text(s).font(.subheadline).bold() }
    private func hint(_ s: String) -> some View { Text(s).font(.caption).foregroundColor(.secondary) }
    private func addButton(_ a: @escaping () -> Void) -> some View { Button(action: a) { Image(systemName: "plus.circle") }.buttonStyle(.borderless) }
    private func removeButton(_ a: @escaping () -> Void) -> some View { Button(action: a) { Image(systemName: "minus.circle").foregroundColor(Tone.alarm) }.buttonStyle(.borderless) }

    /// Two-way bridge between a "#RRGGBB" string field and the native ColorPicker.
    /// A bad/empty hex shows gray; picking a color writes back a normalized hex.
    private func colorBinding(_ hex: Binding<String>) -> Binding<Color> {
        Binding(
            get: { Color(hex: hex.wrappedValue) },
            set: { hex.wrappedValue = $0.toHex() ?? hex.wrappedValue }
        )
    }

    private func pickFolder() -> String? {
        let panel = NSOpenPanel()
        panel.canChooseDirectories = true; panel.canChooseFiles = false; panel.allowsMultipleSelection = false
        guard panel.runModal() == .OK, let url = panel.url else { return nil }
        let p = url.path; let home = NSHomeDirectory()
        return p.hasPrefix(home) ? "~" + p.dropFirst(home.count) : p
    }

    private func load() async {
        guard !loaded else { return }
        loaded = true
        if let r = try? await Cm.terminals() { terminalOpts = r.terminals }
        if let c = try? await Cm.configGet() {
            groups = c.groups.map { EGroup(name: $0.name, path: $0.path, color: $0.color) }
            tools = c.tools.map { ETool(name: $0.name, runs: $0.runs, label: $0.label, color: $0.color) }
            ides = c.ides.map { EIde(key: $0.key, label: $0.label, cmd: $0.cmd) }
            defaultTool = c.defaultTool; terminal = c.terminal; custom = c.launchCommand ?? ""
            hotkey = c.hotkey ?? ""
        }
    }

    private func save() {
        let dto = ConfigDTO(
            defaultTool: defaultTool,
            terminal: terminal,
            launchCommand: terminal == "custom" && !custom.isEmpty ? custom : nil,
            hotkey: hotkey.trimmingCharacters(in: .whitespaces).isEmpty ? nil : hotkey.trimmingCharacters(in: .whitespaces),
            groups: groups.map { GroupDTO(name: $0.name, path: $0.path, color: $0.color) },
            tools: tools.map { ToolDTO(name: $0.name, runs: $0.runs, label: $0.label.isEmpty ? " \($0.name) " : $0.label, color: $0.color) },
            ides: ides.map { IdeDTO(key: $0.key, label: $0.label, cmd: $0.cmd) }
        )
        // Do NOT dismiss first: a failed write used to close the sheet, report success and
        // redisplay the old config, losing every edit with no signal.
        saving = true
        saveError = nil
        Cm.configSave(dto, completion: {
            saving = false
            onSaved()
            NotificationCenter.default.post(name: .cmReload, object: nil)
            NotificationCenter.default.post(name: .cmHotkeyChanged, object: nil)
            dismiss()
        }, onFailure: { message in
            saving = false
            saveError = message
        })
    }
}

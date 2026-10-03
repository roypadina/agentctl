import Foundation

// ── JSON models (mirror `agentctl gui ...` output) ──────────────────────────────────
struct ProjectsResponse: Codable {
    let groups: [Group]
    let tools: [Tool]
    let defaultTool: String
}
struct Group: Codable, Identifiable {
    let name: String; let color: String; let path: String; let dirs: [Dir]
    var id: String { path }
}
struct Dir: Codable, Identifiable {
    let name: String; let path: String; let branch: String?; let timeMs: Double; let scoreSource: String
    var id: String { path }
}
struct Tool: Codable, Identifiable {
    let name: String; let label: String
    var id: String { name }
}
/// What `agentctl gui annotate` hands back — the same record the annotation store holds.
struct Annotation: Codable {
    let sessionId: String
    let name: String?
    let note: String?
    let flags: [String]
    let labels: [String]
    let done: Bool
    let hidden: Bool
    let deleted: Bool
    let remindAt: String?
    let dueAt: String?
}

struct Session: Codable, Identifiable {
    let id: String
    /// Display name: the annotation's override when set, else `transcriptName`.
    var name: String
    /// The name derived from the transcript alone, kept so clearing an override can restore it.
    let transcriptName: String?
    let cwd: String; let status: String
    /// Where `claude` was launched, when that differs from where the work happened.
    let launchCwd: String?
    let active: Bool; let gitBranch: String?; let cwdConfident: Bool; let lastUpdatedAt: String
    let startedAt: String?
    // User annotations. Optional so an older CLI (which does not emit them) still decodes.
    var flags: [String]?; var labels: [String]?; var note: String?; var done: Bool?
    var remindAt: String?; var remindDue: Bool?
    var dueAt: String?; var overdue: Bool?
    var hidden: Bool?; var deleted: Bool?
    /// "interactive" or "tool" — a tool run is one something else started (`claude -p`, the SDK,
    /// MCP), not one you sat in front of. `entrypoint` is the raw value behind it.
    let kind: String?; let entrypoint: String?
    /// Claude account this session would resume under.
    let account: String?

    var tags: [String] { flags ?? [] }
    var tickets: [String] { labels ?? [] }
    var isDone: Bool { done ?? false }
    var isReminderDue: Bool { remindDue ?? false }
    var isOverdue: Bool { overdue ?? false }
    var isHidden: Bool { hidden ?? false }
    var isDeleted: Bool { deleted ?? false }
    var isToolRun: Bool { kind == "tool" }

    /// Fold a freshly written annotation into this row, so one changed session costs no re-list.
    /// `remindDue`/`overdue` are derived rather than carried, because the CLI computed the copies
    /// we already hold against a clock that has since moved.
    func applying(_ a: Annotation) -> Session {
        var s = self
        s.name = a.name ?? transcriptName ?? name
        s.flags = a.flags; s.labels = a.labels; s.note = a.note
        s.done = a.done; s.hidden = a.hidden; s.deleted = a.deleted
        s.remindAt = a.remindAt; s.dueAt = a.dueAt
        s.remindDue = !a.done && Session.hasPassed(a.remindAt)
        s.overdue = !a.done && Session.hasPassed(a.dueAt)
        return s
    }

    private static func hasPassed(_ iso: String?) -> Bool {
        guard let iso, let d = ISO8601DateFormatter.cmFractional.date(from: iso)
            ?? ISO8601DateFormatter.cmPlain.date(from: iso) else { return false }
        return d <= Date()
    }
    var hasAnnotation: Bool {
        isDone || !tags.isEmpty || !tickets.isEmpty || note != nil || remindAt != nil || dueAt != nil
    }
}
extension ISO8601DateFormatter {
    static let cmFractional: ISO8601DateFormatter = {
        let f = ISO8601DateFormatter(); f.formatOptions = [.withInternetDateTime, .withFractionalSeconds]; return f
    }()
    static let cmPlain = ISO8601DateFormatter()
}

struct Profile: Codable, Identifiable {
    let home: String; let account: String; let isPrimary: Bool
    var id: String { home }
}
struct RecapResponse: Codable {
    let ok: Bool; let text: String?; let generatedAt: String?; let fromCache: Bool?; let error: String?
}
struct TerminalOpt: Codable, Identifiable {
    let id: String; let label: String; let installed: Bool; let selected: Bool
}
struct PeekTurn: Codable { let role: String; let kind: String; let text: String }
struct TerminalsResponse: Codable {
    let terminals: [TerminalOpt]; let current: String; let customCommand: String?
}

// Editable config (shared with the TUI). Mirrors `agentctl gui config-get` / `config-save`.
struct GroupDTO: Codable { var name: String; var path: String; var color: String }
struct ToolDTO: Codable { var name: String; var runs: String; var label: String; var color: String }
struct IdeDTO: Codable { var key: String; var label: String; var cmd: String }
struct ConfigDTO: Codable {
    var defaultTool: String
    var terminal: String
    var launchCommand: String?
    var hotkey: String?
    var groups: [GroupDTO]
    var tools: [ToolDTO]
    var ides: [IdeDTO]
}

extension Notification.Name {
    static let cmReload = Notification.Name("cmReload")          // re-fetch projects/sessions
    static let cmHotkeyChanged = Notification.Name("cmHotkeyChanged") // re-register the global shortcut
    static let cmActionFailed = Notification.Name("cmActionFailed")   // a fire-and-forget launch/resume failed (object = message)
}

enum AgentctlCLIError: Error { case notFound, failed(String) }

/// Thin client over the `agentctl gui ...` CLI. All real work (config, launching) lives in Node.
enum AgentctlCLI {
    /// Resolve a runnable agentctl. $AGENTCTL_BIN overrides; else probe fixed install paths
    /// for `agentctl`.
    static func invocation() -> String? {
        if let o = ProcessInfo.processInfo.environment["AGENTCTL_BIN"], !o.isEmpty { return o }
        let home = NSHomeDirectory()
        let dirs = ["/Applications/Agentctl.app/Contents/Resources/cli/bin",
                    "/opt/homebrew/bin", "/usr/local/bin", "\(home)/.local/bin"]
        for d in dirs {
            let c = "\(d)/agentctl"
            if FileManager.default.isExecutableFile(atPath: c) { return "'\(c)'" }
        }
        return nil
    }

    /// A GUI app launched from Finder inherits PATH=/usr/bin:/bin:/usr/sbin:/sbin — no Homebrew,
    /// no nvm. The bundled CLI shim is `#!/usr/bin/env node`, so without help it dies with
    /// "env: node: No such file or directory". Sourcing the login profile would fix it and bring
    /// back everything that made `-lc` wrong: latency on every call, and any banner the profile
    /// prints landing in front of the JSON. Find the interpreter instead.
    static func toolPath() -> String {
        let home = NSHomeDirectory()
        var dirs = ["/opt/homebrew/bin", "/usr/local/bin", "\(home)/.local/bin"]
        // nvm keeps versions side by side; newest first, and only ones that actually have node.
        let nvm = "\(home)/.nvm/versions/node"
        if let versions = try? FileManager.default.contentsOfDirectory(atPath: nvm) {
            dirs += versions.sorted(by: >)
                .map { "\(nvm)/\($0)/bin" }
                .filter { FileManager.default.isExecutableFile(atPath: "\($0)/node") }
        }
        dirs += ["/usr/bin", "/bin", "/usr/sbin", "/sbin"]
        let inherited = ProcessInfo.processInfo.environment["PATH"] ?? ""
        return (dirs + (inherited.isEmpty ? [] : [inherited])).joined(separator: ":")
    }

    /// Environment for every child: the inherited one with a PATH that can actually find node.
    private static func childEnvironment() -> [String: String] {
        var env = ProcessInfo.processInfo.environment
        env["PATH"] = toolPath()
        return env
    }

    private static func run(_ args: String) throws -> Data {
        guard let agentctl = invocation() else { throw AgentctlCLIError.notFound }
        let p = Process()
        p.environment = childEnvironment()
        p.executableURL = URL(fileURLWithPath: "/bin/sh")
        // -c, not -lc: sourcing the login profile on every call costs a round trip, and anything
        // it echoes lands in front of the JSON and breaks the decode. `invocation()` already
        // resolved an absolute path, so nothing here needs the profile's PATH. Same call CLAUDE.md
        // makes for the CLI side.
        p.arguments = ["-c", "\(agentctl) gui \(args)"]
        let out = Pipe(); let err = Pipe()
        p.standardOutput = out; p.standardError = err
        // Drain stderr concurrently. Reading stdout to EOF before reaping the child deadlocks the
        // moment the child writes more than a pipe buffer to stderr: it blocks on its own pipe,
        // never exits, and this side waits on an EOF that never comes.
        var errData = Data()
        let errLock = NSLock()
        err.fileHandleForReading.readabilityHandler = { h in
            let chunk = h.availableData
            guard !chunk.isEmpty else { return }
            errLock.lock(); errData.append(chunk); errLock.unlock()
        }
        try p.run()
        let data = out.fileHandleForReading.readDataToEndOfFile()
        p.waitUntilExit()
        err.fileHandleForReading.readabilityHandler = nil
        errLock.lock(); let errText = String(data: errData, encoding: .utf8) ?? ""; errLock.unlock()
        if p.terminationStatus != 0 {
            // The reason is on stdout, not stderr: `agentctl gui` prints {ok:false,error:"…"} and
            // exits non-zero. Reading only stderr turned "unrecognised time: next tuesday" into
            // "exit 4" — the most reachable failure in the app, explained away.
            throw AgentctlCLIError.failed(reason(stdout: data, stderr: errText, status: p.terminationStatus))
        }
        return data
    }

    /// Best available sentence for a failure: the JSON `error` the CLI prints, else its plain
    /// stdout, else stderr, else the bare status.
    private static func reason(stdout: Data, stderr: String, status: Int32) -> String {
        struct Failure: Decodable { let error: String? }
        if let f = try? JSONDecoder().decode(Failure.self, from: stdout), let e = f.error, !e.isEmpty {
            return e
        }
        let out = String(data: stdout, encoding: .utf8)?.trimmingCharacters(in: .whitespacesAndNewlines) ?? ""
        if !out.isEmpty { return out }
        let e = stderr.trimmingCharacters(in: .whitespacesAndNewlines)
        return e.isEmpty ? "exit \(status)" : e
    }

    private static func runAsync<T: Decodable>(_ args: String, _ type: T.Type) async throws -> T {
        try await withCheckedThrowingContinuation { cont in
            DispatchQueue.global().async {
                do {
                    let data = try run(args)
                    cont.resume(returning: try JSONDecoder().decode(T.self, from: data))
                } catch { cont.resume(throwing: error) }
            }
        }
    }

    private static func runVoid(_ args: String) {
        DispatchQueue.global().async {
            do { _ = try run(args) } catch { postFailure(error) }
        }
    }

    /// A fire-and-forget action failed — hop to main and post so the UI can surface it.
    private static func postFailure(_ error: Error) {
        let msg: String
        switch error {
        case AgentctlCLIError.notFound: msg = "agentctl not found. Install it: brew install --cask roypadina/tap/agentctl"
        case AgentctlCLIError.failed(let m): msg = m.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty ? "the action failed." : m
        default: msg = "\(error)"
        }
        DispatchQueue.main.async { NotificationCenter.default.post(name: .cmActionFailed, object: msg) }
    }

    // ── API ──
    static func projects() async throws -> ProjectsResponse { try await runAsync("projects", ProjectsResponse.self) }
    static func sessions() async throws -> [Session] { try await runAsync("sessions", [Session].self) }
    static func terminals() async throws -> TerminalsResponse { try await runAsync("terminals", TerminalsResponse.self) }
    static func peek(id: String) async throws -> [PeekTurn] { try await runAsync("peek --id '\(esc(id))'", [PeekTurn].self) }
    /// Summarize a session via `claude -p` (haiku, cached). Slow on a cache miss — call off the main actor.
    /// `cachedOnly` returns an existing recap instantly (or ok=false) without generating.
    static func recap(id: String, refresh: Bool = false, cachedOnly: Bool = false) async throws -> RecapResponse {
        var flags = ""
        if cachedOnly { flags = " --cached-only" } else if refresh { flags = " --refresh" }
        return try await runAsync("recap --id '\(esc(id))'\(flags)", RecapResponse.self)
    }

    static func launch(dir: String, tool: String) { runVoid("launch --dir '\(esc(dir))' --tool '\(esc(tool))'") }

    /// Update one session annotation. Only the fields you pass are touched; an empty string clears
    /// a field. `flags` replaces the whole set.
    ///
    /// `completion` receives the annotation the CLI already returns, so the caller can patch the
    /// one row it changed. Re-listing every session instead cost a second shell round trip over
    /// hundreds of records, and that window is what let a repeated keypress act on the row that
    /// slid underneath the selection.
    static func annotate(
        id: String, name: String? = nil, note: String? = nil, flags: [String]? = nil,
        labels: [String]? = nil, done: Bool? = nil, hidden: Bool? = nil, deleted: Bool? = nil,
        remind: String? = nil, due: String? = nil,
        completion: ((Annotation?) -> Void)? = nil,
        onFailure: (() -> Void)? = nil
    ) {
        // `--opt=value`, not `--opt value`: the shell quoting is sound either way, but commander
        // refuses a separate value that begins with `-`, and a leading dash is exactly what the
        // terminal menu teaches for removing a flag. `--flags '-todo'` failed with nothing but
        // "argument missing".
        var args = "annotate --id='\(esc(id))'"
        if let name { args += " --name='\(esc(name))'" }
        if let note { args += " --note='\(esc(note))'" }
        if let flags { args += " --flags='\(esc(flags.joined(separator: ",")))'" }
        if let labels { args += " --labels='\(esc(labels.joined(separator: ",")))'" }
        if let done { args += " --done \(done)" }
        if let hidden { args += " --hidden \(hidden)" }
        if let deleted { args += " --deleted \(deleted)" }
        if let remind { args += " --remind='\(esc(remind))'" }
        if let due { args += " --due='\(esc(due))'" }
        DispatchQueue.global().async {
            struct Response: Decodable { let annotation: Annotation? }
            do {
                let data = try run(args)
                let a = (try? JSONDecoder().decode(Response.self, from: data))?.annotation
                DispatchQueue.main.async { completion?(a) }
            } catch {
                postFailure(error)
                // No completion on failure: it used to run regardless, so a failed write raised an
                // alert AND reverted the field behind it, with nothing connecting the two.
                DispatchQueue.main.async { onFailure?() }
            }
        }
    }
    static func profiles() async throws -> [Profile] { try await runAsync("profiles", [Profile].self) }
    /// `profileHome` overrides which Claude account the session resumes under.
    static func resume(id: String, profileHome: String? = nil) {
        var args = "resume --id '\(esc(id))'"
        if let profileHome { args += " --profile '\(esc(profileHome))'" }
        runVoid(args)
    }
    static func configGet() async throws -> ConfigDTO { try await runAsync("config-get", ConfigDTO.self) }

    /// Write the full config (shared with the TUI) by piping JSON to `agentctl gui config-save`.
    /// `completion` runs on the main thread after the write finishes (avoids a read-before-write race).
    /// `completion` runs only on a write that actually succeeded — this is the one place in the
    /// app that can lose typed work, so a failure must never look like a save. `onFailure` gets
    /// the reason and runs on main.
    static func configSave(
        _ dto: ConfigDTO,
        completion: (() -> Void)? = nil,
        onFailure: ((String) -> Void)? = nil
    ) {
        guard let data = try? JSONEncoder().encode(dto) else {
            DispatchQueue.main.async { onFailure?("Could not encode these settings.") }
            return
        }
        DispatchQueue.global().async {
            let failure: String?
            if let agentctl = invocation() {
                let p = Process()
                p.environment = childEnvironment()
                p.executableURL = URL(fileURLWithPath: "/bin/sh")
                p.arguments = ["-c", "\(agentctl) gui config-save"]
                let inp = Pipe(); let out = Pipe(); let err = Pipe()
                p.standardInput = inp; p.standardOutput = out; p.standardError = err
                do {
                    try p.run()
                    inp.fileHandleForWriting.write(data)
                    inp.fileHandleForWriting.closeFile()
                    let o = out.fileHandleForReading.readDataToEndOfFile()
                    p.waitUntilExit()
                    failure = p.terminationStatus == 0 ? nil : reason(
                        stdout: o,
                        stderr: String(data: err.fileHandleForReading.readDataToEndOfFile(), encoding: .utf8) ?? "",
                        status: p.terminationStatus
                    )
                } catch {
                    failure = "\(error)"
                }
            } else {
                failure = "agentctl not found. Install it: brew install --cask roypadina/tap/agentctl"
            }
            DispatchQueue.main.async {
                if let failure { onFailure?(failure) } else { completion?() }
            }
        }
    }

    static func setTerminal(_ value: String, command: String?) {
        var a = "set-terminal '\(esc(value))'"
        if let c = command, !c.isEmpty { a += " --command '\(esc(c))'" }
        runVoid(a)
    }
    static func newDirThenLaunch(base: String, name: String, tool: String) {
        DispatchQueue.global().async {
            do {
                let data = try run("new-dir --base '\(esc(base))' --name '\(esc(name))'")
                guard let obj = try? JSONSerialization.jsonObject(with: data) as? [String: Any],
                      let path = obj["path"] as? String else { postFailure(AgentctlCLIError.failed("couldn’t create the directory")); return }
                _ = try run("launch --dir '\(esc(path))' --tool '\(esc(tool))'")
            } catch { postFailure(error) }
        }
    }

    private static func esc(_ s: String) -> String { s.replacingOccurrences(of: "'", with: "'\\''") }
}

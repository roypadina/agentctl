import SwiftUI

extension Color {
    init(hex: String) {
        let h = hex.hasPrefix("#") ? String(hex.dropFirst()) : hex
        var v: UInt64 = 0
        Scanner(string: h).scanHexInt64(&v)
        if h.count == 6 {
            self = Color(red: Double((v >> 16) & 0xff) / 255, green: Double((v >> 8) & 0xff) / 255, blue: Double(v & 0xff) / 255)
        } else { self = .gray }
    }
}

enum Tab: String, CaseIterable { case new = "New", resume = "Resume" }

/// A New-tab group plus its fuzzy-filtered dirs and the flat-list index of its first dir.
private struct NewSection: Identifiable { let group: Group; let dirs: [Dir]; let start: Int; var id: String { group.id } }

struct ContentView: View {
    var onAction: () -> Void = {}
    var onDetach: (() -> Void)?

    @State private var tab: Tab = ProcessInfo.processInfo.environment["CM_GUI_START_TAB"] == "resume" ? .resume : .new
    @State private var projects: ProjectsResponse?
    @State private var sessions: [Session] = []
    @State private var search = ProcessInfo.processInfo.environment["CM_GUI_SEARCH"] ?? ""
    @State private var selectedTool = ""
    @State private var loading = false
    @State private var sessionsLoaded = false
    /// Set when the scan fails, so the list offers a retry instead of spinning forever.
    @State private var sessionsError: String?
    @State private var errorText: String?
    @State private var showSettings = false
    @State private var showNewDir = false

    // keyboard-driven selection (index into the active tab's flat list)
    @State private var selection = 0
    @State private var confirmResumeId: String?   // cwd-confidence gate: 2nd Enter confirms

    // resume peek split
    @State private var showPeek = ProcessInfo.processInfo.environment["CM_GUI_PEEK"] == "1"
    @State private var peekCache: [String: [PeekTurn]] = [:]
    @State private var peekLoadingId: String?
    @State private var peekFailed: Set<String> = []   // ids whose transcript read failed (don't auto-retry)

    // recap (claude -p · haiku, cached). Cached recaps auto-load on highlight; generation is on-demand.
    @State private var recapCache: [String: String] = [:]
    @State private var recapLoadingId: String?
    @State private var recapError: [String: String] = [:]

    // ── annotation editor (details pane): fields belong to `annEditingId` ──
    @State private var annEditingId: String?
    @State private var annName = ""
    @State private var annFlags = ""
    @State private var annNote = ""
    @State private var annLabels = ""
    /// normal | hidden | deleted — hidden and deleted are listing preferences only.
    @State private var sessionView = "normal"
    @State private var hideDone = false
    /// nil = list both. Tool runs (`claude -p`, the SDK, MCP) crowd out the sessions you sat in.
    @State private var kindFilter: String? = nil
    @State private var annRemind = ""
    @State private var annDue = ""
    /// Session whose resume command was just copied — flips the button to a tick.
    @State private var copiedId: String?
    @State private var profiles: [Profile] = []
    /// Overrides which Claude account a resume uses; nil = the session's own.
    @State private var profileOverride: Profile?

    // ── keyboard shortcuts (see Shortcuts.swift) ──
    /// Focus target inside the annotation editor, so ⌘E lands in the name field.
    @FocusState private var annFocus: AnnField?
    /// Bumped to send focus back to the search field; KeyboardSearchField re-grabs on a change.
    @State private var searchFocusToken = 0
    @State private var showShortcuts = false
    @State private var keyMonitor: Any?
    /// The window hosting THIS copy of the view — the popover and the detached window each have
    /// one, and a local monitor sees keys meant for either.
    @State private var hostWindow: NSWindow?
    /// Whether the name/labels/flags/note fields are showing. The action row never collapses.
    @State private var annExpanded = false
    /// Which of Remind / Due has its `Custom…` field open, if either.
    @State private var customWhen: AnnField?
    /// Measured width of the session list — rows are as wide as it is. The branch drops below
    /// 400pt, which is where a long branch stops fitting beside a path on line 2.
    @State private var listWidth: CGFloat = 0
    /// A session whose write is in flight. The row stays on screen for the whole shell round
    /// trip, so without this a second keypress acts on whatever slides underneath it. It covers
    /// done as well as the shelf: with the done filter on, checking a session off removes its row
    /// exactly as a shelf move does.
    @State private var pendingWriteId: String?
    /// Space-marked sessions. Marks are ids, not indices, so a re-filter cannot move them onto
    /// the wrong rows — the failure that index-based selection had.
    @State private var marked: Set<String> = []
    /// Transient footer message — where a row just went, mostly.
    @State private var footerNote: String?
    @State private var noteToken = 0

    private var query: String { search.trimmingCharacters(in: .whitespaces) }

    private static let isoFrac: ISO8601DateFormatter = {
        let f = ISO8601DateFormatter(); f.formatOptions = [.withInternetDateTime, .withFractionalSeconds]; return f
    }()
    private static let isoPlain: ISO8601DateFormatter = {
        let f = ISO8601DateFormatter(); f.formatOptions = [.withInternetDateTime]; return f
    }()

    // ── derived lists ──
    private var newSections: [(group: Group, dirs: [Dir], start: Int)] {
        var out: [(Group, [Dir], Int)] = []
        var start = 0
        for g in projects?.groups ?? [] {
            let dirs = Fuzzy.rank(query, g.dirs) { "\($0.name)  \($0.path)" }
            if dirs.isEmpty { continue }
            out.append((g, dirs, start))
            start += dirs.count
        }
        return out
    }
    private var newFlat: [Dir] { newSections.flatMap { $0.dirs } }
    private var resumeItems: [Session] {
        // Split out of one expression: the chained + over interpolations blew the
        // type-checker's budget on CI's Swift ("unable to type-check in reasonable time").
        let visible = sessions.filter { inSessionView($0) && passesDoneFilter($0) && passesKindFilter($0) }
        return Fuzzy.rank(query, visible) { s -> String in
            let tags: String = s.tags.map { "#" + $0 }.joined(separator: " ")
            let tickets: String = s.tickets.joined(separator: " ")
            let note: String = s.note ?? ""
            return "\(s.name)  \(tilde(s.cwd))  \(s.id)  \(tags)  \(tickets)  \(note)"
        }
    }
    private var count: Int { tab == .new ? newFlat.count : resumeItems.count }
    private var selIndex: Int { min(max(0, selection), max(0, count - 1)) }
    private var selectedSession: Session? {
        guard tab == .resume, selIndex < resumeItems.count else { return nil }
        return resumeItems[selIndex]
    }

    /// Side by side only where both halves can honour their minimums. Below that the details
    /// become a bottom drawer — the terminal menu's own geometry, and the shape that removes the
    /// over-constrained split rather than papering over it.
    private var resumeBody: some View {
        GeometryReader { geo in
            if !showPeek {
                resumeList
            } else if geo.size.width >= 601 {
                // 300 + 1 divider + 300. The threshold must never be below the sum of the
                // branch's own minimums, or the branch is entered and then clips below them —
                // which is the whole bug this drawer exists to remove.
                HSplitView {
                    resumeList.frame(minWidth: 300)
                    peekPane.frame(minWidth: 300, idealWidth: 340)
                }
            } else {
                VStack(spacing: 8) {
                    resumeList.frame(minHeight: 150)
                    Divider()
                    peekPane.frame(height: min(max(220, geo.size.height * 0.48), 320))
                }
            }
        }
    }

    /// A menu-bar app has no menu bar, so the one line of chrome that says the keyboard exists.
    private var footerHint: some View {
        HStack(spacing: 0) {
            Text(footerNote
                 ?? (tab == .resume && !marked.isEmpty
                     ? "✓ \(marked.count) marked   ·   ⌘D done · ⇧⌘H hide · ⌘⌫ delete   ·   ⇧⌘M clear"
                     : tab == .new ? "⏎ open   ·   ⇧⇥ tool   ·   ⌘/ shortcuts"
                     : showPeek ? "⏎ resume   ·   ⌘P close   ·   ⌘/ shortcuts"
                                : "⏎ resume   ·   ⌘P details   ·   ⌘/ shortcuts"))
                .font(.system(size: 11, design: .monospaced))
                .foregroundColor(footerNote != nil || !marked.isEmpty ? Tone.warn : .secondary)
                .lineLimit(1).truncationMode(.tail)
            Spacer(minLength: 4)
            Button { showShortcuts = true } label: { Image(systemName: "questionmark.circle").font(.system(size: 11)) }
                .buttonStyle(.borderless).foregroundColor(.secondary)
                .help("Keyboard shortcuts  (⌘/)").accessibilityLabel("Keyboard shortcuts")
        }
    }

    var body: some View {
        VStack(spacing: 8) {
            header
            if let e = errorText {
                Label(e, systemImage: "exclamationmark.triangle.fill")
                    .font(.caption).foregroundColor(Tone.alarm).lineLimit(3)
            }
            if tab == .new {
                newList
            } else {
                resumeBody
            }
            footerHint
        }
        .padding(12)
        .frame(minWidth: 380, idealWidth: 460, maxWidth: .infinity, minHeight: 420, idealHeight: 560, maxHeight: .infinity)
        .background(WindowReader { hostWindow = $0 })
        .task { await loadAll() }
        .onAppear(perform: installKeyMonitor)
        .onDisappear(perform: removeKeyMonitor)
        .sheet(isPresented: $showShortcuts) { ShortcutsSheet { showShortcuts = false } }
        .onChange(of: search) { _ in selection = 0; confirmResumeId = nil }
        // Keep the annotation editor pointed at whatever row is actually selected.
        .onChange(of: selectedSession?.id) { id in loadAnnotationFields(id: id) }
        .onAppear { loadAnnotationFields(id: selectedSession?.id) }
        .onChange(of: tab) { _ in selection = 0; confirmResumeId = nil }
        .onReceive(NotificationCenter.default.publisher(for: .cmReload)) { _ in Task { await reload() } }
        .sheet(isPresented: $showSettings) { SettingsView(onSaved: { Task { await reload() } }) }
        .sheet(isPresented: $showNewDir) {
            NewDirView(groups: projects?.groups ?? [], tool: selectedTool) { onAction() }
        }
    }

    // ── header ──
    private var header: some View {
        VStack(spacing: 6) {
            HStack {
                Picker("", selection: $tab) {
                    ForEach(Tab.allCases, id: \.self) { Text($0.rawValue).tag($0) }
                }
                .pickerStyle(.segmented).labelsHidden().fixedSize()
                .accessibilityLabel("New or Resume")
                Spacer()
                if tab == .resume {
                    Button { showPeek.toggle() } label: {
                        Image(systemName: "sidebar.right").symbolVariant(showPeek ? .fill : .none)
                    }
                        .buttonStyle(.borderless).help(showPeek ? "Hide the details  (⌘P)" : "Show the details  (⌘P)")
                        .keyboardShortcut("p", modifiers: .command)
                        .accessibilityLabel("Toggle transcript preview")
                }
                if let onDetach = onDetach {
                    Button(action: onDetach) { Image(systemName: "macwindow") }.buttonStyle(.borderless).help("Open in a window")
                }
                if tab == .resume {
                    Menu {
                        Button("Listed") { sessionView = "normal"; selection = 0 }
                        Button("Hidden") { sessionView = "hidden"; selection = 0 }
                        Button("Deleted") { sessionView = "deleted"; selection = 0 }
                        Divider()
                        Button(hideDone ? "Show done sessions" : "Hide done sessions") {
                            hideDone.toggle(); selection = 0
                        }
                        Divider()
                        Button("All runs") { kindFilter = nil; selection = 0 }
                        Button("Interactive only") { kindFilter = "interactive"; selection = 0 }
                        Button("Tool runs only") { kindFilter = "tool"; selection = 0 }
                    } label: {
                        Image(systemName: sessionView == "deleted" ? "trash"
                                        : sessionView == "hidden" ? "eye.slash"
                                        : kindFilter == "tool" ? "terminal"
                                        : kindFilter == "interactive" ? "person" : "list.bullet")
                    }
                    .menuStyle(.borderlessButton).fixedSize()
                    .foregroundColor(sessionView != "normal" || kindFilter != nil || hideDone ? Tone.warn : .secondary)
                    .help("Which sessions to list: normal, hidden or deleted; interactive or tool runs")
                }
                Button { showSettings = true } label: { Image(systemName: "gearshape") }.buttonStyle(.borderless).help("Settings")
            }
            KeyboardSearchField(
                text: $search,
                placeholder: tab == .new ? "Filter projects" : "Search sessions",
                focusRequest: searchFocusToken,
                onMoveUp: { move(-1) },
                onMoveDown: { move(1) },
                onSubmit: activate,
                onCancel: cancel,
                onTab: { tab = tab == .new ? .resume : .new },
                onShiftTab: { if tab == .new { cycleTool() } else { tab = .new } },
                onPageUp: { move(-8) },
                onPageDown: { move(8) },
                onHome: { selection = 0; confirmResumeId = nil },
                onEnd: { selection = max(0, count - 1); confirmResumeId = nil }
            )
        }
    }

    // ── New ──
    private var newList: some View {
        VStack(spacing: 6) {
            ScrollViewReader { proxy in
                ScrollView {
                    LazyVStack(alignment: .leading, spacing: 1) {
                        ForEach(newSections, id: \.group.id) { sec in
                            Text(sec.group.name).font(.caption).bold().foregroundColor(Color(hex: sec.group.color))
                                .padding(.top, 6)
                            ForEach(Array(sec.dirs.enumerated()), id: \.element.id) { i, d in
                                dirRow(d, index: sec.start + i).id(sec.start + i)
                            }
                        }
                        if projects == nil {
                            HStack(spacing: 6) {
                                ProgressView().controlSize(.small)
                                Text("Reading your project folders…").font(.system(size: 11)).foregroundColor(.secondary)
                            }.padding()
                        } else if newFlat.isEmpty {
                            if projects?.groups.isEmpty ?? true {
                                VStack(alignment: .leading, spacing: 6) {
                                    Text("No project groups yet.").font(.system(size: 11))
                                    Text("Groups tell agentctl where your projects live.")
                                        .font(.system(size: 11)).foregroundColor(.secondary)
                                    Button("Open Settings") { showSettings = true }.font(.system(size: 11))
                                }.padding()
                            } else if query.isEmpty {
                                emptyState("No project folders under these groups.")
                            } else {
                                emptyState("No projects match “\(query)”.  Esc clears the search.")
                            }
                        }
                    }
                }
                .onChange(of: selection) { _ in withAnimation(.easeOut(duration: 0.12)) { proxy.scrollTo(selIndex, anchor: .center) } }
            }
            HStack {
                Button { showNewDir = true } label: { Label("New dir", systemImage: "plus") }.buttonStyle(.borderless)
                Spacer()
                if let tools = projects?.tools, !tools.isEmpty, !selectedTool.isEmpty {
                    Picker("", selection: $selectedTool) {
                        ForEach(tools) { Text($0.name).tag($0.name) }
                    }.labelsHidden().frame(width: 110).help("Tool to launch (⇧⇥)")
                }
            }
        }
    }

    private func dirRow(_ d: Dir, index: Int) -> some View {
        let sel = index == selIndex
        return Button { selection = index; Cm.launch(dir: d.path, tool: selectedTool); onAction() } label: {
            HStack {
                Text(d.name).fontWeight(sel ? .semibold : .regular)
                if let b = d.branch { Text("⎇ \(b)").font(.caption2).foregroundColor(Tone.branch) }
                Spacer()
                Text(age(d.timeMs)).font(.caption2).foregroundColor(.secondary)
            }
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .padding(.vertical, 3).padding(.horizontal, 6)
        .background(rowBackground(sel))
        .accessibilityLabel("\(d.name)\(d.branch.map { ", branch \($0)" } ?? "")")
    }

    // ── Resume ──
    private var resumeList: some View {
        ScrollViewReader { proxy in
            ScrollView {
                LazyVStack(alignment: .leading, spacing: 1) {
                    ForEach(Array(resumeItems.enumerated()), id: \.element.id) { i, s in
                        sessionRow(s, index: i).id(i)
                    }
                    if let err = sessionsError {
                        VStack(alignment: .leading, spacing: 6) {
                            Text("Can't read your sessions.").font(.system(size: 11))
                            Text(err).font(.caption2).foregroundColor(.secondary).lineLimit(4)
                            Button("Try again") { sessionsError = nil; Task { await refreshSessions() } }
                                .font(.caption2)
                        }.padding()
                    } else if !sessionsLoaded {
                        HStack(spacing: 6) { ProgressView().controlSize(.small); Text("Scanning sessions…").font(.system(size: 11)).foregroundColor(.secondary) }.padding()
                    } else if resumeItems.isEmpty {
                        emptyState(emptyResumeCopy)
                    }
                }
            }
            .onChange(of: selection) { _ in withAnimation(.easeOut(duration: 0.12)) { proxy.scrollTo(selIndex, anchor: .center) } }
            .task(id: tab) { if tab == .resume { await loadSessions() } }
            .background(GeometryReader { g in
                Color.clear.preference(key: ListWidthKey.self, value: g.size.width)
            })
            .onPreferenceChange(ListWidthKey.self) { listWidth = $0 }
        }
    }

    /// Name, labels, flags and note — plus the three things you *do* to a session. Those are three
    /// different species of act, so they get three zones rather than one row of identical buttons:
    /// a state you check off, two setters that show what they are set to, and a place in the lists.
    /// Fields commit on ⏎; the controls commit immediately.
    @ViewBuilder
    private func annotationEditor(_ s: Session) -> some View {
        VStack(alignment: .leading, spacing: 4) {
            actionRow(s)
            if let field = customWhen { customWhenField(s, field) }
            summaryLine(s)
            if annExpanded {
            TextField("name this session", text: $annName)
                .textFieldStyle(.roundedBorder).font(.caption2)
                .focused($annFocus, equals: .name)
                .onSubmit { Cm.annotate(id: s.id, name: annName) { applyAnnotation(s.id, $0) } }
            TextField("labels — ticket, repo, topic (RD-12345, catalog)", text: $annLabels)
                .textFieldStyle(.roundedBorder).font(.caption2)
                .focused($annFocus, equals: .labels)
                .onSubmit {
                    let list = annLabels.split(separator: ",").map { $0.trimmingCharacters(in: .whitespaces) }
                    Cm.annotate(id: s.id, labels: list.filter { !$0.isEmpty }) { applyAnnotation(s.id, $0) }
                }
            TextField("flags, comma separated (todo, later…)", text: $annFlags)
                .textFieldStyle(.roundedBorder).font(.caption2)
                .focused($annFocus, equals: .flags)
                .onSubmit {
                    let list = annFlags.split(separator: ",").map { $0.trimmingCharacters(in: .whitespaces) }
                    Cm.annotate(id: s.id, flags: list.filter { !$0.isEmpty }) { applyAnnotation(s.id, $0) }
                }
            // single-line: TextField(text:axis:) and lineLimit(range) are macOS 13+, this app targets 12
            TextField("note", text: $annNote)
                .textFieldStyle(.roundedBorder).font(.caption2)
                .focused($annFocus, equals: .note)
                .onSubmit { Cm.annotate(id: s.id, note: annNote) { applyAnnotation(s.id, $0) } }
            }
        }
    }

    /// What you have already said about this session, in one line, with the way in. The fields
    /// collapse; the actions above them never do.
    @ViewBuilder
    private func summaryLine(_ s: Session) -> some View {
        HStack(spacing: 6) {
            let bits = s.tickets.map { "#" + $0 } + s.tags.map { "⚑" + $0 }
                + (s.note.map { ["“" + $0.replacingOccurrences(of: "\n", with: " ") + "”"] } ?? [])
            if bits.isEmpty {
                Text("Add a name or note").font(.system(size: 11)).foregroundColor(.secondary)
            } else {
                Text(bits.joined(separator: "  "))
                    .font(.system(size: 11, design: .monospaced))
                    .foregroundColor(.secondary).lineLimit(1).truncationMode(.tail)
            }
            Spacer(minLength: 4)
            Button(annExpanded ? "Close" : "Edit") { annExpanded.toggle() }
                .font(.system(size: 11)).buttonStyle(.borderless)
                .help(annExpanded ? "Hide the fields" : "Name, labels, flags and note  (⌘E)")
        }
    }

    /// Done · when · where. One row at every reachable width: the pane's floor is 300pt (the
    /// split's own minimum, and the drawer is full-width), and this row's worst case is 278.8pt
    /// with both setters showing a value. The wrapping variant it used to carry was dead code.
    private func actionRow(_ s: Session) -> some View {
        HStack(spacing: 8) {
            doneToggle(s)
            whenMenu(s, .remind)
            whenMenu(s, .due)
            Spacer(minLength: 0)
            shelfButtons(s)
        }
    }

    /// The platform's own two-state display. A checkbox reads as checked without swapping its
    /// label, which the old "Mark done" → "Done" button could not.
    private func doneToggle(_ s: Session) -> some View {
        Toggle("Done", isOn: Binding(
            get: { s.isDone },
            set: { on in Cm.annotate(id: s.id, done: on) { applyAnnotation(s.id, $0) } }
        ))
        .toggleStyle(.checkbox)
        .font(.caption)
        .help(s.isDone ? "Reopen this session" : "Mark this session finished — also silences its reminder")
    }

    /// A setter shows its verb when empty and its value when set, so the control doubles as the
    /// display and there is no separate badge to keep in sync.
    private func whenMenu(_ s: Session, _ which: AnnField) -> some View {
        let isRemind = which == .remind
        let iso = isRemind ? s.remindAt : s.dueAt
        let live = isRemind ? s.isReminderDue : s.isOverdue
        let presets = isRemind ? ["1h", "3h", "tomorrow 9am", "3d"] : ["today 17:00", "tomorrow 17:00", "3d", "1w"]
        return Menu {
            ForEach(presets, id: \.self) { w in
                Button(isRemind ? "in \(w)" : w) { setWhen(s, which, w) }
            }
            Divider()
            Button("Custom…") { openCustomWhen(s, which) }
            if iso != nil { Button(isRemind ? "Clear reminder" : "Clear due date") { setWhen(s, which, "") } }
        } label: {
            Label(whenLabel(iso, verb: isRemind ? "Remind" : "Due"),
                  systemImage: isRemind ? "bell" : "calendar")
        }
        .font(.caption2).menuStyle(.borderlessButton).fixedSize()
        .foregroundColor(live ? Tone.alarm : .secondary)
        .help(isRemind ? "Flag this session in the picker at a chosen time"
                       : "When the work in this session is actually due")
    }

    /// Two plain buttons saying what they do. This was a single picker labelled with the shelf
    /// the session sits on — a better model, and one nobody could find: asked twice where hide
    /// and delete were, with the control on screen both times. Naming the act beats naming the
    /// state. Still not red and still no trash can: nothing here destroys anything, and the
    /// button says so when you hover it.
    @ViewBuilder
    private func shelfButtons(_ s: Session) -> some View {
        HStack(spacing: 8) {
            if s.isDeleted || s.isHidden {
                Text(s.isDeleted ? "Deleted" : "Hidden")
                    .font(.system(size: 11, design: .monospaced)).foregroundColor(Tone.warn)
            }
            Button {
                moveToShelf(s, s.isHidden ? "Listed" : "Hidden")
            } label: {
                Label(s.isHidden ? "Unhide" : "Hide", systemImage: s.isHidden ? "eye" : "eye.slash")
            }
            .font(.system(size: 11)).buttonStyle(.borderless)
            .foregroundColor(s.isHidden ? Tone.warn : .secondary)
            .help(s.isHidden ? "Put it back in the normal list  (⇧⌘H)"
                             : "Keep it out of the normal list — it stays under ≣ → Hidden. The transcript is never touched.  (⇧⌘H)")

            Button {
                moveToShelf(s, s.isDeleted ? "Listed" : "Deleted")
            } label: {
                Label(s.isDeleted ? "Restore" : "Delete",
                      systemImage: s.isDeleted ? "arrow.uturn.backward" : "archivebox")
            }
            .font(.system(size: 11)).buttonStyle(.borderless)
            .foregroundColor(s.isDeleted ? Tone.warn : .secondary)
            .help(s.isDeleted ? "Put it back in the lists  (⌘X)"
                              : "Take it out of every list — recoverable from ≣ → Deleted, and the transcript is never touched.  (⌘X)")
        }
    }

    /// The transient field behind `Custom…` (and ⌘T / ⌘U): everything the CLI parses, costing no
    /// height until it is asked for.
    private func customWhenField(_ s: Session, _ which: AnnField) -> some View {
        TextField("2h · 3d · tomorrow 9am · 17:00 · an ISO date",
                  text: which == .remind ? $annRemind : $annDue)
            .textFieldStyle(.roundedBorder).font(.caption2)
            .focused($annFocus, equals: which)
            .onSubmit {
                setWhen(s, which, which == .remind ? annRemind : annDue)
                customWhen = nil
            }
    }

    private func setWhen(_ s: Session, _ which: AnnField, _ value: String) {
        if which == .remind { Cm.annotate(id: s.id, remind: value) { applyAnnotation(s.id, $0) } }
        else { Cm.annotate(id: s.id, due: value) { applyAnnotation(s.id, $0) } }
    }

    private func openCustomWhen(_ s: Session, _ which: AnnField) {
        annRemind = ""; annDue = ""
        customWhen = which
        DispatchQueue.main.async { annFocus = which }
    }

    private func moveToShelf(_ s: Session, _ shelf: String) {
        guard pendingWriteId == nil else { return }
        pendingWriteId = s.id
        Cm.annotate(id: s.id, hidden: shelf == "Hidden", deleted: shelf == "Deleted", completion: {
            pendingWriteId = nil
            applyAnnotation(s.id, $0)
        }, onFailure: { pendingWriteId = nil })
        // Choosing anything but Listed makes the row vanish from the view you are looking at, so
        // say where it went rather than letting it appear to have been destroyed.
        switch shelf {
        case "Hidden":  flashNote("Hid “\(s.name)” — see it under ≣ → Hidden.")
        case "Deleted": flashNote("Deleted “\(s.name)” — restore it from ≣ → Deleted.")
        default:        flashNote("“\(s.name)” is back in the list.")
        }
    }

    /// A footer note that clears itself. `noteToken` guards against an earlier note's timer
    /// wiping a later one.
    private func flashNote(_ text: String) {
        noteToken += 1
        let mine = noteToken
        footerNote = text
        DispatchQueue.main.asyncAfter(deadline: .now() + 4) {
            if noteToken == mine { footerNote = nil }
        }
    }

    /// "Remind" when nothing is set, the value itself once it is — "◆ 2h" beats "Remind" plus a
    /// badge somewhere else on screen.
    private func whenLabel(_ iso: String?, verb: String) -> String {
        guard let iso, let d = ContentView.isoFrac.date(from: iso) ?? ContentView.isoPlain.date(from: iso) else { return verb }
        let df = DateFormatter(); df.locale = Locale(identifier: "en_US_POSIX")
        let days = d.timeIntervalSinceNow / 86_400
        df.dateFormat = days < 1 && days > -1 ? "HH:mm" : days < 7 && days > 0 ? "E HH:mm" : "d MMM"
        return df.string(from: d)
    }

    /// Pull a session's annotation into the editor fields — once per session, so it never
    /// overwrites what is being typed. Always called with the row that is actually selected.
    private func loadAnnotationFields(id: String?) {
        guard let id, annEditingId != id, let s = sessions.first(where: { $0.id == id }) else { return }
        annEditingId = id
        annExpanded = false
        annName = s.name
        annFlags = s.tags.joined(separator: ", ")
        annLabels = s.tickets.joined(separator: ", ")
        annNote = s.note ?? ""
        annRemind = ""
        annDue = ""
        customWhen = nil
        copiedId = nil
    }

    /// Hidden and deleted never leave the transcript — they only drop out of listings here.
    private func inSessionView(_ s: Session) -> Bool {
        switch sessionView {
        case "hidden":  return s.isHidden && !s.isDeleted
        case "deleted": return s.isDeleted
        default:        return !s.isHidden && !s.isDeleted
        }
    }

    private func passesDoneFilter(_ s: Session) -> Bool { !(hideDone && s.isDone) }

    /// Interactive session or tool-driven run — see the `kind` field on Session.
    private func passesKindFilter(_ s: Session) -> Bool {
        guard let k = kindFilter else { return true }
        return k == "tool" ? s.isToolRun : !s.isToolRun
    }

    /// The same glyphs the terminal menu uses, in the same order, as one monospaced cell each —
    /// so the clusters line up down the list like a column instead of reading as a sticker
    /// collection. Status is the only dot and the only routinely coloured thing here; colour
    /// inside the cluster fires only for done and for time pressure.
    @ViewBuilder
    private func annotationBadges(_ s: Session) -> some View {
        HStack(spacing: 0) {
            if s.isToolRun {
                glyph("▸", .secondary, "Started by a tool, not by you" + (s.entrypoint.map { " (\($0))" } ?? ""))
            }
            if s.isDone { glyph("✓", Tone.ok, "Done") }
            if !s.tags.isEmpty { glyph("⚑", .secondary, s.tags.map { "#" + $0 }.joined(separator: " ")) }
            if let n = s.note { glyph("✎", .secondary, n) }
            if s.remindAt != nil {
                glyph("◆", s.isReminderDue ? Tone.alarm : .secondary, s.isReminderDue ? "Reminder due" : "Reminder set")
            }
            if s.dueAt != nil {
                glyph("✱", s.isOverdue ? Tone.alarm : .secondary, s.isOverdue ? "Overdue" : "Has a due date")
            }
        }
    }

    private func glyph(_ ch: String, _ color: Color, _ help: String) -> some View {
        Text(ch)
            .font(.system(size: 11, design: .monospaced))
            .foregroundColor(color)
            .help(help)
            .accessibilityLabel(help)
    }

    private func sessionRow(_ s: Session, index: Int) -> some View {
        let sel = index == selIndex
        let confirming = confirmResumeId == s.id && sel
        return Button { selection = index; resumeSession(s) } label: {
            VStack(alignment: .leading, spacing: 1) {
                HStack(spacing: 6) {
                    if marked.contains(s.id) {
                        Text("✓").font(.system(size: 11, weight: .bold, design: .monospaced))
                            .foregroundColor(Tone.ok).help("Marked — ⌘D, ⇧⌘H and ⌘⌫ act on every marked session")
                    }
                    Image(systemName: "circle.fill").font(.system(size: 9)).foregroundColor(statusColor(s.status))
                        .help(statusText(s.status)).accessibilityLabel(statusText(s.status))
                    if !s.cwdConfident {
                        Image(systemName: "exclamationmark.triangle.fill").font(.caption2).foregroundColor(Tone.warn)
                            .help("cwd uncertain — confirm before resuming")
                    }
                    Text(s.name).font(.system(size: 13))
                        .fontWeight(sel ? .semibold : .regular).lineLimit(1)
                        .layoutPriority(1)
                    annotationBadges(s)
                    Spacer(minLength: 4)
                    Text(age(isoMs(s.lastUpdatedAt)))
                        .font(.system(size: 11, design: .monospaced))
                        .foregroundColor(.secondary)
                }
                HStack(spacing: 4) {
                    Text(tilde(s.cwd))
                        .font(.system(size: 11, design: .monospaced))
                        .foregroundColor(.secondary)
                        .lineLimit(1).truncationMode(.middle)
                    if let b = s.gitBranch, listWidth == 0 || listWidth >= 400 {
                        Text("· ⎇ \(b)")
                            .font(.system(size: 11, design: .monospaced))
                            .foregroundColor(Tone.branch)
                            .lineLimit(1).layoutPriority(-1)
                    }
                }
                if confirming {
                    Text("Working directory is a guess — ⏎ again resumes there anyway · esc cancels")
                        .font(.system(size: 11)).foregroundColor(Tone.warn)
                }
            }
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .padding(.vertical, 3).padding(.horizontal, 6)
        .opacity(pendingWriteId == s.id ? 0.4 : 1)
        .background(rowBackground(sel))
        .accessibilityLabel("\(s.name), \(statusText(s.status)), \(tilde(s.cwd))")
        .contextMenu {
            Button(marked.contains(s.id) ? "Unmark" : "Mark") {
                if marked.contains(s.id) { marked.remove(s.id) } else { marked.insert(s.id) }
            }
            Divider()
            Button(s.isDone ? "Not done" : "Done") {
                Cm.annotate(id: s.id, done: !s.isDone) { applyAnnotation(s.id, $0) }
            }
            Divider()
            Button("Listed") { moveToShelf(s, "Listed") }
            Button("Hidden") { moveToShelf(s, "Hidden") }
            Button("Deleted") { moveToShelf(s, "Deleted") }
            Divider()
            Button("Copy resume command") {
                NSPasteboard.general.clearContents()
                NSPasteboard.general.setString("agentctl resume \(s.id)", forType: .string)
                copiedId = s.id
            }
        }
    }

    // ── peek pane (Resume split) ──
    private var peekPane: some View {
        VStack(alignment: .leading, spacing: 6) {
            if let s = selectedSession {
                // ── identity ──
                HStack(alignment: .firstTextBaseline, spacing: 6) {
                    Text(s.name).font(.system(size: 13, weight: .semibold)).lineLimit(2)
                    Spacer(minLength: 4)
                    Image(systemName: "circle.fill").font(.system(size: 7)).foregroundColor(statusColor(s.status))
                    Text(statusText(s.status)).font(.system(size: 11)).foregroundColor(.secondary)
                }
                // ── facts: one machine-text plate, read as a block ──
                VStack(alignment: .leading, spacing: 2) {
                    HStack(spacing: 6) {
                        if let b = s.gitBranch {
                            Text("⎇ \(b)").font(.system(size: 11, design: .monospaced)).foregroundColor(Tone.branch)
                        }
                        Text(tilde(s.cwd))
                            .font(.system(size: 11, design: .monospaced)).foregroundColor(.secondary)
                            .lineLimit(1).truncationMode(.middle).textSelection(.enabled)
                    }
                    if let launched = s.launchCwd, launched != s.cwd {
                        Text("launched in \(tilde(launched))")
                            .font(.system(size: 11, design: .monospaced)).foregroundColor(.secondary)
                            .lineLimit(1).truncationMode(.middle)
                    }
                    HStack(spacing: 6) {
                        Text(String(s.id.prefix(8)))
                            .font(.system(size: 11, design: .monospaced))
                            .foregroundColor(.secondary).textSelection(.enabled)
                        Button {
                            // `agentctl resume` restores the working directory and the account too
                            NSPasteboard.general.clearContents()
                            NSPasteboard.general.setString("agentctl resume \(s.id)", forType: .string)
                            copiedId = s.id
                        } label: {
                            Image(systemName: copiedId == s.id ? "checkmark" : "doc.on.doc").font(.system(size: 10))
                        }
                        .buttonStyle(.borderless)
                        .foregroundColor(copiedId == s.id ? Tone.ok : .secondary)
                        .help("Copy `agentctl resume \(s.id)` — paste it in any terminal to pick this session back up")
                        .accessibilityLabel("Copy resume command")
                        Text(spanLine(s)).font(.system(size: 11, design: .monospaced)).foregroundColor(.secondary)
                    }
                    // Only surfaced on machines that actually have more than one Claude account.
                    if profiles.count > 1, let acct = profileOverride?.account ?? s.account {
                        HStack(spacing: 4) {
                            Text("resumes as").font(.system(size: 11)).foregroundColor(.secondary)
                            Menu {
                                Button("This session's own account") { profileOverride = nil }
                                Divider()
                                ForEach(profiles) { p in
                                    Button(p.account + (p.isPrimary ? "  (default)" : "")) { profileOverride = p }
                                }
                            } label: {
                                Text(acct).font(.system(size: 11, design: .monospaced))
                            }
                            .menuStyle(.borderlessButton).fixedSize()
                            .foregroundColor(profileOverride == nil ? .accentColor : Tone.warn)
                            .help("Which Claude account this session resumes under  (⇧⌘A)")
                        }
                    }
                    if !s.cwdConfident {
                        Text("! the working directory is a guess")
                            .font(.system(size: 11)).foregroundColor(Tone.warn)
                    }
                }
                .padding(.top, 2)
                annotationEditor(s)
                // ── recap ──
                HStack(spacing: 6) {
                    Text("Recap").font(.system(size: 11, weight: .semibold)).foregroundColor(.secondary)
                    if recapLoadingId == s.id { ProgressView().controlSize(.small) }
                    Spacer()
                    Button("Generate recap") {
                        generateRecap(s.id, refresh: recapCache[s.id] != nil)
                    }
                    .font(.system(size: 11)).buttonStyle(.borderless).disabled(recapLoadingId == s.id)
                    .help("Summarize this session with claude -p (haiku). Generating again replaces it.  (⌘R)")
                }
                if let err = recapError[s.id] {
                    HStack(alignment: .top, spacing: 6) {
                        Text(err).font(.system(size: 11)).foregroundColor(Tone.alarm).lineLimit(3)
                        Button("Try again") { generateRecap(s.id, refresh: true) }.font(.system(size: 11))
                    }
                } else if let t = recapCache[s.id] {
                    Text(t).font(.system(size: 11)).foregroundColor(.primary)
                        .textSelection(.enabled).fixedSize(horizontal: false, vertical: true)
                } else if recapLoadingId == s.id {
                    Text("Summarizing with claude (haiku)…").font(.system(size: 11)).foregroundColor(.secondary)
                } else {
                    Text("Generate a recap to see what this session was doing.")
                        .font(.system(size: 11)).foregroundColor(.secondary)
                }
                Divider()
                // ── transcript ──
                if peekLoadingId == s.id {
                    HStack(spacing: 6) { ProgressView().controlSize(.small); Text("Loading transcript…").font(.system(size: 11)).foregroundColor(.secondary) }
                } else if peekFailed.contains(s.id) {
                    // A failed read used to be permanent — nothing cleared the id again.
                    HStack(spacing: 6) {
                        Text("Can't read this transcript.").font(.system(size: 11)).foregroundColor(.secondary)
                        Button("Try again") {
                            peekFailed.remove(s.id)
                            Task { await loadPeek() }   // .task keys on the id, which has not changed
                        }.font(.system(size: 11))
                    }
                } else if let turns = peekCache[s.id] {
                    if turns.isEmpty {
                        Text("No messages yet.").font(.system(size: 11)).foregroundColor(.secondary)
                    } else {
                        ScrollView {
                            LazyVStack(alignment: .leading, spacing: 3) {
                                ForEach(Array(turns.enumerated()), id: \.offset) { _, t in
                                    HStack(alignment: .top, spacing: 4) {
                                        Text("[\(t.role)]").font(.system(size: 10, design: .monospaced)).foregroundColor(roleColor(t.role))
                                        Text(t.text).font(.system(size: 11, design: .monospaced)).foregroundColor(.primary).lineLimit(4)
                                    }
                                }
                            }
                        }
                    }
                } else {
                    Color.clear
                }
            }
            Spacer(minLength: 0)
        }
        .frame(maxWidth: .infinity)
        // Debounced transcript fetch + instant cached-recap load when the selection settles.
        .task(id: selectedSession?.id) {
            await loadPeek()
            if let id = selectedSession?.id { loadCachedRecap(id) }
        }
    }

    private func loadPeek() async {
        guard let s = selectedSession, peekCache[s.id] == nil, !peekFailed.contains(s.id) else { return }
        try? await Task.sleep(nanoseconds: 300_000_000)
        if Task.isCancelled { return }
        peekLoadingId = s.id
        do {
            let turns = try await Cm.peek(id: s.id)
            if Task.isCancelled { return }
            peekCache[s.id] = turns
        } catch {
            peekFailed.insert(s.id)
        }
        peekLoadingId = nil
    }

    /// Pull an already-cached recap (instant, never generates) when a row is highlighted.
    private func loadCachedRecap(_ id: String) {
        if recapCache[id] != nil || recapLoadingId == id { return }
        Task {
            if let r = try? await Cm.recap(id: id, cachedOnly: true), r.ok, let t = r.text {
                await MainActor.run { recapCache[id] = t }
            }
        }
    }

    /// Generate (or refresh) a recap on demand — this spawns `claude -p` so it can take seconds.
    private func generateRecap(_ id: String, refresh: Bool) {
        if recapLoadingId == id { return }
        recapLoadingId = id
        recapError[id] = nil
        Task {
            do {
                let r = try await Cm.recap(id: id, refresh: refresh)
                await MainActor.run {
                    if r.ok, let t = r.text { recapCache[id] = t } else { recapError[id] = r.error ?? "recap failed" }
                    if recapLoadingId == id { recapLoadingId = nil }
                }
            } catch {
                await MainActor.run {
                    recapError[id] = describe(error)
                    if recapLoadingId == id { recapLoadingId = nil }
                }
            }
        }
    }

    // ── ⌘-shortcuts ──
    // The search field owns every plain keystroke, so commands need ⌘. A local monitor rather
    // than `.keyboardShortcut` on the buttons: most of these act on the selected session whether
    // or not the details pane that holds those buttons is on screen.
    private func installKeyMonitor() {
        guard keyMonitor == nil else { return }
        keyMonitor = NSEvent.addLocalMonitorForEvents(matching: .keyDown) { e in
            handleShortcut(e) ? nil : e
        }
    }

    private func removeKeyMonitor() {
        if let m = keyMonitor { NSEvent.removeMonitor(m); keyMonitor = nil }
    }

    private func handleShortcut(_ e: NSEvent) -> Bool {
        // Claim a key only for the surface it was typed into. When the host window is not known
        // yet, fall back to the key window rather than dropping the key: a nil here used to
        // disable the entire keyboard layer silently.
        if let host = hostWindow {
            guard e.window === host else { return false }
        } else {
            guard e.window != nil, e.window === NSApp.keyWindow else { return false }
        }
        guard !showSettings, !showNewDir else { return false }

        let mods = e.modifierFlags.intersection(.deviceIndependentFlagsMask)
        guard mods.contains(.command), !mods.contains(.control), !mods.contains(.option) else { return false }
        let shift = mods.contains(.shift)

        // Read before the sheet guard: ⌘/ has to be able to close what it opened.
        if e.charactersIgnoringModifiers == "/" { showShortcuts.toggle(); return true }
        guard !showShortcuts else { return false }

        // ⌘⌫ — Finder's "move to trash". Here it only takes the session out of the lists.
        if e.keyCode == 51 && !shift { return annotateSelected { s in (deleted: !s.isDeleted, hidden: nil, done: nil) } }
        // ⌘X too: the terminal menu deletes with `x`, and this app has no document to cut from.
        if e.charactersIgnoringModifiers?.lowercased() == "x" && !shift {
            return annotateSelected { s in (deleted: !s.isDeleted, hidden: nil, done: nil) }
        }

        guard let key = e.charactersIgnoringModifiers?.lowercased(), key.count == 1 else { return false }

        if key == "," { showSettings = true; return true }   // the macOS convention
        if key == "p" { showPeek.toggle(); return true }

        switch (key, shift) {
        case ("f", false):                       // ⌘F is Find everywhere; here the field is always
            search = ""                          // focused, so it means "start the search over".
            searchFocusToken += 1
            return true
        case ("r", true):
            Task { await reload() }
            return true
        case ("r", false):
            guard let s = selectedSession else { return true }
            generateRecap(s.id, refresh: recapCache[s.id] != nil)
            return true
        case ("c", true):
            guard let s = selectedSession else { return true }
            NSPasteboard.general.clearContents()
            NSPasteboard.general.setString("agentctl resume \(s.id)", forType: .string)
            copiedId = s.id
            return true
        case ("d", true):
            hideDone.toggle(); selection = 0
            return true
        case ("m", false):
            guard tab == .resume, let sel = selectedSession else { return true }
            if marked.contains(sel.id) { marked.remove(sel.id) } else { marked.insert(sel.id) }
            move(1)   // marking walks down the list, as it does in the terminal menu
            return true
        case ("m", true):
            marked.removeAll()
            return true
        case ("t", true):
            kindFilter = kindFilter == nil ? "interactive" : kindFilter == "interactive" ? "tool" : nil
            selection = 0
            return true
        case ("v", true):
            sessionView = sessionView == "hidden" ? "normal" : "hidden"
            selection = 0
            return true
        case ("a", true):
            cycleProfileOverride()
            return true
        case ("d", false):
            return annotateSelected { s in (deleted: nil, hidden: nil, done: !s.isDone) }
        case ("h", true):
            return annotateSelected { s in (deleted: nil, hidden: !s.isHidden, done: nil) }
        case ("e", false): return focusAnnotation(.name)
        case ("l", false): return focusAnnotation(.labels)
        case ("f", true):  return focusAnnotation(.flags)
        case ("n", true):  return focusAnnotation(.note)
        case ("t", false): return focusAnnotation(.remind)
        case ("u", false): return focusAnnotation(.due)
        default: return false
        }
    }

    /// Open the details pane if it is shut, then put the caret in one of its fields.
    private func focusAnnotation(_ field: AnnField) -> Bool {
        guard tab == .resume, let s = selectedSession else { return true }
        showPeek = true
        loadAnnotationFields(id: s.id)
        // Remind and Due have no standing field — a SwiftUI Menu cannot be opened from code, so
        // the key goes straight to the one thing behind it that can take typing.
        if field == .remind || field == .due { openCustomWhen(s, field); return true }
        annExpanded = true
        // The pane may have only just been added to the hierarchy; focus after it exists.
        DispatchQueue.main.async { annFocus = field }
        return true
    }

    /// Toggle one of the three flags on the selected session. Returns true so the key is consumed
    /// even with nothing selected — ⌘D must never leak through as a system shortcut.
    private func annotateSelected(
        _ patch: (Session) -> (deleted: Bool?, hidden: Bool?, done: Bool?)
    ) -> Bool {
        guard tab == .resume else { return true }
        // The write is a shell round trip and the row does not move until it lands. Pressing the
        // key again in that window used to act on the NEXT session, which then inherited the
        // highlight — repeat it and you walk down the list deleting rows you never selected.
        guard pendingWriteId == nil else { return true }

        // Marked rows win over the highlighted one, exactly as in the terminal menu. The patch is
        // computed from the highlighted session so a batch is uniform — otherwise a "toggle" over
        // a mixed selection would leave it just as mixed.
        let targets = marked.isEmpty
            ? [selectedSession].compactMap { $0 }
            : resumeItems.filter { marked.contains($0.id) }
        guard let head = selectedSession ?? targets.first else { return true }
        let p = patch(head)

        if p.hidden != nil || p.deleted != nil || p.done != nil { pendingWriteId = head.id }
        var left = targets.count
        for t in targets {
            Cm.annotate(id: t.id, done: p.done, hidden: p.hidden, deleted: p.deleted, completion: { a in
                applyAnnotation(t.id, a)
                left -= 1
                if left <= 0 { pendingWriteId = nil }
            }, onFailure: {
                left -= 1
                if left <= 0 { pendingWriteId = nil }
            })
        }
        marked.removeAll()
        flashNote(shelfNote(p, targets: targets, head: head))
        return true
    }

    /// One line saying what just happened, naming the session when it was one and counting when
    /// it was several.
    private func shelfNote(
        _ p: (deleted: Bool?, hidden: Bool?, done: Bool?), targets: [Session], head: Session
    ) -> String {
        let what = targets.count == 1 ? "“\(head.name)”" : "\(targets.count) sessions"
        if p.deleted == true { return "Deleted \(what) — restore from ≣ → Deleted." }
        if p.hidden == true { return "Hid \(what) — see it under ≣ → Hidden." }
        if p.deleted == false || p.hidden == false { return "\(what) back in the list." }
        if p.done == true { return "\(what) done." }
        return "\(what) open again."
    }

    private func cycleProfileOverride() {
        guard profiles.count > 1 else { return }
        let i = profileOverride.flatMap { cur in profiles.firstIndex { $0.home == cur.home } } ?? -1
        profileOverride = i + 1 >= profiles.count ? nil : profiles[i + 1]
    }

    // ── keyboard actions ──
    private func move(_ delta: Int) {
        guard count > 0 else { return }
        selection = min(max(0, selIndex + delta), count - 1)
        confirmResumeId = nil
    }
    private func activate() {
        if tab == .new {
            guard selIndex < newFlat.count else { return }
            let d = newFlat[selIndex]
            Cm.launch(dir: d.path, tool: selectedTool); onAction()
        } else {
            guard let s = selectedSession else { return }
            resumeSession(s)
        }
    }

    /// Resume an explicit session — used by both keyboard activate and row taps. Taps pass the
    /// row's own session so a not-yet-committed `selection` @State write can't resume a stale row.
    private func resumeSession(_ s: Session) {
        if !s.cwdConfident && confirmResumeId != s.id { confirmResumeId = s.id; return }
        Cm.resume(id: s.id, profileHome: profileOverride?.home); onAction()
    }
    private func cancel() {
        if !marked.isEmpty { marked.removeAll(); return }
        if customWhen != nil { customWhen = nil; annFocus = nil; searchFocusToken += 1; return }
        if annFocus != nil { annFocus = nil; annExpanded = false; searchFocusToken += 1; return }
        if confirmResumeId != nil { confirmResumeId = nil; return }
        if !search.isEmpty { search = ""; return }
        onAction() // Esc with nothing to clear → close the popover or the detached window
    }
    private func cycleTool() {
        guard let tools = projects?.tools, !tools.isEmpty else { return }
        let i = tools.firstIndex { $0.name == selectedTool } ?? -1
        selectedTool = tools[(i + 1) % tools.count].name
    }

    // ── helpers ──
    @ViewBuilder private func rowBackground(_ sel: Bool) -> some View {
        if sel { RoundedRectangle(cornerRadius: 5).fill(Color.accentColor.opacity(0.22)) }
        else { Color.clear }
    }
    /// Say which filter emptied the list, not just that it is empty — the reason is the fix.
    private var emptyResumeCopy: String {
        if !query.isEmpty { return "No sessions match “\(query)”." }
        if sessions.isEmpty { return "No sessions yet. Start one from the New tab and it will show up here." }
        if sessionView == "hidden" { return "Nothing hidden." }
        if sessionView == "deleted" { return "Nothing deleted." }
        if kindFilter == "tool" { return "No tool runs." }
        if kindFilter == "interactive" { return "No interactive sessions." }
        if hideDone { return "Every session here is done. ⇧⌘D shows them." }
        return "No sessions to show."
    }

    private func emptyState(_ s: String) -> some View {
        Text(s).font(.caption).foregroundColor(.secondary).frame(maxWidth: .infinity, alignment: .leading).padding()
    }
    /// Role colours collapse to the token set: nothing in a transcript earns green or cyan, which
    /// mean done and nothing respectively everywhere else.
    private func roleColor(_ r: String) -> Color {
        switch r { case "assistant": return .primary; case "tool": return Tone.warn; default: return .secondary }
    }
    private func statusColor(_ s: String) -> Color { s == "busy" ? Tone.ok : s == "idle" ? Tone.idle : Tone.off }
    private func statusText(_ s: String) -> String { s == "busy" ? "busy" : s == "idle" ? "idle" : "inactive" }
    private func tilde(_ p: String) -> String { p.replacingOccurrences(of: NSHomeDirectory(), with: "~") }
    /// ISO string → epoch ms, for `age`. Returns now on an unparseable date, which reads as "0m"
    /// rather than throwing the row away.
    private func isoMs(_ iso: String?) -> Double {
        guard let iso, let d = ContentView.isoFrac.date(from: iso) ?? ContentView.isoPlain.date(from: iso) else {
            return Date().timeIntervalSince1970 * 1000
        }
        return d.timeIntervalSince1970 * 1000
    }

    private func age(_ ms: Double) -> String {
        let diff = Date().timeIntervalSince1970 - ms / 1000
        if diff < 3600 { return "\(Int(diff/60))m" }
        if diff < 86400 { return "\(Int(diff/3600))h" }
        if diff < 604800 { return "\(Int(diff/86400))d" }
        return "\(Int(diff/604800))w"
    }
    /// ISO timestamp → "Jun 09 11:18  (1m ago)".
    /// "Jun 05 13:06 → Jun 09 17:30 (2m ago)" — two timestamps read better as one span.
    private func spanLine(_ s: Session) -> String {
        let df = DateFormatter(); df.locale = Locale(identifier: "en_US_POSIX"); df.dateFormat = "MMM dd HH:mm"
        let started = (s.startedAt.flatMap { ContentView.isoFrac.date(from: $0) ?? ContentView.isoPlain.date(from: $0) })
            .map { df.string(from: $0) } ?? "—"
        let last = (ContentView.isoFrac.date(from: s.lastUpdatedAt) ?? ContentView.isoPlain.date(from: s.lastUpdatedAt))
            .map { df.string(from: $0) } ?? "—"
        return "\(started) → \(last) (\(age(isoMs(s.lastUpdatedAt))) ago)"
    }

    private func fmtIso(_ iso: String?) -> String {
        guard let iso, let d = ContentView.isoFrac.date(from: iso) ?? ContentView.isoPlain.date(from: iso) else { return "—" }
        let df = DateFormatter(); df.locale = Locale(identifier: "en_US_POSIX"); df.dateFormat = "MMM dd HH:mm"
        return "\(df.string(from: d))  (\(age(d.timeIntervalSince1970 * 1000)) ago)"
    }

    // ── data ──
    private func loadAll() async {
        loading = true; defer { loading = false }
        do {
            let p = try await Cm.projects()
            projects = p
            if selectedTool.isEmpty { selectedTool = p.defaultTool.isEmpty ? (p.tools.first?.name ?? "cld") : p.defaultTool }
            profiles = (try? await Cm.profiles()) ?? []
        } catch { errorText = describe(error) }
    }
    private func loadSessions() async {
        guard !sessionsLoaded else { return }
        loading = true; defer { loading = false }
        do {
            sessions = try await Cm.sessions()
            sessionsError = nil
        } catch {
            sessionsError = describe(error)
        }
        sessionsLoaded = true
    }
    /// Re-read sessions after a write, bypassing the once-only `sessionsLoaded` guard.
    /// Fold a written annotation into the one row it changed. The CLI already returned it, so a
    /// full re-list would be a second shell round trip over every session — and that window is
    /// what let a repeated keypress act on the row that slid under the selection while it was
    /// open. Falls back to a re-list only if the response could not be decoded.
    private func applyAnnotation(_ id: String, _ a: Annotation?) {
        guard let a else { Task { await refreshSessions() }; return }
        let priorId = selectedSession?.id
        if let i = sessions.firstIndex(where: { $0.id == id }) {
            sessions[i] = sessions[i].applying(a)
        }
        annEditingId = nil
        loadAnnotationFields(id: selectedSession?.id)
        reanchor(to: priorId)
    }

    private func refreshSessions() async {
        let priorId = selectedSession?.id
        do {
            sessions = try await Cm.sessions()
            // Let the editor re-read what the store now holds. Clearing the guard is not enough:
            // when the selection does not change, nothing else calls the loader, and the fields
            // keep the un-normalized text you typed.
            annEditingId = nil
            loadAnnotationFields(id: selectedSession?.id)
            sessionsError = nil
            sessionsLoaded = true
        } catch { sessionsError = describe(error); sessionsLoaded = true }
        reanchor(to: priorId)
    }

    /// `selection` is an index into a list that changes under it: a shelf move, a filter or a
    /// reload can drop rows, and a clamped index then quietly points at a different session while
    /// the highlight bar never moves. Follow the session by id instead.
    private func reanchor(to id: String?) {
        if let id, let i = resumeItems.firstIndex(where: { $0.id == id }) {
            selection = i
        } else {
            // The selected session left this view. Land on the row that took its place, but write
            // `selection` so the change is real and the list scrolls to it.
            selection = min(selIndex, max(0, resumeItems.count - 1))
            confirmResumeId = nil
            copiedId = nil
        }
    }
    private func reload() async {
        // Fires on every popover open. Without clearing annEditingId the editor keeps the fields
        // it loaded last time, and a rename made meanwhile in the terminal menu — same annotation
        // store — is silently written back over on the next ⏎.
        let priorId = selectedSession?.id
        errorText = nil; sessions = []; sessionsLoaded = false; peekCache = [:]; peekFailed = []
        annEditingId = nil
        await loadAll()
        if tab == .resume { await loadSessions() }
        reanchor(to: priorId)
        loadAnnotationFields(id: selectedSession?.id)
    }
    private func describe(_ e: Error) -> String {
        if case CmError.notFound = e {
            return "agentctl not found. Install it: brew install --cask roypadina/tap/agentctl"
        }
        if case CmError.failed(let m) = e { return "agentctl error: \(m)" }
        // The only realistic cause is an agentctl on PATH older than this app — the cask ships
        // both together, so it takes deliberate effort. Name the fix rather than printing Swift.
        if e is DecodingError {
            return "The agentctl on your PATH is older than this app. Update it: brew upgrade --cask agentctl"
        }
        return "\(e)"
    }
}

// ── New dir sheet ──
struct NewDirView: View {
    let groups: [Group]
    let tool: String
    var onDone: () -> Void
    @Environment(\.dismiss) private var dismiss
    @State private var base = ""
    @State private var name = ""

    private var bases: [(label: String, path: String)] {
        var out: [(String, String)] = []
        for g in groups {
            out.append(("\(g.name)/", g.path))
            for d in g.dirs { out.append(("\(g.name)/\(d.name)", d.path)) }
        }
        return out
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 12) {
            Text("New directory").font(.headline)
            Picker("Under", selection: $base) {
                ForEach(bases, id: \.path) { Text($0.label).tag($0.path) }
            }
            TextField("New dir name", text: $name)
            HStack {
                Spacer()
                Button("Cancel") { dismiss() }
                Button("Create & open") {
                    if !base.isEmpty && !name.trimmingCharacters(in: .whitespaces).isEmpty {
                        Cm.newDirThenLaunch(base: base, name: name, tool: tool)
                        dismiss(); onDone()
                    }
                }.keyboardShortcut(.defaultAction)
            }
        }
        .padding(16).frame(width: 360)
        .onAppear { if base.isEmpty { base = bases.first?.path ?? "" } }
    }
}


/// Width of the details pane, so the action row knows when to wrap. `ViewThatFits` and the
/// `Layout` protocol are macOS 13+; this app targets 12.
private struct ListWidthKey: PreferenceKey {
    static var defaultValue: CGFloat = 0
    static func reduce(value: inout CGFloat, nextValue: () -> CGFloat) { value = nextValue() }
}

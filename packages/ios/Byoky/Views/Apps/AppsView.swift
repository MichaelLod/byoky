import SwiftUI

/// The Apps screen — connected apps bucketed by group, with per-app routing
/// (assign an app to a group → its requests use that group's credential and,
/// when the group's destination is in a different family, get translated on
/// the fly). Mirrors the extension's `ConnectedApps.tsx` page; the mobile
/// gesture is long-press → "Move to group" sheet rather than drag-and-drop
/// since touch drag is awkward for small targets.
struct AppsView: View {
    @EnvironmentObject var wallet: WalletStore

    @State private var movingApp: Session?
    @State private var editingAllowanceFor: Session?
    @State private var editingGroup: Group?
    @State private var showCreateGroup = false

    private var orderedGroups: [Group] {
        let def = wallet.groups.filter { $0.id == defaultGroupId }
        let rest = wallet.groups
            .filter { $0.id != defaultGroupId }
            .sorted { $0.createdAt < $1.createdAt }
        return def + rest
    }

    private func sessionsInGroup(_ groupId: String) -> [Session] {
        wallet.sessions.filter { (wallet.appGroups[$0.appOrigin] ?? defaultGroupId) == groupId }
    }

    var body: some View {
        NavigationStack {
            List {
                if !wallet.cloudVaultEnabled && !wallet.sessions.isEmpty {
                    cloudVaultWarning
                }

                ForEach(orderedGroups) { group in
                    groupSection(group)
                }

                if wallet.sessions.isEmpty {
                    emptyState
                }
            }
            .navigationTitle("Apps")
            .toolbar {
                ToolbarItem(placement: .primaryAction) {
                    Button {
                        showCreateGroup = true
                    } label: {
                        Image(systemName: "plus")
                    }
                    .accessibilityIdentifier("groups.create")
                }
                if wallet.sessions.count > 1 {
                    ToolbarItem(placement: .topBarLeading) {
                        Menu {
                            Button(role: .destructive) {
                                for session in wallet.sessions {
                                    try? wallet.revokeSession(session)
                                }
                            } label: {
                                Label("Disconnect all", systemImage: "xmark.circle")
                            }
                        } label: {
                            Image(systemName: "ellipsis.circle")
                        }
                    }
                }
            }
            .sheet(item: $movingApp) { session in
                MoveToGroupSheet(session: session)
                    .environmentObject(wallet)
            }
            .sheet(item: $editingAllowanceFor) { session in
                AllowanceFormView(
                    origin: session.appOrigin,
                    providers: session.providers,
                    allowance: wallet.tokenAllowances.first { $0.origin == session.appOrigin }
                )
                .environmentObject(wallet)
            }
            .sheet(isPresented: $showCreateGroup) {
                GroupEditorSheet(mode: .create)
                    .environmentObject(wallet)
            }
            .sheet(item: $editingGroup) { group in
                GroupEditorSheet(mode: .edit(group))
                    .environmentObject(wallet)
            }
        }
    }

    @ViewBuilder
    private func groupSection(_ group: Group) -> some View {
        let groupSessions = sessionsInGroup(group.id)
        let provider = Provider.find(group.providerId)
        let isDefault = group.id == defaultGroupId
        let pinnedCred = group.credentialId.flatMap { id in
            wallet.credentials.first { $0.id == id }
        }
        let pinnedGift = group.giftId.flatMap { gid in
            wallet.giftedCredentials.first { $0.giftId == gid }
        }

        Section {
            if groupSessions.isEmpty {
                Text(isDefault
                     ? "Apps without an assigned group land here."
                     : "Long-press an app and pick this group to move it here.")
                    .font(.caption)
                    .foregroundStyle(.tertiary)
                    .italic()
                    .padding(.vertical, 4)
            } else {
                ForEach(groupSessions) { session in
                    AppSessionRow(session: session)
                        .environmentObject(wallet)
                        .contentShape(Rectangle())
                        .contextMenu {
                            Button {
                                movingApp = session
                            } label: {
                                Label("Move to group", systemImage: "arrow.right.square")
                            }
                            Button {
                                editingAllowanceFor = session
                            } label: {
                                Label("Set token limit", systemImage: "gauge.with.dots.needle.33percent")
                            }
                            Button(role: .destructive) {
                                try? wallet.revokeSession(session)
                            } label: {
                                Label("Disconnect", systemImage: "xmark.circle")
                            }
                        }
                        .swipeActions(edge: .trailing) {
                            Button(role: .destructive) {
                                try? wallet.revokeSession(session)
                            } label: {
                                Label("Disconnect", systemImage: "xmark.circle")
                            }
                        }
                        .swipeActions(edge: .leading) {
                            Button {
                                movingApp = session
                            } label: {
                                Label("Move", systemImage: "arrow.right.square")
                            }
                            .tint(Theme.accent)
                        }
                }
            }
        } header: {
            HStack(spacing: 6) {
                Text(group.name)
                    .font(.callout.weight(.semibold))
                if !group.providerId.isEmpty {
                    Text(provider?.name ?? group.providerId)
                        .font(.caption2.weight(.medium))
                        .padding(.horizontal, 6)
                        .padding(.vertical, 2)
                        .background(Theme.accent.opacity(0.15))
                        .foregroundStyle(Theme.accent)
                        .clipShape(Capsule())
                }
                if let model = group.model, !model.isEmpty {
                    Text(model)
                        .font(.caption2.monospaced())
                        .padding(.horizontal, 6)
                        .padding(.vertical, 2)
                        .background(Color(.systemGray5))
                        .clipShape(Capsule())
                }
                Spacer()
                Menu {
                    Button {
                        editingGroup = group
                    } label: {
                        Label(isDefault ? "Edit default" : "Edit", systemImage: "pencil")
                    }
                    if !isDefault {
                        Button(role: .destructive) {
                            try? wallet.deleteGroup(id: group.id)
                        } label: {
                            Label("Delete", systemImage: "trash")
                        }
                    }
                } label: {
                    Image(systemName: "ellipsis.circle")
                        .font(.callout)
                        .foregroundStyle(Theme.accent)
                }
            }
        } footer: {
            if group.providerId.isEmpty {
                Text("No routing — apps use the provider they request")
            } else if let pinnedGift {
                Text("Using gift from \(pinnedGift.senderLabel) · \(formatTokens(giftedBudgetRemaining(pinnedGift))) left")
            } else if let pinnedCred {
                Text("Using \(pinnedCred.label)")
            } else {
                Text("Any \(provider?.name ?? group.providerId) credential")
            }
        }
    }

    private var emptyState: some View {
        Section {
            VStack(spacing: 16) {
                Image(systemName: "link")
                    .font(.system(size: 40))
                    .foregroundStyle(Color(.systemGray3))

                Text("No Apps Connected")
                    .font(.headline)

                Text("Pair an app via the Connect tab. Connected apps appear here, where you can group them, set token limits, and reroute requests across providers.")
                    .font(.callout)
                    .foregroundStyle(.secondary)
                    .multilineTextAlignment(.center)
            }
            .padding(.vertical, 32)
            .frame(maxWidth: .infinity)
        }
    }

    private var cloudVaultWarning: some View {
        Section {
            Label(
                "Your device must stay online for connected apps to work. Enable Cloud Sync in Settings for offline access.",
                systemImage: "wifi"
            )
            .font(.caption)
            .foregroundStyle(.orange)
        }
    }
}

// MARK: - Session row

private struct AppSessionRow: View {
    @EnvironmentObject var wallet: WalletStore
    let session: Session

    private var allowance: TokenAllowance? {
        wallet.tokenAllowances.first { $0.origin == session.appOrigin }
    }

    private var tokensUsed: Int {
        wallet.tokenUsage(for: session.appOrigin)
    }

    private var displayHost: String {
        if let url = URL(string: session.appOrigin), let host = url.host { return host }
        return session.appOrigin
    }

    var body: some View {
        HStack(alignment: .top, spacing: 10) {
            faviconBadge

            VStack(alignment: .leading, spacing: 4) {
                Text(displayHost)
                    .font(.body.weight(.medium))
                    .lineLimit(1)

                Text("Connected \(session.createdAt, format: .relative(presentation: .named))")
                    .font(.caption2)
                    .foregroundStyle(.secondary)

                if let allowance, let limit = allowance.totalLimit {
                    HStack(spacing: 8) {
                        ProgressView(value: min(Double(tokensUsed) / Double(limit), 1.0))
                            .tint(Double(tokensUsed) / Double(limit) >= 0.8 ? .orange : Theme.accent)
                        Text("\(formatTokens(tokensUsed)) / \(formatTokens(limit))")
                            .font(.caption2.monospacedDigit())
                            .foregroundStyle(.secondary)
                    }
                } else {
                    Text("\(formatTokens(tokensUsed)) tokens used")
                        .font(.caption2)
                        .foregroundStyle(.tertiary)
                }
            }
        }
        .padding(.vertical, 4)
    }

    private var faviconBadge: some View {
        Text(displayHost.first.map { String($0).uppercased() } ?? "?")
            .font(.headline)
            .foregroundStyle(Theme.accent)
            .frame(width: 32, height: 32)
            .background(Theme.accent.opacity(0.15))
            .clipShape(RoundedRectangle(cornerRadius: 8, style: .continuous))
    }
}

// MARK: - Move to group sheet

private struct MoveToGroupSheet: View {
    @EnvironmentObject var wallet: WalletStore
    @Environment(\.dismiss) var dismiss
    let session: Session

    /// Pending capability-gap confirmation. When set, the user has tapped a
    /// group whose model lacks features the app has been using; we surface
    /// a confirmation alert before committing the move so a misroute doesn't
    /// silently start failing requests.
    @State private var pendingMove: PendingMove?

    private struct PendingMove: Identifiable {
        let id = UUID()
        let groupId: String
        let groupName: String
        let model: String
        let gapLabels: [String]
    }

    private var orderedGroups: [Group] {
        let def = wallet.groups.filter { $0.id == defaultGroupId }
        let rest = wallet.groups
            .filter { $0.id != defaultGroupId }
            .sorted { $0.createdAt < $1.createdAt }
        return def + rest
    }

    private var currentGroupId: String {
        wallet.appGroups[session.appOrigin] ?? defaultGroupId
    }

    private var displayHost: String {
        if let url = URL(string: session.appOrigin), let host = url.host { return host }
        return session.appOrigin
    }

    /// Diff the app's used-capability union against the group's destination
    /// model. Returns nil when there's no gap (the move is safe to commit
    /// directly), or a PendingMove describing the gap when we need to ask
    /// the user to confirm. Skipped entirely when the group has no pinned
    /// model — pass-through groups can't introduce a capability mismatch.
    private func gapsFor(group: Group) -> PendingMove? {
        guard let model = group.model, !model.isEmpty else { return nil }
        guard let json = TranslationEngine.shared.describeModel(model),
              let data = json.data(using: .utf8),
              let parsed = try? JSONSerialization.jsonObject(with: data) as? [String: Any],
              let caps = parsed["capabilities"] as? [String: Bool] else {
            return nil
        }
        let appEntries = wallet.requestLogs.filter { $0.appOrigin == session.appOrigin }
        let used = detectAppCapabilities(appEntries)
        let gaps = capabilityGaps(used: used, modelCapabilities: caps)
        guard !gaps.isEmpty else { return nil }
        return PendingMove(
            groupId: group.id,
            groupName: group.name,
            model: model,
            gapLabels: gaps.map(capabilityLabel),
        )
    }

    private func commitMove(to groupId: String) {
        try? wallet.setAppGroup(origin: session.appOrigin, groupId: groupId)
        dismiss()
    }

    var body: some View {
        NavigationStack {
            List {
                Section {
                    Text(displayHost)
                        .font(.callout.weight(.medium))
                } header: {
                    Text("App")
                }

                Section {
                    ForEach(orderedGroups) { group in
                        Button {
                            if group.id == currentGroupId {
                                dismiss()
                                return
                            }
                            if let pending = gapsFor(group: group) {
                                pendingMove = pending
                            } else {
                                commitMove(to: group.id)
                            }
                        } label: {
                            HStack(spacing: 10) {
                                VStack(alignment: .leading, spacing: 2) {
                                    Text(group.name)
                                        .font(.body.weight(.medium))
                                        .foregroundStyle(.primary)
                                        .accessibilityIdentifier("moveApp.group.\(group.id)")
                                    HStack(spacing: 6) {
                                        Text(group.providerId.isEmpty
                                             ? "No routing"
                                             : (Provider.find(group.providerId)?.name ?? group.providerId))
                                            .font(.caption)
                                            .foregroundStyle(.secondary)
                                        if let model = group.model, !model.isEmpty {
                                            Text("·")
                                                .font(.caption)
                                                .foregroundStyle(.secondary)
                                            Text(model)
                                                .font(.caption.monospaced())
                                                .foregroundStyle(.secondary)
                                        }
                                    }
                                }
                                Spacer()
                                if group.id == currentGroupId {
                                    Image(systemName: "checkmark")
                                        .foregroundStyle(Theme.accent)
                                }
                            }
                        }
                    }
                } header: {
                    Text("Move to group")
                } footer: {
                    Text("The next request from this app will use the group's credential. Cross-family requests are translated on the fly.")
                }
            }
            .navigationTitle("Move app")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button("Cancel") { dismiss() }
                }
            }
            .alert(item: $pendingMove) { pending in
                Alert(
                    title: Text("Capability mismatch"),
                    message: Text(
                        "\(displayHost) has used \(pending.gapLabels.joined(separator: ", ")) in past requests, but \(pending.model) in \(pending.groupName) does not support "
                        + (pending.gapLabels.count == 1 ? "it" : "one or more of these")
                        + ". Requests using "
                        + (pending.gapLabels.count == 1 ? "that feature" : "those features")
                        + " will fail until you switch back."
                    ),
                    primaryButton: .destructive(Text("Move anyway")) {
                        commitMove(to: pending.groupId)
                    },
                    secondaryButton: .cancel()
                )
            }
        }
    }
}

// MARK: - Group editor sheet (create + edit)

/// Create a new routing group, or edit an existing one. The default group can
/// be edited but not renamed or deleted. The model field is optional — leave
/// empty to pass through whatever model the app requested; set it to override
/// (e.g. drag a Claude app here and pin to gpt-4o for cross-family translation).
struct GroupEditorSheet: View {
    enum Mode {
        case create
        case edit(Group)

        var isDefault: Bool {
            if case .edit(let g) = self, g.id == defaultGroupId { return true }
            return false
        }

        var existingGroup: Group? {
            if case .edit(let g) = self { return g }
            return nil
        }
    }

    @EnvironmentObject var wallet: WalletStore
    @Environment(\.dismiss) var dismiss
    let mode: Mode

    @State private var name: String = ""
    @State private var providerId: String = "anthropic"
    /// Unified pin value: `""` (any), `"cred:<id>"`, or `"gift:<giftId>"`.
    @State private var pinValue: String = ""
    @State private var model: String = ""
    @State private var error: String?
    @State private var suggestedModels: [(id: String, displayName: String)] = []
    @State private var selectedModelInfo: String?

    private var matchingCredentials: [Credential] {
        wallet.credentials.filter { $0.providerId == providerId }
    }

    private var matchingGifts: [GiftedCredential] {
        wallet.giftedCredentials.filter {
            $0.providerId == providerId
            && !isGiftedCredentialExpired($0)
            && $0.usedTokens < $0.maxTokens
        }
    }

    private var hasAnyPinnable: Bool {
        !matchingCredentials.isEmpty || !matchingGifts.isEmpty
    }

    private var navTitle: String {
        switch mode {
        case .create: return "New Group"
        case .edit: return mode.isDefault ? "Default Group" : "Edit Group"
        }
    }

    var body: some View {
        NavigationStack {
            Form {
                if !mode.isDefault {
                    Section {
                        TextField("Group name", text: $name)
                            .autocapitalization(.words)
                            .accessibilityIdentifier("groupEditor.name")
                    } header: {
                        Text("Name")
                    } footer: {
                        Text("Pick something meaningful — \"Coding\", \"Vision tasks\", \"Cheap models\".")
                    }
                }

                Section {
                    Picker("Provider", selection: $providerId) {
                        ForEach(Provider.all, id: \.id) { provider in
                            Text(provider.name).tag(provider.id)
                        }
                    }
                    .accessibilityIdentifier("groupEditor.provider")
                    .onChange(of: providerId) { _, newValue in
                        // Provider change invalidates any pin.
                        pinValue = ""
                        loadSuggestedModels(for: newValue)
                    }

                    if hasAnyPinnable {
                        Picker("Credential", selection: $pinValue) {
                            Text("Any \(Provider.find(providerId)?.name ?? providerId) credential").tag("")
                            if !matchingCredentials.isEmpty {
                                Section("Your credentials") {
                                    ForEach(matchingCredentials, id: \.id) { c in
                                        Text(c.label).tag("cred:\(c.id)")
                                    }
                                }
                            }
                            if !matchingGifts.isEmpty {
                                Section("Gifts") {
                                    ForEach(matchingGifts, id: \.giftId) { gc in
                                        let remainingLabel = "\(formatTokens(giftedBudgetRemaining(gc))) left"
                                        Text("🎁 \(gc.senderLabel) · \(remainingLabel)").tag("gift:\(gc.giftId)")
                                    }
                                }
                            }
                        }
                    } else {
                        // Inline warning when the chosen provider has no
                        // credentials AND no active gifts. The save still
                        // goes through (permissive mode) but the user is
                        // told up front that this group won't actually
                        // work until a credential is added or a gift is
                        // redeemed.
                        HStack(alignment: .top, spacing: 8) {
                            Image(systemName: "exclamationmark.triangle.fill")
                                .foregroundStyle(.orange)
                                .imageScale(.medium)
                            VStack(alignment: .leading, spacing: 2) {
                                Text("No \(Provider.find(providerId)?.name ?? providerId) credential or gift")
                                    .font(.subheadline)
                                    .fontWeight(.medium)
                                Text("This group can be saved, but apps using it will fail until you add a \(Provider.find(providerId)?.name ?? providerId) key or redeem a matching gift.")
                                    .font(.caption)
                                    .foregroundStyle(.secondary)
                            }
                        }
                        .padding(.vertical, 4)
                    }
                } header: {
                    Text("Destination")
                } footer: {
                    Text("Apps assigned to this group will route their requests through this provider. Pin a credential or a gift to lock the choice; leave it as \"Any\" to use any credential of that provider.")
                }

                Section {
                    TextField("e.g. claude-sonnet-4-5", text: $model)
                        .autocapitalization(.none)
                        .disableAutocorrection(true)
                        .onChange(of: model) { _, new in
                            updateModelInfo(for: new)
                        }
                        .accessibilityIdentifier("groupEditor.model")

                    if !suggestedModels.isEmpty {
                        ForEach(suggestedModels, id: \.id) { entry in
                            Button {
                                model = entry.id
                                updateModelInfo(for: entry.id)
                            } label: {
                                HStack {
                                    Text(entry.displayName)
                                        .font(.callout)
                                        .foregroundStyle(.primary)
                                    Spacer()
                                    Text(entry.id)
                                        .font(.caption.monospaced())
                                        .foregroundStyle(.tertiary)
                                }
                            }
                        }
                    }
                } header: {
                    Text("Model (optional)")
                } footer: {
                    if let info = selectedModelInfo {
                        Text(info).font(.caption).foregroundStyle(.secondary)
                    } else {
                        Text("Leave empty to pass through whatever model the app requested. Set when you want to override — required for cross-family routing (e.g. apps calling Claude routed to gpt-4o).")
                    }
                }

                if let error {
                    Section {
                        Text(error)
                            .font(.caption)
                            .foregroundStyle(.red)
                    }
                }
            }
            .navigationTitle(navTitle)
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button("Cancel") { dismiss() }
                        .accessibilityIdentifier("groupEditor.cancel")
                }
                ToolbarItem(placement: .confirmationAction) {
                    Button("Save") { save() }
                        .disabled(!mode.isDefault && name.trimmingCharacters(in: .whitespaces).isEmpty)
                        .accessibilityIdentifier("groupEditor.save")
                }
            }
            .onAppear {
                if let existing = mode.existingGroup {
                    name = existing.name
                    providerId = existing.providerId
                    if let gid = existing.giftId {
                        pinValue = "gift:\(gid)"
                    } else if let cid = existing.credentialId {
                        pinValue = "cred:\(cid)"
                    } else {
                        pinValue = ""
                    }
                    model = existing.model ?? ""
                }
                loadSuggestedModels(for: providerId)
                if !model.isEmpty { updateModelInfo(for: model) }
            }
        }
    }

    /// Pull the @byoky/core registry's known models for this provider, via
    /// the JS bridge. Empty list means the registry has no entries — the
    /// user can still type a custom model name.
    private func loadSuggestedModels(for provider: String) {
        let json = TranslationEngine.shared.getModelsForProvider(provider)
        guard let data = json.data(using: .utf8),
              let arr = try? JSONSerialization.jsonObject(with: data) as? [[String: Any]] else {
            suggestedModels = []
            return
        }
        suggestedModels = arr.compactMap { entry in
            guard let id = entry["id"] as? String,
                  let displayName = entry["displayName"] as? String else { return nil }
            return (id: id, displayName: displayName)
        }
    }

    /// Look up the chosen model in the registry and produce a one-line
    /// capability summary for the footer. Empty when the model isn't in
    /// the registry — that's fine, the user can still type custom names.
    private func updateModelInfo(for modelId: String) {
        guard let json = TranslationEngine.shared.describeModel(modelId),
              let data = json.data(using: .utf8),
              let parsed = try? JSONSerialization.jsonObject(with: data) as? [String: Any],
              let caps = parsed["capabilities"] as? [String: Any] else {
            selectedModelInfo = nil
            return
        }
        var bits: [String] = []
        if caps["tools"] as? Bool == true { bits.append("tools") }
        if caps["vision"] as? Bool == true { bits.append("vision") }
        if caps["structuredOutput"] as? Bool == true { bits.append("JSON schema") }
        if caps["reasoning"] as? Bool == true { bits.append("reasoning") }
        let context = parsed["contextWindow"] as? Int ?? 0
        let display = parsed["displayName"] as? String ?? modelId
        let contextK = context >= 1000 ? "\(context / 1000)K" : "\(context)"
        selectedModelInfo = "\(display): \(contextK) ctx · " + bits.joined(separator: " · ")
    }

    private func save() {
        do {
            let credentialPin: String? = pinValue.hasPrefix("cred:") ? String(pinValue.dropFirst(5)) : nil
            let giftPin: String? = pinValue.hasPrefix("gift:") ? String(pinValue.dropFirst(5)) : nil
            switch mode {
            case .create:
                try wallet.createGroup(
                    name: name,
                    providerId: providerId,
                    credentialId: credentialPin,
                    giftId: giftPin,
                    model: model.nilIfEmpty
                )
            case .edit(let g):
                try wallet.updateGroup(
                    id: g.id,
                    name: mode.isDefault ? nil : name,
                    providerId: providerId,
                    credentialId: .some(credentialPin),
                    giftId: .some(giftPin),
                    model: .some(model.nilIfEmpty)
                )
            }
            dismiss()
        } catch {
            self.error = error.localizedDescription
        }
    }
}

// MARK: - Allowance form (ported from old SessionsView)

struct AllowanceFormView: View {
    @EnvironmentObject var wallet: WalletStore
    @Environment(\.dismiss) var dismiss

    let origin: String
    let providers: [String]
    let allowance: TokenAllowance?

    @State private var totalLimit: String = ""
    @State private var providerLimits: [String: String] = [:]

    var body: some View {
        NavigationStack {
            Form {
                Section {
                    Text(origin)
                        .font(.callout.weight(.medium))
                } header: {
                    Text("App")
                }

                Section {
                    TextField("Unlimited", text: $totalLimit)
                        .keyboardType(.numberPad)
                } header: {
                    Text("Total token limit")
                } footer: {
                    Text("Leave empty for unlimited.")
                }

                if !providers.isEmpty {
                    Section {
                        ForEach(providers, id: \.self) { providerId in
                            HStack {
                                Text(Provider.find(providerId)?.name ?? providerId)
                                    .font(.callout)
                                Spacer()
                                TextField("Unlimited", text: binding(for: providerId))
                                    .keyboardType(.numberPad)
                                    .multilineTextAlignment(.trailing)
                                    .frame(width: 120)
                            }
                        }
                    } header: {
                        Text("Per provider")
                    }
                }
            }
            .navigationTitle("Token Limit")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button("Cancel") { dismiss() }
                }
                ToolbarItem(placement: .confirmationAction) {
                    Button("Save") { save() }
                }
            }
            .toolbar {
                ToolbarItemGroup(placement: .bottomBar) {
                    if allowance != nil {
                        Button("Remove Limit", role: .destructive) {
                            wallet.removeAllowance(origin: origin)
                            dismiss()
                        }
                        .foregroundStyle(.red)
                    }
                    Spacer()
                }
            }
        }
        .onAppear {
            if let allowance {
                if let limit = allowance.totalLimit {
                    totalLimit = String(limit)
                }
                for (id, limit) in allowance.providerLimits ?? [:] {
                    providerLimits[id] = String(limit)
                }
            }
        }
    }

    private func binding(for providerId: String) -> Binding<String> {
        Binding(
            get: { providerLimits[providerId] ?? "" },
            set: { providerLimits[providerId] = $0 }
        )
    }

    private func save() {
        var parsed = TokenAllowance(origin: origin)

        if let total = Int(totalLimit), total > 0 {
            parsed.totalLimit = total
        }

        var pLimits: [String: Int] = [:]
        for (id, val) in providerLimits {
            if let n = Int(val), n > 0 {
                pLimits[id] = n
            }
        }
        if !pLimits.isEmpty {
            parsed.providerLimits = pLimits
        }

        wallet.setAllowance(parsed)
        dismiss()
    }
}

// MARK: - Helpers

private func formatTokens(_ count: Int) -> String {
    if count >= 1_000_000 {
        return String(format: "%.1fM", Double(count) / 1_000_000)
    } else if count >= 1_000 {
        return String(format: "%.0fK", Double(count) / 1_000)
    }
    return "\(count)"
}

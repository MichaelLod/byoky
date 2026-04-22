import { useState } from 'react';
import { useWalletStore } from '../store';
import {
  PROVIDERS, isGiftExpired,
  type TokenAllowance, type Group, type Session, type CredentialMeta,
  type GiftedCredential,
  type CapabilitySet,
  DEFAULT_GROUP_ID,
  detectAppCapabilities,
  capabilityGaps,
  capabilityLabel,
  getModel,
  modelsForProvider,
  giftBudgetRemaining,
} from '@byoky/core';

function formatTokensShort(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(0)}K`;
  return String(n);
}

function timeAgo(timestamp: number): string {
  const seconds = Math.floor((Date.now() - timestamp) / 1000);
  if (seconds < 60) return 'just now';
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}

function formatOrigin(origin: string): string {
  try {
    return new URL(origin).hostname;
  } catch {
    return origin;
  }
}

function formatTokens(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`;
  return String(n);
}

const DRAG_MIME = 'application/x-byoky-app-origin';

export function ConnectedApps() {
  const {
    sessions, revokeSession, trustedSites, removeTrustedSite,
    requestLog, tokenAllowances, setAllowance, removeAllowance,
    giftedCredentials, cloudVaultEnabled,
    groups, appGroups, credentials,
    createGroup, updateGroup, deleteGroup, setAppGroup,
  } = useWalletStore();
  const activeGiftProviders = new Set(
    giftedCredentials.filter((gc) => !isGiftExpired(gc) && gc.usedTokens < gc.maxTokens).map((gc) => gc.providerId),
  );
  const [editingOrigin, setEditingOrigin] = useState<string | null>(null);
  const [editingGroupId, setEditingGroupId] = useState<string | null>(null);
  const [showCreateGroup, setShowCreateGroup] = useState(false);
  const [dragOriginOver, setDragOriginOver] = useState<string | null>(null);
  const [pendingMove, setPendingMove] = useState<{
    origin: string;
    targetGroupId: string;
    gaps: (keyof CapabilitySet)[];
    targetGroupName: string;
    targetModel: string;
  } | null>(null);

  function getOriginUsage(origin: string) {
    const entries = requestLog.filter((e) => e.appOrigin === origin && e.status < 400);
    let total = 0;
    const byProvider: Record<string, number> = {};
    for (const entry of entries) {
      const tokens = (entry.inputTokens ?? 0) + (entry.outputTokens ?? 0);
      total += tokens;
      byProvider[entry.providerId] = (byProvider[entry.providerId] ?? 0) + tokens;
    }
    return { total, byProvider };
  }

  // Bucket sessions by their assigned group (default if none).
  const sessionsByGroup = new Map<string, Session[]>();
  for (const g of groups) sessionsByGroup.set(g.id, []);
  if (!sessionsByGroup.has(DEFAULT_GROUP_ID)) sessionsByGroup.set(DEFAULT_GROUP_ID, []);
  for (const session of sessions) {
    const groupId = appGroups[session.appOrigin] ?? DEFAULT_GROUP_ID;
    const bucket = sessionsByGroup.get(groupId) ?? sessionsByGroup.get(DEFAULT_GROUP_ID)!;
    bucket.push(session);
  }

  // Make sure default appears first, then user groups in creation order.
  // The background ensures a default group exists on getGroups, so we don't synthesize.
  const orderedGroups = [
    ...groups.filter((g) => g.id === DEFAULT_GROUP_ID),
    ...groups.filter((g) => g.id !== DEFAULT_GROUP_ID),
  ];

  async function handleDrop(targetGroupId: string, origin: string) {
    setDragOriginOver(null);
    const currentGroupId = appGroups[origin] ?? DEFAULT_GROUP_ID;
    if (currentGroupId === targetGroupId) return;

    // Drag-time capability check: if the target group's model lacks features
    // the app has used in past requests, surface a warning before committing
    // the move. The user can confirm to proceed or cancel.
    const targetGroup = groups.find((g) => g.id === targetGroupId);
    if (targetGroup && targetGroup.model) {
      const model = getModel(targetGroup.model);
      if (model) {
        const appEntries = requestLog.filter((e) => e.appOrigin === origin);
        const used = detectAppCapabilities(appEntries);
        const gaps = capabilityGaps(used, model);
        if (gaps.length > 0) {
          setPendingMove({
            origin,
            targetGroupId,
            gaps,
            targetGroupName: targetGroup.name,
            targetModel: targetGroup.model,
          });
          return;
        }
      }
    }

    await setAppGroup(origin, targetGroupId);
  }

  async function confirmPendingMove() {
    if (!pendingMove) return;
    await setAppGroup(pendingMove.origin, pendingMove.targetGroupId);
    setPendingMove(null);
  }

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '16px' }}>
        <h2 className="page-title" style={{ marginBottom: 0 }}>Connected Apps</h2>
        {sessions.length > 1 && (
          <button
            className="text-link"
            style={{ color: 'var(--danger)', fontSize: '12px' }}
            onClick={() => sessions.forEach((s) => revokeSession(s.id))}
          >
            Disconnect all
          </button>
        )}
      </div>

      {sessions.length > 0 && !cloudVaultEnabled && (
        <div className="warning-box" style={{ marginBottom: '12px' }}>
          <strong>Device must stay online.</strong> Connected apps can only make
          requests while your browser is running and this extension is active.
          Enable Cloud Sync in Settings for offline access.
        </div>
      )}

      {pendingMove && (
        <div className="warning-box" style={{ marginBottom: '12px' }}>
          <strong>Capability mismatch.</strong> {formatOrigin(pendingMove.origin)} has
          used {pendingMove.gaps.map(capabilityLabel).join(', ')} in past requests, but{' '}
          <code>{pendingMove.targetModel}</code> in <strong>{pendingMove.targetGroupName}</strong>
          {' '}does not support {pendingMove.gaps.length === 1 ? 'it' : 'one or more of these'}.
          Requests using {pendingMove.gaps.length === 1 ? 'that feature' : 'those features'}
          {' '}will fail until you switch back.
          <div style={{ display: 'flex', gap: '8px', marginTop: '8px' }}>
            <button className="btn btn-sm btn-danger" onClick={confirmPendingMove}>
              Move anyway
            </button>
            <button className="btn btn-sm btn-secondary" onClick={() => setPendingMove(null)}>
              Cancel
            </button>
          </div>
        </div>
      )}

      {sessions.length === 0 && trustedSites.length === 0 && (
        <div className="empty-state">
          <div className="empty-icon">
            <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
              <circle cx="12" cy="12" r="10" />
              <path d="M8 12h8" />
            </svg>
          </div>
          <p>No apps connected</p>
          <p style={{ fontSize: '12px', color: 'var(--text-muted)', marginBottom: 0 }}>
            When a site requests access to your wallet, it will appear here.
          </p>
        </div>
      )}

      <button
        className="btn btn-secondary btn-sm"
        style={{ marginTop: '4px', marginBottom: '12px' }}
        onClick={() => setShowCreateGroup(true)}
      >
        + New group
      </button>

      {showCreateGroup && (
        <div className="card" style={{ marginBottom: '16px' }}>
          <GroupForm
            credentials={credentials}
            giftedCredentials={giftedCredentials}
            onSave={async (patch) => {
              const id = await createGroup({
                name: patch.name ?? 'Untitled',
                providerId: patch.providerId ?? 'anthropic',
                credentialId: patch.credentialId ?? undefined,
                giftId: patch.giftId ?? undefined,
                model: patch.model ?? undefined,
              });
              if (id) setShowCreateGroup(false);
            }}
            onCancel={() => setShowCreateGroup(false)}
          />
        </div>
      )}

      {/* Groups: each is a drop target. Apps in the group are listed inside. */}
      {orderedGroups.map((group) => {
        const groupSessions = sessionsByGroup.get(group.id) ?? [];
        const provider = PROVIDERS[group.providerId];
        const pinnedCred = group.credentialId ? credentials.find((c) => c.id === group.credentialId) : undefined;
        const pinnedGift = group.giftId ? giftedCredentials.find((gc) => gc.giftId === group.giftId) : undefined;
        const isDefault = group.id === DEFAULT_GROUP_ID;
        const isDropTarget = dragOriginOver === group.id;

        return (
          <div
            key={group.id}
            className={`group-section${isDropTarget ? ' group-section--drop' : ''}`}
            style={{
              border: isDropTarget ? '2px dashed var(--accent)' : '1px solid var(--border)',
              borderRadius: '8px',
              padding: '10px',
              marginBottom: '12px',
              background: isDropTarget ? 'var(--accent-faint, rgba(99,102,241,0.06))' : 'transparent',
              transition: 'background 0.1s, border-color 0.1s',
            }}
            onDragOver={(e) => {
              if (e.dataTransfer.types.includes(DRAG_MIME)) {
                e.preventDefault();
                e.dataTransfer.dropEffect = 'move';
                if (dragOriginOver !== group.id) setDragOriginOver(group.id);
              }
            }}
            onDragLeave={(e) => {
              if (e.currentTarget.contains(e.relatedTarget as Node)) return;
              if (dragOriginOver === group.id) setDragOriginOver(null);
            }}
            onDrop={(e) => {
              e.preventDefault();
              const origin = e.dataTransfer.getData(DRAG_MIME);
              if (origin) handleDrop(group.id, origin);
            }}
          >
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '8px' }}>
              <div style={{ minWidth: 0 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                  <strong style={{ fontSize: '13px' }}>{group.name}</strong>
                  {group.providerId && <span className="badge badge-provider">{provider?.name ?? group.providerId}</span>}
                  {group.model && <span className="badge">{group.model}</span>}
                </div>
                <div className="card-subtitle" style={{ marginTop: '2px' }}>
                  {!group.providerId
                    ? 'No routing — apps use the provider they request'
                    : pinnedGift
                      ? `Using gift from ${pinnedGift.senderLabel} · ${formatTokensShort(giftBudgetRemaining(pinnedGift))} left`
                      : pinnedCred
                        ? `Using ${pinnedCred.label}`
                        : 'Any credential for this provider'}
                </div>
              </div>
              <div style={{ display: 'flex', gap: '6px' }}>
                <button className="text-link" style={{ fontSize: '12px' }} onClick={() => setEditingGroupId(editingGroupId === group.id ? null : group.id)}>
                  Edit
                </button>
                {!isDefault && (
                  <button
                    className="text-link"
                    style={{ fontSize: '12px', color: 'var(--danger)' }}
                    onClick={() => {
                      if (confirm(`Delete group "${group.name}"? Apps in this group will move back to Default.`)) {
                        deleteGroup(group.id);
                      }
                    }}
                  >
                    Delete
                  </button>
                )}
              </div>
            </div>

            {editingGroupId === group.id && (
              <GroupForm
                group={group}
                credentials={credentials}
                giftedCredentials={giftedCredentials}
                onSave={async (patch) => {
                  const ok = await updateGroup(group.id, patch);
                  if (ok) setEditingGroupId(null);
                }}
                onCancel={() => setEditingGroupId(null)}
              />
            )}

            {groupSessions.length === 0 ? (
              <div className="card-subtitle" style={{ padding: '8px 4px', fontStyle: 'italic' }}>
                {isDropTarget ? 'Drop to assign' : 'Drag an app here to assign it to this group'}
              </div>
            ) : (
              groupSessions.map((session) => {
                const usage = getOriginUsage(session.appOrigin);
                const allowance = tokenAllowances.find((a) => a.origin === session.appOrigin);
                const isEditing = editingOrigin === session.appOrigin;
                const pct = allowance?.totalLimit ? Math.min(100, (usage.total / allowance.totalLimit) * 100) : 0;
                const isOver = allowance?.totalLimit != null && usage.total >= allowance.totalLimit;

                return (
                  <div
                    key={session.id}
                    className="card connected-app-card"
                    draggable
                    onDragStart={(e) => {
                      e.dataTransfer.effectAllowed = 'move';
                      e.dataTransfer.setData(DRAG_MIME, session.appOrigin);
                    }}
                    onDragEnd={() => setDragOriginOver(null)}
                    style={{ cursor: 'grab' }}
                  >
                    <div className="card-header" style={{ marginBottom: '10px' }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '10px', minWidth: 0 }}>
                        <div className="app-favicon">
                          {formatOrigin(session.appOrigin).charAt(0).toUpperCase()}
                        </div>
                        <div style={{ minWidth: 0 }}>
                          <span className="card-title" style={{ display: 'block', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                            {formatOrigin(session.appOrigin)}
                          </span>
                          <div className="card-subtitle">
                            Connected {timeAgo(session.createdAt)}
                          </div>
                        </div>
                      </div>
                      <button
                        className="btn btn-danger btn-sm"
                        onClick={() => revokeSession(session.id)}
                      >
                        Disconnect
                      </button>
                    </div>

                    <div className="connected-providers">
                      {session.providers
                        .filter((p) => p.available)
                        .map((p) => {
                          const provider = PROVIDERS[p.providerId];
                          const isGift = p.giftId || activeGiftProviders.has(p.providerId);
                          const dstProvider = p.translation
                            ? (PROVIDERS[p.translation.dstProviderId]?.name ?? p.translation.dstProviderId)
                            : p.swap
                              ? (PROVIDERS[p.swap.dstProviderId]?.name ?? p.swap.dstProviderId)
                              : null;
                          return (
                            <span key={p.providerId} className={`badge badge-provider${isGift ? ' badge-gift-provider' : ''}`}>
                              {provider?.name ?? p.providerId}
                              {isGift && <span className="gift-indicator"> (gift)</span>}
                              {dstProvider && (
                                <span className="route-indicator" title={p.translation ? `Translated to ${dstProvider} (${p.translation.dstModel})` : `Routed to ${dstProvider}`}>
                                  {' → '}{dstProvider}
                                </span>
                              )}
                            </span>
                          );
                        })}
                    </div>

                    {/* Token usage & allowance */}
                    <div className="allowance-section">
                      <div className="allowance-usage-row">
                        <span className="allowance-used">{formatTokens(usage.total)} tokens used</span>
                        {allowance?.totalLimit != null && (
                          <span className={`allowance-limit ${isOver ? 'over' : ''}`}>
                            / {formatTokens(allowance.totalLimit)}
                          </span>
                        )}
                        <button
                          className="text-link allowance-edit-btn"
                          onClick={() => setEditingOrigin(isEditing ? null : session.appOrigin)}
                        >
                          {allowance ? 'Edit limit' : 'Set limit'}
                        </button>
                      </div>
                      {allowance?.totalLimit != null && (
                        <div className="allowance-bar">
                          <div
                            className={`allowance-bar-fill ${isOver ? 'over' : ''}`}
                            style={{ width: `${pct}%` }}
                          />
                        </div>
                      )}
                    </div>

                    {isEditing && (
                      <AllowanceForm
                        origin={session.appOrigin}
                        providers={session.providers.filter((p) => p.available).map((p) => p.providerId)}
                        allowance={allowance}
                        onSave={(a) => { setAllowance(a); setEditingOrigin(null); }}
                        onRemove={() => { removeAllowance(session.appOrigin); setEditingOrigin(null); }}
                        onCancel={() => setEditingOrigin(null)}
                      />
                    )}

                    <div className="connected-meta">
                      <span>{session.appOrigin}</span>
                    </div>
                  </div>
                );
              })
            )}
          </div>
        );
      })}

      {trustedSites.length > 0 && (
        <div style={{ marginTop: sessions.length > 0 ? '24px' : '0' }}>
          <h3 style={{ fontSize: '13px', fontWeight: 600, color: 'var(--text-secondary)', marginBottom: '10px', textTransform: 'uppercase', letterSpacing: '0.04em' }}>
            Trusted Sites
          </h3>
          <p className="card-subtitle" style={{ marginBottom: '12px' }}>
            These sites connect without asking for approval.
          </p>
          {trustedSites.map((site) => (
            <div key={site.origin} className="card">
              <div className="card-header">
                <div style={{ minWidth: 0 }}>
                  <span className="card-title" style={{ display: 'block', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {formatOrigin(site.origin)}
                  </span>
                  <div className="card-subtitle">
                    Trusted {timeAgo(site.trustedAt)}
                  </div>
                </div>
                <button
                  className="btn btn-danger btn-sm"
                  onClick={() => removeTrustedSite(site.origin)}
                >
                  Remove
                </button>
              </div>
              {site.allowedProviders && site.allowedProviders.length > 0 && (
                <div className="connected-providers" style={{ marginTop: '8px' }}>
                  {site.allowedProviders.map((id: string) => (
                    <span key={id} className="badge badge-provider">
                      {PROVIDERS[id]?.name ?? id}
                    </span>
                  ))}
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function GroupForm({
  group,
  credentials,
  giftedCredentials,
  onSave,
  onCancel,
}: {
  group?: Group;
  credentials: CredentialMeta[];
  giftedCredentials: GiftedCredential[];
  onSave: (patch: { name?: string; providerId?: string; credentialId?: string | null; giftId?: string | null; model?: string | null }) => void;
  onCancel: () => void;
}) {
  const isDefault = group?.id === DEFAULT_GROUP_ID;
  const [name, setName] = useState(group?.name ?? '');
  const [providerId, setProviderId] = useState(group?.providerId ?? (credentials[0]?.providerId ?? 'anthropic'));
  // Unified pin: the dropdown value encodes the kind as `cred:<id>` or
  // `gift:<giftId>`. Empty string means "no pin — any credential".
  const initialPin = group?.giftId ? `gift:${group.giftId}` : group?.credentialId ? `cred:${group.credentialId}` : '';
  const [pinValue, setPinValue] = useState<string>(initialPin);
  const [model, setModel] = useState(group?.model ?? '');

  const matchingCreds = credentials.filter((c) => c.providerId === providerId);
  const matchingGifts = giftedCredentials.filter(
    (gc) => gc.providerId === providerId && !isGiftExpired(gc) && gc.usedTokens < gc.maxTokens,
  );
  const hasAnyPinnable = matchingCreds.length > 0 || matchingGifts.length > 0;
  // Pull the @byoky/core registry's known models for the chosen provider.
  // Empty list means the registry has no entries — the user can still type
  // a custom model name. Mobile builds the same suggestion list via the JS
  // bridge call `getModelsForProvider`; in the extension we can call the
  // registry directly since both run in the same JS context.
  const suggestedModels = modelsForProvider(providerId);
  // Look up the chosen model id in the registry and produce a one-line
  // capability summary for the footer beneath the field. Nil when the model
  // isn't in the registry — that's fine, the field still accepts custom names.
  const selectedModel = model ? getModel(model) : undefined;
  const modelInfo = selectedModel ? buildModelInfo(selectedModel) : undefined;

  function handleSave() {
    const credentialId = pinValue.startsWith('cred:') ? pinValue.slice(5) : null;
    const giftId = pinValue.startsWith('gift:') ? pinValue.slice(5) : null;
    onSave({
      name: isDefault ? undefined : name,
      providerId,
      credentialId,
      giftId,
      model: model || null,
    });
  }

  return (
    <div style={{ marginTop: '8px' }}>
      {!isDefault && (
        <div className="form-group">
          <label>Group name</label>
          <input
            type="text"
            placeholder="e.g. Engineering"
            value={name}
            onChange={(e) => setName(e.target.value)}
            maxLength={200}
          />
        </div>
      )}
      <div className="form-group">
        <label>Provider</label>
        <select
          value={providerId}
          onChange={(e) => {
            setProviderId(e.target.value);
            setPinValue('');
          }}
        >
          {Object.values(PROVIDERS).map((p) => (
            <option key={p.id} value={p.id}>{p.name}</option>
          ))}
        </select>
      </div>
      {hasAnyPinnable ? (
        <div className="form-group">
          <label>Credential (optional)</label>
          <select value={pinValue} onChange={(e) => setPinValue(e.target.value)}>
            <option value="">Any {PROVIDERS[providerId]?.name ?? providerId} credential</option>
            {matchingCreds.length > 0 && (
              <optgroup label="Your credentials">
                {matchingCreds.map((c) => (
                  <option key={c.id} value={`cred:${c.id}`}>{c.label}</option>
                ))}
              </optgroup>
            )}
            {matchingGifts.length > 0 && (
              <optgroup label="Gifts">
                {matchingGifts.map((gc) => (
                  <option key={gc.giftId} value={`gift:${gc.giftId}`}>
                    {`🎁 ${gc.senderLabel} · ${formatTokensShort(giftBudgetRemaining(gc))} left`}
                  </option>
                ))}
              </optgroup>
            )}
          </select>
        </div>
      ) : (
        // Inline warning when the chosen provider has no credentials AND no
        // active gifts in the wallet. The save still goes through
        // (permissive mode) but the user is told up front that this group
        // won't actually work until a credential is added — and is shown
        // how to fix it.
        <div className="form-group group-warning">
          <div className="group-warning-icon" aria-hidden>⚠️</div>
          <div className="group-warning-body">
            <div className="group-warning-title">
              No {PROVIDERS[providerId]?.name ?? providerId} credential or gift
            </div>
            <div className="group-warning-text">
              This group can be saved, but apps using it will fail until you add a {PROVIDERS[providerId]?.name ?? providerId} key or redeem a matching gift.
            </div>
          </div>
        </div>
      )}
      <div className="form-group">
        <label>Default model (optional)</label>
        <input
          type="text"
          placeholder="e.g. claude-sonnet-4-5"
          value={model}
          onChange={(e) => setModel(e.target.value)}
          maxLength={200}
          list={`group-models-${providerId}`}
        />
        {/* Native datalist gives the input a typeahead dropdown over the
            registry entries for the chosen provider, while still letting the
            user type custom model ids the registry doesn't know about. */}
        <datalist id={`group-models-${providerId}`}>
          {suggestedModels.map((m) => (
            <option key={m.id} value={m.id}>{m.displayName}</option>
          ))}
        </datalist>
        <div className="card-subtitle" style={{ marginTop: '4px' }}>
          {modelInfo ?? 'Leave empty to pass through whatever model the app requested. Set when you want to override — required for cross-family routing.'}
        </div>
      </div>
      <div style={{ display: 'flex', gap: '8px' }}>
        <button className="btn btn-primary btn-sm" onClick={handleSave}>Save</button>
        <button className="btn btn-secondary btn-sm" onClick={onCancel}>Cancel</button>
      </div>
    </div>
  );
}

/**
 * Build a one-line capability summary for a known model id, e.g.
 * "Claude Sonnet 4.5: 200K ctx · tools · vision · reasoning". Mirrors the
 * mobile group editor's `updateModelInfo` so the extension and mobile show
 * the same footer when a registry-known model is selected.
 */
function buildModelInfo(m: ReturnType<typeof getModel> & {}): string {
  const bits: string[] = [];
  if (m.capabilities.tools) bits.push('tools');
  if (m.capabilities.vision) bits.push('vision');
  if (m.capabilities.structuredOutput) bits.push('JSON schema');
  if (m.capabilities.reasoning) bits.push('reasoning');
  const ctx = m.contextWindow;
  const ctxK = ctx >= 1000 ? `${Math.round(ctx / 1000)}K` : `${ctx}`;
  return `${m.displayName}: ${ctxK} ctx · ${bits.join(' · ')}`;
}

function AllowanceForm({
  origin,
  providers,
  allowance,
  onSave,
  onRemove,
  onCancel,
}: {
  origin: string;
  providers: string[];
  allowance?: TokenAllowance;
  onSave: (a: TokenAllowance) => void;
  onRemove: () => void;
  onCancel: () => void;
}) {
  const [totalLimit, setTotalLimit] = useState(
    allowance?.totalLimit != null ? String(allowance.totalLimit) : '',
  );
  const [providerLimits, setProviderLimits] = useState<Record<string, string>>(
    Object.fromEntries(
      providers.map((id) => [id, allowance?.providerLimits?.[id] != null ? String(allowance.providerLimits[id]) : '']),
    ),
  );

  function handleSave() {
    const parsed: TokenAllowance = { origin };
    const total = parseInt(totalLimit, 10);
    if (!isNaN(total) && total > 0) parsed.totalLimit = total;

    const pLimits: Record<string, number> = {};
    for (const [id, val] of Object.entries(providerLimits)) {
      const n = parseInt(val, 10);
      if (!isNaN(n) && n > 0) pLimits[id] = n;
    }
    if (Object.keys(pLimits).length > 0) parsed.providerLimits = pLimits;

    onSave(parsed);
  }

  return (
    <div className="allowance-form">
      <div className="allowance-field">
        <label>Total token limit</label>
        <input
          type="number"
          placeholder="Unlimited"
          value={totalLimit}
          onChange={(e) => setTotalLimit(e.target.value)}
          min="0"
        />
      </div>
      {providers.length > 0 && (
        <div className="allowance-provider-limits">
          <label className="allowance-sub-label">Per provider</label>
          {providers.map((id) => (
            <div key={id} className="allowance-field allowance-field-inline">
              <span className="allowance-provider-name">{PROVIDERS[id]?.name ?? id}</span>
              <input
                type="number"
                placeholder="Unlimited"
                value={providerLimits[id] ?? ''}
                onChange={(e) => setProviderLimits({ ...providerLimits, [id]: e.target.value })}
                min="0"
              />
            </div>
          ))}
        </div>
      )}
      <div className="allowance-actions">
        <button className="btn btn-primary btn-sm" onClick={handleSave}>Save</button>
        {allowance && (
          <button className="btn btn-danger btn-sm" onClick={onRemove}>Remove limit</button>
        )}
        <button className="btn btn-ghost btn-sm" onClick={onCancel}>Cancel</button>
      </div>
    </div>
  );
}

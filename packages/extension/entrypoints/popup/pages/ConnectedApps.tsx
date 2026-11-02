import { useEffect, useId, useRef, useState, type ReactNode } from 'react';
import { useWalletStore } from '../store';
import { TrustResetNotice } from '../components/TrustResetNotice';
import { LimitsHoldNotice } from '../components/LimitsHoldNotice';
import { FormError } from '../components/FormError';
import {
  PROVIDERS,
  type TokenAllowance, type Group, type Session, type CredentialMeta,
  type CapabilitySet,
  DEFAULT_GROUP_ID,
  detectAppCapabilities,
  capabilityGaps,
  capabilityLabel,
  getModel,
  modelsForProvider,
  autoRouteModelFor,
} from '@byoky/core';
import { describeOrigin } from '../utils/origin';
import { parseTokenLimit } from '../utils/token-limit';

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
  return describeOrigin(origin).label;
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
    requestLog, tokenAllowances, tokenUsage, setAllowance, removeAllowance, resetAppUsage,
    groups, appGroups, credentials,
    createGroup, updateGroup, deleteGroup, setAppGroup,
    error, clearError, modal, limitsHold,
  } = useWalletStore();
  const [editingOrigin, setEditingOrigin] = useState<string | null>(null);
  const [editingGroupId, setEditingGroupId] = useState<string | null>(null);
  const [showCreateGroup, setShowCreateGroup] = useState(false);
  const [dragOriginOver, setDragOriginOver] = useState<string | null>(null);
  // Destructive actions ask first, inline (see InlineConfirm).
  const [confirmingDisconnectAll, setConfirmingDisconnectAll] = useState(false);
  const [confirmingDeleteGroup, setConfirmingDeleteGroup] = useState<string | null>(null);
  const [confirmingRemoveSite, setConfirmingRemoveSite] = useState<string | null>(null);
  // Set while the pointer is down on a card's Group select, so pressing it
  // doesn't start dragging the card.
  const pressingGroupSelect = useRef(false);
  const [pendingMove, setPendingMove] = useState<{
    origin: string;
    targetGroupId: string;
    gaps: (keyof CapabilitySet)[];
    targetGroupName: string;
    targetModel: string;
  } | null>(null);

  // Disconnect all goes when one app or none is left; so does its question.
  useEffect(() => {
    if (sessions.length <= 1) setConfirmingDisconnectAll(false);
  }, [sessions.length]);

  // Lifetime totals, the numbers allowances are enforced against (the
  // request log only keeps the last 500 entries).
  function getOriginUsage(origin: string) {
    const byProvider = { ...(tokenUsage[origin] ?? {}) };
    const total = Object.values(byProvider).reduce((sum, n) => sum + n, 0);
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

  // Both ways of moving an app end here: dropping its card on a group, and
  // its Group select (the keyboard, screen reader and touch way).
  async function requestMove(targetGroupId: string, origin: string) {
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

  // While apps are paused after an integrity check failed, the user is
  // asked to check every app's limit and usage before resuming them. Apps
  // that aren't connected have no card, so those with a limit or usage are
  // listed on their own.
  const connectedOrigins = new Set(sessions.map((s) => s.appOrigin));
  const unconnectedOrigins = limitsHold
    ? [...new Set([...tokenAllowances.map((a) => a.origin), ...Object.keys(tokenUsage)])]
      .filter((origin) => !connectedOrigins.has(origin))
      .sort()
    : [];

  // An edit closes its form once the background took it; a refused one
  // leaves the form open with the reason.
  async function finishAllowanceEdit(edit: Promise<boolean>) {
    if (await edit) setEditingOrigin(null);
  }

  /** An app's usage against its limit, and the form that edits both. */
  function allowanceSection(origin: string, providers: string[]) {
    const usage = getOriginUsage(origin);
    const allowance = tokenAllowances.find((a) => a.origin === origin);
    const isEditing = editingOrigin === origin;
    const isOver = allowance?.totalLimit != null && usage.total >= allowance.totalLimit;
    // A limit of 0 blocks the app: always full.
    const pct = allowance?.totalLimit == null ? 0 : isOver ? 100 : (usage.total / allowance.totalLimit) * 100;
    return (
      <>
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
              onClick={() => {
                clearError();
                setEditingOrigin(isEditing ? null : origin);
              }}
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
            origin={origin}
            providers={providers}
            allowance={allowance}
            error={error}
            onSave={(a) => finishAllowanceEdit(setAllowance(a))}
            onRemove={() => finishAllowanceEdit(removeAllowance(origin))}
            onResetUsage={usage.total > 0 ? () => finishAllowanceEdit(resetAppUsage(origin)) : undefined}
            onCancel={() => {
              clearError();
              setEditingOrigin(null);
            }}
          />
        )}
      </>
    );
  }

  // Errors from creating or editing a group or a limit show in its form,
  // and the add credential sheet shows its own; the rest (moving an app,
  // deleting a group) show here.
  const allowanceFormOpen = editingOrigin !== null
    && (connectedOrigins.has(editingOrigin) || unconnectedOrigins.includes(editingOrigin));
  const formOpen = showCreateGroup || editingGroupId !== null || modal !== null || allowanceFormOpen;

  return (
    <div>
      <LimitsHoldNotice />
      <TrustResetNotice />
      {error && !formOpen && <FormError>{error}</FormError>}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '16px' }}>
        <h2 className="page-title" style={{ marginBottom: 0 }}>Connected Apps</h2>
        {sessions.length > 1 && (
          <button
            className="text-link bracket-link"
            style={{ color: 'var(--danger)', fontSize: '11px' }}
            onClick={() => setConfirmingDisconnectAll(true)}
          >
            Disconnect all
          </button>
        )}
      </div>

      {confirmingDisconnectAll && (
        <InlineConfirm
          confirmLabel="Disconnect all"
          onCancel={() => setConfirmingDisconnectAll(false)}
          onConfirm={() => {
            setConfirmingDisconnectAll(false);
            sessions.forEach((s) => revokeSession(s.id));
          }}
        >
          Disconnect {sessions.length} apps? Every connected app loses access to your keys until
          you approve it again.
        </InlineConfirm>
      )}

      {sessions.length > 0 && (
        <div className="warning-box" style={{ marginBottom: '12px' }}>
          <strong>Device must stay online.</strong> Connected apps can only make
          requests while your browser is running and this extension is active.
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

      {unconnectedOrigins.length > 0 && (
        <div className="group-section">
          <h3 className="section-label">Apps not connected now</h3>
          <p className="card-subtitle" style={{ marginBottom: '12px' }}>
            Their limits apply when they connect again.
          </p>
          {unconnectedOrigins.map((origin) => {
            const allowance = tokenAllowances.find((a) => a.origin === origin);
            const providers = [...new Set([
              ...Object.keys(allowance?.providerLimits ?? {}),
              ...Object.keys(tokenUsage[origin] ?? {}),
            ])];
            return (
              <div key={origin} className="card connected-app-card">
                <div className="card-header" style={{ marginBottom: '10px' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '10px', minWidth: 0 }}>
                    <div className="app-favicon">
                      {formatOrigin(origin).charAt(0).toUpperCase()}
                    </div>
                    <span className="card-title" title={origin} style={{ display: 'block', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      {formatOrigin(origin)}
                    </span>
                  </div>
                </div>
                {allowanceSection(origin, providers)}
                <div className="connected-meta">
                  <span>{origin}</span>
                </div>
              </div>
            );
          })}
        </div>
      )}

      <button
        className="btn btn-secondary btn-sm"
        style={{ marginTop: '4px', marginBottom: '12px' }}
        onClick={() => {
          clearError();
          setEditingGroupId(null);
          setShowCreateGroup(true);
        }}
      >
        + New group
      </button>

      {showCreateGroup && (
        <div className="card" style={{ marginBottom: '16px' }}>
          <GroupForm
            credentials={credentials}
            error={error}
            onSave={async (patch) => {
              const id = await createGroup({
                name: patch.name,
                providerId: patch.providerId,
                credentialId: patch.credentialId ?? undefined,
                model: patch.model ?? undefined,
              });
              if (id) setShowCreateGroup(false);
            }}
            onCancel={() => {
              clearError();
              setShowCreateGroup(false);
            }}
          />
        </div>
      )}

      {/* Groups: each is a drop target. Apps in the group are listed inside. */}
      {orderedGroups.map((group) => {
        const groupSessions = sessionsByGroup.get(group.id) ?? [];
        const provider = PROVIDERS[group.providerId];
        const pinnedCred = group.credentialId ? credentials.find((c) => c.id === group.credentialId) : undefined;
        const isDefault = group.id === DEFAULT_GROUP_ID;
        const isDropTarget = dragOriginOver === group.id;

        return (
          <div
            key={group.id}
            className={`group-section${isDropTarget ? ' group-section--drop' : ''}`}
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
              if (origin) requestMove(group.id, origin);
            }}
          >
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '8px' }}>
              <div style={{ minWidth: 0 }}>
                <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: '6px' }}>
                  <strong className="group-name">{group.name}</strong>
                  {group.providerId && <span className="badge badge-provider">{provider?.name ?? group.providerId}</span>}
                  {group.model && <span className="badge">{group.model}</span>}
                </div>
                <div className="card-subtitle" style={{ marginTop: '2px' }}>
                  {!group.providerId
                    ? 'No routing — apps use the provider they request'
                    : pinnedCred
                      ? `Using ${pinnedCred.label}`
                      : 'Any credential for this provider'}
                </div>
              </div>
              {/* The default group stays routing-neutral (ensureDefaultGroup
                  resets it), so it has nothing to edit or delete. */}
              {!isDefault && (
                <div style={{ display: 'flex', gap: '6px' }}>
                  <button
                    className="text-link bracket-link"
                    style={{ fontSize: '11px' }}
                    onClick={() => {
                      clearError();
                      setShowCreateGroup(false);
                      setEditingGroupId(editingGroupId === group.id ? null : group.id);
                    }}
                  >
                    Edit
                  </button>
                  <button
                    className="text-link bracket-link"
                    style={{ fontSize: '11px', color: 'var(--danger)' }}
                    onClick={() => setConfirmingDeleteGroup(group.id)}
                  >
                    Delete
                  </button>
                </div>
              )}
            </div>

            {confirmingDeleteGroup === group.id && (
              <InlineConfirm
                confirmLabel="Delete"
                onCancel={() => setConfirmingDeleteGroup(null)}
                onConfirm={() => {
                  setConfirmingDeleteGroup(null);
                  deleteGroup(group.id);
                }}
              >
                Delete group &ldquo;{group.name}&rdquo;? Apps in this group will move back to Default.
              </InlineConfirm>
            )}

            {editingGroupId === group.id && (
              <GroupForm
                group={group}
                credentials={credentials}
                error={error}
                onSave={async (patch) => {
                  const ok = await updateGroup(group.id, patch);
                  if (ok) setEditingGroupId(null);
                }}
                onCancel={() => {
                  clearError();
                  setEditingGroupId(null);
                }}
              />
            )}

            {groupSessions.length === 0 ? (
              <div className="card-subtitle mono" style={{ padding: '8px 4px' }}>
                {isDropTarget ? 'Drop to assign' : 'Drag an app here, or use Group on an app card'}
              </div>
            ) : (
              groupSessions.map((session) => {
                return (
                  <div
                    key={session.id}
                    className="card connected-app-card"
                    draggable
                    onPointerDown={(e) => {
                      pressingGroupSelect.current = (e.target as Element).closest('select') !== null;
                    }}
                    onDragStart={(e) => {
                      if (pressingGroupSelect.current) {
                        e.preventDefault();
                        return;
                      }
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
                          <span className="card-title" title={session.appOrigin} style={{ display: 'block', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                            {formatOrigin(session.appOrigin)}
                          </span>
                          <div className="card-subtitle mono">
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
                          const dstProvider = p.translation
                            ? (PROVIDERS[p.translation.dstProviderId]?.name ?? p.translation.dstProviderId)
                            : p.swap
                              ? (PROVIDERS[p.swap.dstProviderId]?.name ?? p.swap.dstProviderId)
                              : null;
                          return (
                            <span key={p.providerId} className="badge badge-provider">
                              {provider?.name ?? p.providerId}
                              {dstProvider && (
                                <span className="route-indicator" title={p.translation ? `Translated to ${dstProvider} (${p.translation.dstModel})` : `Routed to ${dstProvider}`}>
                                  {' → '}{dstProvider}
                                </span>
                              )}
                            </span>
                          );
                        })}
                    </div>

                    {orderedGroups.length > 1 && (
                      <label className="app-group-field">
                        <span>Group</span>
                        <select
                          aria-label={`Group for ${session.appOrigin}`}
                          value={group.id}
                          onChange={(e) => requestMove(e.target.value, session.appOrigin)}
                        >
                          {orderedGroups.map((g) => (
                            <option key={g.id} value={g.id}>{g.name}</option>
                          ))}
                        </select>
                      </label>
                    )}

                    {/* Token usage & allowance */}
                    {allowanceSection(session.appOrigin, session.providers.filter((p) => p.available).map((p) => p.providerId))}

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
          <h3 className="section-label">
            Trusted Sites
          </h3>
          <p className="card-subtitle" style={{ marginBottom: '12px' }}>
            These sites connect without asking for approval.
          </p>
          {trustedSites.map((site) => {
            // Trusted before plain-http sites couldn't be: it asks again, and
            // shows its scheme so it can't pass for the https site.
            const { label, insecure } = describeOrigin(site.origin);
            return (
              <div key={site.origin} className="card">
                <div className="card-header">
                  <div style={{ minWidth: 0 }}>
                    <span className="card-title" title={site.origin} style={{ display: 'block', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      {insecure ? site.origin : label}
                    </span>
                    <div className="card-subtitle mono">
                      Trusted {timeAgo(site.trustedAt)}
                    </div>
                    {insecure && (
                      <div className="card-subtitle trusted-site-insecure">
                        <span className="result-tag alarm">Not secure</span>
                        {' '}Plain http, so it asks before connecting.
                      </div>
                    )}
                  </div>
                  <button
                    className="btn btn-danger btn-sm"
                    onClick={() => setConfirmingRemoveSite(site.origin)}
                  >
                    Remove
                  </button>
                </div>
                {confirmingRemoveSite === site.origin && (
                  <InlineConfirm
                    confirmLabel="Remove"
                    onCancel={() => setConfirmingRemoveSite(null)}
                    onConfirm={() => {
                      setConfirmingRemoveSite(null);
                      removeTrustedSite(site.origin);
                    }}
                  >
                    Stop trusting {insecure ? site.origin : label}? Its next connect will ask for approval.
                  </InlineConfirm>
                )}
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
            );
          })}
        </div>
      )}
    </div>
  );
}

/**
 * Asks before a destructive action, inline: popups can't rely on
 * window.confirm (Firefox doesn't show dialogs from extension popups).
 * Focus starts on Cancel; Escape cancels, and cancelling gives focus back
 * to the button that asked.
 */
function InlineConfirm({ children, confirmLabel, onConfirm, onCancel }: {
  children: ReactNode;
  confirmLabel: string;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  const id = useId();
  // Read while rendering, before Cancel takes focus.
  const [opener] = useState(() => document.activeElement);

  function cancel() {
    onCancel();
    if (opener instanceof HTMLElement && opener.isConnected) opener.focus();
  }

  return (
    <div
      className="warning-box inline-confirm"
      role="group"
      aria-labelledby={id}
      onKeyDown={(e) => {
        if (e.key === 'Escape') {
          e.preventDefault();
          e.stopPropagation();
          cancel();
        }
      }}
    >
      <div id={id}>{children}</div>
      <div className="inline-confirm-actions">
        <button type="button" className="btn btn-secondary btn-sm" onClick={cancel} autoFocus>
          Cancel
        </button>
        <button type="button" className="btn btn-danger btn-sm" onClick={onConfirm}>
          {confirmLabel}
        </button>
      </div>
    </div>
  );
}

function GroupForm({
  group,
  credentials,
  error,
  onSave,
  onCancel,
}: {
  group?: Group;
  credentials: CredentialMeta[];
  /** Why the last save was refused (the background checks the name). */
  error: string | null;
  onSave: (patch: { name: string; providerId: string; credentialId: string | null; model: string | null }) => void;
  onCancel: () => void;
}) {
  const [name, setName] = useState(group?.name ?? '');
  const [providerId, setProviderId] = useState(group?.providerId ?? (credentials[0]?.providerId ?? 'anthropic'));
  // Credential pin. Empty string means "no pin — any credential".
  const [credentialId, setCredentialId] = useState<string>(group?.credentialId ?? '');
  const [model, setModel] = useState(group?.model ?? '');
  // The form shows for a new group and for each group being edited, so its
  // ids (labels, the model list) must not repeat.
  const uid = useId();

  const matchingCreds = credentials.filter((c) => c.providerId === providerId);
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
  // Without a model, apps routed here from another family get the provider's
  // routing default (F099); providers without one (most OpenAI-compatible
  // hosts, Azure, local servers) need a model for that.
  const routingDefault = providerId ? autoRouteModelFor(providerId) : undefined;
  const providerName = PROVIDERS[providerId]?.name ?? providerId;
  const modelHint = routingDefault
    ? `Leave empty to pass through whatever model the app requested; apps routed here from another provider family get ${routingDefault}. Set one to override.`
    : `Leave empty to pass through whatever model the app requested. Set one to override, and to route apps from another provider family here: ${providerName || 'this provider'} has no default model.`;

  // The background trims the name and refuses an empty one.
  const trimmedName = name.trim();

  function handleSave() {
    if (!trimmedName) return;
    onSave({
      name: trimmedName,
      providerId,
      credentialId: credentialId || null,
      model: model || null,
    });
  }

  return (
    <div style={{ marginTop: '8px' }}>
      <div className="form-group">
        <label htmlFor={`${uid}-name`}>Group name</label>
        <input
          id={`${uid}-name`}
          type="text"
          placeholder="e.g. Engineering"
          value={name}
          onChange={(e) => setName(e.target.value)}
          maxLength={200}
          aria-describedby={error ? `${uid}-error` : undefined}
        />
      </div>
      <div className="form-group">
        <label htmlFor={`${uid}-provider`}>Provider</label>
        <select
          id={`${uid}-provider`}
          value={providerId}
          onChange={(e) => {
            setProviderId(e.target.value);
            setCredentialId('');
          }}
        >
          {Object.values(PROVIDERS).map((p) => (
            <option key={p.id} value={p.id}>{p.name}</option>
          ))}
        </select>
      </div>
      {matchingCreds.length > 0 ? (
        <div className="form-group">
          <label htmlFor={`${uid}-cred`}>Credential (optional)</label>
          <select id={`${uid}-cred`} value={credentialId} onChange={(e) => setCredentialId(e.target.value)}>
            <option value="">Any {PROVIDERS[providerId]?.name ?? providerId} credential</option>
            {matchingCreds.map((c) => (
              <option key={c.id} value={c.id}>{c.label}</option>
            ))}
          </select>
        </div>
      ) : (
        // Inline warning when the chosen provider has no credentials in the
        // wallet. The save still goes through (permissive mode) but the user
        // is told up front that this group won't actually work until a
        // credential is added — and is shown how to fix it.
        <div className="form-group group-warning">
          <div className="group-warning-icon" aria-hidden>!</div>
          <div className="group-warning-body">
            <div className="group-warning-title">
              No {PROVIDERS[providerId]?.name ?? providerId} credential
            </div>
            <div className="group-warning-text">
              This group can be saved, but apps using it will fail until you add a {PROVIDERS[providerId]?.name ?? providerId} key.
            </div>
          </div>
        </div>
      )}
      <div className="form-group">
        <label htmlFor={`${uid}-model`}>Default model (optional)</label>
        <input
          id={`${uid}-model`}
          type="text"
          placeholder="e.g. claude-sonnet-5-5"
          value={model}
          onChange={(e) => setModel(e.target.value)}
          maxLength={200}
          list={`${uid}-models-${providerId}`}
          aria-describedby={`${uid}-model-hint`}
        />
        {/* Native datalist gives the input a typeahead dropdown over the
            registry entries for the chosen provider, while still letting the
            user type custom model ids the registry doesn't know about. */}
        <datalist id={`${uid}-models-${providerId}`}>
          {suggestedModels.map((m) => (
            <option key={m.id} value={m.id}>{m.displayName}</option>
          ))}
        </datalist>
        <div id={`${uid}-model-hint`} className="card-subtitle" style={{ marginTop: '4px' }}>
          {modelInfo ?? modelHint}
        </div>
      </div>
      {error && <FormError id={`${uid}-error`}>{error}</FormError>}
      <div style={{ display: 'flex', gap: '8px' }}>
        <button className="btn btn-primary btn-sm" onClick={handleSave} disabled={!trimmedName}>Save</button>
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
  onResetUsage,
  onCancel,
  error,
}: {
  origin: string;
  providers: string[];
  allowance?: TokenAllowance;
  /** Why the last edit was refused (the wallet locked, say). */
  error: string | null;
  onSave: (a: TokenAllowance) => void;
  onRemove: () => void;
  /** Start counting from zero again; absent when nothing has been used. */
  onResetUsage?: () => void;
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
  // Each app card has its own form, so its ids must not repeat.
  const uid = useId();
  // Fields that don't hold a whole number of tokens, by 'total' or provider
  // id, from the last Save; editing one clears it.
  const [invalid, setInvalid] = useState<string[]>([]);
  const errorId = `${uid}-error`;

  function edited(field: string) {
    if (invalid.includes(field)) setInvalid(invalid.filter((f) => f !== field));
  }

  // A field that doesn't parse never saves as "no limit": the app would run
  // uncapped. Empty is no limit, 0 blocks the app.
  function handleSave() {
    const total = parseTokenLimit(totalLimit);
    const perProvider = Object.entries(providerLimits).map(([id, val]) => [id, parseTokenLimit(val)] as const);
    const bad = [
      ...(total === 'invalid' ? ['total'] : []),
      ...perProvider.filter(([, n]) => n === 'invalid').map(([id]) => id),
    ];
    setInvalid(bad);
    if (bad.length > 0) return;

    const parsed: TokenAllowance = { origin };
    if (typeof total === 'number') parsed.totalLimit = total;
    const pLimits: Record<string, number> = {};
    for (const [id, n] of perProvider) if (typeof n === 'number') pLimits[id] = n;
    if (Object.keys(pLimits).length > 0) parsed.providerLimits = pLimits;

    // Nothing left to limit: no record that reads as "Edit limit" but holds none.
    if (parsed.totalLimit === undefined && !parsed.providerLimits) {
      if (allowance) onRemove();
      else onCancel();
      return;
    }
    onSave(parsed);
  }

  /** Marks a field that didn't parse and points it at the message. */
  function fieldError(field: string) {
    const bad = invalid.includes(field);
    return { 'aria-invalid': bad, 'aria-describedby': bad ? errorId : undefined };
  }

  return (
    <div className="allowance-form">
      <div className="allowance-field">
        <label htmlFor={`${uid}-total`}>Total token limit</label>
        <input
          id={`${uid}-total`}
          type="text"
          inputMode="numeric"
          autoComplete="off"
          placeholder="Unlimited"
          value={totalLimit}
          onChange={(e) => {
            setTotalLimit(e.target.value);
            edited('total');
          }}
          {...fieldError('total')}
        />
      </div>
      {providers.length > 0 && (
        <fieldset className="allowance-provider-limits">
          <legend className="allowance-sub-label">Per provider</legend>
          {providers.map((id) => (
            <div key={id} className="allowance-field allowance-field-inline">
              <span id={`${uid}-provider-${id}`} className="allowance-provider-name">{PROVIDERS[id]?.name ?? id}</span>
              <input
                aria-labelledby={`${uid}-provider-${id}`}
                type="text"
                inputMode="numeric"
                autoComplete="off"
                placeholder="Unlimited"
                value={providerLimits[id] ?? ''}
                onChange={(e) => {
                  setProviderLimits({ ...providerLimits, [id]: e.target.value });
                  edited(id);
                }}
                {...fieldError(id)}
              />
            </div>
          ))}
        </fieldset>
      )}
      <p className="allowance-hint">Empty means no limit; 0 blocks the app.</p>
      {invalid.length > 0
        ? <FormError id={errorId}>Enter a whole number of tokens, or leave it empty for no limit.</FormError>
        : error && <FormError>{error}</FormError>}
      <div className="allowance-actions">
        <button className="btn btn-primary btn-sm" onClick={handleSave}>Save</button>
        {allowance && (
          <button className="btn btn-danger btn-sm" onClick={onRemove}>Remove limit</button>
        )}
        {onResetUsage && (
          <button className="btn btn-ghost btn-sm" onClick={onResetUsage}>Reset usage</button>
        )}
        <button className="btn btn-ghost btn-sm" onClick={onCancel}>Cancel</button>
      </div>
    </div>
  );
}

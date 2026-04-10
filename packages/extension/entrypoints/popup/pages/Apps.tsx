import { useWalletStore } from '../store';
import type { InstalledApp } from '@byoky/core';

export function Apps() {
  const { installedApps, navigate, toggleApp, uninstallApp } = useWalletStore();
  const enabledApps = installedApps.filter((a) => a.enabled);
  const disabledApps = installedApps.filter((a) => !a.enabled);

  return (
    <div>
      <div className="page-title-row">
        <h2 className="page-title">Apps</h2>
        <button
          className="btn btn-sm btn-primary"
          onClick={() => navigate('app-store')}
        >
          + Store
        </button>
      </div>

      {installedApps.length === 0 ? (
        <div className="empty-state">
          <p>No apps installed</p>
          <p>Browse the store to find apps that use your API keys.</p>
          <button
            className="btn btn-primary"
            style={{ marginTop: 16, width: 'auto' }}
            onClick={() => navigate('app-store')}
          >
            Browse Store
          </button>
        </div>
      ) : (
        <>
          <div className="app-grid">
            {enabledApps.map((app) => (
              <AppIcon key={app.id} app={app} />
            ))}
          </div>

          {disabledApps.length > 0 && (
            <>
              <p className="section-label" style={{ marginTop: 20 }}>Disabled</p>
              <div className="app-grid">
                {disabledApps.map((app) => (
                  <AppIcon key={app.id} app={app} />
                ))}
              </div>
            </>
          )}
        </>
      )}
    </div>
  );
}

function AppIcon({ app }: { app: InstalledApp }) {
  const { navigate, setActiveApp, toggleApp, uninstallApp } = useWalletStore();

  function handleClick() {
    if (!app.enabled) return;
    setActiveApp(app);
    navigate('app-view');
  }

  return (
    <div className={`app-icon-card ${!app.enabled ? 'disabled' : ''}`}>
      <button className="app-icon-btn" onClick={handleClick} title={app.name}>
        {app.icon ? (
          <img src={app.icon} alt={app.name} className="app-icon-img" />
        ) : (
          <div className="app-icon-placeholder">
            {app.name.charAt(0).toUpperCase()}
          </div>
        )}
      </button>
      <span className="app-icon-label">{app.name}</span>
      <div className="app-icon-actions">
        <button
          className="app-icon-action"
          onClick={() => toggleApp(app.id)}
          title={app.enabled ? 'Disable' : 'Enable'}
        >
          {app.enabled ? (
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M18.36 6.64A9 9 0 0 1 20.77 15" /><path d="M6.16 6.16a9 9 0 1 0 12.68 12.68" /><line x1="2" y1="2" x2="22" y2="22" /><line x1="12" y1="2" x2="12" y2="6" /></svg>
          ) : (
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M18.36 6.64a9 9 0 1 1-12.73 0" /><line x1="12" y1="2" x2="12" y2="12" /></svg>
          )}
        </button>
        <button
          className="app-icon-action danger"
          onClick={() => {
            if (confirm(`Uninstall ${app.name}?`)) uninstallApp(app.id);
          }}
          title="Uninstall"
        >
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" /></svg>
        </button>
      </div>
    </div>
  );
}

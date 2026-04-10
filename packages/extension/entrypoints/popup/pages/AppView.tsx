import { useWalletStore } from '../store';

export function AppView() {
  const { activeApp, navigate } = useWalletStore();

  if (!activeApp) {
    navigate('apps');
    return null;
  }

  return (
    <div className="app-view">
      <div className="app-view-header">
        <button className="text-link" onClick={() => navigate('apps')}>
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <polyline points="15 18 9 12 15 6" />
          </svg>
          {activeApp.name}
        </button>
      </div>
      <iframe
        src={activeApp.url}
        className="app-view-iframe"
        sandbox="allow-scripts allow-forms allow-popups allow-same-origin"
        referrerPolicy="no-referrer"
        title={activeApp.name}
      />
    </div>
  );
}

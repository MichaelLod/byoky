import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';
import { showsInTab } from './utils/surface';
import './App.css';

// In a tab or a window of its own (the fallback where there is no side
// panel), the page has a real viewport and keeps the fluid layout of the side
// panel. Only the toolbar popup needs the fixed size.
const getViews = browser.extension?.getViews
  ? (filter: { type: 'popup' | 'tab' }) => browser.extension.getViews(filter)
  : undefined;
if (showsInTab(window, getViews)) {
  document.documentElement.classList.remove('popup');
}

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);

import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';
import './App.css';

// Opened as a window (the fallback where there is no side panel), the page
// has a real viewport and keeps the fluid layout of the side panel.
if (new URLSearchParams(window.location.search).has('window')) {
  document.documentElement.classList.remove('popup');
}

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);

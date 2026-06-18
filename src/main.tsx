import React from 'react';
import ReactDOM from 'react-dom/client';
import { BrowserRouter, Routes, Route } from 'react-router';
import './index.css';
import App from './App';
import GlobePage from './pages/v2/GlobePage';
import CanvasPage from './pages/v2/CanvasPage';
import ScenariosPage from './pages/v2/ScenariosPage';
import ToursPage from './pages/v2/ToursPage';
import { AuthProvider } from './context/AuthContext';

if (import.meta.env.PROD && 'serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/sw.js').catch(() => {});
  });
}

ReactDOM.createRoot(document.getElementById('root')!).render(
  <AuthProvider>
    <BrowserRouter>
      <Routes>
        <Route path="/" element={<App />} />
        <Route path="/v2/globe" element={<GlobePage />} />
        <Route path="/v2/canvas" element={<CanvasPage />} />
        <Route path="/v2/scenarios" element={<ScenariosPage />} />
        <Route path="/v2/tours" element={<ToursPage />} />
      </Routes>
    </BrowserRouter>
  </AuthProvider>,
);

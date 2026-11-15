import React from 'react';
import { createRoot } from 'react-dom/client';
import { Analytics } from '@vercel/analytics/react';
import ParticipantApp from './ParticipantApp.jsx';
import AdminApp from './AdminApp.jsx';
import { ErrorBoundary } from './common.jsx';
import './styles.css';
import './responsive.css';

const isAdmin = window.location.pathname.replace(/\/$/, '') === '/admin';

createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <ErrorBoundary>
      {isAdmin ? <AdminApp /> : <ParticipantApp />}
    </ErrorBoundary>
    {!isAdmin && <Analytics />}
  </React.StrictMode>,
);

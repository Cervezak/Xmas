import React from 'react';
import { createRoot } from 'react-dom/client';
import ParticipantApp from './ParticipantApp.jsx';
import AdminApp from './AdminApp.jsx';
import { ErrorBoundary } from './common.jsx';
import './styles.css';
import './responsive.css';

createRoot(document.getElementById('root')).render(<React.StrictMode><ErrorBoundary>{window.location.pathname.replace(/\/$/, '') === '/admin' ? <AdminApp /> : <ParticipantApp />}</ErrorBoundary></React.StrictMode>);

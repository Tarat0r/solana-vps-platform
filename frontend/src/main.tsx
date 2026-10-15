import React, { lazy, Suspense } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App.tsx';
import { sessionIdFromPath } from './session.ts';
import './style.css';

// The dashboard's RPC client loads separately, keeping signing links light on phones.
const Dashboard = lazy(() => import('./Dashboard.tsx').then(module => ({ default: module.Dashboard })));

// Signing links render the approval page; everything else is the owner dashboard.
const page = sessionIdFromPath(window.location.pathname) ? <App /> : <Suspense fallback={null}><Dashboard /></Suspense>;
createRoot(document.getElementById('root')!).render(<React.StrictMode>{page}</React.StrictMode>);

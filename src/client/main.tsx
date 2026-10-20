import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { CssBaseline, ThemeProvider } from '@mui/material';
import { theme } from './theme.ts';
import { AuthProvider } from './auth.tsx';
import { App } from './App.tsx';
import { renderShowcase } from './showcase/index.ts';
import './styles.css';
import './app.css';
import { GameClient } from './net.ts';
import * as session from './session.ts';

declare global {
  interface Window {
    __NOW__?: { GameClient: typeof GameClient; session: typeof session; client: GameClient };
  }
}

const root = document.getElementById('app');
if (root) {
  if (location.pathname.startsWith('/showcase') || new URLSearchParams(location.search).has('showcase')) renderShowcase(root);
  else createRoot(root).render(<StrictMode><ThemeProvider theme={theme}><CssBaseline/><AuthProvider><App/></AuthProvider></ThemeProvider></StrictMode>);
}

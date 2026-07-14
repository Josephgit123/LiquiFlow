import React from 'react';
import ReactDOM from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import { AuthProvider } from './context/AuthContext.jsx';
import { AdminAuthProvider } from './context/AdminAuthContext.jsx';
import { ThemeProvider } from './context/ThemeContext.jsx';
import Router from './routes/router.jsx';
import './index.css';

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <BrowserRouter>
      <ThemeProvider>
        {/* AdminAuthProvider and AuthProvider are siblings, not nested —
            they share no state or code path (CLAUDE.md invariant #7). */}
        <AdminAuthProvider>
          <AuthProvider>
            <Router />
          </AuthProvider>
        </AdminAuthProvider>
      </ThemeProvider>
    </BrowserRouter>
  </React.StrictMode>
);

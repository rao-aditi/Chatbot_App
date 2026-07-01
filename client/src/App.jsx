import React, { useEffect, useState } from 'react';
import { BrowserRouter as Router, Routes, Route, useNavigate, useLocation } from 'react-router-dom';
import './index.css';
import AdminDashboard from './pages/AdminDashboard';

function Layout({ children }) {
  const location = useLocation();
  const navigate = useNavigate();

  const isAdminPage = location.pathname === '/admin';

  if (isAdminPage) {
    return children;
  }

  return (
    <div className="app-layout">

      <main className="main-content">
        {children}
      </main>
    </div>
  );
}

function AppRoutes() {
  return (
    <Routes>
      <Route path="/" element={<AdminDashboard />} />
    </Routes>
  );
}

export default function App() {
  return (
    <Router>
      <AppRoutes />
    </Router>
  );
}
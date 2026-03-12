// src/context/AuthContext.jsx  (Workspace — unified, replaces both)
// ─────────────────────────────────────────────────────────────
// Single source of truth for auth across Workspace + DRS module.
// Key changes from DRS version:
//   - localStorage keys → platform_token / platform_user
//   - userData shape extended with DRS fields (role, job_title, assignedVessels)
//   - post-login redirect logic lives in Login.jsx, not here
// ─────────────────────────────────────────────────────────────

import React, { createContext, useState, useContext, useEffect } from 'react';
import axios from "../api/axios";

const AuthContext = createContext(null);

export const AuthProvider = ({ children }) => {
    const [user, setUser] = useState(null);
    const [loading, setLoading] = useState(true);

    // ── Rehydrate session on page refresh ──────────────────────
    useEffect(() => {
        const storedUser = localStorage.getItem('platform_user') || sessionStorage.getItem('platform_user');
        const storedToken = localStorage.getItem('platform_token') || sessionStorage.getItem('platform_token');
        if (storedUser && storedToken) {
            setUser(JSON.parse(storedUser));
        }
        setLoading(false);
    }, []);

    // ── Login ───────────────────────────────────────────────────
    // const login = async (email, password) => {
    //     const res = await axios.post("login/access-token", {
    //         username: email,
    //         password: password,
    //     });
    //     const user = res.data;
    //     localStorage.setItem("platform_token", user.access_token);
    //     localStorage.setItem("platform_user", JSON.stringify(user));
    //     setUser(user);
    // // ── MOCK FOR TESTING (remove when backend is ready) ──
    // await new Promise((resolve) => setTimeout(resolve, 500));

    // const MOCK_USERS = {
    //     'vessel@drs.com': { id: 1, full_name: 'Vessel User', role: 'VESSEL', job_title: 'Chief Engineer', assigned_vessels: ['IMO1234'] },
    //     'shore@drs.com': { id: 2, full_name: 'Shore User', role: 'SHORE', job_title: 'Fleet Manager', assigned_vessels: [] },
    //     'admin@drs.com': { id: 3, full_name: 'Admin User', role: 'ADMIN', job_title: 'Administrator', assigned_vessels: [] },
    // };

    // const mockPassword = 'password123';
    // const data = MOCK_USERS[email];

    // if (data && password === mockPassword) {
    //     const userData = {
    //         id: data.id,
    //         name: data.full_name,
    //         email: email,
    //         role: data.role,
    //         job_title: data.job_title,
    //         assignedVessels: data.assigned_vessels,
    //     };
    //     setUser(userData);
    //     localStorage.setItem('platform_user', JSON.stringify(userData));
    //     localStorage.setItem('platform_token', 'mock-token-12345');
    //     return { success: true, role: data.role };
    // }

    // return { success: false, message: 'Invalid email or password' };

    // try {
    //   const response = await api.post('/login/access-token', {
    //     username: email,
    //     password: password,
    //   });

    //   const data = response.data;

    //   // Unified user shape — covers both Workspace and DRS field needs
    //   const userData = {
    //     id: data.id,
    //     name: data.full_name,
    //     email: data.email,
    //     role: data.role,                       // 'ADMIN' | 'SHORE' | 'VESSEL'
    //     job_title: data.job_title ?? null,     // DRS: 'Chief Engineer' etc.
    //     assignedVessels: data.assigned_vessels ?? [], // DRS vessel filtering
    //   };

    //   setUser(userData);
    //   localStorage.setItem('platform_user', JSON.stringify(userData));
    //   localStorage.setItem('platform_token', data.access_token);

    //   return { success: true, role: data.role };

    // } catch (error) {
    //   console.error('Login failed:', error);
    //   const msg = error.response?.data?.detail || 'Connection error. Please try again.';
    //   return { success: false, message: msg };
    // }
    // };

    const login = async (email, password, rememberMe = false) => {
        try {
            const res = await axios.post("/login/access-token", {
                username: email,
                password: password,
            });
            const userData = res.data;
            const storage = rememberMe ? localStorage : sessionStorage;
            storage.setItem("platform_token", userData.access_token);
            storage.setItem("platform_user", JSON.stringify(userData));
            setUser(userData);
            return { success: true, role: userData.role };
        } catch (error) {
            const msg = error.response?.data?.detail || 'Connection error. Please try again.';
            return { success: false, message: msg };
        }
    };

    // ── Logout ──────────────────────────────────────────────────
    const logout = () => {
        setUser(null);
        localStorage.removeItem('platform_user');
        localStorage.removeItem('platform_token');
        sessionStorage.removeItem('platform_user');
        sessionStorage.removeItem('platform_token');
    };

    return (
        <AuthContext.Provider value={{ user, setUser, login, logout, loading }}>
            {!loading && children}
        </AuthContext.Provider>
    );
};

export const useAuth = () => useContext(AuthContext);
import React, { useEffect, useState, useRef } from "react";
import { Link, useLocation, useNavigate } from "react-router-dom";
import { useAuth } from "@/context/AuthContext";
import { fleet } from "../lib/ships";
import axiosAepms from '../api/axiosAepms';
import { Database, Upload, X, LayoutDashboard } from "lucide-react";
import {
  Moon,
  SunMedium,
  LogOut,
  User,
  ChevronDown,
  Shield,
} from "lucide-react";
import Select from "./ui/Select";
import Button from "./ui/Button";
import "../styles/components.css";
import "../styles/header.css";
// import logo from "../assets/250714_OzellarMarine-Logo-Final.png";

export default function AppHeader() {
  const location = useLocation();
  const navigate = useNavigate();
  const { user, logout } = useAuth();
  console.log("role check:", user?.role, user?.user_role, user?.userRole);
  const isAuthenticated = !!user;

  const nav = [
    { href: "/aepms", label: "Dashboard" },
    { href: "/aepms/me-performance", label: "Performance" },
    // { href: "/aepms/fleet", label: "Fleet" },
    // { href: "/aepms/voyage", label: "Voyage" },
  ];

  const [theme, setTheme] = useState("light");
  const [selectedShip, setSelectedShip] = useState("");
  const [isMenuOpen, setIsMenuOpen] = useState(false);
  const [isMobileNavOpen, setIsMobileNavOpen] = useState(false);

  const menuRef = useRef(null);
  const [showSyncModal, setShowSyncModal] = useState(false);
  const [syncConfig, setSyncConfig] = useState({
    engineType: 'mainEngine',
    file: null,
  });
  const [syncing, setSyncing] = useState(false);

  const isActive = (path) => location.pathname === path;

  useEffect(() => {
    const stored = localStorage.getItem("theme");
    const initialTheme = stored === "dark" ? "dark" : "light";
    setTheme(initialTheme);

    if (initialTheme === "dark") {
      document.documentElement.classList.add("dark");
    } else {
      document.documentElement.classList.remove("dark");
    }

    if (isAuthenticated) {
      const savedShip = localStorage.getItem("selectedShipId");
      const fallback = fleet[0]?.id ?? "";
      setSelectedShip(savedShip || fallback);
    }
  }, [isAuthenticated]);

  useEffect(() => {
    const handleClickOutside = (event) => {
      if (menuRef.current && !menuRef.current.contains(event.target)) {
        setIsMenuOpen(false);
      }
    };

    if (isMenuOpen) {
      document.addEventListener("mousedown", handleClickOutside);
    }

    return () => {
      document.removeEventListener("mousedown", handleClickOutside);
    };
  }, [isMenuOpen]);

  useEffect(() => {
    setIsMobileNavOpen(false);
  }, [location.pathname]);

  useEffect(() => {
  if (showSyncModal) {
    document.body.style.overflow = "hidden";
  } else {
    document.body.style.overflow = "";
  }
  return () => {
    document.body.style.overflow = "";
  };
}, [showSyncModal]);


  const toggleTheme = () => {
    const next = theme === "dark" ? "light" : "dark";
    setTheme(next);

    if (next === "dark") {
      document.documentElement.classList.add("dark");
    } else {
      document.documentElement.classList.remove("dark");
    }

    localStorage.setItem("theme", next);
  };

  const handleShipChange = (id) => {
    setSelectedShip(id);
    localStorage.setItem("selectedShipId", id);
    window.dispatchEvent(new CustomEvent("ship:selected", { detail: { id } }));
  };

  const handleSignOut = async () => {
    logout();
    navigate("/dashboard");
  };

  const toggleMenu = () => {
    setIsMenuOpen(!isMenuOpen);
    setIsMobileNavOpen(false);
  };

  const toggleMobileNav = () => {
    setIsMobileNavOpen((prev) => !prev);
  };

  const handleAdminClick = () => {
    setIsMenuOpen(false);
    navigate("/admin");
  };
  const handleDataSync = async (e) => {
    e.preventDefault();

    // 1. File Validation
    if (!syncConfig.file) {
      alert("Please select an Excel or PDF file.");
      return;
    }

    // 2. IMO Number Validation (Only required for Shop Trials tab)
    if (activeTab === 'shop-trials') {
        if (!syncConfig.imoNumber || syncConfig.imoNumber.trim() === '') {
            alert("⚠️ Please enter the Vessel IMO Number.");
            return;
        }
    }

    // 3. Label Logic for Confirmation Dialog
    let typeLabel = "Unknown";
    if (syncConfig.engineType === 'mainEngine') typeLabel = 'Main Engine Data';
    else if (syncConfig.engineType === 'auxiliaryEngine') typeLabel = 'Auxiliary Engine Data';
    else if (syncConfig.engineType === 'luboilConfig') typeLabel = 'Lube Oil Configuration';
    else if (syncConfig.engineType === 'shopTrialData') typeLabel = 'Main Engine Shop Trial';
    else if (syncConfig.engineType === 'aeShopTrialData') typeLabel = 'Aux Engine Shop Trial';

    // 4. Confirmation
    if (!confirm(`⚠️ Are you sure you want to sync/overwrite the ${typeLabel} database with this file?`)) {
        return;
    }

    setSyncing(true);
    try {
      let res;

      // 5. API Routing
      if (activeTab === 'shop-trials') {
          // Call the Baseline Endpoint -> Pass File, Type, AND IMO Number
          res = await apiService.adminUploadBaseline(
              syncConfig.file, 
              syncConfig.engineType, 
              syncConfig.imoNumber
          );
      } else {
          // Call the Standard Data Sync Endpoint (Logs/Config)
          res = await apiService.adminDataSync(
              syncConfig.file, 
              syncConfig.engineType
          );
          setShowSyncModal(false); // Close modal only for standard Data Sync
      }

      alert(res.message);
      
      // 6. Reset State
      // Clear file and IMO number, but keep the selected engine type
      setSyncConfig(prev => ({ 
          ...prev, 
          file: null, 
          imoNumber: '' 
      }));
      
    } catch (err) {
      console.error(err);
      alert(`❌ Sync Failed: ${err.response?.data?.detail || err.message}`);
    } finally {
      setSyncing(false);
    }
  };
  if (!isAuthenticated) return null;

  return (
    <>
    <header className="app-header">
      <div className="header-container">
        <div className="header-brand">
          {/* <img src={logo} alt="logo" className="brand-logo" /> */}
          <span className="brand-title">Ship Engine Performance Console</span>
        </div>

        <nav className={`header-nav ${isMobileNavOpen ? "open" : ""}`}>
          {nav.map((n) => (
            <Link
              key={n.href}
              to={n.href}
              className={`nav-link ${isActive(n.href) ? "active" : ""}`}
              onClick={() => setIsMobileNavOpen(false)}
            >
              {n.label}
            </Link>
          ))}
        </nav>

        <div className="header-actions">
          <button
            className="mobile-nav-toggle"
            onClick={toggleMobileNav}
            aria-label="Toggle navigation"
            aria-expanded={isMobileNavOpen}
          >
            ☰
          </button>

          <div className="user-menu-container" ref={menuRef}>
            <button className="user-menu-trigger" onClick={toggleMenu}>
              <User size={18} />
              <span className="user-menu-name">{user?.full_name || "User"}</span>
              <ChevronDown
                size={16}
                className={`user-menu-chevron ${isMenuOpen ? "open" : "closed"}`}
              />
            </button>

            {isMenuOpen && (
              <div className="user-dropdown-menu">
                <div className="user-dropdown-header">
                  <div className="user-dropdown-name">{user?.full_name}</div>
                  {user?.authType && (
                    <div className="user-dropdown-auth">
                      {user.authType === "microsoft"
                        ? "Microsoft SSO"
                        : "Local Account"}
                    </div>
                  )}
                </div>

                <div className="user-dropdown-items">
  <button
    onClick={() => { setIsMenuOpen(false); navigate("/dashboard"); }}
    className="user-dropdown-btn"
  >
    <LayoutDashboard size={18} />
    <span>Back to Dashboard</span>
  </button>

  {(user?.role?.toLowerCase() === "admin" || user?.role?.toLowerCase() === "superuser") && (
    <button
      onClick={() => { setIsMenuOpen(false); setShowSyncModal(true); }}
      className="user-dropdown-btn admin"
    >
      <Database size={18} />
      <span>Data Sync</span>
    </button>
  )}
</div>
              </div>
            )}
          </div>
        </div>
      </div>
    </header>
    {showSyncModal && (
  <div style={{
    position: 'fixed', top: 0, left: 0, right: 0, bottom: 0,
    backgroundColor: "white", display: 'flex',
    alignItems: 'center', justifyContent: 'center', zIndex: 9999
  }}>
    <div style={{ backgroundColor: 'white', borderRadius: '12px', width: '450px', maxWidth: '90%', padding: '1.5rem', border: '1px solid #e2e8f0', boxShadow: '0 4px 12px rgba(0, 0, 0, 0.15)' }}>
      
      {/* Modal Header */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1.5rem' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
          <Database size={20} color="#0ea5e9" />
          <span style={{ fontWeight: 600, fontSize: '1rem' }}>System Data Sync</span>
        </div>
        <button onClick={() => setShowSyncModal(false)} style={{ background: 'none', border: 'none', cursor: 'pointer' }}>
          <X size={20} />
        </button>
      </div>

      {/* Modal Form */}
      <form onSubmit={handleDataSync} style={{ display: 'flex', flexDirection: 'column', gap: '1.25rem' }}>
        <div style={{ padding: '0.75rem', backgroundColor: '#f0f9ff', borderRadius: '6px', border: '1px solid #bae6fd', fontSize: '0.85rem', color: '#0369a1' }}>
          Upload Excel (.xlsx) to directly sync Shop Trial Data To configure the New Vessel.
        </div>

        {/* Data Type Select */}
        <div>
          <label style={{ fontSize: '13px', fontWeight: 600, display: 'block', marginBottom: '6px' }}>Data Type</label>
          <select
            style={{ width: '100%', padding: '8px', borderRadius: '6px', border: '1px solid #e2e8f0', backgroundColor: 'white', color: '#0f172a', fontSize: '13px' }}
            value={syncConfig.engineType}
            onChange={(e) => setSyncConfig(prev => ({ ...prev, engineType: e.target.value }))}
          >
            <option value="mainEngine">Main Engine Data</option>
            <option value="auxiliaryEngine">Auxiliary Engine Data</option>
            <option value="luboilConfig">Lube Oil Configuration</option>
          </select>
        </div>

        {/* File Upload */}
        <div>
          <label style={{ fontSize: '13px', fontWeight: 600, display: 'block', marginBottom: '6px' }}>Excel File</label>
          <div style={{ border: '2px dashed #cbd5e1', padding: '1.5rem', textAlign: 'center', borderRadius: '8px', cursor: 'pointer', position: 'relative', backgroundColor: syncConfig.file ? '#f0f9ff' : '#f8fafc', borderColor: syncConfig.file ? '#0ea5e9' : '#cbd5e1' }}>
            <input
              type="file"
              accept=".xlsx, .xls"
              onChange={(e) => setSyncConfig(prev => ({ ...prev, file: e.target.files[0] }))}
              style={{ position: 'absolute', top: 0, left: 0, width: '100%', height: '100%', opacity: 0, cursor: 'pointer' }}
            />
            <Upload size={24} style={{ margin: '0 auto 8px', color: syncConfig.file ? '#0ea5e9' : '#94a3b8', display: 'block' }} />
            <p style={{ fontSize: '0.85rem', color: '#475569', margin: 0 }}>
              {syncConfig.file ? <strong>{syncConfig.file.name}</strong> : "Click to select file"}
            </p>
          </div>
        </div>

        {/* Buttons */}
        <div style={{ display: 'flex', gap: '0.75rem', justifyContent: 'flex-end' }}>
          <button type="button" onClick={() => setShowSyncModal(false)} disabled={syncing}
            style={{ padding: '8px 16px', borderRadius: '6px', border: '1px solid #e2e8f0', background: 'white', cursor: 'pointer', fontSize: '13px' }}>
            Cancel
          </button>
          <button type="submit" disabled={syncing || !syncConfig.file}
            style={{ padding: '8px 16px', borderRadius: '6px', border: 'none', backgroundColor: '#0ea5e9', color: 'white', cursor: syncing || !syncConfig.file ? 'not-allowed' : 'pointer', fontSize: '13px', opacity: !syncConfig.file ? 0.6 : 1 }}>
            {syncing ? '⏳ Syncing...' : 'Start Sync'}
          </button>
        </div>
      </form>
    </div>
  </div>
)}
</>
  );
}

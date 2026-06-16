import React, { useEffect, useState, useRef } from "react";
import { Link, useLocation, useNavigate } from "react-router-dom";
import { useAuth } from "@/context/AuthContext";
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

export default function AppHeader() {
  const location = useLocation();
  const navigate = useNavigate();
  const { user, logout } = useAuth();
  const isAuthenticated = !!user;

  const nav = [
    { href: "/aepms", label: "Dashboard" },
    { href: "/aepms/me-performance", label: "Performance" },
  ];

  const [theme, setTheme] = useState("light");
  const [selectedShip, setSelectedShip] = useState("");
  const [isMenuOpen, setIsMenuOpen] = useState(false);
  const [isMobileNavOpen, setIsMobileNavOpen] = useState(false);
  const [modalMode, setModalMode] = useState('sync'); // 'sync' or 'direct'
  const [vesselId, setVesselId] = useState("");
  const [extractedData, setExtractedData] = useState(null);
  const [isExtracting, setIsExtracting] = useState(false);
  const menuRef = useRef(null);
  const [showSyncModal, setShowSyncModal] = useState(false);
  const [dbVessels, setVessels] = useState([]); // Real vessels from Control DB
  const [selectedGenerator, setSelectedGenerator] = useState(""); // For Aux Engine
  const [generators, setGenerators] = useState([]); // List of gens for selected ship
  
  // Tab controller for the AI baseline review modal
  const [activeReviewTab, setActiveReviewTab] = useState("vessel"); // 'vessel', 'session', 'performance'

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
    document.documentElement.classList.toggle("dark", initialTheme === "dark");

    if (isAuthenticated) {
      const savedShip = localStorage.getItem("selectedShipId");
      setSelectedShip(savedShip || "");
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

  // Tab safe guard: Redirect away from "session" if switching from Main to Aux Engine
  useEffect(() => {
    if (syncConfig.engineType === 'auxiliaryEngine' && activeReviewTab === 'session') {
      setActiveReviewTab('vessel');
    }
  }, [syncConfig.engineType, activeReviewTab]);

  // Consolidated Data Fetching
  useEffect(() => {
    const fetchData = async () => {
      if (!isAuthenticated) return;
      try {
        const vessels = await axiosAepms.getUserVessels();
        setVessels(vessels || []);

        if (modalMode === 'direct' && syncConfig.engineType === 'auxiliaryEngine' && vesselId) {
          const gens = await axiosAepms.getGenerators(vesselId);
          setGenerators(gens || []);
        }
      } catch (err) {
        console.error("❌ Data Fetch Error:", err);
      }
    };

    fetchData();
  }, [isAuthenticated, vesselId, syncConfig.engineType, modalMode]);

  useEffect(() => {
    const fetchGens = async () => {
      if (syncConfig.engineType === 'auxiliaryEngine' && vesselId) {
        const res = await axiosAepms.getGenerators(vesselId);
        setGenerators(res || []);
      }
    };
    fetchGens();
  }, [vesselId, syncConfig.engineType]);

  const toggleTheme = () => {
    const next = theme === "dark" ? "light" : "dark";
    setTheme(next);
    document.documentElement.classList.toggle("dark", next === "dark");
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
  
  const handleDataSync = async (e) => {
    e.preventDefault();

    if (!syncConfig.file) {
      alert("Please select an Excel file.");
      return;
    }

    let typeLabel = syncConfig.engineType === 'mainEngine' ? 'Main Engine Data' : 'Auxiliary Engine Data';

    if (!window.confirm(`⚠️ Are you sure you want to sync/overwrite the ${typeLabel} database with this file?`)) {
      return;
    }

    setSyncing(true);
    try {
      const res = await axiosAepms.adminDataSync(
        syncConfig.file,
        syncConfig.engineType
      );
      alert(res.message || "Sync successful!");
      setSyncConfig(prev => ({ ...prev, file: null }));
      setShowSyncModal(false);
    } catch (err) {
      console.error(err);
      alert(`❌ Sync Failed: ${err.message || 'An unknown error occurred'}`);
    } finally {
      setSyncing(false);
    }
  };

  const handleDirectExtract = async (e) => {
    e.preventDefault();

    if (!vesselId) {
      alert("Please select a target vessel.");
      return;
    }
    if (!syncConfig.file) {
      alert("Please upload a performance PDF.");
      return;
    }

    setIsExtracting(true);
    try {
      const res = await axiosAepms.extractPdf(
        syncConfig.file,
        syncConfig.engineType
      );
      setExtractedData(res.data);
      setActiveReviewTab("vessel");
      alert("✅ AI Extraction successful. Please review the data.");
    } catch (err) {
      console.error("Extraction error:", err);
      alert(`❌ AI Extraction Failed: ${err.message || 'Check your Gemini API configuration'}`);
    } finally {
      setIsExtracting(false);
    }
  };

  const handleFinalSubmit = async () => {
    if (!window.confirm("Confirm saving Specs and Performance Matrix to the database?")) return;

    setSyncing(true);
    try {
      await axiosAepms.saveAiBaseline({
        ...extractedData,
        engine_type: syncConfig.engineType,
        generator_id: selectedGenerator
      });

      alert("✅ Performance and specifications data saved successfully!");
      closeModal(); 
    } catch (err) {
      alert(`❌ Save failed: ${err.message}`);
    } finally {
      setSyncing(false);
    }
  };

  const closeModal = () => {
    setShowSyncModal(false);
    setExtractedData(null);
    setVesselId("");
    setSelectedGenerator("");
  };

  const getTabStyle = (tabName) => ({
    padding: '8px 16px',
    borderRadius: '6px',
    fontWeight: activeReviewTab === tabName ? 700 : 500,
    backgroundColor: activeReviewTab === tabName ? '#0ea5e9' : 'transparent',
    color: activeReviewTab === tabName ? 'white' : '#64748b',
    border: 'none',
    cursor: 'pointer',
    transition: 'all 0.2s'
  });

  if (!isAuthenticated) return null;

  return (
    <>
      <header className="app-header">
        <div className="header-container">
          <div className="header-brand">
            <button
              onClick={() => navigate("/dashboard")}
              title="Back to Dashboard"
              aria-label="Back to Dashboard"
              onMouseEnter={(e) => {
                e.currentTarget.querySelector(".dots-grid").style.opacity = "0";
                e.currentTarget.querySelector(".dots-arrow").style.opacity = "1";
                e.currentTarget.style.background = "rgba(255,255,255,0.15)";
              }}
              onMouseLeave={(e) => {
                e.currentTarget.querySelector(".dots-grid").style.opacity = "1";
                e.currentTarget.querySelector(".dots-arrow").style.opacity = "0";
                e.currentTarget.style.background = "rgba(255,255,255,0.06)";
              }}
              style={{
                background: "rgba(255,255,255,0.06)",
                border: "1px solid rgba(255,255,255,0.1)",
                borderRadius: "8px",
                cursor: "pointer",
                padding: "6px",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                position: "relative",
                width: "34px",
                height: "34px",
                flexShrink: 0,
                transition: "background 0.2s",
              }}
            >
              <div
                className="dots-grid"
                style={{
                  display: "grid",
                  gridTemplateColumns: "repeat(3, 7px)",
                  gap: "3px",
                  position: "absolute",
                  transition: "opacity 0.2s",
                  opacity: "1",
                }}
              >
                {[...Array(9)].map((_, i) => (
                  <span
                    key={i}
                    style={{
                      width: "7px",
                      height: "7px",
                      borderRadius: "2px",
                      backgroundColor: "#94a3b8",
                      display: "block",
                    }}
                  />
                ))}
              </div>

              <div
                className="dots-arrow"
                style={{
                  position: "absolute",
                  opacity: "0",
                  width: "35px",
                  height: "35px",
                  transition: "opacity 0.2s",
                  color: "#94a3b8",
                  fontSize: "1.4rem",
                  fontWeight: "bold",
                  lineHeight: 1,
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  backgroundColor: "white",
                  borderRadius: "20%",
                  border: "1px solid rgba(48, 46, 46, 0.1)",
                }}
              >
                ‹
              </div>
            </button>

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
                  <div className="user-dropdown-items">
                    <button onClick={() => { setIsMenuOpen(false); navigate("/dashboard"); }} className="user-dropdown-btn">
                      <LayoutDashboard size={18} /> <span>Back to Dashboard</span>
                    </button>

                    {(user?.role?.toLowerCase() === "admin" || user?.role?.toLowerCase() === "superuser") && (
                      <>
                        <button onClick={() => { setIsMenuOpen(false); setModalMode('sync'); setShowSyncModal(true); }} className="user-dropdown-btn admin">
                          <Database size={18} /> <span>Data Sync (Excel)</span>
                        </button>

                        <button onClick={() => { setIsMenuOpen(false); setModalMode('direct'); setShowSyncModal(true); }} className="user-dropdown-btn admin" style={{ borderTop: '1px solid #f1f5f9', color: '#0ea5e9' }}>
                          <Shield size={18} /> <span style={{ fontWeight: 600 }}>Direct AI Analysis</span>
                        </button>
                      </>
                    )}
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>
      </header>
      
      {showSyncModal && (
        <div style={{ position: 'fixed', top: 0, left: 0, right: 0, bottom: 0, backgroundColor: "rgba(0,0,0,0.5)", display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 9999 }}>
          <div style={{
            backgroundColor: 'white',
            borderRadius: '12px',
            width: extractedData ? '1120px' : '480px', 
            maxWidth: '98%', 
            maxHeight: '90vh', 
            overflowY: 'auto', 
            padding: '1.5rem',
            transition: 'width 0.3s ease',
            boxShadow: '0 20px 25px -5px rgba(0, 0, 0, 0.1)'
          }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1.25rem' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                {modalMode === 'sync' ? <Database size={20} color="#64748b" /> : <Shield size={20} color="#0ea5e9" />}
                <span style={{ fontWeight: 700 }}>{modalMode === 'sync' ? 'System Data Sync' : 'Direct AI Performance Analysis'}</span>
              </div>
              <button onClick={() => { setShowSyncModal(false); setExtractedData(null); }} style={{ background: 'none', border: 'none', cursor: 'pointer' }}><X size={20} /></button>
            </div>

            {!extractedData ? (
              <form onSubmit={modalMode === 'sync' ? handleDataSync : handleDirectExtract} style={{ display: 'flex', flexDirection: 'column', gap: '1.25rem' }}>
                {modalMode === 'direct' && (
                  <div>
                    <label style={{ fontSize: '11px', fontWeight: 700, color: '#475569' }}>TARGET VESSEL</label>
                    <select style={{ width: '100%', padding: '8px', borderRadius: '6px', border: '1px solid #e2e8f0' }} value={vesselId} onChange={(e) => setVesselId(e.target.value)}>
                      <option value="">-- Select Vessel --</option>
                      {dbVessels.map((v, index) => (
                        <option key={v.imo || `vessel-${index}`} value={v.imo}>
                          {v.name}
                        </option>
                      ))}
                    </select>
                  </div>
                )}
                {modalMode === 'direct' && syncConfig.engineType === 'auxiliaryEngine' && vesselId && (
                  <div>
                    <label style={{ fontSize: '11px', fontWeight: 700, color: '#475569' }}>GENERATOR UNIT</label>
                    <select style={{ width: '100%', padding: '8px', borderRadius: '6px', border: '1px solid #e2e8f0' }} value={selectedGenerator} onChange={(e) => setSelectedGenerator(e.target.value)}>
                      <option value="">-- Choose Unit --</option>
                      {generators.map((g, index) => (
                        <option key={g.generator_id || `gen-${index}`} value={g.generator_id}>
                          {g.designation}
                        </option>
                      ))}
                    </select>
                  </div>
                )}
                <div>
                  <label style={{ fontSize: '11px', fontWeight: 700 }}>ENGINE TARGET</label>
                  <select style={{ width: '100%', padding: '8px', borderRadius: '6px', border: '1px solid #e2e8f0' }} value={syncConfig.engineType} onChange={(e) => setSyncConfig(prev => ({ ...prev, engineType: e.target.value }))}>
                    <option value="mainEngine">Main Engine</option>
                    <option value="auxiliaryEngine">Auxiliary Engine</option>
                  </select>
                </div>
                <div>
                  <label style={{ fontSize: '11px', fontWeight: 700 }}>{modalMode === 'sync' ? 'EXCEL FILE' : 'PDF LOG'}</label>
                  <input type="file" accept={modalMode === 'sync' ? ".xlsx, .xls" : ".pdf"} onChange={(e) => setSyncConfig(prev => ({ ...prev, file: e.target.files[0] }))} />
                </div>
                <div style={{ display: 'flex', gap: '0.75rem', justifyContent: 'flex-end' }}>
                  <Button variant="secondary" onClick={() => setShowSyncModal(false)}>Cancel</Button>
                  <Button type="submit" disabled={isExtracting || syncing || !syncConfig.file}>
                    {isExtracting ? 'AI is Processing...' : modalMode === 'sync' ? 'Start Sync' : 'Run AI Extract'}
                  </Button>
                </div>
              </form>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem', width: '1060px', maxWidth: '95vw' }}>
                
                {/* DUAL-MODE MODAL TABS */}
                <div style={{ display: 'flex', gap: '10px', borderBottom: '2px solid #e2e8f0', paddingBottom: '8px', marginBottom: '10px' }}>
                  {syncConfig.engineType === 'mainEngine' ? (
                    <>
                      <button type="button" onClick={() => setActiveReviewTab("vessel")} style={getTabStyle("vessel")}>
                        Sheet 1: Vessel Specifications
                      </button>
                      <button type="button" onClick={() => setActiveReviewTab("session")} style={getTabStyle("session")}>
                        Sheet 2: Trial Session Info
                      </button>
                      <button type="button" onClick={() => setActiveReviewTab("performance")} style={getTabStyle("performance")}>
                        Sheet 3: Performance Matrix
                      </button>
                    </>
                  ) : (
                    <>
                      <button type="button" onClick={() => setActiveReviewTab("vessel")} style={getTabStyle("vessel")}>
                        Sheet 1: Generator & Trial Specs
                      </button>
                      <button type="button" onClick={() => setActiveReviewTab("performance")} style={getTabStyle("performance")}>
                        Sheet 2: Performance Matrix
                      </button>
                    </>
                  )}
                </div>

                <div style={{ padding: '12px', background: '#fff', borderRadius: '8px', border: '1px solid #e2e8f0', overflowX: 'auto', maxHeight: '60vh' }}>

                  {/* SHEET 1: VESSEL SPECIFICATIONS (Main Engine Mode) */}
                  {syncConfig.engineType === 'mainEngine' && activeReviewTab === "vessel" && (
                    <div>
                      <h4 style={{ fontSize: '13px', fontWeight: 800, color: '#0ea5e9', marginBottom: '10px' }}>VESSEL SPECIFICATIONS</h4>
                      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: '10px', padding: '10px', background: '#f8fafc', borderRadius: '6px' }}>
                        {Object.entries(extractedData.vessel_info).map(([key, value]) => {
                          if (key.endsWith("_Unit") || key === "mcr_limit_unit") return null;
                          return (
                            <div key={key}>
                              <label style={{ fontSize: '9px', fontWeight: 700, color: '#64748b' }}>{key.replace(/_/g, ' ').toUpperCase()}</label>
                              <input
                                style={{ width: '100%', padding: '4px', fontSize: '11px', border: '1px solid #cbd5e1', borderRadius: '4px' }}
                                value={value || ""}
                                onChange={(e) => setExtractedData({
                                  ...extractedData,
                                  vessel_info: { ...extractedData.vessel_info, [key]: e.target.value }
                                })}
                              />
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  )}

                  {/* SHEET 2: SESSION DETAILS (Main Engine Mode) */}
                  {syncConfig.engineType === 'mainEngine' && activeReviewTab === "session" && (
                    <div>
                      <h4 style={{ fontSize: '13px', fontWeight: 800, color: '#0ea5e9', marginBottom: '10px' }}>TRIAL SESSION DETAILS</h4>
                      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '10px', padding: '10px', background: '#f8fafc', borderRadius: '6px' }}>
                        {Object.entries(extractedData.session_info).map(([key, value]) => {
                          if (key.endsWith("_Unit")) return null;
                          return (
                            <div key={key}>
                              <label style={{ fontSize: '9px', fontWeight: 700, color: '#64748b' }}>{key.replace(/_/g, ' ').toUpperCase()}</label>
                              <input
                                style={{ width: '100%', padding: '4px', fontSize: '11px', border: '1px solid #cbd5e1', borderRadius: '4px' }}
                                value={value || ""}
                                onChange={(e) => setExtractedData({
                                  ...extractedData,
                                  session_info: { ...extractedData.session_info, [key]: e.target.value }
                                })}
                              />
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  )}

                  {/* SHEET 1: COMBINED GENERATOR & TRIAL SPECIFICATIONS (Auxiliary Engine Mode) */}
                  {syncConfig.engineType === 'auxiliaryEngine' && activeReviewTab === "vessel" && (
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
                      {/* Generator Spec Fields */}
                      <div>
                        <h4 style={{ fontSize: '13px', fontWeight: 800, color: '#0ea5e9', marginBottom: '10px' }}>AUXILIARY GENERATOR SPECIFICATIONS</h4>
                        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: '10px', padding: '10px', background: '#f8fafc', borderRadius: '6px' }}>
                          {[
                            'vessel_name', 'imo_number', 'engine_no', 'engine_maker',
                            'engine_type', 'engine_model', 'number_of_cylinders', 'mcr_power_kw', 'mcr_rpm'
                          ].map((key) => (
                            <div key={key}>
                              <label style={{ fontSize: '9px', fontWeight: 700, color: '#64748b' }}>{key.replace(/_/g, ' ').toUpperCase()}</label>
                              <input
                                style={{ width: '100%', padding: '4px', fontSize: '11px', border: '1px solid #cbd5e1', borderRadius: '4px' }}
                                value={extractedData.vessel_info[key] || ""}
                                onChange={(e) => setExtractedData({
                                  ...extractedData,
                                  vessel_info: { ...extractedData.vessel_info, [key]: e.target.value }
                                })}
                              />
                            </div>
                          ))}
                        </div>
                      </div>

                      {/* Generator Trial Session Fields */}
                      <div>
                        <h4 style={{ fontSize: '13px', fontWeight: 800, color: '#0ea5e9', marginBottom: '10px' }}>TRIAL & ENVIRONMENTAL DETAILS</h4>
                        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '10px', padding: '10px', background: '#f8fafc', borderRadius: '6px' }}>
                          {[
                            'trial_date', 'trial_type', 'conducted_by', 'remarks', 'document_title', 'room_temp_cold_condition_c'
                          ].map((key) => (
                            <div key={key}>
                              <label style={{ fontSize: '9px', fontWeight: 700, color: '#64748b' }}>{key.replace(/_/g, ' ').toUpperCase()}</label>
                              <input
                                style={{ width: '100%', padding: '4px', fontSize: '11px', border: '1px solid #cbd5e1', borderRadius: '4px' }}
                                value={extractedData.session_info[key] || ""}
                                onChange={(e) => setExtractedData({
                                  ...extractedData,
                                  session_info: { ...extractedData.session_info, [key]: e.target.value }
                                })}
                              />
                            </div>
                          ))}
                        </div>
                      </div>
                    </div>
                  )}

                  {/* SHEET 3/2: PERFORMANCE MATRIX (Main or Auxiliary Engine Table) */}
                  {activeReviewTab === "performance" && (
                    <div>
                      <h4 style={{ fontSize: '13px', fontWeight: 800, color: '#0ea5e9', marginBottom: '10px' }}>
                        {syncConfig.engineType === 'auxiliaryEngine' ? 'AUX ENGINE SHOP TRIAL PERFORMANCE MATRIX' : 'SHOP TRIAL PERFORMANCE MATRIX'}
                      </h4>
                      <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '11px' }}>
                        <thead>
                          <tr style={{ background: '#f1f5f9' }}>
                            <th style={{ textAlign: 'left', padding: '8px', border: '1px solid #e2e8f0' }}>Parameter</th>
                            <th style={{ padding: '8px', border: '1px solid #e2e8f0', textAlign: 'center', width: '60px' }}>Unit</th>
                            {extractedData.performance_table.map((p, idx) => (
                              <th key={idx} style={{ padding: '8px', border: '1px solid #e2e8f0', textAlign: 'center' }}>
                                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                                  <input
                                    style={{ width: '100px', fontWeight: 'bold', border: 'none', background: 'transparent', textAlign: 'center' }}
                                    value={p.load_percentage || ""}
                                    onChange={(e) => {
                                      const next = [...extractedData.performance_table];
                                      next[idx].load_percentage = e.target.value;
                                      setExtractedData({ ...extractedData, performance_table: next });
                                    }}
                                  />
                                </div>
                              </th>
                            ))}
                          </tr>
                        </thead>
                        <tbody>
                          {(syncConfig.engineType === 'auxiliaryEngine' ? [
                            // Unified 100% Auxiliary Engine parameters aligned strictly with your baseline database schema [12]
                            { label: 'Generator Load', unit: 'kW', key: 'load_kw' },
                            { label: 'Pmax (Raw)', unit: 'MPa', key: 'pmax_raw_mpa' },
                            { label: 'Boost Air Pressure (Raw)', unit: 'MPa', key: 'boost_air_pressure_raw_mpa' },
                            { label: 'Exh. Temp T/C Inlet', unit: '°C', key: 'exh_temp_tc_inlet_graph_c' },
                            { label: 'Exh. Temp Cyl. Outlet Avg Graph', unit: '°C', key: 'exh_temp_cyl_outlet_avg_graph_c' },
                            { label: 'Exh. Temp T/C Outlet Graph', unit: '°C', key: 'exh_temp_tc_outlet_graph_c' },
                            { label: 'Fuel Pump Index Graph', unit: 'mm', key: 'fuel_pump_index_graph' },
                            { label: 'SFOC Graph', unit: 'g/kWh', key: 'sfoc_graph_g_kwh' }
                          ] : [
                            // Main Engine parameters list
                            { label: 'Test Sequence', unit: '#', key: 'test_sequence' },
                            { label: 'Engine Speed', unit: 'rpm', key: 'engine_speed_rpm' },
                            { label: 'Engine Output', unit: 'kW', key: 'engine_output_kw' },
                            { label: 'Max Comb. Pressure (Measured)', unit: 'bar', key: 'max_combustion_pressure_bar' },
                            { label: 'Max Comb. Pressure (ISO Corrected)', unit: 'bar', key: 'max_combustion_pressure_iso_bar' },
                            { label: 'Comp. Pressure (Measured)', unit: 'bar', key: 'compression_pressure_bar' },
                            { label: 'Comp. Pressure (ISO Corrected)', unit: 'bar', key: 'compression_pressure_iso_bar' },
                            { label: 'Mean Eff. Pressure', unit: 'bar', key: 'mean_effective_pressure_bar' },
                            { label: 'Scav Air Pressure (Measured)', unit: 'bar', key: 'scav_air_pressure_bar' },
                            { label: 'Scav Air Pressure (ISO Corrected)', unit: 'kg/cm²', key: 'scav_air_pressure_iso_kg_cm2' },
                            { label: 'Turbocharger Gas Inlet Pressure', unit: 'kg/cm²', key: 'turbocharger_gas_inlet_press_kg_cm2' },
                            { label: 'Scav Air Temp', unit: '°C', key: 'scav_air_temperature_c' },
                            { label: 'Exh Temp Cylinder Outlet (Average)', unit: '°C', key: 'exh_temp_cylinder_outlet_ave_c' },
                            { label: 'Exh Temp T/C Inlet (Measured)', unit: '°C', key: 'exh_temp_tc_inlet_c' },
                            { label: 'Exh Temp T/C Inlet (ISO Corrected)', unit: '°C', key: 'exh_temp_tc_inlet_iso_c' },
                            { label: 'Exh Temp T/C Outlet (Measured)', unit: '°C', key: 'exh_temp_tc_outlet_c' },
                            { label: 'Exh Temp T/C Outlet (ISO Corrected)', unit: '°C', key: 'exh_temp_tc_outlet_iso_c' },
                            { label: 'Turbocharger Speed (Measured)', unit: 'x1000 rpm', key: 'turbocharger_speed_x1000_rpm' },
                            { label: 'Turbocharger Speed (ISO Corrected)', unit: 'x1000 rpm', key: 'turbocharger_speed_x1000_iso_rpm' },
                            { label: 'Fuel Index', unit: 'mm', key: 'fuel_injection_pump_index_mm' },
                            { label: 'Fuel Oil Temp', unit: '°C', key: 'fuel_oil_temperature_c' },
                            { label: 'Fuel Consumption', unit: 'kg/h', key: 'fuel_oil_consumption_kg_h' },
                            { label: 'SFOC (Measured)', unit: 'g/kWh', key: 'fuel_oil_consumption_g_kwh' },
                            { label: 'SFOC (ISO Corrected)', unit: 'g/kWh', key: 'fuel_oil_consumption_iso_g_kwh' },
                            { label: 'T/C Inlet Temp', unit: '°C', key: 'tc_inlet_temp_c' },
                            { label: 'T/C Outlet Back Press', unit: 'mmAq', key: 'tc_outlet_back_press_mmaq' },
                            { label: 'Test Room Temp', unit: '°C', key: 'room_temperature_c' },
                            { label: 'Test Room Humidity', unit: '%', key: 'room_humidity_percent' },
                            { label: 'Barometric Pressure', unit: 'mbar', key: 'barometer_pressure_mbar' }
                          ]).map((row, idx) => (
                            <tr key={row.key} style={{ borderBottom: '1px solid #f1f5f9', background: idx % 2 === 0 ? '#fff' : '#fafafa' }}>
                              <td style={{ padding: '8px', fontWeight: 600, border: '1px solid #e2e8f0', color: '#475569', fontSize: '11px', whiteSpace: 'nowrap' }}>
                                {row.label}
                              </td>
                              <td style={{ padding: '8px', fontWeight: 500, border: '1px solid #e2e8f0', color: '#64748b', fontSize: '11px', textAlign: 'center' }}>
                                {row.unit}
                              </td>
                              {extractedData.performance_table.map((p, pIdx) => (
                                <td key={pIdx} style={{ padding: '4px', border: '1px solid #e2e8f0' }}>
                                  <input
                                    style={{ width: '100%', border: 'none', textAlign: 'center', fontSize: '11px', background: 'transparent' }}
                                    value={p[row.key] || ""}
                                    onChange={(e) => {
                                      const next = [...extractedData.performance_table];
                                      next[pIdx][row.key] = e.target.value;
                                      setExtractedData({ ...extractedData, performance_table: next });
                                    }}
                                  />
                                </td>
                              ))}
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  )}
                </div>

                <div style={{ display: 'flex', gap: '0.75rem', justifyContent: 'flex-end', marginTop: '10px' }}>
                  <Button variant="secondary" onClick={() => setExtractedData(null)}>Cancel</Button>
                  <Button onClick={handleFinalSubmit} disabled={syncing}>Commit Vessel Configuration</Button>
                </div>
              </div>
            )}
          </div>
        </div>
      )}
    </>
  );
}
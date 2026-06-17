import React, { useEffect, useState, useRef } from "react";
import { Link, useLocation, useNavigate } from "react-router-dom";
import { useAuth } from "@/context/AuthContext";
import axiosAepms from '../api/axiosAepms';
import { Database, Upload, X, LayoutDashboard, CheckCircle2, Loader2, AlertCircle, Trash2 } from "lucide-react";
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
  const [modalMode, setModalMode] = useState('sync');
  const [vesselId, setVesselId] = useState("");
  const [extractedData, setExtractedData] = useState(null);
  const [isExtracting, setIsExtracting] = useState(false);
  const menuRef = useRef(null);
  const vesselRef = useRef(null);
  const genRef = useRef(null);
  const engineRef = useRef(null);
  const [isVesselDropdownOpen, setIsVesselDropdownOpen] = useState(false);
  const [isGenDropdownOpen, setIsGenDropdownOpen] = useState(false);
  const [isEngineDropdownOpen, setIsEngineDropdownOpen] = useState(false);
  const [vesselSearch, setVesselSearch] = useState("");
  const [genSearch, setGenSearch] = useState("");
  const [showSyncModal, setShowSyncModal] = useState(false);
  const [dbVessels, setVessels] = useState([]);
  const [selectedGenerator, setSelectedGenerator] = useState("");
  const [generators, setGenerators] = useState([]);
  const [activeReviewTab, setActiveReviewTab] = useState("vessel");
  const [syncConfig, setSyncConfig] = useState({ engineType: 'mainEngine', file: null });
  const [syncing, setSyncing] = useState(false);

  // ─── Background extraction state ───────────────────────────────────────────
  // bgStatus: null | 'processing' | 'done' | 'error'
  // bgStatus persists until the user explicitly dismisses it (Cancel / dismiss error).
  // It does NOT auto-clear on modal open — the user must see the result first.
  const [bgProcessing, setBgProcessing] = useState(false);
  const [bgStatus, setBgStatus] = useState(null);
  const [bgResult, setBgResult] = useState(null);
  const [bgError, setBgError] = useState(null);
  const [bgEngineType, setBgEngineType] = useState(null);

  // true if the modal was open when the user clicked "Run AI Extract"
  // Used to decide: show result inline vs show badge in admin button
  const [modalWasOpenOnStart, setModalWasOpenOnStart] = useState(false);

  const isActive = (path) => location.pathname === path;

  // ─── Theme + ship init ─────────────────────────────────────────────────────
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

  // ─── Click outside dropdowns / user menu ──────────────────────────────────
  useEffect(() => {
    const handleClickOutside = (event) => {
      if (menuRef.current && !menuRef.current.contains(event.target)) setIsMenuOpen(false);
      if (vesselRef.current && !vesselRef.current.contains(event.target)) setIsVesselDropdownOpen(false);
      if (genRef.current && !genRef.current.contains(event.target)) setIsGenDropdownOpen(false);
      if (engineRef.current && !engineRef.current.contains(event.target)) setIsEngineDropdownOpen(false);
    };
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  // ─── Close mobile nav on route change ─────────────────────────────────────
  useEffect(() => { setIsMobileNavOpen(false); }, [location.pathname]);

  // ─── Body scroll lock when modal open ─────────────────────────────────────
  useEffect(() => {
    document.body.style.overflow = showSyncModal ? "hidden" : "";
    return () => { document.body.style.overflow = ""; };
  }, [showSyncModal]);

  // ─── Aux engine tab guard ─────────────────────────────────────────────────
  useEffect(() => {
    if (syncConfig.engineType === 'auxiliaryEngine' && activeReviewTab === 'session') {
      setActiveReviewTab('vessel');
    }
  }, [syncConfig.engineType, activeReviewTab]);

  // ─── Fetch vessels ─────────────────────────────────────────────────────────
  useEffect(() => {
    const fetchData = async () => {
      if (!isAuthenticated) return;
      try {
        const vessels = await axiosAepms.getUserVessels();
        setVessels(vessels || []);
      } catch (err) {
        console.error("❌ Vessel fetch error:", err);
      }
    };
    fetchData();
  }, [isAuthenticated, modalMode]);

  // ─── Fetch generators when aux engine selected ────────────────────────────
  useEffect(() => {
    const fetchGens = async () => {
      if (syncConfig.engineType === 'auxiliaryEngine' && vesselId) {
        try {
          const res = await axiosAepms.getGenerators(vesselId);
          setGenerators(res || []);
        } catch (err) {
          console.error("❌ Generator fetch error:", err);
        }
      }
    };
    fetchGens();
  }, [vesselId, syncConfig.engineType]);

  // ─── Core: react to extraction finishing ──────────────────────────────────
  // Rule 1 – modal was open when extraction started AND is still open:
  //   • done  → auto-switch to review view inside the modal
  //   • error → keep modal open, bgError banner renders automatically (bgError is set)
  // Rule 2 – modal was closed (or user closed it while running):
  //   • done  → "Review ›" badge stays in admin button until user clicks it
  //   • error → "Failed" badge stays in admin button until user opens modal and dismisses
  // Nothing auto-clears — user must take an action.
  useEffect(() => {
    if (bgStatus === 'done' && bgResult && modalWasOpenOnStart && showSyncModal) {
      // Same-window success: transition directly to review
      setExtractedData(bgResult);
      setSyncConfig(prev => ({ ...prev, engineType: bgEngineType }));
      setActiveReviewTab("vessel");
      setModalMode('direct');
      setBgStatus(null);
      setBgResult(null);
      setModalWasOpenOnStart(false);
    }
    // error while modal open: bgError is already set, the banner in the form renders it.
    // No extra action needed here — just clear the "was open" flag so the badge logic
    // kicks in correctly if they close and reopen.
    if (bgStatus === 'error' && modalWasOpenOnStart) {
      setModalWasOpenOnStart(false);
    }
  }, [bgStatus, bgResult, bgEngineType, modalWasOpenOnStart, showSyncModal]);

  // ─── Handlers ─────────────────────────────────────────────────────────────
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

  const toggleMobileNav = () => setIsMobileNavOpen((prev) => !prev);

  const handleDataSync = async (e) => {
    e.preventDefault();
    if (!syncConfig.file) { alert("Please select an Excel file."); return; }
    const typeLabel = syncConfig.engineType === 'mainEngine' ? 'Main Engine Data' : 'Auxiliary Engine Data';
    if (!window.confirm(`⚠️ Are you sure you want to sync/overwrite the ${typeLabel} database with this file?`)) return;
    setSyncing(true);
    try {
      const res = await axiosAepms.adminDataSync(syncConfig.file, syncConfig.engineType);
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

  // Run extraction — modal STAYS OPEN the whole time.
  // modalWasOpenOnStart = true tells the useEffect to handle result inline.
  const handleDirectExtract = async (e) => {
    e.preventDefault();
    if (!vesselId) { alert("Please select a target vessel."); return; }
    if (!syncConfig.file) { alert("Please upload a performance PDF."); return; }

    const capturedEngineType = syncConfig.engineType;
    const capturedFile = syncConfig.file;

    setModalWasOpenOnStart(true);
    setBgProcessing(true);
    setBgStatus('processing');
    setBgEngineType(capturedEngineType);
    setBgResult(null);
    setBgError(null);
    setExtractedData(null);

    try {
      const res = await axiosAepms.extractPdf(capturedFile, capturedEngineType);

      const performancePayload = res?.data?.vessel_info
        ? res.data
        : (res?.vessel_info ? res : res?.data?.data);

      if (!performancePayload || !performancePayload.vessel_info) {
        throw new Error("Extracted performance data is missing required fields.");
      }

      setBgResult(performancePayload);
      setBgStatus('done');   // useEffect above will open review if modal still open
    } catch (err) {
      console.error("Extraction error:", err);
      setBgError(err.message || 'AI extraction failed');
      setBgStatus('error');  // useEffect above clears modalWasOpenOnStart; banner renders via bgError
    } finally {
      setBgProcessing(false);
    }
  };

  // Called from admin "Review ›" badge — modal was closed, user clicks to open review
  const openBgResultModal = () => {
    if (!bgResult) return;
    setExtractedData(bgResult);
    setSyncConfig(prev => ({ ...prev, engineType: bgEngineType }));
    setActiveReviewTab("vessel");
    setModalMode('direct');
    setShowSyncModal(true);
    setBgStatus(null);
    setBgResult(null);
  };

  // User reads the error in the modal and clicks "Dismiss Error" — clears badge + banner
  const dismissError = () => {
    setBgStatus(null);
    setBgError(null);
    setModalWasOpenOnStart(false);
  };

  // Remove one load-percentage column from the extracted performance table.
  // Used when the report logged two readings under the same load % and one is junk.
  const handleDeleteLoadPoint = (idxToDelete) => {
    if (!extractedData?.performance_table) return;
    if (extractedData.performance_table.length <= 1) {
      alert("At least one load point must remain in the performance matrix.");
      return;
    }
    const loadLabel = extractedData.performance_table[idxToDelete]?.load_percentage;
    const confirmMsg = loadLabel
      ? `Remove the ${loadLabel}% load column from the extracted data? This cannot be undone.`
      : "Remove this load column from the extracted data? This cannot be undone.";
    if (!window.confirm(confirmMsg)) return;

    setExtractedData(prev => ({
      ...prev,
      performance_table: prev.performance_table.filter((_, i) => i !== idxToDelete),
    }));
  };

  const handleFinalSubmit = async () => {
    const vesselName = extractedData?.vessel_info?.vessel_name?.trim();
    const imoNumber  = extractedData?.vessel_info?.imo_number?.trim();

    // ── 1. Validate required fields ──────────────────────────────────────────
    if (!vesselName && !imoNumber) {
      alert("⚠️ Vessel Name and IMO Number are both missing.\nPlease fill them in the Vessel Specs tab before saving.");
      return;
    }
    if (!vesselName) {
      alert("⚠️ Vessel Name is missing.\nPlease fill it in the Vessel Specs tab before saving.");
      return;
    }
    if (!imoNumber) {
      alert("⚠️ IMO Number is missing.\nPlease fill it in the Vessel Specs tab before saving.");
      return;
    }

    // ── 2. Duplicate check against vessels already in the DB ─────────────────
    // dbVessels is already fetched; each entry has .imo and .name
    const existingVessel = dbVessels.find(
      v => String(v.imo) === String(imoNumber)
    );
    if (existingVessel) {
      const overwrite = window.confirm(
        `⚠️ Duplicate Detected\n\n` +
        `A vessel with IMO ${imoNumber} ("${existingVessel.name}") already exists in the database.\n\n` +
        `Saving will overwrite its existing performance data.\n` +
        `Do you want to continue?`
      );
      if (!overwrite) return;
    }

    // ── 3. Final confirmation ─────────────────────────────────────────────────
    if (!window.confirm(`Confirm saving Specs and Performance Matrix for "${vesselName}" (IMO: ${imoNumber}) to the database?`)) return;

    setSyncing(true);
    try {
      await axiosAepms.saveAiBaseline({
        ...extractedData,
        engine_type: syncConfig.engineType,
        generator_id: selectedGenerator,
      });
      alert("✅ Performance and specifications data saved successfully!");
      cancelAndClearExtraction();
    } catch (err) {
      alert(`❌ Save failed: ${err.message}`);
    } finally {
      setSyncing(false);
    }
  };

  // X button — close modal but keep ALL bg state so badges/data survive
  const closeModalKeepData = () => {
    setShowSyncModal(false);
    setIsVesselDropdownOpen(false);
    setIsGenDropdownOpen(false);
    setIsEngineDropdownOpen(false);
    setVesselSearch("");
    setGenSearch("");
    // bgStatus, bgResult, bgError, extractedData intentionally NOT cleared
  };

  // Cancel button — wipe everything, user is starting fresh
  const cancelAndClearExtraction = () => {
    setShowSyncModal(false);
    setExtractedData(null);
    setVesselId("");
    setSelectedGenerator("");
    setSyncConfig(prev => ({ ...prev, file: null }));
    setIsVesselDropdownOpen(false);
    setIsGenDropdownOpen(false);
    setIsEngineDropdownOpen(false);
    setVesselSearch("");
    setGenSearch("");
    setBgError(null);
    setBgResult(null);
    setBgStatus(null);
    setBgProcessing(false);
    setModalWasOpenOnStart(false);
  };

  // Fixed widths for the frozen Parameter/Unit columns in the performance matrix.
  // Both header (th) and body (td) cells for these columns use these exact widths so the
  // sticky "left" offsets line up perfectly. Adjust here if your design needs different widths.
  const PARAM_COL_WIDTH = 210;
  const UNIT_COL_WIDTH = 64;

  const getTabStyle = (tabName) => ({
    padding: '7px 16px',
    borderRadius: '6px',
    fontWeight: activeReviewTab === tabName ? 700 : 500,
    backgroundColor: activeReviewTab === tabName ? '#0f172a' : 'transparent',
    color: activeReviewTab === tabName ? 'white' : '#64748b',
    border: activeReviewTab === tabName ? 'none' : '1px solid transparent',
    cursor: 'pointer',
    fontSize: '13px',
    transition: 'all 0.18s',
    letterSpacing: '0.01em',
  });

  // Dot on admin button — stays until user clears it
  const showAdminDot = bgStatus === 'processing' || bgStatus === 'done' || bgStatus === 'error';
  const dotColor = bgStatus === 'processing' ? '#f59e0b' : bgStatus === 'done' ? '#22c55e' : '#ef4444';

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
              <div className="dots-grid" style={{ display: "grid", gridTemplateColumns: "repeat(3, 7px)", gap: "3px", position: "absolute", transition: "opacity 0.2s", opacity: "1" }}>
                {[...Array(9)].map((_, i) => (
                  <span key={i} style={{ width: "7px", height: "7px", borderRadius: "2px", backgroundColor: "#94a3b8", display: "block" }} />
                ))}
              </div>
              <div className="dots-arrow" style={{ position: "absolute", opacity: "0", width: "35px", height: "35px", transition: "opacity 0.2s", color: "#94a3b8", fontSize: "1.4rem", fontWeight: "bold", lineHeight: 1, display: "flex", alignItems: "center", justifyContent: "center", backgroundColor: "white", borderRadius: "20%", border: "1px solid rgba(48, 46, 46, 0.1)" }}>
                ‹
              </div>
            </button>
            <span className="brand-title">Ship Engine Performance Console</span>
          </div>

          <nav className={`header-nav ${isMobileNavOpen ? "open" : ""}`}>
            {nav.map((n) => (
              <Link key={n.href} to={n.href} className={`nav-link ${isActive(n.href) ? "active" : ""}`} onClick={() => setIsMobileNavOpen(false)}>
                {n.label}
              </Link>
            ))}
          </nav>

          <div className="header-actions">
            <button className="mobile-nav-toggle" onClick={toggleMobileNav} aria-label="Toggle navigation" aria-expanded={isMobileNavOpen}>☰</button>

            <div className="user-menu-container" ref={menuRef}>
              <button className="user-menu-trigger" onClick={toggleMenu} style={{ position: 'relative' }}>
                <User size={18} />
                {showAdminDot && (
                  <span style={{
                    position: 'absolute', top: '2px', left: '2px',
                    width: '8px', height: '8px', borderRadius: '50%',
                    backgroundColor: dotColor, border: '1.5px solid white',
                    animation: bgStatus === 'processing' ? 'pulse-dot 1.2s ease-in-out infinite' : 'none',
                  }} />
                )}
                <span className="user-menu-name">{user?.full_name || "User"}</span>
                <ChevronDown size={16} className={`user-menu-chevron ${isMenuOpen ? "open" : "closed"}`} />
              </button>

              {isMenuOpen && (
                <div className="user-dropdown-menu">
                  <div className="user-dropdown-header">
                    <div className="user-dropdown-name">{user?.full_name || "User"}</div>
                    <div className="user-dropdown-auth">{user?.role || "Member"}</div>
                  </div>
                  <div className="user-dropdown-items">
                    <button onClick={() => { setIsMenuOpen(false); navigate("/dashboard"); }} className="user-dropdown-btn">
                      <LayoutDashboard size={16} /> <span>Back to Dashboard</span>
                    </button>

                    {(user?.role?.toLowerCase() === "admin" || user?.role?.toLowerCase() === "superuser") && (
                      <>
                        <div className="user-dropdown-divider" />
                        <div className="user-dropdown-section-label">Admin Tools</div>

                        <button
                          onClick={() => { setIsMenuOpen(false); setModalMode('sync'); setShowSyncModal(true); }}
                          className="user-dropdown-btn admin-sync"
                        >
                          <Database size={16} />
                          <span>Data Sync (Excel)</span>
                        </button>

                        <button
                          onClick={() => {
                            setIsMenuOpen(false);
                            if (bgStatus === 'done' && bgResult) {
                              // Result ready — open review directly
                              openBgResultModal();
                            } else {
                              // Open the form (or show error if failed)
                              setModalMode('direct');
                              setShowSyncModal(true);
                            }
                          }}
                          className="user-dropdown-btn admin-ai"
                        >
                          <div style={{ position: 'relative', display: 'inline-flex', alignItems: 'center' }}>
                            <Shield size={16} />
                            {showAdminDot && (
                              <span style={{
                                position: 'absolute', top: '-4px', right: '-4px',
                                width: '8px', height: '8px', borderRadius: '50%',
                                backgroundColor: dotColor, border: '1.5px solid white',
                                animation: bgStatus === 'processing' ? 'pulse-dot 1.2s ease-in-out infinite' : 'none',
                              }} />
                            )}
                          </div>
                          <span>Direct AI Analysis</span>

                          {bgStatus === 'processing' && (
                            <span style={{ marginLeft: 'auto', fontSize: '10px', color: '#f59e0b', fontWeight: 600, background: '#fef3c7', padding: '2px 7px', borderRadius: '99px' }}>
                              Running…
                            </span>
                          )}
                          {bgStatus === 'done' && (
                            <span
                              style={{ marginLeft: 'auto', fontSize: '10px', color: '#16a34a', fontWeight: 600, background: '#dcfce7', padding: '2px 7px', borderRadius: '99px', cursor: 'pointer' }}
                              onClick={(e) => { e.stopPropagation(); setIsMenuOpen(false); openBgResultModal(); }}
                            >
                              Review ›
                            </span>
                          )}
                          {bgStatus === 'error' && (
                            <span style={{ marginLeft: 'auto', fontSize: '10px', color: '#dc2626', fontWeight: 600, background: '#fee2e2', padding: '2px 7px', borderRadius: '99px' }}>
                              Failed — view ›
                            </span>
                          )}
                        </button>
                      </>
                    )}

                    <div className="user-dropdown-divider" />
                    {/* <button onClick={handleSignOut} className="user-dropdown-btn logout">
                      <LogOut size={16} /> <span>Sign Out</span>
                    </button> */}
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>
      </header>

      {/* ─── MODAL ─── */}
      {showSyncModal && (
        <div className="modal-backdrop" onClick={(e) => { if (e.target === e.currentTarget) closeModalKeepData(); }}>
          <div className={`modal-card ${extractedData ? 'modal-card--wide' : ''}`}>

            {/* Header */}
            <div className="modal-header">
              <div className="modal-header-left">
                <div className={`modal-icon ${modalMode === 'sync' ? 'modal-icon--sync' : 'modal-icon--ai'}`}>
                  {modalMode === 'sync' ? <Database size={18} /> : <Shield size={18} />}
                </div>
                <div>
                  <div className="modal-title">{modalMode === 'sync' ? 'System Data Sync' : 'Direct AI Analysis'}</div>
                  <div className="modal-subtitle">
                    {modalMode === 'sync'
                      ? 'Upload an Excel file to update the performance database'
                      : 'Extract performance data from a PDF using AI'}
                  </div>
                </div>
              </div>
              {/* X closes modal but keeps ALL state — badges and data survive */}
              <button onClick={closeModalKeepData} className="modal-close-btn" aria-label="Close">
                <X size={18} />
              </button>
            </div>

            {/* Body */}
            {!extractedData ? (
              <form onSubmit={modalMode === 'sync' ? handleDataSync : handleDirectExtract} className="modal-form">

                {modalMode === 'direct' && (
                  <div className="form-field">
                    <label className="form-label">Target Vessel</label>
                    <div className="cselect-wrapper" ref={vesselRef}>
                      <button
                        type="button"
                        disabled={bgStatus === 'processing'}
                        className={`cselect-trigger ${isVesselDropdownOpen ? "cselect-trigger--open" : ""} ${bgStatus === 'processing' ? "cselect-trigger--disabled" : ""}`}
                        onClick={() => setIsVesselDropdownOpen(!isVesselDropdownOpen)}
                      >
                        <span className={`cselect-value ${!vesselId ? "cselect-value--placeholder" : ""}`}>
                          {dbVessels.find(v => v.imo === vesselId)?.name || "— Select vessel —"}
                        </span>
                        <ChevronDown size={16} className={`cselect-chevron ${isVesselDropdownOpen ? "cselect-chevron--open" : ""}`} />
                      </button>
                      {isVesselDropdownOpen && bgStatus !== 'processing' && (
                        <div className="cselect-panel">
                          <div className="cselect-search-wrap">
                            <input type="text" className="cselect-search-input" placeholder="Search vessel..." value={vesselSearch} onChange={(e) => setVesselSearch(e.target.value)} autoFocus />
                          </div>
                          <div className="cselect-list">
                            {dbVessels
                              .filter(v => v.name?.toLowerCase().includes(vesselSearch.toLowerCase()))
                              .sort((a, b) => (a.name || "").localeCompare(b.name || ""))
                              .map((v, i) => (
                              <div key={v.imo || `vessel-${i}`} className={`cselect-option ${v.imo === vesselId ? "cselect-option--selected" : ""}`}
                                onClick={() => { setVesselId(v.imo); setIsVesselDropdownOpen(false); setVesselSearch(""); }}>
                                {v.name}
                              </div>
                            ))}
                            {dbVessels.filter(v => v.name?.toLowerCase().includes(vesselSearch.toLowerCase())).length === 0 && (
                              <div className="cselect-empty">No vessels found</div>
                            )}
                          </div>
                        </div>
                      )}
                    </div>
                  </div>
                )}

                <div className="form-field">
                  <label className="form-label">Engine Target</label>
                  <div className="cselect-wrapper" ref={engineRef}>
                    <button
                      type="button"
                      disabled={bgStatus === 'processing'}
                      className={`cselect-trigger ${isEngineDropdownOpen ? "cselect-trigger--open" : ""} ${bgStatus === 'processing' ? "cselect-trigger--disabled" : ""}`}
                      onClick={() => setIsEngineDropdownOpen(!isEngineDropdownOpen)}
                    >
                      <span className="cselect-value">
                        {syncConfig.engineType === 'mainEngine' ? 'Main Engine' : 'Auxiliary Engine'}
                      </span>
                      <ChevronDown size={16} className={`cselect-chevron ${isEngineDropdownOpen ? "cselect-chevron--open" : ""}`} />
                    </button>
                    {isEngineDropdownOpen && bgStatus !== 'processing' && (
                      <div className="cselect-panel">
                        <div className="cselect-list">
                          <div className={`cselect-option ${syncConfig.engineType === 'mainEngine' ? 'cselect-option--selected' : ''}`}
                            onClick={() => { setSyncConfig(prev => ({ ...prev, engineType: 'mainEngine' })); setIsEngineDropdownOpen(false); }}>
                            Main Engine
                          </div>
                          <div className={`cselect-option ${syncConfig.engineType === 'auxiliaryEngine' ? 'cselect-option--selected' : ''}`}
                            onClick={() => { setSyncConfig(prev => ({ ...prev, engineType: 'auxiliaryEngine' })); setIsEngineDropdownOpen(false); }}>
                            Auxiliary Engine
                          </div>
                        </div>
                      </div>
                    )}
                  </div>
                </div>

                {modalMode === 'direct' && syncConfig.engineType === 'auxiliaryEngine' && vesselId && (
                  <div className="form-field">
                    <label className="form-label">Generator Unit</label>
                    <div className="cselect-wrapper" ref={genRef}>
                      <button
                        type="button"
                        disabled={bgStatus === 'processing'}
                        className={`cselect-trigger ${isGenDropdownOpen ? "cselect-trigger--open" : ""} ${bgStatus === 'processing' ? "cselect-trigger--disabled" : ""}`}
                        onClick={() => setIsGenDropdownOpen(!isGenDropdownOpen)}
                      >
                        <span className={`cselect-value ${!selectedGenerator ? "cselect-value--placeholder" : ""}`}>
                          {generators.find(g => g.generator_id === selectedGenerator)?.designation || "— Choose unit —"}
                        </span>
                        <ChevronDown size={16} className={`cselect-chevron ${isGenDropdownOpen ? "cselect-chevron--open" : ""}`} />
                      </button>
                      {isGenDropdownOpen && bgStatus !== 'processing' && (
                        <div className="cselect-panel">
                          <div className="cselect-search-wrap">
                            <input type="text" className="cselect-search-input" placeholder="Search generator..." value={genSearch} onChange={(e) => setGenSearch(e.target.value)} autoFocus />
                          </div>
                          <div className="cselect-list">
                            {generators.filter(g => g.designation?.toLowerCase().includes(genSearch.toLowerCase())).map((g, i) => (
                              <div key={g.generator_id || `gen-${i}`} className={`cselect-option ${g.generator_id === selectedGenerator ? "cselect-option--selected" : ""}`}
                                onClick={() => { setSelectedGenerator(g.generator_id); setIsGenDropdownOpen(false); setGenSearch(""); }}>
                                {g.designation}
                              </div>
                            ))}
                            {generators.filter(g => g.designation?.toLowerCase().includes(genSearch.toLowerCase())).length === 0 && (
                              <div className="cselect-empty">No units found</div>
                            )}
                          </div>
                        </div>
                      )}
                    </div>
                  </div>
                )}

                <div className="form-field">
                  <label className="form-label">{modalMode === 'sync' ? 'Excel File' : 'Performance PDF'}</label>
                  <div className="form-file-area">
                    <input
                      type="file"
                      disabled={bgStatus === 'processing'}
                      accept={modalMode === 'sync' ? ".xlsx,.xls" : ".pdf"}
                      onChange={(e) => setSyncConfig(prev => ({ ...prev, file: e.target.files[0] }))}
                      className="form-file-input"
                      id="file-upload"
                    />
                    <label htmlFor="file-upload" className="form-file-label" style={bgStatus === 'processing' ? { opacity: 0.6, cursor: 'not-allowed' } : {}}>
                      <Upload size={18} />
                      {syncConfig.file ? syncConfig.file.name : `Choose ${modalMode === 'sync' ? '.xlsx / .xls' : '.pdf'} file`}
                    </label>
                  </div>
                </div>

                {/* Idle info hint */}
                {modalMode === 'direct' && !bgStatus && (
                  <div className="form-info-box">
                    <span className="form-info-icon">ℹ</span>
                    <span>AI extraction can take 1–3 minutes. You can close this modal — the result will be waiting in the admin button when done.</span>
                  </div>
                )}

                {/* ── RUNNING banner ── */}
                {modalMode === 'direct' && bgStatus === 'processing' && (
                  <div className="form-info-box" style={{ background: '#fef3c7', border: '1px solid #fde68a', color: '#b45309' }}>
                    <Loader2 className="animate-spin" size={16} style={{ marginRight: '6px', flexShrink: 0 }} />
                    <span>AI extraction is running… Results will appear here automatically when complete. You can also close this modal and come back later.</span>
                  </div>
                )}

                {/* ── ERROR banner — shown when extraction failed (same-window OR reopened after close) ── */}
                {/* Stays visible until user clicks "Dismiss" — does NOT auto-clear on open */}
                {modalMode === 'direct' && bgStatus === 'error' && bgError && (
                  <div className="form-info-box" style={{ background: '#fef2f2', border: '1px solid #fecaca', color: '#b91c1c', flexDirection: 'column', gap: '8px', padding: '12px 14px' }}>
                    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', width: '100%' }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                        <AlertCircle size={16} style={{ flexShrink: 0 }} />
                        <span style={{ fontWeight: 700 }}>Extraction Failed</span>
                      </div>
                      <div style={{ display: 'flex', gap: '6px' }}>
                        <button
                          type="button"
                          onClick={() => { navigator.clipboard.writeText(bgError); alert("Error copied to clipboard!"); }}
                          style={{ background: '#fff', border: '1.5px solid #fecaca', borderRadius: '6px', padding: '3px 10px', fontSize: '11px', fontWeight: 700, color: '#dc2626', cursor: 'pointer' }}
                        >
                          Copy
                        </button>
                        {/* Dismiss clears the error banner AND the admin button badge */}
                        <button
                          type="button"
                          onClick={dismissError}
                          style={{ background: '#dc2626', border: 'none', borderRadius: '6px', padding: '3px 10px', fontSize: '11px', fontWeight: 700, color: '#fff', cursor: 'pointer' }}
                        >
                          Dismiss
                        </button>
                      </div>
                    </div>
                    <div style={{
                      fontSize: '12px', marginLeft: '22px',
                      display: '-webkit-box', WebkitLineClamp: 4, WebkitBoxOrient: 'vertical',
                      overflow: 'hidden', textOverflow: 'ellipsis', wordBreak: 'break-word', whiteSpace: 'pre-line'
                    }}>
                      {bgError}
                    </div>
                  </div>
                )}

                <div className="modal-actions">
                  <button type="button" className="btn btn--secondary" onClick={modalMode === 'sync' ? closeModalKeepData : cancelAndClearExtraction}>
                    Cancel
                  </button>
                  <button type="submit" className="btn btn--primary" disabled={isExtracting || syncing || !syncConfig.file || bgStatus === 'processing'}>
                    {modalMode === 'sync'
                      ? (syncing ? 'Syncing…' : 'Start Sync')
                      : (bgStatus === 'processing' ? 'Running…' : 'Run AI Extract')}
                  </button>
                </div>
              </form>
            ) : (
              /* ── Review extracted data ── */
              <div className="review-container">
                <div className="review-tabs">
                  {syncConfig.engineType === 'mainEngine' ? (
                    <>
                      <button type="button" onClick={() => setActiveReviewTab("vessel")} style={getTabStyle("vessel")}>Vessel Specs</button>
                      <button type="button" onClick={() => setActiveReviewTab("session")} style={getTabStyle("session")}>Trial Session</button>
                      <button type="button" onClick={() => setActiveReviewTab("performance")} style={getTabStyle("performance")}>Performance Matrix</button>
                    </>
                  ) : (
                    <>
                      <button type="button" onClick={() => setActiveReviewTab("vessel")} style={getTabStyle("vessel")}>Generator & Trial Specs</button>
                      <button type="button" onClick={() => setActiveReviewTab("performance")} style={getTabStyle("performance")}>Performance Matrix</button>
                    </>
                  )}
                </div>

                <div className="review-panel">
                  {/* Main Engine — Vessel Specs */}
                  {syncConfig.engineType === 'mainEngine' && activeReviewTab === "vessel" && (
                    <div>
                      <div className="review-section-title">Vessel Specifications</div>
                      <div className="review-grid review-grid--4">
                        {Object.entries(extractedData.vessel_info).map(([key, value]) => {
                          if (key.endsWith("_Unit") || key === "mcr_limit_unit") return null;
                          return (
                            <div key={key} className="review-field">
                              <label className="review-field-label">{key.replace(/_/g, ' ')}</label>
                              <input className="review-field-input" value={value || ""}
                                onChange={(e) => setExtractedData({ ...extractedData, vessel_info: { ...extractedData.vessel_info, [key]: e.target.value } })} />
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  )}

                  {/* Main Engine — Trial Session */}
                  {syncConfig.engineType === 'mainEngine' && activeReviewTab === "session" && (
                    <div>
                      <div className="review-section-title">Trial Session Details</div>
                      <div className="review-grid review-grid--3">
                        {Object.entries(extractedData.session_info).map(([key, value]) => {
                          if (key.endsWith("_Unit")) return null;
                          return (
                            <div key={key} className="review-field">
                              <label className="review-field-label">{key.replace(/_/g, ' ')}</label>
                              <input className="review-field-input" value={value || ""}
                                onChange={(e) => setExtractedData({ ...extractedData, session_info: { ...extractedData.session_info, [key]: e.target.value } })} />
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  )}

                  {/* Aux Engine — Generator & Trial Specs */}
                  {syncConfig.engineType === 'auxiliaryEngine' && activeReviewTab === "vessel" && (
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '24px' }}>
                      <div>
                        <div className="review-section-title">Auxiliary Generator Specifications</div>
                        <div className="review-grid review-grid--4">
                          {['vessel_name', 'imo_number', 'engine_no', 'engine_maker', 'engine_type', 'engine_model', 'number_of_cylinders', 'mcr_power_kw', 'mcr_rpm'].map((key) => (
                            <div key={key} className="review-field">
                              <label className="review-field-label">{key.replace(/_/g, ' ')}</label>
                              <input className="review-field-input" value={extractedData.vessel_info[key] || ""}
                                onChange={(e) => setExtractedData({ ...extractedData, vessel_info: { ...extractedData.vessel_info, [key]: e.target.value } })} />
                            </div>
                          ))}
                        </div>
                      </div>
                      <div>
                        <div className="review-section-title">Trial & Environmental Details</div>
                        <div className="review-grid review-grid--3">
                          {['trial_date', 'trial_type', 'conducted_by', 'remarks', 'document_title', 'room_temp_cold_condition_c'].map((key) => (
                            <div key={key} className="review-field">
                              <label className="review-field-label">{key.replace(/_/g, ' ')}</label>
                              <input className="review-field-input" value={extractedData.session_info[key] || ""}
                                onChange={(e) => setExtractedData({ ...extractedData, session_info: { ...extractedData.session_info, [key]: e.target.value } })} />
                            </div>
                          ))}
                        </div>
                      </div>
                    </div>
                  )}

                  {/* Performance Matrix */}
                  {activeReviewTab === "performance" && (
                    <div>
                      <div className="review-section-title">
                        {syncConfig.engineType === 'auxiliaryEngine' ? 'Aux Engine Shop Trial Performance Matrix' : 'Shop Trial Performance Matrix'}
                      </div>
                      <div style={{ overflow: 'auto', maxHeight: '65vh', position: 'relative' }}>
                        <table className="perf-table" style={{ borderCollapse: 'separate', borderSpacing: 0 }}>
                          <thead>
                            <tr>
                              <th
                                className="perf-th perf-th--param"
                                style={{ position: 'sticky', top: 0, left: 0, zIndex: 4, background: '#fff', width: PARAM_COL_WIDTH, minWidth: PARAM_COL_WIDTH, maxWidth: PARAM_COL_WIDTH, boxSizing: 'border-box' }}
                              >
                                Parameter
                              </th>
                              <th
                                className="perf-th perf-th--unit"
                                style={{ position: 'sticky', top: 0, left: PARAM_COL_WIDTH, zIndex: 4, background: '#fff', width: UNIT_COL_WIDTH, minWidth: UNIT_COL_WIDTH, maxWidth: UNIT_COL_WIDTH, boxSizing: 'border-box' }}
                              >
                                Unit
                              </th>
                              {extractedData.performance_table.map((p, idx) => (
                                <th
                                  key={idx}
                                  className="perf-th perf-th--load"
                                  style={{ position: 'sticky', top: 0, zIndex: 2, background: '#fff' }}
                                >
                                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '4px' }}>
                                    <input className="perf-load-input" value={p.load_percentage || ""}
                                      onChange={(e) => {
                                        const next = [...extractedData.performance_table];
                                        next[idx].load_percentage = e.target.value;
                                        setExtractedData({ ...extractedData, performance_table: next });
                                      }} />
                                    <button
                                      type="button"
                                      title="Remove this load point from the extracted data"
                                      onClick={() => handleDeleteLoadPoint(idx)}
                                      style={{ background: 'transparent', border: 'none', cursor: 'pointer', color: '#ef4444', display: 'flex', alignItems: 'center', padding: '2px', flexShrink: 0 }}
                                    >
                                      <Trash2 size={13} />
                                    </button>
                                  </div>
                                </th>
                              ))}
                            </tr>
                          </thead>
                          <tbody>
                            {(syncConfig.engineType === 'auxiliaryEngine' ? [
                              { label: 'Generator Load', unit: 'kW', key: 'load_kw' },
                              { label: 'Pmax (Raw)', unit: 'MPa', key: 'pmax_raw_mpa' },
                              { label: 'Boost Air Pressure (Raw)', unit: 'MPa', key: 'boost_air_pressure_raw_mpa' },
                              { label: 'Exh. Temp T/C Inlet', unit: '°C', key: 'exh_temp_tc_inlet_graph_c' },
                              { label: 'Exh. Temp Cyl. Outlet Avg', unit: '°C', key: 'exh_temp_cyl_outlet_avg_graph_c' },
                              { label: 'Exh. Temp T/C Outlet', unit: '°C', key: 'exh_temp_tc_outlet_graph_c' },
                              { label: 'Fuel Pump Index', unit: 'mm', key: 'fuel_pump_index_graph' },
                              { label: 'SFOC', unit: 'g/kWh', key: 'sfoc_graph_g_kwh' },
                            ] : [
                              { label: 'Test Sequence', unit: '#', key: 'test_sequence' },
                              { label: 'Engine Speed', unit: 'rpm', key: 'engine_speed_rpm' },
                              { label: 'Engine Output', unit: 'kW', key: 'engine_output_kw' },
                              { label: 'Max Comb. Pressure (Meas.)', unit: 'bar', key: 'max_combustion_pressure_bar' },
                              { label: 'Max Comb. Pressure (ISO)', unit: 'bar', key: 'max_combustion_pressure_iso_bar' },
                              { label: 'Comp. Pressure (Meas.)', unit: 'bar', key: 'compression_pressure_bar' },
                              { label: 'Comp. Pressure (ISO)', unit: 'bar', key: 'compression_pressure_iso_bar' },
                              { label: 'Mean Eff. Pressure', unit: 'bar', key: 'mean_effective_pressure_bar' },
                              { label: 'Scav Air Pressure (Meas.)', unit: 'bar', key: 'scav_air_pressure_bar' },
                              { label: 'Scav Air Pressure (ISO)', unit: 'kg/cm²', key: 'scav_air_pressure_iso_kg_cm2' },
                              { label: 'T/C Gas Inlet Pressure', unit: 'kg/cm²', key: 'turbocharger_gas_inlet_press_kg_cm2' },
                              { label: 'Scav Air Temp', unit: '°C', key: 'scav_air_temperature_c' },
                              { label: 'Exh Temp Cyl. Outlet (Avg)', unit: '°C', key: 'exh_temp_cylinder_outlet_ave_c' },
                              { label: 'Exh Temp T/C Inlet (Meas.)', unit: '°C', key: 'exh_temp_tc_inlet_c' },
                              { label: 'Exh Temp T/C Inlet (ISO)', unit: '°C', key: 'exh_temp_tc_inlet_iso_c' },
                              { label: 'Exh Temp T/C Outlet (Meas.)', unit: '°C', key: 'exh_temp_tc_outlet_c' },
                              { label: 'Exh Temp T/C Outlet (ISO)', unit: '°C', key: 'exh_temp_tc_outlet_iso_c' },
                              { label: 'T/C Speed (Meas.)', unit: 'x1000 rpm', key: 'turbocharger_speed_x1000_rpm' },
                              { label: 'T/C Speed (ISO)', unit: 'x1000 rpm', key: 'turbocharger_speed_x1000_iso_rpm' },
                              { label: 'Fuel Index', unit: 'mm', key: 'fuel_injection_pump_index_mm' },
                              { label: 'Fuel Oil Temp', unit: '°C', key: 'fuel_oil_temperature_c' },
                              { label: 'Fuel Consumption', unit: 'kg/h', key: 'fuel_oil_consumption_kg_h' },
                              { label: 'SFOC (Meas.)', unit: 'g/kWh', key: 'fuel_oil_consumption_g_kwh' },
                              { label: 'SFOC (ISO)', unit: 'g/kWh', key: 'fuel_oil_consumption_iso_g_kwh' },
                              { label: 'T/C Inlet Temp', unit: '°C', key: 'tc_inlet_temp_c' },
                              { label: 'T/C Outlet Back Press', unit: 'mmAq', key: 'tc_outlet_back_press_mmaq' },
                              { label: 'Test Room Temp', unit: '°C', key: 'room_temperature_c' },
                              { label: 'Test Room Humidity', unit: '%', key: 'room_humidity_percent' },
                              { label: 'Barometric Pressure', unit: 'mbar', key: 'barometer_pressure_mbar' },
                            ]).map((row, idx) => (
                              <tr key={row.key} className={`perf-row ${idx % 2 === 0 ? '' : 'perf-row--alt'}`}>
                                <td
                                  className="perf-td perf-td--param"
                                  style={{ position: 'sticky', left: 0, zIndex: 1, background: idx % 2 === 0 ? '#fff' : '#f8fafc', width: PARAM_COL_WIDTH, minWidth: PARAM_COL_WIDTH, maxWidth: PARAM_COL_WIDTH, boxSizing: 'border-box' }}
                                >
                                  {row.label}
                                </td>
                                <td
                                  className="perf-td perf-td--unit"
                                  style={{ position: 'sticky', left: PARAM_COL_WIDTH, zIndex: 1, background: idx % 2 === 0 ? '#fff' : '#f8fafc', width: UNIT_COL_WIDTH, minWidth: UNIT_COL_WIDTH, maxWidth: UNIT_COL_WIDTH, boxSizing: 'border-box' }}
                                >
                                  {row.unit}
                                </td>
                                {extractedData.performance_table.map((p, pIdx) => (
                                  <td key={pIdx} className="perf-td perf-td--value">
                                    <input className="perf-cell-input" value={p[row.key] || ""}
                                      onChange={(e) => {
                                        const next = [...extractedData.performance_table];
                                        next[pIdx][row.key] = e.target.value;
                                        setExtractedData({ ...extractedData, performance_table: next });
                                      }} />
                                  </td>
                                ))}
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    </div>
                  )}
                </div>

                <div className="modal-actions modal-actions--review">
                  <button type="button" className="btn btn--secondary" onClick={() => setExtractedData(null)}>← Back</button>
                  <button type="button" className="btn btn--ghost" onClick={cancelAndClearExtraction}>Cancel</button>
                  <button type="button" className="btn btn--primary" onClick={handleFinalSubmit} disabled={syncing}>
                    {syncing ? 'Saving…' : 'Commit Vessel Configuration'}
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>
      )}
    </>
  );
}
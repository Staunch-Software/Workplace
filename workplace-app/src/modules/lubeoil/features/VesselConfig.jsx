import React, { useState, useEffect, useCallback } from "react";
import axiosLub from "../api/axiosLub";
import {
  ChevronLeft,
  Plus,
  Pencil,
  Trash2,
  Save,
  X,
  Ship,
  Wrench,
  CheckCircle2,
  AlertCircle,
  Loader2,
  ChevronDown,
  ChevronUp,
  Settings2,
  Search,
  AlertTriangle,
  LayoutGrid,
} from "lucide-react";
import "../styles/VesselConfigresponsiveness.css";

// ─── Design tokens ────────────────────────────────────────────────────────
const C = {
  bg: "#f0f4f8",
  sidebar: "#1e293b",
  white: "#ffffff",
  accent: "#1e293b",
  accentBtn: "#3b82f6",
  green: "#10b981",
  red: "#ef4444",
  amber: "#f59e0b",
  text: "#0f172a",
  textMid: "#475569",
  textLight: "#94a3b8",
  border: "#e2e8f0",
  cardShadow: "0 1px 3px rgba(0,0,0,0.08), 0 1px 2px rgba(0,0,0,0.04)",
};

const TOPBAR_H = 56; // px
const SIDEBAR_W = 300; // px

// ─── API helper ────────────────────────────────────────────────────────────
const API = async (path, opts = {}) => {
  const method = (opts.method || "GET").toLowerCase();
  const body = opts.body ? JSON.parse(opts.body) : undefined;
  const res = await axiosLub({ method, url: path, data: body });
  return res.data;
};

// ─── Small reusable components ─────────────────────────────────────────────
const Badge = ({ label, color }) => (
  <span
    style={{
      display: "inline-flex",
      alignItems: "center",
      padding: "2px 8px",
      borderRadius: "20px",
      fontSize: "0.68rem",
      fontWeight: "700",
      background: color + "18",
      color,
      border: `1px solid ${color}30`,
    }}
  >
    {label}
  </span>
);

const Field = ({ label, required, children }) => (
  <label style={{ display: "flex", flexDirection: "column", gap: "6px" }}>
    <span
      style={{
        fontSize: "0.72rem",
        fontWeight: "700",
        color: C.textMid,
        letterSpacing: "0.5px",
        textTransform: "uppercase",
      }}
    >
      {label}
      {required && <span style={{ color: C.red }}> *</span>}
    </span>
    {children}
  </label>
);

const LightInput = (props) => (
  <input
    {...props}
    style={{
      background: "#f8fafc",
      border: `1.5px solid ${C.border}`,
      borderRadius: "8px",
      padding: "9px 12px",
      color: C.text,
      fontSize: "0.85rem",
      width: "100%",
      outline: "none",
      transition: "border-color 0.15s, box-shadow 0.15s",
      fontFamily: "inherit",
      ...(props.style || {}),
    }}
    onFocus={(e) => {
      e.target.style.borderColor = C.accentBtn;
      e.target.style.boxShadow = "0 0 0 3px rgba(59,130,246,0.1)";
      props.onFocus?.(e);
    }}
    onBlur={(e) => {
      e.target.style.borderColor = C.border;
      e.target.style.boxShadow = "none";
      props.onBlur?.(e);
    }}
  />
);

const LightSelect = ({ children, ...props }) => (
  <select
    {...props}
    style={{
      background: "#f8fafc",
      border: `1.5px solid ${C.border}`,
      borderRadius: "8px",
      padding: "9px 12px",
      color: C.text,
      fontSize: "0.85rem",
      width: "100%",
      outline: "none",
      cursor: "pointer",
      fontFamily: "inherit",
      ...(props.style || {}),
    }}
  >
    {children}
  </select>
);

// ─── Toast ─────────────────────────────────────────────────────────────────
const Toast = ({ msg, type, onDone }) => {
  useEffect(() => {
    const t = setTimeout(onDone, 3500);
    return () => clearTimeout(t);
  }, [onDone]);
  return (
    <div
      style={{
        position: "fixed",
        bottom: "24px",
        right: "24px",
        zIndex: 99999,
        display: "flex",
        alignItems: "center",
        gap: "10px",
        background: C.white,
        border: `1.5px solid ${type === "success" ? C.green : C.red}`,
        borderLeft: `4px solid ${type === "success" ? C.green : C.red}`,
        borderRadius: "10px",
        padding: "14px 18px",
        boxShadow: "0 10px 40px rgba(0,0,0,0.12)",
        color: type === "success" ? C.green : C.red,
        fontSize: "0.84rem",
        fontWeight: "600",
        maxWidth: "360px",
        animation: "toastIn 0.3s ease",
      }}
    >
      {type === "success" ? (
        <CheckCircle2 size={16} />
      ) : (
        <AlertCircle size={16} />
      )}
      {msg}
    </div>
  );
};

// ─── Section Header ────────────────────────────────────────────────────────
const SectionHeader = ({ title, subtitle, icon, action }) => (
  <div
    style={{
      display: "flex",
      justifyContent: "space-between",
      alignItems: "center",
      position: "sticky",
      top: 0,
      zIndex: 100,
      background: "#ffffff",
      padding: "16px 24px 14px",
      marginTop: "-16px",
      marginLeft: "-24px",
      marginRight: "-24px",
      marginBottom: "20px",
      borderBottom: `1px solid #e2e8f0`,
      boxShadow: "0 2px 8px rgba(0,0,0,0.06)",
    }}
  >
    <div style={{ display: "flex", alignItems: "flex-start", gap: "10px" }}>
      <div
        style={{
          width: "36px",
          height: "36px",
          borderRadius: "9px",
          background: "#f1f5f9",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          flexShrink: 0,
          marginTop: "2px",
        }}
      >
        {icon}
      </div>
      <div>
        <h2
          style={{
            fontSize: "1.15rem",
            fontWeight: "800",
            margin: 0,
            color: "#0f172a",
          }}
        >
          {title}
        </h2>
        <p
          style={{
            fontSize: "0.8rem",
            color: "#64748b",
            margin: "3px 0 0",
            lineHeight: "1.4",
          }}
        >
          {subtitle}
        </p>
      </div>
    </div>
    {action && (
      <div style={{ flexShrink: 0, marginLeft: "16px" }}>{action}</div>
    )}
  </div>
);

// ─── Empty State ───────────────────────────────────────────────────────────
const EmptyState = ({ icon, text }) => (
  <div
    style={{
      background: C.white,
      borderRadius: "12px",
      border: `1px solid ${C.border}`,
      padding: "48px 24px",
      textAlign: "center",
      color: C.textLight,
    }}
  >
    <div style={{ opacity: 0.3, marginBottom: "10px" }}>{icon}</div>
    <p style={{ margin: 0, fontSize: "0.88rem" }}>{text}</p>
  </div>
);

// ══════════════════════════════════════════════════════════════════════════
// MAIN PAGE
// ══════════════════════════════════════════════════════════════════════════
const VesselConfigPage = () => {
  // "configured" | "unconfigured" | "equipment" | "vessel-mapping"
  const [activeSection, setActiveSection] = useState("configured");
  const [vessels, setVessels] = useState([]);
  const [unconfiguredVessels, setUnconfiguredVessels] = useState([]);
  const [equipment, setEquipment] = useState([]);
  const [configs, setConfigs] = useState([]);
  const [selVessel, setSelVessel] = useState(null);
  const [loading, setLoading] = useState(false);
  const [toast, setToast] = useState(null);
  const [equipModal, setEquipModal] = useState(null);
  const [searchEq, setSearchEq] = useState("");
  const [searchVessel, setSearchVessel] = useState("");
  const [searchNewVessel, setSearchNewVessel] = useState("");

  const showToast = useCallback(
    (msg, type = "success") => setToast({ msg, type }),
    [],
  );
  const apiErr = (err) =>
    err?.response?.data?.detail || err?.message || String(err);

  // ─── Load all data ───────────────────────────────────────────────────
  const loadAll = useCallback(async () => {
    setLoading(true);
    try {
      const [v, e, c, u] = await Promise.all([
        API("/api/config/vessels"),
        API("/api/config/equipment"),
        API("/api/config/vessel-configs"),
        API("/api/config/vessels/unconfigured"),
      ]);
      setVessels(v);
      setEquipment(e);
      setConfigs(c);
      setUnconfiguredVessels(u);
    } catch (err) {
      showToast(apiErr(err), "error");
    } finally {
      setLoading(false);
    }
  }, [showToast]);

  useEffect(() => {
    loadAll();
  }, []); // eslint-disable-line

  // ─── Navigate into a vessel's mapping ───────────────────────────────
  const openVesselMapping = (vessel) => {
    setSelVessel(vessel);
    setActiveSection("vessel-mapping");
  };

  // ─── Equipment CRUD ──────────────────────────────────────────────────
  const saveEquip = async (form) => {
    try {
      if (form._isEdit) {
        await API(`/api/config/equipment/${form.code}`, {
          method: "PUT",
          body: JSON.stringify(form),
        });
        showToast("Equipment updated");
      } else {
        await API("/api/config/equipment", {
          method: "POST",
          body: JSON.stringify(form),
        });
        showToast("Equipment added");
      }
      setEquipModal(null);
      loadAll();
    } catch (err) {
      showToast(apiErr(err), "error");
    }
  };

  const deleteEquip = async (code) => {
    if (
      !window.confirm(`Delete equipment "${code}" and all its vessel configs?`)
    )
      return;
    try {
      await API(`/api/config/equipment/${code}`, { method: "DELETE" });
      showToast("Equipment deleted");
      loadAll();
    } catch (err) {
      showToast(apiErr(err), "error");
    }
  };

  // ─── Save a single vessel-equipment config row ───────────────────────
  // Called ONLY when the user explicitly clicks "Save" in the mapping row.
  // This is the single place that POSTs to /api/config/vessel-configs.
  const saveVesselConfig = async (imo, code, isActive, analystCode) => {
    try {
      await API("/api/config/vessel-configs", {
        method: "POST",
        body: JSON.stringify({
          imo_number: String(imo),
          equipment_code: code,
          is_active: isActive,
          lab_analyst_code: analystCode || null,
        }),
      });
      // Optimistically update local configs state
      setConfigs((prev) => {
        const filtered = prev.filter(
          (c) => !(c.imo_number === String(imo) && c.equipment_code === code),
        );
        return [
          ...filtered,
          {
            imo_number: String(imo),
            equipment_code: code,
            is_active: isActive,
            lab_analyst_code: analystCode || null,
          },
        ];
      });
      showToast("Config saved");
    } catch (err) {
      showToast(apiErr(err), "error");
    }
  };

  // ─── Helpers ─────────────────────────────────────────────────────────
  const configFor = (imo, code) =>
    configs.find(
      (c) => c.imo_number === String(imo) && c.equipment_code === code,
    );

  const activeCount = (imo) =>
    configs.filter((c) => c.imo_number === String(imo) && c.is_active).length;

  // iii: fixed display order for categories
  const CATEGORY_ORDER = [
    "Main Engine",
    "Stern Tube",
    "Aux Engine",
    "Steering Gear",
    "Mooring Equip",
    "Hatch Cover",
    "Deck Crane",
    "Cargo Oil",
    "Provision Crane",
  ];
  const allCats = [...new Set(equipment.map((e) => e.category))].filter(
    Boolean,
  );
  const categories = [
    ...CATEGORY_ORDER.filter((c) => allCats.includes(c)),
    ...allCats.filter((c) => !CATEGORY_ORDER.includes(c)).sort(),
  ];

  const filteredEquipment = equipment.filter(
    (e) =>
      !searchEq ||
      e.code.toLowerCase().includes(searchEq.toLowerCase()) ||
      e.ui_label.toLowerCase().includes(searchEq.toLowerCase()) ||
      (e.category || "").toLowerCase().includes(searchEq.toLowerCase()),
  );

  // ─── Sidebar nav items (Equipment Mapping removed — accessed via vessel click)
  const navItems = [
    {
      key: "configured",
      label: "Configured Vessels",
      icon: <Ship size={16} />,
      count: vessels.length,
      desc: "Vessels with equipment mapped",
    },
    {
      key: "unconfigured",
      label: "Unconfigured Vessels",
      icon: <AlertTriangle size={16} />,
      count: unconfiguredVessels.length,
      desc: "Vessels pending configuration",
      highlight: unconfiguredVessels.length > 0,
    },
    {
      key: "equipment",
      label: "Equipment",
      icon: <Wrench size={16} />,
      count: equipment.length,
      desc: "Master equipment registry",
    },
  ];

  // Active sidebar key — vessel-mapping doesn't live in nav, highlight nothing
  const activeSidebarKey =
    activeSection === "vessel-mapping" ? null : activeSection;

  return (
    <div
      style={{
        minHeight: "100vh",
        background: C.bg,
        fontFamily: "'DM Sans', 'Segoe UI', system-ui, sans-serif",
        display: "flex",
        flexDirection: "column",
      }}
    >
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=DM+Sans:wght@300;400;500;600;700;800&display=swap');
        @keyframes toastIn { from { opacity:0; transform:translateY(10px); } to { opacity:1; transform:translateY(0); } }
        @keyframes fadeIn  { from { opacity:0; transform:translateY(6px); } to { opacity:1; transform:translateY(0); } }
        @keyframes spin    { from { transform:rotate(0deg); } to { transform:rotate(360deg); } }
        * { box-sizing: border-box; }
        input::placeholder { color: #94a3b8; }
        select option { background: white; color: #0f172a; }
        ::-webkit-scrollbar { width: 5px; height: 5px; }
        ::-webkit-scrollbar-track { background: transparent; }
        ::-webkit-scrollbar-thumb { background: #cbd5e1; border-radius: 4px; }
        .nav-item { transition: all 0.15s ease; }
        .nav-item:hover { background: rgba(255,255,255,0.08) !important; }
        .eq-row:hover { background: #f8fafc !important; }
        .vessel-card { transition: box-shadow 0.15s, transform 0.15s; }
        .vessel-card:hover { box-shadow: 0 4px 16px rgba(0,0,0,0.1) !important; transform: translateY(-1px); }
        .toggle-pill {
          width: 44px; height: 24px; border-radius: 12px;
          position: relative; cursor: pointer; border: none;
          transition: background 0.2s; flex-shrink: 0;
        }
        .toggle-pill::after {
          content: ''; position: absolute;
          top: 3px; left: 3px;
          width: 18px; height: 18px;
          border-radius: 50%; background: white;
          transition: left 0.2s;
          box-shadow: 0 1px 3px rgba(0,0,0,0.2);
        }
        .toggle-pill.on  { background: #3b82f6; }
        .toggle-pill.on::after  { left: 23px; }
        .toggle-pill.off { background: #cbd5e1; }
        .action-btn {
          display: inline-flex; align-items: center; gap: 5px;
          padding: 6px 10px; border-radius: 7px;
          font-size: 0.75rem; font-weight: 600;
          cursor: pointer; border: 1.5px solid;
          transition: all 0.15s; font-family: inherit;
        }
        .btn-primary  { background: #3b82f6; color: white; border-color: #3b82f6; }
        .btn-primary:hover { background: #2563eb; border-color: #2563eb; }
        .btn-ghost    { background: transparent; color: #475569; border-color: #e2e8f0; }
        .btn-ghost:hover { background: #f1f5f9; color: #1e293b; }
        .btn-danger   { background: transparent; color: #ef4444; border-color: #fecaca; }
        .btn-danger:hover { background: #fef2f2; }
        .btn-success  { background: #ecfdf5; color: #10b981; border-color: #a7f3d0; }
        .btn-success:hover { background: #d1fae5; }
      `}</style>

      {/* ── Sticky Top bar ── */}
      <div
        style={{
          background: C.white,
          borderBottom: `1px solid ${C.border}`,
          padding: "0 24px",
          height: `${TOPBAR_H}px`,
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          boxShadow: "0 1px 3px rgba(0,0,0,0.06)",
          position: "fixed",
          top: 0,
          left: 0,
          right: 0,
          zIndex: 300,
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: "16px" }}>
          <button
            onClick={() => window.history.back()}
            style={{
              background: "none",
              border: "none",
              color: C.textMid,
              cursor: "pointer",
              display: "flex",
              alignItems: "center",
              gap: "5px",
              fontSize: "0.82rem",
              fontWeight: "500",
              padding: "4px 0",
            }}
          >
            <ChevronLeft size={16} /> Back
          </button>
          <div style={{ width: "1px", height: "20px", background: C.border }} />
          <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
            <div
              style={{
                width: "30px",
                height: "30px",
                borderRadius: "8px",
                background: C.accent,
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
              }}
            >
              <Settings2 size={15} color="white" />
            </div>
            <div>
              <div
                style={{
                  fontSize: "0.9rem",
                  fontWeight: "700",
                  color: C.text,
                  lineHeight: 1,
                }}
              >
                Vessel Configuration
              </div>
              <div
                style={{
                  fontSize: "0.68rem",
                  color: C.textLight,
                  marginTop: "1px",
                }}
              >
                Lube Oil Analysis System
              </div>
            </div>
          </div>
        </div>
        {loading && (
          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: "6px",
              color: C.accentBtn,
              fontSize: "0.78rem",
            }}
          >
            <Loader2
              size={14}
              style={{ animation: "spin 1s linear infinite" }}
            />
            Loading...
          </div>
        )}
      </div>

      {/* ── Body below topbar ── */}
      <div
        style={{
          display: "flex",
          marginTop: `${TOPBAR_H}px`,
          height: `calc(100vh - ${TOPBAR_H}px)`,
          overflow: "hidden",
        }}
      >
        {/* ── Fixed Sidebar ── */}
        <div
          style={{
            width: `${SIDEBAR_W}px`,
            flexShrink: 0,
            background: C.sidebar,
            display: "flex",
            flexDirection: "column",
            padding: "20px 12px",
            gap: "4px",
            position: "fixed",
            top: `${TOPBAR_H}px`,
            left: 0,
            height: `calc(100vh - ${TOPBAR_H}px)`,
            overflowY: "auto",
            zIndex: 200,
          }}
        >
          <div
            style={{
              fontSize: "0.6rem",
              fontWeight: "800",
              color: "#64748b",
              letterSpacing: "1px",
              padding: "0 8px 10px",
              textTransform: "uppercase",
            }}
          >
            Navigation
          </div>

          {navItems.map((item) => {
            const isActive = activeSidebarKey === item.key;
            return (
              <button
                key={item.key}
                className="nav-item"
                onClick={() => setActiveSection(item.key)}
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: "10px",
                  padding: "10px 12px",
                  borderRadius: "9px",
                  border: "none",
                  cursor: "pointer",
                  background: isActive ? "rgba(59,130,246,0.2)" : "transparent",
                  color: isActive ? "#93c5fd" : "#94a3b8",
                  width: "100%",
                  textAlign: "left",
                  position: "relative",
                }}
              >
                <span
                  style={{
                    color: isActive ? "#60a5fa" : "#64748b",
                    flexShrink: 0,
                  }}
                >
                  {item.icon}
                </span>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div
                    style={{
                      fontSize: "0.82rem",
                      fontWeight: isActive ? "700" : "500",
                      color: isActive ? "#e2e8f0" : "#94a3b8",
                      lineHeight: 1,
                    }}
                  >
                    {item.label}
                  </div>
                  <div
                    style={{
                      fontSize: "0.65rem",
                      color: "#475569",
                      marginTop: "2px",
                    }}
                  >
                    {item.desc}
                  </div>
                </div>
                {item.count !== null && (
                  <span
                    style={{
                      fontSize: "0.65rem",
                      fontWeight: "700",
                      background: isActive
                        ? "rgba(59,130,246,0.3)"
                        : "rgba(255,255,255,0.08)",
                      color: isActive ? "#93c5fd" : "#64748b",
                      padding: "2px 7px",
                      borderRadius: "10px",
                      flexShrink: 0,
                    }}
                  >
                    {item.count}
                  </span>
                )}
                {item.highlight && !isActive && (
                  <span
                    style={{
                      width: "7px",
                      height: "7px",
                      borderRadius: "50%",
                      background: C.amber,
                      flexShrink: 0,
                    }}
                  />
                )}
                {isActive && (
                  <div
                    style={{
                      position: "absolute",
                      left: 0,
                      top: "20%",
                      bottom: "20%",
                      width: "3px",
                      borderRadius: "0 3px 3px 0",
                      background: "#3b82f6",
                    }}
                  />
                )}
              </button>
            );
          })}

          {/* Sidebar footer */}
          <div
            style={{
              marginTop: "auto",
              padding: "12px 8px 0",
              borderTop: "1px solid rgba(255,255,255,0.06)",
            }}
          >
            <div
              style={{
                fontSize: "0.65rem",
                color: "#334155",
                lineHeight: "1.5",
              }}
            >
              <div
                style={{
                  fontWeight: "700",
                  color: "#475569",
                  marginBottom: "4px",
                }}
              >
                Summary
              </div>
              <div>{vessels.length} configured vessels</div>
              <div>{equipment.length} equipment types</div>
              {unconfiguredVessels.length > 0 && (
                <div
                  style={{
                    color: C.amber,
                    fontWeight: "600",
                    marginTop: "4px",
                  }}
                >
                  ⚠ {unconfiguredVessels.length} vessel
                  {unconfiguredVessels.length > 1 ? "s" : ""} need setup
                </div>
              )}
            </div>
          </div>
        </div>

        {/* ── Scrollable content panel (offset by sidebar width) ── */}
        <div
          style={{
            marginLeft: `${SIDEBAR_W}px`,
            flex: 1,
            // Disable page scroll ONLY when in mapping view
            overflowY: activeSection === "vessel-mapping" ? "hidden" : "auto",
            display: activeSection === "vessel-mapping" ? "flex" : "block",
            flexDirection: "column",
            paddingLeft: "24px",
            paddingRight: "24px",
            paddingBottom: "24px",
            height: "100%",
          }}
        >
          {/* ════ CONFIGURED VESSELS ════ */}
          {activeSection === "configured" && (
            <div style={{ animation: "fadeIn 0.2s ease" }}>
              <SectionHeader
                title="Configured Vessels"
                subtitle={`${vessels.length} vessel${vessels.length !== 1 ? "s" : ""} with equipment mapped in the lube oil system`}
                icon={<Ship size={18} color={C.accent} />}
                action={
                  <div style={{ position: "relative" }}>
                    <Search
                      size={13}
                      style={{
                        position: "absolute",
                        left: "10px",
                        top: "50%",
                        transform: "translateY(-50%)",
                        color: C.textLight,
                        pointerEvents: "none",
                      }}
                    />
                    <input
                      placeholder="Search vessels..."
                      value={searchVessel}
                      onChange={(e) => setSearchVessel(e.target.value)}
                      style={{
                        paddingLeft: "30px",
                        paddingRight: "12px",
                        paddingTop: "8px",
                        paddingBottom: "8px",
                        border: `1.5px solid ${C.border}`,
                        borderRadius: "8px",
                        background: C.white,
                        fontSize: "0.82rem",
                        color: C.text,
                        outline: "none",
                        fontFamily: "inherit",
                        width: "220px",
                        transition: "border-color 0.15s",
                      }}
                      onFocus={(e) => {
                        e.target.style.borderColor = C.accentBtn;
                      }}
                      onBlur={(e) => {
                        e.target.style.borderColor = C.border;
                      }}
                    />
                  </div>
                }
              />
              {(() => {
                const filtered = vessels.filter(
                  (v) =>
                    !searchVessel ||
                    v.vessel_name
                      .toLowerCase()
                      .includes(searchVessel.toLowerCase()) ||
                    String(v.imo_number).includes(searchVessel),
                );
                return filtered.length === 0 ? (
                  <EmptyState
                    icon={<Ship size={40} />}
                    text={
                      searchVessel
                        ? "No vessels matched your search."
                        : "No configured vessels yet."
                    }
                  />
                ) : (
                  <div style={{ display: "grid", gap: "12px" }}>
                    {filtered.map((v) => (
                      <div
                        key={v.imo_number}
                        className="vessel-card"
                        style={{
                          background: C.white,
                          borderRadius: "12px",
                          border: `1px solid ${C.border}`,
                          padding: "18px 20px",
                          display: "flex",
                          alignItems: "center",
                          justifyContent: "space-between",
                          boxShadow: C.cardShadow,
                        }}
                      >
                        <div
                          style={{
                            display: "flex",
                            alignItems: "center",
                            gap: "14px",
                          }}
                        >
                          <div
                            style={{
                              width: "42px",
                              height: "42px",
                              borderRadius: "10px",
                              background: "#eff6ff",
                              display: "flex",
                              alignItems: "center",
                              justifyContent: "center",
                              border: "1.5px solid #bfdbfe",
                            }}
                          >
                            <Ship size={20} color={C.accentBtn} />
                          </div>
                          <div>
                            <div
                              style={{
                                fontWeight: "700",
                                fontSize: "0.95rem",
                                color: C.text,
                              }}
                            >
                              {v.vessel_name}
                            </div>
                            <div
                              style={{
                                fontSize: "0.75rem",
                                color: C.textLight,
                                marginTop: "3px",
                                display: "flex",
                                alignItems: "center",
                                gap: "8px",
                              }}
                            >
                              <span>
                                IMO:{" "}
                                <span
                                  style={{
                                    color: C.textMid,
                                    fontFamily: "monospace",
                                    fontWeight: "600",
                                  }}
                                >
                                  {v.imo_number}
                                </span>
                              </span>
                              <span style={{ color: C.border }}>·</span>
                              <Badge
                                label={v.is_active ? "Active" : "Inactive"}
                                color={v.is_active ? C.green : C.textLight}
                              />
                              <span style={{ color: C.border }}>·</span>
                              <span
                                style={{
                                  color: C.accentBtn,
                                  fontWeight: "600",
                                }}
                              >
                                {activeCount(v.imo_number)} equipment configured
                              </span>
                            </div>
                          </div>
                        </div>
                        {/* Clicking goes straight to THIS vessel's mapping — no vessel picker */}
                        <button
                          className="action-btn btn-primary"
                          onClick={() => openVesselMapping(v)}
                        >
                          <LayoutGrid size={13} /> Configure Equipment
                        </button>
                      </div>
                    ))}
                  </div>
                );
              })()}
            </div>
          )}
          {activeSection === "unconfigured" && (
            <div style={{ animation: "fadeIn 0.2s ease" }}>
              <SectionHeader
                title="Unconfigured Vessels"
                subtitle="Vessels in the system that have not been configured for lube oil analysis yet"
                icon={<AlertTriangle size={18} color={C.amber} />}
                action={
                  <div style={{ position: "relative" }}>
                    <Search
                      size={13}
                      style={{
                        position: "absolute",
                        left: "10px",
                        top: "50%",
                        transform: "translateY(-50%)",
                        color: C.textLight,
                        pointerEvents: "none",
                      }}
                    />
                    <input
                      placeholder="Search vessels..."
                      value={searchNewVessel}
                      onChange={(e) => setSearchNewVessel(e.target.value)}
                      style={{
                        paddingLeft: "30px",
                        paddingRight: "12px",
                        paddingTop: "8px",
                        paddingBottom: "8px",
                        border: `1.5px solid ${C.border}`,
                        borderRadius: "8px",
                        background: C.white,
                        fontSize: "0.82rem",
                        color: C.text,
                        outline: "none",
                        fontFamily: "inherit",
                        width: "220px",
                        transition: "border-color 0.15s",
                      }}
                      onFocus={(e) => {
                        e.target.style.borderColor = C.accentBtn;
                      }}
                      onBlur={(e) => {
                        e.target.style.borderColor = C.border;
                      }}
                    />
                  </div>
                }
              />
              {unconfiguredVessels.length === 0 ? (
                <div
                  style={{
                    background: C.white,
                    borderRadius: "12px",
                    border: "1.5px solid #bbf7d0",
                    padding: "32px",
                    textAlign: "center",
                    boxShadow: C.cardShadow,
                  }}
                >
                  <CheckCircle2
                    size={36}
                    color={C.green}
                    style={{ marginBottom: "10px" }}
                  />
                  <div
                    style={{
                      fontWeight: "700",
                      color: C.text,
                      fontSize: "0.95rem",
                    }}
                  >
                    All vessels configured!
                  </div>
                  <div
                    style={{
                      color: C.textLight,
                      fontSize: "0.8rem",
                      marginTop: "4px",
                    }}
                  >
                    Every vessel in the system has equipment mapping set up.
                  </div>
                </div>
              ) : (
                (() => {
                  const filtered = unconfiguredVessels.filter(
                    (v) =>
                      !searchNewVessel ||
                      v.vessel_name
                        .toLowerCase()
                        .includes(searchNewVessel.toLowerCase()) ||
                      String(v.imo_number).includes(searchNewVessel),
                  );
                  return filtered.length === 0 ? (
                    <EmptyState
                      icon={<Ship size={40} />}
                      text="No vessels matched your search."
                    />
                  ) : (
                    <div style={{ display: "grid", gap: "12px" }}>
                      {filtered.map((v) => (
                        <div
                          key={v.imo_number}
                          className="vessel-card"
                          style={{
                            background: C.white,
                            borderRadius: "12px",
                            border: "1.5px solid #fde68a",
                            padding: "18px 20px",
                            display: "flex",
                            alignItems: "center",
                            justifyContent: "space-between",
                            boxShadow: C.cardShadow,
                          }}
                        >
                          <div
                            style={{
                              display: "flex",
                              alignItems: "center",
                              gap: "14px",
                            }}
                          >
                            <div
                              style={{
                                width: "42px",
                                height: "42px",
                                borderRadius: "10px",
                                background: "#fffbeb",
                                display: "flex",
                                alignItems: "center",
                                justifyContent: "center",
                                border: "1.5px solid #fde68a",
                              }}
                            >
                              <Ship size={20} color={C.amber} />
                            </div>
                            <div>
                              <div
                                style={{
                                  fontWeight: "700",
                                  fontSize: "0.95rem",
                                  color: C.text,
                                  display: "flex",
                                  alignItems: "center",
                                  gap: "8px",
                                }}
                              >
                                {v.vessel_name}
                                <span
                                  style={{
                                    fontSize: "0.65rem",
                                    fontWeight: "700",
                                    background: "#fef3c7",
                                    color: "#92400e",
                                    border: "1px solid #fde68a",
                                    padding: "2px 7px",
                                    borderRadius: "10px",
                                  }}
                                >
                                  NOT CONFIGURED
                                </span>
                              </div>
                              <div
                                style={{
                                  fontSize: "0.75rem",
                                  color: C.textLight,
                                  marginTop: "3px",
                                }}
                              >
                                IMO:{" "}
                                <span
                                  style={{
                                    color: C.textMid,
                                    fontFamily: "monospace",
                                    fontWeight: "600",
                                  }}
                                >
                                  {v.imo_number}
                                </span>
                              </div>
                            </div>
                          </div>
                          <button
                            className="action-btn btn-primary"
                            onClick={() => openVesselMapping(v)}
                          >
                            <Plus size={13} /> Setup Equipment
                          </button>
                        </div>
                      ))}
                    </div>
                  );
                })()
              )}
            </div>
          )}

          {/* ════ EQUIPMENT ════ */}
          {activeSection === "equipment" && (
            <div style={{ animation: "fadeIn 0.2s ease" }}>
              <SectionHeader
                title="Master Equipment Registry"
                subtitle="Define equipment types, codes, and default sampling intervals"
                icon={<Wrench size={18} color={C.accent} />}
                action={
                  <div
                    style={{
                      display: "flex",
                      alignItems: "center",
                      gap: "10px",
                    }}
                  >
                    {/* Search */}
                    <div style={{ position: "relative" }}>
                      <Search
                        size={14}
                        style={{
                          position: "absolute",
                          left: "10px",
                          top: "50%",
                          transform: "translateY(-50%)",
                          color: C.textLight,
                        }}
                      />
                      <input
                        placeholder="Search..."
                        value={searchEq}
                        onChange={(e) => setSearchEq(e.target.value)}
                        style={{
                          paddingLeft: "32px",
                          paddingRight: "12px",
                          paddingTop: "8px",
                          paddingBottom: "8px",
                          border: `1.5px solid ${C.border}`,
                          borderRadius: "8px",
                          background: C.white,
                          fontSize: "0.82rem",
                          width: "220px",
                          outline: "none",
                          transition: "border-color 0.15s, box-shadow 0.15s",
                        }}
                        onFocus={(e) => {
                          e.target.style.borderColor = C.accentBtn;
                          // e.target.style.boxShadow = "0 0 0 3px rgba(59,130,246,0.1)";
                        }}
                        onBlur={(e) => {
                          e.target.style.borderColor = C.border;
                          e.target.style.boxShadow = "none";
                        }}
                      />
                    </div>

                    {/* Button */}
                    <button
                      className="action-btn btn-primary"
                      style={{ fontSize: "0.82rem", padding: "8px 16px" }}
                      onClick={() =>
                        setEquipModal({
                          code: "",
                          ui_label: "",
                          category: "",
                          default_interval_months: 3,
                          sort_order: 0,
                        })
                      }
                    >
                      <Plus size={14} /> Add Equipment
                    </button>
                  </div>
                }
              />

              {/* Search — sticky below section header */}
              {/* <div style={{
                position: "sticky", top: "71px", zIndex: 90,
                background: "#ffffff",
                padding: "10px 24px",
                marginLeft: "-24px", marginRight: "-24px",
                marginBottom: "16px",
                borderBottom: `1px solid ${C.border}`,
              }}>
                <div style={{ position: "relative", maxWidth: "340px" }}>
                  <Search size={14} style={{
                    position: "absolute", left: "10px", top: "50%",
                    transform: "translateY(-50%)", color: C.textLight,
                  }} />
                  <input
                    placeholder="Search by code, label or category..."
                    value={searchEq}
                    onChange={e => setSearchEq(e.target.value)}
                    style={{
                      width: "100%", paddingLeft: "32px", paddingRight: "12px",
                      paddingTop: "8px", paddingBottom: "8px",
                      border: `1.5px solid ${C.border}`, borderRadius: "8px",
                      background: C.white, fontSize: "0.82rem",
                      color: C.text, outline: "none", fontFamily: "inherit",
                    }}
                  />
                </div>
              </div> */}

              {categories.map((cat) => {
                const items = filteredEquipment.filter(
                  (e) => e.category === cat,
                );
                if (!items.length) return null;
                return (
                  <EquipmentCategory
                    key={cat}
                    category={cat}
                    items={items}
                    onEdit={(eq) => setEquipModal({ ...eq, _isEdit: true })}
                    onDelete={deleteEquip}
                  />
                );
              })}

              {filteredEquipment.filter((e) => !e.category).length > 0 && (
                <EquipmentCategory
                  category="Uncategorised"
                  items={filteredEquipment.filter((e) => !e.category)}
                  onEdit={(eq) => setEquipModal({ ...eq, _isEdit: true })}
                  onDelete={deleteEquip}
                />
              )}

              {filteredEquipment.length === 0 && (
                <EmptyState
                  icon={<Wrench size={36} />}
                  text={
                    searchEq
                      ? "No equipment matched your search."
                      : "No equipment registered yet."
                  }
                />
              )}
            </div>
          )}

          {/* ════ VESSEL MAPPING (direct vessel view — no vessel picker) ════ */}
          {activeSection === "vessel-mapping" && selVessel && (
            <div
              style={{
                animation: "fadeIn 0.2s ease",
                display: "flex",
                flexDirection: "column",
                height: "100%",
                paddingTop: "24px",
              }}
            >
              {/* Back + vessel title row */}
              <div
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: "12px",
                  marginBottom: "20px",
                  flexShrink: 0, // Keeps this header fixed at the top
                }}
              >
                <button
                  className="action-btn btn-ghost"
                  onClick={() => setActiveSection("configured")}
                  style={{ padding: "7px 12px", fontSize: "0.8rem" }}
                >
                  <ChevronLeft size={13} /> Back to Vessels
                </button>
                <div
                  style={{ display: "flex", alignItems: "center", gap: "8px" }}
                >
                  <Ship size={15} color={C.accentBtn} />
                  <span
                    style={{
                      fontWeight: "700",
                      fontSize: "0.95rem",
                      color: C.text,
                    }}
                  >
                    {selVessel.vessel_name}
                  </span>
                  <span
                    style={{
                      fontSize: "0.72rem",
                      color: C.textLight,
                      fontFamily: "monospace",
                    }}
                  >
                    IMO {selVessel.imo_number}
                  </span>
                  <Badge
                    label={`${activeCount(selVessel.imo_number)} active`}
                    color={C.green}
                  />
                </div>
              </div>

              <MappingGrid
                vessel={selVessel}
                equipment={equipment}
                configs={configs}
                configFor={configFor}
                onSave={saveVesselConfig}
              />
            </div>
          )}
        </div>
      </div>

      {/* ── Equipment Modal ── */}
      {equipModal && (
        <EquipModal
          initial={equipModal}
          categories={categories}
          onSave={saveEquip}
          onClose={() => setEquipModal(null)}
        />
      )}

      {toast && <Toast {...toast} onDone={() => setToast(null)} />}
    </div>
  );
};

// ══════════════════════════════════════════════════════════════════════════
// Equipment Category accordion
// Fixed-width columns. Sort column removed. Interval + Actions centred.
// ══════════════════════════════════════════════════════════════════════════
const COL = {
  code: "150px",
  label: "auto",
  interval: "100px",
  actions: "150px",
};

const EquipmentCategory = ({ category, items, onEdit, onDelete }) => {
  const [open, setOpen] = useState(true);
  return (
    <div
      style={{
        marginBottom: "12px",
        borderRadius: "12px",
        overflow: "hidden",
        border: `1px solid ${C.border}`,
        background: C.white,
        boxShadow: C.cardShadow,
      }}
    >
      <button
        onClick={() => setOpen(!open)}
        style={{
          width: "100%",
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          padding: "12px 18px",
          background: "#f8fafc",
          border: "none",
          cursor: "pointer",
          borderBottom: open ? `1px solid ${C.border}` : "none",
        }}
      >
        <span
          style={{
            display: "flex",
            alignItems: "center",
            gap: "8px",
            fontSize: "0.84rem",
            fontWeight: "700",
            color: C.text,
          }}
        >
          <Wrench size={13} color={C.accentBtn} />
          {category}
          <span
            style={{
              fontSize: "0.68rem",
              color: C.textLight,
              fontWeight: "500",
              background: "#e2e8f0",
              padding: "1px 7px",
              borderRadius: "10px",
            }}
          >
            {items.length}
          </span>
        </span>
        {open ? (
          <ChevronUp size={14} color={C.textLight} />
        ) : (
          <ChevronDown size={14} color={C.textLight} />
        )}
      </button>

      {open && (
        <table
          style={{
            width: "100%",
            borderCollapse: "collapse",
            tableLayout: "fixed",
          }}
        >
          <colgroup>
            <col style={{ width: COL.code }} />
            <col style={{ width: COL.label }} />
            <col style={{ width: COL.interval }} />
            <col style={{ width: COL.actions }} />
          </colgroup>
          <thead>
            <tr style={{ background: "#fafafa" }}>
              {[
                { label: "Code", align: "left" },
                { label: "Label", align: "left" },
                { label: "Interval", align: "center" },
                { label: "Actions", align: "center" },
              ].map((h) => (
                <th
                  key={h.label}
                  style={{
                    padding: "8px 16px",
                    textAlign: h.align,
                    fontSize: "0.68rem",
                    fontWeight: "700",
                    color: C.textLight,
                    letterSpacing: "0.5px",
                    textTransform: "uppercase",
                    borderBottom: `1px solid ${C.border}`,
                    overflow: "hidden",
                    textOverflow: "ellipsis",
                    whiteSpace: "nowrap",
                  }}
                >
                  {h.label}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {items.map((eq, i) => (
              <tr
                key={eq.code}
                className="eq-row"
                style={{
                  borderBottom:
                    i < items.length - 1 ? "1px solid #f1f5f9" : "none",
                }}
              >
                <td
                  style={{
                    padding: "10px 16px",
                    fontFamily: "monospace",
                    fontSize: "0.8rem",
                    color: C.accentBtn,
                    fontWeight: "700",
                    overflow: "hidden",
                    textOverflow: "ellipsis",
                    whiteSpace: "nowrap",
                  }}
                >
                  {eq.code}
                </td>
                <td
                  style={{
                    padding: "10px 16px",
                    fontSize: "0.83rem",
                    color: C.text,
                    overflow: "hidden",
                    textOverflow: "ellipsis",
                    whiteSpace: "nowrap",
                  }}
                >
                  {eq.ui_label}
                </td>
                <td style={{ padding: "10px 16px", textAlign: "center" }}>
                  <span
                    style={{
                      background: "#eff6ff",
                      color: C.accentBtn,
                      padding: "2px 8px",
                      borderRadius: "6px",
                      fontSize: "0.72rem",
                      fontWeight: "700",
                    }}
                  >
                    {eq.default_interval_months}m
                  </span>
                </td>
                <td style={{ padding: "10px 16px", textAlign: "center" }}>
                  <div style={{ display: "inline-flex", gap: "6px" }}>
                    <button
                      className="action-btn btn-ghost"
                      onClick={() => onEdit(eq)}
                      style={{ padding: "5px 9px" }}
                    >
                      <Pencil size={12} />
                    </button>
                    <button
                      className="action-btn btn-danger"
                      onClick={() => onDelete(eq.code)}
                      style={{ padding: "5px 9px" }}
                    >
                      <Trash2 size={12} />
                    </button>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
};

// ══════════════════════════════════════════════════════════════════════════
// Mapping Grid
// i.  Active / Inactive split is driven by SAVED configs (configFor) so
//     rows only move sections after the user clicks Save — not on toggle.
// ══════════════════════════════════════════════════════════════════════════
const MappingGrid = ({ vessel, equipment, configs, configFor, onSave }) => {
  // localState: { [eq.code]: { isActive: bool, analystCode: string, dirty: bool } }
  const [localState, setLocalState] = useState({});
  const [search, setSearch] = useState("");

  // Initialise / re-initialise when vessel or saved configs change
  useEffect(() => {
    const init = {};
    equipment.forEach((eq) => {
      const cfg = configFor(vessel.imo_number, eq.code);
      init[eq.code] = {
        isActive: cfg?.is_active ?? false,
        analystCode: cfg?.lab_analyst_code ?? "",
        dirty: false,
      };
    });
    setLocalState(init);
  }, [vessel.imo_number, equipment, configs]); // eslint-disable-line

  const getRow = (code) =>
    localState[code] ?? { isActive: false, analystCode: "", dirty: false };

  const setField = (code, key, value) =>
    setLocalState((prev) => ({
      ...prev,
      [code]: { ...getRow(code), [key]: value, dirty: true },
    }));

  const handleSave = async (eq) => {
    const row = getRow(eq.code);
    await onSave(vessel.imo_number, eq.code, row.isActive, row.analystCode);
    // dirty cleared; the parent's configs update will re-init this row
    setLocalState((prev) => ({
      ...prev,
      [eq.code]: { ...prev[eq.code], dirty: false },
    }));
  };

  const filtered = equipment.filter(
    (eq) =>
      !search ||
      eq.code.toLowerCase().includes(search.toLowerCase()) ||
      eq.ui_label.toLowerCase().includes(search.toLowerCase()),
  );

  // i: split is based on SAVED state (configFor), not local toggle state
  const activeEquip = filtered.filter(
    (eq) => configFor(vessel.imo_number, eq.code)?.is_active === true,
  );
  const inactiveEquip = filtered.filter(
    (eq) => configFor(vessel.imo_number, eq.code)?.is_active !== true,
  );

  // Fixed column widths for mapping table
  const MC = {
    code: "120px",
    label: "auto",
    cat: "130px",
    interval: "80px",
    toggle: "70px",
    analyst: "180px",
    save: "90px",
  };

  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        flex: 1,
        minHeight: 0,
      }}
    >
      {/* Table header bar */}
      <div
        style={{
          background: C.white,
          borderRadius: "12px 12px 0 0",
          border: `1px solid ${C.border}`,
          borderBottom: "none",
          padding: "14px 20px",
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          boxShadow: C.cardShadow,
          flexShrink: 0, // Keeps the equipment count & search bar fixed
          zIndex: 10,
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: "10px" }}>
          <span
            style={{ fontSize: "0.8rem", fontWeight: "600", color: C.textMid }}
          >
            {filtered.length} equipment types
          </span>
        </div>
        <div style={{ position: "relative" }}>
          <Search
            size={13}
            style={{
              position: "absolute",
              left: "9px",
              top: "50%",
              transform: "translateY(-50%)",
              color: C.textLight,
            }}
          />
          <input
            placeholder="Filter equipment..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            style={{
              paddingLeft: "28px",
              paddingRight: "10px",
              paddingTop: "6px",
              paddingBottom: "6px",
              border: `1.5px solid ${C.border}`,
              borderRadius: "7px",
              background: "#f8fafc",
              fontSize: "0.78rem",
              color: C.text,
              outline: "none",
              fontFamily: "inherit",
              width: "200px",
              transition: "border-color 0.15s, box-shadow 0.15s",
            }}
            onFocus={(e) => {
              e.target.style.borderColor = C.accentBtn;
              // e.target.style.boxShadow = "0 0 0 3px rgba(59,130,246,0.1)";
            }}
            onBlur={(e) => {
              e.target.style.borderColor = C.border;
              e.target.style.boxShadow = "none";
            }}
          />
        </div>
      </div>

      <div
        style={{
          border: `1px solid ${C.border}`,
          borderRadius: "0 0 12px 12px",
          overflowY: "auto", // Makes the card scrollable
          flex: 1, // Makes it take up remaining screen height
          background: C.white,
          boxShadow: C.cardShadow,
        }}
      >
        <table
          style={{
            width: "100%",
            borderCollapse: "collapse",
            tableLayout: "fixed",
          }}
        >
          <colgroup>
            {/* Keep your existing colgroup here */}
            <col style={{ width: MC.code }} />
            <col style={{ width: MC.label }} />
            <col style={{ width: MC.cat }} />
            <col style={{ width: MC.interval }} />
            <col style={{ width: MC.toggle }} />
            <col style={{ width: MC.analyst }} />
            <col style={{ width: MC.save }} />
          </colgroup>
          {/* Make table column names sticky */}
          <thead
            style={{
              position: "sticky",
              top: 0,
              zIndex: 10,
              background: "#f8fafc",
            }}
          >
            <tr style={{ boxShadow: `inset 0 -1px 0 ${C.border}` }}>
              {[
                "Code",
                "Label",
                "Category",
                "Interval",
                "Active",
                "Lab Analyst Code",
                "",
              ].map((h) => (
                <th
                  key={h}
                  style={{
                    padding: "9px 14px",
                    textAlign: "left",
                    fontSize: "0.67rem",
                    fontWeight: "700",
                    color: C.textLight,
                    letterSpacing: "0.5px",
                    textTransform: "uppercase",
                    overflow: "hidden",
                    textOverflow: "ellipsis",
                    whiteSpace: "nowrap",
                  }}
                >
                  {h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {activeEquip.length > 0 && (
              <tr>
                <td
                  colSpan={7}
                  style={{
                    padding: "6px 14px 2px",
                    fontSize: "0.65rem",
                    fontWeight: "800",
                    color: C.green,
                    letterSpacing: "0.5px",
                    textTransform: "uppercase",
                    background: "#f0fdf4",
                  }}
                >
                  ● Active Equipment
                </td>
              </tr>
            )}
            {activeEquip.map((eq, i) => (
              <MappingRow
                key={eq.code}
                eq={eq}
                row={getRow(eq.code)}
                onToggle={() =>
                  setField(eq.code, "isActive", !getRow(eq.code).isActive)
                }
                onChangeCode={(val) => setField(eq.code, "analystCode", val)}
                onSave={() => handleSave(eq)}
                isLast={
                  i === activeEquip.length - 1 && inactiveEquip.length === 0
                }
              />
            ))}

            {inactiveEquip.length > 0 && (
              <tr>
                <td
                  colSpan={7}
                  style={{
                    padding: "6px 14px 2px",
                    fontSize: "0.65rem",
                    fontWeight: "800",
                    color: C.textLight,
                    letterSpacing: "0.5px",
                    textTransform: "uppercase",
                    background: "#fafafa",
                  }}
                >
                  ○ Inactive Equipment
                </td>
              </tr>
            )}
            {inactiveEquip.map((eq, i) => (
              <MappingRow
                key={eq.code}
                eq={eq}
                row={getRow(eq.code)}
                onToggle={() =>
                  setField(eq.code, "isActive", !getRow(eq.code).isActive)
                }
                onChangeCode={(val) => setField(eq.code, "analystCode", val)}
                onSave={() => handleSave(eq)}
                isLast={i === inactiveEquip.length - 1}
              />
            ))}

            {filtered.length === 0 && (
              <tr>
                <td
                  colSpan={7}
                  style={{
                    padding: "24px",
                    textAlign: "center",
                    color: C.textLight,
                    fontSize: "0.82rem",
                  }}
                >
                  No equipment matched your filter.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      <p
        style={{
          fontSize: "0.72rem",
          color: C.textLight,
          marginTop: "10px",
          fontStyle: "italic",
          flexShrink: 0, // Keeps the text visible at the bottom
        }}
      >
        Enter a lab analyst code and click <strong>Save</strong> to activate
        equipment for this vessel.
      </p>
    </div>
  );
};

// ─── Single mapping row ────────────────────────────────────────────────────
const MappingRow = ({ eq, row, onToggle, onChangeCode, onSave, isLast }) => (
  <tr
    className="eq-row"
    style={{
      borderBottom: isLast ? "none" : "1px solid #f1f5f9",
      opacity: row.isActive ? 1 : 0.65,
      transition: "opacity 0.15s",
    }}
  >
    <td
      style={{
        padding: "9px 14px",
        fontFamily: "monospace",
        fontSize: "0.78rem",
        color: C.accentBtn,
        fontWeight: "700",
        overflow: "hidden",
        textOverflow: "ellipsis",
        whiteSpace: "nowrap",
      }}
    >
      {eq.code}
    </td>
    <td
      style={{
        padding: "9px 14px",
        fontSize: "0.82rem",
        color: C.text,
        overflow: "hidden",
        textOverflow: "ellipsis",
        whiteSpace: "nowrap",
      }}
    >
      {eq.ui_label}
    </td>
    <td
      style={{
        padding: "9px 14px",
        fontSize: "0.74rem",
        color: C.textLight,
        overflow: "hidden",
        textOverflow: "ellipsis",
        whiteSpace: "nowrap",
      }}
    >
      {eq.category}
    </td>
    <td style={{ padding: "9px 14px", textAlign: "center" }}>
      <span
        style={{
          background: "#f1f5f9",
          padding: "2px 7px",
          borderRadius: "5px",
          fontSize: "0.7rem",
          fontWeight: "600",
        }}
      >
        {eq.default_interval_months}m
      </span>
    </td>
    <td style={{ padding: "9px 14px" }}>
      <button
        className={`toggle-pill ${row.isActive ? "on" : "off"}`}
        onClick={onToggle}
      />
    </td>
    <td style={{ padding: "9px 14px" }}>
      <input
        value={row.analystCode}
        placeholder="e.g. 880017P01"
        onChange={(e) => onChangeCode(e.target.value)}
        style={{
          width: "100%",
          padding: "5px 9px",
          fontSize: "0.78rem",
          border: `1.5px solid ${row.dirty ? C.accentBtn : C.border}`,
          borderRadius: "6px",
          background: "#f8fafc",
          color: C.text,
          outline: "none",
          fontFamily: "monospace",
          transition: "border-color 0.15s",
        }}
        onFocus={(e) => {
          e.target.style.borderColor = C.accentBtn;
        }}
        onBlur={(e) => {
          e.target.style.borderColor = row.dirty ? C.accentBtn : C.border;
        }}
      />
    </td>
    <td style={{ padding: "9px 14px" }}>
      {row.dirty && (
        <button className="action-btn btn-success" onClick={onSave}>
          <Save size={11} /> Save
        </button>
      )}
    </td>
  </tr>
);

// ══════════════════════════════════════════════════════════════════════════
// Equipment Modal
// ══════════════════════════════════════════════════════════════════════════
const EquipModal = ({ initial, categories, onSave, onClose }) => {
  const [form, setForm] = useState(
    initial || {
      code: "",
      ui_label: "",
      category: "",
      default_interval_months: 3,
      sort_order: 0,
    },
  );
  const [newCat, setNewCat] = useState("");
  const [showNewCat, setShowNewCat] = useState(false);
  const set = (k, v) => setForm((p) => ({ ...p, [k]: v }));
  const isEdit = !!initial?._isEdit;

  return (
    <div
      style={{
        position: "fixed",
        inset: 0,
        zIndex: 50000,
        background: "rgba(15,23,42,0.5)",
        backdropFilter: "blur(4px)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        padding: "20px",
      }}
      onClick={(e) => e.target === e.currentTarget && onClose()}
    >
      <div
        style={{
          background: C.white,
          borderRadius: "16px",
          padding: "28px",
          width: "480px",
          maxWidth: "95vw",
          boxShadow: "0 25px 60px rgba(0,0,0,0.15)",
          animation: "fadeIn 0.2s ease",
        }}
      >
        <div
          style={{
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
            marginBottom: "24px",
          }}
        >
          <div>
            <div style={{ fontSize: "1rem", fontWeight: "800", color: C.text }}>
              {isEdit ? "Edit Equipment" : "Add Equipment"}
            </div>
            <div
              style={{
                fontSize: "0.74rem",
                color: C.textLight,
                marginTop: "2px",
              }}
            >
              {isEdit
                ? "Update equipment details"
                : "Register a new equipment type"}
            </div>
          </div>
          <button
            onClick={onClose}
            style={{
              background: "none",
              border: "none",
              color: C.textLight,
              cursor: "pointer",
              padding: "4px",
            }}
          >
            <X size={18} />
          </button>
        </div>

        <div style={{ display: "grid", gap: "16px" }}>
          <Field label="Equipment Code" required>
            <LightInput
              placeholder="e.g. ME.SYS"
              value={form.code}
              onChange={(e) => set("code", e.target.value.toUpperCase())}
              disabled={isEdit}
              style={isEdit ? { background: "#f1f5f9", color: C.textMid } : {}}
            />
          </Field>

          <Field label="Display Label" required>
            <LightInput
              placeholder="e.g. Main Engine - System"
              value={form.ui_label}
              onChange={(e) => set("ui_label", e.target.value)}
            />
          </Field>

          <Field label="Category">
            <LightSelect
              value={showNewCat ? "__new" : form.category}
              onChange={(e) => {
                if (e.target.value === "__new") {
                  setShowNewCat(true);
                  set("category", "");
                } else {
                  setShowNewCat(false);
                  set("category", e.target.value);
                }
              }}
            >
              <option value="">— Select category —</option>
              {categories.map((c) => (
                <option key={c} value={c}>
                  {c}
                </option>
              ))}
              <option value="__new">+ New category…</option>
            </LightSelect>
            {showNewCat && (
              <LightInput
                style={{ marginTop: "6px" }}
                placeholder="Type new category name"
                value={newCat}
                onChange={(e) => {
                  setNewCat(e.target.value);
                  set("category", e.target.value);
                }}
                autoFocus
              />
            )}
          </Field>

          <div
            style={{ display: "grid", gridTemplateColumns: "1fr", gap: "14px" }}
          >
            <Field label="Interval (months)">
              <LightInput
                type="number"
                min="1"
                max="24"
                value={form.default_interval_months}
                onChange={(e) =>
                  set("default_interval_months", Number(e.target.value))
                }
              />
            </Field>
          </div>
        </div>

        <div
          style={{
            display: "flex",
            justifyContent: "flex-end",
            gap: "10px",
            marginTop: "24px",
            paddingTop: "16px",
            borderTop: `1px solid ${C.border}`,
          }}
        >
          <button
            onClick={onClose}
            className="action-btn btn-ghost"
            style={{ padding: "9px 18px", fontSize: "0.84rem" }}
          >
            Cancel
          </button>
          <button
            onClick={() => {
              if (!form.code || !form.ui_label)
                return alert("Fill required fields");
              onSave(form);
            }}
            className="action-btn btn-primary"
            style={{ padding: "9px 18px", fontSize: "0.84rem" }}
          >
            <Save size={13} /> {isEdit ? "Update Equipment" : "Add Equipment"}
          </button>
        </div>
      </div>
    </div>
  );
};

export default VesselConfigPage;

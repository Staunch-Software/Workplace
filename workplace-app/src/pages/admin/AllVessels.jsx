import React, { useState, useEffect, useRef } from "react";
import { Search, Pencil, Ban, X, FileText, Trello, Ship, Droplet, Zap, Trash2 } from "lucide-react";
import { getVessels, updateVessel, updateVesselModuleStatus, deleteVessel } from "./lib/adminApi";

const SearchIcon = () => <Search size={16} />;
const EditIcon = () => <Pencil size={16} />;
const BanIcon = () => <Ban size={16} />;
const XIcon = () => <X size={20} />;

const MODULE_META = [
  { key: "drs", label: "DRS", icon: <FileText size={14} />, color: "#3b82f6" },
  { key: "jira", label: "SmartPAL JIRA", icon: <Trello size={14} />, color: "#f97316" },
  { key: "voyage", label: "Voyage Performance", icon: <Ship size={14} />, color: "#8b5cf6" },
  { key: "lubeoil", label: "Lubeoil Analysis", icon: <Droplet size={14} />, color: "#06b6d4" },
  { key: "engine_performance", label: "Engine Performance", icon: <Zap size={14} />, color: "#22c55e" },
];
function getRoleStyle(role) {
    const r = role?.toUpperCase();
    if (r === "ADMIN") return { bg: "rgba(139, 92, 246, 0.06)", border: "#8b5cf6", badge: "#8b5cf6" };
    if (r === "SHORE") return { bg: "rgba(59, 130, 246, 0.05)", border: "#3b82f6", badge: "#3b82f6" };
    return { bg: "rgba(249, 115, 22, 0.05)", border: "#f97316", badge: "#f97316" };
  }
function AssignedUsersPopover({ users, isOpen, onClose, triggerRef }) {
  const popoverRef = useRef(null);
  const [position, setPosition] = useState({ top: 0, left: 0 });

  useEffect(() => {
    if (isOpen && triggerRef?.current) {
      setTimeout(() => {
        if (popoverRef?.current) {
          const triggerRect = triggerRef.current.getBoundingClientRect();
          const popoverRect = popoverRef.current.getBoundingClientRect();

          // Position to the left of the trigger with extra gap for the arrow
          let left = triggerRect.left - popoverRect.width - 16;
          // If popover goes off the left edge, flip to the right
          if (left < 8) {
            left = triggerRect.right + 16;
          }

          // Vertically center the popover relative to the trigger
          let top = triggerRect.top + triggerRect.height / 2 - popoverRect.height / 2;
          top = Math.max(8, Math.min(top, window.innerHeight - popoverRect.height - 8));

          setPosition({ top, left });
        }
      }, 0);
    }
  }, [isOpen, triggerRef]);

  useEffect(() => {
    const handleScroll = () => {
      if (isOpen) {
        onClose();
      }
    };

    if (isOpen) {
      window.addEventListener("scroll", handleScroll);
      return () => window.removeEventListener("scroll", handleScroll);
    }
  }, [isOpen, onClose]);

  useEffect(() => {
    const handleClickOutside = (e) => {
      if (popoverRef.current && !popoverRef.current.contains(e.target) &&
        triggerRef?.current && !triggerRef.current.contains(e.target)) {
        onClose();
      }
    };

    if (isOpen) {
      document.addEventListener("mousedown", handleClickOutside);
      return () => document.removeEventListener("mousedown", handleClickOutside);
    }
  }, [isOpen, onClose, triggerRef]);

  if (!isOpen || users.length === 0) return null;

  // Calculate where the trigger center is relative to the popover top
  // so the arrow always points directly at the clicked count badge
  const triggerCenterY = triggerRef?.current
    ? triggerRef.current.getBoundingClientRect().top +
    triggerRef.current.getBoundingClientRect().height / 2
    : 0;

  const arrowTop = Math.max(16, Math.min(
    triggerCenterY - position.top,
    // clamp so arrow never goes below the popover bottom edge
    (popoverRef.current?.offsetHeight ?? 200) - 16
  ));
  
  return (
    <div
      ref={popoverRef}
      style={{
        position: "fixed",
        top: `${position.top}px`,
        left: `${position.left}px`,
        zIndex: 1000,
        background: "var(--ap-bg)",
        border: "1px solid var(--ap-border)",
        borderRadius: "8px",
        boxShadow: "0 4px 12px rgba(0, 0, 0, 0.15)",
        minWidth: "280px",
        maxWidth: "400px",
      }}
      className="ap-popover"
    >
      {/* Arrow border layer — top is dynamic, always points at the trigger */}
      <div
        style={{
          position: "absolute",
          right: "-8px",
          top: `${arrowTop}px`,
          transform: "translateY(-50%)",
          width: 0,
          height: 0,
          borderTop: "8px solid transparent",
          borderBottom: "8px solid transparent",
          borderLeft: "8px solid var(--ap-border)",
        }}
      />
      {/* Arrow fill layer */}
      <div
        style={{
          position: "absolute",
          right: "-6px",
          top: `${arrowTop}px`,
          transform: "translateY(-50%)",
          width: 0,
          height: 0,
          borderTop: "7px solid transparent",
          borderBottom: "7px solid transparent",
          borderLeft: "7px solid var(--ap-bg)",
        }}
      />

      <div style={{ padding: "12px 16px" }}>
        <p style={{ fontSize: "0.875rem", fontWeight: 600, marginBottom: 12, color: "var(--ap-text)" }}>
          Assigned Users ({users.length})
        </p>
        <div
          style={{
            display: "flex",
            flexDirection: "column",
            gap: 8,
            maxHeight: "400px",
            overflowY: "auto",
            paddingRight: "4px",
          }}
        >
          {users.map(user => {
            const { bg, border, badge } = getRoleStyle(user.role);
            const roleDisplay = user.role ? user.role.toUpperCase() : "UNKNOWN";

            return (
              <div
                key={user.id}
                style={{
                  padding: "10px 12px",
                  borderRadius: 6,
                  background: bg,
                  borderLeft: `3px solid ${border}`,
                  flexShrink: 0,
                }}
              >
                <div
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: 6,
                    fontSize: "0.875rem",
                    fontWeight: 500,
                    color: "var(--ap-text)",
                  }}
                >
                  {user.full_name}
                  <span
                    style={{
                      fontSize: "0.65rem",
                      padding: "2px 6px",
                      borderRadius: 3,
                      background: badge,
                      color: "white",
                    }}
                  >
                    {roleDisplay}
                  </span>
                </div>
                <div style={{ fontSize: "0.75rem", color: "var(--ap-text-muted)", marginTop: 4 }}>
                  {user.email}
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

function EditVesselSlideOver({ vessel, onClose, onSave }) {
  const [data, setData] = useState({
    name: vessel.name,
    vessel_type: vessel.vessel_type || "OIL_TANKER",
    vessel_email: vessel.vessel_email || "",
    is_active: vessel.is_active,
  });
  const [moduleStatus, setModuleStatus] = useState(vessel.module_status || {});
  const [saving, setSaving] = useState(false);

  const toggleModule = (key) =>
    setModuleStatus(prev => ({ ...prev, [key]: !prev[key] }));

  const handleSave = async () => {
    setSaving(true);
    try {
      await updateVessel(vessel.imo, data);
await updateVesselModuleStatus(vessel.imo, moduleStatus);
      await onSave();
      onClose();
    } catch (err) {
      alert(err.response?.data?.detail || "Save failed");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="ap-slideover-backdrop">
      <div className="ap-slideover-overlay" onClick={onClose} />
      <div className="ap-slideover-panel">
        <div className="ap-slideover-header">
          <span className="ap-slideover-title">Edit Vessel</span>
          <button className="ap-icon-btn" onClick={onClose}><XIcon /></button>
        </div>
        <div className="ap-slideover-body">
          <div className="ap-form-group" style={{ marginBottom: 16 }}>
            <label className="ap-label">Vessel Name</label>
            <input className="ap-input" value={data.name} onChange={e => setData({ ...data, name: e.target.value })} />
          </div>
          <div className="ap-form-group" style={{ marginBottom: 16 }}>
            <label className="ap-label">IMO Number</label>
            <input className="ap-input" value={vessel.imo} disabled style={{ opacity: 0.6 }} />
          </div>
          <div className="ap-form-group" style={{ marginBottom: 16 }}>
            <label className="ap-label">Vessel Type</label>
            <select className="ap-select" style={{ width: "100%" }} value={data.vessel_type}
              onChange={e => setData({ ...data, vessel_type: e.target.value })}>
              <option value="OIL_TANKER">Oil Tanker</option>
              <option value="BULK_CARRIER">Bulk Carrier</option>
              <option value="CONTAINER">Container</option>
              <option value="CHEMICAL_TANKER">Chemical Tanker</option>
              <option value="GAS_CARRIER">Gas Carrier</option>
              <option value="OTHER">Other</option>
            </select>
          </div>
          <div className="ap-form-group" style={{ marginBottom: 16 }}>
            <label className="ap-label">Vessel Email</label>
            <input className="ap-input" type="email" value={data.vessel_email}
              onChange={e => setData({ ...data, vessel_email: e.target.value })} />
          </div>
          <div className="ap-form-group" style={{ marginBottom: 16 }}>
            <label className="ap-label">Status</label>
            <div style={{ display: "flex", alignItems: "center", gap: 12, height: 42 }}>
              <button type="button" className={"ap-toggle " + (data.is_active ? "on" : "off")}
                onClick={() => setData({ ...data, is_active: !data.is_active })}>
                <span className="ap-toggle-knob" />
              </button>
              <span style={{ fontSize: "0.875rem" }}>{data.is_active ? "Active" : "Inactive"}</span>
            </div>
          </div>

          {/* ── Module Installation Status ── */}
          <div className="ap-form-group" style={{ marginBottom: 16 }}>
            <label className="ap-label" style={{ marginBottom: 10, display: "block" }}>
              Installed Modules
            </label>
            <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
              {MODULE_META.map(mod => {
                const isInstalled = !!moduleStatus[mod.key];
                return (
                  <div
                    key={mod.key}
                    style={{
                      display: "flex", alignItems: "center", justifyContent: "space-between",
                      padding: "10px 14px", borderRadius: 10,
                      border: `1px solid ${isInstalled ? `${mod.color}40` : "var(--gray-200)"}`,
                      background: isInstalled ? `${mod.color}08` : "var(--white)",
                      transition: "all 0.15s",
                    }}
                  >
                    <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                      <div style={{
                        width: 30, height: 30, borderRadius: 8, flexShrink: 0,
                        background: isInstalled ? `${mod.color}18` : "var(--gray-100)",
                        display: "flex", alignItems: "center", justifyContent: "center",
                        color: isInstalled ? mod.color : "var(--gray-400)",
                      }}>
                        {mod.icon}
                      </div>
                      <div>
                        <div style={{ fontSize: "0.85rem", fontWeight: 600, color: isInstalled ? "var(--gray-900)" : "var(--gray-400)" }}>
                          {mod.label}
                        </div>
                        <div style={{ fontSize: "0.7rem", marginTop: 1, color: isInstalled ? mod.color : "var(--gray-400)", fontWeight: 500 }}>
                          {isInstalled ? "● Installed" : "○ Not installed"}
                        </div>
                      </div>
                    </div>
                    <button
                      type="button"
                      className={"ap-toggle " + (isInstalled ? "on" : "off")}
                      onClick={() => toggleModule(mod.key)}
                    >
                      <span className="ap-toggle-knob" />
                    </button>
                  </div>
                );
              })}
            </div>
          </div>

        </div>
        <div className="ap-slideover-footer">
          <button className="ap-btn ap-btn-secondary" onClick={onClose}>Cancel</button>
          <button className="ap-btn ap-btn-primary" onClick={handleSave} disabled={saving}>
            {saving ? "Saving..." : "Save Changes"}
          </button>
        </div>
      </div>
    </div>
  );
}

function UserCountCell({ assignedUsers }) {
  const [showPopover, setShowPopover] = useState(false);
  const triggerRef = useRef(null);

  return (
    <>
      <div
        ref={triggerRef}
        className="ap-vessel-count"
        onClick={() => setShowPopover(!showPopover)}
        style={{ cursor: "pointer" }}
        title={assignedUsers.length > 0 ? "Click to see details" : "No users assigned"}
      >
        {assignedUsers.length}
      </div>
      <AssignedUsersPopover
        users={assignedUsers}
        isOpen={showPopover}
        onClose={() => setShowPopover(false)}
        triggerRef={triggerRef}
      />
    </>
  );
}

export default function AllVessels() {
  const [vessels, setVessels] = useState([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState("ALL");
  const [editingVessel, setEditingVessel] = useState(null);

  const fetchVessels = async () => {
    try {
      const res = await getVessels();
      setVessels(res.data);
    } catch (err) {
      console.error("Failed to fetch vessels:", err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { fetchVessels(); }, []);

  const toggleStatus = async (vessel) => {
    try {
      await updateVessel(vessel.imo, { is_active: !vessel.is_active });
      fetchVessels();
    } catch (err) {
      alert(err.response?.data?.detail || "Update failed");
    }
  };

  const handleDeleteVessel = async (vessel) => {
    if (!window.confirm(`⚠️ Are you sure you want to permanently delete vessel "${vessel.name}" (IMO: ${vessel.imo})?\n\nThis action cannot be undone.`)) return;
    try {
      await deleteVessel(vessel.imo);
      await fetchVessels();
      alert(`✅ Vessel "${vessel.name}" deleted successfully.`);
    } catch (err) {
      alert(err.response?.data?.detail || "Failed to delete vessel");
    }
  };

  const filtered = vessels.filter(v =>
    (v.name.toLowerCase().includes(search.toLowerCase()) || v.imo.includes(search)) &&
    (statusFilter === "ALL" || (statusFilter === "Active" ? v.is_active : !v.is_active))
  );

  if (loading) return <div className="ap-page-wrapper"><p>Loading...</p></div>;

  return (
    <div className="ap-page-wrapper">
      <div className="ap-page-header">
        <h1 className="ap-page-title">Vessel Management</h1>
        <p className="ap-page-subtitle">Manage registered vessels and their user assignments</p>
      </div>
      <div className="ap-card ap-filters-bar">
        <div className="ap-search-box">
          <SearchIcon />
          <input className="ap-input" placeholder="Search by name or IMO number..."
            value={search} onChange={e => setSearch(e.target.value)} />
        </div>
        <div className="ap-filters-right">
          <select className="ap-select" value={statusFilter} onChange={e => setStatusFilter(e.target.value)}>
            <option value="ALL">All Status</option>
            <option value="Active">Active</option>
            <option value="Inactive">Inactive</option>
          </select>
        </div>
      </div>
      <div className="ap-card">
        <div className="ap-table-wrapper">
          <table className="ap-table">
            <thead>
              <tr>
                <th>Vessel</th><th>IMO Number</th><th>Type</th>
                <th>Status</th><th>Assigned Users</th>
                <th className="ap-text-right">Actions</th>
              </tr>
            </thead>
            <tbody>
              {filtered.length === 0 ? (
                <tr><td colSpan={6} className="ap-empty-row">No vessels found.</td></tr>
              ) : filtered.map(vessel => (
                <tr key={vessel.imo}>
                  <td>
                    <div className="ap-td-name">{vessel.name}</div>
                    <div className="ap-td-email">{vessel.vessel_email || "—"}</div>
                  </td>
                  <td style={{ fontFamily: "monospace", fontSize: "0.875rem" }}>IMO {vessel.imo}</td>
                  <td><span className="ap-vessel-type-tag">{(vessel.vessel_type || "—").replace(/_/g, " ")}</span></td>
                  <td>
                    <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                      <span className={"ap-status-dot " + (vessel.is_active ? "active" : "inactive")} />
                      <span style={{ fontSize: "0.875rem" }}>{vessel.is_active ? "Active" : "Inactive"}</span>
                    </div>
                  </td>
                  <td>
                    <UserCountCell assignedUsers={vessel.assigned_users ?? []} />
                  </td>
                  <td>
                    <div className="ap-row-actions">
                      <button className="ap-action-btn" title="Edit" onClick={() => setEditingVessel(vessel)}><EditIcon /></button>
                      <button className={"ap-action-btn " + (vessel.is_active ? "danger" : "success")}
                        onClick={() => toggleStatus(vessel)}><BanIcon /></button>
                      <button className="ap-action-btn danger" title="Delete Vessel" onClick={() => handleDeleteVessel(vessel)}><Trash2 size={16} /></button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
      {editingVessel && (
        <EditVesselSlideOver
          vessel={editingVessel}
          onClose={() => setEditingVessel(null)}
          onSave={fetchVessels}
        />
      )}
    </div>
  );
}
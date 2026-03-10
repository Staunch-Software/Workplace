import React, { useState, useEffect } from "react";
import { Search, Pencil, Ban, X } from "lucide-react";
import { getVessels, updateVessel } from "./lib/adminApi";

const SearchIcon = () => <Search size={16} />;
const EditIcon   = () => <Pencil size={16} />;
const BanIcon    = () => <Ban size={16} />;
const XIcon      = () => <X size={20} />;

function EditVesselSlideOver({ vessel, onClose, onSave }) {
  const [data, setData] = useState({
    name: vessel.name,
    vessel_type: vessel.vessel_type || "OIL_TANKER",
    vessel_email: vessel.vessel_email || "",
    is_active: vessel.is_active,
  });
  const [saving, setSaving] = useState(false);

  const handleSave = async () => {
    setSaving(true);
    try {
      await updateVessel(vessel.imo, data);
      onSave();
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

export default function AllVessels() {
  const [vessels, setVessels]             = useState([]);
  const [loading, setLoading]             = useState(true);
  const [search, setSearch]               = useState("");
  const [statusFilter, setStatusFilter]   = useState("ALL");
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
                  <td><div className="ap-vessel-count">{vessel.assigned_users?.length ?? 0}</div></td>
                  <td>
                    <div className="ap-row-actions">
                      <button className="ap-action-btn" title="Edit" onClick={() => setEditingVessel(vessel)}><EditIcon /></button>
                      <button className={"ap-action-btn " + (vessel.is_active ? "danger" : "success")}
                        onClick={() => toggleStatus(vessel)}><BanIcon /></button>
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
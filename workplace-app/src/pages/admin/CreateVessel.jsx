import React, { useState } from "react";
import { useNavigate } from "react-router-dom";
import { createVessel } from "./lib/adminApi";

const ArrowLeft = () => (<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><line x1="19" y1="12" x2="5" y2="12"/><polyline points="12 19 5 12 12 5"/></svg>);
const CheckIcon = () => (<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="20 6 9 17 4 12"/></svg>);
const InfoIcon  = () => (<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="10"/><line x1="12" y1="16" x2="12" y2="12"/><line x1="12" y1="8" x2="12.01" y2="8"/></svg>);

export default function CreateVessel() {
  const navigate = useNavigate();
  const [form, setForm] = useState({ imo: "", name: "", vessel_type: "OIL_TANKER", vessel_email: "" });
  const [errors, setErrors] = useState({});
  const [submitting, setSubmitting] = useState(false);

  const validate = () => {
    const e = {};
    if (!form.imo)  e.imo  = "IMO Number is required";
    else if (!/^\d{1,7}$/.test(form.imo)) e.imo = "Must be up to 7 digits";
    if (!form.name) e.name = "Vessel name is required";
    if (form.vessel_email && !/\S+@\S+\.\S+/.test(form.vessel_email)) e.vessel_email = "Email is invalid";
    setErrors(e);
    return Object.keys(e).length === 0;
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!validate()) return;
    setSubmitting(true);
    try {
      await createVessel(form);
      navigate("/admin/vessels");
    } catch (err) {
      const detail = err.response?.data?.detail;
      alert(detail || "Failed to create vessel");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="ap-page-wrapper">
      <div className="ap-page-header">
        <button className="ap-btn-back" onClick={() => navigate("/admin/vessels")}>
          <ArrowLeft /> Back to Vessels
        </button>
        <h1 className="ap-page-title">Register New Vessel</h1>
        <p className="ap-page-subtitle">Add a new vessel to the platform</p>
      </div>
      <div className="ap-card ap-card-body">
        <form onSubmit={handleSubmit}>
          <div className="ap-form-grid-2">
            <div className="ap-form-group">
              <label className="ap-label">IMO Number *</label>
              <div style={{ position: "relative" }}>
                <span className="ap-imo-prefix">IMO</span>
                <input className={"ap-input ap-input-imo" + (errors.imo ? " ap-input-error" : "")}
                  value={form.imo} maxLength={7} placeholder="1234567"
                  onChange={e => setForm({ ...form, imo: e.target.value.replace(/\D/g, "") })} />
              </div>
              {errors.imo && <p className="ap-error-msg">{errors.imo}</p>}
            </div>
            <div className="ap-form-group">
              <label className="ap-label">Vessel Name *</label>
              <input className={"ap-input" + (errors.name ? " ap-input-error" : "")}
                value={form.name} placeholder="e.g. Ocean Voyager"
                onChange={e => setForm({ ...form, name: e.target.value })} />
              {errors.name && <p className="ap-error-msg">{errors.name}</p>}
            </div>
            <div className="ap-form-group">
              <label className="ap-label">Vessel Type *</label>
              <select className="ap-select" style={{ width: "100%" }} value={form.vessel_type}
                onChange={e => setForm({ ...form, vessel_type: e.target.value })}>
                <option value="OIL_TANKER">Oil Tanker</option>
                <option value="BULK_CARRIER">Bulk Carrier</option>
                <option value="CONTAINER">Container</option>
                <option value="CHEMICAL_TANKER">Chemical Tanker</option>
                <option value="GAS_CARRIER">Gas Carrier</option>
                <option value="OTHER">Other</option>
              </select>
            </div>
            <div className="ap-form-group">
              <label className="ap-label">Vessel Email</label>
              <input className={"ap-input" + (errors.vessel_email ? " ap-input-error" : "")}
                type="email" value={form.vessel_email} placeholder="master@vessel.com"
                onChange={e => setForm({ ...form, vessel_email: e.target.value })} />
              {errors.vessel_email
                ? <p className="ap-error-msg">{errors.vessel_email}</p>
                : <p className="ap-hint-msg">Optional. Used for automated reports.</p>}
            </div>
          </div>
          <div className="ap-info-box">
            <InfoIcon />
            <div>
              <div className="ap-info-box-title">Important Note</div>
              <div className="ap-info-box-text">
                After creating this vessel, assign it to users from the User Management panel.
              </div>
            </div>
          </div>
          <div className="ap-form-footer">
            <button type="button" className="ap-btn ap-btn-secondary" onClick={() => navigate("/admin/vessels")}>Cancel</button>
            <button type="submit" className="ap-btn ap-btn-primary" disabled={submitting}>
              <CheckIcon /> {submitting ? "Registering..." : "Register Vessel"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
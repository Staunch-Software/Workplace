import React, { useState, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { createUser, assignVessels, getVessels } from "./lib/adminApi";

const ArrowLeft = () => (<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><line x1="19" y1="12" x2="5" y2="12" /><polyline points="12 19 5 12 12 5" /></svg>);
const CheckIcon = () => (<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="20 6 9 17 4 12" /></svg>);
const InfoIcon = () => (<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="10" /><line x1="12" y1="16" x2="12" y2="12" /><line x1="12" y1="8" x2="12.01" y2="8" /></svg>);
const DrsIcon = () => (<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><ellipse cx="12" cy="5" rx="9" ry="3" /><path d="M21 12c0 1.66-4 3-9 3s-9-1.34-9-3" /><path d="M3 5v14c0 1.66 4 3 9 3s9-1.34 9-3V5" /></svg>);
const JiraIcon = () => (<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><rect x="3" y="3" width="18" height="18" rx="2" /><rect x="7" y="7" width="3" height="9" /><rect x="14" y="7" width="3" height="5" /></svg>);
const VoyageIcon = () => (<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M2 21c.6.5 1.2 1 2.5 1 2.5 0 2.5-2 5-2 1.3 0 1.9.5 2.5 1 .6.5 1.2 1 2.5 1 2.5 0 2.5-2 5-2 1.3 0 1.9.5 2.5 1" /><path d="M19 13V7a2 2 0 0 0-2-2H7a2 2 0 0 0-2 2v6" /></svg>);
const LubeIcon = () => (<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M12 22a7 7 0 0 0 7-7c0-2-1-3.9-3-5.5s-3.5-4-4-6.5c-.5 2.5-2 4.9-4 6.5C6 11.1 5 13 5 15a7 7 0 0 0 7 7z" /></svg>);
const EngineIcon = () => (<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="12" cy="12" r="8" /><circle cx="12" cy="12" r="2" /><path d="M12 2v2M12 20v2M4.93 4.93l1.41 1.41M17.66 17.66l1.41 1.41M2 12h2M20 12h2" /></svg>);

const MODULE_LIST = [
    { id: "drs", name: "Defect Reporting System", Icon: DrsIcon },
    { id: "jira", name: "SmartPAL JIRA", Icon: JiraIcon },
    { id: "voyage", name: "Voyage Management", Icon: VoyageIcon },
    { id: "lubeoil", name: "Lubeoil Analysis", Icon: LubeIcon },
    { id: "engine_performance", name: "Engine Performance", Icon: EngineIcon },
];

export default function CreateUser() {
    const navigate = useNavigate();
    const [form, setForm] = useState({ full_name: "", email: "", password: "", job_title: "", role: "VESSEL" });
    const [permissions, setPermissions] = useState({ drs: false, jira: false, voyage: false, lubeoil: false, engine_performance: false });
    const [selectedVessels, setSelectedVessels] = useState([]);
    const [canSelfAssign, setCanSelfAssign] = useState(false);
    const [vessels, setVessels] = useState([]);
    const [errors, setErrors] = useState({});
    const [submitting, setSubmitting] = useState(false);

    useEffect(() => {
        getVessels().then(res => setVessels(res.data)).catch(console.error);
    }, []);

    const validate = () => {
        const e = {};
        if (!form.full_name) e.full_name = "Full name is required";
        if (!form.email) e.email = "Email is required";
        else if (!/\S+@\S+\.\S+/.test(form.email)) e.email = "Email is invalid";
        if (!form.password) e.password = "Password is required";
        // if (!form.job_title) e.job_title = "Job title is required";
        setErrors(e);
        return Object.keys(e).length === 0;
    };

    const handleSubmit = async (e) => {
        e.preventDefault();
        if (!validate()) return;
        setSubmitting(true);
        try {
            const res = await createUser({ ...form, permissions, can_self_assign_vessels: canSelfAssign, });
            if (selectedVessels.length > 0) {
                await assignVessels(res.data.id, selectedVessels, form.password);
            }
            navigate("/admin/users");
        } catch (err) {
            const detail = err.response?.data?.detail;
            alert(detail || "Failed to create user");
        } finally {
            setSubmitting(false);
        }
    };

    const toggleVessel = (imo) =>
        setSelectedVessels(prev => prev.includes(imo) ? prev.filter(v => v !== imo) : [...prev, imo]);

    return (
        <div className="ap-page-wrapper">
            <div className="ap-page-header">
                <button className="ap-btn-back" onClick={() => navigate("/admin/users")}>
                    <ArrowLeft /> Back to Users
                </button>
                <h1 className="ap-page-title">Create New User</h1>
                <p className="ap-page-subtitle">Add a new user and configure their access permissions</p>
            </div>
            <form onSubmit={handleSubmit}>
                <div className="ap-create-layout">
                    <div className="ap-create-left">
                        <div className="ap-card ap-card-body">
                            <h2 className="ap-card-title">User Details</h2>
                            <div className="ap-form-grid-2">
                                <div className="ap-form-group">
                                    <label className="ap-label">Full Name *</label>
                                    <input className={"ap-input" + (errors.full_name ? " ap-input-error" : "")} value={form.full_name}
                                        onChange={e => setForm({ ...form, full_name: e.target.value })} placeholder="e.g. John Doe" />
                                    {errors.full_name && <p className="ap-error-msg">{errors.full_name}</p>}
                                </div>
                                <div className="ap-form-group">
                                    <label className="ap-label">Email Address *</label>
                                    <input className={"ap-input" + (errors.email ? " ap-input-error" : "")} type="email" value={form.email}
                                        onChange={e => setForm({ ...form, email: e.target.value })} placeholder="john.doe@company.com" />
                                    {errors.email && <p className="ap-error-msg">{errors.email}</p>}
                                </div>
                                <div className="ap-form-group">
                                    <label className="ap-label">Password *</label>
                                    <input className={"ap-input" + (errors.password ? " ap-input-error" : "")} type="password" value={form.password}
                                        onChange={e => setForm({ ...form, password: e.target.value })} placeholder="Set a strong password" />
                                    {errors.password && <p className="ap-error-msg">{errors.password}</p>}
                                </div>
                                <div className="ap-form-group">
                                    <label className="ap-label">Job Title </label>
                                    <input className={"ap-input" + (errors.job_title ? " ap-input-error" : "")} value={form.job_title}
                                        onChange={e => setForm({ ...form, job_title: e.target.value })} placeholder="e.g. Master, Chief Engineer" />
                                    {errors.job_title && <p className="ap-error-msg">{errors.job_title}</p>}
                                </div>
                                <div className="ap-form-group ap-form-grid-full">
                                    <label className="ap-label">System Role</label>
                                    <div className="ap-role-grid">
                                        {["VESSEL", "SHORE", "ADMIN"].map(role => (
                                            <div key={role} className={"ap-role-option" + (form.role === role ? " selected" : "")}
                                                onClick={() => setForm({ ...form, role })}>
                                                {role}
                                            </div>
                                        ))}
                                    </div>
                                </div>

                                {form.role === 'SHORE' && (
                                    <div className="ap-form-group ap-form-grid-full" style={{ marginTop: 12 }}>
                                        <div className="ap-module-toggle-row">
                                            <div className="ap-module-toggle-label">
                                                <div className="ap-module-icon-wrap">
                                                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                                                        <path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" />
                                                        <polyline points="9 22 9 12 15 12 15 22" />
                                                    </svg>
                                                </div>
                                                Can Self-Assign Vessels
                                                <span style={{ fontSize: '0.75rem', color: 'var(--ap-text-muted)', marginLeft: 6 }}>
                                                    (User can manage their own vessel access)
                                                </span>
                                            </div>
                                            <button
                                                type="button"
                                                className={"ap-toggle " + (canSelfAssign ? "on" : "off")}
                                                onClick={() => setCanSelfAssign(prev => !prev)}
                                            >
                                                <span className="ap-toggle-knob" />
                                            </button>
                                        </div>
                                    </div>
                                )}
                            </div>
                        </div>
                        <div className="ap-card ap-card-body">
                            <h2 className="ap-card-title">Assign Vessels</h2>
                            <p style={{ fontSize: "0.875rem", color: "var(--ap-text-muted)", marginBottom: 16 }}>
                                Select the vessels this user should have access to.
                            </p>
                            <div className="ap-vessel-grid">
                                {vessels.map(vessel => (
                                    <label key={vessel.imo} className={"ap-vessel-option" + (selectedVessels.includes(vessel.imo) ? " selected" : "")}>
                                        <input type="checkbox" checked={selectedVessels.includes(vessel.imo)} onChange={() => toggleVessel(vessel.imo)} />
                                        <div>
                                            <div className="ap-vessel-option-name">{vessel.name}</div>
                                            <div className="ap-vessel-option-sub">IMO: {vessel.imo} &bull; {(vessel.vessel_type || "").replace(/_/g, " ")}</div>
                                        </div>
                                    </label>
                                ))}
                            </div>
                        </div>
                    </div>
                    <div className="ap-create-right">
                        <div className="ap-card ap-card-body">
                            <h2 className="ap-card-title">Module Permissions</h2>
                            {MODULE_LIST.map(({ id, name, Icon }) => (
                                <div className="ap-module-toggle-row" key={id}>
                                    <div className="ap-module-toggle-label">
                                        <div className="ap-module-icon-wrap"><Icon /></div>
                                        {name}
                                    </div>
                                    <button type="button" className={"ap-toggle " + (permissions[id] ? "on" : "off")}
                                        onClick={() => setPermissions({ ...permissions, [id]: !permissions[id] })}>
                                        <span className="ap-toggle-knob" />
                                    </button>
                                </div>
                            ))}
                        </div>
                        <div className="ap-card ap-card-body">
                            <button type="submit" className="ap-btn ap-btn-primary ap-btn-full" disabled={submitting}>
                                <CheckIcon /> {submitting ? "Creating..." : "Create User"}
                            </button>
                        </div>
                    </div>
                </div>
                <div className="ap-info-box" style={{ marginTop: 0 }}>
                    <InfoIcon />
                    <div>
                        <div className="ap-info-box-title">Important Note</div>
                        <div className="ap-info-box-text">
                            After creating this user, they will need to log in and verify their email before accessing the platform.
                        </div>
                    </div>
                </div>
            </form>
        </div>
    );
}
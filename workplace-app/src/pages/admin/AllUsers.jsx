import React, { useState, useEffect } from "react";
import { Search, Filter, Pencil, Ban, X, FileText, Trello, Ship, Droplet, Activity } from "lucide-react";
import { getUsers, updateUser, assignVessels, getVessels } from "./lib/adminApi";

const SearchIcon = () => <Search size={16} />;
const FilterIcon = () => <Filter size={16} />;
const EditIcon = () => <Pencil size={16} />;
const BanIcon = () => <Ban size={16} />;
const XIcon = () => <X size={20} />;

const MODULE_ICONS = [
    { key: "drs", Icon: () => <FileText size={14} />, label: "DRS" },
    { key: "jira", Icon: () => <Trello size={14} />, label: "JIRA" },
    { key: "voyage", Icon: () => <Ship size={14} />, label: "Voyage" },
    { key: "lubeoil", Icon: () => <Droplet size={14} />, label: "Lubeoil" },
    { key: "engine_performance", Icon: () => <Activity size={14} />, label: "Engine" },
];

function roleBadgeClass(role) {
    if (role === "ADMIN") return "ap-badge ap-badge-admin";
    if (role === "SHORE") return "ap-badge ap-badge-shore";
    if (role === "VESSEL") return "ap-badge ap-badge-vessel";
    return "ap-badge";
}

function EditSlideOver({ user, vessels, onClose, onSave }) {
    const [data, setData] = useState({
        full_name: user.full_name,
        email: user.email,
        password: "",
        job_title: user.job_title || "",
        role: user.role,
        is_active: user.is_active,
        permissions: { ...user.permissions },
        can_self_assign_vessels: user.can_self_assign_vessels ?? false,
    });
    const [selectedVessels, setSelectedVessels] = useState(
        user.assigned_vessels.map(v => v.imo)
    );
    const [saving, setSaving] = useState(false);

    const toggleVessel = (imo) =>
        setSelectedVessels(prev =>
            prev.includes(imo) ? prev.filter(v => v !== imo) : [...prev, imo]
        );

    const handleSave = async () => {
        setSaving(true);
        try {
            const updatePayload = { ...data };
            if (!updatePayload.password) delete updatePayload.password;
            await updateUser(user.id, updatePayload);
            await assignVessels(user.id, selectedVessels);
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
                    <span className="ap-slideover-title">Edit User</span>
                    <button className="ap-icon-btn" onClick={onClose}><XIcon /></button>
                </div>
                <div className="ap-slideover-body">
                    <div className="ap-form-group" style={{ marginBottom: 16 }}>
                        <label className="ap-label">Full Name</label>
                        <input className="ap-input" value={data.full_name} onChange={e => setData({ ...data, full_name: e.target.value })} />
                    </div>
                    <div className="ap-form-group" style={{ marginBottom: 16 }}>
                        <label className="ap-label">Email Address</label>
                        <input className="ap-input" type="email" value={data.email} onChange={e => setData({ ...data, email: e.target.value })} />
                    </div>
                    <div className="ap-form-group" style={{ marginBottom: 16 }}>
                        <label className="ap-label">Reset Password</label>
                        <input className="ap-input" type="password" placeholder="Leave blank to keep current"
                            value={data.password} onChange={e => setData({ ...data, password: e.target.value })} />
                    </div>
                    <div className="ap-form-grid-2" style={{ marginBottom: 16 }}>
                        <div className="ap-form-group">
                            <label className="ap-label">Role</label>
                            <select className="ap-select" style={{ width: "100%" }} value={data.role}
                                onChange={e => setData({ ...data, role: e.target.value })}>
                                <option value="ADMIN">Admin</option>
                                <option value="SHORE">Shore</option>
                                <option value="VESSEL">Vessel</option>
                            </select>
                        </div>
                        <div className="ap-form-group">
                            <label className="ap-label">Status</label>
                            <div style={{ display: "flex", alignItems: "center", height: 42, gap: 12 }}>
                                <button type="button" className={"ap-toggle " + (data.is_active ? "on" : "off")}
                                    onClick={() => setData({ ...data, is_active: !data.is_active })}>
                                    <span className="ap-toggle-knob" />
                                </button>
                                <span style={{ fontSize: "0.875rem" }}>{data.is_active ? "Active" : "Inactive"}</span>
                            </div>
                        </div>
                    </div>
                    <div className="ap-form-group" style={{ marginBottom: 16 }}>
                        <label className="ap-label">Job Title</label>
                        <input className="ap-input" value={data.job_title} onChange={e => setData({ ...data, job_title: e.target.value })} />
                    </div>
                    <div className="ap-form-section-divider">
                        <p className="ap-form-section-title">Module Access</p>
                        {MODULE_ICONS.map(({ key, Icon, label }) => (
                            <div className="ap-module-toggle-row" key={key}>
                                <div className="ap-module-toggle-label">
                                    <div className="ap-module-icon-wrap"><Icon /></div>
                                    {label}
                                </div>
                                <button type="button" className={"ap-toggle " + (data.permissions[key] ? "on" : "off")}
                                    onClick={() => setData({ ...data, permissions: { ...data.permissions, [key]: !data.permissions[key] } })}>
                                    <span className="ap-toggle-knob" />
                                </button>
                            </div>
                        ))}

                        {data.role === 'SHORE' && (
                            <div className="ap-module-toggle-row" style={{ marginTop: 12, paddingTop: 12, borderTop: '1px solid var(--ap-border)' }}>
                                <div className="ap-module-toggle-label">
                                    <div className="ap-module-icon-wrap">
                                        <Ship size={14} />
                                    </div>
                                    Can Self-Assign Vessels
                                    <span style={{ fontSize: '0.72rem', color: 'var(--ap-text-muted)', marginLeft: 6 }}>
                                        Shore only
                                    </span>
                                </div>
                                <button type="button"
                                    className={"ap-toggle " + (data.can_self_assign_vessels ? "on" : "off")}
                                    onClick={() => setData({ ...data, can_self_assign_vessels: !data.can_self_assign_vessels })}>
                                    <span className="ap-toggle-knob" />
                                </button>
                            </div>
                        )}
                    </div>
                    <div className="ap-form-section-divider">
                        <p className="ap-form-section-title">Assigned Vessels</p>
                        <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                            {vessels.map(vessel => {
                                const checked = selectedVessels.includes(vessel.imo);
                                return (
                                    <label key={vessel.imo} style={{
                                        display: "flex", alignItems: "flex-start", gap: 10,
                                        padding: "10px 12px", borderRadius: 6, cursor: "pointer",
                                        border: "1px solid " + (checked ? "rgba(59,130,246,0.5)" : "var(--ap-border)"),
                                        background: checked ? "rgba(59,130,246,0.05)" : "var(--ap-bg)",
                                    }}>
                                        <input type="checkbox" checked={checked} onChange={() => toggleVessel(vessel.imo)}
                                            style={{ marginTop: 2, accentColor: "var(--ap-primary)" }} />
                                        <div>
                                            <div style={{ fontSize: "0.875rem", fontWeight: 500 }}>{vessel.name}</div>
                                            <div style={{ fontSize: "0.75rem", color: "var(--ap-text-muted)" }}>IMO: {vessel.imo}</div>
                                        </div>
                                    </label>
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

export default function AllUsers() {
    const [users, setUsers] = useState([]);
    const [vessels, setVessels] = useState([]);
    const [loading, setLoading] = useState(true);
    const [search, setSearch] = useState("");
    const [roleFilter, setRoleFilter] = useState("ALL");
    const [statusFilter, setStatusFilter] = useState("ALL");
    const [editingUser, setEditingUser] = useState(null);

    const fetchData = async () => {
        try {
            const [usersRes, vesselsRes] = await Promise.all([getUsers(), getVessels()]);
            setUsers(usersRes.data);
            setVessels(vesselsRes.data);
        } catch (err) {
            console.error("Failed to fetch:", err);
        } finally {
            setLoading(false);
        }
    };

    useEffect(() => { fetchData(); }, []);

    const toggleStatus = async (user) => {
        try {
            await updateUser(user.id, { is_active: !user.is_active });
            fetchData();
        } catch (err) {
            alert(err.response?.data?.detail || "Update failed");
        }
    };

    const filtered = users.filter(u => {
        const q = search.toLowerCase();
        return (
            (u.full_name.toLowerCase().includes(q) || u.email.toLowerCase().includes(q)) &&
            (roleFilter === "ALL" || u.role === roleFilter) &&
            (statusFilter === "ALL" || (statusFilter === "Active" ? u.is_active : !u.is_active))
        );
    });

    if (loading) return <div className="ap-page-wrapper"><p>Loading...</p></div>;

    return (
        <div className="ap-page-wrapper">
            <div className="ap-page-header">
                <h1 className="ap-page-title">User Management</h1>
                <p className="ap-page-subtitle">Manage platform access and roles across the organization</p>
            </div>
            <div className="ap-card ap-filters-bar">
                <div className="ap-search-box">
                    <SearchIcon />
                    <input className="ap-input" placeholder="Search users by name or email..."
                        value={search} onChange={e => setSearch(e.target.value)} />
                </div>
                <div className="ap-filters-right">
                    <div className="ap-filter-group">
                        <FilterIcon />
                        <select className="ap-select" value={roleFilter} onChange={e => setRoleFilter(e.target.value)}>
                            <option value="ALL">All Roles</option>
                            <option value="ADMIN">Admin</option>
                            <option value="SHORE">Shore</option>
                            <option value="VESSEL">Vessel</option>
                        </select>
                    </div>
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
                                <th>User</th><th>Role</th><th>Job Title</th>
                                <th>Status</th><th>Modules</th><th>Vessels</th>
                                <th>Last Login</th>
                                <th className="ap-text-right">Actions</th>
                            </tr>
                        </thead>
                        <tbody>
                            {filtered.length === 0 ? (
                                <tr><td colSpan={7} className="ap-empty-row">No users found.</td></tr>
                            ) : filtered.map(user => (
                                <tr key={user.id}>
                                    <td>
                                        <div className="ap-td-name">{user.full_name}</div>
                                        <div className="ap-td-email">{user.email}</div>
                                    </td>
                                    <td><span className={roleBadgeClass(user.role)}>{user.role}</span></td>
                                    <td>{user.job_title || "—"}</td>
                                    <td>
                                        <button className={"ap-toggle " + (user.is_active ? "on" : "off")} onClick={() => toggleStatus(user)}>
                                            <span className="ap-toggle-knob" />
                                        </button>
                                    </td>
                                    <td>
                                        <div className="ap-modules-row">
                                            {MODULE_ICONS.map(({ key, Icon, label }) => (
                                                <div key={key} className={"ap-module-icon " + (user.permissions?.[key] ? "on" : "off")} title={label}><Icon /></div>
                                            ))}
                                        </div>
                                    </td>
                                    <td><div className="ap-vessel-count">{user.assigned_vessels?.length ?? 0}</div></td>
                                    <td>
                                        {user.last_login
                                            ? new Date(user.last_login).toLocaleString('en-GB', { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit', hour12: false })
                                            : <span style={{ color: 'var(--ap-text-muted)', fontSize: '0.75rem' }}>Never</span>
                                        }
                                    </td>
                                    <td>
                                        <div className="ap-row-actions">
                                            <button className="ap-action-btn" title="Edit" onClick={() => setEditingUser(user)}><EditIcon /></button>
                                            <button className={"ap-action-btn " + (user.is_active ? "danger" : "success")}
                                                onClick={() => toggleStatus(user)}><BanIcon /></button>
                                        </div>
                                    </td>
                                </tr>
                            ))}
                        </tbody>
                    </table>
                </div>
            </div>
            {editingUser && (
                <EditSlideOver
                    user={editingUser}
                    vessels={vessels}
                    onClose={() => setEditingUser(null)}
                    onSave={fetchData}
                />
            )}
        </div>
    );
}
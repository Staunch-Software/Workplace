import React, { useState, useEffect, useRef } from "react";
import { Search, Filter, Pencil, Ban, X, FileText, Trello, Ship, Droplet, Activity, Mail, Trash2 } from "lucide-react";
import { getUsers, updateUser, assignVessels, getVessels, resendWelcomeEmail, deleteUser } from "./lib/adminApi";

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

function VesselPopover({ vessels, isOpen, onClose, triggerRef }) {
    const popoverRef = useRef(null);
    const [position, setPosition] = useState({ top: 0, left: 0 });

    useEffect(() => {
        if (isOpen && triggerRef?.current) {
            setTimeout(() => {
                if (popoverRef?.current) {
                    const triggerRect = triggerRef.current.getBoundingClientRect();
                    const popoverRect = popoverRef.current.getBoundingClientRect();

                    // Position to the left of the trigger with gap for the arrow
                    let left = triggerRect.left - popoverRect.width - 16;

                    // If no space on left, flip to right
                    if (left < 8) {
                        left = triggerRect.right + 16;
                    }

                    // Vertically centered alongside the trigger row
                    let top = triggerRect.top + triggerRect.height / 2 - popoverRect.height / 2;

                    // Clamp vertically so it stays within viewport
                    top = Math.max(8, Math.min(top, window.innerHeight - popoverRect.height - 8));

                    setPosition({ top, left });
                }
            }, 0);
        }
    }, [isOpen, triggerRef]);

    useEffect(() => {
        const handleScroll = () => {
            if (isOpen) onClose();
        };
        if (isOpen) {
            window.addEventListener("scroll", handleScroll);
            return () => window.removeEventListener("scroll", handleScroll);
        }
    }, [isOpen, onClose]);

    useEffect(() => {
        const handleClickOutside = (e) => {
            if (
                popoverRef.current && !popoverRef.current.contains(e.target) &&
                triggerRef?.current && !triggerRef.current.contains(e.target)
            ) {
                onClose();
            }
        };
        if (isOpen) {
            document.addEventListener("mousedown", handleClickOutside);
            return () => document.removeEventListener("mousedown", handleClickOutside);
        }
    }, [isOpen, onClose, triggerRef]);

    if (!isOpen || vessels.length === 0) return null;

    // Dynamically compute arrow position relative to the popover's clamped top
    // so it always points exactly at the clicked trigger badge
    const triggerCenterY = triggerRef?.current
        ? triggerRef.current.getBoundingClientRect().top +
          triggerRef.current.getBoundingClientRect().height / 2
        : 0;

    const arrowTop = Math.max(
        16,
        Math.min(
            triggerCenterY - position.top,
            (popoverRef.current?.offsetHeight ?? 300) - 16
        )
    );

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
                boxShadow: "0 4px 16px rgba(0, 0, 0, 0.2)",
                minWidth: "300px",
                maxWidth: "420px",
            }}
            className="ap-popover"
        >
            {/* Arrow border layer — dynamically points at the trigger */}
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
            {/* Arrow fill layer — masks border for clean outlined look */}
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

            <div style={{ padding: "16px" }}>
                <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 14 }}>
                    <Ship size={16} style={{ color: "var(--ap-primary)" }} />
                    <p style={{ fontSize: "0.875rem", fontWeight: 600, color: "var(--ap-text)", margin: 0 }}>
                        Assigned Vessels ({vessels.length})
                    </p>
                </div>
                <div style={{
                    display: "flex",
                    flexDirection: "column",
                    gap: 10,
                    maxHeight: "420px",
                    overflowY: "auto",
                    paddingRight: "6px",
                }}>
                    {vessels.map(vessel => (
                        <div
                            key={vessel.imo}
                            style={{
                                padding: "12px 14px",
                                borderRadius: 7,
                                background: "linear-gradient(135deg, rgba(59, 130, 246, 0.05) 0%, rgba(59, 130, 246, 0.02) 100%)",
                                border: "1px solid rgba(59, 130, 246, 0.2)",
                                borderLeft: "3px solid var(--ap-primary)",
                                flexShrink: 0,
                                transition: "all 0.2s ease",
                            }}
                        >
                            <div style={{ fontSize: "0.9rem", fontWeight: 600, color: "var(--ap-text)", marginBottom: 4 }}>
                                {vessel.name}
                            </div>
                            <div style={{ fontSize: "0.75rem", color: "var(--ap-text-muted)", fontFamily: "monospace", letterSpacing: "0.5px" }}>
                                IMO {vessel.imo}
                            </div>
                            {vessel.vessel_type && (
                                <div style={{
                                    fontSize: "0.7rem",
                                    color: "var(--ap-text-muted)",
                                    marginTop: 4,
                                    display: "inline-block",
                                    padding: "2px 8px",
                                    borderRadius: 3,
                                    background: "rgba(59, 130, 246, 0.1)",
                                }}>
                                    {vessel.vessel_type.replace(/_/g, " ")}
                                </div>
                            )}
                        </div>
                    ))}
                </div>
            </div>
        </div>
    );
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

// AFTER
function VesselCountCell({ assignedVessels, isOpen, onToggle, onClose }) {
    const triggerRef = useRef(null);

    return (
        <>
            <div
                ref={triggerRef}
                className="ap-vessel-count"
                onClick={onToggle}
                style={{ cursor: "pointer" }}
                title={assignedVessels.length > 0 ? "Click to see details" : "No vessels assigned"}
            >
                {assignedVessels.length}
            </div>
            <VesselPopover
                vessels={assignedVessels}
                isOpen={isOpen}
                onClose={onClose}
                triggerRef={triggerRef}
            />
        </>
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
    const [openVesselPopoverUserId, setOpenVesselPopoverUserId] = useState(null);

    const fetchData = async () => {
        try {
            const [usersRes, vesselsRes] = await Promise.all([getUsers(), getVessels()]);
            setUsers(Array.isArray(usersRes.data) ? usersRes.data : usersRes.data.results ?? []);
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

    const handleResendEmail = async (user) => {
        if (!window.confirm(`Reset password to "Ozellar@123" and resend welcome email to ${user.email}?`)) return;
        try {
            await resendWelcomeEmail(user.id);
            alert(`✅ Password reset and email sent to ${user.email}`);
        } catch (err) {
            alert(err.response?.data?.detail || "Failed to resend email");
        }
    };

    const handleDeleteUser = async (user) => {
        if (!window.confirm(`⚠️ Are you sure you want to permanently delete "${user.full_name}" (${user.email})?\n\nThis action cannot be undone.`)) return;
        try {
            await deleteUser(user.id);
            await fetchData();
            alert(`✅ User "${user.full_name}" deleted successfully.`);
        } catch (err) {
            alert(err.response?.data?.detail || "Failed to delete user");
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
                                <tr><td colSpan={8} className="ap-empty-row">No users found.</td></tr>
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
                                    <td>
                                        <VesselCountCell
                                            assignedVessels={user.assigned_vessels ?? []}
                                            isOpen={openVesselPopoverUserId === user.id}
                                            onToggle={() => setOpenVesselPopoverUserId(
                                                openVesselPopoverUserId === user.id ? null : user.id
                                            )}
                                            onClose={() => setOpenVesselPopoverUserId(null)}
                                        />
                                    </td>
                                    <td>
                                        {user.last_login
                                            ? new Date(user.last_login).toLocaleString('en-GB', { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit', hour12: false })
                                            : <span style={{ color: 'var(--ap-text-muted)', fontSize: '0.75rem' }}>Never</span>
                                        }
                                    </td>
                                    <td>
                                        <div className="ap-row-actions">
                                            <button className="ap-action-btn" title="Edit" onClick={() => setEditingUser(user)}><EditIcon /></button>
                                            <button className="ap-action-btn" title="Resend Welcome Email" onClick={() => handleResendEmail(user)}><Mail size={16} /></button>
                                            <button className={"ap-action-btn " + (user.is_active ? "danger" : "success")}
                                                onClick={() => toggleStatus(user)}><BanIcon /></button>
                                            <button className="ap-action-btn danger" title="Delete User" onClick={() => handleDeleteUser(user)}><Trash2 size={16} /></button>
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
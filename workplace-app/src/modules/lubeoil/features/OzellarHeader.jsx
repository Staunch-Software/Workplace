import React, { useState, useEffect, useRef } from "react";
import { useNavigate } from "react-router-dom";
import {
  Bell,
  LayoutDashboard,
  Activity,
  ChevronDown,
  X,
  ChevronLeft,
  Settings2,
} from "lucide-react";
import "../styles/luboil.css";

const OzellarHeader = ({
  unreadCount = 0,
  notifications = [],
  showNotifDropdown = false,
  notifRef = null,
  onBellClick = () => {},
  onNotifClick = () => {},
  onHideNotification = () => {},
  onFeedClick = () => {},
  viewMode = "matrix",
  user = null,
  onRegisterVessel = () => {},
  onSignOut = () => {},
}) => {
  const navigate = useNavigate();
  const [showUserMenu, setShowUserMenu] = useState(false);
  const userMenuRef = useRef(null);

  useEffect(() => {
    const handleClickOutside = (event) => {
      if (userMenuRef.current && !userMenuRef.current.contains(event.target)) {
        setShowUserMenu(false);
      }
    };
    if (showUserMenu) {
      document.addEventListener("mousedown", handleClickOutside);
    }
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, [showUserMenu]);

  const userData = user?.user || user;
  const userName = userData?.full_name || "System Administrator";
  const userRole = userData?.job_title || userData?.role || "IT Manager";
  const initials = userName
    .split(" ")
    .slice(0, 2)
    .map((n) => n[0])
    .join("")
    .toUpperCase();

  // Determine if user is admin/superuser — only they see Config Vessel
  const uRole = String(userData?.role || "").toUpperCase();
  const isAdmin = ["ADMIN", "SUPERUSER", "SHORE", "SUPERINTENDENT"].includes(
    uRole,
  );

  const activeNav = viewMode === "liveFeed" ? "feed" : "dashboard";

  return (
    <header className="lub-navbar" style={{ zIndex: 9000 }}>
      {/* ── LEFT: Back button + Divider + Brand (Report Tracker layout) ── */}
      <div style={{ display: "flex", alignItems: "center", gap: "14px" }}>
        {/* Subtle dots-grid → arrow button */}
        <button
          className="lub-nav-home-btn"
          onClick={() => navigate("/dashboard")}
          title="Back to Dashboard"
          aria-label="Back to Dashboard"
        >
          <div className="lub-dots-grid">
            {[...Array(9)].map((_, i) => (
              <span key={i} className="lub-dot" />
            ))}
          </div>
          <div className="lub-dots-arrow">‹</div>
        </button>

        <div className="lub-nav-divider" />

        {/* Brand */}
        <div className="lub-nav-brand">
          <div className="lub-nav-icon">
            <svg
              width="20"
              height="20"
              viewBox="0 0 24 24"
              fill="none"
              stroke="white"
              strokeWidth="2.2"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <circle cx="12" cy="5" r="2" />
              <path d="M12 7v14" />
              <path d="M5 14l7 7 7-7" />
              <path d="M5 14H2a10 10 0 0 0 20 0h-3" />
            </svg>
          </div>
          <div className="lub-nav-brand-text">
            <div className="lub-nav-title">Ozellar Marine</div>
            <div className="lub-nav-title-tag">Lube Oil · Shore HQ</div>
          </div>
        </div>

        {/* ── Segmented Navigation Links (Report Tracker layout) ── */}
        <div className="lub-nav-links">
          <button
            className={`lub-nav-link ${activeNav === "dashboard" ? "active" : ""}`}
            onClick={() => {
              if (viewMode === "liveFeed") onFeedClick();
            }}
          >
            <LayoutDashboard size={14} />
            Dashboard
          </button>

          <button
            className={`lub-nav-link ${activeNav === "feed" ? "active" : ""}`}
            onClick={onFeedClick}
          >
            <Activity size={14} />
            Live Feed
          </button>
        </div>
      </div>

      {/* ── RIGHT: Notification Bell + User Profile ── */}
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: "12px",
        }}
      >
        {/* Notification Bell */}
        <div style={{ position: "relative" }} ref={notifRef}>
          <button
            className="lub-nav-bell-btn"
            onClick={onBellClick}
            aria-label="Notifications"
          >
            <Bell size={17} color={unreadCount > 0 ? "#059669" : "#64748b"} />
            {unreadCount > 0 && (
              <span className="lub-nav-bell-badge">{unreadCount}</span>
            )}
          </button>

          {showNotifDropdown && (
            <div className="lub-notif-dropdown">
              <div className="lub-notif-header">
                <span className="lub-notif-title">Notifications</span>
                {unreadCount > 0 && (
                  <span className="lub-notif-unread-tag">
                    {unreadCount} unread
                  </span>
                )}
              </div>
              <div style={{ overflowY: "auto", maxHeight: "360px" }}>
                {notifications.length === 0 ? (
                  <div
                    style={{
                      padding: "32px",
                      textAlign: "center",
                      color: "#94a3b8",
                      fontSize: "0.85rem",
                    }}
                  >
                    No recent notifications
                  </div>
                ) : (
                  notifications.map((n) => (
                    <div
                      key={n.id}
                      onClick={() => onNotifClick(n)}
                      style={{
                        padding: "12px 16px",
                        borderBottom: "1px solid #f1f5f9",
                        cursor: "pointer",
                        backgroundColor: n.is_read ? "transparent" : "#eff6ff",
                        transition: "background 0.2s",
                        position: "relative",
                      }}
                      onMouseEnter={(e) =>
                        (e.currentTarget.style.backgroundColor = n.is_read
                          ? "#f8fafc"
                          : "#dbeafe")
                      }
                      onMouseLeave={(e) =>
                        (e.currentTarget.style.backgroundColor = n.is_read
                          ? "transparent"
                          : "#eff6ff")
                      }
                    >
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          onHideNotification(n.id);
                        }}
                        style={{
                          position: "absolute",
                          top: "10px",
                          right: "10px",
                          background: "none",
                          border: "none",
                          color: "#cbd5e1",
                          cursor: "pointer",
                          padding: "4px",
                          zIndex: 2,
                        }}
                        onMouseEnter={(e) =>
                          (e.currentTarget.style.color = "#ef4444")
                        }
                        onMouseLeave={(e) =>
                          (e.currentTarget.style.color = "#cbd5e1")
                        }
                      >
                        <X size={13} />
                      </button>
                      <div
                        style={{
                          fontSize: "0.82rem",
                          color: "#1e293b",
                          lineHeight: "1.4",
                          paddingRight: "24px",
                        }}
                      >
                        {n.sender_name && n.message.includes(n.sender_name)
                          ? n.message
                              .split(n.sender_name)
                              .map((part, i, arr) => (
                                <React.Fragment key={i}>
                                  {part}
                                  {i < arr.length - 1 && (
                                    <strong style={{ fontWeight: "800" }}>
                                      {n.sender_name}
                                    </strong>
                                  )}
                                </React.Fragment>
                              ))
                          : n.message}
                      </div>
                      <div
                        style={{
                          fontSize: "0.7rem",
                          color: "#94a3b8",
                          marginTop: "5px",
                        }}
                      >
                        {new Date(n.created_at + "Z").toLocaleString("en-GB", {
                          day: "2-digit",
                          month: "short",
                          hour: "2-digit",
                          minute: "2-digit",
                          hour12: true,
                        })}
                      </div>
                    </div>
                  ))
                )}
              </div>
            </div>
          )}
        </div>

        {/* User Avatar + Dropdown (Report Tracker layout) */}
        <div className="lub-nav-profile" ref={userMenuRef}>
          <div
            className="lub-profile-pill"
            onClick={() => setShowUserMenu(!showUserMenu)}
          >
            <div className="lub-avatar">{initials}</div>
            <div className="lub-profile-info">
              <span className="lub-profile-name">{userName}</span>
              <span className="lub-profile-role">{userRole}</span>
            </div>
            <ChevronDown
              size={13}
              className={`lub-profile-chevron ${showUserMenu ? "open" : ""}`}
            />
          </div>

          {/* ── DROPDOWN MENU ── */}
          {showUserMenu && (
            <div className="lub-profile-dropdown">
              <div className="lub-dropdown-user">
                <div className="lub-dropdown-avatar">{initials}</div>
                <div>
                  <div className="lub-dropdown-user-name">{userName}</div>
                  <div className="lub-dropdown-user-role">
                    {userData?.email || userRole}
                  </div>
                </div>
              </div>

              <div className="lub-dropdown-sep" />

              {/* ── Back to Dashboard ── */}
              <button
                className="lub-dropdown-item"
                onClick={() => {
                  setShowUserMenu(false);
                  navigate("/dashboard");
                }}
              >
                <ChevronLeft size={15} color="#64748b" />
                <span>Back to Dashboard</span>
              </button>

              {/* ── Config Vessel (admin/shore only) ── */}
              {isAdmin && (
                <button
                  className="lub-dropdown-item"
                  onClick={() => {
                    setShowUserMenu(false);
                    navigate("/lub/VesselConfig");
                  }}
                  style={{ color: "#059669" }}
                >
                  <Settings2 size={15} color="#059669" />
                  <span>Config Vessel</span>
                </button>
              )}
            </div>
          )}
        </div>
      </div>
    </header>
  );
};

export default OzellarHeader;

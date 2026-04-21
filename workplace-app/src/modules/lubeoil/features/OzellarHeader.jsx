import React, { useState } from "react";
import { useNavigate } from "react-router-dom";
import {
  Bell,
  Plus,
  LayoutDashboard,
  Activity,
  ChevronDown,
  X,
  ChevronLeft,
  Settings2, // NEW
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
  const userMenuRef = React.useRef(null);

  React.useEffect(() => {
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

  // Shared menu item style
  const menuItemStyle = {
    padding: "9px 14px",
    cursor: "pointer",
    fontSize: "0.82rem",
    fontWeight: "600",
    color: "#334155",
    display: "flex",
    alignItems: "center",
    gap: "8px",
    transition: "background 0.15s",
    borderBottom: "0.5px solid #f1f5f9",
    whiteSpace: "nowrap",
  };

  return (
    <header
      style={{
        position: "fixed",
        top: 0,
        left: 0,
        right: 0,
        zIndex: 9000,
        backgroundColor: "#0f172a",
        height: "60px",
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
        padding: "0 24px",
        boxShadow: "0 2px 12px rgba(0,0,0,0.4)",
      }}
    >
      {/* ── LEFT: Logo + Brand ── */}
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: "12px",
          minWidth: "220px",
        }}
      >
        <button
          className="nine-dot-btn"
          onClick={() => (window.location.href = "/dashboard")}
          title="Back to Dashboard"
          aria-label="Back to Dashboard"
        >
          <div className="nine-dot-grid">
            {[...Array(9)].map((_, i) => (
              <span key={i} className="dot" />
            ))}
          </div>
          <span className="nine-dot-label">
            <ChevronLeft size={20} />
          </span>
        </button>

        <div
          style={{
            width: "36px",
            height: "36px",
            borderRadius: "10px",
            background: "linear-gradient(135deg, #10b981 0%, #059669 100%)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            flexShrink: 0,
            boxShadow: "0 2px 8px rgba(16,185,129,0.4)",
          }}
        >
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
        <div style={{ lineHeight: "1.2" }}>
          <div
            style={{
              fontSize: "0.95rem",
              fontWeight: "700",
              color: "#f8fafc",
              letterSpacing: "0.2px",
            }}
          >
            Ozellar Marine
          </div>
          <div
            style={{
              fontSize: "0.62rem",
              color: "#64748b",
              fontWeight: "600",
              letterSpacing: "0.8px",
              textTransform: "uppercase",
            }}
          >
            Shore HQ
          </div>
        </div>
      </div>

      {/* ── CENTER: Navigation ── */}
      <nav style={{ display: "flex", alignItems: "center", gap: "4px" }}>
        <button
          onClick={() => {
            if (viewMode === "liveFeed") onFeedClick();
          }}
          style={{
            display: "flex",
            alignItems: "center",
            gap: "7px",
            padding: "7px 18px",
            borderRadius: "8px",
            border: "none",
            cursor: "pointer",
            fontSize: "0.85rem",
            fontWeight: activeNav === "dashboard" ? "700" : "500",
            color: activeNav === "dashboard" ? "white" : "#94a3b8",
            backgroundColor:
              activeNav === "dashboard"
                ? "rgba(255,255,255,0.12)"
                : "transparent",
            transition: "all 0.2s ease",
          }}
          onMouseEnter={(e) => {
            if (activeNav !== "dashboard") {
              e.currentTarget.style.backgroundColor = "rgba(255,255,255,0.07)";
              e.currentTarget.style.color = "#e2e8f0";
            }
          }}
          onMouseLeave={(e) => {
            if (activeNav !== "dashboard") {
              e.currentTarget.style.backgroundColor = "transparent";
              e.currentTarget.style.color = "#94a3b8";
            }
          }}
        >
          <LayoutDashboard size={15} />
          Dashboard
        </button>

        <button
          onClick={onFeedClick}
          style={{
            display: "flex",
            alignItems: "center",
            gap: "7px",
            padding: "7px 18px",
            borderRadius: "8px",
            border: "none",
            cursor: "pointer",
            fontSize: "0.85rem",
            fontWeight: activeNav === "feed" ? "700" : "500",
            color: activeNav === "feed" ? "white" : "#94a3b8",
            backgroundColor:
              activeNav === "feed" ? "rgba(255,255,255,0.12)" : "transparent",
            transition: "all 0.2s ease",
          }}
          onMouseEnter={(e) => {
            if (activeNav !== "feed") {
              e.currentTarget.style.backgroundColor = "rgba(255,255,255,0.07)";
              e.currentTarget.style.color = "#e2e8f0";
            }
          }}
          onMouseLeave={(e) => {
            if (activeNav !== "feed") {
              e.currentTarget.style.backgroundColor = "transparent";
              e.currentTarget.style.color = "#94a3b8";
            }
          }}
        >
          <Activity size={15} />
          My Feed
        </button>
      </nav>

      {/* ── RIGHT: Bell + User ── */}
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: "10px",
          minWidth: "220px",
          justifyContent: "flex-end",
        }}
      >
        {/* Notification Bell */}
        <div style={{ position: "relative" }} ref={notifRef}>
          <button
            onClick={onBellClick}
            style={{
              backgroundColor: "white",
              border: "1px solid #e2e8f0",
              borderRadius: "8px",
              padding: "8px",
              cursor: "pointer",
              display: "flex",
              alignItems: "center",
              color: unreadCount > 0 ? "#2563eb" : "#64748b",
              transition: "all 0.2s",
            }}
          >
            <Bell size={18} />
            {unreadCount > 0 && (
              <span
                style={{
                  position: "absolute",
                  top: "-6px",
                  right: "-6px",
                  backgroundColor: "#ef4444",
                  color: "white",
                  fontSize: "9px",
                  fontWeight: "bold",
                  borderRadius: "50%",
                  width: "16px",
                  height: "18px",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  border: "2px solid white",
                }}
              >
                {unreadCount}
              </span>
            )}
          </button>

          {showNotifDropdown && (
            <div
              style={{
                position: "absolute",
                top: "calc(100% + 10px)",
                right: 0,
                width: "320px",
                maxHeight: "420px",
                backgroundColor: "white",
                borderRadius: "12px",
                boxShadow: "0 20px 40px rgba(0,0,0,0.25)",
                border: "1px solid #e2e8f0",
                overflow: "hidden",
                zIndex: 10000,
              }}
            >
              <div
                style={{
                  padding: "12px 16px",
                  backgroundColor: "#f8fafc",
                  borderBottom: "1px solid #f1f5f9",
                  display: "flex",
                  justifyContent: "space-between",
                  alignItems: "center",
                }}
              >
                <span
                  style={{
                    fontWeight: "800",
                    fontSize: "0.75rem",
                    color: "#64748b",
                    letterSpacing: "0.5px",
                    textTransform: "uppercase",
                  }}
                >
                  Notifications
                </span>
                {unreadCount > 0 && (
                  <span
                    style={{
                      fontSize: "0.7rem",
                      color: "#2563eb",
                      fontWeight: "700",
                    }}
                  >
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
                        backgroundColor: n.is_read ? "transparent" : "#f0f9ff",
                        transition: "background 0.2s",
                        position: "relative",
                      }}
                      onMouseEnter={(e) =>
                        (e.currentTarget.style.backgroundColor = n.is_read
                          ? "#f8fafc"
                          : "#e0f2fe")
                      }
                      onMouseLeave={(e) =>
                        (e.currentTarget.style.backgroundColor = n.is_read
                          ? "transparent"
                          : "#f0f9ff")
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

        {/* User Avatar + Dropdown */}
        <div style={{ position: "relative" }} ref={userMenuRef}>
          <button
            onClick={() => setShowUserMenu(!showUserMenu)}
            style={{
              display: "flex",
              alignItems: "center",
              gap: "10px",
              padding: "5px 10px 5px 6px",
              borderRadius: "10px",
              border: "1px solid rgba(255,255,255,0.1)",
              backgroundColor: showUserMenu
                ? "rgba(255,255,255,0.12)"
                : "rgba(255,255,255,0.06)",
              cursor: "pointer",
              transition: "all 0.2s",
            }}
            onMouseEnter={(e) =>
              (e.currentTarget.style.backgroundColor = "rgba(255,255,255,0.12)")
            }
            onMouseLeave={(e) => {
              if (!showUserMenu)
                e.currentTarget.style.backgroundColor =
                  "rgba(255,255,255,0.06)";
            }}
          >
            <div
              style={{
                width: "30px",
                height: "30px",
                borderRadius: "8px",
                backgroundColor: "#2563eb",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                fontSize: "0.7rem",
                fontWeight: "800",
                color: "white",
                flexShrink: 0,
              }}
            >
              {initials}
            </div>
            <div style={{ lineHeight: "1.2", textAlign: "left" }}>
              <div
                style={{
                  fontSize: "0.8rem",
                  fontWeight: "700",
                  color: "#f1f5f9",
                  whiteSpace: "nowrap",
                }}
              >
                {userName}
              </div>
              <div
                style={{
                  fontSize: "0.62rem",
                  color: "#64748b",
                  fontWeight: "500",
                }}
              >
                {userRole}
              </div>
            </div>
            <ChevronDown
              size={13}
              color="#64748b"
              style={{
                transition: "transform 0.2s",
                transform: showUserMenu ? "rotate(180deg)" : "rotate(0deg)",
              }}
            />
          </button>

          {/* ── DROPDOWN MENU ── */}
          {showUserMenu && (
            <div
              style={{
                position: "absolute",
                top: "calc(100% + 8px)",
                right: 0,
                minWidth: "200px",
                backgroundColor: "white",
                borderRadius: "10px",
                boxShadow: "0 10px 30px rgba(0,0,0,0.15)",
                border: "1px solid #e2e8f0",
                overflow: "hidden",
                zIndex: 10000,
              }}
            >
              {/* ── Back to Dashboard ── */}
              <div
                onClick={() => {
                  setShowUserMenu(false);
                  window.location.href = "/dashboard";
                }}
                style={menuItemStyle}
                onMouseEnter={(e) =>
                  (e.currentTarget.style.backgroundColor = "#f8fafc")
                }
                onMouseLeave={(e) =>
                  (e.currentTarget.style.backgroundColor = "white")
                }
              >
                <ChevronLeft size={14} color="#64748b" />
                Back to Dashboard
              </div>

              {/* ── Config Vessel (admin/shore only) ── */}
              {isAdmin && (
                <div
                  onClick={() => {
                    setShowUserMenu(false);
                    navigate("/lub/VesselConfig");
                  }}
                  style={{
                    ...menuItemStyle,
                    borderBottom: "none",
                    color: "#0f172a",
                  }}
                  onMouseEnter={(e) => {
                    e.currentTarget.style.backgroundColor = "#f0f9ff";
                    e.currentTarget.style.color = "#2563eb";
                  }}
                  onMouseLeave={(e) => {
                    e.currentTarget.style.backgroundColor = "white";
                    e.currentTarget.style.color = "#0f172a";
                  }}
                >
                  <Settings2 size={14} color="#2563eb" />
                  Config Vessel
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </header>
  );
};

export default OzellarHeader;

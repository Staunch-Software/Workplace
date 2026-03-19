import React, { useEffect, useState, useRef } from "react";
import { Link, useLocation, useNavigate } from "react-router-dom";
import { useAuth } from "@/context/AuthContext";
import { fleet } from "../lib/ships";
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
// import logo from "../assets/250714_OzellarMarine-Logo-Final.png";

export default function AppHeader() {
  const location = useLocation();
  const navigate = useNavigate();
  const { user, logout } = useAuth();
  const isAuthenticated = !!user;

  const nav = [
    { href: "/aepms", label: "Dashboard" },
    { href: "/aepms/me-performance", label: "Performance" },
    { href: "/aepms/fleet", label: "Fleet" },
    { href: "/aepms/voyage", label: "Voyage" },
  ];

  const [theme, setTheme] = useState("light");
  const [selectedShip, setSelectedShip] = useState("");
  const [isMenuOpen, setIsMenuOpen] = useState(false);
  const [isMobileNavOpen, setIsMobileNavOpen] = useState(false);

  const menuRef = useRef(null);

  const isActive = (path) => {
    if (path === "/performance-cockpit") {
      return location.pathname === "/performance-cockpit";
    }
    if (path === "/dashboard") {
      const dashboardRoutes = [
        "/dashboard",
        "/me-performance",
        "/ae-performance",
        "/luboil-analysis",
      ];
      return dashboardRoutes.includes(location.pathname);
    }
    return location.pathname === path;
  };

  useEffect(() => {
    const stored = localStorage.getItem("theme");
    const initialTheme = stored === "dark" ? "dark" : "light";
    setTheme(initialTheme);

    if (initialTheme === "dark") {
      document.documentElement.classList.add("dark");
    } else {
      document.documentElement.classList.remove("dark");
    }

    if (isAuthenticated) {
      const savedShip = localStorage.getItem("selectedShipId");
      const fallback = fleet[0]?.id ?? "";
      setSelectedShip(savedShip || fallback);
    }
  }, [isAuthenticated]);

  useEffect(() => {
    const handleClickOutside = (event) => {
      if (menuRef.current && !menuRef.current.contains(event.target)) {
        setIsMenuOpen(false);
      }
    };

    if (isMenuOpen) {
      document.addEventListener("mousedown", handleClickOutside);
    }

    return () => {
      document.removeEventListener("mousedown", handleClickOutside);
    };
  }, [isMenuOpen]);

  useEffect(() => {
    setIsMobileNavOpen(false);
  }, [location.pathname]);

  const toggleTheme = () => {
    const next = theme === "dark" ? "light" : "dark";
    setTheme(next);

    if (next === "dark") {
      document.documentElement.classList.add("dark");
    } else {
      document.documentElement.classList.remove("dark");
    }

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

  const toggleMobileNav = () => {
    setIsMobileNavOpen((prev) => !prev);
  };

  const handleAdminClick = () => {
    setIsMenuOpen(false);
    navigate("/admin");
  };

  if (!isAuthenticated) return null;

  return (
    <header className="app-header">
      <div className="header-container">
        <div className="header-brand">
          {/* <img src={logo} alt="logo" className="brand-logo" /> */}
          <span className="brand-title">Ship Engine Performance Console</span>
        </div>

        <nav className={`header-nav ${isMobileNavOpen ? "open" : ""}`}>
          {nav.map((n) => (
            <Link
              key={n.href}
              to={n.href}
              className={`nav-link ${isActive(n.href) ? "active" : ""}`}
              onClick={() => setIsMobileNavOpen(false)}
            >
              {n.label}
            </Link>
          ))}
        </nav>

        <div className="header-actions">
          <button
            className="mobile-nav-toggle"
            onClick={toggleMobileNav}
            aria-label="Toggle navigation"
            aria-expanded={isMobileNavOpen}
          >
            ☰
          </button>

          <div className="user-menu-container" ref={menuRef}>
            <button className="user-menu-trigger" onClick={toggleMenu}>
              <User size={18} />
              <span className="user-menu-name">{user?.full_name || "User"}</span>
              <ChevronDown
                size={16}
                className={`user-menu-chevron ${isMenuOpen ? "open" : "closed"}`}
              />
            </button>

            {isMenuOpen && (
              <div className="user-dropdown-menu">
                <div className="user-dropdown-header">
                  <div className="user-dropdown-name">{user?.full_name}</div>
                  {user?.authType && (
                    <div className="user-dropdown-auth">
                      {user.authType === "microsoft"
                        ? "Microsoft SSO"
                        : "Local Account"}
                    </div>
                  )}
                </div>

                <div className="user-dropdown-items">
                  <button
                    onClick={toggleTheme}
                    className="user-dropdown-btn theme"
                  >
                    {theme === "dark" ? (
                      <SunMedium size={18} />
                    ) : (
                      <Moon size={18} />
                    )}
                    <span>{theme === "dark" ? "Light Mode" : "Dark Mode"}</span>
                  </button>

                  {(user?.role === "admin" || user?.role === "superuser") && (
                    <button
                      onClick={handleAdminClick}
                      className="user-dropdown-btn admin"
                    >
                      <Shield size={18} />
                      <span>Admin Panel</span>
                    </button>
                  )}

                  <div className="user-dropdown-divider" />

                  <button
                    onClick={handleSignOut}
                    className="user-dropdown-btn logout"
                  >
                    <LogOut size={18} />
                    <span>Sign Out</span>
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>
      </div>
    </header>
  );
}

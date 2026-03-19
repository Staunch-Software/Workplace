// --- START OF FILE Performance.jsx (FINAL STABLE VERSION) ---

import React, { useEffect, useState, useMemo, useRef } from "react";
import { useNavigate } from "react-router-dom";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "../components/ui/Card";
import Select from "../components/ui/Select";
import Button from "../components/ui/Button";
import { Download } from "lucide-react";
import {
  LineChart,
  Line,
  ReferenceDot,
  XAxis,
  YAxis,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  Legend,
  ReferenceLine,
  ReferenceArea,
  BarChart,
  Bar,
  Cell,
  Scatter,
  ComposedChart,
} from "recharts";

import axiosAepms from '../api/axiosAepms';
import "../styles/performance.css";
import jsPDF from "jspdf";
import autoTable from "jspdf-autotable";
import html2canvas from "html2canvas";
// import ozellarLogo from "../assets/250714_OzellarMarine-Logo-Final.png";
const SUMMARY_TABLE_SCHEMA = {
  mainEngine: [
    { key: "EngSpeed", label: "Engine RPM" },
    { key: "Pmax", label: "Pmax" },
    { key: "Pcomp", label: "Pcomp" },
    { key: "ScavAir", label: "Scavenge Air Pressure" },
    { key: "Exh_T/C_inlet", label: "Exh. T/C Inlet Temp" },
    { key: "Exh_Cylinder_outlet", label: "Exh. Cylinder Outlet Temp" },
    { key: "Exh_T/C_outlet", label: "Exh. T/C Outlet Temp" },
    { key: "FIPI", label: "Fuel Pump Index (FIPI)" },
    { key: "SFOC", label: "SFOC" },
    { key: "Turbospeed", label: "Turbocharger Speed" },
    // Essential for ISO calculations
    // { key: "tc_air_inlet_temp_c", label: "TC Air Inlet Temp" },
    // { key: "scav_air_cooler_cw_in_temp_c", label: "Cooling Water Inlet Temp" }
  ],
  auxiliaryEngine: [
    { key: "Pmax", label: "Pmax" },
    { key: "ScavAirPressure", label: "Scavenge Air Pressure" },
    { key: "Exh_Cylinder_outlet", label: "Exh. Cylinder Outlet Temp" },
    { key: "Exh_T/C_inlet", label: "Exh. T/C Inlet Temp" },
    { key: "Exh_T/C_outlet", label: "Exh. T/C Outlet Temp" },
    { key: "FIPI", label: "Fuel Pump Index" },
  ],
};

// Add this RIGHT AFTER the imports and BEFORE const styles
// --- NEW COMPONENT: Multi-Select Dropdown ---
// --- NEW COMPONENT: Multi-Select Dropdown (Side Panel Layout) ---
const MultiSelectDropdown = ({ options, selectedIds, onChange, label }) => {
  const [isOpen, setIsOpen] = useState(false);
  const [activeYear, setActiveYear] = useState(null);
  const containerRef = React.useRef(null);

  // Group options by Year
  const groupedOptions = React.useMemo(() => {
    const groups = {};
    options.forEach((opt) => {
      const year = opt.report_date
        ? opt.report_date.substring(0, 4)
        : "Unknown";
      if (!groups[year]) groups[year] = [];
      groups[year].push(opt);
    });
    return groups;
  }, [options]);

  const sortedYears = Object.keys(groupedOptions).sort((a, b) => b - a);

  // Auto-select first year
  React.useEffect(() => {
    if (isOpen && !activeYear && sortedYears.length > 0) {
      setActiveYear(sortedYears[0]);
    }
  }, [isOpen, sortedYears]);

  // Click Outside
  React.useEffect(() => {
    const handleClickOutside = (event) => {
      if (
        containerRef.current &&
        !containerRef.current.contains(event.target)
      ) {
        setIsOpen(false);
      }
    };
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  const toggleOption = (id) => {
    let newSelected;
    if (selectedIds.includes(id)) {
      newSelected = selectedIds.filter((item) => item !== id);
    } else {
      newSelected = [...selectedIds, id];
    }
    onChange(newSelected);
  };

  return (
    <div
      ref={containerRef}
      style={{
        width: "100%",
        position: "relative",
        fontFamily: "Inter, sans-serif",
      }}
    >
      {/* --- TRIGGER BUTTON --- */}
      <div
        onClick={() => {
          if (!options.length) return;
          setIsOpen(!isOpen);
        }}
        style={{
          padding: "12px 16px",
          border: isOpen ? "2px solid #0f172a" : "1px solid #cbd5e1",
          borderRadius: "8px",
          backgroundColor: options.length ? "white" : "#f1f5f9",
          cursor: options.length ? "pointer" : "not-allowed",
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          fontSize: "0.95rem",
          color: "#334155",
          transition: "all 0.2s ease",
          boxShadow: "0 1px 2px rgba(0,0,0,0.05)",
          height: "42px", // Forces same height as Single Select
          boxSizing: "border-box", // Includes padding in height calculation
          overflow: "hidden", // Prevents any internal jump
        }}
      >
        <span
          style={{
            fontWeight: selectedIds.length > 0 ? "600" : "400",
            whiteSpace: "nowrap", // Prevents text from wrapping to new line
            overflow: "hidden", // Hides overflow
            textOverflow: "ellipsis", // Adds "..." if text is too long
            flex: 1, // Takes up available space
            marginRight: "8px", // Gap before the arrow
          }}
        >
          {options.length === 0
            ? "Loading..."
            : selectedIds.length === 0
              ? label
              : `${selectedIds.length} Selected`}
        </span>
        {/* CHANGED: Used standard Chevron Down (▼) and applied rotation class */}
        {/* UPDATED: Changed to Right Arrow (▶) with horizontal rotation */}
        <span
          style={{
            transition: "transform 0.2s ease",
            // 0deg points Right (▶), 180deg points Left (◀) when open
            transform: isOpen ? "rotate(180deg)" : "rotate(0deg)",
            display: "inline-block",
            fontSize: "0.85rem",
            color: "#94a3b8",
          }}
        >
          ▶
        </span>
      </div>

      {/* --- RIGHT-SIDE FLYOUT PANEL --- */}
      {isOpen && (
        <div
          style={{
            position: "absolute",
            top: 45,
            left: 0,
            // left: "102%",
            width: "400px",

            // 🔥 CHANGED HERE: Removed fixed height, added maxHeight & minHeight
            maxHeight: "320px", // Limits height (scrolls if > 5 reports)
            minHeight: "150px", // Ensures it doesn't look broken if empty

            backgroundColor: "white",
            border: "1px solid #e2e8f0",
            borderRadius: "8px",
            boxShadow:
              "0 20px 25px -5px rgba(0, 0, 0, 0.1), 0 10px 10px -5px rgba(0, 0, 0, 0.04)",
            zIndex: 100,
            display: "flex",
            overflow: "hidden",
          }}
        >
          {/* LEFT COLUMN: YEARS (25%) */}
          <div
            style={{
              width: "25%",
              backgroundColor: "#f8fafc",
              borderRight: "1px solid #e2e8f0",
              overflowY: "auto", // Scrolls independently if many years
              display: "flex",
              flexDirection: "column",
              scrollbarWidth: "thin",
              scrollbarColor: "#6b7280 #f1f1f1",
              maxHeight: "255px",
            }}
          >
            {sortedYears.map((year) => (
              <div
                key={year}
                onClick={(e) => {
                  e.stopPropagation();
                  setActiveYear(year);
                }}
                style={{
                  padding: "14px 12px",
                  cursor: "pointer",
                  fontSize: "0.95rem",
                  textAlign: "center",
                  fontWeight: activeYear === year ? "700" : "500",
                  color: activeYear === year ? "#0f172a" : "#64748b",
                  backgroundColor:
                    activeYear === year ? "white" : "transparent",
                  borderLeft:
                    activeYear === year
                      ? "3px solid #0f172a"
                      : "3px solid transparent",
                  borderBottom: "1px solid #e2e8f0",
                  transition: "background 0.2s",
                }}
              >
                {year}
              </div>
            ))}
          </div>

          {/* RIGHT COLUMN: REPORTS (75%) */}
          <div
  style={{
    flex: 1,
    overflowY: "auto",
    backgroundColor: "white",
    scrollbarWidth: "thin",
    scrollbarColor: "#6b7280 #f1f1f1",
    maxHeight: "230px",
  }}
>
            {activeYear && groupedOptions[activeYear] ? (
              <>
                <div
                  style={{
                    position: "sticky",
                    top: 0,
                    backgroundColor: "white",
                    zIndex: 10,
                    padding: "10px 16px",
                    fontSize: "0.75rem",
                    fontWeight: "700",
                    color: "#94a3b8",
                    textTransform: "uppercase",
                    borderBottom: "1px solid #f1f5f9",
                  }}
                >
                  {activeYear} Reports
                </div>
                {groupedOptions[activeYear].map((option) => (
                  <div
                    key={option.value}
                    onClick={() => toggleOption(option.value)}
                    style={{
                      padding: "12px 16px",
                      cursor: "pointer",
                      display: "flex",
                      alignItems: "center",
                      gap: "12px",
                      backgroundColor: selectedIds.includes(option.value)
                        ? "#f0f9ff"
                        : "white",
                      borderBottom: "1px solid #f1f5f9",
                    }}
                    onMouseEnter={(e) => {
                      if (!selectedIds.includes(option.value))
                        e.currentTarget.style.backgroundColor = "#f8fafc";
                    }}
                    onMouseLeave={(e) => {
                      if (!selectedIds.includes(option.value))
                        e.currentTarget.style.backgroundColor = "white";
                    }}
                  >
                    <input
                      type="checkbox"
                      checked={selectedIds.includes(option.value)}
                      readOnly
                      style={{
                        width: "16px",
                        height: "16px",
                        cursor: "pointer",
                        accentColor: "#0f172a",
                      }}
                    />
                    <div style={{ display: "flex", flexDirection: "column" }}>
                      <span
                        style={{
                          fontSize: "0.9rem",
                          fontWeight: 600,
                          color: "#334155",
                        }}
                      >
                        {option.label}
                      </span>
                      <span style={{ fontSize: "0.75rem", color: "#64748b" }}>
                        {option.subLabel}
                      </span>
                    </div>
                  </div>
                ))}
              </>
            ) : (
              <div
                style={{
                  padding: "30px",
                  textAlign: "center",
                  color: "#94a3b8",
                }}
              >
                Select a year.
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
};

// --- NEW COMPONENT: Single Select Dropdown (With Animation) ---
const SingleSelectDropdown = ({
  options,
  value,
  onChange,
  placeholder,
  disabled,
}) => {
  const [isOpen, setIsOpen] = React.useState(false);
  const containerRef = React.useRef(null);

  // Find the label for the currently selected value
  const selectedOption = options.find(
    (opt) => String(opt.value) === String(value),
  );

  // Close dropdown when clicking outside
  React.useEffect(() => {
    const handleClickOutside = (event) => {
      if (
        containerRef.current &&
        !containerRef.current.contains(event.target)
      ) {
        setIsOpen(false);
      }
    };
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  const DiagnosisPanel = ({ report, baseline, analysisMode }) => {
    const concerns = getDetectedConcerns(report, baseline, analysisMode);

    if (concerns.length === 0)
      return (
        <div
          className="enhanced-card"
          style={{
            marginBottom: "32px",
            borderLeft: "8px solid #16a34a",
            backgroundColor: "#f0fdf4",
            padding: "20px",
          }}
        >
          <div style={{ display: "flex", alignItems: "center", gap: "12px" }}>
            <span style={{ fontSize: "1.5rem" }}>✅</span>
            <span style={{ fontWeight: "700", color: "#166534" }}>
              No critical deviations detected for {report.displayName}. Engine
              parameters are within operational limits.
            </span>
          </div>
        </div>
      );

    return (
      <div
        className="enhanced-card"
        style={{ marginBottom: "32px", border: "1px solid #e2e8f0" }}
      >
        <div
          className="card-header-enhanced"
          style={{
            backgroundColor: "#fff7ed",
            borderBottom: "2px solid #ffedd5",
          }}
        >
          <h3
            className="card-title-enhanced"
            style={{
              color: "#9a3412",
              display: "flex",
              alignItems: "center",
              gap: "10px",
            }}
          >
            <span>🔍</span> Troubleshooting & Diagnosis Insights
          </h3>
          <p className="card-description-enhanced">
            Automated diagnosis based on {report.displayName} performance data
          </p>
        </div>

        <div
          className="card-content-enhanced"
          style={{ display: "flex", flexDirection: "column", gap: "16px" }}
        >
          {concerns.map((item, idx) => (
            <div
              key={idx}
              style={{
                borderRadius: "12px",
                border: `1.5px solid ${item.severity === "critical" ? "#fecdd3" : "#fde68a"}`,
                backgroundColor:
                  item.severity === "critical" ? "#fff1f2" : "#fffbeb",
                overflow: "hidden",
              }}
            >
              <div
                style={{
                  padding: "12px 16px",
                  backgroundColor:
                    item.severity === "critical" ? "#ffe4e6" : "#fef3c7",
                  display: "flex",
                  justifyContent: "space-between",
                  alignItems: "center",
                }}
              >
                <span
                  style={{
                    fontWeight: "800",
                    fontSize: "0.9rem",
                    color: item.severity === "critical" ? "#9f1239" : "#92400e",
                    textTransform: "uppercase",
                  }}
                >
                  {item.severity === "critical"
                    ? "🔴 CRITICAL FINDING"
                    : "🟡 WARNING"}{" "}
                  : {item.parameter}
                </span>
              </div>

              <div
                style={{
                  padding: "16px",
                  display: "grid",
                  gridTemplateColumns: "1fr 1fr",
                  gap: "20px",
                }}
              >
                <div>
                  <div style={{ marginBottom: "12px" }}>
                    <div
                      style={{
                        fontSize: "0.75rem",
                        fontWeight: "700",
                        color: "#64748b",
                        textTransform: "uppercase",
                        marginBottom: "4px",
                      }}
                    >
                      Observation
                    </div>
                    <div
                      style={{
                        fontSize: "0.95rem",
                        fontWeight: "600",
                        color: "#1e293b",
                      }}
                    >
                      {item.finding}
                    </div>
                  </div>
                  <div>
                    <div
                      style={{
                        fontSize: "0.75rem",
                        fontWeight: "700",
                        color: "#64748b",
                        textTransform: "uppercase",
                        marginBottom: "4px",
                      }}
                    >
                      Possible Causes
                    </div>
                    <ul
                      style={{
                        margin: 0,
                        paddingLeft: "18px",
                        color: "#475569",
                        fontSize: "0.9rem",
                      }}
                    >
                      {item.causes.map((c, i) => (
                        <li key={i} style={{ marginBottom: "2px" }}>
                          {c}
                        </li>
                      ))}
                    </ul>
                  </div>
                </div>

                <div
                  style={{
                    borderLeft: "1px solid rgba(0,0,0,0.05)",
                    paddingLeft: "20px",
                  }}
                >
                  <div
                    style={{
                      fontSize: "0.75rem",
                      fontWeight: "700",
                      color: "#64748b",
                      textTransform: "uppercase",
                      marginBottom: "8px",
                    }}
                  >
                    Diagnosis & Remedy
                  </div>
                  <div
                    style={{
                      backgroundColor: "white",
                      padding: "12px",
                      borderRadius: "8px",
                      fontSize: "0.9rem",
                      color: "#0f172a",
                      fontWeight: "500",
                      lineHeight: "1.5",
                      border: "1px solid rgba(0,0,0,0.05)",
                    }}
                  >
                    {item.remedy}
                  </div>
                </div>
              </div>
            </div>
          ))}
        </div>
      </div>
    );
  };

  return (
    <div
      ref={containerRef}
      style={{
        width: "100%",
        position: "relative",
        fontFamily: "Inter, sans-serif",
      }}
    >
      {/* TRIGGER AREA */}
      <div
        onClick={() => {
          if (!disabled) setIsOpen(!isOpen);
        }}
        style={{
          padding: "10px 12px",
          border: isOpen ? "2px solid #0f172a" : "1px solid #cbd5e1",
          borderRadius: "6px",
          backgroundColor: disabled ? "#f1f5f9" : "white",
          cursor: disabled ? "not-allowed" : "pointer",
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          fontSize: "0.9rem",
          color: "#334155",
          transition: "all 0.2s ease",
          minHeight: "42px",
          boxShadow: "0 1px 2px rgba(0,0,0,0.05)",
        }}
      >
        <span
          style={{
            fontWeight: "500",
            color: selectedOption ? "#1e293b" : "#94a3b8",
          }}
        >
          {selectedOption ? selectedOption.label : placeholder || "Select..."}
        </span>

        {/* ANIMATED CHEVRON */}
        <span className={`chevron-icon ${isOpen ? "open" : ""}`}>▼</span>
      </div>

      {/* DROPDOWN MENU */}
      {isOpen && !disabled && (
        <div
          style={{
            position: "absolute",
            top: "110%",
            left: 0,
            width: "100%",
            maxHeight: "240px",
            overflowY: "auto",
            backgroundColor: "white",
            border: "1px solid #e2e8f0",
            borderRadius: "6px",
            boxShadow: "0 10px 15px -3px rgba(0, 0, 0, 0.1)",
            zIndex: 250,
            padding: "12px 0",
          }}
        >
          {options.map((option) => (
            <div
              key={option.value}
              onClick={() => {
                onChange(option.value);
                setIsOpen(false);
              }}
              style={{
                padding: "10px 12px",
                cursor: "pointer",
                fontSize: "0.9rem",
                color:
                  String(value) === String(option.value)
                    ? "#0f172a"
                    : "#475569",
                backgroundColor:
                  String(value) === String(option.value) ? "#f1f5f9" : "white",
                fontWeight:
                  String(value) === String(option.value) ? "600" : "400",
                borderBottom: "1px solid #f8fafc",
              }}
              onMouseEnter={(e) => {
                if (String(value) !== String(option.value))
                  e.currentTarget.style.backgroundColor = "#f8fafc";
              }}
              onMouseLeave={(e) => {
                if (String(value) !== String(option.value))
                  e.currentTarget.style.backgroundColor = "white";
              }}
            >
              {option.label}
            </div>
          ))}
        </div>
      )}
    </div>
  );
};

const getDetectedConcerns = (report, baseline, analysisMode) => {
  if (!report || !baseline || Object.keys(baseline).length === 0) return [];

  const concerns = [];
  const isME = analysisMode === "mainEngine";

  // ─── Load for interpolation ───────────────────────────────────────────────
  const load = isME ? report.load : report.load_percentage;
  const xAxis = isME ? "load" : "load_percentage";

  // ─── Interpolate baseline at current load ─────────────────────────────────
  const getBase = (key) => interpolateBaseline(baseline, load, key, xAxis);

  // ─── Deviation helpers ────────────────────────────────────────────────────
  const pctDev = (actual, base) => {
    if (!base || base === 0 || actual == null || isNaN(actual)) return null;
    return ((actual - base) / base) * 100;
  };
  const absDelta = (actual, base) => {
    if (actual == null || base == null || isNaN(actual)) return null;
    return actual - base;
  };

  // ─── Cylinder imbalance helper (reads from cylinder_readings) ─────────────
  // Fires amber when any cyl deviates >±3 from ISO avg
  // Fires critical when any cyl deviates >±5 from ISO avg
  const checkCylinderImbalance = (cylKey, isoAvg) => {
    if (!report.cylinder_readings) return null;
    const amberCyls = [];
    const redCyls = [];
    Object.keys(report.cylinder_readings).forEach((cylNo) => {
      const val = Number(report.cylinder_readings[cylNo][cylKey] || 0);
      if (!val) return;
      const dev = Math.abs(val - isoAvg);
      if (dev > 5) redCyls.push(`Cyl ${cylNo}`);
      else if (dev > 3) amberCyls.push(`Cyl ${cylNo}`);
    });
    return {
      amber: amberCyls.length > 0 ? amberCyls.join(", ") : null,
      red: redCyls.length > 0 ? redCyls.join(", ") : null,
    };
  };

  // ─── NEW: Cylinder vs Shop Trial helper ───────────────────────────────────
  // Compares each cylinder's actual value against the interpolated shop trial
  // baseline value at current load. Amber >±3, Red >±5 (same thresholds).
  // cylKey     : key inside cylinder_readings (e.g. "pmax", "pcomp", "fuel_index", "exhaust_temp")
  // shopTrialVal: interpolated baseline value at current load for that parameter
  const checkCylinderVsShopTrial = (cylKey, shopTrialVal) => {
    if (!report.cylinder_readings || shopTrialVal == null) return null;
    const amberCyls = [];
    const redCyls = [];
    Object.keys(report.cylinder_readings).forEach((cylNo) => {
      const val = Number(report.cylinder_readings[cylNo][cylKey] || 0);
      if (!val) return;
      const dev = Math.abs(val - shopTrialVal);
      if (dev > 5) redCyls.push(`Cyl ${cylNo}`);
      else if (dev > 3) amberCyls.push(`Cyl ${cylNo}`);
    });
    return {
      amber: amberCyls.length > 0 ? amberCyls.join(", ") : null,
      red: redCyls.length > 0 ? redCyls.join(", ") : null,
    };
  };

  // ==========================================================================
  // SECTION 1 — ENGINE SPEED (ME only, Group A: ±3% amber / ±5% red)
  // ==========================================================================
  if (isME) {
    const engSpeedAct = Number(report.EngSpeed);
    const engSpeedBase = getBase("EngSpeed");
    const engSpeedPct = pctDev(engSpeedAct, engSpeedBase);

    if (engSpeedPct !== null && Math.abs(engSpeedPct) >= 3) {
      const isRed = Math.abs(engSpeedPct) > 5;
      concerns.push({
        parameter: "Engine Speed",
        severity: isRed ? "critical" : "warning",
        comparedAgainst: "Shop Trial",
        finding: `Engine speed deviated ${engSpeedPct > 0 ? "+" : ""}${engSpeedPct.toFixed(1)}% from baseline. Baseline: ${engSpeedBase?.toFixed(1)} rpm, Actual: ${engSpeedAct.toFixed(1)} rpm.`,
        causes: [
          "Governor malfunction or mis-calibration",
          "Fuel rack or linkage issue",
          "Speed sensor / tacho fault",
          "Engine overload or underload condition",
        ],
        remedy:
          "Check governor settings and fuel rack position. Verify tacho sensor calibration. Investigate load conditions.",
      });
    }
  }

  // ==========================================================================
  // SECTION 2 — TURBOCHARGER SPEED (ME only, Absolute: ±500 RPM amber / ±1000 RPM red)
  // ==========================================================================
  if (isME) {
    const turboAct = Number(report.Turbospeed);
    const turboBase = getBase("Turbospeed");
    const turboDelta = absDelta(turboAct, turboBase);

    if (turboDelta !== null && Math.abs(turboDelta) >= 500) {
      const isRed = Math.abs(turboDelta) >= 1000;
      concerns.push({
        parameter: "Turbocharger Speed",
        severity: isRed ? "critical" : "warning",
        comparedAgainst: "Shop Trial ",
        finding: `TC speed deviated ${turboDelta > 0 ? "+" : ""}${turboDelta.toFixed(0)} RPM from baseline. Baseline: ${turboBase?.toFixed(0)}, Actual: ${turboAct.toFixed(0)}.`,
        causes: [
          "Fouling of TC turbine or compressor blades",
          "Clogged or damaged nozzle ring",
          "TC bearing wear or deterioration",
          "Air filter blockage reducing airflow",
          "Exhaust gas leakage before TC",
        ],
        remedy:
          "Perform TC water washing (air and exhaust sides). Inspect nozzle ring for fouling or damage. Check TC bearings and air filter condition.",
      });
    }
  }

  // ==========================================================================
  // SECTION 3 — PCOMP (Group A: ±3% amber / ±5% red + Cylinder imbalance)
  // ==========================================================================
  const pcompKey = isME ? "Pcomp" : "Pcomp";
  const pcompAct = Number(report.Pcomp);
  const pcompBase = getBase("Pcomp");
  const pcompPct = pctDev(pcompAct, pcompBase);

  // 3a. Average deviation vs baseline
  if (pcompPct !== null && Math.abs(pcompPct) >= 3) {
    const isRed = Math.abs(pcompPct) > 5;
    concerns.push({
      parameter: "Pcomp (Average)",
      severity: isRed ? "critical" : "warning",
      comparedAgainst: "Shop Trial",
      finding: `Average Pcomp deviated ${pcompPct > 0 ? "+" : ""}${pcompPct.toFixed(1)}% from baseline. Baseline: ${pcompBase?.toFixed(1)} bar, Actual: ${pcompAct.toFixed(1)} bar.`,
      causes: [
        "Blow-by via leaking piston rings",
        "Burnt or eroded piston crown",
        "Worn cylinder liner",
        "Leaking or stuck exhaust valve",
        "Poor scavenge air pressure",
        isME ? "HCU malfunction (ME engines)" : "Fuel timing issue",
        "Piston rod stuffing box leakage",
      ],
      remedy: isME
        ? "Check exhaust valve timing and damper arrangement. Inspect piston rings and liner. Overhaul stuffing box if air emitted from check funnel."
        : "Check exhaust valve condition and timing. Inspect piston rings and cylinder liner for wear.",
    });
  }

  // 3b. Cylinder imbalance vs ISO average (existing check — unchanged)
  if (report.cylinder_readings) {
    const pcompImbal = checkCylinderImbalance("pcomp", pcompAct);
    if (pcompImbal?.red) {
      concerns.push({
        parameter: "Pcomp Balance (Cylinder)",
        severity: "critical",
        comparedAgainst: "ISO Average (Report Cylinders)",
        finding: `${pcompImbal.red} deviate >±5 bar from ISO average Pcomp (${pcompAct.toFixed(1)} bar). Engine is severely imbalanced.`,
        causes: [
          "Leaking piston rings on affected cylinders",
          "Burnt piston crown on affected cylinders",
          "Worn cylinder liner on affected units",
          "Leaking exhaust valve on affected cylinders",
        ],
        remedy:
          "Carry out scavenge port inspection on affected cylinders. Check piston crown with template. Measure liner wear. Inspect exhaust valve seats.",
      });
    } else if (pcompImbal?.amber) {
      concerns.push({
        parameter: "Pcomp Balance (Cylinder)",
        severity: "warning",
        comparedAgainst: "ISO Average (Report Cylinders)",
        finding: `${pcompImbal.amber} deviate >±3 bar from ISO average Pcomp (${pcompAct.toFixed(1)} bar). Monitor closely for developing imbalance.`,
        causes: [
          "Early-stage piston ring wear",
          "Developing exhaust valve leak",
          "Minor liner wear on affected cylinders",
        ],
        remedy:
          "Monitor at next opportunity. Plan scavenge port inspection. Check exhaust valve stroke on affected cylinders.",
      });
    }

    // 3c. NEW — Cylinder vs Shop Trial for Pcomp
    const pcompShopVal = pcompBase; // interpolated shop trial value at current load
    const pcompShopImbal = checkCylinderVsShopTrial("pcomp", pcompShopVal);
    if (pcompShopImbal?.red) {
      concerns.push({
        parameter: "Pcomp Balance vs Shop Trial (Cylinder)",
        severity: "critical",
        comparedAgainst: "Shop Trial (Per Cylinder)",
        finding: `${pcompShopImbal.red} deviate >±5 bar from Shop Trial Pcomp (${pcompShopVal?.toFixed(1)} bar). Individual cylinder performance significantly below trial condition.`,
        causes: [
          "Severe piston ring blow-by on affected cylinders",
          "Burnt or eroded piston crown on affected cylinders",
          "Significant liner wear on affected units",
          "Leaking exhaust valve on affected cylinders",
        ],
        remedy:
          "Carry out scavenge port inspection on affected cylinders. Compare with ISO average imbalance to identify if it is a single-cylinder or engine-wide issue.",
      });
    } else if (pcompShopImbal?.amber) {
      concerns.push({
        parameter: "Pcomp Balance vs Shop Trial (Cylinder)",
        severity: "warning",
        comparedAgainst: "Shop Trial (Per Cylinder)",
        finding: `${pcompShopImbal.amber} deviate >±3 bar from Shop Trial Pcomp (${pcompShopVal?.toFixed(1)} bar). Developing deviation from original trial condition.`,
        causes: [
          "Early-stage piston ring wear on affected cylinders",
          "Minor liner wear developing",
        ],
        remedy:
          "Monitor at next opportunity. Plan scavenge port inspection on affected cylinders.",
      });
    }
  }

  // ==========================================================================
  // SECTION 4 — PMAX (Group A: ±3% amber / ±5% red + Cylinder imbalance +
  //              Injection diagnosis: High/Low/Both with Pcomp cross-check)
  // ==========================================================================
  const pmaxAct = Number(report.Pmax);
  const pmaxBase = getBase("Pmax");
  const pmaxPct = pctDev(pmaxAct, pmaxBase);

  // 4a. Average deviation vs baseline with injection diagnosis
  if (pmaxPct !== null && Math.abs(pmaxPct) >= 3) {
    const isRed = Math.abs(pmaxPct) > 5;

    // Cross-check Pcomp to determine injection pattern
    const pcompNormal = pcompPct !== null && Math.abs(pcompPct) <= 2;
    const pcompAlsoLow = pcompPct !== null && pcompPct < -3;

    let finding = "";
    let causes = [];
    let remedy = "";

    if (pmaxPct > 3 && pcompNormal) {
      finding = `Pmax is ${pmaxPct.toFixed(1)}% above baseline while Pcomp is normal. Indicates early injection timing. Baseline: ${pmaxBase?.toFixed(1)} bar, Actual: ${pmaxAct.toFixed(1)} bar.`;
      causes = [
        "Too early fuel injection timing",
        "Incorrect VIT-index setting",
        "HCU timing fault (ME engines)",
      ];
      remedy =
        "Check VIT-index calibration. If in order, reduce the fuel pump lead.";
    } else if (pmaxPct < -3 && pcompNormal) {
      finding = `Pmax is ${Math.abs(pmaxPct).toFixed(1)}% below baseline while Pcomp is normal. Indicates retarded injection timing. Baseline: ${pmaxBase?.toFixed(1)} bar, Actual: ${pmaxAct.toFixed(1)} bar.`;
      causes = [
        "Delayed fuel injection timing",
        "Poor fuel ignition quality (low CCAI)",
        "Leaking or worn injector nozzles",
        "Low fuel pressure at engine",
      ];
      remedy =
        "Check fuel pressure after filter. Check VIT-index. Increase fuel pump lead if fuel quality is poor. Pressure test fuel valves.";
    } else if (pmaxPct < -3 && pcompAlsoLow) {
      finding = `Both Pmax (${pmaxPct.toFixed(1)}%) and Pcomp (${pcompPct?.toFixed(1)}%) are below baseline. Indicates significant mechanical or thermal loss.`;
      causes = [
        "Piston ring blow-by",
        "Leaking exhaust valve",
        "Increased combustion space (burnt piston crown)",
        "Fouling of exhaust or air system",
      ];
      remedy =
        "Inspect piston rings and exhaust valve seats. Check for system fouling. Perform compression test.";
    } else {
      finding = `Pmax deviated ${pmaxPct > 0 ? "+" : ""}${pmaxPct.toFixed(1)}% from baseline. Baseline: ${pmaxBase?.toFixed(1)} bar, Actual: ${pmaxAct.toFixed(1)} bar.`;
      causes = [
        "Fuel injection equipment wear",
        "Injection timing drift",
        "VIT / HCU malfunction",
      ];
      remedy =
        "Pressure test fuel valves. Verify fuel pump lead and VIT adjustment.";
    }

    concerns.push({
      parameter: "Pmax (Average)",
      severity: isRed ? "critical" : "warning",
      comparedAgainst: "Shop Trial",
      finding,
      causes,
      remedy,
    });
  }

  // 4b. Cylinder imbalance vs ISO average (existing check — unchanged)
  if (report.cylinder_readings) {
    const pmaxImbal = checkCylinderImbalance("pmax", pmaxAct);
    if (pmaxImbal?.red) {
      concerns.push({
        parameter: "Pmax Balance (Cylinder)",
        severity: "critical",
        comparedAgainst: "ISO Average (Report Cylinders)",
        finding: `${pmaxImbal.red} deviate >±5 bar from ISO average Pmax (${pmaxAct.toFixed(1)} bar). Injection severely imbalanced.`,
        causes: [
          "Fuel injection timing error on affected cylinders",
          "Worn fuel pumps or fuel valves on affected units",
          "Malfunction of HCU or tacho system",
          "Blocked or leaking fuel nozzle",
        ],
        remedy:
          "Pressure test fuel valves on affected cylinders. Verify fuel pump lead and VIT adjustment. Check HCU operation.",
      });
    } else if (pmaxImbal?.amber) {
      concerns.push({
        parameter: "Pmax Balance (Cylinder)",
        severity: "warning",
        comparedAgainst: "ISO Average (Report Cylinders)",
        finding: `${pmaxImbal.amber} deviate >±3 bar from ISO average Pmax (${pmaxAct.toFixed(1)} bar). Monitor for developing injection imbalance.`,
        causes: [
          "Early-stage fuel valve wear on affected cylinders",
          "Minor injection timing drift",
        ],
        remedy:
          "Monitor at next opportunity. Plan fuel valve pressure test on affected cylinders.",
      });
    }

    // 4c. NEW — Cylinder vs Shop Trial for Pmax
    const pmaxShopVal = pmaxBase;
    const pmaxShopImbal = checkCylinderVsShopTrial("pmax", pmaxShopVal);
    if (pmaxShopImbal?.red) {
      concerns.push({
        parameter: "Pmax Balance vs Shop Trial (Cylinder)",
        severity: "critical",
        comparedAgainst: "Shop Trial (Per Cylinder)",
        finding: `${pmaxShopImbal.red} deviate >±5 bar from Shop Trial Pmax (${pmaxShopVal?.toFixed(1)} bar). Injection performance significantly below trial condition.`,
        causes: [
          "Worn or fouled fuel injectors on affected cylinders",
          "Significant injection timing drift on affected units",
          "Worn fuel pump elements on affected cylinders",
          "HCU or tacho fault on affected units",
        ],
        remedy:
          "Pressure test fuel valves on affected cylinders. Compare with ISO average imbalance to determine if engine-wide or cylinder-specific issue.",
      });
    } else if (pmaxShopImbal?.amber) {
      concerns.push({
        parameter: "Pmax Balance vs Shop Trial (Cylinder)",
        severity: "warning",
        comparedAgainst: "Shop Trial (Per Cylinder)",
        finding: `${pmaxShopImbal.amber} deviate >±3 bar from Shop Trial Pmax (${pmaxShopVal?.toFixed(1)} bar). Developing injection deviation from original trial condition.`,
        causes: [
          "Early-stage fuel valve wear on affected cylinders",
          "Minor injection timing drift developing",
        ],
        remedy:
          "Monitor at next opportunity. Plan fuel valve pressure test on affected cylinders.",
      });
    }
  }

  // ==========================================================================
  // SECTION 5 — PRESSURE RISE (Pmax − Pcomp) — kept as bonus engineering check
  // ==========================================================================
  if (pmaxAct && pcompAct) {
    const pRise = pmaxAct - pcompAct;
    if (pRise > 40) {
      concerns.push({
        parameter: "Pressure Rise (Pmax − Pcomp)",
        severity: "critical",
        comparedAgainst: "Fixed Engineering Limit (40 bar max)",
        finding: `Pressure rise is ${pRise.toFixed(1)} bar (Limit: 40 bar). Excessive thermal load on engine components.`,
        causes: ["Advanced injection timing", "VIT / HCU malfunction"],
        remedy:
          "Reduce fuel pump lead immediately. Verify VIT and HCU settings. Monitor closely to prevent component damage.",
      });
    } else if (load > 75 && pRise < 20) {
      concerns.push({
        parameter: "Pressure Rise (Pmax − Pcomp)",
        severity: "warning",
        comparedAgainst: "Fixed Engineering Limit (20 bar min at >75% load)",
        finding: `Pressure rise is only ${pRise.toFixed(1)} bar at ${load?.toFixed(1)}% load (Expected: >20 bar). Poor combustion performance.`,
        causes: [
          "Delayed ignition",
          "Extremely poor fuel combustion properties",
        ],
        remedy:
          "Expect high fuel consumption. Check fuel characteristics (CCAI). Increase fuel pump lead.",
      });
    }
  }

  // ==========================================================================
  // SECTION 6 — SCAVENGE AIR PRESSURE
  // ME key: ScavAir  (Group B: ±5% amber / ±10% red)
  // AE key: ScavAirPressure  (Group B: ±5% amber / ±10% red)
  // ==========================================================================
  const scavKey = isME ? "ScavAir" : "ScavAirPressure";
  const scavAct = Number(isME ? report.ScavAir : report.ScavAirPressure);
  const scavBase = getBase(scavKey);
  const scavPct = pctDev(scavAct, scavBase);

  if (scavPct !== null && Math.abs(scavPct) >= 5) {
    const isRed = Math.abs(scavPct) > 10;
    concerns.push({
      parameter: "Scavenge Air Pressure",
      severity: isRed ? "critical" : "warning",
      comparedAgainst: "Shop Trial",
      finding: `Scavenge air pressure deviated ${scavPct > 0 ? "+" : ""}${scavPct.toFixed(1)}% from baseline. Baseline: ${scavBase?.toFixed(3)}, Actual: ${scavAct.toFixed(3)} ${isME ? "kg/cm²" : "bar"}.`,
      causes: [
        "TC underperformance due to fouling",
        "Fouled or blocked air cooler (air side)",
        "Blocked TC air filter elements",
        "Air leakage in scavenge system",
        "TC nozzle ring blockage",
      ],
      remedy:
        "Perform TC water washing. Clean air cooler air side. Check and clean TC air filter. Inspect scavenge system for leaks.",
    });
  }

  // ME only: Scavenge vs Exhaust receiver logic check (bonus check)
  if (isME) {
    const exhRec = Number(report.exhaust_gas_receiver_pressure_kg_cm2);
    if (scavAct && exhRec && scavAct <= exhRec) {
      concerns.push({
        parameter: "Scavenge vs Exhaust Logic",
        severity: "critical",
        comparedAgainst:
          "Fixed Engineering Limit (Scav must exceed Exh Receiver)",
        finding:
          "Scavenge pressure is NOT greater than exhaust receiver pressure. This relationship must always hold.",
        causes: [
          "Incorrect measurement or manometer failure",
          "Severe TC nozzle ring fouling",
          "Exhaust system obstruction",
        ],
        remedy:
          "Verify U-tube manometers. Inspect TC nozzle ring for fouling. Check exhaust system for obstructions.",
      });
    }
  }

  // ==========================================================================
  // SECTION 7 — EXHAUST TEMPERATURES
  // All three keys: Exh_T/C_inlet, Exh_T/C_outlet, Exh_Cylinder_outlet
  // Rule: ±40°C amber / ±60°C red (absolute delta — same for ME and AE)
  // ==========================================================================
  const exhaustParams = [
    {
      key: "Exh_T/C_inlet",
      label: "Exh. T/C Inlet Temperature",
      unit: "°C",
    },
    {
      key: "Exh_T/C_outlet",
      label: "Exh. T/C Outlet Temperature",
      unit: "°C",
    },
    {
      key: "Exh_Cylinder_outlet",
      label: "Exh. Cylinder Outlet Temperature",
      unit: "°C",
    },
  ];

  exhaustParams.forEach(({ key, label }) => {
    const exhAct = Number(report[key]);
    const exhBase = getBase(key);
    const delta = absDelta(exhAct, exhBase);

    if (delta !== null && Math.abs(delta) >= 40) {
      const isRed = Math.abs(delta) > 60;
      concerns.push({
        parameter: label,
        severity: isRed ? "critical" : "warning",
        comparedAgainst: "Shop Trial ",
        finding: `${label} increased by ${delta > 0 ? "+" : ""}${delta.toFixed(1)}°C from baseline. Baseline: ${exhBase?.toFixed(1)}°C, Actual: ${exhAct.toFixed(1)}°C.`,
        causes: [
          "Worn or leaking fuel pumps / fuel valves",
          "Fouled air cooler (air or water side)",
          "TC turbine side fouling reducing airflow",
          "Poor fuel quality affecting combustion",
          key === "Exh_T/C_inlet"
            ? "Increased exhaust gas temperature from cylinders"
            : key === "Exh_T/C_outlet"
              ? "TC turbine efficiency loss"
              : "Individual cylinder combustion problem",
        ],
        remedy:
          "Pressure test fuel valves. Inspect air cooler air and water sides. Perform TC turbine water washing. Check fuel oil specifications.",
      });
    }
  });

  // Exh Cylinder Outlet — cylinder-level imbalance vs ISO average (existing — unchanged)
  if (report.cylinder_readings) {
    const exhCylAct = Number(report.Exh_Cylinder_outlet);
    const exhImbal = checkCylinderImbalance("exhaust_temp", exhCylAct);
    if (exhImbal?.red) {
      concerns.push({
        parameter: "Exh. Cyl. Outlet Balance (Cylinder)",
        severity: "critical",
        comparedAgainst: "ISO Average (Report Cylinders)",
        finding: `${exhImbal.red} deviate >±5°C from ISO average exhaust temperature (${exhCylAct.toFixed(1)}°C). Combustion severely imbalanced.`,
        causes: [
          "Worn or stuck fuel injector on affected cylinders",
          "Incorrect fuel injection timing on affected units",
          "Exhaust valve leakage on affected cylinders",
          "Poor scavenging of affected cylinders",
        ],
        remedy:
          "Pressure test and overhaul fuel injectors on affected cylinders. Check exhaust valve condition. Inspect scavenge ports on affected units.",
      });
    } else if (exhImbal?.amber) {
      concerns.push({
        parameter: "Exh. Cyl. Outlet Balance (Cylinder)",
        severity: "warning",
        comparedAgainst: "ISO Average (Report Cylinders)",
        finding: `${exhImbal.amber} deviate >±3°C from ISO average exhaust temperature (${exhCylAct.toFixed(1)}°C). Monitor for developing combustion imbalance.`,
        causes: [
          "Early-stage fuel injector wear on affected cylinders",
          "Minor injection timing drift",
        ],
        remedy:
          "Monitor at next opportunity. Plan fuel injector check on affected cylinders.",
      });
    }

    // NEW — Cylinder vs Shop Trial for Exh Cylinder Outlet
    const exhCylShopVal = getBase("Exh_Cylinder_outlet");
    const exhShopImbal = checkCylinderVsShopTrial(
      "exhaust_temp",
      exhCylShopVal,
    );
    if (exhShopImbal?.red) {
      concerns.push({
        parameter: "Exh. Cyl. Outlet vs Shop Trial (Cylinder)",
        severity: "critical",
        comparedAgainst: "Shop Trial (Per Cylinder)",
        finding: `${exhShopImbal.red} deviate >±5°C from Shop Trial exhaust temperature (${exhCylShopVal?.toFixed(1)}°C). Combustion significantly deteriorated from trial condition.`,
        causes: [
          "Severely worn or stuck fuel injector on affected cylinders",
          "Significant injection timing deterioration on affected units",
          "Exhaust valve leakage on affected cylinders",
          "Poor scavenging of affected cylinders",
        ],
        remedy:
          "Pressure test and overhaul fuel injectors on affected cylinders. Compare with ISO imbalance check to identify if engine-wide or cylinder-specific.",
      });
    } else if (exhShopImbal?.amber) {
      concerns.push({
        parameter: "Exh. Cyl. Outlet vs Shop Trial (Cylinder)",
        severity: "warning",
        comparedAgainst: "Shop Trial(Per Cylinder)",
        finding: `${exhShopImbal.amber} deviate >±3°C from Shop Trial exhaust temperature (${exhCylShopVal?.toFixed(1)}°C). Developing deviation from original trial condition.`,
        causes: [
          "Early-stage injector wear on affected cylinders",
          "Minor injection timing drift developing",
        ],
        remedy:
          "Monitor at next opportunity. Plan fuel injector check on affected cylinders.",
      });
    }
  }

  // ==========================================================================
  // SECTION 8 — FUEL PUMP INDEX (FIPI)
  // Group B: ±5% amber / ±10% red (same for ME and AE)
  // Also: cylinder-level imbalance check
  // ==========================================================================
  const fipiAct = Number(report.FIPI);
  const fipiBase = getBase("FIPI");
  const fipiPct = pctDev(fipiAct, fipiBase);

  if (fipiPct !== null && Math.abs(fipiPct) >= 5) {
    const isRed = Math.abs(fipiPct) > 10;
    concerns.push({
      parameter: "Fuel Pump Index (FIPI)",
      severity: isRed ? "critical" : "warning",
      comparedAgainst: "Shop Trial",
      finding: `FIPI deviated ${fipiPct > 0 ? "+" : ""}${fipiPct.toFixed(1)}% from baseline. Baseline: ${fipiBase?.toFixed(2)} mm, Actual: ${fipiAct.toFixed(2)} mm.`,
      causes: [
        "Worn fuel pump plunger and barrel",
        "Internal leakage in fuel pumps",
        "Increased fuel viscosity",
        "Fuel valve needle wear causing leakage",
      ],
      remedy: isRed
        ? "Overhaul fuel pumps immediately. Pressure test all fuel valves. Check fuel oil viscosity."
        : "Plan fuel pump inspection. Pressure test fuel valves. Monitor at next report.",
    });
  }

  // FIPI cylinder-level imbalance vs ISO average (existing — unchanged)
  if (report.cylinder_readings) {
    const fipiImbal = checkCylinderImbalance("fuel_index", fipiAct);
    if (fipiImbal?.red) {
      concerns.push({
        parameter: "Fuel Index Balance (Cylinder)",
        severity: "critical",
        comparedAgainst: "ISO Average (Report Cylinders)",
        finding: `${fipiImbal.red} deviate >±5 mm from ISO average fuel index (${fipiAct.toFixed(2)} mm). Fuel distribution severely imbalanced.`,
        causes: [
          "Worn fuel pump elements on affected cylinders",
          "Sticking fuel pump plunger on affected units",
          "Fuel linkage / rack sticking",
        ],
        remedy:
          "Overhaul fuel pumps on affected cylinders. Check and free fuel rack linkage. Verify equal fuel distribution.",
      });
    } else if (fipiImbal?.amber) {
      concerns.push({
        parameter: "Fuel Index Balance (Cylinder)",
        severity: "warning",
        comparedAgainst: "ISO Average (Report Cylinders)",
        finding: `${fipiImbal.amber} deviate >±3 mm from ISO average fuel index (${fipiAct.toFixed(2)} mm). Fuel distribution imbalance developing.`,
        causes: [
          "Early-stage fuel pump wear on affected cylinders",
          "Minor fuel rack sticking",
        ],
        remedy:
          "Monitor at next opportunity. Plan fuel pump inspection on affected cylinders.",
      });
    }

    // NEW — Cylinder vs Shop Trial for FIPI
    const fipiShopVal = fipiBase;
    const fipiShopImbal = checkCylinderVsShopTrial("fuel_index", fipiShopVal);
    if (fipiShopImbal?.red) {
      concerns.push({
        parameter: "Fuel Index vs Shop Trial (Cylinder)",
        severity: "critical",
        comparedAgainst: "Shop Trial (Per Cylinder)",
        finding: `${fipiShopImbal.red} deviate >±5 mm from Shop Trial fuel index (${fipiShopVal?.toFixed(2)} mm). Fuel pump delivery significantly deteriorated from trial condition.`,
        causes: [
          "Severely worn fuel pump elements on affected cylinders",
          "Sticking fuel pump plunger on affected units",
          "Fuel rack linkage issue on affected cylinders",
        ],
        remedy:
          "Overhaul fuel pumps on affected cylinders. Check and free fuel rack linkage. Compare with ISO imbalance check.",
      });
    } else if (fipiShopImbal?.amber) {
      concerns.push({
        parameter: "Fuel Index vs Shop Trial (Cylinder)",
        severity: "warning",
        comparedAgainst: "Shop Trial (Per Cylinder)",
        finding: `${fipiShopImbal.amber} deviate >±3 mm from Shop Trial fuel index (${fipiShopVal?.toFixed(2)} mm). Developing deviation from original trial condition.`,
        causes: [
          "Early-stage fuel pump wear on affected cylinders",
          "Minor fuel rack sticking developing",
        ],
        remedy:
          "Monitor at next opportunity. Plan fuel pump inspection on affected cylinders.",
      });
    }
  }

  // ==========================================================================
  // SECTION 9 — SFOC (ME only, Group B: ±5% amber / ±10% red)
  // ==========================================================================
  if (isME) {
    const sfocAct = Number(report.SFOC);
    const sfocBase = getBase("SFOC");
    const sfocPct = pctDev(sfocAct, sfocBase);

    if (sfocPct !== null && Math.abs(sfocPct) >= 5) {
      const isRed = Math.abs(sfocPct) > 10;
      concerns.push({
        parameter: "SFOC",
        severity: isRed ? "critical" : "warning",
        comparedAgainst: "Shop Trial ",
        finding: `SFOC deviated ${sfocPct > 0 ? "+" : ""}${sfocPct.toFixed(1)}% from baseline. Baseline: ${sfocBase?.toFixed(1)} g/kWh, Actual: ${sfocAct.toFixed(1)} g/kWh.`,
        causes: [
          "Poor fuel oil quality (low calorific value)",
          "Worn or leaking fuel injectors",
          "Air system fouling (TC, air cooler, filter)",
          "Injection timing retardation",
          "Scavenge system inefficiency",
          "Engine running in heavy propeller condition",
        ],
        remedy: isRed
          ? "Urgently check fuel oil specifications. Pressure test all injectors. Perform TC water washing. Review injection timing."
          : "Check fuel oil calorific value. Inspect injectors. Perform TC water washing. Monitor trends.",
      });
    }
  }

  // ==========================================================================
  // SECTION 10 — POWER MARGIN / PROPELLER MARGIN (ME only)
  // Rule: 0→+5% amber (heavy running) / >+5% red (overload)
  // ==========================================================================
  if (isME) {
    let rawMargin = report.propeller_margin_percent;

    if (rawMargin !== undefined && rawMargin !== null) {
      let propDev = Math.abs(rawMargin) > 50 ? rawMargin - 100 : rawMargin;

      if (propDev >= 0) {
        const isRed = propDev > 5;
        concerns.push({
          parameter: "Power Margin (Propeller)",
          severity: isRed ? "critical" : "warning",
          comparedAgainst: "Service Propeller Curve",
          finding: `Engine is running ${propDev.toFixed(1)}% above the service propeller curve. ${isRed ? "Heavy running overload detected." : "Approaching heavy running condition."}`,
          causes: [
            "Hull fouling increasing resistance",
            "Propeller fouling or damage",
            "Shallow water or restricted channel effect",
            "Adverse weather or heavy sea conditions",
            "Propeller pitch change or damage",
          ],
          remedy: isRed
            ? "Reduce speed if possible. Inspect propeller at next opportunity. Plan hull cleaning. Check propeller pitch."
            : "Monitor closely. Plan hull and propeller inspection. Review speed-power curve.",
        });
      }
    }
  }

  // ==========================================================================
  // SECTION 11 — TC EXTENDED CHECKS (ME only, kept as bonus engineering checks)
  // ==========================================================================
  if (isME) {
    // TC Efficiency (Compressor and Turbine)
    ["TC_Compressor_Eff", "TC_Turbine_Eff"].forEach((key) => {
      const eff = Number(report[key]);
      if (eff > 0 && eff < 100) {
        const dev = 100 - eff;
        if (dev >= 3) {
          concerns.push({
            parameter: key.replace(/_/g, " "),
            severity: dev >= 5 ? "critical" : "warning",
            comparedAgainst:
              "Fixed Engineering Reference (100% ideal efficiency)",
            finding: `${key.includes("Compressor") ? "Compressor" : "Turbine"} efficiency dropped by ${dev.toFixed(1)}%.`,
            causes: [
              "Fouling of turbine or compressor blades",
              "Clogged nozzle ring",
            ],
            remedy:
              "Perform TC water washing. Inspect nozzle ring for blockage.",
          });
        }
      }
    });

    // TC LO Inlet Pressure (1.5 – 2.2 bar)
    const loPress = Number(report.tc_lo_inlet_pressure_bar);
    if (loPress > 0 && (loPress < 1.5 || loPress > 2.2)) {
      concerns.push({
        parameter: "TC LO Inlet Pressure",
        severity: "critical",
        comparedAgainst: "Fixed Engineering Limit (1.5 – 2.2 bar)",
        finding: `TC LO pressure is ${loPress} bar. Allowed range: 1.5 – 2.2 bar.`,
        causes: ["LO system regulation failure", "Pump issue"],
        remedy: "Adjust TC LO inlet pressure to 1.5 – 2.2 bar immediately.",
      });
    }

    // TC Back Pressure > 300 mmWC
    const backPress = Number(report.tc_turbine_outlet_pressure_mmwc);
    if (backPress > 300) {
      concerns.push({
        parameter: "TC Back Pressure",
        severity: "critical",
        comparedAgainst: "Fixed Engineering Limit (300 mmWC max)",
        finding: `Turbine outlet pressure is ${backPress} mmWC (Limit: 300 mmWC).`,
        causes: [
          "Blockage in exhaust pipe",
          "Clogged nozzle ring",
          "Economizer or scrubber obstruction",
        ],
        remedy:
          "Inspect exhaust piping and economizer or funnel for obstructions.",
      });
    }

    // TC Air Filter ΔP > 150% of baseline
    const filterDP = Number(report.tc_air_filter_diff_pressure_mmwc);
    const filterBase = getBase("tc_air_filter_diff_pressure_mmwc");
    if (filterDP && filterBase && filterDP > filterBase * 1.5) {
      concerns.push({
        parameter: "TC Air Filter ΔP",
        severity: "warning",
        comparedAgainst: "Shop Trial (150% threshold)",
        finding: `Air filter pressure drop is more than 50% higher than baseline.`,
        causes: ["Fouled filter elements"],
        remedy: "TC filter elements must be cleaned or replaced.",
      });
    }

    // Air Cooler ΔP > 240 mmWC
    const coolerDP = Number(report.scav_air_cooler_diff_pressure_mmwc);
    if (coolerDP > 240) {
      concerns.push({
        parameter: "Air Cooler ΔP",
        severity: "critical",
        comparedAgainst: "Fixed Engineering Limit (240 mmWC max)",
        finding: `Air cooler pressure drop is ${coolerDP} mmWC (Limit: 240 mmWC).`,
        causes: ["Clogged air side elements", "Fouling from oily mist"],
        remedy: "Air cooler is clogged. Clean air side immediately.",
      });
    }

    // Air Cooler ΔT (Air Out – Water In > 14°C)
    const airOut = Number(report.scav_air_temp_after_cooler_c);
    const waterIn = Number(report.scav_air_cooler_cw_in_temp_c);
    if (airOut && waterIn && airOut - waterIn > 14) {
      concerns.push({
        parameter: "Air Cooler Cooling Ability (ΔT)",
        severity: "critical",
        comparedAgainst: "Fixed Engineering Limit (14°C max ΔT)",
        finding: `Air outlet – cooling water inlet is ${(airOut - waterIn).toFixed(1)}°C (Limit: 14°C).`,
        causes: ["Fouled water side pathways", "Low cooling water flow"],
        remedy: "Cooling efficiency impacted. Clean water side of air cooler.",
      });
    }
  }

  return concerns;
};
const DiagnosisPanel = ({ report, baseline, analysisMode }) => {
  const [isExpanded, setIsExpanded] = useState(true);
  const concerns = getDetectedConcerns(report, baseline, analysisMode);

  if (concerns.length === 0)
    return (
      <div
        className="enhanced-card"
        style={{
          marginBottom: "32px",
          borderLeft: "8px solid #16a34a",
          backgroundColor: "#f0fdf4",
          padding: "20px",
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: "12px" }}>
          <span style={{ fontSize: "1.5rem" }}>✅</span>
          <span style={{ fontWeight: "700", color: "#166534" }}>
            All analyzed parameters for {report.displayName} are within safety
            and performance limits.
          </span>
        </div>
      </div>
    );

  return (
    <div
      className="enhanced-card diagnosis-card"
      style={{
        marginBottom: "32px",
        border: "1px solid #e2e8f0",
        overflow: "hidden",
      }}
    >
      <div
        onClick={() => setIsExpanded(!isExpanded)}
        style={{
          backgroundColor: "#fff7ed",
          borderBottom: isExpanded ? "2px solid #ffedd5" : "none",
          padding: "14px 24px",
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          cursor: "pointer",
        }}
      >
        <h3
          className="card-title-enhanced"
          style={{
            color: "#9a3412",
            margin: 0,
            display: "flex",
            alignItems: "center",
            gap: "12px",
            fontSize: "1.1rem",
          }}
        >
          <span style={{ fontSize: "1.4rem" }}>🔍</span> Troubleshooting &
          Diagnosis Insights ({concerns.length} Findings)
        </h3>
        <span
          style={{
            fontSize: "1.2rem",
            color: "#9a3412",
            transition: "transform 0.3s ease",
            transform: isExpanded ? "rotate(180deg)" : "rotate(0deg)",
          }}
        >
          ▼
        </span>
      </div>

      {isExpanded && (
        <div className="card-content-enhanced" style={{ padding: "24px" }}>
          {/* --- WRAPPER FOR SCROLLING --- */}
          <div className="diagnosis-scroll-container">
            {concerns.map((item, idx) => (
              <div
                key={idx}
                style={{
                  borderRadius: "10px",
                  border: `1.5px solid ${item.severity === "critical" ? "#fecdd3" : "#fde68a"}`,
                  overflow: "hidden",
                  boxShadow: "0 2px 4px rgba(0,0,0,0.03)",
                  flexShrink: 0,
                }}
              >
                {/* ── CARD HEADER: severity + parameter + comparedAgainst badge ── */}
                <div
                  style={{
                    padding: "8px 16px",
                    backgroundColor:
                      item.severity === "critical" ? "#fff1f2" : "#fffbeb",
                    borderBottom: `1px solid ${item.severity === "critical" ? "#fecdd3" : "#fde68a"}`,
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "space-between",
                    gap: "12px",
                  }}
                >
                  {/* Left: severity + parameter name */}
                  <span
                    style={{
                      fontWeight: "900",
                      fontSize: "0.85rem",
                      color:
                        item.severity === "critical" ? "#9f1239" : "#92400e",
                      textTransform: "uppercase",
                    }}
                  >
                    {item.severity}: {item.parameter}
                  </span>

                  {/* Right: comparedAgainst badge */}
                  {item.comparedAgainst && (
                    <span
                      style={{
                        fontSize: "0.65rem",
                        fontWeight: "700",
                        color: "#64748b",
                        backgroundColor: "#f1f5f9",
                        border: "1px solid #e2e8f0",
                        borderRadius: "4px",
                        padding: "2px 8px",
                        textTransform: "uppercase",
                        letterSpacing: "0.03em",
                        whiteSpace: "nowrap",
                        flexShrink: 0,
                      }}
                    >
                      vs {item.comparedAgainst}
                    </span>
                  )}
                </div>

                <div
                  style={{
                    display: "grid",
                    gridTemplateColumns: "1.2fr 1fr 1fr",
                    backgroundColor: "white",
                  }}
                >
                  {/* HEADERS */}
                  <div
                    style={{
                      gridColumn: "1 / -1",
                      display: "grid",
                      gridTemplateColumns: "1.2fr 1fr 1fr",
                      backgroundColor: "#f8fafc",
                      borderBottom: "1px solid #e2e8f0",
                    }}
                  >
                    <div
                      style={{
                        padding: "6px 16px",
                        fontSize: "0.65rem",
                        fontWeight: "800",
                        color: "#64748b",
                        textTransform: "uppercase",
                      }}
                    >
                      Observation
                    </div>
                    <div
                      style={{
                        padding: "6px 16px",
                        fontSize: "0.65rem",
                        fontWeight: "800",
                        color: "#64748b",
                        textTransform: "uppercase",
                        borderLeft: "1px solid #e2e8f0",
                      }}
                    >
                      Possible Causes
                    </div>
                    <div
                      style={{
                        padding: "6px 16px",
                        fontSize: "0.65rem",
                        fontWeight: "800",
                        color: "#64748b",
                        textTransform: "uppercase",
                        borderLeft: "1px solid #e2e8f0",
                      }}
                    >
                      Diagnosis & Remedy
                    </div>
                  </div>

                  {/* DATA */}
                  <div
                    style={{
                      padding: "16px",
                      fontSize: "0.9rem",
                      fontWeight: "700",
                      color: "#1e293b",
                      lineHeight: "1.4",
                    }}
                  >
                    {item.finding}
                  </div>
                  <div
                    style={{ padding: "16px", borderLeft: "1px solid #e2e8f0" }}
                  >
                    <ul
                      style={{
                        margin: 0,
                        paddingLeft: "14px",
                        color: "#475569",
                        fontSize: "0.85rem",
                        fontWeight: "500",
                      }}
                    >
                      {item.causes.map((c, i) => (
                        <li key={i} style={{ marginBottom: "2px" }}>
                          {c}
                        </li>
                      ))}
                    </ul>
                  </div>
                  <div
                    style={{
                      padding: "16px",
                      borderLeft: "1px solid #e2e8f0",
                      backgroundColor: "#f0f9ff",
                    }}
                  >
                    <div
                      style={{
                        color: "#0369a1",
                        fontSize: "0.85rem",
                        fontWeight: "600",
                        lineHeight: "1.5",
                      }}
                    >
                      {item.remedy}
                    </div>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
};
// --- NEW COMPONENT: Raw Report Download Dropdown (Click to Download) ---
// --- UPDATED COMPONENT: Raw Report Download Dropdown (Centered Modal) ---
// --- UPDATED COMPONENT: Raw Report Download Dropdown (Flyout Style) ---
const RawDownloadDropdown = ({ options, onDownload, label }) => {
  const [isOpen, setIsOpen] = useState(false);
  const [activeYear, setActiveYear] = useState(null);
  const containerRef = React.useRef(null);

  // Group options by Year
  const groupedOptions = React.useMemo(() => {
    const groups = {};
    options.forEach((opt) => {
      const year = opt.report_date
        ? opt.report_date.substring(0, 4)
        : "Unknown";
      if (!groups[year]) groups[year] = [];
      groups[year].push(opt);
    });
    return groups;
  }, [options]);

  const sortedYears = Object.keys(groupedOptions).sort((a, b) => b - a);

  // Auto-select first year
  React.useEffect(() => {
    if (isOpen && !activeYear && sortedYears.length > 0) {
      setActiveYear(sortedYears[0]);
    }
  }, [isOpen, sortedYears]);

  // Click Outside
  React.useEffect(() => {
    const handleClickOutside = (event) => {
      if (
        containerRef.current &&
        !containerRef.current.contains(event.target)
      ) {
        setIsOpen(false);
      }
    };
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  return (
    <div
      ref={containerRef}
      style={{
        width: "100%",
        position: "relative",
        fontFamily: "Inter, sans-serif",
      }}
    >
      {/* --- TRIGGER BUTTON --- */}
      <div
        onClick={() => {
          if (options.length) setIsOpen(!isOpen);
        }}
        style={{
          padding: "12px 16px",
          border: isOpen ? "2px solid #0f172a" : "1px solid #cbd5e1",
          borderRadius: "8px",
          backgroundColor: options.length ? "white" : "#f1f5f9",
          cursor: options.length ? "pointer" : "not-allowed",
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          fontSize: "0.95rem",
          color: "#334155",
          transition: "all 0.2s ease",
          boxShadow: "0 1px 2px rgba(0,0,0,0.05)",
        }}
      >
        <span style={{ fontWeight: "500" }}>
          {options.length === 0 ? "No Reports Available" : label}
        </span>

        {/* Right Arrow Icon (▶) with Rotation */}
        <span
          style={{
            transition: "transform 0.2s ease",
            transform: isOpen ? "rotate(180deg)" : "rotate(0deg)",
            display: "inline-block",
            fontSize: "0.85rem",
            color: "#94a3b8",
          }}
        >
          ▶
        </span>
      </div>

      {/* --- RIGHT-SIDE FLYOUT PANEL (Matches Select Reports) --- */}
      {isOpen && (
        <div
          style={{
            position: "absolute",
            top: 0,
            left: "102%", // Opens to the right
            width: "480px",
            maxHeight: "255px",
            minHeight: "150px",
            backgroundColor: "white",
            border: "1px solid #e2e8f0",
            borderRadius: "8px",
            boxShadow:
              "0 20px 25px -5px rgba(0, 0, 0, 0.1), 0 10px 10px -5px rgba(0, 0, 0, 0.04)",
            zIndex: 100, // High zIndex to float over adjacent content
            display: "flex",
            overflow: "hidden",
          }}
        >
          {/* LEFT COLUMN: YEARS (25%) */}
          <div
  style={{
    width: "25%",
    backgroundColor: "#f8fafc",
    borderRight: "1px solid #e2e8f0",
    overflowY: "auto",
    display: "flex",
    flexDirection: "column",
    scrollbarWidth: "thin",
    scrollbarColor: "#94a3b8 #f1f5f9",
    maxHeight: "230px",
  }}
>
            {sortedYears.map((year) => (
              <div
                key={year}
                onClick={(e) => {
                  e.stopPropagation();
                  setActiveYear(year);
                }}
                style={{
                  padding: "14px 12px",
                  cursor: "pointer",
                  fontSize: "0.95rem",
                  textAlign: "center",
                  fontWeight: activeYear === year ? "700" : "500",
                  color: activeYear === year ? "#0f172a" : "#64748b",
                  backgroundColor:
                    activeYear === year ? "white" : "transparent",
                  borderLeft:
                    activeYear === year
                      ? "3px solid #0f172a"
                      : "3px solid transparent",
                  borderBottom: "1px solid #e2e8f0",
                  transition: "background 0.2s",
                }}
              >
                {year}
              </div>
            ))}
          </div>

          {/* RIGHT COLUMN: REPORTS (75%) */}
          <div
            style={{
              flex: 1,
              overflowY: "auto",
              backgroundColor: "white",
            }}
          >
            {activeYear && groupedOptions[activeYear] ? (
              <>
                <div
                  style={{
                    position: "sticky",
                    top: 0,
                    backgroundColor: "white",
                    zIndex: 10,
                    padding: "10px 16px",
                    fontSize: "0.75rem",
                    fontWeight: "700",
                    color: "#94a3b8",
                    textTransform: "uppercase",
                    borderBottom: "1px solid #f1f5f9",
                  }}
                >
                  {activeYear} Reports
                </div>
                {groupedOptions[activeYear].map((option) => (
                  <div
                    key={option.value}
                    onClick={() => {
                      onDownload(option.value);
                      setIsOpen(false);
                    }}
                    style={{
                      padding: "12px 16px",
                      cursor: "pointer",
                      display: "flex",
                      alignItems: "center",
                      gap: "12px",
                      borderBottom: "1px solid #f1f5f9",
                      transition: "background 0.2s",
                    }}
                    onMouseEnter={(e) =>
                      (e.currentTarget.style.backgroundColor = "#f0f9ff")
                    }
                    onMouseLeave={(e) =>
                      (e.currentTarget.style.backgroundColor = "white")
                    }
                  >
                    <span style={{ fontSize: "1.1rem" }}>📥</span>
                    <div style={{ display: "flex", flexDirection: "column" }}>
                      <span
                        style={{
                          fontSize: "0.9rem",
                          fontWeight: 600,
                          color: "#334155",
                        }}
                      >
                        {option.label}
                      </span>
                      <span style={{ fontSize: "0.75rem", color: "#64748b" }}>
                        {option.subLabel}
                      </span>
                    </div>
                  </div>
                ))}
              </>
            ) : (
              <div
                style={{
                  padding: "30px",
                  textAlign: "center",
                  color: "#94a3b8",
                }}
              >
                Select a year.
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
};
const safeFixed = (val, digits = 2) => {
  if (val === null || val === undefined || isNaN(val)) return "N/A";
  return Number(val).toFixed(digits);
};
function formatVesselName(name) {
  /**
   * Removes prefixes like 'MV', 'M.V.', 'M.V', 'M/V' from vessel names.
   * Example:
   *   'MV AM UMANG'   -> 'AM UMANG'
   *   'M.V.GCL TAPI'  -> 'GCL TAPI'
   */

  if (!name) {
    return null;
  }

  return name.replace(/^(?:MV|M\.V\.|M\.V|M\/V)\s*/i, "").trim();
}
// 🔥 NEW FUNCTION: Format date nicely
const formatReportDate = (dateString) => {
  if (!dateString) return "No report yet";

  const date = new Date(dateString);
  const options = {
    day: "numeric",
    month: "long",
    year: "numeric",
  };
  return date.toLocaleDateString("en-US", options);
  // Output: "20 April 2025"
};

// Enhanced CSS styles
const styles = `
    .performance-container {
      padding: 32px;
      background: linear-gradient(to bottom, #f8fafc 0%, #ffffff 100%);
      min-height: 100vh;
    }

    .performance-header {
      margin-bottom: 40px;

    }

    .performance-title {
      font-size: 2.0rem;
      font-weight: 800;
      background: linear-gradient(135deg, #07070aff 0%, #091c3bff 100%);
      -webkit-background-clip: text;
      -webkit-text-fill-color: transparent;
      background-clip: text;
      margin-bottom: 12px;
      letter-spacing: -0.02em;
    }

    .performance-subtitle {
      color: #64748b;
      font-size: 1.125rem;
      font-weight: 500;
      line-height: 1.6;
    }

    .controls-container {
      display: flex;
      gap: 16px;
      flex-wrap: wrap;
      padding: 24px;
      background: white;
      border-radius: 16px;
      box-shadow: 0 4px 6px -1px rgba(0, 0, 0, 0.1), 0 2px 4px -1px rgba(0, 0, 0, 0.06);
      border: 1px solid #e2e8f0;
      margin-bottom: 32px;
      max-width: 1200px;       /* <--- ADD THIS to keep it neat */
      margin-left: auto;       /* <--- ADD THIS for horizontal centering */
      margin-right: auto;  
    }

    .enhanced-card {
      background: white;
      border-radius: 16px;
      box-shadow: 0 10px 15px -3px rgba(0, 0, 0, 0.1), 0 4px 6px -2px rgba(0, 0, 0, 0.05);
      border: 1px solid #e2e8f0;
      overflow: hidden;
    }

    .card-header-enhanced {
      padding: 24px 28px 20px;
      border-bottom: 2px solid #f1f5f9;
      background: linear-gradient(to bottom, #ffffff 0%, #f8fafc 100%);
    }

    .card-title-enhanced {
      font-size: 1.25rem;
      font-weight: 700;
      color: #1e293b;
      margin-bottom: 8px;
      letter-spacing: -0.01em;
    }

    .card-description-enhanced {
      font-size: 0.9rem;
      color: #64748b;
      font-weight: 500;
    }

    .card-content-enhanced {
      padding: 28px;
    }

    .summary-table-enhanced {
      width: 100%;
      border-collapse: separate;
      border-spacing: 0;
      font-size: 0.95rem;
    }

    .summary-table-enhanced thead tr {
      background: linear-gradient(135deg, #e2e8f0 0%, #cbd5e1 100%);
    }

    .summary-table-enhanced th {
      padding: 16px 12px;
      text-align: left;
      font-weight: 700;
      color: #334155;
      text-transform: uppercase;
      font-size: 0.8rem;
      letter-spacing: 0.05em;
      border-bottom: 3px solid #94a3b8;
    }

    .summary-table-enhanced th:nth-child(2),
    .summary-table-enhanced th:nth-child(3),
    .summary-table-enhanced th:nth-child(4),
    .summary-table-enhanced th:nth-child(5) {
      text-align: right;
    }

    .summary-table-enhanced tbody tr {
      transition: background-color 0.2s ease;
    }

    .summary-table-enhanced tbody tr:hover {
      background-color: #f8fafc;
    }

    .summary-table-enhanced td {
      padding: 14px 12px;
      border-bottom: 1px solid #e2e8f0;
      color: #475569;
    }

    .summary-table-enhanced td:first-child {
      font-weight: 600;
      color: #1e293b;
    }

    .summary-table-enhanced td:nth-child(2),
    .summary-table-enhanced td:nth-child(3),
    .summary-table-enhanced td:nth-child(4),
    .summary-table-enhanced td:nth-child(5) {
      text-align: right;
      font-variant-numeric: tabular-nums;
    }

    .charts-grid-enhanced {
      display: grid;
      grid-template-columns: repeat(2, 1fr); 
      gap: 40px; /* Increased gap for better visual separation */
      margin-top: 32px;
    }

    .chart-card {
      width: 100%;
      max-width: 650px;                      /* 🔥 Limits width so it doesn't look stretched */
      margin: 0 auto;
    }

    .info-cards-grid {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(320px, 1fr));
      gap: 24px;
      margin-top: 32px;
    }

    .info-row {
      display: flex;
      justify-content: space-between;
      align-items: center;
      padding: 12px 0;
      border-bottom: 1px solid #f1f5f9;
    }

    .info-row:last-child {
      border-bottom: none;
    }
  
    .info-label {
      color: #64748b;
      font-weight: 500;
      font-size: 0.95rem;
    }

    .info-value {
      font-weight: 700;
      color: #1e293b;
      font-size: 1.05rem;
      font-variant-numeric: tabular-nums;
    }

    .load-diagram-enhanced {
      margin-bottom: 32px;
    }

    .load-diagram-data-table-enhanced {
      margin-top: 28px;
      padding: 24px;
      background: linear-gradient(to bottom, #f8fafc 0%, #ffffff 100%);
      border-radius: 12px;
      border: 2px solid #e2e8f0;
    }

    .load-diagram-table-title {
      font-size: 1.1rem;
      font-weight: 700;
      margin-bottom: 16px;
      color: #1e293b;
      letter-spacing: -0.01em;
    }

    .load-diagram-table {
      width: 100%;
      border-collapse: separate;
      border-spacing: 0;
      font-size: 0.9rem;
    }

    .load-diagram-table thead tr {
      background: linear-gradient(to right, #e2e8f0 0%, #cbd5e1 100%);
    }

    .load-diagram-table th {
      padding: 12px 16px;
      text-align: left;
      font-weight: 700;
      color: #334155;
      text-transform: uppercase;
      font-size: 0.75rem;
      letter-spacing: 0.05em;
      border-bottom: 2px solid #94a3b8;
    }

    .load-diagram-table th:nth-child(2) {
      text-align: right;
    }

    .load-diagram-table tbody tr {
      background-color: white;
      transition: background-color 0.2s ease;
    }

    .load-diagram-table tbody tr:hover {
      background-color: #f8fafc;
    }

    .load-diagram-table td {
      padding: 12px 16px;
      border-bottom: 1px solid #e2e8f0;
    }

    .load-diagram-table td:first-child {
      font-weight: 600;
      color: #475569;
    }

    .load-diagram-table td:nth-child(2) {
      text-align: right;
      font-weight: 700;
      font-variant-numeric: tabular-nums;
    }

    .load-diagram-table td:nth-child(3) {
      color: #64748b;
      font-weight: 500;
    }

    .highlighted-row {
      background-color: #dbeafe !important;
    }

    .warning-row {
      background-color: #fef3c7 !important;
    }

    .success-row {
      background-color: #d1fae5 !important;
    }

    .error-row {
      background-color: #fee2e2 !important;
    }



    @media (max-width: 768px) {
      .performance-container {
        padding: 16px;
      }

      .performance-title { 
        font-size: 1.875rem;
      }

      .charts-grid-enhanced {
        grid-template-columns: 1fr;
      }

      .chart-card {
        max-width: 800px;                    /* Wider on single column */
      }

      .info-cards-grid {
        grid-template-columns: 1fr;
      }
    }
      /* ... existing styles ... */

    .pdf-loading-overlay {
      position: fixed;
      top: 0;
      left: 0;
      width: 100vw;
      height: 100vh;
      background-color:  #ffffff;
      z-index: 999999;
      display: flex;
      flex-direction: column;
      align-items: center;
      justify-content: center;
      backdrop-filter: blur(5px);
    }

    .pdf-spinner {
      width: 50px;
      height: 50px;
      border: 5px solid #e2e8f0;
      border-top: 5px solid #091c3b;
      border-radius: 50%;
      animation: spin 1s linear infinite;
      margin-bottom: 20px;
    }

    .pdf-loading-text {
      font-size: 1.2rem;
      font-weight: 600;
      color: #1e293b;
    }

    /* ... existing styles ... */

    /* --- NEW GRID LAYOUT STYLES --- */
    .controls-grid {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(320px, 1fr));
      gap: 24px;
      margin-bottom: 32px;
      width: 100%;
      max-width: 1400px;
      margin-left: auto;
      margin-right: auto;
      align-items: start; /* Prevents cards from stretching vertically */
    }

    .control-card-header {
      background: white;
      padding: 20px;
      border-radius: 16px;
      border: 1px solid #e2e8f0;
      box-shadow: 0 4px 6px -1px rgba(0, 0, 0, 0.1);
      display: flex;
      flex-direction: column;
      gap: 16px;
      /* Ensure height adapts to content */
      height: auto; 
      animation: fadeIn 0.5s ease-out;
    }

    .control-card-title {
      font-size: 0.9rem;
      font-weight: 800;
      color: #475569;
      text-transform: uppercase;
      letter-spacing: 0.05em;
      border-bottom: 2px solid #f1f5f9;
      padding-bottom: 10px;
    }

    .control-row {
      display: flex;
      flex-wrap: wrap;
      gap: 12px;
      align-items: center;
    }

    .controls-container { display: none; }
    /* --- REFINED MATRIX STYLES (Wider & Matched Headers) --- */
    .matrix-scroll-container {
      overflow-x: auto;
      width: 100%;
      border-top: 1px solid #cbd5e1; /* Matched border color */
      border-bottom: 1px solid #e2e8f0;
      background: white;
    }

    .matrix-table {
      border-collapse: separate; 
      border-spacing: 0;
      width: 100%; /* Forces table to fill the card */
    }

    /* --- STICKY COLUMN 1: PARAMETER --- */
    .matrix-sticky-col-1 {
      position: sticky;
      left: 0;
      z-index: 20;
      background-color: #f8fafc; /* Body background */
      
      /* Borders for Body Cells */
      border-right: 1px solid #cbd5e1;
      border-bottom: 1px solid #e2e8f0;
      
      /* INCREASED WIDTH */
      width: 220px; 
      min-width: 220px;
      max-width: 220px;
      
      font-size: 0.85rem;
      color: #334155;
    }

    /* --- STICKY COLUMN 2: BASELINE --- */
    .matrix-sticky-col-2 {
      position: sticky;
      /* Must match Col 1 Width */
      left: 220px; 
      z-index: 20;
      background-color: #f8fafc; /* Body background */
      
      /* Borders for Body Cells */
      border-right: 2px solid #64748b; /* Strong separator */
      border-bottom: 1px solid #e2e8f0;
      
      /* INCREASED WIDTH */
      width: 150px; 
      min-width: 150px;
      
      box-shadow: 4px 0 6px -4px rgba(0,0,0,0.1);
    }

    /* --- HEADER OVERRIDES (Match "Nov 2025" Style) --- */
    thead .matrix-sticky-col-1, 
    thead .matrix-sticky-col-2 {
      z-index: 30; 
      /* CHANGED: Match the light grey of the Date Header */
      background-color: #f1f5f9; 
      color: #1e293b;
      
      font-weight: 700;
      font-size: 0.9rem;
      text-transform: uppercase;
      
      /* Center and Vertically Align */
      text-align: center !important;
      vertical-align: middle;
      
      /* Match Borders */
      border-bottom: 1px solid #cbd5e1;
      border-right: 1px solid #cbd5e1; 
      border-top: none;
      padding: 12px 8px;
    }

    /* Data Cells */
    .matrix-data-cell {
      text-align: right;
      padding: 12px 8px; 
      border-bottom: 1px solid #f1f5f9;
      font-variant-numeric: tabular-nums;
      font-size: 0.85rem;
      white-space: nowrap;
    }
    
    /* Date Header (e.g. "Nov 2025") */
    .matrix-group-header {
      text-align: center !important;
      vertical-align: middle;
      background-color: #f1f5f9; /* Same BG as sticky */
      color: #1e293b;
      font-weight: 700;
      font-size: 0.9rem;
      padding: 10px 4px;
      
      border-left: 1px solid #cbd5e1;
      border-bottom: 1px solid #cbd5e1;
    }
    
    /* Sub-Headers (ISO, Delta, %) */
    .matrix-sub-header {
      font-size: 0.75rem;
      color: #64748b;
      background-color: #f8fafc;
      text-align: right;
      padding: 8px 6px;
      border-bottom: 1px solid #94a3b8; /* Stronger divider for data start */
      font-weight: 600;
    } 

    /* --- NEW MASTER CARD LAYOUT --- */
  .control-master-card {
    background: white;
    border-radius: 16px;
    border: 1px solid #e2e8f0;
    margin-bottom: 32px;
    margin-left: auto;
    margin-right: auto;
    display: flex;
    flex-direction: column;
    width: 100%;
  }

  .control-panel-body {
    display: flex;
    min-height: 400px; /* Ensures consistent height */
  }

  /* LEFT PANEL (Navigation) */
  .control-left-panel {
    width: 280px;
    flex-shrink: 0;
    background-color: #f8fafc;
    border-right: 1px solid #e2e8f0;
    padding: 24px;
    display: flex;
    flex-direction: column;
  }

  /* RIGHT PANEL (Content) */
  .control-right-panel {
    flex-grow: 1;
    padding: 32px;
    background-color: #ffffff;
    display: flex;
    flex-direction: column;
    animation: fadeIn 0.3s ease-in-out;
  }

  /* TOGGLE BUTTONS */
  .action-toggle-container {
    display: flex;
    flex-direction: column;
    gap: 12px;
    margin-top: 24px;
  }

  .action-btn {
    text-align: left;
    padding: 12px 16px;
    border-radius: 8px;
    border: 1px solid transparent;
    font-weight: 600;
    cursor: pointer;
    transition: all 0.2s;
    display: flex;
    justify-content: space-between;
    align-items: center;
    font-size: 0.95rem;
  }

  .action-btn.active {
    background-color: #0f172a;
    color: white;
    box-shadow: 0 4px 6px -1px rgba(0, 0, 0, 0.1);
  }

  .action-btn.inactive {
    background-color: white;
    color: #64748b;
    border: 1px solid #cbd5e1;
  }

  .action-btn.inactive:hover {
    background-color: #e2e8f0;
    color: #1e293b;
    border-color: #94a3b8;
  }

  .panel-section-title {
    font-size: 1.1rem;
    font-weight: 700;
    color: #1e293b;
    margin-bottom: 20px;
    padding-bottom: 10px;
    border-bottom: 2px solid #f1f5f9;
  }

  /* Ensure the popup doesn't get cut off by container overflow */
  .recharts-wrapper {
    overflow: visible !important;
  }

  .performance-popup-card {
    background: white !important;
    padding: 12px;
    border-radius: 8px;
    box-shadow: 0 10px 15px -3px rgba(0, 0, 0, 0.2), 0 4px 6px -2px rgba(0, 0, 0, 0.1);
    font-family: 'Inter', sans-serif;
    border: 1px solid #e2e8f0;
    display: flex;
    flex-direction: column;
    gap: 4px;
  }
      

  /* Responsive */
  @media (max-width: 768px) {
    .control-panel-body { flex-direction: column; }
    .control-left-panel { width: 100%; border-right: none; border-bottom: 1px solid #e2e8f0; }
  }

    @keyframes spin {
      0% { transform: rotate(0deg); }
      100% { transform: rotate(360deg); }
    }

    /* REMOVE ALL FOCUS OUTLINES FROM CHARTS */
    .recharts-wrapper, 
    .recharts-surface, 
    .recharts-layer, 
    .recharts-layer *, 
    svg, 
    g, 
    path, 
    circle {
      outline: none !important;
      -webkit-tap-highlight-color: transparent; /* Fixes mobile blue highlight */
    }

    svg:focus, g:focus, .recharts-wrapper:focus {
      outline: none !important;
    }
      /* ENSURE FOREIGN OBJECT CONTENT IS ALWAYS OPAQUE */
    foreignObject div {
      background-color: white !important;
      background: white !important;
      opacity: 1 !important;
    }

    /* Prevent parent Recharts layers from forcing transparency */
    .recharts-reference-dot {
      opacity: 1 !important;
    }
      .diagnosis-collapse-btn {
      cursor: pointer;
      background: none;
      border: none;
      font-size: 1.2rem;
      color: #94a3b8;
      transition: transform 0.3s ease;
      padding: 8px;
      display: flex;
      align-items: center;
      justify-content: center;
    }

    .diagnosis-collapse-btn.is-open {
      transform: rotate(180deg);
    }
    /* Add this inside the const styles backticks */
    .diagnosis-scroll-container {
      max-height: 360px; /* This height comfortably shows 2 findings */
      overflow-y: auto;
      padding-right: 12px;
      display: flex;
      flex-direction: column;
      gap: 20px;
      scrollbar-gutter: stable; /* Prevents layout shift when scrollbar appears */
    }

    /* Professional Slim Scrollbar styling */
    .diagnosis-scroll-container::-webkit-scrollbar {
      width: 8px;
    }
    .diagnosis-scroll-container::-webkit-scrollbar-track {
      background: #f1f5f9;
      border-radius: 10px;
    }
    .diagnosis-scroll-container::-webkit-scrollbar-thumb {
      background: #cbd5e1;
      border-radius: 10px;
      border: 2px solid #f1f5f9;
    }
    .diagnosis-scroll-container::-webkit-scrollbar-thumb:hover {
      background: #94a3b8;
    }
  `;

// Inject styles
if (
  typeof document !== "undefined" &&
  !document.getElementById("performance-enhanced-styles")
) {
  const styleSheet = document.createElement("style");
  styleSheet.id = "performance-enhanced-styles";
  styleSheet.textContent = styles;
  document.head.appendChild(styleSheet);
}

// Metric mappings
const MAIN_METRIC_MAPPING = {
  FIPI: "fuel_inj_pump_index_mm",
  Pmax: "max_combustion_pressure_bar",
  Pcomp: "compression_pressure_bar",
  ScavAir: "scav_air_pressure_kg_cm2",
  "Exh_T/C_inlet": "exh_temp_tc_inlet_c",
  "Exh_T/C_outlet": "exh_temp_tc_outlet_c",
  Turbospeed: "turbocharger_speed_x1000_rpm",
  SFOC: "sfoc_g_kwh",
  EngSpeed: "engine_speed_rpm",
  Exh_Cylinder_outlet: "cyl_exhaust_gas_temp_outlet_c",
  // "FOC": "fuel_consumption_total_kg_h"
};

// const AUX_METRIC_MAPPING = {
//   "FIPI": "fuel_pump_index_graph",
//   "Pmax": "pmax_graph_bar",
//   "ScavAirPressure": "scav_air_pressure_bar",
//   "Exh_Cylinder_outlet": "exh_temp_cyl_outlet_avg_graph_c",
//   "Exh_T/C_inlet": "exh_temp_tc_inlet_graph_c",
//   "Exh_T/C_outlet": "exh_temp_tc_outlet_graph_c",
// };
const AUX_METRIC_MAPPING = {
  FIPI: "fuel_pump_index_graph",
  Pmax: "pmax_graph_bar",
  ScavAirPressure: "scav_air_pressure_bar",
  Exh_Cylinder_outlet: "exh_temp_cyl_outlet_avg_graph_c",
  "Exh_T/C_inlet": "exh_temp_tc_inlet_graph_c",
  "Exh_T/C_outlet": "exh_temp_tc_outlet_graph_c",
};

// --- NEW HELPER: Fuzzy Search for Metric Values (Matches AEPerformanceOverview logic) ---
const findValueInPoint = (point, targetKey) => {
  // 1. Exact Match
  if (point[targetKey] !== undefined && point[targetKey] !== null)
    return point[targetKey];

  // 2. Normalized Match (remove underscores, spaces, lowercase)
  const normalize = (k) => k.toLowerCase().replace(/_/g, "").replace(/ /g, "");
  const target = normalize(targetKey);

  const foundKey = Object.keys(point).find((k) => normalize(k) === target);
  if (foundKey && point[foundKey] !== undefined && point[foundKey] !== null) {
    return point[foundKey];
  }

  // 3. Specific Fallbacks for AE keys (Bridging Backend History Variable Names to Frontend Mappings)

  // Pmax
  if (target.includes("pmax") && point["max_combustion_pressure_bar"] != null)
    return point["max_combustion_pressure_bar"];

  // Scav Air
  if (target.includes("scav") && point["boost_air_pressure_graph_bar"] != null)
    return point["boost_air_pressure_graph_bar"];
  if (target.includes("scav") && point["scav_air_pressure_bar"] != null)
    return point["scav_air_pressure_bar"];

  // Fuel Index
  if (target.includes("fuel") && point["fuel_rack_position_mm"] != null)
    return point["fuel_rack_position_mm"];
  if (target.includes("fuel") && point["fuel_pump_index_graph"] != null)
    return point["fuel_pump_index_graph"];

  // SFOC
  if (target.includes("sfoc") && point["sfoc_g_kwh"] != null)
    return point["sfoc_g_kwh"];

  // --- 🔥 NEW: Temperature Fallbacks (Fixes TC In/Out Issues) ---

  // TC Inlet (Frontend: exh_temp_tc_inlet... vs Backend: exhaust_gas_temp_before_tc_c)
  if (target.includes("inlet") && point["exhaust_gas_temp_before_tc_c"] != null)
    return point["exhaust_gas_temp_before_tc_c"];

  // TC Outlet (Frontend: exh_temp_tc_outlet... vs Backend: exhaust_gas_temp_after_tc_c)
  if (
    target.includes("outlet") &&
    !target.includes("cyl") &&
    point["exhaust_gas_temp_after_tc_c"] != null
  )
    return point["exhaust_gas_temp_after_tc_c"];

  // Cyl Outlet (Frontend: exh_temp_cyl... vs Backend: exh_temp_cyl...)
  if (
    target.includes("cyl") &&
    point["exh_temp_cyl_outlet_avg_graph_c"] != null
  )
    return point["exh_temp_cyl_outlet_avg_graph_c"];

  return null;
};

// Helper functions
const getMetricUnit = (metricKey, isAux = false) => {
  if (isAux) {
    const units = {
      Pmax: "Bar",
      ScavAirPressure: "Bar",
      "Exh_T/C_inlet": "°C",
      Exh_Cylinder_outlet: "°C",
      "Exh_T/C_outlet": "°C",
      FIPI: "mm",
      SFOC: "g/kWh",
      FOC: "kg/h",
    };
    if (AUX_METRIC_MAPPING.hasOwnProperty(metricKey)) {
      return units[metricKey] || "";
    }
    return "";
  } else {
    const units = {
      SFOC: "g/kWh",
      Pmax: "bar",
      Pcomp: "bar",
      Turbospeed: "RPM",
      EngSpeed: "RPM",
      ScavAir: "kg/cm²",
      "Exh_T/C_inlet": "°C",
      Exh_Cylinder_outlet: "°C",
      "Exh_T/C_outlet": "°C",
      FIPI: "mm",
      FOC: "kg/h",
    };
    return units[metricKey] || "";
  }
};

const getMonthColor = (month) => {
  const monthColorMap = {
    "01": "#dc2626",
    "02": "#2563eb",
    "03": "#16a34a",
    "04": "#ca8a04",
    "05": "#9333ea",
    "06": "#c2410c",
    "07": "#059669",
    "08": "#7c3aed",
    "09": "#db2777",
    10: "#0891b2",
    11: "#65a30d",
    12: "#dc2626",
  };
  if (!month) return "#dc2626";
  const monthNum = month.split("-")[1];
  return monthColorMap[monthNum] || "#dc2626";
};

const getMonthDisplayName = (month) => {
  const monthNames = {
    "01": "Jan",
    "02": "Feb",
    "03": "Mar",
    "04": "Apr",
    "05": "May",
    "06": "Jun",
    "07": "Jul",
    "08": "Aug",
    "09": "Sep",
    10: "Oct",
    11: "Nov",
    12: "Dec",
  };
  if (!month) return "Unknown";
  const [year, monthNum] = month.split("-");
  return `${monthNames[monthNum] || monthNum} ${year}`;
};

const CustomColoredXMarker = ({ cx, cy, fill }) => (
  <g>
    <line
      x1={cx - 4}
      y1={cy - 4}
      x2={cx + 4}
      y2={cy + 4}
      stroke={fill}
      strokeWidth={3}
    />
    <line
      x1={cx - 4}
      y1={cy + 4}
      x2={cx + 4}
      y2={cy - 4}
      stroke={fill}
      strokeWidth={3}
    />
  </g>
);

const CustomTooltip = ({ active, payload, label, unit, xAxisType }) => {
  if (active && payload && payload.length) {
    const xLabel = xAxisType === "load_kw" ? `${label} kW` : `${label}%`;
    return (
      <div
        style={{
          backgroundColor: "rgba(255, 255, 255, 0.98)",
          padding: "10px 14px",
          border: "none", // REMOVED BORDER
          borderRadius: "10px",
          boxShadow:
            "0 10px 15px -3px rgba(0, 0, 0, 0.1), 0 4px 6px -2px rgba(0, 0, 0, 0.05)",
          textAlign: "center", // CENTER ALIGNMENT
          pointerEvents: "none",
        }}
      >
        <p
          style={{
            margin: "0 0 6px 0",
            fontWeight: "800",
            color: "#64748b",
            fontSize: "0.75rem",
            textTransform: "uppercase",
            borderBottom: "1px solid #f1f5f9",
            paddingBottom: "4px",
          }}
        >
          {xLabel}
        </p>
        {payload.map((pld, index) => (
          <p
            key={index}
            style={{
              color: pld.color,
              margin: "2px 0",
              fontWeight: "700",
              fontSize: "0.95rem",
            }}
          >
            {`${pld.value?.toFixed(2)} ${unit || ""}`}
          </p>
        ))}
      </div>
    );
  }
  return null;
};

const CustomInlineLegend = ({ monthlyReports, metricKey }) => {
  const legendItems = [{ value: "Shop Trial", type: "line", color: "#ca8a04" }];

  monthlyReports.forEach((report) => {
    const metricValue = report[metricKey];
    const unit = getMetricUnit(
      metricKey,
      window.__analysisMode === "auxiliaryEngine",
    ); // or pass from props

    const label =
      metricValue !== undefined && metricValue !== null
        ? `${report.displayName} (${metricValue.toFixed(1)} ${unit})`
        : report.displayName;

    legendItems.push({
      value: label,
      type: "symbol",
      color: report.color,
    });
  });

  return (
    <div
      style={{
        display: "flex",
        justifyContent: "center",
        gap: "12px",
        padding: "16px",
        flexWrap: "wrap",
      }}
    >
      {legendItems.map((item, index) => (
        <div
          key={index}
          style={{ display: "flex", alignItems: "center", gap: "8px" }}
        >
          {item.type === "line" ? (
            <div
              style={{
                width: "32px",
                height: "3px",
                backgroundColor: item.color,
                borderRadius: "2px",
              }}
            />
          ) : (
            <span
              style={{
                color: item.color,
                fontSize: "22px",
                fontWeight: "bold",
              }}
            >
              ×
            </span>
          )}
          <span
            style={{ fontSize: "14px", fontWeight: "600", color: "#475569" }}
          >
            {item.value}
          </span>
        </div>
      ))}
    </div>
  );
};

const interpolateBaseline = (
  baselineData,
  targetLoad,
  metric,
  xAxis = "load",
) => {
  if (!baselineData || !baselineData[metric]) return null;
  const series = baselineData[metric];
  if (!series || series.length === 0) return null;

  // Determine the key for the X-axis value
  const xKey = xAxis === "load" || xAxis === "load_percentage" ? "load" : xAxis;

  const sortedSeries = series.slice().sort((a, b) => a[xKey] - b[xKey]);
  const exactMatch = sortedSeries.find(
    (point) => Math.abs(point[xKey] - targetLoad) < 0.01,
  );
  if (exactMatch) return exactMatch.value;

  for (let i = 0; i < sortedSeries.length - 1; i++) {
    const current = sortedSeries[i];
    const next = sortedSeries[i + 1];
    if (current[xKey] <= targetLoad && targetLoad <= next[xKey]) {
      const t = (targetLoad - current[xKey]) / (next[xKey] - current[xKey]);
      return current.value + t * (next.value - current.value);
    }
  }
  return targetLoad <= sortedSeries[0][xKey]
    ? sortedSeries[0].value
    : sortedSeries[sortedSeries.length - 1].value;
};

const getNiceNumber = (roughNumber) => {
  if (roughNumber <= 0) return 1;
  const exponent = Math.floor(Math.log10(roughNumber));
  const fraction = roughNumber / Math.pow(10, exponent);
  let niceFraction;
  if (fraction <= 1) niceFraction = 1;
  else if (fraction <= 2) niceFraction = 2;
  else if (fraction <= 5) niceFraction = 5;
  else niceFraction = 10;
  return niceFraction * Math.pow(10, exponent);
};

const getYAxisDomain = (metricKey, baselineData, monthlyReports) => {
  const allValues = [];

  if (baselineData && baselineData[metricKey]) {
    baselineData[metricKey].forEach((point) => {
      if (point.value != null && !isNaN(point.value))
        allValues.push(point.value);
    });
  }

  if (monthlyReports && monthlyReports.length > 0) {
    monthlyReports.forEach((report) => {
      if (report[metricKey] != null && !isNaN(report[metricKey])) {
        allValues.push(report[metricKey]);
      }
    });
  }

  if (allValues.length === 0) {
    const defaults = {
      SFOC: [160, 200],
      Pmax: [80, 140],
      Pcomp: [80, 140],
      Turbospeed: [8, 16],
      EngSpeed: [100, 130],
      ScavAir: [1.5, 3.0],
      "Exh_T/C_inlet": [350, 450],
      Exh_Cylinder_outlet: [300, 400],
      "Exh_T/C_outlet": [250, 350],
      FIPI: [8, 16],
      FOC: [1.5, 4.0],
    };
    return defaults[metricKey] || [0, 100];
  }

  const minValue = Math.min(...allValues);
  const maxValue = Math.max(...allValues);

  const range = maxValue - minValue;
  const expandedRange = range < 0.1 ? 0.1 : range;
  const padding = expandedRange * 0.15;

  let domainMin = minValue - padding;
  const enforcedMin = 0.0;
  domainMin = Math.max(domainMin, enforcedMin);

  let domainMax = maxValue + padding;

  const finalRange = domainMax - domainMin;
  const roughTickSize = finalRange / 4;
  const niceTickSize = getNiceNumber(roughTickSize);

  let niceDomainMin = Math.floor(domainMin / niceTickSize) * niceTickSize;
  let niceDomainMax = Math.ceil(domainMax / niceTickSize) * niceTickSize;

  niceDomainMin = Math.max(niceDomainMin, enforcedMin);

  if (niceDomainMax <= niceDomainMin) {
    niceDomainMax = niceDomainMin + niceTickSize;
  }

  return [niceDomainMin, niceDomainMax];
};

const getCustomTicks = (domain, metricKey) => {
  const [min, max] = domain;
  const range = max - min;
  if (range <= 0) return [min, max];
  const tickInterval = getNiceNumber(range / 4);
  const ticks = [];
  let tick = Math.ceil(min / tickInterval) * tickInterval;
  while (tick <= max && ticks.length < 8) {
    ticks.push(Number(tick.toFixed(3)));
    tick += tickInterval;
  }
  if (ticks.length === 0 || ticks[0] > min) ticks.unshift(min);
  if (ticks[ticks.length - 1] < max) ticks.push(max);
  return ticks;
};

const interpolateLoadDiagramPower = (curves, targetRpm, curveKey) => {
  if (
    !curves ||
    curves.length < 2 ||
    targetRpm === null ||
    targetRpm === undefined
  )
    return null;

  const targetRpmFloat = parseFloat(targetRpm);
  const sortedCurves = curves.slice().sort((a, b) => a.rpm - b.rpm);

  let lowerPoint = null;
  let upperPoint = null;

  for (let i = 0; i < sortedCurves.length; i++) {
    if (sortedCurves[i].rpm <= targetRpmFloat) {
      lowerPoint = sortedCurves[i];
    }
    if (sortedCurves[i].rpm >= targetRpmFloat) {
      upperPoint = sortedCurves[i];
      break;
    }
  }

  if (!lowerPoint && upperPoint) return upperPoint[curveKey];
  if (lowerPoint && !upperPoint) return lowerPoint[curveKey];
  if (lowerPoint === upperPoint) return lowerPoint[curveKey];

  if (lowerPoint && upperPoint) {
    const x1 = lowerPoint.rpm;
    const y1 = lowerPoint[curveKey];
    const x2 = upperPoint.rpm;
    const y2 = upperPoint[curveKey];

    if (x1 === x2) return y1;

    const interpolatedValue =
      y1 + ((targetRpmFloat - x1) * (y2 - y1)) / (x2 - x1);
    return interpolatedValue;
  }

  return null;
};

export default function Performance({
  embeddedMode = false,
  defaultEngineType = "mainEngine",
  onEngineTypeChange,
  onShipChange,
}) {
  const navigate = useNavigate();
  const [activeTab, setActiveTab] = useState("view");

  // State declarations
  const [analysisMode, setAnalysisMode] = useState(defaultEngineType);
  const [showReport, setShowReport] = useState(false);
  const [displayedReportIds, setDisplayedReportIds] = useState([]);
  const [isDataLoaded, setIsDataLoaded] = useState(false);
  const [fleet, setFleet] = useState([]);
  const analysisResultsRef = useRef(null);
  const isUploadInProgressRef = useRef(false);
  const [shipId, setShipId] = useState("");
  const [loading, setLoading] = useState(true);
  const [hasAccess, setHasAccess] = useState(false);
  // const [timeFilter, setTimeFilter] = useState("current");
  const [selectedMetric, setSelectedMetric] = useState("all");
  const [monthlyReports, setMonthlyReports] = useState([]);
  const [historicalReports, setHistoricalReports] = useState([]);
  const [baseline, setBaseline] = useState({});
  const [baselineSource, setBaselineSource] = useState(null);
  const [currentReferenceMonth, setCurrentReferenceMonth] = useState(null);
  const [isTrendsExpanded, setIsTrendsExpanded] = useState(true);
  const [isLoadDiagramExpanded, setIsLoadDiagramExpanded] = useState(true);
  const [selectedTrendParams, setSelectedTrendParams] = useState([
    "Pmax",
    "SFOC",
  ]);
  const [envelopeParam, setEnvelopeParam] = useState("Pmax");
  const [isTrendCardExpanded, setIsTrendCardExpanded] = useState(true);
  const [isEnvelopeCardExpanded, setIsEnvelopeCardExpanded] = useState(true);
  const [loadDiagramData, setLoadDiagramData] = useState(null);
  const [generators, setGenerators] = useState([]);
  const [selectedGeneratorId, setSelectedGeneratorId] = useState(null);
  const [xAxisType, setXAxisType] = useState("load_percentage");
  const [isGeneratingPDF, setIsGeneratingPDF] = useState(false);
  const [uploadMode, setUploadMode] = useState("mainEngine");
  const [showShopTrialMap, setShowShopTrialMap] = useState({});
  // const [selectedYear, setSelectedYear] = useState("");
  // const [selectedMonth, setSelectedMonth] = useState("");
  // const currentYear = new Date().getFullYear();
  // const years = Array.from({ length: 50 }, (_, i) => currentYear - i);
  const [availableReports, setAvailableReports] = useState([]);
  // Store the IDs of reports checked by the user
  const [selectedReportIds, setSelectedReportIds] = useState([]);
  const [isCylinderCardExpanded, setIsCylinderCardExpanded] = useState(true);
  const [isSummaryExpanded, setIsSummaryExpanded] = useState(true);
  const [isHistoryExpanded, setIsHistoryExpanded] = useState(true);
  const [triggerAutoDownload, setTriggerAutoDownload] = useState(false);
  const [triggerLocalDownload, setTriggerLocalDownload] = useState(false);
  const [loadDiagramTooltip, setLoadDiagramTooltip] = useState(null);
  const [refreshReportsTrigger, setRefreshReportsTrigger] = useState(0);
  const [selectedRawDownloadIds, setSelectedRawDownloadIds] = useState([]);
  const [downloadGenId, setDownloadGenId] = useState(null);
  const [downloadableReports, setDownloadableReports] = useState([]);
  const [activePoint, setActivePoint] = useState(null);
  // Inside Performance component
  const [missingFields, setMissingFields] = useState([]);
  const reportsForDownload = useMemo(() => {
    if (uploadMode === "mainEngine") return availableReports;
    if (!downloadGenId) return [];

    // Filter availableReports to match the specific selected generator ID
    return availableReports.filter(
      (r) =>
        String(r.generator_id) === String(downloadGenId) ||
        String(r.generator) === String(downloadGenId),
    );
  }, [availableReports, uploadMode, downloadGenId]);
  // 🔥 NEW STATE: Last Report Dates
  const [lastReportDates, setLastReportDates] = useState({
    mainEngine: null,
    auxiliaryEngine: {}, // { 'AE-1': date, 'AE-2': date, 'AE-3': date }
  });

  useEffect(() => {
    if (showReport && analysisResultsRef.current) {
      setTimeout(() => {
        analysisResultsRef.current.scrollIntoView({
          behavior: "smooth",
          block: "start",
        });
      }, 150); // Small delay to allow charts to begin rendering
    }
  }, [showReport]);
  useEffect(() => {
    const handleGlobalClick = () => setActivePoint(null);
    if (activePoint) {
      window.addEventListener("click", handleGlobalClick);
    }
    return () => window.removeEventListener("click", handleGlobalClick);
  }, [activePoint]);
  const [loadingDates, setLoadingDates] = useState(false);

  const [xAxisOptions, setXAxisOptions] = useState([
    { key: "load_kw", label: "Load (kW)" },
    { key: "load_percentage", label: "Load (%)" },
  ]);

  // 🔥 NEW STATE: AE Deviation History
  const [aeDeviationHistory, setAeDeviationHistory] = useState([]);
  // 🔥 NEW STATE: ME Deviation History
  const [meDeviationHistory, setMeDeviationHistory] = useState([]);
  // --- ADD THIS LOGIC HERE ---
  const currentShip = fleet.find((s) => s.id === shipId);
  const shipDisplayName = currentShip ? formatVesselName(currentShip.name) : "";
  let bookmarkLabel = shipDisplayName;
  if (analysisMode === "auxiliaryEngine" && selectedGeneratorId) {
    const gen = generators.find((g) => g.generator_id === selectedGeneratorId);
    const genName = gen
      ? gen.designation || `Aux ${gen.generator_id}`
      : "Aux Engine";
    bookmarkLabel = `${shipDisplayName} - ${genName}`;
  }
  // ---------------------------
  // const months = [
  //   { value: "01", label: "Jan" }, { value: "02", label: "Feb" },
  //   { value: "03", label: "Mar" },   { value: "04", label: "Apr" },
  //   { value: "05", label: "May" },     { value: "06", label: "Jun" },
  //   { value: "07", label: "Jul" },    { value: "08", label: "Aug" },
  //   { value: "09", label: "Sep"},{ value: "10", label: "Oct" },
  //   { value: "11", label: "Nov" }, { value: "12", label: "Dec" }
  // ];

  const renderMissingAlert = () => {
    if (missingFields.length === 0) return null;

    return (
      <div
        className="missing-parameters-card"
        style={{
          marginTop: "16px",
          padding: "16px",
          borderRadius: "8px",
          backgroundColor: "#fef2f2",
          border: "2px solid #dc2626",
        }}
      >
        <div
          style={{
            color: "#dc2626",
            fontWeight: "800",
            marginBottom: "8px",
            display: "flex",
            alignItems: "center",
            gap: "8px",
          }}
        >
          <span>⚠️</span> CRITICAL: MISSING FIELDS IN UPLOADED REPORT
        </div>
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "1fr 1fr",
            gap: "8px",
          }}
        >
          {missingFields.map((field, index) => (
            <div
              key={index}
              style={{
                color: "#b91c1c",
                fontSize: "0.85rem",
                fontWeight: "600",
              }}
            >
              • {field}
            </div>
          ))}
        </div>
        <div
          style={{
            marginTop: "12px",
            fontSize: "0.8rem",
            color: "#7f1d1d",
            fontStyle: "italic",
          }}
        >
          Note: Calculations and troubleshooting will be inaccurate without
          these values.
        </div>
      </div>
    );
  };

  // Insert {renderMissingAlert()} inside your return() block
  // useEffect hooks
  useEffect(() => {
    if (embeddedMode) {
      setHasAccess(true);
      setLoading(false);
      return;
    }
    const checkAccess = async () => {
      try {
        const res = await axiosAepms.checkPageAccess("performance");
        if (!res.has_access) {
          navigate("/access-denied");
        } else {
          setHasAccess(true);
        }
      } catch (error) {
        console.error("Access check failed:", error);
        navigate("/access-denied");
      } finally {
        setLoading(false);
      }
    };
    checkAccess();
  }, [navigate, embeddedMode]);

  // 🔥 NEW EFFECT: Fetch reports specifically for the Download/Upload section
  // --- FIX 1: UPDATED EFFECT FOR FETCHING DOWNLOADABLE REPORTS ---
  useEffect(() => {
    // 1. Clear selection immediately when context changes to prevent ID mismatch
    setDownloadableReports([]);
    setSelectedRawDownloadIds([]);

    if (!shipId) return;

    const fetchReportsForDownload = async () => {
      try {
        const ship = fleet.find((s) => s.id === shipId);
        const imoNumber = parseInt(ship?.imo || ship?.imo_number);
        if (!imoNumber) return;

        let list = [];

        // 2. Fetch based on UPLOAD MODE
        if (uploadMode === "mainEngine") {
          // Fetch Main Engine Reports
          const data = await axiosAepms.getPerformanceData(imoNumber, 24); // Fetch last 24
          list = data.monthly_performance_list || [];
        } else if (uploadMode === "auxiliaryEngine") {
          // Fetch AE Reports - Only if a generator is selected
          if (!downloadGenId) {
            setDownloadableReports([]);
            return;
          }
          const data = await axiosAepms.getAuxiliaryPerformanceHistory(
            imoNumber,
            24,
            null,
            downloadGenId,
          );
          list = data.monthly_performance_list || [];
        }

        // 3. Process data for the dropdown
        const processed = list.map((report) => {
          // Format Date
          let dateStr = report.report_date;
          if (report.report_date) {
            const dateObj = new Date(report.report_date);
            if (!isNaN(dateObj.getTime())) {
              dateStr = dateObj.toLocaleDateString("en-GB", {
                day: "numeric",
                month: "short",
                year: "numeric",
              });
            }
          }

          // Generate Label
          const displayLoad =
            report.load_percentage !== undefined &&
            report.load_percentage !== null
              ? `${Number(report.load_percentage).toFixed(2)}%`
              : "N/A";

          return {
            label: `${getMonthDisplayName(report.report_month)} (${displayLoad})`,
            subLabel: dateStr,
            value: report.report_id, // Important: This is the ID used for downloading
            report_date: report.report_date, // Needed for grouping by year
          };
        });

        setDownloadableReports(processed);
      } catch (error) {
        console.error("Failed to fetch downloadable reports:", error);
        setDownloadableReports([]);
      }
    };

    fetchReportsForDownload();
  }, [shipId, uploadMode, downloadGenId, fleet, refreshReportsTrigger]);
  // ^ Dependencies ensure it updates strictly on Upload Tab changes

  useEffect(() => {
    if (!hasAccess) return;

    axiosAepms
      .getFleet()
      .then((res) => {
        const fleetData = res.fleet || [];

        // --- ADDED: Sort fleet alphabetically by name ---
        const sortedFleet = [...fleetData].sort((a, b) => {
          const nameA = formatVesselName(a.name || "");
          const nameB = formatVesselName(b.name || "");
          return nameA.localeCompare(nameB);
        });

        setFleet(sortedFleet);
        setShipId("");
      })
      .catch((error) => {
        console.error("Failed to load fleet data:", error);
      });
  }, [hasAccess]);
  // 🔥 NEW EFFECT: Fetch last report dates when ship changes
  useEffect(() => {
    if (!shipId || fleet.length === 0) return;

    const ship = fleet.find((s) => String(s.id) === String(shipId));
    const imoNumber = ship ? parseInt(ship.imo || ship.imo_number) : null;

    if (imoNumber) {
      fetchLastReportDates(imoNumber);
    }
  }, [shipId, fleet]);

  // Generator List Fetcher (Triggered on Ship Change in Aux Mode)

  // Generator List Fetcher (Triggered on Ship Change OR Mode Change)
  useEffect(() => {
    // We need generators if EITHER:
    // 1. The View Tab (analysisMode) is set to Auxiliary Engine
    // 2. The Upload Tab (uploadMode) is set to Auxiliary Engine
    const needGenerators =
      analysisMode === "auxiliaryEngine" || uploadMode === "auxiliaryEngine";

    if (needGenerators && shipId) {
      const ship = fleet.find((s) => s.id === shipId);
      const imoNumber = ship ? parseInt(ship.imo || ship.imo_number) : null;

      if (!imoNumber) {
        setGenerators([]);
        return;
      }

      // Don't set global 'loading' here to avoid flickering the whole page
      // just for the upload tab dropdown
      axiosAepms
        .getGeneratorsList(imoNumber)
        .then((res) => {
          const gens = Array.isArray(res)
            ? res // backend returned array
            : res.generators || []; // fallback if wrapped in object

          setGenerators(gens);

          // Logic specifically for the VIEW TAB (analysisMode)
          // If we are viewing Analysis, auto-select the first generator
          if (analysisMode === "auxiliaryEngine" && gens.length > 0) {
            // Only set if not already set
            if (!selectedGeneratorId) {
              setSelectedGeneratorId(gens[0].generator_id);
            }
          }
        })
        .catch((error) => {
          console.error("Failed to load auxiliary generators:", error);
          setGenerators([]);
        });
    }
    // Only clear generators if NEITHER tab needs them (i.e., both are Main Engine)
    else if (analysisMode === "mainEngine" && uploadMode === "mainEngine") {
      setGenerators([]);
      // Do NOT clear selectedGeneratorId here, simply let the UI hide the dropdown
    }
  }, [shipId, analysisMode, uploadMode, fleet, selectedGeneratorId]);

  // 🔥 UPDATED EFFECT: Hide history until a new ME report is uploaded
  useEffect(() => {
    // When user switches vessel or analysis mode, clear previous history
    if (analysisMode !== "mainEngine") {
      setMeDeviationHistory([]);
      return;
    }

    // If vessel changes, clear history and wait for next upload
    setMeDeviationHistory([]);
  }, [shipId, analysisMode]);

  useEffect(() => {
    if (
      analysisMode !== "mainEngine" ||
      baselineSource === "upload" ||
      !shipId ||
      !fleet.length
    )
      return;

    const ship = fleet.find((s) => s.id === shipId);
    if (!ship) return;

    const imoNumber = parseInt(ship.imo || ship.imo_number);
    if (!imoNumber) return;

    setLoading(true);
    axiosAepms
      .getBaseline(imoNumber)
      .then((res) => {
        if (res.baseline_data && Array.isArray(res.baseline_data)) {
          const transformedBaseline = {};

          Object.entries(MAIN_METRIC_MAPPING).forEach(
            ([frontendKey, backendKey]) => {
              const points = res.baseline_data
                .filter(
                  (point) =>
                    point[backendKey] !== null &&
                    point[backendKey] !== undefined,
                )
                .map((point) => ({
                  load: point.load_percentage,
                  value: point[backendKey],
                }))
                .sort((a, b) => a.load - b.load);

              if (points.length > 0) {
                transformedBaseline[frontendKey] = points;
              }
            },
          );

          if (Object.keys(transformedBaseline).length > 0) {
            setBaseline(transformedBaseline);
            setBaselineSource("api");
          }
        }
      })
      .catch((error) => {
        console.error("Failed to load auxiliary baseline:", error);
      })
      .finally(() => setLoading(false));
  }, [selectedGeneratorId, shipId, fleet, baselineSource, analysisMode]);
  // 🔥 NEW FUNCTION: Fetch last report dates
  // --- REPLACE YOUR EXISTING fetchLastReportDates FUNCTION WITH THIS ---

  const fetchLastReportDates = async (imoNumber) => {
    setLoadingDates(true);
    try {
      // 1. Fetch Main Engine last date
      // We use axiosAepms.getPerformanceData with limit=1 to get the latest
      const meData = await axiosAepms.getPerformanceData(imoNumber, 1);
      const meLastDate =
        meData?.monthly_performance_list?.[0]?.report_date || null;

      // 2. Fetch Auxiliary Engine last dates (for each generator)
      const genRes = await axiosAepms.getGeneratorsList(imoNumber);
      // Handle response whether it's a direct array or wrapped in { generators: [...] }
      const generators = Array.isArray(genRes)
        ? genRes
        : genRes.generators || [];

      const aeDates = {};

      // Use Promise.all to fetch all generator histories in parallel (faster than loop)
      await Promise.all(
        generators.map(async (gen) => {
          try {
            // Fetch history for specific generator, limit=1
            const genData = await axiosAepms.getAuxiliaryPerformanceHistory(
              imoNumber,
              1, // limit
              null, // refMonth (null for latest)
              gen.generator_id,
            );

            const lastDate =
              genData?.monthly_performance_list?.[0]?.report_date || null;

            // Use designation (e.g., 'AE-1') as key
            const label =
              gen.designation ||
              gen.generator_designation ||
              `Gen ${gen.generator_id}`;
            aeDates[label] = lastDate;
          } catch (err) {
            console.warn(
              `Could not fetch history for generator ${gen.generator_id}`,
              err,
            );
            aeDates[gen.designation] = null;
          }
        }),
      );

      setLastReportDates({
        mainEngine: meLastDate,
        auxiliaryEngine: aeDates,
      });
    } catch (error) {
      console.error("Error fetching last report dates:", error);
    } finally {
      setLoadingDates(false);
    }
  };

  // useEffect(() => {
  //   if (analysisMode !== 'auxiliaryEngine' || !selectedGeneratorId || baselineSource === 'upload') return;

  //   setLoading(true);
  //   axiosAepms.getAuxPerformance(selectedGeneratorId)
  //     .then(data => {
  //       if (data.graph_data && data.graph_data.monthly_performance && data.graph_data.report_info) {
  //         const monthlyPoint = data.graph_data.monthly_performance;
  //         const reportMonth = data.graph_data.report_info.report_month;
  //         const reportDate = data.graph_data.report_info?.report_date || null;

  //         const newReport = {
  //           month: reportMonth,
  //           report_date: reportDate,
  //           load_kw: monthlyPoint.load_kw,
  //           load_percentage: monthlyPoint.load_percentage,
  //           color: getMonthColor(reportMonth),
  //           displayName: getMonthDisplayName(reportMonth),
  //           report_id: data.graph_data.report_info.report_id
  //         };

  //         Object.entries(AUX_METRIC_MAPPING).forEach(([frontendKey, backendKey]) => {
  //           newReport[frontendKey] = monthlyPoint[backendKey] || null;
  //         });

  //         setMonthlyReports([newReport]);
  //         setCurrentReferenceMonth(reportMonth);
  //       }
  //     })
  //     .catch(error => {
  //       console.error('Failed to load aux performance data:', error);
  //     })
  //     .finally(() => setLoading(false));
  // }, [selectedGeneratorId, analysisMode, baselineSource]);
  // EFFECT: Fetch Auxiliary Engine Performance & Baseline
  // useEffect(() => {
  //   // 1. Guard Clauses: Ensure we are in AE mode and have a generator selected
  //   if (analysisMode !== 'auxiliaryEngine' || !selectedGeneratorId || baselineSource === 'upload') return;

  //   setLoading(true);

  //   axiosAepms.getAuxPerformance(selectedGeneratorId)
  //     .then(data => {
  //       if (data.graph_data) {

  //         // --- A. PROCESS BASELINE (With Fuzzy Matching Fix) ---
  //         if (data.graph_data.shop_trial_baseline) {
  //           const transformedBaseline = {};

  //           Object.entries(AUX_METRIC_MAPPING).forEach(([frontendKey, backendKey]) => {
  //             // Inside handleFileUpload -> else if (analysisMode === 'auxiliaryEngine')
  //             const points = result.graph_data.shop_trial_baseline
  //               .map(point => {
  //                   const val = findValueInPoint(point, backendKey);
  //                   return {
  //                       // 🔥 CHANGE 1: Explicitly map 'load' to percentage so interpolation works
  //                       load: point.load_percentage,
  //                       load_kw: point.load_kw,
  //                       load_percentage: point.load_percentage,
  //                       value: val
  //                   };
  //               })
  //               .filter(p => p.value !== null && p.value !== undefined)
  //               .sort((a, b) => (a.load_kw || 0) - (b.load_kw || 0));

  //             if (points.length > 0) {
  //               transformedBaseline[frontendKey] = points;
  //             }
  //           });
  //           setBaseline(transformedBaseline);
  //         }

  //         // --- B. PROCESS MONTHLY REPORT (Existing Logic) ---
  //         if (data.graph_data.monthly_performance && data.graph_data.report_info) {
  //           const monthlyPoint = data.graph_data.monthly_performance;
  //           const reportMonth = data.graph_data.report_info.report_month;
  //           const reportDate = data.graph_data.report_info?.report_date || null;

  //           const newReport = {
  //             month: reportMonth,
  //             report_date: reportDate,
  //             load_kw: monthlyPoint.load_kw,
  //             load_percentage: monthlyPoint.load_percentage,
  //             color: getMonthColor(reportMonth),
  //             displayName: getMonthDisplayName(reportMonth),
  //             report_id: data.graph_data.report_info.report_id
  //           };

  //           Object.entries(AUX_METRIC_MAPPING).forEach(([frontendKey, backendKey]) => {
  //             // Also use helper here for safety, or keep original strict mapping if monthly data is clean
  //             newReport[frontendKey] = monthlyPoint[backendKey] || null;
  //           });

  //           setMonthlyReports([newReport]);
  //           setCurrentReferenceMonth(reportMonth);
  //         }
  //       }
  //     })
  //     .catch(error => {
  //       console.error('Failed to load aux performance data:', error);
  //     })
  //     .finally(() => setLoading(false));
  // }, [selectedGeneratorId, analysisMode, baselineSource]);
  // EFFECT: Fetch Auxiliary Engine Performance & Baseline
  useEffect(() => {
    if (
      analysisMode !== "auxiliaryEngine" ||
      !selectedGeneratorId ||
      baselineSource === "upload"
    )
      return;

    setLoading(true);

    axiosAepms
      .getAuxPerformance(selectedGeneratorId)
      .then((data) => {
        // <--- Response variable is 'data'
        if (data.graph_data) {
          // --- A. PROCESS BASELINE ---
          if (data.graph_data.shop_trial_baseline) {
            const transformedBaseline = {};

            Object.entries(AUX_METRIC_MAPPING).forEach(
              ([frontendKey, backendKey]) => {
                // FIX: Changed 'result' to 'data'
                const points = data.graph_data.shop_trial_baseline
                  .map((point) => {
                    const val = findValueInPoint(point, backendKey);
                    return {
                      load: point.load_percentage,
                      load_kw: point.load_kw,
                      load_percentage: point.load_percentage,
                      value: val,
                    };
                  })
                  .filter((p) => p.value !== null && p.value !== undefined)
                  .sort((a, b) => (a.load_kw || 0) - (b.load_kw || 0));

                if (points.length > 0) {
                  transformedBaseline[frontendKey] = points;
                }
              },
            );
            setBaseline(transformedBaseline);
          }

          // --- B. PROCESS MONTHLY REPORT ---
          if (
            data.graph_data.monthly_performance &&
            data.graph_data.report_info
          ) {
            const monthlyPoint = data.graph_data.monthly_performance;
            const reportMonth = data.graph_data.report_info.report_month;
            const reportDate = data.graph_data.report_info?.report_date || null;

            const newReport = {
              month: reportMonth,
              report_date: reportDate,
              load_kw: monthlyPoint.load_kw,
              load_percentage: monthlyPoint.load_percentage,
              color: getMonthColor(reportMonth),
              displayName: getMonthDisplayName(reportMonth),
              report_id: data.graph_data.report_info.report_id,
            };

            Object.entries(AUX_METRIC_MAPPING).forEach(
              ([frontendKey, backendKey]) => {
                newReport[frontendKey] = monthlyPoint[backendKey] || null;
              },
            );

            setMonthlyReports([newReport]);
            setCurrentReferenceMonth(reportMonth);
          }
        }
      })
      .catch((error) => {
        console.error("Failed to load aux performance data:", error);
      })
      .finally(() => setLoading(false));
  }, [selectedGeneratorId, analysisMode, baselineSource]);
  // 🔥 NEW EFFECT: Fetch AE Deviation History Table
  useEffect(() => {
    if (analysisMode === "auxiliaryEngine" && selectedGeneratorId) {
      setLoading(true);

      const refDate = currentReferenceMonth || null;

      axiosAepms
        .getAEDeviationHistoryTable(selectedGeneratorId, refDate)
        .then((data) => {
          setAeDeviationHistory(data.history || []);
        })
        .catch((err) =>
          console.error("Failed to load AE deviation table:", err),
        )
        .finally(() => setLoading(false));
    } else {
      setAeDeviationHistory([]);
    }
  }, [
    selectedGeneratorId,
    analysisMode,
    baselineSource,
    currentReferenceMonth,
  ]);
  // 🔥 NEW EFFECT: Fetch ME Deviation History Table (Auto-load on vessel change)
  // 🔥 NEW EFFECT: Fetch ME Deviation History Table (Auto-load on vessel change)
  useEffect(() => {
    // Only run if we are in Main Engine mode and a ship is selected
    if (analysisMode === "mainEngine" && shipId && fleet.length > 0) {
      // --- FIX: Only fetch history if a report has been uploaded (currentReferenceMonth exists) ---
      if (!currentReferenceMonth) {
        setMeDeviationHistory([]);
        return;
      }
      // -----------------------------------------------------------------------------------------

      const ship = fleet.find((s) => s.id === shipId);
      const imoNumber = ship ? parseInt(ship.imo || ship.imo_number) : null;

      if (imoNumber) {
        const refDate = currentReferenceMonth || null;

        // Fetch the TABLE data specifically
        axiosAepms
          .getMainEngineDeviationHistory(imoNumber, refDate)
          .then((data) => {
            console.log("ME History Table Fetched:", data.history);
            setMeDeviationHistory(data.history || []);
          })
          .catch((err) => {
            console.error("Failed to load ME deviation table:", err);
            setMeDeviationHistory([]);
          });
      }
    } else if (analysisMode !== "mainEngine") {
      setMeDeviationHistory([]);
    }
  }, [shipId, analysisMode, fleet, currentReferenceMonth]);

  // useEffect(() => {
  //   if (analysisMode === 'mainEngine' && shipId) {
  //     loadMainEngineHistory(timeFilter);
  //   }

  //   else if (analysisMode === 'auxiliaryEngine' && selectedGeneratorId) {
  //           loadAuxEngineHistory(timeFilter);
  //   }
  // }, [
  //   shipId,
  //   selectedGeneratorId,
  //   timeFilter,
  //   analysisMode,
  //   selectedYear,
  //   selectedMonth,
  //   baselineSource
  // ]);
  // New Unified Fetcher
  // useEffect(() => {
  //   const canFetchMe = analysisMode === 'mainEngine' && shipId;
  //   const canFetchAe = analysisMode === 'auxiliaryEngine' && shipId && selectedGeneratorId;

  //   if ((!canFetchMe && !canFetchAe) || baselineSource === 'upload') return;

  //   setLoading(true);
  //   const ship = fleet.find(s => s.id === shipId);
  //   const imoNumber = parseInt(ship?.imo || ship?.imo_number);

  //   // Fetch last 24 reports to populate the dropdown list
  //   const fetchLimit = 24;

  //   const fetchPromise = analysisMode === 'mainEngine'
  //       ? axiosAepms.getPerformanceData(imoNumber, fetchLimit)
  //       : axiosAepms.getAuxiliaryPerformanceHistory(imoNumber, fetchLimit, null, selectedGeneratorId);

  //   fetchPromise.then(data => {
  //       const list = data.monthly_performance_list || [];

  //       // 1. Store Raw Data for Charts
  //       const processed = list.map(r => ({
  //           ...r,
  //           // Create standardized keys for dropdown
  //           value: r.report_id,
  //           label: getMonthDisplayName(r.report_month),
  //           subLabel: r.report_date,
  //           // Keep existing data mapping logic...
  //           color: getMonthColor(r.report_month),
  //           displayName: getMonthDisplayName(r.report_month),
  //           // Map ME/AE specific fields here if needed (copied from your old logic)
  //           // e.g. SFOC: r.sfoc_g_kwh...
  //       }));

  //       setAvailableReports(processed);

  //       // 2. Auto-select the most recent report by default
  //       if (processed.length > 0) {
  //           setSelectedReportIds([processed[0].value]);
  //           setCurrentReferenceMonth(processed[0].report_month);

  //           // Trigger Graph/Baseline fetch for the newest report
  //           if(analysisMode === 'mainEngine') {
  //                // You may need to adapt your loadDiagram fetching here
  //                axiosAepms.getGraphData(processed[0].report_id).then(gRes => {
  //                   if(gRes.graph_data) {
  //                       setLoadDiagramData(gRes.graph_data.engine_load_diagram_data);
  //                       // Set Baseline...
  //                   }
  //                });
  //           }
  //       } else {
  //           setSelectedReportIds([]);
  //       }
  //   }).finally(() => setLoading(false));

  // }, [shipId, selectedGeneratorId, analysisMode]);

  // New Unified Fetcher with Data Mapping
  // New Unified Fetcher with Data Mapping
  // New Unified Fetcher with Data Mapping
  // New Unified Fetcher with Data Mapping
  // New Unified Fetcher with Data Mapping
  useEffect(() => {
    const canFetchMe = analysisMode === "mainEngine" && shipId;
    const canFetchAe =
      analysisMode === "auxiliaryEngine" && shipId && selectedGeneratorId;

    // Guard clause: If we can't fetch, stop.
    if (!canFetchMe && !canFetchAe) return;

    setLoading(true);
    const ship = fleet.find((s) => s.id === shipId);
    const imoNumber = parseInt(ship?.imo || ship?.imo_number);

    const fetchLimit = 24;

    const fetchPromise =
      analysisMode === "mainEngine"
        ? axiosAepms.getPerformanceData(imoNumber, fetchLimit)
        : axiosAepms.getAuxiliaryPerformanceHistory(
            imoNumber,
            fetchLimit,
            null,
            selectedGeneratorId,
          );

    fetchPromise
      .then((data) => {
        const list = data.monthly_performance_list || [];

        // 1. Process List & Map Data for Charts
        const processed = list.map((report) => {
          const displayLoad =
            report.load_percentage !== undefined &&
            report.load_percentage !== null
              ? `${Number(report.load_percentage).toFixed(2)}%`
              : "N/A";

          // Format Date
          let dateStr = report.report_date;
          if (report.report_date) {
            const dateObj = new Date(report.report_date);
            if (!isNaN(dateObj.getTime())) {
              dateStr = dateObj.toLocaleDateString("en-GB", {
                day: "numeric",
                month: "short",
                year: "numeric",
              });
            }
          }

          // Use the 'finish_time' from the API if available
          let finalSubLabel = dateStr;
          if (report.finish_time) {
            const cleanTime = report.finish_time.toString().substring(0, 5);
            finalSubLabel = `${dateStr} - ${cleanTime}hrs`;
          }

          // Common properties
          const base = {
            report_id: report.report_id,
            month: report.report_month,
            report_date: report.report_date,
            color: getMonthColor(report.report_month),
            displayName: getMonthDisplayName(report.report_month),
            value: report.report_id,
            label: `${getMonthDisplayName(report.report_month)} (${displayLoad})`,
            subLabel: finalSubLabel,
          };

          if (analysisMode === "mainEngine") {
            return {
              ...base,
              propeller_margin_percent: report.propeller_margin_percent,
              load: report.load_percentage,
              shaft_power_kw: report.shaft_power_kw || report.power_kw,
              effective_power_kw: report.effective_power_kw,
              rpm: report.engine_speed_rpm || report.rpm,
              cylinder_readings: report.cylinder_readings,
              SFOC: report.sfoc_g_kwh,
              Pmax: report.max_combustion_pressure_bar,
              Pcomp: report.compression_pressure_bar,
              Turbospeed: report.turbocharger_speed_x1000_rpm,
              EngSpeed: report.engine_speed_rpm,
              ScavAir: report.scav_air_pressure_kg_cm2,
              "Exh_T/C_inlet": report.exh_temp_tc_inlet_c,
              Exh_Cylinder_outlet: report.cyl_exhaust_gas_temp_outlet_c,
              "Exh_T/C_outlet": report.exh_temp_tc_outlet_c,
              FIPI: report.fuel_inj_pump_index_mm,
              // FOC: report.fuel_consumption_total_kg_h,

              SFOC_raw: report.sfoc_g_kwh_raw,
              Pmax_raw: report.max_combustion_pressure_bar_raw,
              Pcomp_raw: report.compression_pressure_bar_raw,
              Turbospeed_raw: report.turbocharger_speed_x1000_rpm_raw,
              EngSpeed_raw: report.engine_speed_rpm_raw,
              ScavAir_raw: report.scav_air_pressure_kg_cm2_raw,
              "Exh_T/C_inlet_raw": report.exh_temp_tc_inlet_c_raw,
              Exh_Cylinder_outlet_raw: report.cyl_exhaust_gas_temp_outlet_c_raw,
              "Exh_T/C_outlet_raw": report.exh_temp_tc_outlet_c_raw,
              FIPI_raw: report.fuel_inj_pump_index_mm_raw,
              // FOC_raw: report.fuel_consumption_total_kg_h_raw
              tc_air_inlet_temp_c: report.tc_air_inlet_temp_c,
              // scav_air_cooler_cw_in_temp_c: report.scav_air_cooler_cw_in_temp_c,
              fo_lcv_mj_kg: report.fo_lcv_mj_kg,
              barometric_pressure_mmh2o: report.barometric_pressure_mmh2o,
            };
          } else {
            const aeObj = {
              ...base,
              generator_id: report.generator_id,
              load_kw: report.load_kw,
              load_percentage: report.load_percentage,
              cylinder_readings: report.cylinder_readings,
            };
            Object.entries(AUX_METRIC_MAPPING).forEach(
              ([frontendKey, backendKey]) => {
                aeObj[frontendKey] = findValueInPoint(report, backendKey);
              },
            );
            return aeObj;
          }
        });

        setAvailableReports(processed);

        // Only reset the view if we are NOT in upload mode
        if (baselineSource !== "upload" && !isUploadInProgressRef.current) {
          setSelectedReportIds([]);
          setLoadDiagramData(null);
          setBaseline({});
          setMeDeviationHistory([]);
          setAeDeviationHistory([]);
          setCurrentReferenceMonth(null);
          setShowReport(false);
        }
        isUploadInProgressRef.current = false;
      })
      .finally(() => setLoading(false));
  }, [shipId, selectedGeneratorId, analysisMode, refreshReportsTrigger]);

  //  const loadMainEngineHistory = async (timeFilterString) => {
  //   const ship = fleet.find(s => s.id === shipId);
  //   if (!ship) return;

  //   const imoNumber = parseInt(ship.imo || ship.imo_number);
  //   if (!imoNumber) return;

  //   // 1. STRICT GUARD: Wait for Year & Month (unless uploading)
  //   if (baselineSource !== 'upload') {
  //       if (!selectedYear || !selectedMonth) {
  //           setMonthlyReports([]);
  //           setHistoricalReports([]);
  //           setBaseline({});
  //           setLoadDiagramData(null);
  //           return;
  //       }
  //   }

  //   setLoading(true);
  //   try {
  //     let refMonth = null;
  //     let targetDateString = null; // Store what the user *wanted*

  //     if (baselineSource === 'upload') {
  //         refMonth = currentReferenceMonth;
  //     } else {
  //         // Construct "2026-04"
  //         refMonth = `${selectedYear}-${selectedMonth}`;
  //         targetDateString = refMonth;
  //     }

  //     const apiFilter = timeFilterString === 'current' ? 'last2' : timeFilterString;

  //     const data = await axiosAepms.getPerformanceData(imoNumber, apiFilter, refMonth);

  //     if (data.monthly_performance_list && data.monthly_performance_list.length > 0) {

  //       // Get the latest report returned by the DB
  //       const latestReportRaw = data.monthly_performance_list[0];

  //       // --- STRICT LOGIC FOR "CURRENT REPORT" ---
  //       // If user wants "Current Report" AND we are not uploading...
  //       if (timeFilterString === 'current' && baselineSource !== 'upload') {
  //           // Check if the returned report month matches the selected month
  //           if (latestReportRaw.report_month !== targetDateString) {
  //               // Mismatch! (e.g., User asked 2026-04, DB returned 2025-04)
  //               console.warn(`No exact match found. Requested: ${targetDateString}, Found: ${latestReportRaw.report_month}`);

  //               // Clear everything and stop
  //               setMonthlyReports([]);
  //               setHistoricalReports([]);
  //               setBaseline({});
  //               setLoadDiagramData(null);
  //               setLoading(false);
  //               return;
  //           }
  //       }
  //       // -----------------------------------------

  //       const transformedHistorical = data.monthly_performance_list.map(report => ({
  //         month: report.report_month,
  //         report_date: report.report_date || null,
  //         load: report.load_percentage,
  //         SFOC: report.sfoc_g_kwh,
  //         Pmax: report.max_combustion_pressure_bar,
  //         Pcomp: report.compression_pressure_bar,
  //         Turbospeed: report.turbocharger_speed_x1000_rpm,
  //         EngSpeed: report.engine_speed_rpm,
  //         ScavAir: report.scav_air_pressure_kg_cm2,
  //         "Exh_T/C_inlet": report.exh_temp_tc_inlet_c,
  //         "Exh_Cylinder_outlet": report.cyl_exhaust_gas_temp_outlet_c,
  //         "Exh_T/C_outlet": report.exh_temp_tc_outlet_c,
  //         FIPI: report.fuel_inj_pump_index_mm,
  //         FOC: report.fuel_consumption_total_kg_h,
  //         SFOC_raw: report.sfoc_g_kwh_raw,
  //         Pmax_raw: report.max_combustion_pressure_bar_raw,
  //         Pcomp_raw: report.compression_pressure_bar_raw,
  //         Turbospeed_raw: report.turbocharger_speed_x1000_rpm_raw,
  //         EngSpeed_raw: report.engine_speed_rpm_raw,
  //         ScavAir_raw: report.scav_air_pressure_kg_cm2_raw,
  //         "Exh_T/C_inlet_raw": report.exh_temp_tc_inlet_c_raw,
  //         "Exh_Cylinder_outlet_raw": report.cyl_exhaust_gas_temp_outlet_c_raw,
  //         "Exh_T/C_outlet_raw": report.exh_temp_tc_outlet_c_raw,
  //         FIPI_raw: report.fuel_inj_pump_index_mm_raw,
  //         FOC_raw: report.fuel_consumption_total_kg_h_raw,
  //         color: getMonthColor(report.report_month),
  //         displayName: getMonthDisplayName(report.report_month),
  //         report_id: report.report_id
  //       }));

  //       if (baselineSource !== 'upload') {
  //           const latestReport = transformedHistorical[0];

  //           setMonthlyReports([latestReport]);
  //           setCurrentReferenceMonth(latestReport.month);
  //           setBaselineSource('api');

  //           try {
  //               const graphRes = await axiosAepms.getGraphData(latestReport.report_id);
  //               if (graphRes.graph_data) {
  //                   setLoadDiagramData(graphRes.graph_data.engine_load_diagram_data);

  //                   const shopTrialData = graphRes.graph_data.shop_trial_baseline;
  //                   const transformedBaseline = {};
  //                   Object.entries(MAIN_METRIC_MAPPING).forEach(([frontendKey, backendKey]) => {
  //                       const points = shopTrialData
  //                       .filter(point => point[backendKey] !== null)
  //                       .map(point => ({ load: point.load_percentage, value: point[backendKey] }))
  //                       .sort((a, b) => a.load - b.load);
  //                       if (points.length > 0) transformedBaseline[frontendKey] = points;
  //                   });
  //                   setBaseline(transformedBaseline);

  //                   axiosAepms.getMainEngineDeviationHistory(imoNumber, latestReport.month)
  //                     .then(d => setMeDeviationHistory(d.history || []))
  //                     .catch(e => console.error("History fetch error", e));
  //               }
  //           } catch (err) {
  //               console.error("Failed to load graph details", err);
  //           }
  //       }

  //       setHistoricalReports(transformedHistorical);
  //     } else {
  //       // No data returned at all
  //       setHistoricalReports([]);
  //       setMonthlyReports([]);
  //       setLoadDiagramData(null);
  //       setBaseline({});
  //     }
  //   } catch (error) {
  //     console.error('Failed to load main engine history:', error);
  //     setHistoricalReports([]);
  //   } finally {
  //     setLoading(false);
  //   }
  // };

  // UPDATED: Auxiliary Engine History Loader to accept the string

  //  const loadAuxEngineHistory = async (timeFilterString) => {
  //   // 1. Basic Validation
  //   const vessel = fleet.find(v => v.id === shipId);
  //   if (!vessel || !selectedGeneratorId) return;

  //   const imoNumber = parseInt(vessel.imo || vessel.imo_number);
  //   if (!imoNumber) return;

  //   // 2. STRICT GUARD: If not uploading a file, require Year & Month
  //   // This prevents the app from loading random data before the user selects a date.
  //   if (baselineSource !== 'upload') {
  //       if (!selectedYear || !selectedMonth) {
  //           // Clear all data if date is missing
  //           setMonthlyReports([]);
  //           setHistoricalReports([]);
  //           setBaseline({});
  //           setAeDeviationHistory([]); // Clear history table
  //           return;
  //       }
  //   }

  //   setLoading(true);

  //   try {
  //     // 3. Construct Reference Date (YYYY-MM)
  //     let refMonth = null;
  //     let targetDateString = null;

  //     if (baselineSource === 'upload') {
  //         refMonth = currentReferenceMonth;
  //     } else {
  //         refMonth = `${selectedYear}-${selectedMonth}`;
  //         targetDateString = refMonth;
  //     }

  //     // 4. API Call
  //     // We pass the refMonth so the backend knows which report is the "anchor"
  //     const apiFilter = timeFilterString === 'current' ? 'last2' : timeFilterString;

  //     const data = await axiosAepms.getAuxiliaryPerformanceHistory(
  //         imoNumber,
  //         apiFilter,
  //         refMonth,
  //         selectedGeneratorId
  //     );

  //     if (data.monthly_performance_list && data.monthly_performance_list.length > 0) {

  //       // 5. STRICT MATCH CHECK
  //       // If the DB returns a report that doesn't match the selected month (e.g., requested 2024-02 but got 2024-01),
  //       // we should treat it as "No Data Found" for that specific month.
  //       const latestReportRaw = data.monthly_performance_list[0];

  //       if (timeFilterString === 'current' && baselineSource !== 'upload' && targetDateString) {
  //           if (latestReportRaw.report_month !== targetDateString) {
  //                console.warn(`Date mismatch. Requested: ${targetDateString}, Found: ${latestReportRaw.report_month}`);
  //                setMonthlyReports([]);
  //                setHistoricalReports([]);
  //                setBaseline({});
  //                setAeDeviationHistory([]);
  //                setLoading(false);
  //                return;
  //           }
  //       }

  //       // 6. Transform Data for Charts
  //       const transformedHistorical = data.monthly_performance_list.map(report => {
  //         const transformed = {
  //           month: report.report_month,
  //           report_date: report.report_date || null,
  //           load_kw: report.load_kw,
  //           load_percentage: report.load_percentage,
  //           color: getMonthColor(report.report_month),
  //           displayName: getMonthDisplayName(report.report_month),
  //           report_id: report.report_id
  //         };
  //         // Map backend keys to frontend keys
  //         Object.entries(AUX_METRIC_MAPPING).forEach(([frontendKey, backendKey]) => {
  //           transformed[frontendKey] = findValueInPoint(report, backendKey);
  //         });
  //         return transformed;
  //       });

  //       // 7. Handle Baseline & History Table
  //       if (baselineSource !== 'upload') {
  //            const latestReport = transformedHistorical[0];
  //            setMonthlyReports([latestReport]);
  //            setCurrentReferenceMonth(latestReport.month);

  //            // Fetch the Deviation History Table for this specific month
  //            axiosAepms.getAEDeviationHistoryTable(selectedGeneratorId, latestReport.month)
  //               .then(d => setAeDeviationHistory(d.history || []))
  //               .catch(err => console.error("Failed to fetch AE deviation history:", err));

  //            // Fetch Baseline for this generator (if not already loaded)
  //            // Note: Usually baseline is static per generator, but good to refresh if needed
  //            axiosAepms.getAuxPerformance(selectedGeneratorId).then(res => {
  //               if(res.graph_data && res.graph_data.shop_trial_baseline) {
  //                   const transformedBaseline = {};
  //                   Object.entries(AUX_METRIC_MAPPING).forEach(([frontendKey, backendKey]) => {
  //                       const points = res.graph_data.shop_trial_baseline.map(point => {
  //                            const val = findValueInPoint(point, backendKey);
  //                            return {
  //                                load: point.load_percentage,
  //                                load_kw: point.load_kw,
  //                                load_percentage: point.load_percentage,
  //                                value: val
  //                            };
  //                       }).filter(p => p.value !== null).sort((a,b) => a.load_percentage - b.load_percentage);

  //                       if(points.length > 0) transformedBaseline[frontendKey] = points;
  //                   });
  //                   setBaseline(transformedBaseline);
  //               }
  //            });
  //       }

  //       setHistoricalReports(transformedHistorical);
  //     } else {
  //       // No data found in DB
  //       setHistoricalReports([]);
  //       setMonthlyReports([]);
  //       setBaseline({});
  //       setAeDeviationHistory([]);
  //     }
  //   } catch (error) {
  //     console.error('Failed to load aux engine history:', error);
  //     setHistoricalReports([]);
  //   } finally {
  //     setLoading(false);
  //   }
  // };

  const handleShipChange = (value) => {
    const newShipId =
      typeof value === "string" ? value : value?.target?.value || value;
    setShipId(newShipId);
    localStorage.setItem("selectedShipId", newShipId);
    setShowShopTrialMap({});
    setEnvelopeParam("Pmax");
    setSelectedTrendParams(["Pmax", "SFOC"]);
    setBaselineSource(null);
    setMonthlyReports([]);
    setHistoricalReports([]);
    setBaseline({});
    setShowReport(false);

    // --- ADD THESE 3 LINES ---
    setSelectedRawDownloadIds([]); // Clear download checkboxes
    setDownloadGenId(null); // Clear selected generator
    setDownloadableReports([]); // Clear the dropdown list momentarily
    // -------------------------
    if (onShipChange) onShipChange(newShipId);
  };

  const handleModeChange = (value) => {
    const newMode =
      typeof value === "string" ? value : value?.target?.value || value;
    setAnalysisMode(newMode);
    setBaselineSource(null);
    setUploadMode(newMode);
    setMonthlyReports([]);
    setShowShopTrialMap({});
    setEnvelopeParam("Pmax");
    setSelectedTrendParams(["Pmax", "SFOC"]);
    setHistoricalReports([]);
    setBaseline({});
    setSelectedMetric("all");
    setLoadDiagramData(null);
    setShowReport(false);
    if (onEngineTypeChange) {
      onEngineTypeChange(newMode);
    }
    // Generators and selectedGeneratorId will be reset/fetched by the dedicated useEffect
  };
  const allMonthlyReports = useMemo(() => {
    if (baselineSource === "upload") {
      return monthlyReports;
    }
    const selected = availableReports.filter((r) =>
      displayedReportIds.includes(r.report_id || r.value),
    );

    return selected.sort(
      (a, b) => new Date(b.report_date) - new Date(a.report_date),
    );
  }, [availableReports, displayedReportIds, baselineSource, monthlyReports]);

  const trendData = useMemo(() => {
    const isAux = analysisMode === "auxiliaryEngine";
    const xAxis = isAux ? "load_percentage" : "load";

    // 1. Calculate the cutoff date (exactly 1 year ago from today)
    const oneYearAgo = new Date();
    oneYearAgo.setFullYear(oneYearAgo.getFullYear() - 1);

    // 2. Identify the raw source data
    const rawSource =
      availableReports.length > 0 ? availableReports : allMonthlyReports;

    // 3. Filter: Keep only reports within the last 1 year
    const sourceReports = rawSource.filter((report) => {
      if (!report.report_date) return false;
      const reportDate = new Date(report.report_date);
      return reportDate >= oneYearAgo;
    });

    // 4. Sort chronologically so the trend lines move from left to right
    const sorted = [...sourceReports].sort(
      (a, b) => new Date(a.report_date) - new Date(b.report_date),
    );

    return sorted.map((report) => {
      const targetLoad = isAux ? report.load_percentage : report.load;

      const getDev = (key) => {
        const base = interpolateBaseline(baseline, targetLoad, key, xAxis);
        if (!base || !report[key]) return null;
        return ((report[key] - base) / base) * 100;
      };

      if (isAux) {
        // Mapping for Auxiliary Engine (AE)
        return {
          date: report.displayName,
          Pmax: getDev("Pmax"),
          FIPI: getDev("FIPI"),
          ScavAir: getDev("ScavAirPressure"),
          "Exh_T/C_inlet": getDev("Exh_T/C_inlet"),
          "Exh_T/C_outlet": getDev("Exh_T/C_outlet"),
          Exh_Cylinder_outlet: getDev("Exh_Cylinder_outlet"),
        };
      } else {
        // Mapping for Main Engine (ME)
        return {
          date: report.displayName,
          EngSpeed: getDev("EngSpeed"),
          Turbospeed: getDev("Turbospeed"),
          FIPI: getDev("FIPI"),
          Pmax: getDev("Pmax"),
          Pcomp: getDev("Pcomp"),
          ScavAir: getDev("ScavAir"),
          "Exh_T/C_inlet": getDev("Exh_T/C_inlet"),
          "Exh_T/C_outlet": getDev("Exh_T/C_outlet"),
          Exh_Cylinder_outlet: getDev("Exh_Cylinder_outlet"),
          SFOC: getDev("SFOC"),
        };
      }
    });
  }, [availableReports, allMonthlyReports, baseline, analysisMode]);
  // const allMonthlyReports = useMemo(() => {

  //   const selected = availableReports.filter(r => selectedReportIds.includes(r.report_id || r.value));

  //   return selected.sort((a, b) => new Date(b.report_date) - new Date(a.report_date));
  // }, [availableReports, selectedReportIds]);
  // const allMonthlyReports = useMemo(() => {
  //   const limitMap = { current: 1, last2: 2, last3: 3, last6: 6, last12: 12 };
  //   const limit = limitMap[timeFilter] || 1;

  //   const combined = [...monthlyReports, ...historicalReports];

  //   const uniqueById = combined.reduce((acc, cur) => {
  //     if (!acc.some(r => r.report_id === cur.report_id)) {
  //       acc.push(cur);
  //     }
  //     return acc;
  //   }, []);

  //   const sortedReports = uniqueById.sort(
  //     (a, b) => new Date(b.report_date) - new Date(a.report_date)
  //   );

  //   return sortedReports.slice(0, limit);
  // }, [monthlyReports, historicalReports, timeFilter]);

  // useEffect to trigger Auto Download/Upload after state update
  useEffect(() => {
    // Only run if triggered AND we have reports to show
    if (triggerAutoDownload && allMonthlyReports.length > 0) {
      console.log("🔄 Auto-download sequence initiated...");

      // We need a timeout to allow React to render the charts and tables
      // with the new data. 1500ms is usually safe for animations to finish.
      const timer = setTimeout(() => {
        // 🔴 CHANGE THIS LINE: from 'local' to 'cloud'
        downloadPDF("cloud").then(() => {
          console.log("✅ Auto-upload complete");
          setTriggerAutoDownload(false);
          setIsDataLoaded(false);
        });
      }, 1500);

      return () => clearTimeout(timer);
    }
  }, [triggerAutoDownload, allMonthlyReports]);

  // 🔥 NEW: Dedicated Effect for Button-Click Download
  useEffect(() => {
    // Only run if the LOCAL trigger is active and reports are loaded
    // ADDED CHECK: Object.keys(baseline).length > 0
    // This ensures the PDF waits until the API has returned the "Shop Trial" data.
    if (
      triggerLocalDownload &&
      allMonthlyReports.length > 0 &&
      Object.keys(baseline).length > 0
    ) {
      console.log("⬇️ Local download sequence initiated with baseline data...");

      // Wait 1.5s for Recharts to animate and render
      const timer = setTimeout(() => {
        // Force 'local' mode here explicitly
        downloadPDF("local")
          .then(() => {
            setTriggerLocalDownload(false); // Reset trigger
          })
          .catch((err) => {
            console.error("PDF Download Error:", err);
            setTriggerLocalDownload(false);
          });
      }, 1500);

      return () => clearTimeout(timer);
    } else if (triggerLocalDownload) {
      // Log to console if we are waiting for data
      console.log(
        "⏳ Waiting for Baseline (Shop) data from API before starting PDF...",
      );
    }
  }, [triggerLocalDownload, allMonthlyReports, baseline]);

  const handleFileUpload = async (event) => {
    const file = event.target.files?.[0];
    if (!file) return;

    try {
      setLoading(true);
      // 🔥 Clear previous missing fields at the start of a new upload
      if (typeof setMissingFields === "function") setMissingFields([]);

      if (uploadMode === "mainEngine") {
        const response = await axiosAepms.uploadCsv(shipId, file);

        // --- 🔥 INTEGRITY CHECK (Capture missing fields even if status is success) ---
        const extractedMissing =
          response.missing_parameters || response.missing_fields || [];
        if (
          extractedMissing.length > 0 &&
          typeof setMissingFields === "function"
        ) {
          setMissingFields(extractedMissing);
        }

        // --- HARD STOP: VALIDATION_FAILED ---
        if (response.error_type === "VALIDATION_FAILED") {
          if (typeof setMissingFields === "function") {
            setMissingFields(
              response.missing_fields || response.missing_parameters,
            );
          } else {
            alert(
              `❌ Critical Parameters Missing:\n${(response.missing_fields || response.missing_parameters).join("\n")}`,
            );
          }
          setLoading(false);
          return;
        }

        if (response.graph_data) {
          if (analysisMode !== "mainEngine") setAnalysisMode("mainEngine");

          // --- STRICT VESSEL VALIDATION ---
          const uploadedVesselIMO =
            response.graph_data.vessel_info?.imo_number?.toString();
          const currentShip = fleet.find((s) => s.id === shipId);
          const currentShipIMO = currentShip
            ? (currentShip.imo || currentShip.imo_number)?.toString()
            : null;

          if (
            currentShipIMO &&
            uploadedVesselIMO &&
            currentShipIMO !== uploadedVesselIMO
          ) {
            alert(
              `❌ Upload Error: You selected "${currentShip.name}" but uploaded a report for a different vessel.\n\nPlease upload the correct report for ${currentShip.name}.`,
            );
            setLoading(false);
            return;
          }

          // Transform Baseline
          const transformedBaseline = {};
          const shopTrialData = response.graph_data.shop_trial_baseline;

          Object.entries(MAIN_METRIC_MAPPING).forEach(
            ([frontendKey, backendKey]) => {
              const points = shopTrialData
                .filter(
                  (point) =>
                    point[backendKey] !== null &&
                    point[backendKey] !== undefined,
                )
                .map((point) => ({
                  load: point.load_percentage,
                  value: point[backendKey],
                }))
                .sort((a, b) => a.load - b.load);

              if (points.length > 0) transformedBaseline[frontendKey] = points;
            },
          );

          setBaseline(transformedBaseline);
          setBaselineSource("upload");

          if (response.graph_data.engine_load_diagram_data) {
            setLoadDiagramData(response.graph_data.engine_load_diagram_data);
          } else {
            setLoadDiagramData(null);
          }

          const monthlyPoint = response.graph_data.monthly_performance;
          const rawPoint = response.graph_data.monthly_performance_raw || {};
          const actualPower =
            response.graph_data.engine_load_diagram_data?.actual_operating_point
              ?.power_kw;

          const currentMonth =
            response.graph_data.report_info?.report_month ||
            new Date().toISOString().slice(0, 7);

          const reportDate =
            response.graph_data.report_info?.report_date || null;

          setCurrentReferenceMonth(currentMonth);

          const newReport = {
            month: currentMonth,
            report_date: reportDate,
            load: monthlyPoint.load_percentage || 0,
            effective_power_kw: monthlyPoint.effective_power_kw,
            shaft_power_kw: actualPower,
            color: getMonthColor(currentMonth),
            displayName: getMonthDisplayName(currentMonth),
            report_id: response.report_id,
            propeller_margin_percent: monthlyPoint.propeller_margin_percent,
            cylinder_readings:
              response.graph_data?.monthly_performance?.cylinder_readings ||
              response.iso_cylinder_data,
          };

          Object.entries(MAIN_METRIC_MAPPING).forEach(
            ([frontendKey, backendKey]) => {
              newReport[frontendKey] = monthlyPoint[backendKey] || null;
              newReport[`${frontendKey}_raw`] = rawPoint[backendKey] || null;
            },
          );

          setMonthlyReports([newReport]);

          const ship = fleet.find((s) => s.id === shipId);
          const imoNumber = ship ? parseInt(ship.imo || ship.imo_number) : null;

          if (imoNumber) {
            axiosAepms
              .getMainEngineDeviationHistory(imoNumber, currentMonth)
              .then((data) => setMeDeviationHistory(data.history || []))
              .catch(console.error);

            fetchLastReportDates(imoNumber);
          }

          alert(response.message || "✅ Upload successful!");
          isUploadInProgressRef.current = true;
          setRefreshReportsTrigger((prev) => prev + 1);
          setShowReport(true);
          setTriggerAutoDownload(true);
        }
      } else if (uploadMode === "auxiliaryEngine") {
        const result = await axiosAepms.uploadAuxReport(0, file);

        // --- 🔥 INTEGRITY CHECK (Capture missing fields for AE) ---
        const extractedMissingAE =
          result.missing_parameters || result.missing_fields || [];
        if (
          extractedMissingAE.length > 0 &&
          typeof setMissingFields === "function"
        ) {
          setMissingFields(extractedMissingAE);
        }

        // --- HARD STOP: VALIDATION_FAILED (AUX) ---
        if (result.error_type === "VALIDATION_FAILED") {
          if (typeof setMissingFields === "function") {
            setMissingFields(
              result.missing_fields || result.missing_parameters,
            );
          } else {
            alert(
              `❌ Missing Parameters:\n${(result.missing_fields || result.missing_parameters).join("\n")}`,
            );
          }
          setLoading(false);
          return;
        }

        if (result.graph_data) {
          if (analysisMode !== "auxiliaryEngine")
            setAnalysisMode("auxiliaryEngine");

          const uploadedVesselIMO =
            result?.graph_data?.vessel_info?.imo_number?.toString();
          const currentShip = fleet.find((s) => s.id === shipId);
          const currentShipIMO = currentShip
            ? (currentShip.imo || currentShip.imo_number)?.toString()
            : null;

          if (
            currentShipIMO &&
            uploadedVesselIMO &&
            currentShipIMO !== uploadedVesselIMO
          ) {
            alert(
              `❌ Upload Error: You selected "${currentShip.name}" but uploaded a report for a different vessel.\n\nPlease upload the correct report for ${currentShip.name}.`,
            );
            setLoading(false);
            return;
          }

          const uploadedGeneratorId =
            result?.graph_data?.generator_info?.generator_id ||
            result?.generator_id;

          if (uploadedGeneratorId)
            setSelectedGeneratorId(Number(uploadedGeneratorId));

          const transformedBaseline = {};
          Object.entries(AUX_METRIC_MAPPING).forEach(
            ([frontendKey, backendKey]) => {
              if (result.graph_data.shop_trial_baseline) {
                const points = result.graph_data.shop_trial_baseline
                  .map((point) => {
                    const val = findValueInPoint(point, backendKey);
                    return {
                      load: point.load_percentage,
                      load_kw: point.load_kw,
                      load_percentage: point.load_percentage,
                      value: val,
                    };
                  })
                  .filter((p) => p.value !== null)
                  .sort(
                    (a, b) =>
                      (a.load_percentage || 0) - (b.load_percentage || 0),
                  );

                if (points.length > 0)
                  transformedBaseline[frontendKey] = points;
              }
            },
          );

          setBaseline(transformedBaseline);
          setBaselineSource("upload");

          const monthlyPoint = result.graph_data.monthly_performance;
          const reportMonth = result.graph_data.report_info.report_month;
          const reportDate = result.graph_data.report_info?.report_date || null;

          setCurrentReferenceMonth(reportMonth);

          const newReport = {
            month: reportMonth,
            report_date: reportDate,
            load_kw: monthlyPoint.load_kw,
            load_percentage: monthlyPoint.load_percentage,
            color: getMonthColor(reportMonth),
            displayName: getMonthDisplayName(reportMonth),
            report_id: result.report_id,
            // 🔥 ADDED: Capture cylinder readings from AE backend response
            cylinder_readings: monthlyPoint.cylinder_readings,
          };

          Object.entries(AUX_METRIC_MAPPING).forEach(
            ([frontendKey, backendKey]) => {
              newReport[frontendKey] =
                findValueInPoint(monthlyPoint, backendKey) || null;
            },
          );

          setMonthlyReports([newReport]);

          if (uploadedGeneratorId || selectedGeneratorId) {
            const genIdToFetch = uploadedGeneratorId
              ? Number(uploadedGeneratorId)
              : selectedGeneratorId;

            axiosAepms
              .getAEDeviationHistoryTable(genIdToFetch, reportMonth)
              .then((data) => setAeDeviationHistory(data.history || []))
              .catch(console.error);
          }

          alert(result.message || "✅ Upload successful!");

          if (shipId && fleet.length > 0) {
            const ship = fleet.find((s) => s.id === shipId);
            const imoNumber = ship
              ? parseInt(ship.imo || ship.imo_number)
              : null;

            if (imoNumber) {
              fetchLastReportDates(imoNumber);
            }
          }

          isUploadInProgressRef.current = true;
          setRefreshReportsTrigger((prev) => prev + 1);
          setShowReport(true);
          setTriggerAutoDownload(true);
        }
      }
    } catch (error) {
      console.error("Upload failed:", error);
      alert("❌ " + (error.response?.data?.message || error.message));
    } finally {
      setLoading(false);
    }
  };

  const getLoadDiagramYDomain = (data) => {
    if (!data || !data.propeller_curves || data.propeller_curves.length === 0)
      return [0, 15000];

    const allPowers = data.propeller_curves.flatMap((p) => [
      p.power_service_kw,
      p.power_design_kw,
    ]);
    const maxFixedPower = Math.max(
      data.fixed_limits.mcr_power_kw,
      data.fixed_limits.csr_power_kw,
    );
    const maxPointPower = data.actual_operating_point?.power_kw || 0;
    const maxValue = Math.max(...allPowers, maxFixedPower, maxPointPower);

    const range = maxValue - 0;
    const padding = range * 0.15;

    const niceDomainMax = Math.ceil((maxValue + padding) / 1000) * 1000;

    return [0, niceDomainMax];
  };

  // const renderEngineLoadDiagram = () => {
  //   if (analysisMode !== 'mainEngine' || !loadDiagramData) return null;

  //   const { propeller_curves, actual_operating_point, fixed_limits } = loadDiagramData;
  //   const { mcr_power_kw, csr_power_kw, barred_speed_rpm_start, barred_speed_rpm_end, sea_margin_percent } = fixed_limits;
  //   const yDomain = getLoadDiagramYDomain(loadDiagramData);

  //   const chartData = propeller_curves.map(p => ({
  //       rpm: p.rpm,
  //       power_design_kw: p.power_design_kw,
  //       power_service_kw: p.power_service_kw
  //   }));

  //   const seaMarginPct = sea_margin_percent || 10;
  //   const legendPayload = [
  //       { value: 'Design Propeller (P ∝ n³)', type: 'line', color: '#f97316' },
  //       { value: `Service Propeller (${seaMarginPct}% Sea Margin)`, type: 'line', color: '#3b82f6', payload: { strokeDasharray: '5 5' } },
  //       { value: 'SMCR Power', type: 'line', color: '#16a34a' },
  //       { value: 'CSR Power', type: 'line', color: '#ca8a04', payload: { strokeDasharray: '5 5' } },
  //       { value: `Barred ${barred_speed_rpm_start}-${barred_speed_rpm_end} rpm`, type: 'square', color: '#ffcc80' },
  //   ];

  //   const actualRpm = actual_operating_point.rpm;
  //   const actualPower = actual_operating_point.power_kw;

  //   const servicePropellerPower = interpolateLoadDiagramPower(propeller_curves, actualRpm, 'power_service_kw');

  //   let propellerMarginRatio = null;
  //   let propellerMarginClass = '';

  //   if (actualPower !== null && servicePropellerPower !== null && servicePropellerPower > 0) {
  //       propellerMarginRatio = actualPower / servicePropellerPower;

  //       if (propellerMarginRatio !== null) {
  //           if (propellerMarginRatio >= 1.05) {
  //               propellerMarginClass = 'error-row';
  //           } else if (propellerMarginRatio > 1.0) {
  //               propellerMarginClass = 'warning-row';
  //           } else {
  //               propellerMarginClass = 'success-row';
  //           }
  //       }
  //   }

  //   const tableColorMap = {
  //     'Actual Engine Speed': '#f3f4f6',
  //     'Actual Power': '#f3f4f6',
  //     'SMCR Power': '#d1fae5',
  //     'CSR Power': '#f9dea3ff',
  //     'Barred Speed Range': '#ffdaa3ff',
  //     'Design Propeller Power @ Actual Speed': '#ffb37dff',
  //     'Service Propeller Power @ Actual Speed': '#b6d0f4ff',
  //     'Propeller Margin': 'transparent',
  //   };

  //   return (
  //     <div className="enhanced-card load-diagram-enhanced load-diagram-card">
  //       <div className="card-header-enhanced">
  //         <h3 className="card-title-enhanced">Engine Load Diagram</h3>
  //         <p className="card-description-enhanced">
  //           Operating Point on Engine Load Diagram ({seaMarginPct}% Sea Margin; Barred {barred_speed_rpm_start}-{barred_speed_rpm_end} rpm)
  //         </p>
  //       </div>
  //       <div className="card-content-enhanced">
  //         <div style={{ width: '100%', height: '450px' }}>
  //           <ResponsiveContainer width="100%" height="100%">
  //             <LineChart data={chartData} margin={{ left: 60, right: 20, top: 20, bottom: 30 }}>
  //               <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />

  //               {barred_speed_rpm_start && barred_speed_rpm_end && (
  //                 <ReferenceArea
  //                   x1={barred_speed_rpm_start}
  //                   x2={barred_speed_rpm_end}
  //                   y1={yDomain[0]}
  //                   y2={yDomain[1]}
  //                   stroke="none"
  //                   fill="#ffcc80"
  //                   fillOpacity={0.4}
  //                 />
  //               )}

  //               <XAxis
  //                 dataKey="rpm"
  //                 type="number"
  //                 domain={[30, 'dataMax']}
  //                 label={{ value: 'Engine Speed (rpm)', position: 'insideBottom', offset: -10, style: { fontWeight: 600 } }}
  //                 allowDecimals={false}
  //                 tickCount={10}
  //                 stroke="#64748b"
  //               />

  //               <YAxis
  //                 width={70}
  //                 domain={yDomain}
  //                 label={{ value: 'Power (kW)', angle: -90, position: 'insideLeft', offset: 10, style: { fontWeight: 600 } }}
  //                 tickFormatter={(v) => v.toFixed(0)}
  //                 stroke="#64748b"
  //               />

  //               <Tooltip
  //                 formatter={(value, name) => [`${value.toFixed(0)} kW`, name]}
  //                 labelFormatter={(label) => `Engine Speed: ${label.toFixed(1)} rpm`}
  //                 contentStyle={{
  //                   backgroundColor: 'white',
  //                   border: '2px solid #e2e8f0',
  //                   borderRadius: '8px',
  //                   boxShadow: '0 4px 6px -1px rgba(0, 0, 0, 0.1)'
  //                 }}
  //               />

  //               <Legend
  //                 layout="vertical"
  //                 verticalAlign="top"
  //                 align="left"
  //                 payload={legendPayload}
  //                 wrapperStyle={{
  //                   top: 10,
  //                   left: 10,
  //                   backgroundColor: 'white',
  //                   border: '2px solid #cbd5e1',
  //                   padding: '12px',
  //                   borderRadius: '8px',
  //                   boxShadow: '0 4px 6px -1px rgba(0, 0, 0, 0.1)',
  //                   fontSize: '13px',
  //                   fontWeight: 600
  //                 }}
  //               />

  //               {mcr_power_kw && (
  //                 <ReferenceLine
  //                   y={mcr_power_kw}
  //                   stroke="#16a34a"
  //                   strokeWidth={2}
  //                 />
  //               )}

  //               {csr_power_kw && (
  //                 <ReferenceLine
  //                   y={csr_power_kw}
  //                   stroke="#ca8a04"
  //                   strokeWidth={2}
  //                   strokeDasharray="5 5"
  //                 />
  //               )}

  //               <Line
  //                 type="monotone"
  //                 dataKey="power_design_kw"
  //                 stroke="#f97316"
  //                 strokeWidth={2}
  //                 dot={false}
  //                 name="Design Propeller (P ∝ n³)"
  //                 isAnimationActive={false}

  //               />

  //               <Line
  //                 type="monotone"
  //                 dataKey="power_service_kw"
  //                 stroke="#3b82f6"
  //                 strokeWidth={2}
  //                 strokeDasharray="3 3"
  //                 dot={false}
  //                 name={`Service Propeller (${seaMarginPct}% Sea Margin)`}
  //                 isAnimationActive={false}
  //               />

  //               {actual_operating_point.rpm && actual_operating_point.power_kw && (
  //                 <>
  //                   <ReferenceDot
  //                     x={actual_operating_point.rpm}
  //                     y={actual_operating_point.power_kw}
  //                     shape={<CustomColoredXMarker cx={0} cy={0} fill="#000000" />}
  //                     fill="#000000"
  //                     isAnimationActive={false}
  //                   />
  //                   <ReferenceLine
  //                     x={actual_operating_point.rpm}
  //                     y={actual_operating_point.power_kw}
  //                     label={{
  //                       value: `Actual: ${actual_operating_point.rpm.toFixed(1)} rpm / ${actual_operating_point.power_kw.toFixed(0)} kW`,
  //                       position: 'top',
  //                       fill: '#1e293b',
  //                       fontSize: 13,
  //                       fontWeight: 700,
  //                       offset: 15
  //                     }}
  //                     strokeOpacity={0}
  //                   />
  //                 </>
  //               )}
  //             </LineChart>
  //           </ResponsiveContainer>
  //         </div>

  //         <div className="load-diagram-data-table-enhanced">
  //           <h4 className="load-diagram-table-title">Engine Load Diagram Data</h4>
  //           <table className="load-diagram-table">
  //             <thead>
  //               <tr>
  //                 <th>Parameter</th>
  //                 <th>Value</th>
  //                 <th>Unit</th>
  //               </tr>
  //             </thead>
  //             <tbody>
  //               <tr style={{ backgroundColor: tableColorMap['Actual Engine Speed'] }}>
  //                 <td>Actual Engine Speed</td>
  //                 <td>{actual_operating_point.rpm?.toFixed(1) || 'N/A'}</td>
  //                 <td>rpm</td>
  //               </tr>
  //               <tr style={{ backgroundColor: tableColorMap['Actual Power'] }}>
  //                 <td>Actual Power</td>
  //                 <td>{actual_operating_point.power_kw?.toFixed(0) || 'N/A'}</td>
  //                 <td>kW</td>
  //               </tr>
  //               <tr style={{ backgroundColor: tableColorMap['SMCR Power'] }}>
  //                 <td>SMCR Power</td>
  //                 <td>{mcr_power_kw?.toFixed(0) || 'N/A'}</td>
  //                 <td>kW</td>
  //               </tr>
  //               <tr style={{ backgroundColor: tableColorMap['CSR Power'] }}>
  //                 <td>CSR Power</td>
  //                 <td>{csr_power_kw?.toFixed(0) || 'N/A'}</td>
  //                 <td>kW</td>
  //               </tr>
  //               <tr style={{ backgroundColor: tableColorMap['Barred Speed Range'] }}>
  //                 <td>Barred Speed Range</td>
  //                 <td>{barred_speed_rpm_start} - {barred_speed_rpm_end}</td>
  //                 <td>rpm</td>
  //               </tr>
  //               <tr style={{ backgroundColor: tableColorMap['Design Propeller Power @ Actual Speed'] }}>
  //                 <td>Design Propeller Power @ Actual Speed</td>
  //                 <td>{interpolateLoadDiagramPower(propeller_curves, actualRpm, 'power_design_kw')?.toFixed(0) || 'N/A'}</td>
  //                 <td>kW</td>
  //               </tr>
  //               <tr style={{ backgroundColor: tableColorMap['Service Propeller Power @ Actual Speed'] }}>
  //                 <td>Service Propeller Power @ Actual Speed</td>
  //                 <td>{servicePropellerPower?.toFixed(0) || 'N/A'}</td>
  //                 <td>kW</td>
  //               </tr>
  //               <tr className={propellerMarginClass} style={{ backgroundColor: tableColorMap['Propeller Margin'] }}>
  //                 <td>Propeller Margin</td>
  //                 <td>{propellerMarginRatio !== null ? `${(propellerMarginRatio * 100).toFixed(1)}` : 'N/A'}</td>
  //                 <td>%</td>
  //               </tr>
  //             </tbody>
  //           </table>
  //         </div>
  //       </div>
  //     </div>
  //   );
  // };
  const renderEngineLoadDiagram = () => {
    const formatToDMY = (dateStr) => {
      if (!dateStr || !dateStr.includes("-")) return dateStr;
      const [y, m, d] = dateStr.split("-");
      return `${d}/${m}/${y}`;
    };
    // 1. Guard Clause
    if (analysisMode !== "mainEngine" || !loadDiagramData) return null;

    const { propeller_curves, fixed_limits } = loadDiagramData;

    // --- STEP 1: EXTRACT LIMITS & REFERENCES ---
    const {
      mcr_power_kw,
      csr_power_kw,
      mcr_speed_rpm, // Expecting 105 here
      barred_speed_rpm_start,
      barred_speed_rpm_end,
      light_running_margin_percent,
    } = fixed_limits;

    // --- CRITICAL FIX FOR 74.4% vs 78.1% ---
    // 1. If mcr_speed_rpm (105) exists, USE IT.
    // 2. If not, try to find the RPM where Power matches MCR Power.
    // 3. Only fallback to curve Max (110) if absolutely nothing else exists.
    let refMcrSpeed = mcr_speed_rpm;

    if (!refMcrSpeed || refMcrSpeed === 0) {
      // Fallback: Check if we can find the RPM at MCR Power in the curves
      const mcrPoint = propeller_curves.find(
        (p) => Math.abs(p.power_kw - mcr_power_kw) < 50,
      );
      if (mcrPoint) {
        refMcrSpeed = mcrPoint.rpm;
      } else {
        // Last resort: Use max curve RPM (This is what caused your 110 issue previously)
        refMcrSpeed =
          propeller_curves.length > 0
            ? Math.max(...propeller_curves.map((p) => p.rpm))
            : 100;
      }
    }

    // Determine Reference Power (MCR Power)
    const refMcrPower =
      mcr_power_kw && mcr_power_kw > 0
        ? mcr_power_kw
        : csr_power_kw
          ? csr_power_kw / 0.85
          : 10000;

    // --- STEP 2: CALCULATE CUBIC CONSTANTS ---
    // Force the curve to hit exactly 100% Power at 100% Speed (Point M)
    const k_design = refMcrPower / Math.pow(refMcrSpeed, 3);

    const lightRunningMargin =
      light_running_margin_percent !== undefined
        ? light_running_margin_percent
        : 5;
    const lightRunningMultiplier =
      1 / Math.pow(1 + lightRunningMargin / 100, 3);
    const k_light = k_design * lightRunningMultiplier;

    // --- STEP 3: PREPARE PLOT POINTS (CONVERT TO % SMCR) ---
    const plotPoints = allMonthlyReports
      .map((report) => {
        const rpm = Number(
          report.EngSpeed !== undefined ? report.EngSpeed : report.rpm,
        );
        let power = Number(report.shaft_power_kw || report.power_kw);

        if ((!power || power === 0) && report.load && refMcrPower) {
          power = (report.load * refMcrPower) / 100;
        }

        if (!rpm || !power) return null;

        // CRITICAL: Calculate percentage using the strict refMcrSpeed (105)
        // 82 / 105 * 100 = 78.09%
        const rpmPercentage = (rpm / refMcrSpeed) * 100;

        return {
          ...report,
          rpm_abs: rpm,
          power_abs: power,
          rpm_pct: rpmPercentage,
          power_pct: (power / refMcrPower) * 100,
          displayName: report.displayName || report.month,
        };
      })
      .filter((p) => p !== null);

    // --- STEP 4: INTELLIGENT AXIS SCALING ---
    let minDataRpm = 100;
    let maxDataRpm = 0;
    let minDataPwr = 100;
    let maxDataPwr = 0;

    if (plotPoints.length > 0) {
      minDataRpm = Math.min(...plotPoints.map((p) => p.rpm_pct));
      maxDataRpm = Math.max(...plotPoints.map((p) => p.rpm_pct));
      minDataPwr = Math.min(...plotPoints.map((p) => p.power_pct));
      maxDataPwr = Math.max(...plotPoints.map((p) => p.power_pct));
    } else {
      minDataRpm = 40;
      maxDataRpm = 100;
      minDataPwr = 10;
      maxDataPwr = 100;
    }

    // Scale X-Axis: Ensure it covers at least 105% if data goes there, but standard view is 100%
    const xMin = 50;
    const xMax = Math.ceil(Math.max(105, maxDataRpm + 2));
    const yMin = 30;
    const yMax = Math.ceil(Math.max(110, maxDataPwr + 10));

    // --- STEP 5: GENERATE CURVES ---
    const chartData = [];
    for (let pct = xMin; pct <= xMax; pct += 1) {
      const absRpm = (pct / 100) * refMcrSpeed;
      const absPowerDesign = k_design * Math.pow(absRpm, 3);
      const absPowerLight = k_light * Math.pow(absRpm, 3);

      chartData.push({
        rpm_pct: pct,
        power_design_pct: (absPowerDesign / refMcrPower) * 100,
        power_light_running_pct: (absPowerLight / refMcrPower) * 100,
      });
    }

    const visiblePoints = plotPoints.filter((p) => p.rpm_pct >= xMin);

    // --- STEP 6: TICKS CONFIG ---
    const generateTicks = (min, max, step = 10) => {
      const ticks = [];
      const start = Math.ceil(min / step) * step;
      for (let i = start; i <= max; i += step) ticks.push(i);
      return ticks;
    };

    const xStep = xMax - xMin > 40 ? 10 : 5;
    const yStep = yMax - yMin > 60 ? 10 : 10;

    const xTicks = generateTicks(xMin, xMax, xStep);
    const yTicks = generateTicks(yMin, yMax, yStep);

    // Reference Lines
    const smcrPct = 100;
    const csrPct = csr_power_kw ? (csr_power_kw / refMcrPower) * 100 : 85;
    const barredStartPct = barred_speed_rpm_start
      ? (barred_speed_rpm_start / refMcrSpeed) * 100
      : null;
    const barredEndPct = barred_speed_rpm_end
      ? (barred_speed_rpm_end / refMcrSpeed) * 100
      : null;

    // --- STEP 7: TABLE CALCULATIONS ---
    const primaryPoint = visiblePoints.length === 1 ? visiblePoints[0] : null;

    let tableVars = {
      rpm: 0,
      actual: 0,
      shop: 0,
      light: 0,
      status: "N/A",
      color: "black",
      powerDev: 0,
      rpmDev: 0,
    };

    if (primaryPoint) {
      tableVars.rpm = primaryPoint.rpm_abs;
      tableVars.actual = primaryPoint.power_abs;

      tableVars.shop = k_design * Math.pow(tableVars.rpm, 3);
      tableVars.light = k_light * Math.pow(tableVars.rpm, 3);

      if (tableVars.actual > 0 && tableVars.shop > 0) {
        // Power Deviation
        tableVars.powerDev =
          ((tableVars.actual - tableVars.shop) / tableVars.shop) * 100;

        // RPM Deviation
        const expectedRpmAtActualPower = Math.pow(
          tableVars.actual / k_design,
          1 / 3,
        );
        tableVars.rpmDev =
          ((tableVars.rpm - expectedRpmAtActualPower) /
            expectedRpmAtActualPower) *
          100;

        if (tableVars.actual > tableVars.shop) {
          tableVars.status = "Heavy Running (Overload)";
          tableVars.color = "#dc2626";
        } else if (tableVars.actual >= tableVars.light) {
          tableVars.status = "Normal Operation (Ideal)";
          tableVars.color = "#16a34a";
        } else {
          tableVars.status = "Very Light Running";
          tableVars.color = "#2563eb";
        }
      }
    }

    const tableColorMap = {
      "Actual Engine Speed": "#f3f4f6",
      "Actual Power": "#f3f4f6",
      "SMCR Power": "#d1fae5",
      "CSR Power": "#f9dea3ff",
      "Barred Speed Range": "#ffdaa3ff",
      "Shop Trial Power": "#ffb37dff",
      "Light Running Power": "#e9d5ff",
      Status: "transparent",
    };

    const CustomCrossDot = (props) => {
      const { cx, cy, payload } = props;
      if (!Number.isFinite(cx) || !Number.isFinite(cy)) return null;
      const color = payload.color || "#000000";
      return (
        <g transform={`translate(${cx},${cy})`}>
          <line x1="-6" y1="-6" x2="6" y2="6" stroke={color} strokeWidth="3" />
          <line x1="-6" y1="6" x2="6" y2="-6" stroke={color} strokeWidth="3" />
        </g>
      );
    };

    const CustomLoadTooltip = ({ active, payload }) => {
      if (active && payload && payload.length) {
        const scatterPoint = payload.find((p) => p.dataKey === "power_pct");
        if (scatterPoint) {
          const pt = scatterPoint.payload;
          let statusLabel = "Normal";
          let statusColor = "#16a34a";
          const designPowerAtPt = k_design * Math.pow(pt.rpm_abs, 3);
          const lightPowerAtPt = k_light * Math.pow(pt.rpm_abs, 3);

          if (pt.power_abs > designPowerAtPt) {
            statusLabel = "Heavy Running";
            statusColor = "#dc2626";
          } else if (pt.power_abs < lightPowerAtPt) {
            statusLabel = "Very Light Running";
            statusColor = "#2563eb";
          }

          return (
            <div
              style={{
                backgroundColor: "white",
                padding: "10px",
                border: "1px solid #ccc",
                borderRadius: "5px",
                boxShadow: "0 2px 8px rgba(0,0,0,0.15)",
                zIndex: 999,
              }}
            >
              <p
                style={{
                  fontWeight: "bold",
                  borderBottom: "1px solid #eee",
                  marginBottom: "5px",
                  color: "#1e293b",
                }}
              >
                {pt.displayName}
              </p>
              <div
                style={{
                  display: "grid",
                  gridTemplateColumns: "1fr auto",
                  gap: "10px",
                  fontSize: "0.85rem",
                }}
              >
                <span style={{ color: "#64748b" }}>Speed:</span>
                <span>
                  <strong>{pt.rpm_pct.toFixed(1)}%</strong> (
                  {pt.rpm_abs.toFixed(1)} rpm)
                </span>
                <span style={{ color: "#64748b" }}>Power:</span>
                <span>
                  <strong>{pt.power_pct.toFixed(1)}%</strong> (
                  {pt.power_abs.toFixed(0)} kW)
                </span>
              </div>
              <hr
                style={{
                  margin: "5px 0",
                  border: "none",
                  borderTop: "1px dashed #eee",
                }}
              />
              <p
                style={{
                  margin: "3px 0",
                  fontSize: "0.85rem",
                  fontWeight: "bold",
                  color: statusColor,
                }}
              >
                {statusLabel}
              </p>
            </div>
          );
        }
      }
      return null;
    };

    const legendPayload = [
      { value: "Selected Reports", type: "cross", color: "#000000" },
      { value: "Shop Trial (MCR)", type: "line", color: "#f97316" },
      {
        value: `Light Running (${lightRunningMargin}%)`,
        type: "line",
        color: "#8b5cf6",
        payload: { strokeDasharray: "3 3" },
      },
    ];

    return (
      <div className="enhanced-card load-diagram-enhanced load-diagram-card">
        <div
  className="card-header-enhanced"
  onClick={() => setIsLoadDiagramExpanded(!isLoadDiagramExpanded)}
  style={{
    cursor: "pointer",
    display: "flex",
    justifyContent: "space-between",
    alignItems: "center",
    userSelect: "none",
    padding: "10px 16px",
  }}
>
          <div>
            <h3 className="card-title-enhanced" style={{ margin: 0, fontSize: "1rem" }}>
  Engine Load Diagram (% SMCR)
</h3>
<p className="card-description-enhanced" style={{ margin: 0, fontSize: "0.78rem" }}>
  Logarithmic Scale normalized to SMCR (Point M)
</p>
          </div>

          {/* Animated Chevron Icon */}
          <span
            style={{
              fontSize: "1.1rem",
              color: "#94a3b8",
              transition: "transform 0.3s ease",
              transform: isLoadDiagramExpanded
                ? "rotate(180deg)"
                : "rotate(0deg)",
            }}
          >
            ▼
          </span>
        </div>
        {isLoadDiagramExpanded && (
          <div className="card-content-enhanced">
            <div
              style={{
                display: "flex",
                flexWrap: "wrap",
                gap: "15px",
                justifyContent: "center",
                marginBottom: "20px",
                fontSize: "0.8rem",
                padding: "10px",
                backgroundColor: "#f8fafc",
                borderRadius: "8px",
                border: "1px solid #e2e8f0",
              }}
            >
              {legendPayload.map((item, idx) => (
                <div
                  key={idx}
                  style={{ display: "flex", alignItems: "center", gap: "6px" }}
                >
                  {item.type === "line" && (
                    <div
                      style={{
                        width: 24,
                        height: 0,
                        backgroundColor: "transparent",
                        borderTop: item.payload?.strokeDasharray
                          ? `3px dashed ${item.color}`
                          : `3px solid ${item.color}`,
                      }}
                    ></div>
                  )}
                  {item.type === "square" && (
                    <div
                      style={{
                        width: 14,
                        height: 14,
                        backgroundColor: item.color,
                        opacity: 0.5,
                      }}
                    ></div>
                  )}
                  {item.type === "cross" && (
                    <div
                      style={{
                        fontWeight: "900",
                        fontSize: "18px",
                        lineHeight: "10px",
                        color: item.color,
                      }}
                    >
                      ×
                    </div>
                  )}
                  <span style={{ color: "#475569", fontWeight: 600 }}>
                    {item.value}
                  </span>
                </div>
              ))}
            </div>

            <div style={{ width: "100%", height: "550px" }}>
              <ResponsiveContainer width="100%" height="100%">
                <ComposedChart
                  data={chartData}
                  margin={{ left: 35, right: 30, top: 10, bottom: 50 }}
                  onMouseLeave={() => setLoadDiagramTooltip(null)}
                  onClick={(e) =>
                    e && e.activePayload
                      ? setLoadDiagramTooltip(e.activePayload)
                      : setLoadDiagramTooltip(null)
                  }
                >
                  <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />

                  {barredStartPct && barredEndPct && (
                    <ReferenceArea
                      x1={barredStartPct}
                      x2={barredEndPct}
                      y1={yMin}
                      y2={yMax}
                      stroke="none"
                      fill="#ffcc80"
                      fillOpacity={0.4}
                      ifOverflow="hidden"
                    />
                  )}

                  <XAxis
                    dataKey="rpm_pct"
                    type="number"
                    scale="log"
                    domain={[xMin, xMax]}
                    ticks={xTicks}
                    label={{
                      value: "Engine Speed (%)",
                      position: "insideBottom",
                      offset: -35,
                      style: { fontWeight: 600, fill: "#64748b" },
                    }}
                    allowDecimals={false}
                    stroke="#94a3b8"
                    allowDataOverflow={true}
                    tick={{ fill: "#64748b" }}
                  />

                  <YAxis
                    width={90}
                    scale="log"
                    domain={[yMin, yMax]}
                    ticks={yTicks}
                    interval={0}
                    label={{
                      value: "Power (%)",
                      angle: -90,
                      position: "insideLeft",
                      offset: 15,
                      style: { fontWeight: 600, fill: "#64748b" },
                    }}
                    tickFormatter={(v) => `${v}%`}
                    stroke="#94a3b8"
                    allowDataOverflow={true}
                    tick={{ fill: "#64748b", fontSize: 12 }}
                  />

                  <Tooltip
                    active={!!loadDiagramTooltip}
                    payload={loadDiagramTooltip}
                    content={<CustomLoadTooltip />}
                    cursor={{
                      stroke: "#94a3b8",
                      strokeWidth: 1,
                      strokeDasharray: "4 4",
                    }}
                  />

                  <ReferenceLine
                    y={smcrPct}
                    stroke="#16a34a"
                    strokeWidth={2}
                    label={{
                      value: `SMCR (M) - ${refMcrPower?.toLocaleString(undefined, { maximumFractionDigits: 0 })} kW`,
                      fill: "#16a34a",
                      position: "insideLeft",
                      fontWeight: "bold",
                      fontSize: 12,
                      dy: -12,
                    }}
                  />

                  <ReferenceLine
                    y={csrPct}
                    stroke="#ca8a04"
                    strokeWidth={2}
                    strokeDasharray="5 5"
                    label={{
                      value: `CSR - ${csr_power_kw ? csr_power_kw.toLocaleString(undefined, { maximumFractionDigits: 0 }) : (refMcrPower * 0.85).toFixed(0)} kW`,
                      fill: "#ca8a04",
                      position: "insideLeft",
                      fontWeight: "bold",
                      fontSize: 12,
                      dy: -12,
                    }}
                  />

                  <Line
                    type="monotone"
                    dataKey="power_design_pct"
                    stroke="#f97316"
                    strokeWidth={2}
                    dot={false}
                    name="Design Curve"
                    isAnimationActive={false}
                  />
                  <Line
                    type="monotone"
                    dataKey="power_light_running_pct"
                    stroke="#8b5cf6"
                    strokeWidth={2}
                    strokeDasharray="3 3"
                    dot={false}
                    name="Light Running"
                    isAnimationActive={false}
                  />

                  <Scatter
                    name="Selected Reports"
                    data={visiblePoints}
                    dataKey="power_pct"
                    shape={(props) => {
                      const { cx, cy, payload } = props;

                      // 1. Calculate Power Deviation (%)
                      const designPowerAtPt =
                        k_design * Math.pow(payload.rpm_abs, 3);
                      const pwrDevVal =
                        ((payload.power_abs - designPowerAtPt) /
                          designPowerAtPt) *
                        100;

                      // 2. Calculate RPM Deviation (%)
                      const expectedRpmAtPt = Math.pow(
                        payload.power_abs / k_design,
                        1 / 3,
                      );
                      const rpmDevVal =
                        ((payload.rpm_abs - expectedRpmAtPt) /
                          expectedRpmAtPt) *
                        100;

                      return (
                        <g
                          style={{ cursor: "pointer", outline: "none" }} // Added outline none
                          tabIndex="-1" // Added tabIndex
                          onClick={(e) => {
                            e.stopPropagation();
                            setActivePoint({
                              x: payload.rpm_pct,
                              y: payload.power_pct,
                              cx: cx,
                              cy: cy,
                              name: payload.displayName,
                              // 🔥 Date formatting: DD/MM/YYYY
                              date: payload.report_date
                                ? payload.report_date
                                    .split("-")
                                    .reverse()
                                    .join("/")
                                : "",
                              color: payload.color || "#000000",
                              absX: payload.rpm_abs,
                              absY: payload.power_abs,
                              pwrDev: pwrDevVal,
                              speedDev: rpmDevVal,
                              metricKey: "LoadDiagram",
                            });
                          }}
                        >
                          <CustomCrossDot {...props} />
                          <circle cx={0} cy={0} r={12} fill="transparent" />
                        </g>
                      );
                    }}
                    cursor="pointer"
                    isAnimationActive={false}
                  />
                  {/* Informational Card Popup for Load Diagram */}
                  {activePoint && activePoint.metricKey === "LoadDiagram" && (
                    <ReferenceDot
                      x={activePoint.x}
                      y={activePoint.y}
                      shape={() => {
                        // 1. Define Card Dimensions
                        const cardW = 215;
                        const cardH = 165;
                        const padding = 15;

                        // 2. Determine Vertical Positioning (Flip if too close to the top)
                        // If dot (cy) is less than card height + padding, show below point, otherwise show above
                        const showBelow = activePoint.cy < cardH + padding;
                        const posY = showBelow
                          ? activePoint.cy + padding
                          : activePoint.cy - (cardH + 5);

                        // 3. Determine Horizontal Positioning (Flip if too far to the right)
                        // If dot (cx) is far to the right, shift card to the left side of the dot
                        const showLeft = activePoint.cx > 450;
                        const posX = showLeft
                          ? activePoint.cx - (cardW + padding)
                          : activePoint.cx + 10;

                        return (
                          <g>
                            {/* 🔥 SOLID BACKGROUND SHIELD: Coordinates now dynamically linked to posX/posY */}
                            <rect
                              x={posX}
                              y={posY}
                              width={cardW}
                              height={cardH}
                              fill="#ffffff"
                              fillOpacity="1"
                              opacity="1"
                              rx="8"
                              style={{
                                filter:
                                  "drop-shadow(0px 4px 10px rgba(0,0,0,0.25))",
                              }}
                            />

                            <foreignObject
                              x={posX}
                              y={posY}
                              width={cardW}
                              height={cardH}
                              style={{ pointerEvents: "none" }}
                            >
                              <div
                                style={{
                                  background: "#ffffff !important",
                                  backgroundColor: "#ffffff !important",
                                  opacity: "1 !important",
                                  padding: "14px",
                                  border: `1.5px solid ${activePoint.color}`,
                                  borderRadius: "8px",
                                  fontSize: "12px",
                                  fontFamily: "Inter, sans-serif",
                                  color: "#1e293b",
                                  height: "100%",
                                  boxSizing: "border-box",
                                  display: "flex",
                                  flexDirection: "column",
                                  justifyContent: "space-between",
                                  zIndex: 10000,
                                }}
                              >
                                {/* Header */}
                                <div
                                  style={{
                                    fontWeight: "800",
                                    borderBottom: "1px solid #f1f5f9",
                                    paddingBottom: "6px",
                                    marginBottom: "6px",
                                  }}
                                >
                                  {activePoint.name}
                                </div>

                                {/* Main Data Points */}
                                <div
                                  style={{
                                    display: "flex",
                                    justifyContent: "space-between",
                                  }}
                                >
                                  <span style={{ color: "#64748b" }}>
                                    Speed:
                                  </span>
                                  <span>
                                    <strong>{activePoint.x.toFixed(1)}%</strong>{" "}
                                    ({activePoint.absX.toFixed(1)} rpm)
                                  </span>
                                </div>

                                <div
                                  style={{
                                    display: "flex",
                                    justifyContent: "space-between",
                                  }}
                                >
                                  <span style={{ color: "#64748b" }}>
                                    Power:
                                  </span>
                                  <span>
                                    <strong>{activePoint.y.toFixed(1)}%</strong>{" "}
                                    ({activePoint.absY.toFixed(0)} kW)
                                  </span>
                                </div>

                                {/* Deviation Section */}
                                <div
                                  style={{
                                    display: "flex",
                                    justifyContent: "space-between",
                                  }}
                                >
                                  <span style={{ color: "#64748b" }}>
                                    Pwr Dev:
                                  </span>
                                  <span
                                    style={{
                                      fontWeight: "bold",
                                      color: "#1e293b",
                                    }}
                                  >
                                    {" "}
                                    {/* Fixed Color */}
                                    {activePoint.pwrDev > 0 ? "+" : ""}
                                    {activePoint.pwrDev.toFixed(1)}%
                                  </span>
                                </div>

                                <div
                                  style={{
                                    display: "flex",
                                    justifyContent: "space-between",
                                  }}
                                >
                                  <span style={{ color: "#64748b" }}>
                                    Speed Dev:
                                  </span>
                                  <span
                                    style={{
                                      fontWeight: "bold",
                                      color: "#1e293b",
                                    }}
                                  >
                                    {" "}
                                    {/* Fixed Color */}
                                    {activePoint.speedDev > 0 ? "+" : ""}
                                    {activePoint.speedDev.toFixed(1)}%
                                  </span>
                                </div>

                                {/* Date Footer */}
                                <div
                                  style={{
                                    marginTop: "auto",
                                    fontSize: "10px",
                                    color: "#94a3b8",
                                    textAlign: "right",
                                    fontWeight: "500",
                                  }}
                                >
                                  {activePoint.date}
                                </div>
                              </div>
                            </foreignObject>
                          </g>
                        );
                      }}
                    />
                  )}
                </ComposedChart>
              </ResponsiveContainer>
            </div>

            {/* {primaryPoint && (
              <div className="load-diagram-data-table-enhanced">
                <h4 className="load-diagram-table-title">
                  Data - {primaryPoint.displayName}
                </h4>
                <table className="load-diagram-table">
                  <thead>
                    <tr>
                      <th>Parameter</th>
                      <th>Value</th>
                      <th>Unit</th>
                    </tr>
                  </thead>
                  <tbody>
                    <tr
                      style={{
                        backgroundColor: tableColorMap["Actual Engine Speed"],
                      }}
                    >
                      <td>Actual Engine Speed</td>
                      <td>{tableVars.rpm?.toFixed(1) || "N/A"}</td>
                      <td>rpm ({primaryPoint.rpm_pct.toFixed(1)}%)</td>
                    </tr>
                    <tr
                      style={{ backgroundColor: tableColorMap["Actual Power"] }}
                    >
                      <td>Actual Power</td>
                      <td>{tableVars.actual?.toFixed(0) || "N/A"}</td>
                      <td>kW ({primaryPoint.power_pct.toFixed(1)}%)</td>
                    </tr>
                    <tr
                      style={{ backgroundColor: tableColorMap["SMCR Power"] }}
                    >
                      <td>SMCR Power</td>
                      <td>{mcr_power_kw?.toFixed(0) || "N/A"}</td>
                      <td>kW</td>
                    </tr>
                    <tr style={{ backgroundColor: tableColorMap["CSR Power"] }}>
                      <td>CSR Power</td>
                      <td>{csr_power_kw?.toFixed(0) || "N/A"}</td>
                      <td>kW</td>
                    </tr>
                    <tr
                      style={{
                        backgroundColor: tableColorMap["Barred Speed Range"],
                      }}
                    >
                      <td>Barred Speed Range</td>
                      <td>
                        {barred_speed_rpm_start} - {barred_speed_rpm_end}
                      </td>
                      <td>rpm</td>
                    </tr>
                    <tr
                      style={{
                        backgroundColor: tableColorMap["Shop Trial Power"],
                      }}
                    >
                      <td>Shop Trial Power @ Actual Speed</td>
                      <td>{tableVars.shop?.toFixed(0) || "N/A"}</td>
                      <td>kW</td>
                    </tr>
                    <tr
                      style={{
                        backgroundColor: tableColorMap["Light Running Power"],
                      }}
                    >
                      <td>Light Running Power (-{lightRunningMargin}%)</td>
                      <td>{tableVars.light?.toFixed(0) || "N/A"}</td>
                      <td>kW</td>
                    </tr>

                    <tr style={{ backgroundColor: '#fff', borderTop: '2px solid #f1f5f9' }}>
                        <td style={{ fontWeight: 'bold', color: '#334155' }}>Running Status</td>
                        <td style={{ fontWeight: 'bold', color: tableVars.color }}>{tableVars.status}</td>
                        <td>-</td>
                      </tr>

                    <tr style={{ backgroundColor: "#fff" }}>
                      <td>Power Deviation</td>
                      <td style={{ fontWeight: "bold", color: "#1e293b" }}>
                        {" "}
                        {tableVars.powerDev > 0 ? "+" : ""}
                        {tableVars.powerDev.toFixed(1)}%
                      </td>
                      <td>%</td>
                    </tr>

                    <tr style={{ backgroundColor: "#fff" }}>
                      <td>RPM Deviation</td>
                      <td style={{ fontWeight: "bold", color: "#1e293b" }}>
                        {" "}
                        {tableVars.rpmDev > 0 ? "+" : ""}
                        {tableVars.rpmDev.toFixed(1)}%
                      </td>
                      <td>%</td>
                    </tr>
                  </tbody>
                </table>
              </div>
            )} */}
          </div>
        )}
      </div>
    );
  };
  const renderSummaryTable = () => {
    // 1. Safety Checks
    if (
      !shipId ||
      !allMonthlyReports.length ||
      !baseline ||
      Object.keys(baseline).length === 0
    )
      return null;

    const isAux = analysisMode === "auxiliaryEngine";
    const metricMapping = isAux ? AUX_METRIC_MAPPING : MAIN_METRIC_MAPPING;

    // Display Names Map
    const metricDisplayNames = {
      FIPI: "Fuel Pump Index",
      Turbospeed: "Turbo Speed",
      EngSpeed: "Engine Speed",
      ScavAir: "Scavenge Air Pressure",
      Pmax: "Pmax",
      Pcomp: "Pcomp",
      Exh_Cylinder_outlet: "Exh. Cylinder Outlet",
      "Exh_T/C_inlet": "Exh. T/C Inlet",
      "Exh_T/C_outlet": "Exh. T/C Outlet",
      SFOC: "SFOC",
      // "FOC": "FOC"
    };
    const MAIN_ORDER = [
      "EngSpeed",
      "Turbospeed",
      "FIPI",
      "Pmax",
      "Pcomp",
      "ScavAir",
      "Exh_T/C_inlet",
      "Exh_T/C_outlet",
      "Exh_Cylinder_outlet",
      "SFOC",
    ];

    const AUX_ORDER = [
      "Pmax",
      "FIPI",
      "ScavAirPressure",
      "Exh_T/C_inlet",
      "Exh_T/C_outlet",
      "Exh_Cylinder_outlet",
    ];

    // const metricKeysToRender = Object.keys(metricMapping).filter(
    //   (key) => key !== "FOC",
    // );
    const metricKeysToRender = (isAux ? AUX_ORDER : MAIN_ORDER).filter((key) =>
      metricMapping.hasOwnProperty(key),
    );

    // Add Propeller Margin if data exists
    const showPropellerMargin =
      analysisMode === "mainEngine" &&
      loadDiagramData &&
      loadDiagramData.propeller_curves;
    if (showPropellerMargin) metricKeysToRender.push("PropellerMarginRow");

    // Color Coding Config
    const mainHighBad = [
      "SFOC",
      "FOC",
      "Exh_T/C_inlet",
      "Exh_Cylinder_outlet",
      "Exh_T/C_outlet",
    ];
    const mainLowBad = ["Pmax", "Pcomp", "ScavAir", "Turbospeed", "EngSpeed"];

    // =================================================================================
    // LAYOUT 1: SINGLE REPORT VIEW (Kept Standard - NO CHANGE HERE)
    // =================================================================================
    if (allMonthlyReports.length === 1) {
      const currentMonthReport = allMonthlyReports[0];
      const loadPct = isAux
        ? currentMonthReport.load_percentage
        : currentMonthReport.load;

      let powerLabel = "";
      if (isAux) {
        // Auxiliary Engine Logic (Already working)
        powerLabel = currentMonthReport.load_kw
          ? `${safeFixed(currentMonthReport.load_kw, 0)} kW`
          : "";
      } else {
        // Main Engine Logic: Prefer Effective Power
        const powerVal =
          currentMonthReport.effective_power_kw ||
          currentMonthReport.shaft_power_kw;
        powerLabel = powerVal ? `${safeFixed(powerVal, 0)} kW` : "";
      }

      // Combine into a clean header string
      const loadDisplay = powerLabel
        ? `${safeFixed(loadPct, 2)}% Load (${powerLabel})`
        : `${safeFixed(loadPct, 2)}% Load`;

      return (
        <div
          className="enhanced-card summary-table-card"
          style={{ marginBottom: "32px" }}
        >
          <div
  className="card-header-enhanced"
  onClick={() => setIsSummaryExpanded(!isSummaryExpanded)}
  style={{
    display: "flex",
    justifyContent: "space-between",
    alignItems: "center",
    cursor: "pointer",
    userSelect: "none",
    padding: "10px 16px",
  }}
>
            <div>
              <h3 className="card-title-enhanced" style={{ margin: 0, fontSize: "1rem", fontWeight: "600" }}>
                {allMonthlyReports.length === 1
                  ? `Performance Summary @ ${loadDisplay}`
                  : `Performance Matrix (${allMonthlyReports.length} Reports)`}
              </h3>
              <p className="card-description-enhanced" style={{ margin: 0, fontSize: "0.78rem" }}>
                {allMonthlyReports.length === 1
                  ? `Baseline vs Actual - ${currentMonthReport.displayName}`
                  : "Comparison across multiple dates vs Baseline"}
              </p>
            </div>

            <div style={{ display: "flex", alignItems: "center", gap: "16px" }}>
              {/* Professional Bookmark - preserved exactly from source */}
              <div
                style={{
                  fontSize: "0.7rem",
                  fontWeight: "700",
                  color: "#94a3b8",
                  textTransform: "uppercase",
                  backgroundColor: "#f8fafc",
                  padding: "4px 10px",
                  borderRadius: "4px",
                  border: "1px solid #e2e8f0",
                  letterSpacing: "0.025em",
                }}
              >
                {bookmarkLabel}
              </div>

              {/* Animated Chevron Icon */}
              <span
                style={{
                  fontSize: "1.1rem",
                  color: "#94a3b8",
                  transition: "transform 0.3s ease",
                  transform: isSummaryExpanded
                    ? "rotate(180deg)"
                    : "rotate(0deg)",
                }}
              >
                ▼
              </span>
            </div>
          </div>
          {isSummaryExpanded && (
            <div className="card-content-enhanced">
              <table className="summary-table-enhanced">
                <thead>
                  <tr>
                    <th style={{ width: "35%", textAlign: "left" }}>
                      Parameter
                    </th>
                    <th style={{ width: "15%" }}>Shop Trial</th>
                    <th style={{ width: "15%" }}>Actual</th>
                    <th style={{ width: "15%" }}>Δ</th>
                    <th style={{ width: "20%", textAlign: "right" }}>
                      Deviation %
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {metricKeysToRender.map((metricKey) => {
                    // --- ROW TYPE A: PROPELLER MARGIN ---
                    if (metricKey === "PropellerMarginRow") {
                      let rawMargin =
                        currentMonthReport.propeller_margin_percent;
                      let isRatio = false; // Default to Deviation (0-based)

                      // 1. Fallback: If DB value is missing, calculate it using Graph Data
                      if (rawMargin === undefined || rawMargin === null) {
                        const actualPower =
                          loadDiagramData?.actual_operating_point?.power_kw;
                        const actualRpm =
                          loadDiagramData?.actual_operating_point?.rpm;
                        const servicePropellerPower =
                          interpolateLoadDiagramPower(
                            loadDiagramData?.propeller_curves || [],
                            actualRpm,
                            "power_service_kw",
                          );

                        if (actualPower && servicePropellerPower) {
                          // Old Logic Calculation returns a Ratio (e.g. 115.5)
                          rawMargin =
                            (actualPower / servicePropellerPower) * 100;
                          isRatio = true;
                        } else {
                          return null; // Hide row if no data
                        }
                      } else {
                        // 2. Heuristic Check: Determine if DB value is Ratio (100-based) or Deviation (0-based)
                        // Old data might be ~100. New data is ~0.
                        // Threshold: If abs value > 50, it's definitely a Ratio.
                        if (Math.abs(rawMargin) > 50) {
                          isRatio = true;
                        }
                      }

                      // 3. Normalize Values for Display (UPDATED LOGIC)
                      // We want "Actual" to always be relative to 100 (e.g., 112.90)
                      // We want "Delta" to always be the difference (e.g., +12.90)
                      let displayActual = 0;
                      let displayDelta = 0;

                      if (isRatio) {
                        // Case A: Input is 112.90 (Ratio)
                        displayActual = rawMargin;
                        displayDelta = rawMargin - 100.0;
                      } else {
                        // Case B: Input is 12.90 (Deviation)
                        // Actual becomes 100 + 12.90 = 112.90
                        // If input is -12.90, Actual becomes 100 + (-12.90) = 87.10
                        displayActual = 100.0 + rawMargin;
                        displayDelta = rawMargin;
                      }

                      // 4. Styling Logic
                      // > 5% Heavy = Error (Red)
                      // 0 - 5% Heavy = Warning (Orange)
                      // < 0% Light = Success (Green)
                      let devClass = "";
                      let txtColor = "";

                      // --- POWER MARGIN SPECIFIC LOGIC ---
                      if (displayDelta > 5.0) {
                        devClass = "error-row";
                        txtColor = "#dc2626"; // Red
                      } else if (displayDelta >= 0) {
                        devClass = "warning-row";
                        txtColor = "#ca8a04"; // Amber
                      } else {
                        devClass = "success-row";
                        txtColor = "#16a34a"; // Green
                      }

                      return (
                        <tr key={metricKey} className={devClass}>
                          <td style={{ textAlign: "left", fontWeight: "600" }}>
                            Power Margin
                          </td>

                          {/* Baseline is always 100.00 for Propeller Margin */}
                          <td style={{ textAlign: "right" }}>100.00</td>

                          {/* Actual Value (Now correctly shows 100 + deviation) */}
                          <td style={{ textAlign: "right" }}>
                            {safeFixed(displayActual, 2)}
                          </td>

                          {/* Delta (The deviation amount) */}
                          <td
                            style={{
                              textAlign: "right",
                              color: txtColor,
                              fontWeight: "bold",
                            }}
                          >
                            {displayDelta >= 0 ? "+" : ""}
                            {safeFixed(displayDelta, 2)}
                          </td>

                          {/* % Display */}
                          <td
                            style={{
                              textAlign: "right",
                              color: txtColor,
                              fontWeight: "bold",
                            }}
                          >
                            {displayDelta >= 0 ? "+" : ""}
                            {safeFixed(displayDelta, 1)}%
                          </td>
                        </tr>
                      );
                    }

                    // --- ROW TYPE B: STANDARD METRICS ---
                    // ... inside renderSummaryTable ...
                    // ... inside metricKeysToRender.map ...

                    // --- ROW TYPE B: STANDARD METRICS ---
                    const unit = getMetricUnit(metricKey, isAux);
                    const xAxis = isAux ? "load_percentage" : "load";
                    const targetLoad = isAux
                      ? currentMonthReport.load_percentage
                      : currentMonthReport.load;

                    const baselineValue =
                      interpolateBaseline(
                        baseline,
                        targetLoad,
                        metricKey,
                        xAxis,
                      ) ?? 0;
                    const actualValue = currentMonthReport[metricKey];

                    const delta = actualValue - baselineValue;
                    const devPct =
                      baselineValue !== 0 ? (delta / baselineValue) * 100 : 0;
                    const absDev = Math.abs(devPct);

                    // --- UPDATED COLOR LOGIC START ---
                    // --- NEW CONSOLIDATED COLOR LOGIC ---

                    let devClass = "success-row";
                    let txtColor = "#16a34a";

                    const exhaustKeys = [
                      "Exh_T/C_inlet",
                      "Exh_T/C_outlet",
                      "Exh_Cylinder_outlet",
                    ];
                    const absDelta = Math.abs(delta); // Use absolute difference for temps
                    if (metricKey === "Turbospeed") {
                      // NEW TURBO LOGIC: Absolute RPM Difference
                      if (absDelta >= 1000) {
                        devClass = "error-row";
                        txtColor = "#dc2626";
                      } else if (absDelta >= 500) {
                        devClass = "warning-row";
                        txtColor = "#ca8a04";
                      }
                    } else if (exhaustKeys.includes(metricKey)) {
                      // NEW LOGIC: AMBER @ 40°C, RED @ 60°C
                      if (absDelta > 60) {
                        devClass = "error-row";
                        txtColor = "#dc2626";
                      } else if (absDelta >= 40) {
                        devClass = "warning-row";
                        txtColor = "#ca8a04";
                      }
                    } else {
                      // Standard logic for non-exhaust parameters (Percentage based)
                      const groupA = [
                        "Pmax",
                        "Pcomp",
                        "Turbospeed",
                        "EngSpeed",
                      ];
                      const groupB = [
                        "FIPI",
                        "ScavAir",
                        "ScavAirPressure",
                        "SFOC",
                      ];

                      if (groupA.includes(metricKey)) {
                        if (absDev > 5.0) {
                          devClass = "error-row";
                          txtColor = "#dc2626";
                        } else if (absDev >= 3.0) {
                          devClass = "warning-row";
                          txtColor = "#ca8a04";
                        }
                      } else if (groupB.includes(metricKey)) {
                        if (absDev > 10.0) {
                          devClass = "error-row";
                          txtColor = "#dc2626";
                        } else if (absDev >= 5.0) {
                          devClass = "warning-row";
                          txtColor = "#ca8a04";
                        }
                      }
                    }
                    // --- UPDATED COLOR LOGIC END ---

                    let labelSuffix = "";
                    if (!isAux) {
                      const isoKeys = [
                        "Pmax",
                        "Pcomp",
                        "ScavAir",
                        "Exh_Cylinder_outlet",
                      ];
                      if (isoKeys.includes(metricKey)) labelSuffix = " (ISO)";
                      else if (metricKey === "SFOC") labelSuffix = " (ISO)";
                    }

                    return (
                      <tr key={metricKey} className={devClass}>
                        <td style={{ textAlign: "left", fontWeight: "600" }}>
                          {metricDisplayNames[metricKey] || metricKey}
                          <span style={{ color: "#1e293b", fontWeight: "800" }}>
                            {labelSuffix}
                          </span>
                          <span
                            style={{
                              color: "#64748b",
                              fontWeight: "500",
                              marginLeft: "4px",
                              fontSize: "0.85rem",
                            }}
                          >
                            ({unit})
                          </span>
                        </td>
                        <td style={{ textAlign: "right" }}>
                          {safeFixed(baselineValue, 2)}
                        </td>
                        <td style={{ textAlign: "right", color: "#1e293b" }}>
                          {safeFixed(actualValue, 2)}
                        </td>
                        <td
                          style={{
                            textAlign: "right",
                            color: txtColor,
                            fontWeight: "bold",
                          }}
                        >
                          {delta >= 0 ? "+" : ""}
                          {safeFixed(delta, 2)}
                        </td>
                        <td
                          style={{
                            textAlign: "right",
                            color: txtColor,
                            fontWeight: "bold",
                          }}
                        >
                          {devPct >= 0 ? "+" : ""}
                          {safeFixed(devPct, 1)}%
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>
      );
    }

    // =================================================================================
    // LAYOUT 2: MULTI-REPORT MATRIX VIEW (UPDATED FOR MERGED COLUMNS)
    // =================================================================================
    return (
      <div
        className="enhanced-card summary-table-card"
        style={{ marginBottom: "32px" }}
      >
        <div className="card-header-enhanced">
          <h3 className="card-title-enhanced">
            Performance Matrix ({allMonthlyReports.length} Reports)
          </h3>
          <p className="card-description-enhanced">
            Comparison across multiple dates vs Baseline
          </p>
        </div>

        <div className="card-content-enhanced" style={{ padding: 0 }}>
          <div className="matrix-scroll-container">
            <table className="matrix-table">
              <thead>
                {/* 1. Date Group Header */}
                <tr style={{ height: "55px" }}>
                  <th className="matrix-sticky-col-1">PARAMETER</th>

                  {allMonthlyReports.map((report) => {
                    // Logic to get the correct power and percentage for the header
                    const loadPct = isAux
                      ? report.load_percentage
                      : report.load;

                    let powerLabel = "";
                    if (isAux) {
                      powerLabel = report.load_kw
                        ? `${safeFixed(report.load_kw, 0)} kW`
                        : "";
                    } else {
                      // Prefer Effective Power, fallback to Shaft Power for Main Engine
                      const pwr =
                        report.effective_power_kw || report.shaft_power_kw;
                      powerLabel = pwr ? `${safeFixed(pwr, 0)} kW` : "";
                    }

                    return (
                      <th
                        key={report.report_id}
                        colSpan={3}
                        className="matrix-group-header"
                      >
                        {report.displayName}
                        {/* --- ADDED LOAD % AND POWER INFO HERE --- */}
                        <div
                          style={{
                            fontSize: "0.75rem",
                            fontWeight: "700",
                            color: "#0f172a",
                            marginTop: "2px",
                          }}
                        >
                          {safeFixed(loadPct, 2)}%{" "}
                          {powerLabel ? `(${powerLabel})` : ""}
                        </div>
                        <div
                          style={{
                            fontSize: "0.7rem",
                            fontWeight: "500",
                            color: "#64748b",
                            marginTop: "1px",
                          }}
                        >
                          {report.report_date}
                        </div>
                      </th>
                    );
                  })}
                </tr>

                {/* 2. Sub-headers */}
                {/* 2. Sub-headers */}
                <tr>
                  <th
                    className="matrix-sticky-col-1"
                    style={{
                      color: "#64748b",
                      fontSize: "0.75rem",
                      fontWeight: "600",
                      textTransform: "none",
                    }}
                  >
                    Unit
                  </th>

                  {allMonthlyReports.map((report) => (
                    <React.Fragment key={`sub-${report.report_id}`}>
                      {/* 🔥 CHANGE 1: Increased minWidth from 95px to 110px */}
                      <th
                        className="matrix-sub-header"
                        style={{
                          borderLeft: "1px solid #cbd5e1",
                          textAlign: "center",
                          color: "#475569",
                          minWidth: "110px",
                        }}
                      >
                        Shop Trial
                      </th>

                      {/* 🔥 CHANGE 2: Increased minWidth from 95px to 110px */}
                      <th
                        className="matrix-sub-header"
                        style={{ textAlign: "center", minWidth: "110px" }}
                      >
                        Actual
                      </th>

                      {/* 🔥 CHANGE 3: Increased minWidth from 95px to 110px */}
                      <th
                        className="matrix-sub-header"
                        style={{ textAlign: "center", minWidth: "112px" }}
                      >
                        Δ (%)
                      </th>
                    </React.Fragment>
                  ))}
                </tr>
              </thead>
              <tbody>
                {metricKeysToRender.map((metricKey) => {
                  const isProp = metricKey === "PropellerMarginRow";
                  const unit = getMetricUnit(metricKey, isAux);

                  let labelSuffix = "";
                  if (!isAux && !isProp) {
                    const isoKeys = [
                      "Pmax",
                      "Pcomp",
                      "ScavAir",
                      "Exh_Cylinder_outlet",
                    ];
                    if (isoKeys.includes(metricKey)) labelSuffix = " (ISO)";
                    else if (metricKey === "SFOC") labelSuffix = " (ISO)";
                  }

                  return (
                    <tr key={metricKey}>
                      {/* Column 1: Parameter Label */}
                      <td
                        className="matrix-sticky-col-1"
                        style={{
                          textAlign: "left",
                          paddingLeft: "16px",
                          fontWeight: "600",
                          color: "#334155",
                        }}
                      >
                        {isProp
                          ? "Power Margin"
                          : metricDisplayNames[metricKey] || metricKey}
                        {labelSuffix && (
                          <span style={{ color: "#1e293b", fontWeight: "700" }}>
                            {labelSuffix}
                          </span>
                        )}
                        <span
                          style={{
                            fontSize: "0.75rem",
                            color: "#94a3b8",
                            marginLeft: "4px",
                            fontWeight: "500",
                          }}
                        >
                          ({isProp ? "%" : unit})
                        </span>
                      </td>

                      {/* Dynamic Columns for Each Report */}
                      {allMonthlyReports.map((report) => {
                        let val = 0,
                          base = 0,
                          delta = 0,
                          pct = 0;
                        let color = "#1e293b";
                        let bg = "transparent";

                        // --- 1. Propeller Logic ---
                        if (isProp) {
                          let rawMargin = report.propeller_margin_percent;

                          // A. Fallback: Calculation if DB value is missing
                          if (rawMargin === undefined || rawMargin === null) {
                            let rRpm = Number(
                              report.rpm ||
                                report.EngSpeed ||
                                report.engine_speed_rpm,
                            );
                            let rPower = Number(
                              report.shaft_power_kw || report.power_kw,
                            );

                            // Try to get data from graph object if IDs match
                            if (
                              loadDiagramData?.report_info?.report_id ===
                              report.report_id
                            ) {
                              rRpm =
                                loadDiagramData.actual_operating_point?.rpm;
                              rPower =
                                loadDiagramData.actual_operating_point
                                  ?.power_kw;
                            }

                            if (
                              loadDiagramData?.propeller_curves &&
                              rRpm > 0 &&
                              rPower > 0
                            ) {
                              const servicePower = interpolateLoadDiagramPower(
                                loadDiagramData.propeller_curves,
                                rRpm,
                                "power_service_kw",
                              );
                              if (servicePower && servicePower > 0) {
                                rawMargin = (rPower / servicePower) * 100;
                              }
                            }
                          }

                          // B. Heuristic Normalization (Fix for Matrix View)
                          if (rawMargin !== undefined && rawMargin !== null) {
                            base = 100.0;

                            // Check: Is it a Ratio (>50, e.g., 92.36) or Deviation (<50, e.g., -7.64)?
                            if (Math.abs(rawMargin) > 50) {
                              val = rawMargin; // It's already the total ratio
                            } else {
                              val = 100.0 + rawMargin; // Convert deviation to total ratio
                            }
                          }
                        }
                        // --- 2. Standard Metric Logic ---
                        else {
                          const xAxis = isAux ? "load_percentage" : "load";
                          const rLoad = isAux
                            ? report.load_percentage
                            : report.load;
                          base =
                            interpolateBaseline(
                              baseline,
                              rLoad,
                              metricKey,
                              xAxis,
                            ) ?? 0;
                          val = report[metricKey];
                        }

                        // --- 3. Deviation Calc ---
                        if (
                          base !== 0 &&
                          val !== undefined &&
                          val !== null &&
                          !isNaN(val)
                        ) {
                          delta = val - base;
                          pct = (delta / base) * 100;
                        }

                        // --- 4. Color Logic ---
                        // ... inside matrix mapping loop ...
                        // --- 4. NEW MATRIX COLOR LOGIC ---
                        // --- FINAL MATRIX COLOR LOGIC ---
                        // --- FINAL MATRIX COLOR LOGIC ---
                        // --- 4. SYNCED MATRIX COLOR LOGIC (Matches Single Report View) ---
                        const absDelta = Math.abs(delta);
                        const absPct = Math.abs(pct);

                        // Default Colors (Green/Success)
                        color = "#16a34a";
                        bg = "#f0fdf4";

                        if (isProp) {
                          // Propeller Margin Logic
                          if (pct > 5.0) {
                            color = "#dc2626";
                            bg = "#fef2f2";
                          } else if (pct >= 0) {
                            color = "#ca8a04";
                            bg = "#fffbeb";
                          } else {
                            color = "#16a34a";
                            bg = "#f0fdf4";
                          }
                        } else {
                          const exhaustKeys = [
                            "Exh_T/C_inlet",
                            "Exh_T/C_outlet",
                            "Exh_Cylinder_outlet",
                          ];

                          if (metricKey === "Turbospeed") {
                            // Turbo Speed: Absolute RPM Difference (Amber @ 500, Red @ 1000)
                            if (absDelta >= 1000) {
                              color = "#dc2626";
                              bg = "#fef2f2";
                            } else if (absDelta >= 500) {
                              color = "#ca8a04";
                              bg = "#fffbeb";
                            }
                          } else if (exhaustKeys.includes(metricKey)) {
                            // Exhaust Temps: Absolute Degree Difference (Amber @ 40, Red @ 60)
                            if (absDelta > 60) {
                              color = "#dc2626";
                              bg = "#fef2f2";
                            } else if (absDelta >= 40) {
                              color = "#ca8a04";
                              bg = "#fffbeb";
                            }
                          } else {
                            // Grouped Percentage Logic
                            const groupA = [
                              "Pmax",
                              "Pcomp",
                              "Turbospeed",
                              "EngSpeed",
                            ];
                            const groupB = ["FIPI", "ScavAir", "SFOC"];

                            if (groupA.includes(metricKey)) {
                              if (absPct > 5.0) {
                                color = "#dc2626";
                                bg = "#fef2f2";
                              } else if (absPct >= 3.0) {
                                color = "#ca8a04";
                                bg = "#fffbeb";
                              }
                            } else if (groupB.includes(metricKey)) {
                              if (absPct > 10.0) {
                                color = "#dc2626";
                                bg = "#fef2f2";
                              } else if (absPct >= 5.0) {
                                color = "#ca8a04";
                                bg = "#fffbeb";
                              }
                            }
                          }
                        }
                        // ... rest of logic ...

                        // 🔥 UPDATED: Empty Data Handling (Returns 3 columns now)
                        if (val === 0 && base === 0) {
                          return (
                            <React.Fragment key={report.report_id}>
                              <td
                                className="matrix-data-cell"
                                style={{ borderLeft: "1px solid #cbd5e1" }}
                              >
                                -
                              </td>
                              <td className="matrix-data-cell">-</td>
                              <td className="matrix-data-cell">-</td>
                            </React.Fragment>
                          );
                        }

                        // 🔥 UPDATED: Formatted Merge Cell
                        // Format: Delta (AbsolutePercentage%)
                        // Example: -2.02 (2.8%)
                        const formattedDelta = `${delta > 0 ? "+" : ""}${safeFixed(delta, 2)}`;
                        const formattedPct = `${Math.abs(pct).toFixed(1)}%`;

                        return (
                          <React.Fragment key={report.report_id}>
                            {/* 1. Trial (Baseline) Column */}
                            <td
                              className="matrix-data-cell"
                              style={{
                                borderLeft: "1px solid #cbd5e1",
                                textAlign: "center",
                                color: "#475569",
                                backgroundColor: bg,
                              }}
                            >
                              {safeFixed(base, 2)}
                            </td>

                            {/* 2. Actual Column */}
                            <td
                              className="matrix-data-cell"
                              style={{
                                backgroundColor: bg,
                                textAlign: "center",
                                fontWeight: "600",
                                color: "#334155",
                              }}
                            >
                              {safeFixed(val, 2)}
                            </td>

                            {/* 3. Merged Delta (%) Column */}
                            <td
                              className="matrix-data-cell"
                              style={{
                                color: color,
                                fontWeight: "bold",
                                backgroundColor: bg,
                                textAlign: "center",
                                whiteSpace: "nowrap",
                              }}
                            >
                              {formattedDelta}{" "}
                              <span
                                style={{
                                  fontSize: "0.8rem",
                                  fontWeight: "600",
                                  opacity: 0.9,
                                }}
                              >
                                ({formattedPct})
                              </span>
                            </td>
                          </React.Fragment>
                        );
                      })}
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    );
  };

  const renderAllCharts = () => {
    if (!shipId) return null;
    const isAux = analysisMode === "auxiliaryEngine";
    const metricMapping = isAux ? AUX_METRIC_MAPPING : MAIN_METRIC_MAPPING;
    const xAxisKey = isAux ? xAxisType : "load";
    const xLabel = isAux
      ? xAxisOptions.find((opt) => opt.key === xAxisType)?.label
      : "Load (%)";
    const MAIN_ORDER = [
      "EngSpeed",
      "Turbospeed",
      "FIPI",
      "Pmax",
      "Pcomp",
      "ScavAir",
      "Exh_T/C_inlet",
      "Exh_T/C_outlet",
      "Exh_Cylinder_outlet",
      "SFOC",
      // "FOC"
    ];
    // const MAIN_ORDER = [
    //   "Pmax", "Pcomp", "ScavAir", "Turbospeed", "EngSpeed",
    //   "Exh_Cylinder_outlet", "Exh_T/C_inlet", "Exh_T/C_outlet",
    //   "FIPI", "SFOC", "FOC"
    // ];

    const AUX_ORDER = [
      "Pmax",
      "FIPI",
      "ScavAirPressure",
      "Exh_T/C_inlet",
      "Exh_T/C_outlet",
      "Exh_Cylinder_outlet",
    ];
    // const AUX_ORDER = [
    //   "Pmax", "ScavAirPressure",
    //   "Exh_Cylinder_outlet", "Exh_T/C_inlet", "Exh_T/C_outlet",
    //   "FIPI"
    // ];

    // 2. SELECT THE CORRECT ORDER LIST
    // We filter the order list to ensure we only render metrics that actually exist in the current mapping
    // (This prevents errors if a key is missing in the mapping)
    const chartOrder = (isAux ? AUX_ORDER : MAIN_ORDER).filter((key) =>
      metricMapping.hasOwnProperty(key),
    );
    {
      allMonthlyReports.length === 1 && (
        <DiagnosisPanel
          report={allMonthlyReports[0]}
          baseline={baseline}
          analysisMode={analysisMode}
        />
      );
    }
    return (
      <>
        {renderSummaryTable()}

        {/* <div className="charts-grid-enhanced">
            {chartOrder.map((metricKey) => {
              const uniqueChartDataMap = new Map();
              baseline[metricKey]?.forEach((p) => {
                const xValue = isAux ? p[xAxisKey] : p.load; 
                if (!uniqueChartDataMap.has(xValue)) {
                  uniqueChartDataMap.set(xValue, { x: xValue, y: p.value });
                }
              });
              const chartData = Array.from(uniqueChartDataMap.values());
              const headerAliases = {
                FIPI: "Fuel Index Pump Indicator",
              };
              const displayTitle = headerAliases[metricKey] || metricKey;
              const metricUnit = getMetricUnit(metricKey, isAux);
              const yDomain = getYAxisDomain(
                metricKey,
                { [metricKey]: baseline[metricKey] },
                allMonthlyReports,
              );
              const customTicks = getCustomTicks(yDomain, metricKey);

              return (
                <div key={metricKey} className="enhanced-card chart-card">
                  <div className="card-header-enhanced">
                    <h3 className="card-title-enhanced">{displayTitle}</h3>
                    <p className="card-description-enhanced">
                      {metricUnit} vs {xLabel}
                    </p>
                  </div>
                  <div
                    className="card-content-enhanced"
                    style={{ paddingTop: "16px", paddingBottom: "16px" }}
                  >
                    <ResponsiveContainer width="100%" height={300}>
                      <LineChart
                        data={chartData}
                        margin={{ left: 16, right: 16, top: 8, bottom: 12 }}
                      >
                        <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
                        <XAxis
                          dataKey="x"
                          type="number"
                          domain={isAux ? ["dataMin", "dataMax"] : [0, 110]}
                          ticks={isAux ? undefined : [25, 50, 75, 100, 110]}
                          tickFormatter={(v) => (isAux ? v.toFixed(1) : `${v}%`)}
                          label={{
                            value: xLabel,
                            position: "insideBottom",
                            offset: -10,
                            style: { fontWeight: 600 },
                          }}
                          stroke="#64748b"
                        />
                        <YAxis
                          width={45}
                          domain={yDomain}
                          ticks={customTicks}
                          tickFormatter={(v) => v.toFixed(1)}
                          stroke="#64748b"
                        />
                        <Line
                          type="monotone"
                          dataKey="y"
                          activeDot={false}
                          stroke="#ca8a04"
                          strokeWidth={2}
                          name="Shop Trial Baseline"
                          isAnimationActive={false}
                          dot={
                            !(activePoint && activePoint.metricKey === metricKey)
                          }
                        />

                        {allMonthlyReports.map((report, index) => {
                          const xAxisKey = isAux ? xAxisType : "load";
                          const xValue = report[xAxisKey];
                          let yValue = report[metricKey];

                          if (
                            yValue === null ||
                            yValue === undefined ||
                            !Number.isFinite(yValue) ||
                            !Number.isFinite(xValue)
                          ) {
                            return null;
                          }

                          return (
                            <ReferenceDot
                              key={`${report.month}-${metricKey}`}
                              x={xValue}
                              y={yValue}
                              fill={report.color}
                              shape={(props) => (
                                <g
                                  style={{ cursor: "pointer", outline: "none" }} 
                                  tabIndex="-1" 
                                  onClick={(e) => {
                                    e.stopPropagation(); 
                                    setActivePoint({
                                      x: xValue,
                                      y: yValue,
                                      cx: props.cx,
                                      cy: props.cy,
                                      name: report.displayName,
                                      date: report.report_date
                                        ? report.report_date
                                            .split("-")
                                            .reverse()
                                            .join("/")
                                        : "",
                                      color: report.color,
                                      unit: metricUnit,
                                      label: xLabel,
                                      metricKey: metricKey, 
                                    });
                                  }}
                                >
                                  <CustomColoredXMarker
                                    {...props}
                                    fill={report.color}
                                  />
                                  <circle
                                    cx={props.cx}
                                    cy={props.cy}
                                    r={12}
                                    fill="transparent"
                                  />
                                </g>
                              )}
                            />
                          );
                        })}

                        <Tooltip content={() => null} cursor={false} />

                        {activePoint && activePoint.metricKey === metricKey && (
                          <ReferenceDot
                            x={activePoint.x}
                            y={activePoint.y}
                            shape={() => {
                              const cardW = 160;
                              const cardH = 105;
                              const margin = 12;
                              const showLeft = activePoint.cx > 200;
                              const posX = showLeft
                                ? activePoint.cx - (cardW + margin)
                                : activePoint.cx + margin;
                              const showBelow = activePoint.cy < 120;
                              const posY = showBelow
                                ? activePoint.cy + margin
                                : activePoint.cy - (cardH + 2); 

                              return (
                                <g>
                                  <rect
                                    x={posX}
                                    y={posY}
                                    width={cardW}
                                    height={cardH}
                                    fill="#ffffff"
                                    fillOpacity="1"
                                    rx="8"
                                    style={{
                                      filter:
                                        "drop-shadow(0px 8px 16px rgba(0,0,0,0.15))",
                                    }}
                                  />

                                  <foreignObject
                                    x={posX}
                                    y={posY}
                                    width={cardW}
                                    height={cardH}
                                    style={{ pointerEvents: "none" }}
                                  >
                                    <div
                                      style={{
                                        background: "#ffffff !important",
                                        backgroundColor: "#ffffff !important",
                                        opacity: "1 !important",
                                        padding: "10px", 
                                        border: `2px solid ${activePoint.color}`,
                                        borderRadius: "8px",
                                        fontSize: "11px", 
                                        fontFamily: "Inter, sans-serif",
                                        position: "relative",
                                        zIndex: 9999,
                                        display: "flex",
                                        flexDirection: "column",
                                        height: "100%",
                                        boxSizing: "border-box",
                                      }}
                                    >
                                      <div
                                        style={{
                                          fontWeight: "bold",
                                          color: "#1e293b",
                                          borderBottom: "1px solid #f1f5f9",
                                          marginBottom: "4px",
                                          paddingBottom: "2px",
                                          whiteSpace: "nowrap",
                                          overflow: "hidden",
                                          textOverflow: "ellipsis",
                                        }}
                                      >
                                        {activePoint.name}
                                      </div>

                                      <div
                                        style={{
                                          color: "#64748b",
                                          fontSize: "9px",
                                          marginBottom: "6px",
                                        }}
                                      >
                                        {activePoint.date}
                                      </div>

                                      <div
                                        style={{
                                          display: "flex",
                                          justifyContent: "space-between",
                                          marginBottom: "2px",
                                        }}
                                      >
                                        <span
                                          style={{
                                            fontWeight: "500",
                                            color: "#64748b",
                                          }}
                                        >
                                          {activePoint.label}:
                                        </span>
                                        <span
                                          style={{
                                            fontWeight: "bold",
                                            color: "#1e293b",
                                          }}
                                        >
                                          {activePoint.x.toFixed(1)}%
                                        </span>
                                      </div>

                                      <div
                                        style={{
                                          display: "flex",
                                          justifyContent: "space-between",
                                          marginTop: "auto", 
                                        }}
                                      >
                                        <span
                                          style={{
                                            fontWeight: "500",
                                            color: "#64748b",
                                          }}
                                        >
                                          Value:
                                        </span>
                                        <span
                                          style={{
                                            fontWeight: "bold",
                                            color: activePoint.color,
                                          }}
                                        >
                                          {activePoint.y.toFixed(2)}{" "}
                                          {activePoint.unit}
                                        </span>
                                      </div>
                                    </div>
                                  </foreignObject>
                                </g>
                              );
                            }}
                          />
                        )}
                      </LineChart>
                    </ResponsiveContainer>

                    <div style={{ marginTop: allMonthlyReports.length * 2 }}>
                      {(() => {
                        window.__currentLegendMetric = metricKey;
                        return (
                          <CustomInlineLegend
                            monthlyReports={allMonthlyReports}
                            metricKey={metricKey}
                          />
                        );
                      })()}
                    </div>
                  </div>
                </div>
              );
            })}
          </div> */}
      </>
    );
  };

  // 🔥 UPDATED HELPER: Transposed Deviation History Table (Parameters as Rows, Dates as Columns)
  // 🔥 UPDATED HELPER: AE Deviation History Table with Dynamic % Calculation
  const renderAEDeviationHistoryTable = () => {
    if (analysisMode !== "auxiliaryEngine" || aeDeviationHistory.length === 0)
      return null;

    // 1. Map Table Keys to Baseline Keys (Crucial for Interpolation)
    const baselineKeyMap = {
      fipi: "FIPI",
      pmax: "Pmax",
      scav_air: "ScavAirPressure", // Note: AE usually uses 'ScavAirPressure', ME uses 'ScavAir'
      tc_in: "Exh_T/C_inlet",
      tc_out: "Exh_T/C_outlet",
      exh_cyl_out: "Exh_Cylinder_outlet",
    };

    // Define the parameters we want as ROWS
    const parameterRows = [
      { label: "Load", key: "load", unit: "%", isLoad: true },
      { label: "Pmax", key: "pmax", unit: "Bar" },
      { label: "FIPI", key: "fipi", unit: "mm" },
      { label: "Scav Air", key: "scav_air", unit: "Bar" },
      { label: "TC Inlet", key: "tc_in", unit: "°C" },
      { label: "TC Outlet", key: "tc_out", unit: "°C" },
      { label: "Exh Cyl Out", key: "exh_cyl_out", unit: "°C" },
    ];

    return (
      <div
        className="enhanced-card history-table-card"
        style={{ marginTop: "32px", marginBottom: "40px" }}
      >
        <div
  className="card-header-enhanced"
  onClick={() => setIsHistoryExpanded(!isHistoryExpanded)}
  style={{
    display: "flex",
    justifyContent: "space-between",
    alignItems: "center",
    cursor: "pointer",
    userSelect: "none",
    padding: "10px 16px",
  }}
>
          <div>
            <h3 className="card-title-enhanced" style={{ margin: 0, fontSize: "1rem", fontWeight: "600" }}>
              Historical Deviation Analysis (Last 6 Reports)
            </h3>
            <p className="card-description-enhanced" style={{ margin: 0, fontSize: "0.78rem" }}>
              Comparison across recent reports (Actual vs Deviation %)
            </p>
          </div>

          <div style={{ display: "flex", alignItems: "center", gap: "16px" }}>
            {/* Professional Bookmark - Preserved exactly from your source */}
            <div
              style={{
                fontSize: "0.7rem",
                fontWeight: "700",
                color: "#94a3b8",
                textTransform: "uppercase",
                backgroundColor: "#f8fafc",
                padding: "4px 10px",
                borderRadius: "4px",
                border: "1px solid #e2e8f0",
                letterSpacing: "0.025em",
              }}
            >
              {bookmarkLabel}
            </div>

            {/* Animated Chevron Icon */}
            <span
              style={{
                fontSize: "1.1rem",
                color: "#94a3b8",
                transition: "transform 0.3s ease",
                transform: isHistoryExpanded
                  ? "rotate(180deg)"
                  : "rotate(0deg)",
              }}
            >
              ▼
            </span>
          </div>
        </div>
        {isHistoryExpanded && (
          <div className="card-content-enhanced" style={{ overflowX: "auto" }}>
            <table
              className="summary-table-enhanced"
              style={{ width: "100%", tableLayout: "fixed" }}
            >
              {/* 1. THE HEADER ROW (Dates) */}
              <thead>
                <tr style={{ backgroundColor: "#f8fafc" }}>
                  <th
                    style={{
                      width: "180px",
                      padding: "12px",
                      textAlign: "left",
                      color: "#64748b",
                    }}
                  >
                    PARAMETER
                  </th>
                  {/* Sort descending by date */}
                  {[...aeDeviationHistory]
                    .sort(
                      (a, b) =>
                        new Date(b.report_date) - new Date(a.report_date),
                    )
                    .map((report, index) => (
                      <th
                        key={index}
                        style={{
                          padding: "12px",
                          textAlign: "center",
                          minWidth: "120px",
                        }}
                      >
                        <div style={{ fontSize: "0.9rem", color: "#1e293b" }}>
                          {getMonthDisplayName(report.report_month)}
                        </div>
                        <div
                          style={{
                            fontSize: "0.7rem",
                            color: "#64748b",
                            fontWeight: "normal",
                          }}
                        >
                          {report.report_date}
                        </div>
                      </th>
                    ))}
                </tr>
              </thead>

              {/* 2. THE BODY ROWS */}
              <tbody>
                {parameterRows.map((param) => (
                  <tr
                    key={param.key}
                    style={{ borderBottom: "1px solid #f1f5f9" }}
                  >
                    {/* Row Header */}
                    <td
                      style={{
                        padding: "12px",
                        textAlign: "left",
                        fontWeight: "600",
                        backgroundColor: "#fcfcfc",
                      }}
                    >
                      {param.label}{" "}
                      <span
                        style={{
                          color: "#94a3b8",
                          fontWeight: "normal",
                          fontSize: "0.8rem",
                        }}
                      >
                        ({param.unit})
                      </span>
                    </td>

                    {/* Row Data */}
                    {aeDeviationHistory.map((report, index) => {
                      // A. Handle Load Row
                      if (param.isLoad) {
                        return (
                          <td
                            key={index}
                            style={{ textAlign: "center", padding: "10px" }}
                          >
                            <div
                              style={{ fontWeight: "bold", fontSize: "0.9rem" }}
                            >
                              {report.load_percentage?.toFixed(2)}%
                            </div>
                            <div
                              style={{ fontSize: "0.75rem", color: "#64748b" }}
                            >
                              {report.load_kw} kW
                            </div>
                          </td>
                        );
                      }

                      // B. Get Actual Value from History API
                      const actualKey = `${param.key}_actual`;
                      const actualVal = report[actualKey];

                      // C. DYNAMIC DEVIATION CALCULATION (Matches Summary Table)
                      let displayDev = "-";
                      let devColor = "#64748b"; // Default Grey

                      // Ensure we have actual value, baseline data, and a valid mapping key
                      const baselineMetricKey = baselineKeyMap[param.key];

                      if (
                        actualVal !== null &&
                        actualVal !== undefined &&
                        baseline &&
                        Object.keys(baseline).length > 0 &&
                        baselineMetricKey
                      ) {
                        // Interpolate Baseline at THIS report's specific load
                        const computedBaseline = interpolateBaseline(
                          baseline,
                          report.load_percentage,
                          baselineMetricKey,
                          "load_percentage", // AE uses load_percentage for X-axis
                        );

                        if (computedBaseline && computedBaseline !== 0) {
                          const delta = actualVal - computedBaseline;
                          const pct = (delta / computedBaseline) * 100;

                          // Format: +5.4%
                          displayDev = `${pct > 0 ? "+" : ""}${pct.toFixed(1)}%`;

                          // --- NEW AE HISTORY COLOR LOGIC ---
                          const absPct = Math.abs(pct);
                          const absDelta = Math.abs(delta);
                          const aeTempKeys = ["tc_in", "tc_out", "exh_cyl_out"];
                          const aeGroupA = ["pmax", "pcomp", "turbo_rpm"]; // AE strict parameters

                          if (param.key === "turbo_rpm") {
                            // TURBO LOGIC: Absolute RPM
                            if (absDelta >= 1000) devColor = "#dc2626";
                            else if (absDelta >= 500) devColor = "#ca8a04";
                            else devColor = "#16a34a";
                          } else if (aeTempKeys.includes(param.key)) {
                            if (absDelta > 60) devColor = "#dc2626";
                            else if (absDelta >= 40) devColor = "#ca8a04";
                            else devColor = "#16a34a";
                          } else if (aeGroupA.includes(param.key)) {
                            if (absPct > 5.0) devColor = "#dc2626";
                            else if (absPct >= 3.0) devColor = "#ca8a04";
                            else devColor = "#16a34a";
                          } else {
                            if (absPct > 10.0) devColor = "#dc2626";
                            else if (absPct >= 5.0) devColor = "#ca8a04";
                            else devColor = "#16a34a";
                          }
                        }
                      }

                      return (
                        <td
                          key={index}
                          style={{
                            textAlign: "center",
                            padding: "10px",
                            borderLeft: "1px solid #f1f5f9",
                          }}
                        >
                          <div style={{ fontWeight: "600", color: "#334155" }}>
                            {actualVal !== null && actualVal !== undefined
                              ? actualVal.toFixed(1)
                              : "-"}
                          </div>
                          {/* Calculated Percentage Deviation */}
                          <div
                            style={{
                              color: devColor,
                              fontWeight: "bold",
                              fontSize: "0.75rem",
                            }}
                          >
                            {displayDev}
                          </div>
                        </td>
                      );
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    );
  };
  // 🔥 UPDATED HELPER: Transposed Deviation History Table for Main Engine
  // 🔥 UPDATED HELPER: Main Engine History Table (Exact Match to Summary Table)
  const renderMEDeviationHistoryTable = () => {
    // Check if we are in ME mode and have data
    if (analysisMode !== "mainEngine" || meDeviationHistory.length === 0)
      return null;

    // 1. Map History Keys to Baseline Keys (To use the same interpolation logic)
    // The keys on the left match the API response, keys on the right match the 'baseline' state object
    const baselineKeyMap = {
      engine_rpm: "EngSpeed",
      fuel_index: "FIPI",
      pmax: "Pmax",
      pcomp: "Pcomp",
      scav: "ScavAir",
      turbo_rpm: "Turbospeed",
      exh_tc_in: "Exh_T/C_inlet",
      exh_tc_out: "Exh_T/C_outlet",
      exh_cyl_out: "Exh_Cylinder_outlet",
      sfoc: "SFOC",
    };

    const parameters = [
      { label: "Engine RPM", key: "engine_rpm", unit: "rpm" },
      { label: "Load", key: "load_percentage", unit: "%", isLoad: true },
      {
        label: "Power Margin",
        key: "propeller_margin",
        unit: "%",
        isProp: true,
      },
      { label: "Turbo Speed", key: "turbo_rpm", unit: "RPM" },
      { label: "Fuel Index Pump Indicator", key: "fuel_index", unit: "mm" },
      { label: "Pmax", key: "pmax", unit: "bar" },
      { label: "Pcomp", key: "pcomp", unit: "bar" },
      { label: "Scav Air Press", key: "scav", unit: "kg/cm²" },
      { label: "TC Inlet", key: "exh_tc_in", unit: "°C" },
      { label: "TC Outlet", key: "exh_tc_out", unit: "°C" },
      { label: "Exh Cyl Outlet", key: "exh_cyl_out", unit: "°C" },
      { label: "SFOC", key: "sfoc", unit: "g/kWh" },
      // { label: "FOC", key: "foc", unit: "kg/h" }
    ];

    return (
      <div
        className="enhanced-card history-table-card"
        style={{ marginTop: "32px", marginBottom: "40px" }}
      >
        <div
          className="card-header-enhanced"
          onClick={() => setIsHistoryExpanded(!isHistoryExpanded)}
          style={{
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center", // Changed to center for horizontal alignment with the arrow
            cursor: "pointer",
            userSelect: "none",
          }}
        >
          <div>
            <h3 className="card-title-enhanced" style={{ margin: 0, fontSize: "1rem", fontWeight: "600" }}>
              Historical Deviation Analysis (Last 6 Reports)
            </h3>
            <p className="card-description-enhanced" style={{ margin: 0, fontSize: "0.78rem" }}>
              Main Engine — Actual vs Deviation %
            </p>
          </div>

          <div style={{ display: "flex", alignItems: "center", gap: "16px" }}>
            {/* Professional Bookmark - Preserved exactly from your source */}
            <div
              style={{
                fontSize: "0.7rem",
                fontWeight: "700",
                color: "#94a3b8",
                textTransform: "uppercase",
                backgroundColor: "#f8fafc",
                padding: "4px 10px",
                borderRadius: "4px",
                border: "1px solid #e2e8f0",
              }}
            >
              {bookmarkLabel}
            </div>

            {/* Animated Chevron Icon */}
            <span
              style={{
                fontSize: "1.1rem",
                color: "#94a3b8",
                transition: "transform 0.3s ease",
                transform: isHistoryExpanded
                  ? "rotate(180deg)"
                  : "rotate(0deg)",
              }}
            >
              ▼
            </span>
          </div>
        </div>
        {isHistoryExpanded && (
          <div className="card-content-enhanced" style={{ overflowX: "auto" }}>
            <table
              className="summary-table-enhanced"
              style={{ width: "100%", tableLayout: "fixed" }}
            >
              <thead>
                <tr>
                  <th
                    style={{
                      textAlign: "left",
                      padding: "12px",
                      width: "200px",
                    }}
                  >
                    PARAMETER
                  </th>
                  {[...meDeviationHistory]
                    .sort(
                      (a, b) =>
                        new Date(b.report_date) - new Date(a.report_date),
                    )
                    .map((r, idx) => (
                      <th
                        key={idx}
                        style={{ padding: "8px", textAlign: "center" }}
                      >
                        {getMonthDisplayName(r.report_month)}
                        <div style={{ fontSize: "0.75rem", color: "#64748b" }}>
                          {r.report_date}
                        </div>
                      </th>
                    ))}
                </tr>
              </thead>

              <tbody>
                {parameters.map((p) => (
                  <tr key={p.key}>
                    <td
                      style={{
                        fontWeight: "600",
                        padding: "10px",
                        backgroundColor: "#f8fafc",
                      }}
                    >
                      {p.label}{" "}
                      <span style={{ color: "#94a3b8", fontSize: "0.8rem" }}>
                        ({p.unit})
                      </span>
                    </td>
                    {meDeviationHistory.map((r, index) => {
                      // ---------------------------
                      // A. Handle Load Row
                      // ---------------------------
                      if (p.isLoad) {
                        return (
                          <td
                            key={index}
                            style={{ textAlign: "center", padding: "10px" }}
                          >
                            <div style={{ fontWeight: "bold" }}>
                              {r.load_percentage?.toFixed(2)}%
                            </div>
                          </td>
                        );
                      }

                      // ---------------------------
                      // B. Get Actual Value from DB
                      // ---------------------------
                      const actualKey = `${p.key}_actual`;
                      const actual = r[actualKey];

                      // ---------------------------
                      // C. Calculate Display Values & Deviation
                      // ---------------------------
                      let displayVal = "-"; // The top number (Actual)
                      let displayDev = "-"; // The bottom number (Delta %)
                      let devColor = "#64748b"; // Default Grey

                      // Default display for standard metrics (unless overridden by Propeller logic)
                      if (actual !== null && actual !== undefined) {
                        displayVal = actual.toFixed(1);
                      }

                      // --- Case 1: Propeller Margin (Special Logic) ---
                      if (p.isProp) {
                        if (actual !== null && actual !== undefined) {
                          let propActual = 0;
                          let propDev = 0;

                          // Heuristic Check:
                          // If > 50 (e.g. 112.9), treat as Ratio.
                          // If <= 50 (e.g. 12.9), treat as Deviation.
                          if (Math.abs(actual) > 50) {
                            propActual = actual;
                            propDev = actual - 100;
                          } else {
                            propActual = 100 + actual;
                            propDev = actual;
                          }

                          // Update the display variables
                          displayVal = propActual.toFixed(1);
                          displayDev = `${propDev > 0 ? "+" : ""}${propDev.toFixed(1)}%`;

                          // Color Logic for Propeller
                          if (propDev > 5.0) {
                            devColor = "#dc2626"; // Red
                          } else if (propDev >= 0) {
                            devColor = "#ca8a04"; // Amber
                          } else {
                            devColor = "#16a34a"; // Green
                          }
                        }
                      }
                      // --- Case 2: Standard Metrics (Interpolation) ---
                      else if (
                        (actual !== null &&
                          actual !== undefined &&
                          baseline &&
                          Object.keys(baseline).length > 0,
                        p.key !== "engine_rpm")
                      ) {
                        const baselineMetricKey = baselineKeyMap[p.key];

                        if (baselineMetricKey) {
                          // Interpolate Baseline at the history report's specific load
                          const computedBaseline = interpolateBaseline(
                            baseline,
                            r.load_percentage,
                            baselineMetricKey,
                            "load",
                          );

                          if (computedBaseline && computedBaseline !== 0) {
                            const delta = actual - computedBaseline;
                            const pct = (delta / computedBaseline) * 100;

                            displayDev = `${pct > 0 ? "+" : ""}${pct.toFixed(1)}%`;

                            const absPct = Math.abs(pct);
                            const absDelta = Math.abs(delta);
                            const tempKeys = [
                              "exh_tc_in",
                              "exh_tc_out",
                              "exh_cyl_out",
                            ];
                            const groupAKeys = [
                              "engine_rpm",
                              "pmax",
                              "pcomp",
                              "turbo_rpm",
                            ];

                            if (p.key === "turbo_rpm") {
                              // TURBO LOGIC: Absolute RPM
                              if (absDelta >= 1000) devColor = "#dc2626";
                              else if (absDelta >= 500) devColor = "#ca8a04";
                              else devColor = "#16a34a";
                            } else if (tempKeys.includes(p.key)) {
                              // EXHAUST LOGIC: Absolute degrees
                              if (absDelta > 60) devColor = "#dc2626";
                              else if (absDelta >= 40) devColor = "#ca8a04";
                              else devColor = "#16a34a";
                            } else if (groupAKeys.includes(p.key)) {
                              // GROUP A LOGIC: Strict % (3/5)
                              if (absPct > 5.0) devColor = "#dc2626";
                              else if (absPct >= 3.0) devColor = "#ca8a04";
                              else devColor = "#16a34a";
                            } else {
                              // OTHERS (SFOC, Scav Air, Fuel Index): Standard % (5/10)
                              if (absPct > 10.0) devColor = "#dc2626";
                              else if (absPct >= 5.0) devColor = "#ca8a04";
                              else devColor = "#16a34a";
                            }
                            // --- END OF NEW COLOR LOGIC ---
                          }
                        }
                      }

                      return (
                        <td
                          key={index}
                          style={{
                            textAlign: "center",
                            padding: "10px",
                            borderLeft: "1px solid #f1f5f9",
                          }}
                        >
                          {/* Display the Calculated Actual Value */}
                          <div style={{ fontWeight: "600", color: "#334155" }}>
                            {displayVal}
                          </div>
                          {/* Display the Deviation % */}
                          {p.key !== "engine_rpm" && (
                            <div
                              style={{
                                color: devColor,
                                fontWeight: "bold",
                                fontSize: "0.8rem",
                              }}
                            >
                              {displayDev}
                            </div>
                          )}
                        </td>
                      );
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    );
  };

  const downloadPDF = async (mode = "local") => {
    setIsGeneratingPDF(true);
    const yieldToMain = () => new Promise((resolve) => setTimeout(resolve, 0));

    setTimeout(async () => {
      const PDF_SCALE = 2.5; // Higher = sharper/clearer image
      const IMG_QUALITY = 0.85;

      // ── HELPER: capture any DOM element ──────────────────────────────────────
      const captureElement = async (element, title, center = false) => {
        if (!element) return null;
        try {
          await yieldToMain();
          const canvas = await html2canvas(element, {
            scale: PDF_SCALE,
            useCORS: true,
            backgroundColor: "#ffffff",
            logging: false,
            removeContainer: true,
            imageTimeout: 0,
          });
          const imgData = canvas.toDataURL("image/jpeg", IMG_QUALITY);
          return {
            imgData,
            width: canvas.width,
            height: canvas.height,
            title,
            center,
          };
        } catch (e) {
          console.warn("Capture failed for:", title, e);
          return null;
        }
      };

      // ── HELPER: capture a specific React ref container ────────────────────────
      const captureRef = async (ref, title) => {
        if (!ref || !ref.current) return null;
        return captureElement(ref.current, title);
      };

      try {
        const ship = fleet.find((s) => s.id === shipId);
        const shipName = ship?.name || "Unknown_Vessel";

        const getShortMonthYear = (monthStr) => {
          const [y, m] = monthStr.split("-");
          const months = [
            "JAN",
            "FEB",
            "MAR",
            "APR",
            "MAY",
            "JUN",
            "JUL",
            "AUG",
            "SEP",
            "OCT",
            "NOV",
            "DEC",
          ];
          return `${months[parseInt(m) - 1]} ${y}`;
        };

        const sortedReports = [...allMonthlyReports].sort(
          (a, b) => new Date(a.report_date) - new Date(b.report_date),
        );
        const monthYearList = sortedReports.map((r) =>
          getShortMonthYear(r.month),
        );
        const periodDisplay = [...new Set(monthYearList)].join(", ");

        const downloadDate = new Date().toLocaleDateString("en-GB", {
          day: "2-digit",
          month: "short",
          year: "numeric",
        });

        const vesselPart = shipName.replace(/[^a-z0-9]/gi, "_");
        const fileName = `${analysisMode.toLowerCase()}-${vesselPart}-${downloadDate.replace(/ /g, "_")}.pdf`;

        const pdf = new jsPDF("p", "mm", "a4");
        const pageWidth = pdf.internal.pageSize.getWidth();
        const pageHeight = pdf.internal.pageSize.getHeight();
        const margin = 10;

        // ── PAGE HEADER ────────────────────────────────────────────────────────
        const drawHeader = (doc, yPos) => {
          doc.setFontSize(8);
          doc.setFont("helvetica", "normal");
          doc.setTextColor(100, 100, 100);
          doc.text(
            `Downloaded: ${downloadDate}`,
            pageWidth - margin,
            yPos + 5,
            { align: "right" },
          );

          // try {
          //   doc.addImage(ozellarLogo, "PNG", margin, yPos + 3, 28, 12);
          // } catch (e) {}

          doc.setTextColor(0, 0, 0);
          doc.setFont("helvetica", "bold");
          doc.setFontSize(14);
          const analysisLabel =
            analysisMode === "mainEngine" ? "Main Engine" : "Auxiliary Engine";
          let subLabel = "";
          if (analysisMode === "auxiliaryEngine" && selectedGeneratorId) {
            const gen = generators.find(
              (g) => g.generator_id === selectedGeneratorId,
            );
            subLabel = gen ? ` - ${gen.designation || ""}` : "";
          }
          doc.text(
            `${analysisLabel} Performance Report${subLabel}`,
            pageWidth / 2,
            yPos + 10,
            { align: "center" },
          );

          doc.setFont("helvetica", "bold");
          doc.setFontSize(11);
          doc.text(`${shipName}`, pageWidth / 2, yPos + 16, {
            align: "center",
          });

          doc.setFont("helvetica", "normal");
          doc.setFontSize(9);
          doc.setTextColor(80, 80, 80);
          doc.text(
            `Report Period: ${periodDisplay}`,
            pageWidth / 2,
            yPos + 21,
            { align: "center" },
          );
          doc.setTextColor(0, 0, 0);
          return yPos + 30;
        };

        let currentY = drawHeader(pdf, margin);

        // ── HELPER: add image to PDF with page-break logic ────────────────────
        const addImageToPDF = (imgObj) => {
          if (!imgObj) return;
          const { imgData, width, height, title } = imgObj;
          const imgWidth = pageWidth - margin * 2;
          const imgHeight = (height * imgWidth) / width;
          const sectionHeight = imgHeight + 20;

          if (currentY + sectionHeight > pageHeight - 10) {
            pdf.addPage();
            currentY = drawHeader(pdf, margin);
          }

          pdf.setFont("helvetica", "bold");
          pdf.setFontSize(11);
          pdf.setTextColor(0, 0, 0);
          pdf.text(title, margin, currentY);
          currentY += 6;

          pdf.addImage(imgData, "JPEG", margin, currentY, imgWidth, imgHeight);
          currentY += imgHeight + 14;
        };

        // ======================================================================
        // SECTION 1 — PARAMETER DEVIATIONS TABLE (AutoTable — unchanged)
        // ======================================================================
        pdf.setFontSize(11);
        pdf.setFont("helvetica", "bold");
        pdf.text("1. Parameter Deviations vs Baseline", margin, currentY);
        currentY += 5;

        const isAuxPDF = analysisMode === "auxiliaryEngine";
        const MAIN_ORDER_PDF = [
          "EngSpeed",
          "Turbospeed",
          "FIPI",
          "Pmax",
          "Pcomp",
          "ScavAir",
          "Exh_T/C_inlet",
          "Exh_T/C_outlet",
          "Exh_Cylinder_outlet",
          "SFOC",
        ];
        const AUX_ORDER_PDF = [
          "Pmax",
          "FIPI",
          "ScavAirPressure",
          "Exh_T/C_inlet",
          "Exh_T/C_outlet",
          "Exh_Cylinder_outlet",
        ];
        const metricMappingPDF = isAuxPDF
          ? AUX_METRIC_MAPPING
          : MAIN_METRIC_MAPPING;
        const metricKeysPDF = (
          isAuxPDF ? AUX_ORDER_PDF : MAIN_ORDER_PDF
        ).filter((key) => metricMappingPDF.hasOwnProperty(key));
        // NOTE: Propeller Margin intentionally excluded per updated requirements
        // (Engine Load Diagram removed, so Propeller Margin row is also removed)

        const getShortLabel = (key) => {
          const shortNames = {
            FIPI: "Fuel Pump Index",
            Turbospeed: "Turbo Speed",
            EngSpeed: "Engine Speed",
            ScavAir: "Scav Air Press.",
            Pmax: "Pmax",
            Pcomp: "Pcomp",
            Exh_Cylinder_outlet: "Exh. Cyl. Out",
            "Exh_T/C_inlet": "Exh. T/C In",
            "Exh_T/C_outlet": "Exh. T/C Out",
            SFOC: "SFOC",
            ScavAirPressure: "Scav Air Press.",
          };
          return shortNames[key] || key;
        };

        const generateTableData = (reportsSubset) => {
          const headRow1 = [
            {
              content: "PARAMETER",
              rowSpan: 2,
              styles: {
                valign: "middle",
                halign: "center",
                fillColor: [241, 245, 249],
                fontStyle: "bold",
              },
            },
          ];
          const headRow2 = [];

          reportsSubset.forEach((r) => {
            const lPct = isAuxPDF ? r.load_percentage : r.load;
            const pVal = isAuxPDF
              ? r.load_kw
              : r.effective_power_kw || r.shaft_power_kw;
            const loadStr = `@ ${safeFixed(lPct, 2)}% Load`;
            const pwrStr = pVal ? `(${safeFixed(pVal, 0)} kW)` : "";
            const shortDate = r.report_date ? r.report_date.split(" ")[0] : "";

            headRow1.push({
              content: `${r.displayName}\n${loadStr} ${pwrStr}\n${shortDate}`,
              colSpan: 3,
              styles: {
                halign: "center",
                fillColor: [241, 245, 249],
                fontStyle: "bold",
                fontSize: 6,
              },
            });
            headRow2.push(
              {
                content: "Shop",
                styles: {
                  halign: "center",
                  fillColor: [248, 250, 252],
                  textColor: 100,
                },
              },
              {
                content: "Act",
                styles: {
                  halign: "center",
                  fillColor: [248, 250, 252],
                  textColor: 100,
                },
              },
              {
                content: "Dev %",
                styles: {
                  halign: "center",
                  fillColor: [248, 250, 252],
                  textColor: 100,
                },
              },
            );
          });

          const body = metricKeysPDF.map((key) => {
            const rowCells = [];
            let label = getShortLabel(key);
            let unit = getMetricUnit(key, isAuxPDF);
            let suffix = "";
            if (
              !isAuxPDF &&
              [
                "Pmax",
                "Pcomp",
                "ScavAir",
                "Exh_Cylinder_outlet",
                "SFOC",
              ].includes(key)
            )
              suffix = " (ISO)";

            rowCells.push({
              content: `${label}${suffix}\n(${unit})`,
              styles: { fontStyle: "bold", minCellWidth: 40 },
            });

            reportsSubset.forEach((report) => {
              const xAxis = isAuxPDF ? "load_percentage" : "load";
              const reportLoad = isAuxPDF
                ? report.load_percentage
                : report.load;
              const base =
                interpolateBaseline(baseline, reportLoad, key, xAxis) ?? 0;
              const val = report[key] || 0;
              let delta = 0,
                pct = 0;
              let color = [22, 163, 74];

              if (base !== 0 && val !== 0) {
                delta = val - base;
                pct = (delta / base) * 100;
                const absDelta = Math.abs(delta);
                const absPct = Math.abs(pct);
                const exhaustKeys = [
                  "Exh_T/C_inlet",
                  "Exh_T/C_outlet",
                  "Exh_Cylinder_outlet",
                ];

                if (key === "Turbospeed") {
                  if (absDelta >= 1000) color = [220, 38, 38];
                  else if (absDelta >= 500) color = [202, 138, 4];
                } else if (exhaustKeys.includes(key)) {
                  if (absDelta > 60) color = [220, 38, 38];
                  else if (absDelta >= 40) color = [202, 138, 4];
                } else {
                  const groupA = ["Pmax", "Pcomp", "Turbospeed", "EngSpeed"];
                  const groupB = ["FIPI", "ScavAir", "ScavAirPressure", "SFOC"];
                  if (groupA.includes(key)) {
                    if (absPct > 5.0) color = [220, 38, 38];
                    else if (absPct >= 3.0) color = [202, 138, 4];
                  } else if (groupB.includes(key)) {
                    if (absPct > 10.0) color = [220, 38, 38];
                    else if (absPct >= 5.0) color = [202, 138, 4];
                  }
                }
              }

              rowCells.push({
                content: safeFixed(base, 2),
                styles: { halign: "right", textColor: 100 },
              });
              rowCells.push({
                content: safeFixed(val, 2),
                styles: { halign: "right", fontStyle: "bold" },
              });
              rowCells.push({
                content: `${delta >= 0 ? "+" : ""}${safeFixed(delta, 2)}\n(${Math.abs(pct).toFixed(2)}%)`,
                styles: {
                  halign: "right",
                  fontStyle: "bold",
                  textColor: color,
                },
              });
            });
            return rowCells;
          });

          return { head: [headRow1, headRow2], body };
        };

        const reportsPerPage = 6;
        const reportsPerBlock = 3;

        for (let i = 0; i < allMonthlyReports.length; i += reportsPerPage) {
          const pageReports = allMonthlyReports.slice(i, i + reportsPerPage);
          if (i > 0) {
            pdf.addPage();
            currentY = drawHeader(pdf, margin);
          }

          const topReports = pageReports.slice(0, reportsPerBlock);
          const bottomReports = pageReports.slice(
            reportsPerBlock,
            reportsPerBlock * 2,
          );

          if (topReports.length > 0) {
            const { head, body } = generateTableData(topReports);
            autoTable(pdf, {
              startY: currentY,
              head,
              body,
              theme: "grid",
              styles: {
                fontSize: 6,
                cellPadding: 1.5,
                overflow: "linebreak",
                valign: "middle",
              },
              headStyles: {
                fillColor: [241, 245, 249],
                textColor: [30, 41, 59],
                lineWidth: 0.1,
                minCellHeight: 8,
              },
              columnStyles: { 0: { cellWidth: 40 } },
              margin: { left: margin, right: margin },
            });
            currentY = pdf.lastAutoTable.finalY + 8;
          }

          if (bottomReports.length > 0) {
            if (currentY > pageHeight - 80) {
              pdf.addPage();
              currentY = drawHeader(pdf, margin) + 5;
            }
            const { head, body } = generateTableData(bottomReports);
            autoTable(pdf, {
              startY: currentY,
              head,
              body,
              theme: "grid",
              styles: {
                fontSize: 6,
                cellPadding: 1.5,
                overflow: "linebreak",
                valign: "middle",
              },
              headStyles: {
                fillColor: [241, 245, 249],
                textColor: [30, 41, 59],
                lineWidth: 0.1,
                minCellHeight: 8,
              },
              columnStyles: { 0: { cellWidth: 40 } },
              margin: { left: margin, right: margin },
            });
            currentY = pdf.lastAutoTable.finalY + 15;
          }
        }

        currentY = pdf.lastAutoTable.finalY + 15;
        let sectionIndex = 2;

        // ======================================================================
        // SECTION 2 — MISSING PARAMETERS ALERT (Matches UI style)
        // ======================================================================
        if (missingFields && missingFields.length > 0) {
          const usableW = pageWidth - margin * 2;
          const rowCount = Math.ceil(missingFields.length / 2);
          const neededH = 8 + rowCount * 6 + 14; // header + rows + note

          if (currentY + neededH > pageHeight - margin) {
            pdf.addPage();
            currentY = drawHeader(pdf, margin);
          }

          // Light pink card background with thin red border
          pdf.setFillColor(254, 242, 242); // #fef2f2 light pink
          pdf.setDrawColor(220, 38, 38); // #dc2626 red border
          pdf.setLineWidth(0.5);
          pdf.rect(margin, currentY, usableW, neededH, "FD");

          // Header line: ⚠ icon + bold text (no full red bar)
          pdf.setFont("helvetica", "bold");
          pdf.setFontSize(8);
          pdf.setTextColor(185, 28, 28); // #b91c1c dark red
          pdf.text(
            `\u26A0  CRITICAL: MISSING FIELDS IN UPLOADED REPORT`,
            margin + 4,
            currentY + 6,
          );

          // Thin separator line under header
          pdf.setDrawColor(220, 38, 38);
          pdf.setLineWidth(0.3);
          pdf.line(margin, currentY + 9, margin + usableW, currentY + 9);

          currentY += 12;

          // Missing fields — 2 column bullet list
          pdf.setFont("helvetica", "normal");
          pdf.setFontSize(7.5);
          pdf.setTextColor(185, 28, 28); // #b91c1c

          const colW = usableW / 2;
          missingFields.forEach((field, index) => {
            const col = index % 2;
            const row = Math.floor(index / 2);
            const cellX = margin + col * colW + 4;
            const cellY = currentY + row * 6;
            pdf.text(`\u2022 ${field}`, cellX, cellY);
          });

          currentY += rowCount * 6 + 4;

          // Italic note
          pdf.setFont("helvetica", "italic");
          pdf.setFontSize(7);
          pdf.setTextColor(127, 29, 29); // #7f1d1d
          pdf.text(
            "Note: Calculations and troubleshooting will be inaccurate without these values.",
            margin + 4,
            currentY,
          );

          currentY += 8;
          sectionIndex++;
        }

        // ======================================================================
        // SECTION 3 — DIAGNOSIS PANEL (Pure text rendering — replaces canvas slice)
        // Matches UI exactly: severity header, comparedAgainst badge,
        // 3-column grid: Observation | Possible Causes | Diagnosis & Remedy
        // ======================================================================

        if (allMonthlyReports.length === 1) {
          const diagReport = allMonthlyReports[0];
          const concerns = getDetectedConcerns(
            diagReport,
            baseline,
            analysisMode,
          );

          if (concerns.length > 0) {
            // ── Force new page ──────────────────────────────────────────────────
            pdf.addPage();
            currentY = drawHeader(pdf, margin);

            // ── Section banner ──────────────────────────────────────────────────
            pdf.setFillColor(255, 247, 237); // #fff7ed
            pdf.rect(margin, currentY, pageWidth - margin * 2, 10, "F");
            pdf.setFont("helvetica", "bold");
            pdf.setFontSize(11);
            pdf.setTextColor(154, 52, 18); // #9a3412
            pdf.text(
              `SECTION ${sectionIndex}: TROUBLESHOOTING & DIAGNOSIS INSIGHTS  (${concerns.length} Findings)`,
              margin + 3,
              currentY + 7,
            );
            currentY += 14;
            sectionIndex++;

            // ── Column geometry ─────────────────────────────────────────────────
            // Layout: [Severity header spans full width]
            //         [Observation 38% | Causes 32% | Remedy 30%]
            const usableW = pageWidth - margin * 2;
            const colWidths = [usableW * 0.38, usableW * 0.32, usableW * 0.3];
            const colX = [
              margin,
              margin + colWidths[0],
              margin + colWidths[0] + colWidths[1],
            ];
            const colHeaders = [
              "OBSERVATION",
              "POSSIBLE CAUSES",
              "DIAGNOSIS & REMEDY",
            ];

            // ── Text wrapping helper ─────────────────────────────────────────────
            const wrapText = (doc, text, maxWidth, fontSize) => {
              doc.setFontSize(fontSize);
              return doc.splitTextToSize(String(text || ""), maxWidth - 4);
            };

            // ── Height estimator (dry-run) ───────────────────────────────────────
            const estimateRowHeight = (concern) => {
              const LINE_H = 4.2; // mm per line at 8pt
              const CELL_PAD = 4; // top + bottom padding

              const obsLines = wrapText(
                pdf,
                concern.finding,
                colWidths[0],
                8,
              ).length;
              const causesLines = concern.causes.reduce((acc, c) => {
                return acc + wrapText(pdf, `• ${c}`, colWidths[1], 8).length;
              }, 0);
              const remedyLines = wrapText(
                pdf,
                concern.remedy,
                colWidths[2],
                8,
              ).length;

              const maxLines = Math.max(obsLines, causesLines, remedyLines);
              return Math.max(maxLines * LINE_H + CELL_PAD * 2, 14);
            };

            // ── Draw one concern card ────────────────────────────────────────────
            const drawConcernCard = (concern, startY) => {
              const isCritical = concern.severity === "critical";

              // Colours matching UI exactly
              const headerBg = isCritical ? [255, 225, 230] : [254, 243, 199]; // #ffe1e6 / #fef3c7
              const borderColor = isCritical
                ? [254, 205, 211]
                : [253, 230, 138]; // #fecdd3 / #fde68a
              const cardBg = isCritical ? [255, 241, 242] : [255, 251, 235]; // #fff1f2 / #fffbeb
              const headerText = isCritical ? [159, 18, 57] : [146, 64, 14]; // #9f1239 / #92400e
              const remedyBg = [240, 249, 255]; // #f0f9ff
              const remedyText = [3, 105, 161]; // #0369a1
              const colHeaderC = [100, 116, 139]; // #64748b

              // ── Severity header bar ──────────────────────────────────────────
              const HEADER_H = 8;
              pdf.setFillColor(...headerBg);
              pdf.rect(margin, startY, usableW, HEADER_H, "F");

              // Thin border outline
              pdf.setDrawColor(...borderColor);
              pdf.setLineWidth(0.3);
              pdf.rect(margin, startY, usableW, HEADER_H, "S");

              // Severity + parameter label  (left)
              pdf.setFont("helvetica", "bold");
              pdf.setFontSize(8);
              pdf.setTextColor(...headerText);
              const severityLabel = `[${isCritical ? "CRITICAL" : "WARNING"}]  ${concern.parameter}`;
              pdf.text(severityLabel, margin + 3, startY + 5.5);

              // comparedAgainst badge  (right)
              if (concern.comparedAgainst) {
                pdf.setFont("helvetica", "normal");
                pdf.setFontSize(6.5);
                pdf.setTextColor(...colHeaderC);
                pdf.text(
                  `vs ${concern.comparedAgainst.toUpperCase()}`,
                  pageWidth - margin - 3,
                  startY + 5.5,
                  { align: "right" },
                );
              }

              let y = startY + HEADER_H;

              // ── Column header sub-row ────────────────────────────────────────
              const SUB_H = 6;
              pdf.setFillColor(248, 250, 252); // #f8fafc
              pdf.rect(margin, y, usableW, SUB_H, "F");
              pdf.setDrawColor(226, 232, 240);
              pdf.setLineWidth(0.2);
              pdf.line(margin, y + SUB_H, margin + usableW, y + SUB_H);

              pdf.setFont("helvetica", "bold");
              pdf.setFontSize(6.5);
              pdf.setTextColor(...colHeaderC);
              colHeaders.forEach((hdr, ci) => {
                if (ci > 0) {
                  pdf.setDrawColor(226, 232, 240);
                  pdf.line(colX[ci], y, colX[ci], y + SUB_H);
                }
                pdf.text(hdr, colX[ci] + 3, y + 4.2);
              });
              y += SUB_H;

              // ── Estimate data row height ─────────────────────────────────────
              const LINE_H = 4.2;
              const CELL_PAD = 4;

              const obsLines = wrapText(pdf, concern.finding, colWidths[0], 8);
              const remedyLines = wrapText(
                pdf,
                concern.remedy,
                colWidths[2],
                8,
              );
              const causeLines = concern.causes.flatMap((c) =>
                wrapText(pdf, `• ${c}`, colWidths[1], 8),
              );

              const rowH = Math.max(
                obsLines.length * LINE_H + CELL_PAD * 2,
                causeLines.length * LINE_H + CELL_PAD * 2,
                remedyLines.length * LINE_H + CELL_PAD * 2,
                14,
              );

              // ── Fill cell backgrounds ────────────────────────────────────────
              // Col 0 — Observation (card bg)
              pdf.setFillColor(...cardBg);
              pdf.rect(colX[0], y, colWidths[0], rowH, "F");

              // Col 1 — Causes (white)
              pdf.setFillColor(255, 255, 255);
              pdf.rect(colX[1], y, colWidths[1], rowH, "F");

              // Col 2 — Remedy (light blue)
              pdf.setFillColor(...remedyBg);
              pdf.rect(colX[2], y, colWidths[2], rowH, "F");

              // Vertical dividers
              pdf.setDrawColor(226, 232, 240);
              pdf.setLineWidth(0.2);
              pdf.line(colX[1], y, colX[1], y + rowH);
              pdf.line(colX[2], y, colX[2], y + rowH);

              // Bottom border
              pdf.line(margin, y + rowH, margin + usableW, y + rowH);

              // Left + right borders
              pdf.setDrawColor(...borderColor);
              pdf.setLineWidth(0.3);
              pdf.line(margin, startY, margin, y + rowH);
              pdf.line(margin + usableW, startY, margin + usableW, y + rowH);
              pdf.line(margin, y + rowH, margin + usableW, y + rowH);

              // ── Col 0: Observation text ──────────────────────────────────────
              pdf.setFont("helvetica", "bold");
              pdf.setFontSize(8);
              pdf.setTextColor(30, 41, 59); // #1e293b
              let textY = y + CELL_PAD;
              obsLines.forEach((line) => {
                pdf.text(line, colX[0] + 3, textY);
                textY += LINE_H;
              });

              // ── Col 1: Causes bullet list ────────────────────────────────────
              pdf.setFont("helvetica", "normal");
              pdf.setFontSize(8);
              pdf.setTextColor(71, 85, 105); // #475569
              textY = y + CELL_PAD;
              concern.causes.forEach((cause) => {
                const lines = wrapText(pdf, `• ${cause}`, colWidths[1], 8);
                lines.forEach((line) => {
                  pdf.text(line, colX[1] + 3, textY);
                  textY += LINE_H;
                });
              });

              // ── Col 2: Remedy text ───────────────────────────────────────────
              pdf.setFont("helvetica", "bold");
              pdf.setFontSize(8);
              pdf.setTextColor(...remedyText);
              textY = y + CELL_PAD;
              remedyLines.forEach((line) => {
                pdf.text(line, colX[2] + 3, textY);
                textY += LINE_H;
              });

              return HEADER_H + SUB_H + rowH + 4; // total height consumed + gap
            };

            // ── Render all concerns with page-break logic ────────────────────────
            for (const concern of concerns) {
              // Estimate total height needed
              const neededH =
                8 + // severity header
                6 + // col headers
                estimateRowHeight(concern) +
                4; // gap

              // Page break if not enough room
              if (currentY + neededH > pageHeight - margin - 5) {
                pdf.addPage();
                currentY = drawHeader(pdf, margin);
              }

              const consumed = drawConcernCard(concern, currentY);
              currentY += consumed;
            }

            currentY += 6; // breathing room after section
          }
        }
        // ── end SECTION 3 ────────────────────────────────────────────────────────

        // ======================================================================
        // SECTION 4 — ENGINE LOAD DIAGRAM → REMOVED per requirements
        // ======================================================================
        // (intentionally omitted)

        // ======================================================================
        // SECTION 5 — UNIT-WISE CYLINDER BAR CHARTS (ME + AE)
        // ======================================================================
        if (allMonthlyReports.length === 1) {
          const report = allMonthlyReports[0];
          const cyls = report.cylinder_readings;
          const isAE = analysisMode === "auxiliaryEngine";

          if (cyls && Object.keys(cyls).length > 0) {
            // ── Param definitions — AE uses fuel_index, ME uses fuel_index too (same key now confirmed)
            const hasPcomp = Object.values(cyls).some((c) => c.pcomp != null);

            const cylParams = [
              {
                key: "pmax",
                label: "Pmax",
                unit: "bar",
                avgKey: "Pmax",
                baselineKey: "Pmax",
                noAmber: true,
              },
              ...(hasPcomp
                ? [
                    {
                      key: "pcomp",
                      label: "Pcomp",
                      unit: "bar",
                      avgKey: "Pcomp",
                      baselineKey: "Pcomp",
                      noAmber: true,
                    },
                  ]
                : []),
              {
                key: "fuel_index",
                label: "Fuel Index",
                unit: "mm",
                avgKey: "FIPI",
                baselineKey: "FIPI",
                noAmber: false,
              },
              {
                key: "exhaust_temp",
                label: "Exh Cyl Outlet",
                unit: "°C",
                avgKey: "Exh_Cylinder_outlet",
                baselineKey: "Exh_Cylinder_outlet",
                noAmber: false,
              },
            ];

            const xAxisKey = "load";
            const loadVal = report.load;

            const getBarColor = (dev, noAmber) => {
              const abs = Math.abs(dev);
              if (noAmber) return abs <= 3 ? [22, 163, 74] : [220, 38, 38];
              if (abs <= 3) return [22, 163, 74];
              if (abs <= 5) return [202, 138, 4];
              return [220, 38, 38];
            };

            // ── Layout constants ───────────────────────────────────────────────
            const usableW = pageWidth - margin * 2;
            const titleH = 12;
            const chartBoxH = 95;
            const legStripH = 12;
            const slotGap = 8;

            const plotPadL = 16;
            const plotPadR = 22; // room for "Base" / "Shop" labels on right
            const plotPadT = 16;
            const plotPadB = 16; // C-label + actual value rows
            const plotW = usableW - plotPadL - plotPadR;
            const plotH = chartBoxH - plotPadT - plotPadB;

            const drawDashedH = (y, plotX, plotW, r, g, b, lw) => {
              if (y == null) return;
              pdf.setDrawColor(r, g, b);
              pdf.setLineWidth(lw);
              pdf.setLineDashPattern([1.8, 1.8], 0);
              pdf.line(plotX, y, plotX + plotW, y);
              pdf.setLineDashPattern([], 0);
            };

            // ── Section header ─────────────────────────────────────────────────
            pdf.addPage();
            currentY = drawHeader(pdf, margin);
            pdf.setFillColor(240, 249, 255);
            pdf.rect(margin, currentY, usableW, 10, "F");
            pdf.setFont("helvetica", "bold");
            pdf.setFontSize(11);
            pdf.setTextColor(3, 105, 161);
            pdf.text(
              `SECTION ${sectionIndex}: UNIT-WISE DEVIATION ANALYSIS${isAE ? " - AUXILIARY ENGINE" : " - MAIN ENGINE"}`,
              margin + 4,
              currentY + 7,
            );
            currentY += 14;
            sectionIndex++;
            let chartIndexOnPage = 0;
            for (let pi = 0; pi < cylParams.length; pi++) {
              const p = cylParams[pi];

              // Page break check
              if (chartIndexOnPage >= 2) {
                pdf.addPage();
                currentY = drawHeader(pdf, margin);
                chartIndexOnPage = 0;
              }

              // ── Compute values ───────────────────────────────────────────────
              const cylKeys = Object.keys(cyls).sort(
                (a, b) => Number(a) - Number(b),
              );
              const isoAvg = Number(report[p.avgKey] || 0);
              const shopVal = interpolateBaseline(
                baseline,
                loadVal,
                p.baselineKey,
                xAxisKey,
              );

              const devs = cylKeys.map((cylNo) => {
                const actual = Number(cyls[cylNo][p.key] || 0);
                const dev = p.noAmber
                  ? actual - isoAvg
                  : isoAvg !== 0
                    ? ((actual - isoAvg) / isoAvg) * 100
                    : 0;
                return { cylNo, actual, dev };
              });

              const shopTrialOffsetScaled =
                shopVal != null && isoAvg !== 0
                  ? p.noAmber
                    ? shopVal - isoAvg
                    : ((shopVal - isoAvg) / isoAvg) * 100
                  : null;

              const maxAbs = Math.max(
                ...devs.map((d) => Math.abs(d.dev)),
                shopTrialOffsetScaled != null
                  ? Math.abs(shopTrialOffsetScaled)
                  : 0,
                p.noAmber ? 3 : 5,
              );
              const axisExtent = Math.ceil(maxAbs * 1.35);

              // ── Y geometry ────────────────────────────────────────────────────
              const titleBarY = currentY;
              const chartBoxY = titleBarY + titleH;
              const legStripY = chartBoxY + chartBoxH;
              const plotX = margin + plotPadL;
              const plotTop = chartBoxY + plotPadT;
              const zeroY = plotTop + plotH / 2;
              const pxPerUnit = plotH / 2 / axisExtent;
              const clamp = (v) =>
                Math.max(plotTop, Math.min(plotTop + plotH, v));

              const shopDevY =
                shopTrialOffsetScaled != null
                  ? clamp(zeroY - shopTrialOffsetScaled * pxPerUnit)
                  : null;

              // ── 1. TITLE BAR ─────────────────────────────────────────────────
              // Blue-grey gradient style matching UI card header
              pdf.setFillColor(248, 250, 252);
              pdf.setDrawColor(226, 232, 240);
              pdf.setLineWidth(0.4);
              pdf.rect(margin, titleBarY, usableW, titleH, "FD");

              // Left: param label + unit
              pdf.setFont("helvetica", "bold");
              pdf.setFontSize(9);
              pdf.setTextColor(15, 23, 42);
              pdf.text(
                `${p.label.toUpperCase()} DEVIATION (${p.noAmber ? p.unit : "%"})`,
                margin + 4,
                titleBarY + 7.5,
              );

              // Right: Avg value + Shop Trial value
              pdf.setFont("helvetica", "bold");
              pdf.setFontSize(8);
              pdf.setTextColor(100, 116, 139);
              pdf.text(
                `Avg: ${isoAvg.toFixed(1)} ${p.unit}`,
                pageWidth - margin - 4,
                titleBarY + 5,
                { align: "right" },
              );
              if (shopVal != null) {
                pdf.setTextColor(202, 138, 4);
                pdf.text(
                  `Shop Trial: ${shopVal.toFixed(1)} ${p.unit}`,
                  pageWidth - margin - 4,
                  titleBarY + 10,
                  { align: "right" },
                );
              }

              // ── 2. CHART BOX ─────────────────────────────────────────────────
              pdf.setFillColor(255, 255, 255);
              pdf.setDrawColor(226, 232, 240);
              pdf.setLineWidth(0.5);
              pdf.rect(margin, chartBoxY, usableW, chartBoxH, "FD");

              // ── Color bands (red outer → amber middle → green center) ────────
              if (p.noAmber) {
                // Red full background
                pdf.setFillColor(254, 226, 226);
                pdf.rect(plotX, plotTop, plotW, plotH, "F");
                // Green center ±3
                pdf.setFillColor(220, 252, 231);
                const gTop = clamp(zeroY - 3 * pxPerUnit);
                const gBot = clamp(zeroY + 3 * pxPerUnit);
                if (gBot > gTop) pdf.rect(plotX, gTop, plotW, gBot - gTop, "F");
              } else {
                // Red full background
                pdf.setFillColor(254, 226, 226);
                pdf.rect(plotX, plotTop, plotW, plotH, "F");
                // Amber ±3 to ±5
                pdf.setFillColor(254, 243, 199);
                const a1T = clamp(zeroY - 5 * pxPerUnit);
                const a1B = clamp(zeroY - 3 * pxPerUnit);
                if (a1B > a1T) pdf.rect(plotX, a1T, plotW, a1B - a1T, "F");
                const a2T = clamp(zeroY + 3 * pxPerUnit);
                const a2B = clamp(zeroY + 5 * pxPerUnit);
                if (a2B > a2T) pdf.rect(plotX, a2T, plotW, a2B - a2T, "F");
                // Green center ±3
                pdf.setFillColor(220, 252, 231);
                const gTop = clamp(zeroY - 3 * pxPerUnit);
                const gBot = clamp(zeroY + 3 * pxPerUnit);
                if (gBot > gTop) pdf.rect(plotX, gTop, plotW, gBot - gTop, "F");
              }

              // ── Threshold dashed lines ────────────────────────────────────────
              if (p.noAmber) {
                drawDashedH(
                  clamp(zeroY - 3 * pxPerUnit),
                  plotX,
                  plotW,
                  220,
                  38,
                  38,
                  0.5,
                );
                drawDashedH(
                  clamp(zeroY + 3 * pxPerUnit),
                  plotX,
                  plotW,
                  220,
                  38,
                  38,
                  0.5,
                );
              } else {
                drawDashedH(
                  clamp(zeroY - 3 * pxPerUnit),
                  plotX,
                  plotW,
                  202,
                  138,
                  4,
                  0.5,
                );
                drawDashedH(
                  clamp(zeroY + 3 * pxPerUnit),
                  plotX,
                  plotW,
                  202,
                  138,
                  4,
                  0.5,
                );
                drawDashedH(
                  clamp(zeroY - 5 * pxPerUnit),
                  plotX,
                  plotW,
                  220,
                  38,
                  38,
                  0.5,
                );
                drawDashedH(
                  clamp(zeroY + 5 * pxPerUnit),
                  plotX,
                  plotW,
                  220,
                  38,
                  38,
                  0.5,
                );
              }

              // ── Zero baseline (solid grey line + right label) ─────────────────
              pdf.setDrawColor(148, 163, 184);
              pdf.setLineWidth(1.0);
              pdf.line(plotX, zeroY, plotX + plotW, zeroY);
              pdf.setFont("helvetica", "bold");
              pdf.setFontSize(5.5);
              pdf.setTextColor(148, 163, 184);
              pdf.text(
                `Base ${isoAvg.toFixed(1)}`,
                plotX + plotW + 2,
                zeroY + 1.5,
              );

              // ── Shop trial dashed amber line + right label ────────────────────
              if (shopDevY !== null) {
                pdf.setDrawColor(202, 138, 4);
                pdf.setLineWidth(1.0);
                pdf.setLineDashPattern([3, 2], 0);
                pdf.line(plotX, shopDevY, plotX + plotW, shopDevY);
                pdf.setLineDashPattern([], 0);
                pdf.setFont("helvetica", "bold");
                pdf.setFontSize(5.5);
                pdf.setTextColor(202, 138, 4);
                pdf.text(
                  `Shop ${shopVal.toFixed(1)}`,
                  plotX + plotW + 2,
                  shopDevY + 1.5,
                );
              }

              // ── Y-axis labels ─────────────────────────────────────────────────
              pdf.setFont("helvetica", "normal");
              pdf.setFontSize(5);
              pdf.setTextColor(100, 116, 139);
              const yTicks = p.noAmber
                ? [axisExtent, 3, 0, -3, -axisExtent]
                : [axisExtent, 5, 3, 0, -3, -5, -axisExtent];
              yTicks.forEach((v) => {
                const ty = zeroY - v * pxPerUnit;
                if (ty < plotTop + 1 || ty > plotTop + plotH - 1) return;
                pdf.text(
                  v === 0 ? "0" : `${v > 0 ? "+" : ""}${v}`,
                  plotX - 2,
                  ty + 1.5,
                  { align: "right" },
                );
              });

              // ── Bars ──────────────────────────────────────────────────────────
              const nCyls = devs.length;
              const spacing = plotW / nCyls;
              const barW = Math.min(spacing * 0.38, 7);
              const shopBarW = barW * 0.65;

              devs.forEach(({ cylNo, actual, dev }, idx) => {
                const bx =
                  plotX + idx * spacing + (spacing - barW - shopBarW - 1) / 2;
                const barH = Math.abs(dev) * pxPerUnit;
                const by = dev >= 0 ? zeroY - barH : zeroY;
                const [r, g, b] = getBarColor(dev, p.noAmber);

                // ISO deviation bar (green/amber/red)
                pdf.setFillColor(r, g, b);
                pdf.rect(bx, by, barW, Math.max(barH, 0.5), "F");

                // Shop trial gap bar (amber, right of ISO bar)
                if (shopTrialOffsetScaled != null) {
                  const shopBarStartY =
                    zeroY - shopTrialOffsetScaled * pxPerUnit;
                  const shopBarEndY = zeroY - dev * pxPerUnit;
                  const shopBarTop = Math.min(shopBarStartY, shopBarEndY);
                  const shopBarHeight = Math.abs(shopBarStartY - shopBarEndY);
                  if (shopBarHeight > 0.3) {
                    pdf.setFillColor(202, 138, 4);
                    pdf.setDrawColor(202, 138, 4);
                    pdf.rect(
                      bx + barW + 1,
                      shopBarTop,
                      shopBarW,
                      Math.max(shopBarHeight, 0.5),
                      "F",
                    );
                  }
                }

                // Deviation value label above/below bar
                if (barH > 2) {
                  const devTxt = `${dev > 0 ? "+" : ""}${dev.toFixed(1)}`;
                  pdf.setFont("helvetica", "bold");
                  pdf.setFontSize(4.5);
                  pdf.setTextColor(r, g, b);
                  let valY = dev >= 0 ? by - 1.5 : by + barH + 4.5;
                  valY = Math.max(
                    plotTop + 4,
                    Math.min(plotTop + plotH - 1.5, valY),
                  );
                  pdf.text(devTxt, bx + barW / 2, valY, { align: "center" });
                }

                // Cylinder label below chart
                pdf.setFont("helvetica", "bold");
                pdf.setFontSize(6);
                pdf.setTextColor(51, 65, 85);
                pdf.text(`Cyl ${cylNo}`, bx + barW / 2, plotTop + plotH + 6, {
                  align: "center",
                });

                // Actual value below cylinder label
                pdf.setFont("helvetica", "normal");
                pdf.setFontSize(5);
                pdf.setTextColor(100, 116, 139);
                pdf.text(
                  actual.toFixed(1),
                  bx + barW / 2,
                  plotTop + plotH + 11,
                  { align: "center" },
                );
              });

              // ── 3. LEGEND — inline above chart matching UI dot style ──────────
              const legendItems = p.noAmber
                ? [
                    { label: `<=3 ${p.unit} Normal`,   color: [22, 163, 74]  },
                    { label: `>3 ${p.unit} Critical`, color: [220, 38, 38] },
                    {
                      label: "Vs Shop Trial",
                      color: [202, 138, 4],
                      isShop: true,
                    },
                  ]
                : [
                    { label: "<=3% Normal", color: [22, 163, 74] },
                    { label: "3–5% Warning", color: [202, 138, 4] },
                    { label: ">5% Critical", color: [220, 38, 38] },
                    {
                      label: "Vs Shop Trial",
                      color: [202, 138, 4],
                      isShop: true,
                    },
                  ];

              // Draw legend row inside chart box just below title bar
              const legendRowY = chartBoxY + 6;
              pdf.setFont("helvetica", "normal");
              pdf.setFontSize(5.5);
              let legX = plotX;
              legendItems.forEach((item) => {
                const [r, g, b] = item.color;
                if (item.isShop) {
                  // Shop Trial: amber square + green square side by side
                  pdf.setFillColor(202, 138, 4);
                  pdf.rect(legX, legendRowY - 2, 3, 3, "F");
                } else {
                  // Dot like UI
                  pdf.setFillColor(r, g, b);
                  pdf.circle(legX + 2, legendRowY - 1, 1.2, "F");
                }
                pdf.setTextColor(71, 85, 105);
                pdf.text(item.label, legX + 6, legendRowY);
                legX += 6 + pdf.getTextWidth(item.label) + 4;
              });

              currentY = chartBoxY + chartBoxH + slotGap;
              chartIndexOnPage++;
            }

            currentY += 4;
          }
        }
        // ── end SECTION 5 ────────────────────────────────────────────────────────

        // ======================================================================
        // SECTION 6 — DEVIATION TREND OVER TIME
        // Layout: [Title Bar] + [Chart Box] + [Legend Strip] — 2 per page
        // ======================================================================
        {
          const isAuxMode = analysisMode === "auxiliaryEngine";

          const MAIN_TREND_PARAMS = [
            { key: "Turbospeed", label: "Turbo Speed", group: "ABS_TURBO" },
            { key: "FIPI", label: "Fuel Index", group: "B" },
            { key: "Pmax", label: "Pmax", group: "A" },
            { key: "Pcomp", label: "Pcomp", group: "A" },
            { key: "ScavAir", label: "Scav Air", group: "B" },
            {
              key: "Exh_Cylinder_outlet",
              label: "Exh Cyl Outlet",
              group: "ABS_EXHAUST",
            },
            { key: "SFOC", label: "SFOC", group: "B" },
          ];
          const AUX_TREND_PARAMS = [
            { key: "Pmax", label: "Pmax", group: "A" },
            { key: "FIPI", label: "Fuel Index", group: "B" },
            { key: "ScavAirPressure", label: "Scav Air", group: "B" },
            {
              key: "Exh_Cylinder_outlet",
              label: "Exh Cyl Outlet",
              group: "ABS_EXHAUST",
            },
          ];

          const trendParams = (
            isAuxMode ? AUX_TREND_PARAMS : MAIN_TREND_PARAMS
          ).filter((p) => baseline[p.key]);

          const sourceReports =
            availableReports.length > 0 ? availableReports : allMonthlyReports;
          const sortedReports = [...sourceReports].sort(
            (a, b) => new Date(a.report_date) - new Date(b.report_date),
          );

          if (trendParams.length > 0 && sortedReports.length >= 2) {
            const xAxisStr = isAuxMode ? "load_percentage" : "load";

            const getThresholds = (group) => {
              if (group === "A") return { amber: 3, red: 5 };
              if (group === "B") return { amber: 5, red: 10 };
              if (group === "ABS_TURBO") return { amber: 500, red: 1000 };
              if (group === "ABS_EXHAUST") return { amber: 40, red: 60 };
              return { amber: 5, red: 10 };
            };

            const getUnit = (group) => {
              if (group === "ABS_TURBO") return "RPM";
              if (group === "ABS_EXHAUST") return "°C";
              return "%";
            };

            const buildSeries = (paramKey, group) =>
              sortedReports.map((report) => {
                const load = isAuxMode ? report.load_percentage : report.load;
                const base = interpolateBaseline(
                  baseline,
                  load,
                  paramKey,
                  xAxisStr,
                );
                const actual = report[paramKey];
                if (base == null || actual == null || base === 0)
                  return { label: report.displayName, val: null };
                const val =
                  group === "ABS_TURBO" || group === "ABS_EXHAUST"
                    ? actual - base
                    : ((actual - base) / base) * 100;
                return { label: report.displayName, val };
              });

            // ── Slot layout ────────────────────────────────────────────────────
            const usableW = pageWidth - margin * 2;
            const titleH = 10;
            const chartBoxH = 85;
            const legStripH = 10; // reduced
            const slotGap = 5;

            const plotPadL = 12;
            const plotPadR = 6;
            const plotPadT = 10;
            const plotPadB = 16;
            const plotW = usableW - plotPadL - plotPadR;
            const plotH = chartBoxH - plotPadT - plotPadB;

            const BAND_COLORS = {
              green: [220, 252, 231],
              amber: [254, 243, 199],
              red: [254, 226, 226],
            };

            const LINE_COLOR = [8, 145, 178];

            const drawDashedSeg = (
              x1,
              y1,
              x2,
              y2,
              dashLen,
              gapLen,
              r,
              g,
              b,
              lw,
            ) => {
              const dx = x2 - x1,
                dy = y2 - y1;
              const total = Math.sqrt(dx * dx + dy * dy);
              if (total < 0.1) return;
              const ux = dx / total,
                uy = dy / total;
              let d = 0,
                on = true;
              while (d < total) {
                const seg = Math.min(on ? dashLen : gapLen, total - d);
                if (on) {
                  pdf.setDrawColor(r, g, b);
                  pdf.setLineWidth(lw);
                  pdf.line(
                    x1 + ux * d,
                    y1 + uy * d,
                    x1 + ux * (d + seg),
                    y1 + uy * (d + seg),
                  );
                }
                d += seg;
                on = !on;
              }
            };

            // ── Section header ─────────────────────────────────────────────────
            pdf.addPage();
            currentY = drawHeader(pdf, margin);
            pdf.setFont("helvetica", "bold");
            pdf.setFontSize(11);
            pdf.setTextColor(0, 0, 0);
            pdf.text(
              `SECTION ${sectionIndex}: DEVIATION TREND OVER TIME`,
              margin,
              currentY,
            );
            currentY += 8;
            sectionIndex++;

            let chartIndexOnPage = 0;

            for (let pi = 0; pi < trendParams.length; pi++) {
              const param = trendParams[pi];
              const unit = getUnit(param.group);
              const { amber, red } = getThresholds(param.group);
              const series = buildSeries(param.key, param.group);
              const validVals = series
                .map((s) => s.val)
                .filter((v) => v != null);
              if (validVals.length < 2) continue;

              if (chartIndexOnPage >= 2) {
                pdf.addPage();
                currentY = drawHeader(pdf, margin);
                chartIndexOnPage = 0;
              }

              const maxAbs = Math.max(...validVals.map(Math.abs), red * 1.1);
              const yExtent = maxAbs * 1.2;

              const titleBarY = currentY;
              const chartBoxY = titleBarY + titleH;
              const legStripY = chartBoxY + chartBoxH;

              const plotX = margin + plotPadL;
              const plotTop = chartBoxY + plotPadT;
              const zeroY = plotTop + plotH / 2;
              const pxPerU = plotH / 2 / yExtent;

              const n = series.length;
              const step = plotW / Math.max(n - 1, 1);
              const toX = (idx) => plotX + idx * step;
              const toY = (val) =>
                Math.max(
                  plotTop,
                  Math.min(plotTop + plotH, zeroY - val * pxPerU),
                );

              // ── 1. TITLE BAR ───────────────────────────────────────────────
              pdf.setFillColor(241, 245, 249);
              pdf.setDrawColor(226, 232, 240);
              pdf.setLineWidth(0.4);
              pdf.rect(margin, titleBarY, usableW, titleH, "FD");
              pdf.setFont("helvetica", "bold");
              pdf.setFontSize(9);
              pdf.setTextColor(15, 23, 42);
              pdf.text(
                `${param.label}  (${unit} deviation)`,
                margin + usableW / 2,
                titleBarY + 6.5,
                { align: "center" },
              );

              // ── 2. CHART BOX ───────────────────────────────────────────────
              pdf.setFillColor(255, 255, 255);
              pdf.setDrawColor(226, 232, 240);
              pdf.setLineWidth(0.4);
              pdf.rect(margin, chartBoxY, usableW, chartBoxH, "FD");

              // Inner plot bg
              pdf.setFillColor(248, 250, 252);
              pdf.rect(plotX, plotTop, plotW, plotH, "F");

              // ── Threshold bands (red bg → amber overlay → green center) ────
              const clamp = (v) =>
                Math.max(plotTop, Math.min(plotTop + plotH, v));

              pdf.setFillColor(...BAND_COLORS.red);
              pdf.rect(plotX, plotTop, plotW, plotH, "F");

              pdf.setFillColor(...BAND_COLORS.amber);
              const aTop1 = clamp(zeroY - red * pxPerU);
              const aBot1 = clamp(zeroY - amber * pxPerU);
              if (aBot1 > aTop1)
                pdf.rect(plotX, aTop1, plotW, aBot1 - aTop1, "F");
              const aTop2 = clamp(zeroY + amber * pxPerU);
              const aBot2 = clamp(zeroY + red * pxPerU);
              if (aBot2 > aTop2)
                pdf.rect(plotX, aTop2, plotW, aBot2 - aTop2, "F");

              pdf.setFillColor(...BAND_COLORS.green);
              const gTop = clamp(zeroY - amber * pxPerU);
              const gBot = clamp(zeroY + amber * pxPerU);
              if (gBot > gTop) pdf.rect(plotX, gTop, plotW, gBot - gTop, "F");

              // ── Threshold dashed lines ─────────────────────────────────────
              [
                { v: amber, r: 245, g: 158, b: 11 },
                { v: -amber, r: 245, g: 158, b: 11 },
                { v: red, r: 239, g: 68, b: 68 },
                { v: -red, r: 239, g: 68, b: 68 },
              ].forEach(({ v, r, g, b }) => {
                const ty = zeroY - v * pxPerU;
                if (ty < plotTop || ty > plotTop + plotH) return;
                drawDashedSeg(
                  plotX,
                  ty,
                  plotX + plotW,
                  ty,
                  2.5,
                  2,
                  r,
                  g,
                  b,
                  0.5,
                );
              });

              // Zero dashed green line
              drawDashedSeg(
                plotX,
                zeroY,
                plotX + plotW,
                zeroY,
                3,
                2,
                22,
                163,
                74,
                0.7,
              );

              // ── Y-axis labels ──────────────────────────────────────────────
              pdf.setFont("helvetica", "normal");
              pdf.setFontSize(5);
              pdf.setTextColor(100, 116, 139);

              const yTicks = [yExtent, red, amber, 0, -amber, -red, -yExtent];
              yTicks.forEach((v) => {
                const ty = zeroY - v * pxPerU;
                if (ty < plotTop + 1 || ty > plotTop + plotH - 1) return;
                const lbl =
                  v === 0
                    ? "0"
                    : `${v > 0 ? "+" : ""}${Number.isInteger(v) ? v : v.toFixed(0)}${unit === "%" ? "%" : ""}`;
                pdf.text(lbl, plotX - 1, ty + 1.5, { align: "right" });
              });

              // Y unit rotated
              pdf.setFontSize(5);
              pdf.text(unit, margin + 3, plotTop + plotH / 2, {
                angle: 90,
                align: "center",
              });

              // ── X-axis — ALL months always shown ──────────────────────────
              // Calculate available width per label and pick font size accordingly
              const availPerLabel = plotW / n;
              const xFontSize =
                availPerLabel < 12 ? 4 : availPerLabel < 18 ? 4.5 : 5;
              pdf.setFontSize(xFontSize);
              pdf.setTextColor(100, 116, 139);
              series.forEach((pt, idx) => {
                pdf.text(pt.label, toX(idx), plotTop + plotH + 5, {
                  align: "center",
                  maxWidth: availPerLabel * 0.95,
                });
              });

              // ── Data line + dots + VALUE LABELS (clamped inside plot) ──────
              let prevX = null,
                prevY = null;
              series.forEach((pt, idx) => {
                if (pt.val == null) {
                  prevX = null;
                  prevY = null;
                  return;
                }
                const cx = toX(idx);
                const cy = toY(pt.val); // already clamped to plotTop..plotTop+plotH

                // Line
                if (prevX !== null) {
                  pdf.setDrawColor(...LINE_COLOR);
                  pdf.setLineWidth(1.3);
                  pdf.line(prevX, prevY, cx, cy);
                }

                // Dot
                pdf.setFillColor(...LINE_COLOR);
                pdf.circle(cx, cy, 1.3, "F");

                // Value label — clamp so it never exits the chart box
                const valLbl = `${pt.val > 0 ? "+" : ""}${pt.val.toFixed(1)}${unit === "%" ? "%" : ""}`;
                pdf.setFontSize(4);
                pdf.setTextColor(...LINE_COLOR);

                // Preferred: above dot if positive, below if negative
                let labelY = pt.val >= 0 ? cy - 2.5 : cy + 5;
                // Clamp label inside plot area vertically
                labelY = Math.max(
                  plotTop + 4,
                  Math.min(plotTop + plotH - 2, labelY),
                );
                pdf.text(valLbl, cx, labelY, { align: "center" });

                prevX = cx;
                prevY = cy;
              });

              // ── 3. LEGEND STRIP (compact) ──────────────────────────────────
              pdf.setFillColor(252, 252, 253);
              pdf.setDrawColor(226, 232, 240);
              pdf.setLineWidth(0.4);
              pdf.rect(margin, legStripY, usableW, legStripH, "FD");

              const legendItems = [
                { label: `±${amber}${unit} Amber`, color: [245, 158, 11] },
                { label: `±${red}${unit} Red`, color: [239, 68, 68] },
                { label: "Zero Baseline", color: [22, 163, 74] },
                { label: param.label, color: LINE_COLOR },
              ];

              pdf.setFont("helvetica", "normal");
              pdf.setFontSize(4.5); // reduced font
              const ICON_R = 1.5; // reduced icon
              const GAP = 5;
              const itemWidths = legendItems.map(
                (item) => ICON_R * 2 + 3 + pdf.getTextWidth(item.label) + GAP,
              );
              const totalW = itemWidths.reduce((a, b) => a + b, 0);
              let legX = margin + (usableW - totalW) / 2;
              const legY = legStripY + 6;

              legendItems.forEach((item, i) => {
                const [r, g, b] = item.color;
                pdf.setFillColor(r, g, b);
                pdf.circle(legX + ICON_R, legY - 1.5, ICON_R, "F");
                pdf.setTextColor(71, 85, 105);
                pdf.text(item.label, legX + ICON_R * 2 + 3, legY);
                legX += itemWidths[i];
              });

              currentY = legStripY + legStripH + slotGap;
              chartIndexOnPage++;
            }

            currentY += 4;
          }
        }

        // ======================================================================
        // SECTION 7 — TREND OVER LOAD BASED
        // Layout per param: [Title bar] + [Chart box] + [Legend strip]
        // 2 params per page, each full width, nothing overlapping
        // ======================================================================
        {
          const isAuxMode = analysisMode === "auxiliaryEngine";

          const MAIN_ENV_PARAMS = [
            { key: "Turbospeed", label: "Turbo Speed" },
            { key: "FIPI", label: "Fuel Index" },
            { key: "Pmax", label: "Pmax" },
            { key: "Pcomp", label: "Pcomp" },
            { key: "ScavAir", label: "Scav Air" },
            { key: "Exh_Cylinder_outlet", label: "Exh Cyl Outlet" },
            { key: "SFOC", label: "SFOC" },
            { key: "Exh_T/C_inlet", label: "TC Inlet" },
            { key: "Exh_T/C_outlet", label: "TC Outlet" },
            { key: "EngSpeed", label: "Engine Speed" },
          ];
          const AUX_ENV_PARAMS = [
            { key: "Pmax", label: "Pmax" },
            { key: "FIPI", label: "Fuel Index" },
            { key: "ScavAirPressure", label: "Scav Air" },
            { key: "Exh_T/C_inlet", label: "TC Inlet" },
            { key: "Exh_T/C_outlet", label: "TC Outlet" },
            { key: "Exh_Cylinder_outlet", label: "Exh Cyl Outlet" },
          ];

          const envParams = (
            isAuxMode ? AUX_ENV_PARAMS : MAIN_ENV_PARAMS
          ).filter((p) => baseline[p.key] && baseline[p.key].length > 0);

          if (envParams.length > 0) {
            const SCATTER_COLORS = [
              [220, 38, 38],
              [37, 99, 235],
              [147, 51, 234],
              [5, 150, 105],
              [249, 115, 22],
              [8, 145, 178],
              [202, 138, 4],
              [219, 39, 119],
              [22, 163, 74],
              [124, 58, 237],
              [190, 18, 60],
              [3, 105, 161],
            ];

            const oneYearAgo = new Date();
            oneYearAgo.setFullYear(oneYearAgo.getFullYear() - 1);
            const sourceReports = (
              availableReports.length > 0 ? availableReports : allMonthlyReports
            ).filter(
              (r) => !r.report_date || new Date(r.report_date) >= oneYearAgo,
            );

            // ── Helpers ───────────────────────────────────────────────────────
            const drawDashedSeg = (
              x1,
              y1,
              x2,
              y2,
              dashLen,
              gapLen,
              r,
              g,
              b,
              lw,
            ) => {
              const dx = x2 - x1,
                dy = y2 - y1;
              const total = Math.sqrt(dx * dx + dy * dy);
              if (total < 0.1) return;
              const ux = dx / total,
                uy = dy / total;
              let d = 0,
                on = true;
              while (d < total) {
                const seg = Math.min(on ? dashLen : gapLen, total - d);
                if (on) {
                  pdf.setDrawColor(r, g, b);
                  pdf.setLineWidth(lw);
                  pdf.line(
                    x1 + ux * d,
                    y1 + uy * d,
                    x1 + ux * (d + seg),
                    y1 + uy * (d + seg),
                  );
                }
                d += seg;
                on = !on;
              }
            };

            const drawX = (cx, cy, size, r, g, b, lw) => {
              pdf.setDrawColor(r, g, b);
              pdf.setLineWidth(lw);
              pdf.line(cx - size, cy - size, cx + size, cy + size);
              pdf.line(cx - size, cy + size, cx + size, cy - size);
            };
            const usableW = pageWidth - margin * 2;

            const titleH = 10; // title bar height
            const chartBoxH = 85; // pure chart box (plot + axes only)
            const legStripH = 16; // legend strip height (enough for 2 rows if needed)
            const slotGap = 5; // gap between slot 1 and slot 2

            // Two slots must fit on one page after header
            // Total per slot = titleH + chartBoxH + legStripH + slotGap
            const slotH = titleH + chartBoxH + legStripH + slotGap;

            // Plot paddings inside chartBox
            const plotPadL = 30; // Y labels
            const plotPadR = 8;
            const plotPadT = 8; // top breathing room
            const plotPadB = 16; // X tick labels + "Load (%)" label
            const plotW = usableW - plotPadL - plotPadR;
            const plotH = chartBoxH - plotPadT - plotPadB;

            // ── Section header ─────────────────────────────────────────────────
            pdf.addPage();
            currentY = drawHeader(pdf, margin);
            pdf.setFont("helvetica", "bold");
            pdf.setFontSize(11);
            pdf.setTextColor(0, 0, 0);
            pdf.text(
              `SECTION ${sectionIndex}: TREND OVER LOAD BASED`,
              margin,
              currentY,
            );
            currentY += 8;
            sectionIndex++;

            let chartIndexOnPage = 0;

            for (let pi = 0; pi < envParams.length; pi++) {
              const param = envParams[pi];
              const unit = getMetricUnit(param.key, isAuxMode);

              const curve = (baseline[param.key] || [])
                .map((p) => ({
                  load: isAuxMode ? (p.load_percentage ?? p.load) : p.load,
                  val: p.value,
                }))
                .filter(
                  (p) => Number.isFinite(p.load) && Number.isFinite(p.val),
                )
                .sort((a, b) => a.load - b.load);

              if (curve.length === 0) continue;

              const scatterPts = sourceReports
                .map((r, ri) => ({
                  load: Number(isAuxMode ? r.load_percentage : r.load),
                  val: Number(r[param.key]),
                  name: r.displayName,
                  colorIdx: ri,
                }))
                .filter(
                  (p) => Number.isFinite(p.load) && Number.isFinite(p.val),
                );

              // New page every 2 charts
              if (chartIndexOnPage >= 2) {
                pdf.addPage();
                currentY = drawHeader(pdf, margin);
                chartIndexOnPage = 0;
              }

              // ── Axis domain ───────────────────────────────────────────────
              const allVals = [
                ...curve.map((p) => p.val),
                ...scatterPts.map((p) => p.val),
              ];
              const allLoads = [
                ...curve.map((p) => p.load),
                ...scatterPts.map((p) => p.load),
              ];
              const rawYMin = Math.min(...allVals);
              const rawYMax = Math.max(...allVals);
              const yPad = (rawYMax - rawYMin) * 0.12 || rawYMax * 0.05 || 5;
              const yMin = rawYMin - yPad;
              const yMax = rawYMax + yPad;
              const xMin = Math.max(0, Math.min(...allLoads) - 5);
              const xMax = Math.min(115, Math.max(...allLoads) + 5);

              // ── Y positions for the 3 parts ───────────────────────────────
              const titleBarY = currentY;
              const chartBoxY = titleBarY + titleH;
              const legStripY = chartBoxY + chartBoxH;

              const plotX = margin + plotPadL;
              const plotTop = chartBoxY + plotPadT;

              const toX = (load) =>
                plotX + ((load - xMin) / (xMax - xMin)) * plotW;
              const toY = (val) =>
                plotTop + plotH - ((val - yMin) / (yMax - yMin)) * plotH;

              // ── 1. TITLE BAR ──────────────────────────────────────────────
              // Light blue-grey background, bold param name + unit
              pdf.setFillColor(241, 245, 249);
              pdf.setDrawColor(226, 232, 240);
              pdf.setLineWidth(0.4);
              pdf.rect(margin, titleBarY, usableW, titleH, "FD");

              pdf.setFont("helvetica", "bold");
              pdf.setFontSize(9);
              pdf.setTextColor(15, 23, 42);
              pdf.text(
                `${param.label}  (${unit})`,
                margin + usableW / 2,
                titleBarY + 6.5,
                { align: "center" },
              );

              // ── 2. CHART BOX ──────────────────────────────────────────────
              // White box with border
              pdf.setFillColor(255, 255, 255);
              pdf.setDrawColor(226, 232, 240);
              pdf.setLineWidth(0.4);
              pdf.rect(margin, chartBoxY, usableW, chartBoxH, "FD");

              // Inner plot background
              pdf.setFillColor(248, 250, 252);
              pdf.rect(plotX, plotTop, plotW, plotH, "F");

              // Y-axis unit label (rotated)
              pdf.setFont("helvetica", "normal");
              pdf.setFontSize(6);
              pdf.setTextColor(100, 116, 139);
              pdf.text(unit, margin + 5, plotTop + plotH / 2, {
                angle: 90,
                align: "center",
              });

              // Horizontal grid + Y-axis tick labels
              pdf.setFontSize(5.5);
              const ySteps = 5;
              for (let g = 0; g <= ySteps; g++) {
                const gy = plotTop + (g / ySteps) * plotH;
                const val = yMax - ((yMax - yMin) * g) / ySteps;
                drawDashedSeg(
                  plotX,
                  gy,
                  plotX + plotW,
                  gy,
                  3,
                  3,
                  203,
                  213,
                  225,
                  0.2,
                );
                pdf.setTextColor(100, 116, 139);
                pdf.text(val.toFixed(1), plotX - 2, gy + 1.5, {
                  align: "right",
                });
              }

              // Vertical grid + X-axis tick labels
              [25, 50, 75, 100, 110].forEach((tick) => {
                if (tick < xMin || tick > xMax) return;
                const tx = toX(tick);
                drawDashedSeg(
                  tx,
                  plotTop,
                  tx,
                  plotTop + plotH,
                  3,
                  3,
                  203,
                  213,
                  225,
                  0.2,
                );
                pdf.setFontSize(5.5);
                pdf.setTextColor(100, 116, 139);
                pdf.text(`${tick}%`, tx, plotTop + plotH + 5, {
                  align: "center",
                });
              });

              // X-axis title "Load (%)"
              pdf.setFontSize(6.5);
              pdf.setTextColor(100, 116, 139);
              pdf.text("Load (%)", plotX + plotW / 2, plotTop + plotH + 13, {
                align: "center",
              });

              // Baseline dashed amber curve
              for (let i = 0; i < curve.length - 1; i++) {
                const x1 = toX(curve[i].load),
                  y1 = toY(curve[i].val);
                const x2 = toX(curve[i + 1].load),
                  y2 = toY(curve[i + 1].val);
                if (x2 < plotX - 2 || x1 > plotX + plotW + 2) continue;
                drawDashedSeg(x1, y1, x2, y2, 3.5, 2.5, 202, 138, 4, 1.5);
              }

              // Scatter × markers — size 1.5, clean
              scatterPts.forEach((pt) => {
                const cx = toX(pt.load);
                const cy = toY(pt.val);
                if (cx < plotX - 3 || cx > plotX + plotW + 3) return;
                if (cy < plotTop - 3 || cy > plotTop + plotH + 3) return;
                const [r, g, b] =
                  SCATTER_COLORS[pt.colorIdx % SCATTER_COLORS.length];
                drawX(cx, cy, 1.5, r, g, b, 0.9);
              });

              // ── 3. LEGEND STRIP ───────────────────────────────────────────
              // Separate box below chart, white bg with top border
              pdf.setFillColor(252, 252, 253);
              pdf.setDrawColor(226, 232, 240);
              pdf.setLineWidth(0.4);
              pdf.rect(margin, legStripY, usableW, legStripH, "FD");

              const allLegendItems = [
                {
                  label: "Shop Trial (Baseline)",
                  isDashed: true,
                  color: [202, 138, 4],
                },
                ...scatterPts.map((pt) => ({
                  label: pt.name,
                  isDashed: false,
                  color: SCATTER_COLORS[pt.colorIdx % SCATTER_COLORS.length],
                })),
              ];

              pdf.setFont("helvetica", "normal");
              pdf.setFontSize(5.5);

              // Measure items and center in one row; wrap to second row if needed
              const ICON_W = 11;
              const GAP = 7;
              const itemWidths = allLegendItems.map(
                (item) => ICON_W + pdf.getTextWidth(item.label) + GAP,
              );
              const totalW = itemWidths.reduce((a, b) => a + b, 0);

              // Start X — centered if fits, left-aligned otherwise
              let legX =
                totalW <= usableW - 8
                  ? margin + (usableW - totalW) / 2
                  : margin + 6;
              let legY = legStripY + 6;
              let rowUsed = 0;

              allLegendItems.forEach((item, idx) => {
                const iw = itemWidths[idx];
                // Wrap to row 2 if overflow
                if (legX + iw > margin + usableW - 4 && idx > 0) {
                  legX = margin + (usableW - iw) / 2;
                  legY += 7;
                  rowUsed = 0;
                }
                const [r, g, b] = item.color;
                if (item.isDashed) {
                  // Dashed line icon for baseline
                  drawDashedSeg(
                    legX,
                    legY - 1.5,
                    legX + 9,
                    legY - 1.5,
                    2.5,
                    1.5,
                    r,
                    g,
                    b,
                    1.1,
                  );
                } else {
                  // × icon — size 1.5 matches chart markers
                  drawX(legX + 4, legY - 1.5, 1.5, r, g, b, 0.9);
                }
                pdf.setTextColor(71, 85, 105);
                pdf.text(item.label, legX + ICON_W, legY);
                legX += iw;
                rowUsed += iw;
              });

              // Advance currentY past this full slot
              currentY = legStripY + legStripH + slotGap;
              chartIndexOnPage++;
            }

            currentY += 4;
          }
        }

        // ======================================================================
        // SECTION 8 — HISTORICAL DEVIATION TABLE (Direct autoTable - no screenshot)
        // ======================================================================
        const historyData =
          analysisMode === "mainEngine"
            ? meDeviationHistory
            : aeDeviationHistory;

        if (historyData && historyData.length > 0) {
          pdf.addPage();
          currentY = drawHeader(pdf, margin);

          pdf.setFont("helvetica", "bold");
          pdf.setFontSize(11);
          pdf.setTextColor(0, 0, 0);
          pdf.text(
            `SECTION ${sectionIndex}: ${
              analysisMode === "mainEngine" ? "ME" : "AE"
            } Historical Deviation Analysis (Last 6 Reports)`,
            margin,
            currentY,
          );
          currentY += 8;

          // ── PARAMETER DEFINITIONS (mirrors UI exactly) ──
          const meParameters = [
            {
              label: "Engine RPM",
              key: "engine_rpm",
              unit: "rpm",
              isLoad: false,
              isProp: false,
            },
            {
              label: "Load",
              key: "load_percentage",
              unit: "%",
              isLoad: true,
              isProp: false,
            },
            {
              label: "Power Margin",
              key: "propeller_margin",
              unit: "%",
              isLoad: false,
              isProp: true,
            },
            {
              label: "Turbo Speed",
              key: "turbo_rpm",
              unit: "RPM",
              isLoad: false,
              isProp: false,
            },
            {
              label: "Fuel Index",
              key: "fuel_index",
              unit: "mm",
              isLoad: false,
              isProp: false,
            },
            {
              label: "Pmax",
              key: "pmax",
              unit: "bar",
              isLoad: false,
              isProp: false,
            },
            {
              label: "Pcomp",
              key: "pcomp",
              unit: "bar",
              isLoad: false,
              isProp: false,
            },
            {
              label: "Scav Air Press",
              key: "scav",
              unit: "kg/cm²",
              isLoad: false,
              isProp: false,
            },
            {
              label: "TC Inlet",
              key: "exh_tc_in",
              unit: "°C",
              isLoad: false,
              isProp: false,
            },
            {
              label: "TC Outlet",
              key: "exh_tc_out",
              unit: "°C",
              isLoad: false,
              isProp: false,
            },
            {
              label: "Exh Cyl Outlet",
              key: "exh_cyl_out",
              unit: "°C",
              isLoad: false,
              isProp: false,
            },
            {
              label: "SFOC",
              key: "sfoc",
              unit: "g/kWh",
              isLoad: false,
              isProp: false,
            },
          ];

          const aeParameters = [
            {
              label: "Load",
              key: "load_percentage",
              unit: "%",
              isLoad: true,
              isProp: false,
            },
            {
              label: "Pmax",
              key: "pmax",
              unit: "Bar",
              isLoad: false,
              isProp: false,
            },
            {
              label: "FIPI",
              key: "fipi",
              unit: "mm",
              isLoad: false,
              isProp: false,
            },
            {
              label: "Scav Air",
              key: "scav_air",
              unit: "Bar",
              isLoad: false,
              isProp: false,
            },
            {
              label: "TC Inlet",
              key: "tc_in",
              unit: "°C",
              isLoad: false,
              isProp: false,
            },
            {
              label: "TC Outlet",
              key: "tc_out",
              unit: "°C",
              isLoad: false,
              isProp: false,
            },
            {
              label: "Exh Cyl Out",
              key: "exh_cyl_out",
              unit: "°C",
              isLoad: false,
              isProp: false,
            },
          ];

          // ── BASELINE KEY MAP (mirrors UI exactly) ──
          const meBaselineKeyMap = {
            engine_rpm: "EngSpeed",
            fuel_index: "FIPI",
            pmax: "Pmax",
            pcomp: "Pcomp",
            scav: "ScavAir",
            turbo_rpm: "Turbospeed",
            exh_tc_in: "Exh_T/C_inlet",
            exh_tc_out: "Exh_T/C_outlet",
            exh_cyl_out: "Exh_Cylinder_outlet",
            sfoc: "SFOC",
          };

          const aeBaselineKeyMap = {
            fipi: "FIPI",
            pmax: "Pmax",
            scav_air: "ScavAirPressure",
            tc_in: "Exh_T/C_inlet",
            tc_out: "Exh_T/C_outlet",
            exh_cyl_out: "Exh_Cylinder_outlet",
          };

          const parameters =
            analysisMode === "mainEngine" ? meParameters : aeParameters;
          const baselineMap =
            analysisMode === "mainEngine" ? meBaselineKeyMap : aeBaselineKeyMap;
          const xAxisKey =
            analysisMode === "mainEngine" ? "load" : "load_percentage";

          // ── SORT REPORTS DESCENDING (mirrors UI) ──
          const sortedHistory = [...historyData].sort(
            (a, b) => new Date(b.report_date) - new Date(a.report_date),
          );

          // ── COLOR LOGIC (mirrors UI exactly) ──
          const getDevColor = (key, delta, pct) => {
            const absDelta = Math.abs(delta);
            const absPct = Math.abs(pct);
            const tempKeys = [
              "exh_tc_in",
              "exh_tc_out",
              "exh_cyl_out",
              "tc_in",
              "tc_out",
            ];
            const groupA = ["engine_rpm", "pmax", "pcomp", "turbo_rpm"];

            if (key === "turbo_rpm") {
              if (absDelta >= 1000) return [220, 38, 38]; // red
              if (absDelta >= 500) return [202, 138, 4]; // amber
              return [22, 163, 74]; // green
            }
            if (tempKeys.includes(key)) {
              if (absDelta > 60) return [220, 38, 38];
              if (absDelta >= 40) return [202, 138, 4];
              return [22, 163, 74];
            }
            if (groupA.includes(key)) {
              if (absPct > 5.0) return [220, 38, 38];
              if (absPct >= 3.0) return [202, 138, 4];
              return [22, 163, 74];
            }
            // Group B (FIPI, ScavAir, SFOC etc)
            if (absPct > 10.0) return [220, 38, 38];
            if (absPct >= 5.0) return [202, 138, 4];
            return [22, 163, 74];
          };

          // ── BUILD TABLE HEAD ──
          const headRow = [
            {
              content: "PARAMETER",
              styles: {
                halign: "left",
                fillColor: [241, 245, 249],
                textColor: [30, 41, 59],
                fontStyle: "bold",
                minCellWidth: 35,
              },
            },
            ...sortedHistory.map((r) => ({
              content: `${getMonthDisplayName(r.report_month)}\n${r.report_date || ""}`,
              styles: {
                halign: "center",
                fillColor: [241, 245, 249],
                textColor: [30, 41, 59],
                fontStyle: "bold",
                fontSize: 7,
              },
            })),
          ];

          // ── BUILD TABLE BODY ──
          const body = parameters.map((p) => {
            const labelCell = {
              content: `${p.label} (${p.unit})`,
              styles: {
                fontStyle: "bold",
                fillColor: [248, 250, 252],
                textColor: [51, 65, 85],
              },
            };

            const dataCells = sortedHistory.map((r) => {
              // ── LOAD ROW ──
              if (p.isLoad) {
                return {
                  content: `${r.load_percentage?.toFixed(2)}%`,
                  styles: {
                    halign: "center",
                    fontStyle: "bold",
                    textColor: [30, 41, 59],
                  },
                };
              }

              // ── PROPELLER MARGIN ROW ──
              if (p.isProp) {
                const actual = r[`${p.key}_actual`];
                if (actual == null)
                  return { content: "-", styles: { halign: "center" } };

                let propActual, propDev;
                if (Math.abs(actual) > 50) {
                  propActual = actual;
                  propDev = actual - 100;
                } else {
                  propActual = 100 + actual;
                  propDev = actual;
                }
                const devColor =
                  propDev > 5
                    ? [220, 38, 38]
                    : propDev >= 0
                      ? [202, 138, 4]
                      : [22, 163, 74];
                return {
                  content: `${propActual.toFixed(1)}\n${propDev > 0 ? "+" : ""}${propDev.toFixed(1)}%`,
                  styles: {
                    halign: "center",
                    textColor: devColor,
                    fontStyle: "bold",
                    fontSize: 7,
                  },
                };
              }

              // ── STANDARD METRIC ROW ──
              const actualKey = `${p.key}_actual`;
              const actual = r[actualKey];
              const baselineMetricKey = baselineMap[p.key];

              if (actual == null)
                return { content: "-", styles: { halign: "center" } };

              // Skip deviation for engine_rpm (matches UI)
              if (p.key === "engine_rpm") {
                return {
                  content: actual.toFixed(1),
                  styles: {
                    halign: "center",
                    fontStyle: "bold",
                    textColor: [51, 65, 85],
                  },
                };
              }

              // Calculate deviation (same interpolateBaseline logic as UI)
              let displayDev = "-";
              let devColor = [100, 116, 139]; // grey default

              if (
                baselineMetricKey &&
                baseline &&
                Object.keys(baseline).length > 0
              ) {
                const computedBase = interpolateBaseline(
                  baseline,
                  r.load_percentage,
                  baselineMetricKey,
                  xAxisKey,
                );
                if (computedBase && computedBase !== 0) {
                  const delta = actual - computedBase;
                  const pct = (delta / computedBase) * 100;
                  displayDev = `${pct > 0 ? "+" : ""}${pct.toFixed(1)}%`;
                  devColor = getDevColor(p.key, delta, pct);
                }
              }

              return {
                content: `${actual.toFixed(1)}\n${displayDev}`,
                styles: {
                  halign: "center",
                  textColor: devColor,
                  fontStyle: "bold",
                  fontSize: 7,
                },
              };
            });

            return [labelCell, ...dataCells];
          });

          // ── RENDER TABLE ──
          autoTable(pdf, {
            startY: currentY,
            head: [headRow],
            body,
            theme: "grid",
            styles: {
              fontSize: 7.5,
              cellPadding: 2.5,
              valign: "middle",
              overflow: "linebreak",
            },
            headStyles: {
              fillColor: [241, 245, 249],
              textColor: [30, 41, 59],
              lineWidth: 0.1,
              minCellHeight: 10,
            },
            columnStyles: {
              0: { cellWidth: 38 }, // Parameter label column wider
            },
            margin: { left: margin, right: margin },
          });

          currentY = pdf.lastAutoTable.finalY + 15;
          sectionIndex++;
        }

        // ======================================================================
        // SAVE / UPLOAD
        // ======================================================================
        if (mode === "local") {
          pdf.save(fileName);
          alert("✅ Report downloaded successfully!");
        } else if (mode === "cloud") {
          const pdfBlob = pdf.output("blob");
          const formData = new FormData();
          formData.append("file", pdfBlob, fileName);
          formData.append("report_id", allMonthlyReports[0]?.report_id);
          formData.append("report_type", analysisMode);
          await axiosAepms.uploadGeneratedReportPDF(formData);
          alert("Report uploaded to cloud!");
        }
      } catch (err) {
        console.error("PDF generation error:", err);
        alert("❌ Error: " + err.message);
      } finally {
        setIsGeneratingPDF(false);
      }
    }, 100);
  };
  // --- NEW HANDLER: MERGES VIEW & DOWNLOAD ---
  const handleDirectDownload = () => {
    // 1. Validation: Ensure a report is selected
    if (selectedReportIds.length === 0) {
      alert("Please select a report first.");
      return;
    }

    // 2. Trigger the Analysis Generation (Makes charts appear)
    handleViewReport();

    // 3. Set the flag to auto-download once charts are ready
    // The useEffect from Step 1 will detect this and run downloadPDF('local')
    setTriggerAutoDownload(true);
  };

  // --- NEW HANDLER: Triggers fetch ONLY when View button is clicked ---
  const handleViewReport = () => {
    // 1. Handle Empty Selection: Clear visualizations and return
    setMissingFields([]);
    setShowShopTrialMap({});
    setEnvelopeParam("Pmax");
    // --- CRITICAL FIX: RESET ALL ANALYSIS STATES IMMEDIATELY ---
    // This prevents AE2 data from staying on screen while AE3 is loading.
    setBaseline({});
    setLoadDiagramData(null);
    setMeDeviationHistory([]);
    setAeDeviationHistory([]);
    setSelectedTrendParams(["Pmax", "SFOC"]);
    setDisplayedReportIds([]); // Clear current view until fresh data arrives
    // -----------------------------------------------------------

    if (selectedReportIds.length === 0) {
      alert("Please select a report first.");
      return;
    }

    setBaselineSource("api");
    setLoading(true);
    setShowReport(true);
    setDisplayedReportIds(selectedReportIds);

    // Get the primary report (usually the most recent one selected)
    const latestId = selectedReportIds[0];
    const report = availableReports.find((r) => r.value === latestId);

    if (report) {
      setCurrentReferenceMonth(report.month);

      // --- MAIN ENGINE LOGIC ---
      if (analysisMode === "mainEngine") {
        // A. Fetch Graph Data & Baseline
        axiosAepms
          .getGraphData(report.report_id)
          .then((gRes) => {
            if (gRes.graph_data) {
              setLoadDiagramData(gRes.graph_data.engine_load_diagram_data);

              if (gRes.graph_data.shop_trial_baseline) {
                const transformedBaseline = {};
                Object.entries(MAIN_METRIC_MAPPING).forEach(
                  ([frontendKey, backendKey]) => {
                    const points = gRes.graph_data.shop_trial_baseline
                      .filter((point) => point[backendKey] !== null)
                      .map((point) => ({
                        load: point.load_percentage,
                        value: point[backendKey],
                      }))
                      .sort((a, b) => a.load - b.load);
                    if (points.length > 0)
                      transformedBaseline[frontendKey] = points;
                  },
                );
                setBaseline(transformedBaseline);
              }
            }
          })
          .catch((err) => console.error("Graph fetch error", err));

        // B. Fetch History Table
        const ship = fleet.find((s) => s.id === shipId);
        const imoNumber = parseInt(ship?.imo || ship?.imo_number);
        if (imoNumber) {
          axiosAepms
            .getMainEngineDeviationHistory(imoNumber, report.month)
            .then((d) => setMeDeviationHistory(d.history || []))
            .catch((e) => console.error("History fetch error", e))
            .finally(() => setLoading(false));
        } else {
          setLoading(false);
        }
      }

      // --- AUXILIARY ENGINE LOGIC (AE3 Selection Fix) ---
      else if (analysisMode === "auxiliaryEngine") {
        if (selectedGeneratorId) {
          // Fetch History & Baseline in parallel for the SPECIFIC selectedGeneratorId
          Promise.all([
            axiosAepms.getAEDeviationHistoryTable(
              selectedGeneratorId,
              report.month,
            ),
            axiosAepms.getAuxPerformance(selectedGeneratorId),
          ])
            .then(([historyData, perfData]) => {
              // 1. Set History Table for AE3
              setAeDeviationHistory(historyData.history || []);

              // 2. Process and Set Baseline Curve for AE3
              if (
                perfData.graph_data &&
                perfData.graph_data.shop_trial_baseline
              ) {
                const transformedBaseline = {};
                Object.entries(AUX_METRIC_MAPPING).forEach(
                  ([frontendKey, backendKey]) => {
                    const points = perfData.graph_data.shop_trial_baseline
                      .map((point) => {
                        const val = findValueInPoint(point, backendKey);
                        return {
                          // Standardize keys for AE interpolation
                          load: point.load_percentage,
                          load_kw: point.load_kw,
                          load_percentage: point.load_percentage,
                          value: val,
                        };
                      })
                      .filter((p) => p.value !== null && p.value !== undefined)
                      .sort((a, b) => (a.load_kw || 0) - (b.load_kw || 0));

                    if (points.length > 0)
                      transformedBaseline[frontendKey] = points;
                  },
                );

                // This will now strictly overwrite the baseline state with AE3 data
                setBaseline(transformedBaseline);
              }
            })
            .catch((err) => {
              console.error("AE Data Fetch Error:", err);
              setBaseline({}); // Reset on error to avoid showing wrong data
            })
            .finally(() => setLoading(false));
        } else {
          setLoading(false);
        }
      }
    } else {
      setLoading(false);
    }
  };
  const handleBatchRawDownload = async () => {
    if (selectedRawDownloadIds.length === 0) {
      alert("Please select reports first.");
      return;
    }

    setLoading(true);
    try {
      // 1. Fetch the ZIP blob
      const blob = await axiosAepms.getBatchRawZip(
        selectedRawDownloadIds,
        uploadMode,
      );

      // 2. Create a download link for the blob
      const url = window.URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.setAttribute(
        "download",
        `Reports_Batch_${new Date().getTime()}.zip`,
      );
      document.body.appendChild(link);
      link.click();

      // 3. Cleanup
      link.parentNode.removeChild(link);
      window.URL.revokeObjectURL(url);
      setSelectedRawDownloadIds([]);
    } catch (error) {
      console.error("ZIP download failed:", error);
      alert("Failed to generate ZIP file.");
    } finally {
      setLoading(false);
    }
  };
  // --- HANDLER: Download Raw Report ---
  // --- UPDATED HANDLER: Downloads the original source PDF ---
  const handleDownloadRaw = async (reportId) => {
    if (!reportId) return;

    setLoading(true);
    try {
      // 1. Call the new specific endpoint
      // analysisMode is already 'mainEngine' or 'auxiliaryEngine' in your state
      const response = await axiosAepms.getRawReportUrl(reportId, analysisMode);

      // 2. Extract the signed URL from backend response
      const finalUrl = response.data?.download_url || response.download_url;

      if (finalUrl) {
        // 3. Open in new tab (browser will handle the SAS download header)
        window.open(finalUrl, "_blank");
      } else {
        alert("Could not locate the original file for this report.");
      }
    } catch (error) {
      console.error("Download failed:", error);
      alert(
        "Failed to retrieve the original report link. It may not have been stored during the initial upload.",
      );
    } finally {
      setLoading(false);
    }
  };
  const handleDirectDownloadClick = () => {
    // 1. Validation
    if (selectedReportIds.length === 0) {
      alert("Please select a report first.");
      return;
    }

    // 2. Check if the selected data is ALREADY loaded in state
    const isDataReady =
      showReport &&
      displayedReportIds.length > 0 &&
      selectedReportIds.length === displayedReportIds.length &&
      selectedReportIds.every((id) => displayedReportIds.includes(id));

    if (isDataReady) {
      // Scenario A: Data is already there. Just download.
      downloadPDF("local");
    } else {
      // Scenario B: Data is NOT there. Fetch it SILENTLY (without setting showReport to true)

      // Reset states for fresh calculation (but keep showReport false)
      setMissingFields([]);
      setBaseline({});
      setLoadDiagramData(null);
      setMeDeviationHistory([]);
      setAeDeviationHistory([]);

      setBaselineSource("api");
      setLoading(true);

      // Crucial: Update displayedReportIds so the 'allMonthlyReports' memo (used by PDF) populates
      setDisplayedReportIds(selectedReportIds);

      const latestId = selectedReportIds[0];
      const report = availableReports.find((r) => r.value === latestId);

      if (report) {
        setCurrentReferenceMonth(report.month);

        // --- MAIN ENGINE BACKGROUND FETCH ---
        if (analysisMode === "mainEngine") {
          axiosAepms
            .getGraphData(report.report_id)
            .then((gRes) => {
              if (gRes.graph_data) {
                setLoadDiagramData(gRes.graph_data.engine_load_diagram_data);
                if (gRes.graph_data.shop_trial_baseline) {
                  const transformedBaseline = {};
                  Object.entries(MAIN_METRIC_MAPPING).forEach(([fK, bK]) => {
                    const pts = gRes.graph_data.shop_trial_baseline
                      .filter((p) => p[bK] !== null)
                      .map((p) => ({ load: p.load_percentage, value: p[bK] }))
                      .sort((a, b) => a.load - b.load);
                    if (pts.length > 0) transformedBaseline[fK] = pts;
                  });
                  setBaseline(transformedBaseline);
                }
              }
            })
            .catch((err) =>
              console.error("Silent Fetch Error (ME Graph):", err),
            );

          const ship = fleet.find((s) => s.id === shipId);
          const imo = parseInt(ship?.imo || ship?.imo_number);
          if (imo) {
            axiosAepms
              .getMainEngineDeviationHistory(imo, report.month)
              .then((d) => setMeDeviationHistory(d.history || []))
              .catch((e) =>
                console.error("Silent Fetch Error (ME History):", e),
              )
              .finally(() => {
                setLoading(false);
                // Trigger the useEffect that waits for baseline + reports to download the PDF
                setTriggerLocalDownload(true);
              });
          } else {
            setLoading(false);
            setTriggerLocalDownload(true);
          }
        }

        // --- AUXILIARY ENGINE BACKGROUND FETCH ---
        else if (analysisMode === "auxiliaryEngine") {
          if (selectedGeneratorId) {
            Promise.all([
              axiosAepms.getAEDeviationHistoryTable(
                selectedGeneratorId,
                report.month,
              ),
              axiosAepms.getAuxPerformance(selectedGeneratorId),
            ])
              .then(([hData, pData]) => {
                setAeDeviationHistory(hData.history || []);
                if (pData.graph_data?.shop_trial_baseline) {
                  const transformedBaseline = {};
                  Object.entries(AUX_METRIC_MAPPING).forEach(([fK, bK]) => {
                    const pts = pData.graph_data.shop_trial_baseline
                      .map((pt) => ({
                        load: pt.load_percentage,
                        load_kw: pt.load_kw,
                        load_percentage: pt.load_percentage,
                        value: findValueInPoint(pt, bK),
                      }))
                      .filter((p) => p.value != null)
                      .sort((a, b) => (a.load_kw || 0) - (b.load_kw || 0));
                    if (pts.length > 0) transformedBaseline[fK] = pts;
                  });
                  setBaseline(transformedBaseline);
                }
              })
              .catch((err) => console.error("Silent Fetch Error (AE):", err))
              .finally(() => {
                setLoading(false);
                setTriggerLocalDownload(true);
              });
          } else {
            setLoading(false);
          }
        }
      } else {
        setLoading(false);
      }
    }
  };
  if (loading && !hasAccess) {
    return (
      <div style={{ padding: "20px", textAlign: "center" }}>Loading...</div>
    );
  }

  const isAux = analysisMode === "auxiliaryEngine";
  const metricMapping = isAux ? AUX_METRIC_MAPPING : MAIN_METRIC_MAPPING;

  const singleChartSeries = baseline[selectedMetric]
    ? baseline[selectedMetric].map((p) => ({
        // 🔥 CHANGE 3: Safely grab the correct X property based on user selection
        x: isAux
          ? xAxisType === "load_kw"
            ? p.load_kw
            : p.load_percentage
          : p.load,
        y: p.value,
      }))
    : [];

  // 🔥 FIX 1 APPLIED: Calculate customTicks and related vars for the single chart view
  const singleChartMetricUnit = getMetricUnit(selectedMetric, isAux);
  const singleChartYDomain = getYAxisDomain(
    selectedMetric,
    baseline,
    allMonthlyReports,
  );
  const singleChartCustomTicks = getCustomTicks(
    singleChartYDomain,
    selectedMetric,
  );

  // 🔥 FINAL FIX APPLIED: Define xAxisKey and xLabel for use in the single chart view's outer JSX.
  const xAxisKey = isAux ? xAxisType : "load";
  const xLabel = isAux
    ? xAxisOptions.find((opt) => opt.key === xAxisType)?.label
    : "Load (%)";

  return (
    <div
      className={
        embeddedMode ? "unified-performance-embed" : "performance-container"
      }
    >
      {!embeddedMode && (
        <div className="performance-header">
          <h1 className="performance-title">Performance Analysis</h1>
          <p className="performance-subtitle">
            {analysisMode === "mainEngine"
              ? "Main Engine performance analysis"
              : analysisMode === "auxiliaryEngine"
                ? "Auxiliary Engine  performance analysis"
                : "Lube Oil Analysis - Coming Soon"}
          </p>
        </div>
      )}

      {/* --- START OF NEW 3-CARD LAYOUT --- */}
      {/* --- START OF NEW MASTER CONTROL CARD --- */}
      {/* --- PERFORMANCE CONTROL CONSOLE --- */}
      <div
        style={{
          display: "flex",
          flexDirection: "column",
          gap: "12px",
          marginBottom: embeddedMode ? "16px" : "32px",
          width: "100%",
        }}
      >
        {/* --- UNIFIED CONTROL PANEL (Your Preferred Layout) --- */}
        {/* --- RESTRUCTURED PERFORMANCE CONTROL CONSOLE --- */}
        <div
  style={{
    display: "flex",
    flexDirection: "row",
    alignItems: "flex-end",
    gap: "8px",
    background: "white",
    padding: "10px 16px",
    borderRadius: "12px",
    border: "1px solid #e2e8f0",
    boxShadow: "0 4px 6px -1px rgba(0, 0, 0, 0.05)",
    width: "100%",
    boxSizing: "border-box",
    flexWrap: "nowrap",
    overflow: "visible",
    zIndex: 400,
  }}
>
          {/* 1. VESSEL SELECTOR */}
          <div style={{ flex: "1", minWidth: "180px", scrollbarWidth: "thin",
    scrollbarColor: "#94a3b8 transparent"}}>
            <label
              style={{
                fontSize: "0.65rem",
                fontWeight: "800",
                color: "#475569",
                textTransform: "uppercase",
                letterSpacing: "0.05em",
                display: "block",
                marginBottom: "6px",
              }}
            >
              Vessel
            </label>
            <SingleSelectDropdown
              value={shipId}
              onChange={(val) => handleShipChange(val)}
              placeholder="SELECT VESSEL"
              options={fleet.map((ship) => ({
                value: ship.id,
                label: formatVesselName(ship.name)?.toUpperCase() || "",
              }))}
            />
          </div>

          {/* 2. ENGINE TYPE TOGGLE (Preserving handleModeChange logic) */}
          <div style={{ width: "150px" }}>
            <label
              style={{
                fontSize: "0.65rem",
                fontWeight: "800",
                color: "#475569",
                textTransform: "uppercase",
                letterSpacing: "0.05em",
                display: "block",
                marginBottom: "6px",
              }}
            >
              Engine Type
            </label>
            <div
              style={{
                display: "flex",
                background: "#f1f5f9",
                padding: "3px",
                borderRadius: "8px",
                border: "1px solid #e2e8f0",
                height: "42px",
                boxSizing: "border-box",
              }}
            >
              <button
                onClick={() => handleModeChange("mainEngine")}
                style={{
                  flex: 1,
                  borderRadius: "6px",
                  fontSize: "0.75rem",
                  fontWeight: "800",
                  border: "none",
                  cursor: "pointer",
                  backgroundColor:
                    analysisMode === "mainEngine" ? "white" : "transparent",
                  color: analysisMode === "mainEngine" ? "#0f172a" : "#94a3b8",
                  boxShadow:
                    analysisMode === "mainEngine"
                      ? "0 2px 4px rgba(0,0,0,0.1)"
                      : "none",
                  transition: "all 0.2s",
                }}
              >
                ME
              </button>
              <button
                onClick={() => handleModeChange("auxiliaryEngine")}
                style={{
                  flex: 1,
                  borderRadius: "6px",
                  fontSize: "0.75rem",
                  fontWeight: "800",
                  border: "none",
                  cursor: "pointer",
                  backgroundColor:
                    analysisMode === "auxiliaryEngine"
                      ? "white"
                      : "transparent",
                  color:
                    analysisMode === "auxiliaryEngine" ? "#0f172a" : "#94a3b8",
                  boxShadow:
                    analysisMode === "auxiliaryEngine"
                      ? "0 2px 4px rgba(0,0,0,0.1)"
                      : "none",
                  transition: "all 0.2s",
                }}
              >
                AE
              </button>
            </div>
          </div>

          {/* 3. UNIT SELECTOR (Conditional AE Logic) */}
          {analysisMode === "auxiliaryEngine" && (
            <div style={{ width: "180px", animation: "fadeIn 0.2s ease" }}>
              <label
                style={{
                  fontSize: "0.65rem",
                  fontWeight: "800",
                  color: "#475569",
                  textTransform: "uppercase",
                  letterSpacing: "0.05em",
                  display: "block",
                  marginBottom: "6px",
                }}
              >
                Unit
              </label>
              <SingleSelectDropdown
                value={selectedGeneratorId}
                disabled={!shipId || (loading && generators.length === 0)}
                onChange={(val) => {
                  const id = Number(val);
                  setSelectedGeneratorId(id);
                  setDownloadGenId(id);
                }}
                placeholder="Select Unit"
                options={generators.map((gen) => ({
                  value: gen.generator_id,
                  label: gen.designation || `Aux Engine No.${gen.generator_id}`,
                }))}
              />
            </div>
          )}

          {/* 4. DIRECT + UPLOAD ACTION */}
          <div style={{ width: "auto" }}>
            <input
              type="file"
              accept=".pdf"
              id="direct-upload-input"
              style={{ display: "none" }}
              onChange={handleFileUpload}
            />
            <Button
              onClick={() =>
                document.getElementById("direct-upload-input").click()
              }
              disabled={
                !shipId ||
                (analysisMode === "auxiliaryEngine" && !selectedGeneratorId)
              }
              style={{
                backgroundColor: "#0f172a", // Sky blue for primary action
                color: "white",
                height: "42px",
                padding: "0 16px",
                fontWeight: "800",
                fontSize: "0.75rem",
                whiteSpace: "nowrap",
              }}
            >
              + UPLOAD
            </Button>
          </div>

          {/* 5. SELECT REPORTS (Preserving MultiSelect and availableReports connection) */}
          <div style={{ flex: "2", minWidth: "250px" }}>
            <label
              style={{
                fontSize: "0.65rem",
                fontWeight: "800",
                color: "#475569",
                textTransform: "uppercase",
                letterSpacing: "0.05em",
                display: "block",
                marginBottom: "6px",
              }}
            >
              Select Reports to Analyze
            </label>
            <MultiSelectDropdown
              label={
                availableReports.length > 0 ? "Select Reports" : "Loading..."
              }
              options={availableReports}
              selectedIds={selectedReportIds}
              onChange={(ids) => setSelectedReportIds(ids)}
            />
          </div>

          {/* 6. ANALYZE BUTTON (Restored logic: disabled during loading) */}
          <Button
            onClick={handleViewReport}
            disabled={
              !shipId ||
              loading || // 🔥 Logic Cross-check: Prevents click while fetching
              selectedReportIds.length === 0 ||
              (analysisMode === "auxiliaryEngine" && !selectedGeneratorId)
            }
            style={{
              backgroundColor: "#0f172a",
              color: "white",
              height: "42px",
              padding: "0 20px",
              fontWeight: "800",
              fontSize: "0.8rem",
            }}
          >
            {loading ? "..." : "ANALYZE"}
          </Button>

          {/* 7. PDF DOWNLOAD BUTTON (Preserving direct download logic) */}
          <Button
            variant="secondary"
            onClick={handleDirectDownloadClick}
            disabled={isGeneratingPDF || selectedReportIds.length === 0}
            style={{
              height: "42px",
              width: "42px",
              padding: "0",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
            }}
          >
            {isGeneratingPDF ? "..." : <Download size={18} />}
          </Button>
        </div>

        {/* --- ROW 2: INFO BAR (FIXED: Restored original Fallback Strings) --- */}
        {shipId && (
          <div
            style={{
              display: "flex",
              alignItems: "center",
              justifyContent: "space-between",
              background: "#f8fafc",
              padding: "10px 20px",
              borderRadius: "10px",
              border: "1px solid #e2e8f0",
              animation: "fadeIn 0.3s ease",
            }}
          >
            <div style={{ display: "flex", alignItems: "center", gap: "12px" }}>
              <span style={{ fontSize: "1.2rem" }}>📜</span>
              <div
                style={{
                  display: "flex",
                  gap: "8px",
                  alignItems: "baseline",
                }}
              >
                <span
                  style={{
                    fontSize: "0.7rem",
                    fontWeight: "800",
                    color: "#64748b",
                    textTransform: "uppercase",
                  }}
                >
                  Last Report Received:
                </span>
                <span
                  style={{
                    fontSize: "0.9rem",
                    fontWeight: "700",
                    color: "#0f172a",
                  }}
                >
                  {(() => {
                    if (analysisMode === "mainEngine") {
                      return formatReportDate(lastReportDates.mainEngine); // Fixed Logic Point 3: Removed explicit "No records" fallback as per source
                    }
                    const activeGen = generators.find(
                      (g) => g.generator_id === selectedGeneratorId,
                    );
                    if (activeGen) {
                      const label =
                        activeGen.designation ||
                        activeGen.generator_designation ||
                        `Gen ${activeGen.generator_id}`;
                      return (
                        formatReportDate(
                          lastReportDates.auxiliaryEngine[label],
                        ) || "No record found"
                      );
                    }
                    return "Select Unit Above"; // Fixed Logic Point 3: Restored original string
                  })()}
                </span>
              </div>
            </div>

            <div
              style={{
                fontSize: "0.65rem",
                fontWeight: "600",
                color: "#94a3b8",
                textTransform: "uppercase",
              }}
            >
              Status:{" "}
              {activeTab === "view" ? "Analysis Mode" : "Raw Data Management"}
            </div>
          </div>
        )}
      </div>
      {/* --- END OF NEW MASTER CONTROL CARD --- */}
      {/* --- END OF NEW 3-CARD LAYOUT --- */}

      {showReport && (
        <>
          <div ref={analysisResultsRef} style={{ scrollMarginTop: "100px" }}>
            {renderMissingAlert()}
            {allMonthlyReports.length === 1 && (
              <DiagnosisPanel
                report={allMonthlyReports[0]}
                baseline={baseline}
                analysisMode={analysisMode}
              />
            )}
            {allMonthlyReports.length === 1 &&
              allMonthlyReports[0].cylinder_readings &&
              (() => {
                const report = allMonthlyReports[0];
                const cyls = report.cylinder_readings;
                const isAE = analysisMode === "auxiliaryEngine";

                // Dynamic configuration based on ME or AE
                // ME uses 'fuel_index', AE uses 'fuel_rack' based on your Python processor
                const params = [
                  {
                    key: "pmax",
                    label: "Pmax",
                    unit: "bar",
                    avgValue: report.Pmax,
                    baselineKey: "Pmax",
                    isPercent: false,
                    noAmber: true,
                  },
                  // Pcomp is standard for ME, but we check if data exists for AE
                  ...(isAE && !cyls["1"]?.pcomp
                    ? []
                    : [
                        {
                          key: "pcomp",
                          label: "Pcomp",
                          unit: "bar",
                          avgValue: report.Pcomp,
                          baselineKey: "Pcomp",
                          isPercent: false,
                          noAmber: true,
                        },
                      ]),
                  {
                    key: isAE ? "fuel_rack" : "fuel_index",
                    label: "Fuel Index",
                    unit: "mm",
                    avgValue: report.FIPI,
                    baselineKey: "FIPI",
                    isPercent: true,
                    noAmber: false,
                  },
                  {
                    key: "exhaust_temp",
                    label: "Exh Cyl Outlet",
                    unit: "°C",
                    avgValue: report.Exh_Cylinder_outlet,
                    baselineKey: "Exh_Cylinder_outlet",
                    isPercent: true,
                    noAmber: false,
                  },
                ].filter((p) => {
                  // Safety check: Only show the chart if the key actually exists in the cylinder data
                  return Object.values(cyls).some(
                    (c) => c[p.key] !== undefined && c[p.key] !== null,
                  );
                });

                const getBarColorNoAmber = (deviation) => {
                  return Math.abs(deviation) <= 3 ? "#16a34a" : "#dc2626";
                };

                const getBarColorPercent = (deviationPct) => {
                  const abs = Math.abs(deviationPct);
                  if (abs <= 3) return "#16a34a";
                  if (abs <= 5) return "#ca8a04";
                  return "#dc2626";
                };

                return (
                  <div
                    className="enhanced-card"
                    style={{
                      marginBottom: "24px",
                      border: "1px solid #e2e8f0",
                      overflow: "hidden",
                    }}
                  >
                    <div
                      onClick={() =>
                        setIsCylinderCardExpanded(!isCylinderCardExpanded)
                      }
                      style={{
                        padding: "14px 24px",
                        display: "flex",
                        justifyContent: "space-between",
                        alignItems: "center",
                        cursor: "pointer",
                        backgroundColor: "#f8fafc",
                        borderBottom: isCylinderCardExpanded
                          ? "1px solid #e2e8f0"
                          : "none",
                      }}
                    >
                      <div
                        style={{
                          display: "flex",
                          alignItems: "center",
                          gap: "10px",
                        }}
                      >
                        <span style={{ fontSize: "1.2rem" }}>📊</span>
                        <h3
                          style={{
                            margin: 0,
                            fontSize: "1rem",
                            fontWeight: "700",
                            color: "#1e293b",
                          }}
                        >
                          {isAE
                            ? `Unit-Wise Deviation Analysis - ${bookmarkLabel}`
                            : "Unit-Wise Deviation Analysis (Main Engine)"}
                        </h3>
                      </div>
                      <span
                        style={{
                          transform: isCylinderCardExpanded
                            ? "rotate(180deg)"
                            : "rotate(0deg)",
                          transition: "0.3s",
                        }}
                      >
                        ▼
                      </span>
                    </div>

                    {isCylinderCardExpanded && (
                      <div
                        style={{
                          padding: "24px",
                          display: "grid",
                          gridTemplateColumns: "repeat(2, 1fr)",
                          gap: "12px",
                        }}
                      >
                        {params.map((p) => {
                          const isoAvg = Number(p.avgValue || 0);

                          // Handle load reference: ME uses 'load', AE uses 'load_percentage'
                          const currentLoad = isAE
                            ? report.load_percentage
                            : report.load;
                          const xAxisKey = isAE ? "load_percentage" : "load";

                          const shopTrialValue = interpolateBaseline(
                            baseline,
                            currentLoad,
                            p.baselineKey,
                            xAxisKey,
                          );
                          const shopTrialOffset =
                            shopTrialValue != null
                              ? shopTrialValue - isoAvg
                              : null;

                          let shopTrialOffsetScaled = null;
                          if (shopTrialOffset != null) {
                            shopTrialOffsetScaled =
                              p.isPercent && isoAvg !== 0
                                ? (shopTrialOffset / isoAvg) * 100
                                : shopTrialOffset;
                          }

                          const chartData = Object.keys(cyls).map((cylNo) => {
                            const actualValue = Number(cyls[cylNo][p.key] || 0);
                            let deviationValue;
                            if (p.isPercent) {
                              deviationValue =
                                isoAvg !== 0
                                  ? ((actualValue - isoAvg) / isoAvg) * 100
                                  : 0;
                            } else {
                              deviationValue = actualValue - isoAvg;
                            }

                            const devVsShop =
                              shopTrialValue != null
                                ? actualValue - shopTrialValue
                                : 0;
                            let devVsShopScaled = 0;
                            if (shopTrialValue != null) {
                              devVsShopScaled =
                                p.isPercent && isoAvg !== 0
                                  ? (devVsShop / isoAvg) * 100
                                  : devVsShop;
                            }

                            return {
                              name: `Cyl ${cylNo}`,
                              actual: actualValue,
                              deviation: Number(deviationValue.toFixed(2)),
                              devVsShop: Number(devVsShopScaled.toFixed(2)),
                              // Range bar data: [Start value, End value]
                              shopRange:
                                shopTrialValue != null
                                  ? [
                                      shopTrialOffsetScaled,
                                      Number(deviationValue.toFixed(2)),
                                    ]
                                  : null,
                              fill: p.noAmber
                                ? getBarColorNoAmber(deviationValue)
                                : getBarColorPercent(deviationValue),
                            };
                          });

                          const allDeviations = chartData.map(
                            (d) => d.deviation,
                          );

                          if (
                            shopTrialOffsetScaled != null &&
                            showShopTrialMap[p.key]
                          ) {
                            allDeviations.push(shopTrialOffsetScaled);
                          }

                          const maxAbs = Math.max(
                            ...allDeviations.map(Math.abs),
                            6,
                          );
                          const axisPad = Math.max(maxAbs * 1.3, 7);
                          const yMin = -axisPad;
                          const yMax = axisPad;

                          const chartHeightPx = 200;
                          const yRange = yMax - yMin;
                          const pxPerUnit = chartHeightPx / yRange;
                          const avgShopGapPx =
                            shopTrialOffsetScaled != null &&
                            showShopTrialMap[p.key]
                              ? Math.abs(shopTrialOffsetScaled) * pxPerUnit
                              : 999;
                          const avgShopTooClose = avgShopGapPx < 14;
                          const shopAboveAvg =
                            shopTrialOffsetScaled != null &&
                            shopTrialOffsetScaled > 0;
                          const avgLabelDy = avgShopTooClose
                            ? shopAboveAvg
                              ? 10
                              : -10
                            : 0;
                          const shopLabelDy = avgShopTooClose
                            ? shopAboveAvg
                              ? -10
                              : 10
                            : 0;

                          const tickUnit = p.isPercent ? "%" : "";

                          const legendZones = p.noAmber
                            ? [
                                {
                                  color: "#16a34a",
                                  label: `≤3 ${p.unit} Normal`,
                                },
                                {
                                  color: "#dc2626",
                                  label: `>3 ${p.unit} Critical`,
                                },
                              ]
                            : [
                                { color: "#16a34a", label: "≤3% Normal" },
                                { color: "#ca8a04", label: "3–5% Warning" },
                                { color: "#dc2626", label: ">5% Critical" },
                              ];

                          return (
                            <div
                              key={p.key}
                              style={{
                                backgroundColor: "white",
                                padding: "10px 14px",
                                borderRadius: "12px",
                                border: "1px solid #f1f5f9",
                                position: "relative",
                              }}
                            >
                              <div
                                style={{
                                  display: "flex",
                                  justifyContent: "space-between",
                                  marginBottom: "6px",
                                  alignItems: "flex-start",
                                }}
                              >
                                <span
                                  style={{
                                    fontSize: "0.75rem",
                                    fontWeight: "800",
                                    color: "#64748b",
                                    textTransform: "uppercase",
                                  }}
                                >
                                  {p.label} Deviation{" "}
                                  {p.isPercent ? "(%)" : `(${p.unit})`}
                                </span>
                                <div
                                  style={{
                                    textAlign: "right",
                                    display: "flex",
                                    flexDirection: "column",
                                    alignItems: "flex-end",
                                    gap: "4px",
                                  }}
                                >
                                  <div
                                    style={{
                                      fontSize: "0.7rem",
                                      color: "#94a3b8",
                                      fontWeight: "700",
                                    }}
                                  >
                                    Avg: {isoAvg.toFixed(1)} {p.unit}
                                  </div>
                                  {shopTrialValue != null && (
                                    <div
                                      style={{
                                        display: "flex",
                                        alignItems: "center",
                                        gap: "5px",
                                      }}
                                    >
                                      <span
                                        onClick={(e) => {
                                          e.stopPropagation();
                                          setShowShopTrialMap((prev) => ({
                                            ...prev,
                                            [p.key]: !prev[p.key],
                                          }));
                                        }}
                                        style={{
                                          width: "12px",
                                          height: "12px",
                                          borderRadius: "3px",
                                          backgroundColor: showShopTrialMap[
                                            p.key
                                          ]
                                            ? "#ca8a04"
                                            : "transparent",
                                          border: `1.5px solid ${showShopTrialMap[p.key] ? "#ca8a04" : "#cbd5e1"}`,
                                          display: "inline-block",
                                          cursor: "pointer",
                                          transition: "all 0.2s ease",
                                          flexShrink: 0,
                                        }}
                                      />
                                      <div
                                        style={{
                                          fontSize: "0.7rem",
                                          color: "#ca8a04",
                                          fontWeight: "700",
                                        }}
                                      >
                                        Shop Trial: {shopTrialValue.toFixed(1)}{" "}
                                        {p.unit}
                                      </div>
                                    </div>
                                  )}
                                </div>
                              </div>

                              <div
                                style={{
                                  display: "flex",
                                  gap: "10px",
                                  marginBottom: "4px",
                                  alignItems: "center",
                                  flexWrap: "wrap",
                                }}
                              >
                                {legendZones.map((z) => (
                                  <span
                                    key={z.label}
                                    style={{
                                      fontSize: "0.6rem",
                                      color: z.color,
                                      fontWeight: "700",
                                      display: "flex",
                                      alignItems: "center",
                                      gap: "3px",
                                    }}
                                  >
                                    <span
                                      style={{
                                        width: 7,
                                        height: 7,
                                        borderRadius: "50%",
                                        backgroundColor: z.color,
                                        display: "inline-block",
                                        flexShrink: 0,
                                      }}
                                    />
                                    {z.label}
                                  </span>
                                ))}
                                {shopTrialValue != null &&
                                  showShopTrialMap[p.key] && (
                                    <span
                                      style={{
                                        fontSize: "0.6rem",
                                        color: "#ca8a04",
                                        fontWeight: "700",
                                        display: "flex",
                                        alignItems: "center",
                                        gap: "3px",
                                      }}
                                    >
                                      <span
                                        style={{
                                          width: 8,
                                          height: 8,
                                          borderRadius: "2px",
                                          backgroundColor: "#ca8a04",
                                          opacity: 0.6,
                                          display: "inline-block",
                                          flexShrink: 0,
                                        }}
                                      />
                                      Vs Shop Trial
                                    </span>
                                  )}
                              </div>

                              <div style={{ width: "100%", height: "180px" }}>
                                <ResponsiveContainer width="100%" height="100%">
                                  <BarChart
                                    data={chartData}
                                    margin={{
                                      top: 10,
                                      right: 110,
                                      left: -15,
                                      bottom: 5,
                                    }}
                                    barGap={2}
                                  >
                                    {p.noAmber ? (
                                      <>
                                        <ReferenceArea
                                          y1={0}
                                          y2={3}
                                          fill="#dcfce7"
                                          fillOpacity={0.4}
                                          ifOverflow="visible"
                                        />
                                        <ReferenceArea
                                          y1={-3}
                                          y2={0}
                                          fill="#dcfce7"
                                          fillOpacity={0.4}
                                          ifOverflow="visible"
                                        />
                                        <ReferenceArea
                                          y1={3}
                                          y2={yMax}
                                          fill="#fee2e2"
                                          fillOpacity={0.4}
                                          ifOverflow="visible"
                                        />
                                        <ReferenceArea
                                          y1={yMin}
                                          y2={-3}
                                          fill="#fee2e2"
                                          fillOpacity={0.4}
                                          ifOverflow="visible"
                                        />
                                      </>
                                    ) : (
                                      <>
                                        <ReferenceArea
                                          y1={0}
                                          y2={3}
                                          fill="#dcfce7"
                                          fillOpacity={0.4}
                                          ifOverflow="visible"
                                        />
                                        <ReferenceArea
                                          y1={-3}
                                          y2={0}
                                          fill="#dcfce7"
                                          fillOpacity={0.4}
                                          ifOverflow="visible"
                                        />
                                        <ReferenceArea
                                          y1={3}
                                          y2={5}
                                          fill="#fef9c3"
                                          fillOpacity={0.5}
                                          ifOverflow="visible"
                                        />
                                        <ReferenceArea
                                          y1={-5}
                                          y2={-3}
                                          fill="#fef9c3"
                                          fillOpacity={0.5}
                                          ifOverflow="visible"
                                        />
                                        <ReferenceArea
                                          y1={5}
                                          y2={yMax}
                                          fill="#fee2e2"
                                          fillOpacity={0.4}
                                          ifOverflow="visible"
                                        />
                                        <ReferenceArea
                                          y1={yMin}
                                          y2={-5}
                                          fill="#fee2e2"
                                          fillOpacity={0.4}
                                          ifOverflow="visible"
                                        />
                                      </>
                                    )}

                                    <CartesianGrid
                                      strokeDasharray="3 3"
                                      vertical={false}
                                      stroke="#f1f5f9"
                                    />
                                    <XAxis
                                      dataKey="name"
                                      fontSize={10}
                                      tickLine={false}
                                      axisLine={false}
                                    />
                                    <YAxis
                                      fontSize={10}
                                      tickLine={false}
                                      axisLine={false}
                                      domain={[yMin, yMax]}
                                      ticks={[0]}
                                      tickFormatter={() => `0${tickUnit}`}
                                    />

                                    <Tooltip
                                      cursor={{ fill: "#f8fafc" }}
                                      content={({ active, payload }) => {
                                        if (
                                          active &&
                                          payload &&
                                          payload.length
                                        ) {
                                          const d = payload[0].payload;
                                          const abs = Math.abs(d.deviation);
                                          let zone;
                                          if (p.noAmber) {
                                            zone =
                                              abs <= 3
                                                ? {
                                                    label: "Normal",
                                                    color: "#16a34a",
                                                  }
                                                : {
                                                    label: "Critical",
                                                    color: "#dc2626",
                                                  };
                                          } else {
                                            zone =
                                              abs <= 3
                                                ? {
                                                    label: "Normal",
                                                    color: "#16a34a",
                                                  }
                                                : abs <= 5
                                                  ? {
                                                      label: "Warning",
                                                      color: "#ca8a04",
                                                    }
                                                  : {
                                                      label: "Critical",
                                                      color: "#dc2626",
                                                    };
                                          }
                                          return (
                                            <div
                                              style={{
                                                backgroundColor: "white",
                                                padding: "8px",
                                                border: "1px solid #e2e8f0",
                                                borderRadius: "6px",
                                                boxShadow:
                                                  "0 4px 6px -1px rgba(0,0,0,0.1)",
                                              }}
                                            >
                                              <p
                                                style={{
                                                  margin: 0,
                                                  fontWeight: "bold",
                                                  fontSize: "0.75rem",
                                                }}
                                              >
                                                {d.name}
                                              </p>
                                              <p
                                                style={{
                                                  margin: 0,
                                                  fontSize: "0.7rem",
                                                  color: "#64748b",
                                                }}
                                              >
                                                Actual: {d.actual} {p.unit}
                                              </p>
                                              <p
                                                style={{
                                                  margin: 0,
                                                  fontSize: "0.7rem",
                                                  color: zone.color,
                                                  fontWeight: "bold",
                                                }}
                                              >
                                                Vs Base:{" "}
                                                {d.deviation > 0 ? "+" : ""}
                                                {d.deviation}
                                                {p.isPercent
                                                  ? "%"
                                                  : ` ${p.unit}`}
                                              </p>
                                              {shopTrialValue != null && (
                                                <p
                                                  style={{
                                                    margin: 0,
                                                    fontSize: "0.7rem",
                                                    color: "#ca8a04",
                                                    fontWeight: "bold",
                                                  }}
                                                >
                                                  Vs Shop:{" "}
                                                  {d.devVsShop > 0 ? "+" : ""}
                                                  {d.devVsShop}
                                                  {p.isPercent
                                                    ? "%"
                                                    : ` ${p.unit}`}
                                                </p>
                                              )}
                                              <p
                                                style={{
                                                  margin: 0,
                                                  fontSize: "0.7rem",
                                                  color: zone.color,
                                                  fontWeight: "700",
                                                }}
                                              >
                                                Status: {zone.label}
                                              </p>
                                            </div>
                                          );
                                        }
                                        return null;
                                      }}
                                    />

                                    {p.noAmber ? (
                                      <>
                                        <ReferenceLine
                                          y={3}
                                          stroke="#dc2626"
                                          strokeWidth={1}
                                          strokeOpacity={0.45}
                                          strokeDasharray="4 3"
                                        />
                                        <ReferenceLine
                                          y={-3}
                                          stroke="#dc2626"
                                          strokeWidth={1}
                                          strokeOpacity={0.45}
                                          strokeDasharray="4 3"
                                        />
                                      </>
                                    ) : (
                                      <>
                                        <ReferenceLine
                                          y={3}
                                          stroke="#ca8a04"
                                          strokeWidth={1}
                                          strokeOpacity={0.45}
                                          strokeDasharray="4 3"
                                        />
                                        <ReferenceLine
                                          y={-3}
                                          stroke="#ca8a04"
                                          strokeWidth={1}
                                          strokeOpacity={0.45}
                                          strokeDasharray="4 3"
                                        />
                                        <ReferenceLine
                                          y={5}
                                          stroke="#dc2626"
                                          strokeWidth={1}
                                          strokeOpacity={0.45}
                                          strokeDasharray="4 3"
                                        />
                                        <ReferenceLine
                                          y={-5}
                                          stroke="#dc2626"
                                          strokeWidth={1}
                                          strokeOpacity={0.45}
                                          strokeDasharray="4 3"
                                        />
                                      </>
                                    )}

                                    <ReferenceLine
                                      y={0}
                                      stroke="#94a3b8"
                                      strokeWidth={2}
                                      label={{
                                        position: "right",
                                        value: `Base ${isoAvg.toFixed(1)}${p.isPercent ? "" : " " + p.unit}`,
                                        fill: "#94a3b8",
                                        fontSize: 10,
                                        fontWeight: "900",
                                        dx: 5,
                                        dy: avgLabelDy,
                                      }}
                                    />

                                    {shopTrialOffsetScaled != null &&
                                      showShopTrialMap[p.key] && (
                                        <ReferenceLine
                                          y={shopTrialOffsetScaled}
                                          stroke="#ca8a04"
                                          strokeWidth={1.5}
                                          strokeDasharray="5 4"
                                          label={{
                                            position: "right",
                                            value: `Shop ${shopTrialValue.toFixed(1)}${p.isPercent ? "" : " " + p.unit}`,
                                            fill: "#ca8a04",
                                            fontSize: 10,
                                            fontWeight: "900",
                                            dx: 5,
                                            dy: shopLabelDy,
                                          }}
                                        />
                                      )}

                                    <Bar
                                      dataKey="deviation"
                                      radius={[4, 4, 0, 0]}
                                      barSize={16}
                                    >
                                      {chartData.map((entry, index) => (
                                        <Cell
                                          key={`cell-${index}`}
                                          fill={entry.fill}
                                        />
                                      ))}
                                    </Bar>

                                    {shopTrialValue != null &&
                                      showShopTrialMap[p.key] && (
                                        <Bar
                                          dataKey="shopRange"
                                          radius={[4, 4, 0, 0]}
                                          barSize={16}
                                        >
                                          {chartData.map((entry, index) => (
                                            <Cell
                                              key={`cell-shop-${index}`}
                                              fill="#ca8a04"
                                              fillOpacity={0.7}
                                            />
                                          ))}
                                        </Bar>
                                      )}
                                  </BarChart>
                                </ResponsiveContainer>
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    )}
                  </div>
                );
              })()}
            {/* ===== CARD 1: TIME-BASED DEVIATION TREND ===== */}
            {availableReports.length > 0 &&
              Object.keys(baseline).length > 0 &&
              (() => {
                const isAuxMode = analysisMode === "auxiliaryEngine";
                const MAIN_PARAMS = [
                  { key: "EngSpeed", label: "Eng Speed" },
                  { key: "Turbospeed", label: "Turbo Speed" },
                  { key: "FIPI", label: "Fuel Index" },
                  { key: "Pmax", label: "Pmax" },
                  { key: "Pcomp", label: "Pcomp" },
                  { key: "ScavAir", label: "Scav Air" },
                  { key: "Exh_T/C_inlet", label: "TC Inlet" },
                  { key: "Exh_T/C_outlet", label: "TC Outlet" },
                  { key: "Exh_Cylinder_outlet", label: "Exh Cyl" },
                  { key: "SFOC", label: "SFOC" },
                ];
                const AUX_PARAMS = [
                  { key: "Pmax", label: "Pmax" },
                  { key: "FIPI", label: "Fuel Index" },
                  { key: "ScavAir", label: "Scav Air" },
                  { key: "Exh_T/C_inlet", label: "TC Inlet" },
                  { key: "Exh_T/C_outlet", label: "TC Outlet" },
                  { key: "Exh_Cylinder_outlet", label: "Exh Cyl" },
                ];
                const PARAM_LIST = isAuxMode ? AUX_PARAMS : MAIN_PARAMS;
                const COLORS = [
                  "#2563eb",
                  "#dc2626",
                  "#9333ea",
                  "#059669",
                  "#f97316",
                  "#0891b2",
                  "#ca8a04",
                  "#db2777",
                  "#16a34a",
                  "#7c3aed",
                ];

                // ── GROUP DEFINITIONS ──
                // Percentage groups (unchanged behaviour)
                const GROUP_A = ["EngSpeed", "Pmax", "Pcomp"];
                const GROUP_B = ["FIPI", "ScavAir", "ScavAirPressure", "SFOC"];
                // Absolute delta groups (NEW)
                const GROUP_ABS_TURBO = ["Turbospeed"];
                const GROUP_ABS_EXHAUST = [
                  "Exh_T/C_inlet",
                  "Exh_T/C_outlet",
                  "Exh_Cylinder_outlet",
                ];

                const getParamGroup = (key) => {
                  if (isAuxMode) {
                    // Aux: treat Pmax as GROUP_A, FIPI+ScavAir as GROUP_B together
                    if (["Pmax"].includes(key)) return "A";
                    if (["FIPI", "ScavAir"].includes(key)) return "B";
                    if (
                      [
                        "Exh_T/C_inlet",
                        "Exh_T/C_outlet",
                        "Exh_Cylinder_outlet",
                      ].includes(key)
                    )
                      return "ABS_EXHAUST";
                    return null;
                  }
                  // Main engine — original logic
                  if (GROUP_A.includes(key)) return "A";
                  if (GROUP_B.includes(key)) return "B";
                  if (GROUP_ABS_TURBO.includes(key)) return "ABS_TURBO";
                  if (GROUP_ABS_EXHAUST.includes(key)) return "ABS_EXHAUST";
                  return null;
                };

                // Show bands only when ALL selected params share the same group
                const selectedGroups = [
                  ...new Set(
                    selectedTrendParams.map(getParamGroup).filter(Boolean),
                  ),
                ];
                const activeTrendGroup =
                  selectedGroups.length === 1 ? selectedGroups[0] : null;

                // isAbsoluteMode: true only when ALL selected params are from same abs group
                const isAbsoluteMode =
                  activeTrendGroup === "ABS_TURBO" ||
                  activeTrendGroup === "ABS_EXHAUST";

                // ── BUILD activeTrendData ──
                // Absolute mode: recompute rows as absolute delta (actual − baseline).
                // % mode:        use existing trendData memo unchanged.
                const xAxis = isAuxMode ? "load_percentage" : "load";
                const oneYearAgo = new Date();
                oneYearAgo.setFullYear(oneYearAgo.getFullYear() - 1);

                const sourceReports = (
                  availableReports.length > 0 ? availableReports : allMonthlyReports
                ).filter(r => !r.report_date || new Date(r.report_date) >= oneYearAgo);

                const activeTrendData = (() => {
                  if (!isAbsoluteMode) return trendData;
                  const sorted = [...sourceReports].sort(
                    (a, b) => new Date(a.report_date) - new Date(b.report_date),
                  );
                  return sorted.map((report) => {
                    const targetLoad = isAuxMode
                      ? report.load_percentage
                      : report.load;
                    const row = { date: report.displayName };
                    selectedTrendParams.forEach((key) => {
                      const base = interpolateBaseline(
                        baseline,
                        targetLoad,
                        key,
                        xAxis,
                      );
                      const actual = report[key];
                      if (base == null || actual == null) {
                        row[key] = null;
                        return;
                      }
                      row[key] = actual - base;
                    });
                    return row;
                  });
                })();

                // ── POLYNOMIAL REGRESSION — merged into same dataset ──
                const mergedTrendData = (() => {
                  if (activeTrendData.length < 2) return activeTrendData;

                  const coeffs = {};
                  selectedTrendParams.forEach((key) => {
                    const valid = activeTrendData
                      .map((d, i) => ({ i, v: d[key] }))
                      .filter((p) => p.v != null);
                    if (valid.length < 2) return;

                    const n = valid.length;
                    const x = valid.map((p) => p.i);
                    const y = valid.map((p) => p.v);

                    let sumX = 0,
                      sumX2 = 0,
                      sumX3 = 0,
                      sumX4 = 0,
                      sumX5 = 0,
                      sumX6 = 0;
                    let sumY = 0,
                      sumXY = 0,
                      sumX2Y = 0,
                      sumX3Y = 0;
                    for (let i = 0; i < n; i++) {
                      sumX += x[i];
                      sumX2 += x[i] ** 2;
                      sumX3 += x[i] ** 3;
                      sumX4 += x[i] ** 4;
                      sumX5 += x[i] ** 5;
                      sumX6 += x[i] ** 6;
                      sumY += y[i];
                      sumXY += x[i] * y[i];
                      sumX2Y += x[i] ** 2 * y[i];
                      sumX3Y += x[i] ** 3 * y[i];
                    }
                    const A = [
                      [n, sumX, sumX2, sumX3],
                      [sumX, sumX2, sumX3, sumX4],
                      [sumX2, sumX3, sumX4, sumX5],
                      [sumX3, sumX4, sumX5, sumX6],
                    ];
                    const B = [sumY, sumXY, sumX2Y, sumX3Y];
                    for (let i = 0; i < 4; i++) {
                      for (let j = i + 1; j < 4; j++) {
                        const r = A[j][i] / A[i][i];
                        for (let k = i; k < 4; k++) A[j][k] -= r * A[i][k];
                        B[j] -= r * B[i];
                      }
                    }
                    const c = [0, 0, 0, 0];
                    for (let i = 3; i >= 0; i--) {
                      c[i] = B[i];
                      for (let j = i + 1; j < 4; j++) c[i] -= A[i][j] * c[j];
                      c[i] /= A[i][i];
                    }
                    coeffs[key] = c;
                  });

                  return activeTrendData.map((row, idx) => {
                    const newRow = { ...row };
                    selectedTrendParams.forEach((key) => {
                      const c = coeffs[key];
                      if (!c) return;
                      newRow[`${key}__curve`] =
                        c[0] + c[1] * idx + c[2] * idx ** 2 + c[3] * idx ** 3;
                    });
                    return newRow;
                  });
                })();

                // ── SYMMETRIC Y-DOMAIN ──
                const yDomain = (() => {
                  if (!activeTrendData || activeTrendData.length === 0) {
                    if (activeTrendGroup === "ABS_TURBO") return [-1200, 1200];
                    if (activeTrendGroup === "ABS_EXHAUST") return [-70, 70];
                    return [-15, 15];
                  }
                  let maxAbs = 0;
                  activeTrendData.forEach((row) => {
                    selectedTrendParams.forEach((key) => {
                      const v = row[key];
                      if (v != null && Math.abs(v) > maxAbs)
                        maxAbs = Math.abs(v);
                    });
                  });
                  let minExtent;
                  if (activeTrendGroup === "ABS_TURBO") minExtent = 1200;
                  else if (activeTrendGroup === "ABS_EXHAUST") minExtent = 70;
                  else minExtent = 15;
                  const extent = Math.max(maxAbs * 1.2, minExtent);
                  return [-extent, extent];
                })();

                const [yMin, yMax] = yDomain;

                // ── THRESHOLD VALUES ──
                // % groups (unchanged)
                const tAmber =
                  activeTrendGroup === "A"
                    ? 3
                    : activeTrendGroup === "B"
                      ? 5
                      : null;
                const tRed =
                  activeTrendGroup === "A"
                    ? 5
                    : activeTrendGroup === "B"
                      ? 10
                      : null;
                // Absolute thresholds (NEW)
                const tAbsAmber =
                  activeTrendGroup === "ABS_TURBO"
                    ? 500
                    : activeTrendGroup === "ABS_EXHAUST"
                      ? 40
                      : null;
                const tAbsRed =
                  activeTrendGroup === "ABS_TURBO"
                    ? 1000
                    : activeTrendGroup === "ABS_EXHAUST"
                      ? 60
                      : null;

                // ── Y-AXIS UNIT ──
                const yUnit =
                  activeTrendGroup === "ABS_TURBO"
                    ? " RPM"
                    : activeTrendGroup === "ABS_EXHAUST"
                      ? " °C"
                      : "%";

                // ── Y-AXIS TICKS ──
                const yTicks = (() => {
                  if (activeTrendGroup === "ABS_TURBO") {
                    const step = yMax <= 1500 ? 500 : 1000;
                    const raw = [];
                    for (
                      let t = Math.ceil(yMin / step) * step;
                      t <= yMax;
                      t += step
                    )
                      raw.push(t);
                    return [
                      ...new Set([...raw, -1000, -500, 0, 500, 1000]),
                    ].sort((a, b) => a - b);
                  }
                  if (activeTrendGroup === "ABS_EXHAUST") {
                    const step = yMax <= 80 ? 20 : 30;
                    const raw = [];
                    for (
                      let t = Math.ceil(yMin / step) * step;
                      t <= yMax;
                      t += step
                    )
                      raw.push(t);
                    return [...new Set([...raw, -60, -40, 0, 40, 60])].sort(
                      (a, b) => a - b,
                    );
                  }
                  // % ticks — original logic preserved exactly
                  const extent = yMax;
                  const coreTicks = [-10, -5, -3, 0, 3, 5, 10];
                  const outerStep = extent <= 30 ? 10 : extent <= 60 ? 20 : 30;
                  const extraTicks = [];
                  for (
                    let t = outerStep;
                    t <= Math.floor(yMax);
                    t += outerStep
                  ) {
                    if (t > 10) extraTicks.push(t);
                  }
                  for (
                    let t = -outerStep;
                    t >= Math.ceil(yMin);
                    t -= outerStep
                  ) {
                    if (t < -10) extraTicks.push(t);
                  }
                  return [...new Set([...coreTicks, ...extraTicks])].sort(
                    (a, b) => a - b,
                  );
                })();

                return (
                  <div
                    className="enhanced-card"
                    style={{
                      marginBottom: "24px",
                      border: "1px solid #e2e8f0",
                      overflow: "hidden",
                    }}
                  >
                    {/* COLLAPSIBLE HEADER — unchanged */}
                    <div
                      onClick={() => setIsTrendCardExpanded((p) => !p)}
                      style={{
                        padding: "14px 24px",
                        display: "flex",
                        justifyContent: "space-between",
                        alignItems: "center",
                        cursor: "pointer",
                        backgroundColor: "#f8fafc",
                        borderBottom: isTrendCardExpanded
                          ? "1px solid #e2e8f0"
                          : "none",
                        userSelect: "none",
                      }}
                    >
                      <div
                        style={{
                          display: "flex",
                          alignItems: "center",
                          gap: "10px",
                        }}
                      >
                        <span style={{ fontSize: "1.2rem" }}>📈</span>
                        <div>
                          <h3
                            style={{
                              margin: 0,
                              fontSize: "1rem",
                              fontWeight: "700",
                              color: "#1e293b",
                            }}
                          >
                            Deviation Trend Over Time Based
                          </h3>
                        </div>
                      </div>
                      <span
                        style={{
                          fontSize: "0.9rem",
                          color: "#94a3b8",
                          transition: "transform 0.3s",
                          transform: isTrendCardExpanded
                            ? "rotate(180deg)"
                            : "rotate(0deg)",
                          display: "inline-block",
                        }}
                      >
                        ▼
                      </span>
                    </div>

                    {isTrendCardExpanded && (
                      <div
                        style={{
                          padding: "20px 24px",
                          display: "flex",
                          flexDirection: "column",
                          gap: "16px",
                        }}
                      >
                        {/* PARAMETER PILLS — unchanged */}
                        <div
                          style={{
                            display: "flex",
                            alignItems: "center",
                            gap: "8px",
                            flexWrap: "wrap",
                          }}
                        >
                          <span
                            style={{
                              fontSize: "0.65rem",
                              fontWeight: "800",
                              color: "#64748b",
                              textTransform: "uppercase",
                              letterSpacing: "0.05em",
                              whiteSpace: "nowrap",
                            }}
                          >
                            PARAMETER:
                          </span>
                          {PARAM_LIST.map((param, i) => {
                            const isActive = selectedTrendParams.includes(
                              param.key,
                            );
                            return (
                              <button
                                key={param.key}
                                onClick={() =>
                                  setSelectedTrendParams((prev) =>
                                    isActive
                                      ? prev.filter((k) => k !== param.key)
                                      : [...prev, param.key],
                                  )
                                }
                                style={{
                                  padding: "4px 11px",
                                  borderRadius: "20px",
                                  border: `2px solid ${isActive ? COLORS[i % COLORS.length] : "#e2e8f0"}`,
                                  backgroundColor: isActive
                                    ? COLORS[i % COLORS.length]
                                    : "white",
                                  color: isActive ? "white" : "#64748b",
                                  fontSize: "0.72rem",
                                  fontWeight: "700",
                                  cursor: "pointer",
                                  transition: "all 0.18s",
                                }}
                              >
                                {param.label}
                              </button>
                            );
                          })}
                          {selectedTrendParams.length > 0 && (
                            <button
                              onClick={() => setSelectedTrendParams([])}
                              style={{
                                padding: "4px 10px",
                                borderRadius: "20px",
                                border: "1.5px dashed #cbd5e1",
                                backgroundColor: "transparent",
                                color: "#94a3b8",
                                fontSize: "0.68rem",
                                fontWeight: "700",
                                cursor: "pointer",
                              }}
                            >
                              Clear
                            </button>
                          )}
                        </div>

                        {/* CHART */}
                        {activeTrendData.length < 2 ? (
                          <div
                            style={{
                              height: 380,
                              display: "flex",
                              flexDirection: "column",
                              alignItems: "center",
                              justifyContent: "center",
                              color: "#94a3b8",
                              gap: "8px",
                              backgroundColor: "#fafafa",
                              borderRadius: "10px",
                              border: "1px dashed #e2e8f0",
                            }}
                          >
                            <span style={{ fontSize: "2rem" }}>📊</span>
                            <span
                              style={{ fontSize: "0.88rem", fontWeight: "600" }}
                            >
                              Need 2 or more reports to show trend
                            </span>
                            <span style={{ fontSize: "0.75rem" }}>
                              {availableReports.length} report(s) available for
                              this vessel
                            </span>
                          </div>
                        ) : (
                          <>
                            <ResponsiveContainer width="100%" height={400}>
                              <LineChart
                                data={mergedTrendData}
                                margin={{
                                  left: 16,
                                  right: 24,
                                  top: 10,
                                  bottom: 10,
                                }}
                              >
                                <CartesianGrid
                                  strokeDasharray="3 3"
                                  vertical={true}
                                  stroke="#e2e8f0"
                                  strokeOpacity={0.8}
                                />
                                <XAxis
                                  dataKey="date"
                                  fontSize={10}
                                  stroke="#e2e8f0"
                                  tick={{ fill: "#64748b", fontWeight: 500 }}
                                  tickLine={false}
                                />

                                {/* Y-AXIS: unit / ticks / domain switch on mode */}
                                <YAxis
                                  unit={yUnit}
                                  fontSize={10}
                                  stroke="#e2e8f0"
                                  tick={{ fill: "#64748b" }}
                                  tickLine={false}
                                  axisLine={false}
                                  domain={[yMin, yMax]}
                                  ticks={yTicks}
                                  tickFormatter={(val) =>
                                    `${val > 0 ? "+" : ""}${val}`
                                  }
                                  width={isAbsoluteMode ? 65 : 50}
                                />

                                {/* TOOLTIP: correct unit per mode */}
                                <Tooltip
                                  formatter={(val, name) => {
                                    if (val == null) return ["N/A", name];
                                    const sign = val > 0 ? "+" : "";
                                    if (activeTrendGroup === "ABS_TURBO")
                                      return [
                                        `${sign}${val.toFixed(0)} RPM`,
                                        name,
                                      ];
                                    if (activeTrendGroup === "ABS_EXHAUST")
                                      return [
                                        `${sign}${val.toFixed(1)} °C`,
                                        name,
                                      ];
                                    return [`${sign}${val.toFixed(2)}%`, name];
                                  }}
                                  contentStyle={{
                                    fontSize: "0.8rem",
                                    borderRadius: "10px",
                                    border: "1px solid #e2e8f0",
                                    boxShadow: "0 8px 24px rgba(0,0,0,0.08)",
                                  }}
                                />

                                <Legend
                                  verticalAlign="bottom"
                                  height={32}
                                  iconType="circle"
                                  iconSize={8}
                                  wrapperStyle={{
                                    fontSize: "10px",
                                    paddingTop: "6px",
                                  }}
                                />

                                {/* Baseline — always shown */}
                                <ReferenceLine
                                  y={0}
                                  stroke="#16a34a"
                                  strokeWidth={2}
                                  strokeDasharray="5 4"
                                  label={{
                                    value: "Baseline",
                                    position: "right",
                                    fill: "#16a34a",
                                    fontSize: 9,
                                    fontWeight: 700,
                                  }}
                                />

                                {/* ── % THRESHOLD BANDS (Group A / B) — original logic unchanged ──
                          Group A → amber ±3%,  red ±5%
                          Group B → amber ±5%,  red ±10%
                          Mixed   → no bands                                              */}
                                {!isAbsoluteMode &&
                                  tAmber !== null &&
                                  tRed !== null && (
                                    <>
                                      <ReferenceArea
                                        y1={-tAmber}
                                        y2={tAmber}
                                        fill="#dcfce7"
                                        fillOpacity={0.55}
                                        ifOverflow="visible"
                                      />
                                      <ReferenceArea
                                        y1={tAmber}
                                        y2={tRed}
                                        fill="#fef3c7"
                                        fillOpacity={0.55}
                                        ifOverflow="visible"
                                      />
                                      <ReferenceArea
                                        y1={-tRed}
                                        y2={-tAmber}
                                        fill="#fef3c7"
                                        fillOpacity={0.55}
                                        ifOverflow="visible"
                                      />
                                      <ReferenceArea
                                        y1={tRed}
                                        y2={yMax}
                                        fill="#fee2e2"
                                        fillOpacity={0.55}
                                        ifOverflow="visible"
                                      />
                                      <ReferenceArea
                                        y1={yMin}
                                        y2={-tRed}
                                        fill="#fee2e2"
                                        fillOpacity={0.55}
                                        ifOverflow="visible"
                                      />
                                      <ReferenceLine
                                        y={tAmber}
                                        stroke="#f59e0b"
                                        strokeDasharray="3 3"
                                        strokeWidth={1}
                                      />
                                      <ReferenceLine
                                        y={-tAmber}
                                        stroke="#f59e0b"
                                        strokeDasharray="3 3"
                                        strokeWidth={1}
                                      />
                                      <ReferenceLine
                                        y={tRed}
                                        stroke="#ef4444"
                                        strokeDasharray="3 3"
                                        strokeWidth={1}
                                      />
                                      <ReferenceLine
                                        y={-tRed}
                                        stroke="#ef4444"
                                        strokeDasharray="3 3"
                                        strokeWidth={1}
                                      />
                                    </>
                                  )}

                                {/* ── ABSOLUTE THRESHOLD BANDS (Turbo / Exhaust) — NEW ──
                          Turbo:   amber ±500 RPM,  red ±1000 RPM
                          Exhaust: amber ±40 °C,    red ±60 °C
                          Shown only when ALL selected params are same abs group.  */}
                                {isAbsoluteMode &&
                                  tAbsAmber !== null &&
                                  tAbsRed !== null && (
                                    <>
                                      <ReferenceArea
                                        y1={-tAbsAmber}
                                        y2={tAbsAmber}
                                        fill="#dcfce7"
                                        fillOpacity={0.55}
                                        ifOverflow="visible"
                                      />
                                      <ReferenceArea
                                        y1={tAbsAmber}
                                        y2={tAbsRed}
                                        fill="#fef3c7"
                                        fillOpacity={0.55}
                                        ifOverflow="visible"
                                      />
                                      <ReferenceArea
                                        y1={-tAbsRed}
                                        y2={-tAbsAmber}
                                        fill="#fef3c7"
                                        fillOpacity={0.55}
                                        ifOverflow="visible"
                                      />
                                      <ReferenceArea
                                        y1={tAbsRed}
                                        y2={yMax}
                                        fill="#fee2e2"
                                        fillOpacity={0.55}
                                        ifOverflow="visible"
                                      />
                                      <ReferenceArea
                                        y1={yMin}
                                        y2={-tAbsRed}
                                        fill="#fee2e2"
                                        fillOpacity={0.55}
                                        ifOverflow="visible"
                                      />
                                      <ReferenceLine
                                        y={tAbsAmber}
                                        stroke="#f59e0b"
                                        strokeDasharray="3 3"
                                        strokeWidth={1}
                                      />
                                      <ReferenceLine
                                        y={-tAbsAmber}
                                        stroke="#f59e0b"
                                        strokeDasharray="3 3"
                                        strokeWidth={1}
                                      />
                                      <ReferenceLine
                                        y={tAbsRed}
                                        stroke="#ef4444"
                                        strokeDasharray="3 3"
                                        strokeWidth={1}
                                      />
                                      <ReferenceLine
                                        y={-tAbsRed}
                                        stroke="#ef4444"
                                        strokeDasharray="3 3"
                                        strokeWidth={1}
                                      />
                                    </>
                                  )}

                                {/* DATA LINES — unchanged */}
                                {selectedTrendParams.map((key, i) => {
                                  const color =
                                    COLORS[
                                      PARAM_LIST.findIndex(
                                        (p) => p.key === key,
                                      ) % COLORS.length
                                    ] || COLORS[i % COLORS.length];
                                  return (
                                    <React.Fragment key={key}>
                                      {/* Original deviation points — dots only, no connecting line */}
                                      <Line
                                        type="monotone"
                                        dataKey={key}
                                        stroke={color}
                                        strokeWidth={0}
                                        dot={{
                                          r: 4,
                                          fill: color,
                                          stroke: "white",
                                          strokeWidth: 1.5,
                                        }}
                                        activeDot={{ r: 6 }}
                                        legendType="none"
                                        connectNulls={false}
                                        isAnimationActive={false}
                                      />
                                      {/* Smooth polynomial curve — line only, no dots */}
                                      <Line
                                        type="monotone"
                                        dataKey={`${key}__curve`}
                                        stroke={color}
                                        strokeWidth={2.5}
                                        dot={false}
                                        activeDot={{ r: 5 }}
                                        legendType="none"
                                        connectNulls={false}
                                        isAnimationActive={false}
                                      />
                                    </React.Fragment>
                                  );
                                })}
                              </LineChart>
                            </ResponsiveContainer>

                            {/* DELTA INSIGHT BOX */}
                            {(() => {
                              const latest =
                                activeTrendData[activeTrendData.length - 1];
                              const previous =
                                activeTrendData[activeTrendData.length - 2];
                              const insights = selectedTrendParams
                                .map((key) => {
                                  const curr = latest[key];
                                  const prev = previous[key];
                                  if (curr == null || prev == null) return null;
                                  return { key, curr, change: curr - prev };
                                })
                                .filter(Boolean);
                              if (insights.length === 0) return null;
                              return (
                                <div
                                  style={{
                                    padding: "12px 16px",
                                    backgroundColor: "#f8fafc",
                                    borderRadius: "10px",
                                    border: "1px solid #e2e8f0",
                                  }}
                                >
                                  <div
                                    style={{
                                      fontSize: "0.62rem",
                                      fontWeight: "800",
                                      color: "#64748b",
                                      textTransform: "uppercase",
                                      letterSpacing: "0.05em",
                                      marginBottom: "8px",
                                    }}
                                  >
                                    Latest vs Previous · {previous.date} →{" "}
                                    {latest.date}
                                  </div>
                                  <div
                                    style={{
                                      display: "flex",
                                      flexWrap: "wrap",
                                      gap: "8px",
                                    }}
                                  >
                                    {insights.map(({ key, curr, change }) => {
                                      const found = PARAM_LIST.find(
                                        (p) => p.key === key,
                                      );
                                      const label = found ? found.label : key;

                                      // Badge color: correct threshold per group
                                      const paramGroup = getParamGroup(key);
                                      const absVal = Math.abs(curr);
                                      let color = "#16a34a";

                                      if (paramGroup === "ABS_TURBO") {
                                        if (absVal >= 1000) color = "#dc2626";
                                        else if (absVal >= 500)
                                          color = "#ca8a04";
                                      } else if (paramGroup === "ABS_EXHAUST") {
                                        if (absVal > 60) color = "#dc2626";
                                        else if (absVal >= 40)
                                          color = "#ca8a04";
                                      } else {
                                        // % groups — original logic preserved exactly
                                        const badgeAmber =
                                          paramGroup === "A" ? 3 : 5;
                                        const badgeRed =
                                          paramGroup === "A" ? 5 : 10;
                                        if (absVal > badgeRed)
                                          color = "#dc2626";
                                        else if (absVal > badgeAmber)
                                          color = "#ca8a04";
                                      }

                                      // Negligible threshold: per-group granularity
                                      const negligible =
                                        paramGroup === "ABS_TURBO"
                                          ? Math.abs(change) < 50
                                          : paramGroup === "ABS_EXHAUST"
                                            ? Math.abs(change) < 2
                                            : Math.abs(change) < 0.5;
                                      if (negligible) color = "#64748b";

                                      // Format value with correct unit
                                      const sign = change > 0 ? "+" : "";
                                      const formatted =
                                        paramGroup === "ABS_TURBO"
                                          ? `${sign}${change.toFixed(0)} RPM`
                                          : paramGroup === "ABS_EXHAUST"
                                            ? `${sign}${change.toFixed(1)} °C`
                                            : `${sign}${change.toFixed(2)}%`;

                                      return (
                                        <div
                                          key={key}
                                          style={{
                                            padding: "5px 11px",
                                            borderRadius: "8px",
                                            backgroundColor: "white",
                                            border: `1.5px solid ${color}35`,
                                            fontSize: "0.76rem",
                                            display: "flex",
                                            gap: "6px",
                                            alignItems: "center",
                                          }}
                                        >
                                          <span
                                            style={{
                                              fontWeight: "700",
                                              color: "#334155",
                                            }}
                                          >
                                            {label}:
                                          </span>
                                          <span
                                            style={{ fontWeight: "800", color }}
                                          >
                                            {formatted}
                                          </span>
                                        </div>
                                      );
                                    })}
                                  </div>
                                </div>
                              );
                            })()}
                          </>
                        )}
                      </div>
                    )}
                  </div>
                );
              })()}

            {/* ===== CARD 2: LOAD-BASED PERFORMANCE ENVELOPE ===== */}
            {availableReports.length > 0 &&
              Object.keys(baseline).length > 0 &&
              (() => {
                const isAuxMode = analysisMode === "auxiliaryEngine";
                const MAIN_PARAMS = [
                  { key: "EngSpeed", label: "Eng Speed" },
                  { key: "Turbospeed", label: "Turbo Speed" },
                  { key: "FIPI", label: "Fuel Index" },
                  { key: "Pmax", label: "Pmax" },
                  { key: "Pcomp", label: "Pcomp" },
                  { key: "ScavAir", label: "Scav Air" },
                  { key: "Exh_T/C_inlet", label: "TC Inlet" },
                  { key: "Exh_T/C_outlet", label: "TC Outlet" },
                  { key: "Exh_Cylinder_outlet", label: "Exh Cyl" },
                  { key: "SFOC", label: "SFOC" },
                ];
                const AUX_PARAMS = [
                  { key: "Pmax", label: "Pmax" },
                  { key: "FIPI", label: "Fuel Index" },
                  { key: "ScavAirPressure", label: "Scav Air" },
                  { key: "Exh_T/C_inlet", label: "TC Inlet" },
                  { key: "Exh_T/C_outlet", label: "TC Outlet" },
                  { key: "Exh_Cylinder_outlet", label: "Exh Cyl" },
                ];
                const PARAM_LIST = isAuxMode ? AUX_PARAMS : MAIN_PARAMS;
                const SCATTER_COLORS = [
                  "#dc2626",
                  "#2563eb",
                  "#9333ea",
                  "#059669",
                  "#f97316",
                  "#0891b2",
                  "#ca8a04",
                  "#db2777",
                  "#16a34a",
                  "#7c3aed",
                  "#be185d",
                  "#0369a1",
                ];

                const activeKey = envelopeParam || PARAM_LIST[0]?.key || "Pmax";
                const unit = getMetricUnit(activeKey, isAuxMode);

                // ── curveData: keep "load" key so Line draws correctly ──
                const curveData = (baseline[activeKey] || [])
                  .map((p) => ({
                    load: isAuxMode ? p.load_percentage : p.load,
                    baseline: p.value,
                  }))
                  .filter((p) => p.load != null && p.baseline != null)
                  .sort((a, b) => a.load - b.load);

                // Last 12 months only
                const oneYearAgo = new Date();
                oneYearAgo.setFullYear(oneYearAgo.getFullYear() - 1);

                const scatterPoints = availableReports
                  .filter((report) => {
                    if (!report.report_date) return true;
                    const reportDate = new Date(report.report_date);
                    return reportDate >= oneYearAgo;
                  })
                  .map((report) => ({
                    load: isAuxMode ? report.load_percentage : report.load,
                    actual: report[activeKey],
                    name: report.displayName,
                    date: report.report_date,
                    color: report.color,
                  }))
                  .filter(
                    (p) =>
                      p.actual != null &&
                      p.load != null &&
                      Number.isFinite(p.actual) &&
                      Number.isFinite(p.load),
                  );

                const deviations = scatterPoints
                  .map((pt) => {
                    const base = interpolateBaseline(
                      baseline,
                      pt.load,
                      activeKey,
                      isAuxMode ? "load_percentage" : "load",
                    );
                    if (!base || base === 0) return null;
                    return ((pt.actual - base) / base) * 100;
                  })
                  .filter((d) => d !== null);

                const avgDev = deviations.length
                  ? deviations.reduce((a, b) => a + b, 0) / deviations.length
                  : null;
                const absAvg = Math.abs(avgDev);
                const avgColor =
                  avgDev == null
                    ? "#64748b"
                    : absAvg <= 5
                      ? "#16a34a"
                      : absAvg <= 10
                        ? "#ca8a04"
                        : "#dc2626";

                return (
                  <div
                    className="enhanced-card"
                    style={{
                      marginBottom: "24px",
                      border: "1px solid #e2e8f0",
                      overflow: "hidden",
                    }}
                  >
                    {/* COLLAPSIBLE HEADER */}
                    <div
                      onClick={() => setIsEnvelopeCardExpanded((p) => !p)}
                      style={{
                        padding: "14px 24px",
                        display: "flex",
                        justifyContent: "space-between",
                        alignItems: "center",
                        cursor: "pointer",
                        backgroundColor: "#f8fafc",
                        borderBottom: isEnvelopeCardExpanded
                          ? "1px solid #e2e8f0"
                          : "none",
                        userSelect: "none",
                      }}
                    >
                      <div
                        style={{
                          display: "flex",
                          alignItems: "center",
                          gap: "10px",
                        }}
                      >
                        <span style={{ fontSize: "1.2rem" }}>🎯</span>
                        <div>
                          <h3
                            style={{
                              margin: 0,
                              fontSize: "1rem",
                              fontWeight: "700",
                              color: "#1e293b",
                            }}
                          >
                            Trend Over Load Based
                          </h3>
                        </div>
                      </div>
                      <span
                        style={{
                          fontSize: "0.9rem",
                          color: "#94a3b8",
                          transition: "transform 0.3s",
                          transform: isEnvelopeCardExpanded
                            ? "rotate(180deg)"
                            : "rotate(0deg)",
                          display: "inline-block",
                        }}
                      >
                        ▼
                      </span>
                    </div>

                    {isEnvelopeCardExpanded && (
                      <div
                        style={{
                          padding: "20px 24px",
                          display: "flex",
                          flexDirection: "column",
                          gap: "16px",
                        }}
                      >
                        {/* PARAMETER PILLS */}
                        <div
                          style={{
                            display: "flex",
                            alignItems: "center",
                            gap: "8px",
                            flexWrap: "wrap",
                          }}
                        >
                          <span
                            style={{
                              fontSize: "0.65rem",
                              fontWeight: "800",
                              color: "#64748b",
                              textTransform: "uppercase",
                              letterSpacing: "0.05em",
                              whiteSpace: "nowrap",
                            }}
                          >
                            Parameter:
                          </span>
                          {PARAM_LIST.map((param) => {
                            const isActive = envelopeParam === param.key;
                            return (
                              <button
                                key={param.key}
                                onClick={(e) => {
                                  e.stopPropagation();
                                  setEnvelopeParam(param.key);
                                }}
                                style={{
                                  padding: "4px 11px",
                                  borderRadius: "20px",
                                  border: `2px solid ${isActive ? "#7c3aed" : "#e2e8f0"}`,
                                  backgroundColor: isActive
                                    ? "#7c3aed"
                                    : "white",
                                  color: isActive ? "white" : "#64748b",
                                  fontSize: "0.72rem",
                                  fontWeight: "700",
                                  cursor: "pointer",
                                  transition: "all 0.18s",
                                }}
                              >
                                {param.label}
                              </button>
                            );
                          })}
                        </div>

                        {/* STATS ROW */}
                        {avgDev !== null && (
                          <div
                            style={{
                              display: "flex",
                              gap: "12px",
                              flexWrap: "wrap",
                            }}
                          >
                            {[
                              {
                                label: "Reports plotted",
                                value: `${scatterPoints.length}`,
                                color: "#334155",
                              },
                            ].map((stat) => (
                              <div
                                key={stat.label}
                                style={{
                                  padding: "8px 14px",
                                  backgroundColor: "#f8fafc",
                                  borderRadius: "8px",
                                  border: "1px solid #e2e8f0",
                                  minWidth: "90px",
                                }}
                              >
                                <div
                                  style={{
                                    fontSize: "0.62rem",
                                    color: "#94a3b8",
                                    fontWeight: "700",
                                    textTransform: "uppercase",
                                    letterSpacing: "0.04em",
                                  }}
                                >
                                  {stat.label}
                                </div>
                                <div
                                  style={{
                                    fontSize: "0.95rem",
                                    fontWeight: "800",
                                    color: stat.color,
                                    marginTop: "2px",
                                  }}
                                >
                                  {stat.value}
                                </div>
                              </div>
                            ))}
                          </div>
                        )}

                        {/* CHART */}
                        {!baseline[activeKey] ? (
                          <div
                            style={{
                              height: 420,
                              display: "flex",
                              flexDirection: "column",
                              alignItems: "center",
                              justifyContent: "center",
                              color: "#94a3b8",
                              gap: "8px",
                              backgroundColor: "#fafafa",
                              borderRadius: "10px",
                              border: "1px dashed #e2e8f0",
                            }}
                          >
                            <span style={{ fontSize: "2rem" }}>🔍</span>
                            <span
                              style={{ fontSize: "0.88rem", fontWeight: "600" }}
                            >
                              No baseline data for "{activeKey}"
                            </span>
                          </div>
                        ) : (
                          <>
                            <ResponsiveContainer width="100%" height={360}>
                              <ComposedChart
                                margin={{
                                  left: 16,
                                  right: 24,
                                  top: 10,
                                  bottom: 30,
                                }}
                              >
                                {/* ── visible grid H+V ── */}
                                <CartesianGrid
                                  strokeDasharray="4 4"
                                  vertical={true}
                                  horizontal={true}
                                  stroke="#cbd5e1"
                                  strokeOpacity={0.8}
                                />

                                <XAxis
                                  dataKey="load"
                                  type="number"
                                  domain={
                                    isAuxMode
                                      ? ["dataMin - 5", "dataMax + 5"]
                                      : [20, 115]
                                  }
                                  ticks={
                                    isAuxMode
                                      ? undefined
                                      : [25, 50, 75, 100, 110]
                                  }
                                  tickFormatter={(v) =>
                                    `${Number(v).toFixed(0)}%`
                                  }
                                  fontSize={10}
                                  stroke="#e2e8f0"
                                  tick={{ fill: "#64748b" }}
                                  tickLine={false}
                                  label={{
                                    value: "Load (%)",
                                    position: "insideBottom",
                                    offset: -16,
                                    style: {
                                      fontWeight: 600,
                                      fill: "#64748b",
                                      fontSize: 11,
                                    },
                                  }}
                                />

                                {/* ── CHANGE: domain auto to remove empty Y space ── */}
                                <YAxis
                                  fontSize={10}
                                  stroke="#e2e8f0"
                                  tick={{ fill: "#64748b" }}
                                  tickLine={false}
                                  axisLine={false}
                                  tickFormatter={(v) => v.toFixed(1)}
                                  width={50}
                                  domain={["auto", "auto"]}
                                  label={{
                                    value: unit,
                                    angle: -90,
                                    position: "insideLeft",
                                    offset: 12,
                                    style: {
                                      fontWeight: 600,
                                      fill: "#64748b",
                                      fontSize: 11,
                                    },
                                  }}
                                />

                                {/* ── CHANGE: clean tooltip, load key filtered, month shown ── */}
                                <Tooltip
                                  formatter={(val, name) => {
                                    // Filter out the internal "load" key from curveData
                                    if (name === "load") return null;
                                    return [`${val?.toFixed(2)} ${unit}`, name];
                                  }}
                                  contentStyle={{
                                    fontSize: "0.8rem",
                                    borderRadius: "10px",
                                    border: "1px solid #e2e8f0",
                                    boxShadow: "0 8px 24px rgba(0,0,0,0.08)",
                                    padding: "10px 14px",
                                  }}
                                  labelFormatter={(l) =>
                                    `📍 Load: ${Number(l).toFixed(1)}%`
                                  }
                                  itemStyle={{
                                    fontSize: "0.75rem",
                                    padding: "2px 0",
                                  }}
                                />

                                {/* ── Shop Trial baseline line — NO xAxisId ── */}
                                <Line
                                  data={curveData}
                                  type="monotone"
                                  dataKey="baseline"
                                  name="Shop Trial (Baseline)"
                                  stroke="#ca8a04"
                                  strokeWidth={2.5}
                                  strokeDasharray="6 4"
                                  dot={false}
                                  isAnimationActive={false}
                                />

                                {scatterPoints.map((pt, idx) => (
                                  <Scatter
                                    key={`env-${idx}`}
                                    name={pt.name}
                                    data={[
                                      { load: pt.load, actual: pt.actual },
                                    ]}
                                    dataKey="actual"
                                    fill={pt.color}
                                    shape={(props) => {
                                      const { cx, cy } = props;
                                      if (
                                        !Number.isFinite(cx) ||
                                        !Number.isFinite(cy)
                                      )
                                        return null;
                                      const c =
                                        SCATTER_COLORS[
                                          idx % SCATTER_COLORS.length
                                        ];
                                      return (
                                        <g>
                                          <line
                                            x1={cx - 6}
                                            y1={cy - 6}
                                            x2={cx + 6}
                                            y2={cy + 6}
                                            stroke={c}
                                            strokeWidth={2.5}
                                          />
                                          <line
                                            x1={cx - 6}
                                            y1={cy + 6}
                                            x2={cx + 6}
                                            y2={cy - 6}
                                            stroke={c}
                                            strokeWidth={2.5}
                                          />
                                          <circle
                                            cx={cx}
                                            cy={cy}
                                            r={10}
                                            fill="transparent"
                                          />
                                        </g>
                                      );
                                    }}
                                    isAnimationActive={false}
                                  />
                                ))}
                              </ComposedChart>
                            </ResponsiveContainer>

                            {/* MANUAL LEGEND — outside SVG, zero collision risk */}
                            <div
                              style={{
                                display: "flex",
                                flexWrap: "wrap",
                                justifyContent: "center",
                                gap: "6px 14px",
                                padding: "10px 8px 4px",
                                borderTop: "1px solid #f1f5f9",
                              }}
                            >
                              {/* Baseline legend item */}
                              <div
                                style={{
                                  display: "flex",
                                  alignItems: "center",
                                  gap: "5px",
                                }}
                              >
                                <svg width="22" height="10">
                                  <line
                                    x1="0"
                                    y1="5"
                                    x2="22"
                                    y2="5"
                                    stroke="#ca8a04"
                                    strokeWidth="2.5"
                                    strokeDasharray="6 4"
                                  />
                                </svg>
                                <span
                                  style={{
                                    fontSize: "10px",
                                    color: "#64748b",
                                    fontWeight: 600,
                                  }}
                                >
                                  Shop Trial (Baseline)
                                </span>
                              </div>

                              {/* One entry per scatter point */}
                              {scatterPoints.map((pt, idx) => (
                                <div
                                  key={`leg-${idx}`}
                                  style={{
                                    display: "flex",
                                    alignItems: "center",
                                    gap: "5px",
                                  }}
                                >
                                  <svg width="12" height="12">
                                    <line
                                      x1="1"
                                      y1="1"
                                      x2="11"
                                      y2="11"
                                      stroke={
                                        SCATTER_COLORS[
                                          idx % SCATTER_COLORS.length
                                        ]
                                      }
                                      strokeWidth="2.5"
                                    />
                                    <line
                                      x1="1"
                                      y1="11"
                                      x2="11"
                                      y2="1"
                                      stroke={
                                        SCATTER_COLORS[
                                          idx % SCATTER_COLORS.length
                                        ]
                                      }
                                      strokeWidth="2.5"
                                    />
                                  </svg>
                                  <span
                                    style={{
                                      fontSize: "10px",
                                      color: "#64748b",
                                      fontWeight: 600,
                                    }}
                                  >
                                    {pt.name}
                                  </span>
                                </div>
                              ))}
                            </div>
                          </>
                        )}
                      </div>
                    )}
                  </div>
                );
              })()}

            {analysisMode === "mainEngine" &&
              (selectedMetric === "EngineLoadDiagram" ||
                selectedMetric === "all") && (
                <div style={{ marginBottom: "20px" }}>
                  {renderEngineLoadDiagram()}
                </div>
              )}

            {selectedMetric === "all" ? (
              renderAllCharts()
            ) : selectedMetric !== "EngineLoadDiagram" ? (
              <div className="enhanced-card chart-card">
                <div className="card-header-enhanced">
                  <h3 className="card-title-enhanced">
                    Baseline vs Monthly - {selectedMetric}
                  </h3>
                  <p className="card-description-enhanced">
                    {allMonthlyReports.length > 0
                      ? // Uses xLabel defined in the outer scope (FIX 4)
                        `Showing ${allMonthlyReports.length} month(s) - ${singleChartMetricUnit} vs ${xLabel}`
                      : "Upload monthly PDF to overlay data points"}
                  </p>
                </div>
                <div className="card-content-enhanced">
                  <div
                    className="main-chart-container"
                    style={{ width: "100%", height: "400px" }}
                  >
                    <ResponsiveContainer width="100%" height="100%">
                      <LineChart
                        data={singleChartSeries}
                        margin={{ left: 16, right: 16, top: 8, bottom: 24 }}
                      >
                        <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
                        <XAxis
                          dataKey="x"
                          type="number"
                          domain={isAux ? ["dataMin", "dataMax"] : [0, 110]}
                          ticks={isAux ? undefined : [25, 50, 75, 100, 110]}
                          tickFormatter={(v) =>
                            isAux ? v.toFixed(1) : `${v}%`
                          }
                          label={{
                            value: xLabel, // Uses xLabel defined in the outer scope (FIX 4)
                            position: "insideBottom",
                            offset: -10,
                            style: { fontWeight: 600 },
                          }}
                          stroke="#64748b"
                        />
                        <YAxis
                          width={60}
                          // Uses the calculated domain (FIX 1)
                          domain={singleChartYDomain}
                          // Uses the calculated customTicks (FIX 1)
                          ticks={singleChartCustomTicks}
                          tickFormatter={(v) => v.toFixed(1)}
                          stroke="#64748b"
                        />
                        <Line
                          type="monotone"
                          dataKey="y"
                          stroke="#ca8a04"
                          strokeWidth={2}
                          name="Shop Trial Baseline"
                          dot={true}
                          isAnimationActive={false}
                        />
                        {allMonthlyReports.map((report, index) => {
                          const xAxisKey = isAux ? xAxisType : "load";
                          const xValue = report[xAxisKey];
                          let yValue = report[selectedMetric];
                          if (
                            yValue === null ||
                            yValue === undefined ||
                            !Number.isFinite(yValue)
                          ) {
                            return null;
                          }

                          if (
                            xValue === null ||
                            xValue === undefined ||
                            !Number.isFinite(xValue) ||
                            yValue === null ||
                            yValue === undefined ||
                            !Number.isFinite(yValue)
                          ) {
                            return null;
                          }

                          const labelValue = `${yValue.toFixed(1)} ${singleChartMetricUnit}`;

                          // --- CORRECTED Stacking and Positioning Logic ---
                          let labelPosition = "top";
                          let labelOffset = 10; // Default vertical offset

                          // Horizontal position logic for visibility
                          if (xValue <= 55) {
                            labelPosition = "right";
                            labelOffset = 15;
                          } else if (xValue >= 80) {
                            labelPosition = "top";
                            labelOffset = -20; // Shift label up more to clear the line
                          }

                          // CRITICAL FIX: Stacking Logic - Apply an additional vertical offset based on the report's index.
                          // Each successive report (index 0, 1, 2...) gets pushed further away from the point.
                          const stackShift = index * 24; // Use 24px per label block (value + date)

                          return (
                            <ReferenceDot
                              key={report.month}
                              x={xValue}
                              y={yValue}
                              shape={<CustomColoredXMarker />}
                              fill={report.color}
                              label={false}
                              //     value: `${labelValue}\n${report.displayName}`,
                              //     position: labelPosition,
                              //     offset: labelOffset,
                              //     fill: report.color,
                              //     fontSize: 12,
                              //     fontWeight: 600,
                              //     content: ({ x, y, value, offset, fill, style }) => {
                              //         const lines = value.split('\n');
                              //         const isRight = labelPosition === 'right';

                              //         return (
                              //             <g transform={`translate(${x},${y})`}>
                              //                 <text
                              //                     x={0}
                              //                     y={0}
                              //                     fill={fill}
                              //                     style={style}
                              //                     textAnchor={isRight ? 'start' : 'middle'}
                              //                 >
                              //                     {lines.map((line, i) => (
                              //                         <tspan
                              //                             key={i}
                              //                             // X Position: Shifts for 'right' aligned labels
                              //                             x={isRight ? offset : 0}
                              //                             // Y Position: Shifts for the first line (using absolute position + stack shift)
                              //                             // Subsequent lines (i > 0) use a standard line spacing of 15px.
                              //                             dy={i === 0
                              //                                     ? (labelPosition === 'top' ? -(offset + stackShift) : (offset + stackShift))
                              //                                     : 15}
                              //                         >
                              //                             {line}
                              //                         </tspan>
                              //                     ))}
                              //                 </text>
                              //             </g>
                              //         );
                              //     }
                              // }
                            />
                          );
                        })}
                        <Tooltip
                          content={
                            <CustomTooltip
                              unit={singleChartMetricUnit}
                              xAxisType={xAxisKey}
                            />
                          }
                          cursor={false} // <--- ADD THIS HERE TOO
                        />
                        <Legend
                          content={
                            <CustomInlineLegend
                              monthlyReports={allMonthlyReports}
                              metricKey={selectedMetric}
                            />
                          }
                        />
                      </LineChart>
                    </ResponsiveContainer>
                  </div>
                </div>
              </div>
            ) : null}
            {analysisMode === "mainEngine" &&
              allMonthlyReports.length === 1 &&
              renderMEDeviationHistoryTable()}
            {/* 🔥 Render History Table Here - Only for Auxiliary Engine */}
            {analysisMode === "auxiliaryEngine" &&
              allMonthlyReports.length === 1 &&
              renderAEDeviationHistoryTable()}

            {/* <div className="info-cards-grid">
          <div className="enhanced-card">
            <div className="card-header-enhanced">
              <h3 className="card-title-enhanced">Selected Vessel</h3>
              <p className="card-description-enhanced">
                {fleet.find(s => s.id === shipId)?.name || 'Select a vessel'}
              </p>
            </div>
            <div className="card-content-enhanced">
              {allMonthlyReports[0] ? (
                <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                  <div className="info-row">
                    <span className="info-label">Load:</span>
                    <span className="info-value">
                      {isAux
                        ? `${allMonthlyReports[0].load_percentage}% (${allMonthlyReports[0].load_kw} kW)`
                        : `${allMonthlyReports[0].load}%`
                      }
                    </span>
                  </div>
                  {selectedMetric !== 'all' && selectedMetric !== 'EngineLoadDiagram' && (
                    <div className="info-row">
                      <span className="info-label">{selectedMetric}:</span>
                      <span className="info-value">
                        {allMonthlyReports[0][selectedMetric]?.toFixed(2) || 'N/A'}
                      </span>
                    </div>
                  )}
                  <div className="info-row" style={{ borderBottom: 'none' }}>
                    <span className="info-label">Historical points:</span>
                    <span className="info-value">{allMonthlyReports.length}</span>
                  </div>
                </div>
              ) : (
                <p style={{ textAlign: 'center', color: '#999', padding: '16px' }}>Awaiting monthly upload...</p>
              )}
            </div>
          </div>

          {selectedMetric !== 'all' && selectedMetric !== 'EngineLoadDiagram' && (
            <div className="enhanced-card">
              <div className="card-header-enhanced">
                <h3 className="card-title-enhanced">Deviation</h3>
                <p className="card-description-enhanced">Difference from baseline at same load</p>
              </div>
              <div className="card-content-enhanced">
                {allMonthlyReports[0] && baseline[selectedMetric] ? (
                  (() => {
                    const targetLoad = isAux ? allMonthlyReports[0][xAxisType] : allMonthlyReports[0].load;
                    const xAxis = isAux ? xAxisType : 'load';
                    const baselineValue = interpolateBaseline(
                      baseline,
                      targetLoad,
                      selectedMetric,
                      xAxis // Correct variable (Fix 2)
                    );
                    const actualValue = allMonthlyReports[0][selectedMetric];
                    const diff = (actualValue ?? baselineValue) - baselineValue;
                    const pct = baselineValue !== 0 ? (diff / baselineValue) * 100 : 0;
                  
                    const mainDangerIfLow = ['Pmax', 'ScavAir', 'EngSpeed', 'Turbospeed', 'Pcomp'];
                    const auxDangerIfLow = ['Pmax', 'BoostAirPressure'];
                    const metricsDangerIfLow = isAux ? auxDangerIfLow : mainDangerIfLow;
                    const criticalThreshold = 5;
                    const isDangerIfLow = metricsDangerIfLow.includes(selectedMetric);
                    const isDanger = (isDangerIfLow && pct < -criticalThreshold) || (!isDangerIfLow && pct > criticalThreshold);
                    const isGood = (isDangerIfLow && pct > criticalThreshold) || (!isDangerIfLow && pct < -criticalThreshold);
                  
                    let color = '#1e293b';
                    if (isDanger) color = '#dc2626';
                    else if (isGood) color = '#16a34a';

                    const colorStyle = { fontWeight: 'bold', color: color };

                    return (
                      <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                        <div className="info-row">
                          <span className="info-label">Baseline:</span>
                          <span className="info-value">
                            {baselineValue?.toFixed(2) || 'N/A'}
                          </span>
                        </div>
                        <div className="info-row">
                          <span className="info-label">Monthly:</span>
                          <span className="info-value">
                            {actualValue?.toFixed(2) || 'N/A'}
                          </span>
                        </div>
                        <div className="info-row">
                          <span className="info-label">Diff:</span>
                          <span className="info-value" style={colorStyle}>
                            {diff >= 0 ? '+' : ''}{diff.toFixed(2)}
                          </span>
                        </div>
                        <div className="info-row" style={{ borderBottom: 'none' }}>
                          <span className="info-label">Deviation %:</span>
                          <span className="info-value" style={colorStyle}>
                            {pct >= 0 ? '+' : ''}{pct.toFixed(2)}%
                          </span>
                        </div>
                      </div>
                    );
                  })()
                ) : (
                  <p style={{ textAlign: 'center', color: '#999', padding: '16px' }}>
                    Upload a monthly PDF to see deviation
                  </p>
                )}
              </div>
            </div>
          )}
        </div> */}
          </div>
        </>
      )}
      {/* {isGeneratingPDF && (
          <div className="pdf-loading-overlay">
            <div className="pdf-spinner"></div>
            <div className="pdf-loading-text">Generating Report PDF...</div>
            <div
              style={{ color: "#64748b", fontSize: "0.9rem", marginTop: "8px" }}
            >
              Please wait while we format your charts
            </div>
          </div>
        )} */}
    </div>
  );
}

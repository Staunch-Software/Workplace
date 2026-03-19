// --- START OF FILE Performance.jsx (FINAL STABLE VERSION) ---

import React, { useEffect, useState, useMemo } from "react";
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
              overflowY: "auto", // Scrolls independently if many reports
              backgroundColor: "white",
              scrollbarWidth: "thin",
              scrollbarColor: "#6b7280 #f1f1f1",
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

  const DiagnosisPanel = ({ report }) => {
    const concerns = getDetectedConcerns(report);

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

// --- MOVE THIS TO THE GLOBAL SCOPE (Around Line 430) ---

const getDetectedConcerns = (report, baseline, analysisMode) => {
  if (!report || !baseline || Object.keys(baseline).length === 0) return [];
  const concerns = [];
  const isME = analysisMode === "mainEngine";
  const load = isME ? report.load : report.load_percentage;

  const getBase = (key) =>
    interpolateBaseline(baseline, load, key, isME ? "load" : "load_percentage");

  // Helper for Cylinder Imbalance (±3 bar rule)
  const checkImbalance = (paramPrefix, avgValue) => {
    const individualValues = [];
    for (let i = 1; i <= 14; i++) {
      const val =
        report[`${paramPrefix}_${i}`] ||
        report[`${paramPrefix.toLowerCase()}_${i}`];
      if (val) individualValues.push({ cyl: i, val: Number(val) });
    }
    if (individualValues.length === 0) return null;
    const deviations = individualValues.filter(
      (v) => Math.abs(v.val - avgValue) > 3,
    );
    return deviations.length > 0
      ? deviations.map((d) => d.cyl).join(", ")
      : null;
  };

  const pcompAct = Number(report.Pcomp);
  const pcompBase = getBase("Pcomp");
  const pmaxAct = Number(report.Pmax);
  const pmaxBase = getBase("Pmax");
  const scavAct = Number(report.ScavAir);

  // --- 1. PCOMP LOGIC (±3 bar imbalance & -3 bar avg deviation) ---
  const pcompImbal = checkImbalance("Pcomp", pcompAct);
  if (pcompImbal) {
    concerns.push({
      parameter: "Pcomp Balance",
      severity: "critical",
      finding: `Cylinders ${pcompImbal} deviate >±3 bar from average Pcomp. Engine is imbalanced.`,
      causes: [
        "Leaking piston rings",
        "Burnt piston crown",
        "Worn cylinder liner",
        "Leaking exhaust valve",
      ],
      remedy:
        "Check piston crown with template. Measure liner wear. Carry out scavenge port inspection.",
    });
  }

  if (pcompAct && pcompBase && pcompAct - pcompBase < -3) {
    concerns.push({
      parameter: "Average Pcomp (Low)",
      severity: "critical",
      finding: `Avg Pcomp is >3 bar below Test-Bed baseline. Indicates possible blow-by.`,
      causes: [
        "Poor scavenge air pressure",
        "Blow-by via exhaust valves",
        "Low exhaust valve stroke",
        "Malfunction of HCU (ME Engines)",
        "Piston rod stuffing box leakage",
      ],
      remedy:
        "Check exhaust valve timing and damper arrangement. Overhaul stuffing box if air is emitted from check funnel.",
    });
  }

  // --- 2. PMAX LOGIC (Injection & Ignition Timing) ---
  const pmaxImbal = checkImbalance("Pmax", pmaxAct);
  if (pmaxImbal) {
    concerns.push({
      parameter: "Pmax Balance",
      severity: "critical",
      finding: `Cylinders ${pmaxImbal} deviate >±3 bar from average Pmax. Engine is imbalanced.`,
      causes: [
        "Fuel injection timing error",
        "Worn fuel equipment (valves/pumps)",
        "Malfunction of HCU/Tacho system",
      ],
      remedy:
        "Pressure test fuel valves. Verify fuel pump lead and VIT adjustment.",
    });
  }

  // High Pmax / Normal Pcomp (Early Injection)
  if (
    pmaxAct &&
    pmaxBase &&
    pmaxAct - pmaxBase > 3 &&
    Math.abs(pcompAct - pcompBase) <= 2
  ) {
    concerns.push({
      parameter: "Pmax (High)",
      severity: "critical",
      finding:
        "Max pressure too high but Compression pressure normal. Indicates Early Injection.",
      causes: ["Too early injection timing", "Incorrect VIT-index setting"],
      remedy:
        "Check VIT-index calibration. If in order, reduce the fuel pump lead.",
    });
  }

  // Low Pmax / Normal Pcomp (Retarded Injection)
  if (
    pmaxAct &&
    pmaxBase &&
    pmaxAct - pmaxBase < -3 &&
    Math.abs(pcompAct - pcompBase) <= 2
  ) {
    concerns.push({
      parameter: "Pmax (Low)",
      severity: "critical",
      finding:
        "Max pressure too low but Compression pressure correct. Indicates Retarded Injection.",
      causes: [
        "Delayed fuel injection",
        "Poor fuel ignition quality",
        "Leaking injector nozzles",
        "Low fuel pressure at engine",
      ],
      remedy:
        "Check fuel pressure after filter. Check VIT-index. Increase fuel pump lead if fuel quality is poor.",
    });
  }

  // Both Low (Mechanical Failure)
  if (
    pmaxAct &&
    pmaxBase &&
    pmaxAct - pmaxBase < -3 &&
    pcompAct - pcompBase < -3
  ) {
    concerns.push({
      parameter: "Pmax & Pcomp (Low)",
      severity: "critical",
      finding:
        "Both pressures are low. Indicates significant thermal/mechanical loss.",
      causes: [
        "Piston ring blow-by",
        "Leaking exhaust valve",
        "Increased combustion space (burnt crown)",
        "Fouling of exhaust/air system",
      ],
      remedy:
        "Inspect piston rings and exhaust valve seats. Check for system fouling.",
    });
  }

  // --- 3. PRESSURE RISE (Pmax - Pcomp) ---
  if (pmaxAct && pcompAct) {
    const pRise = pmaxAct - pcompAct;
    if (pRise > 40) {
      concerns.push({
        parameter: "Pressure Rise",
        severity: "critical",
        finding: `Pmax-Pcomp is ${pRise.toFixed(1)} bar (Limit: 40). Excessive thermal load.`,
        causes: ["Advanced injection timing", "VIT malfunction"],
        remedy: "Reduce fuel pump lead immediately. Verify VIT/HCU settings.",
      });
    } else if (load > 75 && pRise < 20) {
      concerns.push({
        parameter: "Pressure Rise",
        severity: "warning",
        finding: `Pmax-Pcomp < 20 bar at high load (>75%). Poor performance detected.`,
        causes: [
          "Delayed ignition",
          "Extremely poor fuel combustion properties",
        ],
        remedy:
          "Expect high fuel consumption. Check fuel characteristics and increase lead.",
      });
    }
  }

  // --- 4. EXHAUST TEMPERATURE (40/60 Rule) ---
  const exhAct = Number(report.Exh_Cylinder_outlet);
  const exhBase = getBase("Exh_Cylinder_outlet");
  if (exhAct && exhBase) {
    const delta = exhAct - exhBase;
    if (delta >= 40) {
      concerns.push({
        parameter: "Exhaust Temp Level",
        severity: delta >= 60 ? "critical" : "warning",
        finding: `Exh. Temp increased by ${delta.toFixed(1)}°C`,
        causes: [
          "Worn fuel pumps/valves",
          "Fouled air coolers",
          "TC turbine side fouling",
          "Poor fuel quality",
        ],
        remedy:
          "Pressure test fuel valves. Inspect Air Cooler air/water sides. Perform TC turbine washing.",
      });
    }
  }

  // --- 5. TURBOCHARGER SYNOPSIS ---
  // TC Efficiency (Amber 3% / Red 5%)
  ["TC_Compressor_Eff", "TC_Turbine_Eff"].forEach((key) => {
    const eff = Number(report[key]);
    if (eff > 0 && eff < 100) {
      // Assuming 100 is design baseline
      const dev = 100 - eff;
      if (dev >= 3) {
        concerns.push({
          parameter: key.replace(/_/g, " "),
          severity: dev >= 5 ? "critical" : "warning",
          finding: `${key.includes("Compressor") ? "Compressor" : "Turbine"} efficiency dropped by ${dev.toFixed(1)}%.`,
          causes: [
            "Fouling of turbine/compressor blades",
            "Clogged nozzle ring",
          ],
          remedy: "Perform TC water washing. Inspect nozzle ring for blockage.",
        });
      }
    }
  });

  // TC LO Pressure (1.5 - 2.2 bar)
  const loPress = Number(report.tc_lo_inlet_pressure_bar);
  if (loPress > 2.2 || (loPress > 0 && loPress < 1.5)) {
    concerns.push({
      parameter: "TC LO Inlet Pressure",
      severity: "critical",
      finding: `LO Pressure is ${loPress} bar (Allowed Range: 1.5 - 2.2).`,
      causes: ["LO system regulation failure", "Pump issues"],
      remedy:
        "Adjust TC LO inlet pressure to be within 1.5 - 2.2 bar range immediately.",
    });
  }

  // TC Back Pressure (300mmWC)
  const backPress = Number(report.tc_turbine_outlet_pressure_mmwc);
  if (backPress > 300) {
    concerns.push({
      parameter: "TC Back Pressure",
      severity: "critical",
      finding: `Turbine outlet pressure is ${backPress} mmWC (Limit: 300).`,
      causes: [
        "Blockage in exhaust pipe",
        "Clogged nozzle ring",
        "Economizer/Scrubber obstruction",
      ],
      remedy: "Inspect exhaust piping and economizer/funnel for obstructions.",
    });
  }

  // Air Filter Pressure Drop (50% rule)
  const filterDP = Number(report.tc_air_filter_diff_pressure_mmwc);
  const filterBase = getBase("tc_air_filter_diff_pressure_mmwc");
  if (filterDP && filterBase && filterDP > filterBase * 1.5) {
    concerns.push({
      parameter: "TC Air Filter ΔP",
      severity: "warning",
      finding: `Pressure drop is 50% higher than baseline.`,
      causes: ["Fouled filter elements"],
      remedy: "TC Filter elements must be cleaned or replaced.",
    });
  }

  // --- 6. AIR COOLER SYNOPSIS ---
  // ΔP (240mmWC or 150%)
  const coolerDP = Number(report.scav_air_cooler_diff_pressure_mmwc);
  if (coolerDP > 240) {
    concerns.push({
      parameter: "Air Cooler ΔP",
      severity: "critical",
      finding: `Cooler Pressure Drop is ${coolerDP} mmWC (Limit: 240).`,
      causes: ["Clogged air side elements", "Fouling from oily mist"],
      remedy: "Air cooler is clogged. Clean air-side immediately.",
    });
  }

  // ΔT Air Out - Water In (12-14°C)
  const airOut = Number(report.scav_air_temp_after_cooler_c);
  const waterIn = Number(report.scav_air_cooler_cw_in_temp_c);
  if (airOut && waterIn && airOut - waterIn > 14) {
    concerns.push({
      parameter: "Cooler Cooling Ability (ΔT)",
      severity: "critical",
      finding: `Air Out - Water In is ${(airOut - waterIn).toFixed(1)}°C (Limit: 14).`,
      causes: ["Fouled water side pathways", "Low cooling water flow"],
      remedy: "Cooling efficiency impacted. Clean water side of air cooler.",
    });
  }

  // --- 7. SCAVENGE LOGIC ---
  const exhRec = Number(report.exhaust_gas_receiver_pressure_kg_cm2);
  if (scavAct && exhRec && scavAct <= exhRec) {
    concerns.push({
      parameter: "Scavenge vs Exhaust Logic",
      severity: "critical",
      finding:
        "Scavenge pressure is NOT greater than Exhaust receiver pressure.",
      causes: [
        "Incorrect measurement",
        "Manometer failure",
        "Severe TC nozzle ring fouling",
      ],
      remedy: "Verify U-tube manometers. Inspect TC nozzle ring for fouling.",
    });
  }

  // --- 8. FUEL PUMP INDEX (+10%) ---
  const fipiAct = Number(report.FIPI);
  const fipiBase = getBase("FIPI");
  if (fipiAct && fipiBase && fipiAct > fipiBase * 1.1) {
    concerns.push({
      parameter: "Fuel Pump Index (High)",
      severity: "warning",
      finding: "Fuel Pump Index has increased by more than 10% from baseline.",
      causes: ["Worn fuel pump elements", "Internal leakages"],
      remedy: "Recommendation: Overhaul fuel pumps.",
    });
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
                  flexShrink: 0 /* Important: prevents the findings from squishing */,
                }}
              >
                <div
                  style={{
                    padding: "8px 16px",
                    backgroundColor:
                      item.severity === "critical" ? "#fff1f2" : "#fffbeb",
                    borderBottom: `1px solid ${item.severity === "critical" ? "#fecdd3" : "#fde68a"}`,
                    fontWeight: "900",
                    fontSize: "0.85rem",
                    color: item.severity === "critical" ? "#9f1239" : "#92400e",
                    textTransform: "uppercase",
                  }}
                >
                  {item.severity}: {item.parameter}
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
            maxHeight: "320px",
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
    grid-template-columns: repeat(auto-fit, minmax(450px, 1fr));
    gap: 32px; /* Increased gap for better visual separation */
    margin-top: 32px;
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
  const legendItems = [
    { value: "Shop Trial Baseline", type: "line", color: "#ca8a04" },
  ];

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

export default function Performance() {
  const navigate = useNavigate();
  const [activeTab, setActiveTab] = useState("view");

  // State declarations
  const [analysisMode, setAnalysisMode] = useState("mainEngine");
  const [isDataLoaded, setIsDataLoaded] = useState(false);
  const [fleet, setFleet] = useState([]);
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
  const [loadDiagramData, setLoadDiagramData] = useState(null);
  const [generators, setGenerators] = useState([]);
  const [selectedGeneratorId, setSelectedGeneratorId] = useState(null);
  const [xAxisType, setXAxisType] = useState("load_percentage");
  const [isGeneratingPDF, setIsGeneratingPDF] = useState(false);
  const [uploadMode, setUploadMode] = useState("mainEngine");
  // const [selectedYear, setSelectedYear] = useState("");
  // const [selectedMonth, setSelectedMonth] = useState("");
  // const currentYear = new Date().getFullYear();
  // const years = Array.from({ length: 50 }, (_, i) => currentYear - i);
  const [availableReports, setAvailableReports] = useState([]);
  // Store the IDs of reports checked by the user
  const [selectedReportIds, setSelectedReportIds] = useState([]);
  const [displayedReportIds, setDisplayedReportIds] = useState([]);
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
    const handleGlobalClick = () => setActivePoint(null);
    if (activePoint) {
      window.addEventListener("click", handleGlobalClick);
    }
    return () => window.removeEventListener("click", handleGlobalClick);
  }, [activePoint]);
  const [loadingDates, setLoadingDates] = useState(false);
  const [showReport, setShowReport] = useState(false);
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
  }, [navigate]);

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
        if (baselineSource !== "upload") {
          setSelectedReportIds([]);
          setLoadDiagramData(null);
          setBaseline({});
          setMeDeviationHistory([]);
          setAeDeviationHistory([]);
          setCurrentReferenceMonth(null);
          setShowReport(false);
        }
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
  };

  const handleModeChange = (value) => {
    const newMode =
      typeof value === "string" ? value : value?.target?.value || value;
    setAnalysisMode(newMode);
    setBaselineSource(null);
    setUploadMode(newMode);
    setUploadMode(val);
    setMonthlyReports([]);
    setHistoricalReports([]);
    setBaseline({});
    setSelectedMetric("all");
    setLoadDiagramData(null);
    setShowReport(false);
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
        <div className="card-header-enhanced">
          <h3 className="card-title-enhanced">Engine Load Diagram (% SMCR)</h3>
          <p className="card-description-enhanced">
            Logarithmic Scale normalized to SMCR (Point M)
          </p>
        </div>
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
                      ((payload.rpm_abs - expectedRpmAtPt) / expectedRpmAtPt) *
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
                                <span style={{ color: "#64748b" }}>Speed:</span>
                                <span>
                                  <strong>{activePoint.x.toFixed(1)}%</strong> (
                                  {activePoint.absX.toFixed(1)} rpm)
                                </span>
                              </div>

                              <div
                                style={{
                                  display: "flex",
                                  justifyContent: "space-between",
                                }}
                              >
                                <span style={{ color: "#64748b" }}>Power:</span>
                                <span>
                                  <strong>{activePoint.y.toFixed(1)}%</strong> (
                                  {activePoint.absY.toFixed(0)} kW)
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

          {primaryPoint && (
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
                    {/* THIS WILL NOW SHOW 78.1% */}
                    <td>rpm ({primaryPoint.rpm_pct.toFixed(1)}%)</td>
                  </tr>
                  <tr
                    style={{ backgroundColor: tableColorMap["Actual Power"] }}
                  >
                    <td>Actual Power</td>
                    <td>{tableVars.actual?.toFixed(0) || "N/A"}</td>
                    <td>kW ({primaryPoint.power_pct.toFixed(1)}%)</td>
                  </tr>
                  <tr style={{ backgroundColor: tableColorMap["SMCR Power"] }}>
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

                  {/* <tr style={{ backgroundColor: '#fff', borderTop: '2px solid #f1f5f9' }}>
                      <td style={{ fontWeight: 'bold', color: '#334155' }}>Running Status</td>
                      <td style={{ fontWeight: 'bold', color: tableVars.color }}>{tableVars.status}</td>
                      <td>-</td>
                    </tr> */}

                  <tr style={{ backgroundColor: "#fff" }}>
                    <td>Power Deviation</td>
                    <td style={{ fontWeight: "bold", color: "#1e293b" }}>
                      {" "}
                      {/* Fixed Color */}
                      {tableVars.powerDev > 0 ? "+" : ""}
                      {tableVars.powerDev.toFixed(1)}%
                    </td>
                    <td>%</td>
                  </tr>

                  <tr style={{ backgroundColor: "#fff" }}>
                    <td>RPM Deviation</td>
                    <td style={{ fontWeight: "bold", color: "#1e293b" }}>
                      {" "}
                      {/* Fixed Color */}
                      {tableVars.rpmDev > 0 ? "+" : ""}
                      {tableVars.rpmDev.toFixed(1)}%
                    </td>
                    <td>%</td>
                  </tr>
                </tbody>
              </table>
            </div>
          )}
        </div>
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
            style={{
              display: "flex",
              justifyContent: "space-between",
              alignItems: "flex-start",
            }}
          >
            <div>
              <h3 className="card-title-enhanced">
                {allMonthlyReports.length === 1
                  ? `Performance Summary @ ${loadDisplay}`
                  : `Performance Matrix (${allMonthlyReports.length} Reports)`}
              </h3>
              <p className="card-description-enhanced">
                {allMonthlyReports.length === 1
                  ? `Baseline vs Actual - ${currentMonthReport.displayName}`
                  : "Comparison across multiple dates vs Baseline"}
              </p>
            </div>
            {/* Professional Bookmark */}
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
          </div>
          <div className="card-content-enhanced">
            <table className="summary-table-enhanced">
              <thead>
                <tr>
                  <th style={{ width: "35%", textAlign: "left" }}>Parameter</th>
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
                    let rawMargin = currentMonthReport.propeller_margin_percent;
                    let isRatio = false; // Default to Deviation (0-based)

                    // 1. Fallback: If DB value is missing, calculate it using Graph Data
                    if (rawMargin === undefined || rawMargin === null) {
                      const actualPower =
                        loadDiagramData?.actual_operating_point?.power_kw;
                      const actualRpm =
                        loadDiagramData?.actual_operating_point?.rpm;
                      const servicePropellerPower = interpolateLoadDiagramPower(
                        loadDiagramData?.propeller_curves || [],
                        actualRpm,
                        "power_service_kw",
                      );

                      if (actualPower && servicePropellerPower) {
                        // Old Logic Calculation returns a Ratio (e.g. 115.5)
                        rawMargin = (actualPower / servicePropellerPower) * 100;
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
                    const groupA = ["Pmax", "Pcomp", "Turbospeed", "EngSpeed"];
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
        {allMonthlyReports.length === 1 && (
          <DiagnosisPanel
            report={allMonthlyReports[0]}
            baseline={baseline}
            analysisMode={analysisMode}
          />
        )}

        <div className="charts-grid-enhanced">
          {chartOrder.map((metricKey) => {
            const uniqueChartDataMap = new Map();
            baseline[metricKey]?.forEach((p) => {
              const xValue = isAux ? p[xAxisKey] : p.load; // Corrected xValue extraction for aux engine
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

                        // --- EXISTING LOGIC: Skip rendering if X or Y value is invalid ---
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
                                style={{ cursor: "pointer", outline: "none" }} // Added outline none
                                tabIndex="-1" // Prevents browser from making it a focus stop
                                onClick={(e) => {
                                  e.stopPropagation(); // Prevents clearing the selection immediately
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
                                    metricKey: metricKey, // Scopes the card to this chart only
                                  });
                                }}
                              >
                                <CustomColoredXMarker
                                  {...props}
                                  fill={report.color}
                                />
                                {/* Transparent hit-area to make the thin 'x' easy to click */}
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

                      {/* Hide default hover tooltip content */}
                      <Tooltip content={() => null} cursor={false} />

                      {/* Render the custom Click-Card scope-checked by metricKey */}
                      {activePoint && activePoint.metricKey === metricKey && (
                        <ReferenceDot
                          x={activePoint.x}
                          y={activePoint.y}
                          shape={() => {
                            // 1. Dimensions (Must match the card size exactly)
                            const cardW = 180;
                            const cardH = 110;
                            const padding = 12;

                            // 2. Smart Positioning Logic
                            const showBelow = activePoint.cy < 120;
                            const posY = showBelow
                              ? activePoint.cy + padding
                              : activePoint.cy - (cardH - 10);

                            const showLeft = activePoint.cx > 300;
                            const posX = showLeft
                              ? activePoint.cx - (cardW + padding)
                              : activePoint.cx + padding;

                            return (
                              <g>
                                {/* 🔥 THE FIX: SVG SHIELD 
                                  This solid white rectangle physically blocks the gold dots 
                                  from showing through the card. */}
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
                                      "drop-shadow(0px 10px 15px rgba(0,0,0,0.2))",
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
                                      background: "#ffffff !important", // Keep for CSS safety
                                      backgroundColor: "#ffffff !important",
                                      opacity: "1 !important",
                                      padding: "12px",
                                      border: `2px solid ${activePoint.color}`,
                                      borderRadius: "8px",
                                      fontSize: "12px",
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
                                        fontSize: "10px",
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
                                        marginTop: "2px",
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
        </div>
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
          style={{
            display: "flex",
            justifyContent: "space-between",
            alignItems: "flex-start",
          }}
        >
          <div>
            <h3 className="card-title-enhanced">
              Historical Deviation Analysis (Last 6 Reports)
            </h3>
            <p className="card-description-enhanced">
              Comparison across recent reports (Actual vs Deviation %)
            </p>
          </div>
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
        </div>

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
                    (a, b) => new Date(b.report_date) - new Date(a.report_date),
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
          style={{
            display: "flex",
            justifyContent: "space-between",
            alignItems: "flex-start",
          }}
        >
          <div>
            <h3 className="card-title-enhanced">
              Historical Deviation Analysis (Last 6 Reports)
            </h3>
            <p className="card-description-enhanced">
              Main Engine — Actual vs Deviation %
            </p>
          </div>
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
        </div>

        <div className="card-content-enhanced" style={{ overflowX: "auto" }}>
          <table
            className="summary-table-enhanced"
            style={{ width: "100%", tableLayout: "fixed" }}
          >
            <thead>
              <tr>
                <th
                  style={{ textAlign: "left", padding: "12px", width: "200px" }}
                >
                  PARAMETER
                </th>
                {[...meDeviationHistory]
                  .sort(
                    (a, b) => new Date(b.report_date) - new Date(a.report_date),
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
      </div>
    );
  };

  // OLD PDF DOWNLOAD LOGIC FROM ORIGINAL SCRIPT
  // --- REPLACEMENT FOR downloadPDF FUNCTION ---
  const downloadPDF = async (mode = "local") => {
    setIsGeneratingPDF(true);
    const yieldToMain = () => new Promise((resolve) => setTimeout(resolve, 0));

    // Wait for UI to stabilize
    setTimeout(async () => {
      const pdfStart = performance.now();
      console.log(
        `🚀 [${mode.toUpperCase()}] Hybrid PDF Generation (AutoTable + Screenshots)...`,
      );

      let pdf;
      let fileName = "performance-report.pdf";

      // 1. CONFIGURATION (Your original settings)
      const PDF_SCALE = 1.5;
      const IMG_QUALITY = 1.0;

      // 2. HELPER: CAPTURE ELEMENT (Your original helper)
      const captureElement = async (element, title, center = false) => {
        if (!element) return null;
        try {
          await yieldToMain();
          // Using standard capture since charts don't scroll
          const canvas = await html2canvas(element, {
            scale: PDF_SCALE,
            useCORS: true,
            backgroundColor: "#ffffff",
            logging: false,
            removeContainer: true,
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

      try {
        const ship = fleet.find((s) => s.id === shipId);
        const shipName = ship?.name || "Unknown_Vessel";

        // 1. Calculate the Period (Listing each month like: MAR, APR, MAY 2026)
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

        // 2. Get Today's Date for the Download Date (Right Corner)
        const downloadDate = new Date().toLocaleDateString("en-GB", {
          day: "2-digit",
          month: "short",
          year: "numeric",
        });

        const vesselPart = shipName.replace(/[^a-z0-9]/gi, "_");
        fileName = `${analysisMode.toLowerCase()}-${vesselPart}-${downloadDate.replace(/ /g, "_")}.pdf`;

        pdf = new jsPDF("p", "mm", "a4");
        const pageWidth = pdf.internal.pageSize.getWidth();
        const pageHeight = pdf.internal.pageSize.getHeight(); // Fixed variable
        const margin = 10;

        const drawHeader = (doc, yPos) => {
          // --- TOP RIGHT: Downloaded Date ---
          doc.setFontSize(8);
          doc.setFont("helvetica", "normal");
          doc.setTextColor(100, 100, 100);
          doc.text(
            `Downloaded: ${downloadDate}`,
            pageWidth - margin,
            yPos + 5,
            { align: "right" },
          );

          // --- TOP LEFT: Logo ---
          // try {
          //   doc.addImage(ozellarLogo, "PNG", margin, yPos + 3, 28, 12);
          // } catch (e) {}

          // --- CENTER: Titles & Period ---
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
        // ... rest of function

        // Draw First Header
        let currentY = drawHeader(pdf, margin);

        // =========================================================
        // PART A: DRAW SUMMARY TABLE (REPLACING SCREENSHOT)
        // =========================================================

        // 1. Table Title
        pdf.setFontSize(11);
        pdf.setFont("helvetica", "bold");
        pdf.text("1. Parameter Deviations vs Baseline", margin, currentY);
        currentY += 5;

        // 2. Prepare Data for AutoTable
        const headRow1 = [
          {
            content: "PARAMETER",
            rowSpan: 2,
            styles: {
              valign: "middle",
              halign: "center",
              fillColor: [241, 245, 249],
            },
          },
        ];
        const headRow2 = [];

        allMonthlyReports.forEach((r) => {
          headRow1.push({
            content: `${r.displayName}\n${r.report_date}`,
            colSpan: 3,
            styles: {
              halign: "center",
              fillColor: [241, 245, 249],
              fontStyle: "bold",
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

        // =========================================================
        // PART A: DRAW SUMMARY TABLE (PAGINATED 3 TOP / 3 BOTTOM)
        // =========================================================

        // 1. Setup Data Generators
        // =========================================================
        // PART A: DRAW SUMMARY TABLE (OPTIMIZED 6 PER PAGE)
        // =========================================================

        // 1. Setup Data Generators
        const isAux = analysisMode === "auxiliaryEngine";
        const metricMapping = isAux ? AUX_METRIC_MAPPING : MAIN_METRIC_MAPPING;
        // Filter out FOC for matrix view to save space
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

        const metricKeys = (isAux ? AUX_ORDER : MAIN_ORDER).filter((key) =>
          metricMapping.hasOwnProperty(key),
        );
        if (analysisMode === "mainEngine" && loadDiagramData?.propeller_curves)
          metricKeys.push("PropellerMarginRow");

        // Helper: Shorten names to prevent text-wrapping and save vertical space
        const getShortLabel = (key) => {
          const shortNames = {
            FIPI: "Fuel Pump Index",
            Turbospeed: "Turbo Speed",
            EngSpeed: "Engine Speed",
            ScavAir: "Scav Air Press.", // Shortened
            Pmax: "Pmax",
            Pcomp: "Pcomp",
            Exh_Cylinder_outlet: "Exh. Cyl. Out", // Shortened
            "Exh_T/C_inlet": "Exh. T/C In", // Shortened
            "Exh_T/C_outlet": "Exh. T/C Out", // Shortened
            SFOC: "SFOC",
            PropellerMarginRow: "Propeller Margin",
          };
          return shortNames[key] || key;
        };

        // Helper: Generate Table Data
        const generateTableData = (reportsSubset) => {
          // Header Row 1 (Report Names)
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
          // Header Row 2 (Sub-headers)
          const headRow2 = [];

          reportsSubset.forEach((r) => {
            // 1. Calculate Load and Power
            const lPct = isAux ? r.load_percentage : r.load;
            const pVal = isAux
              ? r.load_kw
              : r.effective_power_kw || r.shaft_power_kw;

            const loadStr = `@ ${safeFixed(lPct, 2)}% Load`;
            const pwrStr = pVal ? `(${safeFixed(pVal, 0)} kW)` : "";

            // 2. Format the Date (e.g., 2025-10-06)
            const shortDate = r.report_date ? r.report_date.split(" ")[0] : "";

            // 3. Build Header Cell
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

          // Table Body
          const body = metricKeys.map((key) => {
            const rowCells = [];

            // Parameter Column (First Col)
            let label = getShortLabel(key);
            let unit = getMetricUnit(key, isAux);
            let suffix = "";
            if (
              !isAux &&
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

            // Data Columns for Each Selected Report
            reportsSubset.forEach((report) => {
              let base = 0,
                val = 0,
                delta = 0,
                pct = 0;
              let color = [30, 41, 59]; // Default dark blue/grey

              if (key === "PropellerMarginRow") {
                // --- PROPELLER MARGIN CALCULATION (Matches UI) ---
                let rawMargin = report.propeller_margin_percent;
                let isRatio = false;

                if (rawMargin === undefined || rawMargin === null) {
                  const actualPower = report.shaft_power_kw || report.power_kw;
                  const actualRpm = report.EngSpeed || report.rpm;
                  const servicePower = interpolateLoadDiagramPower(
                    loadDiagramData?.propeller_curves || [],
                    actualRpm,
                    "power_service_kw",
                  );
                  if (actualPower && servicePower) {
                    rawMargin = (actualPower / servicePower) * 100;
                    isRatio = true;
                  }
                } else if (Math.abs(rawMargin) > 50) {
                  isRatio = true;
                }

                base = 100.0;
                val = isRatio ? rawMargin : 100.0 + rawMargin;
                delta = isRatio ? rawMargin - 100.0 : rawMargin;
                pct = delta;

                // Power Margin Color Coding
                if (pct > 5.0)
                  color = [220, 38, 38]; // Red
                else if (pct >= 0)
                  color = [202, 138, 4]; // Amber
                else color = [22, 163, 74]; // Green
              } else {
                // --- STANDARD METRIC CALCULATION (Pmax, SFOC, etc.) ---
                const xAxis = isAux ? "load_percentage" : "load";
                const reportLoad = isAux ? report.load_percentage : report.load;

                // 1. Interpolate baseline at this specific report's load
                base =
                  interpolateBaseline(baseline, reportLoad, key, xAxis) ?? 0;

                // 2. Get actual value from the report object
                val = report[key] || 0;

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

                  // Default Color: Green
                  color = [22, 163, 74];

                  if (key === "Turbospeed") {
                    // Turbo Speed: Absolute RPM Difference (Amber @ 500, Red @ 1000)
                    if (absDelta >= 1000) color = [220, 38, 38];
                    else if (absDelta >= 500) color = [202, 138, 4];
                  } else if (exhaustKeys.includes(key)) {
                    // Exhaust Temps: Absolute Degree Difference (Amber @ 40, Red @ 60)
                    if (absDelta > 60) color = [220, 38, 38];
                    else if (absDelta >= 40) color = [202, 138, 4];
                  } else {
                    // Grouped Percentage Logic
                    const groupA = ["Pmax", "Pcomp", "Turbospeed", "EngSpeed"];
                    const groupB = [
                      "FIPI",
                      "ScavAir",
                      "ScavAirPressure",
                      "SFOC",
                      "scav",
                      "scavair",
                      "fuel_index",
                    ];

                    if (groupA.includes(key)) {
                      if (absPct > 5.0) color = [220, 38, 38];
                      else if (absPct >= 3.0) color = [202, 138, 4];
                    } else if (groupB.includes(key)) {
                      if (absPct > 10.0) color = [220, 38, 38];
                      else if (absPct >= 5.0) color = [202, 138, 4];
                    }
                  }
                }
              }

              // Add the 3 cells (Shop, Act, Dev) for this report column
              // Add the 3 cells (Shop, Act, Dev) for this report column
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

        // 2. Pagination Logic (6 Reports Per Page -> Split 3 Top / 3 Bottom)
        const reportsPerPage = 6;
        const reportsPerBlock = 3;

        // Loop through all reports in chunks of 6 (Page Loop)
        for (let i = 0; i < allMonthlyReports.length; i += reportsPerPage) {
          const pageReports = allMonthlyReports.slice(i, i + reportsPerPage);

          // Add new page if this isn't the first batch
          if (i > 0) {
            pdf.addPage();
            currentY = drawHeader(pdf, margin);
          }

          // Split into Top Block (up to 3) and Bottom Block (up to 3)
          const topReports = pageReports.slice(0, reportsPerBlock);
          const bottomReports = pageReports.slice(
            reportsPerBlock,
            reportsPerBlock * 2,
          );

          // === DRAW TOP TABLE ===
          if (topReports.length > 0) {
            const { head, body } = generateTableData(topReports);
            autoTable(pdf, {
              startY: currentY,
              head: head,
              body: body,
              theme: "grid",
              // COMPACT STYLES: Font size 6, Padding 1.5
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
              // Widen the first column to prevent wrapping rows
              columnStyles: { 0: { cellWidth: 40 } },
              margin: { left: margin, right: margin },
            });
            currentY = pdf.lastAutoTable.finalY + 8; // Tighter gap (8mm instead of 10-15mm)
          }

          // === DRAW BOTTOM TABLE (on same page) ===
          if (bottomReports.length > 0) {
            // Safety check: if Top table was huge, add page (unlikely with 3 reports/6mm font)
            if (currentY > pageHeight - 80) {
              pdf.addPage();
              currentY = drawHeader(pdf, margin) + 5;
            }

            const { head, body } = generateTableData(bottomReports);
            autoTable(pdf, {
              startY: currentY,
              head: head,
              body: body,
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

        // Update Y position after table
        currentY = pdf.lastAutoTable.finalY + 15;

        // =========================================================
        // PART B: CAPTURE REMAINING CHARTS (YOUR ORIGINAL LOGIC)
        // =========================================================

        const capturedImages = [];
        let sectionIndex = 2; // We start at 2 because the Table is Section 1

        // 1. NEW: Capture Missing Parameters Alert (If visible)
        const missingCard = document.querySelector(".missing-parameters-card");
        if (missingCard) {
          const img = await captureElement(
            missingCard,
            `${sectionIndex}. Data Integrity: Missing Parameters in Report`,
          );
          if (img) {
            capturedImages.push(img);
            sectionIndex++;
          }
        }

        // 2. Capture Diagnosis Panel (If visible)
        // 2. Capture Diagnosis Panel
        // 2. Capture Diagnosis Panel (WITH AUTO-EXPAND FOR PDF)
        const diagnosisCard = document.querySelector(".diagnosis-card");
        if (diagnosisCard) {
          const scrollArea = diagnosisCard.querySelector(
            ".diagnosis-scroll-container",
          );

          // --- TEMPORARY UI UNLOCK ---
          // Save original styles to restore them later
          const originalMaxHeight = scrollArea?.style.maxHeight;
          const originalOverflow = scrollArea?.style.overflow;

          if (scrollArea) {
            // Remove the height limit and scrollbar so html2canvas sees everything
            scrollArea.style.maxHeight = "none";
            scrollArea.style.overflow = "visible";
          }

          const img = await captureElement(
            diagnosisCard,
            `Troubleshooting & Diagnosis Insights`,
          );

          // --- RESTORE UI TO SCROLLABLE ---
          if (scrollArea) {
            scrollArea.style.maxHeight = originalMaxHeight;
            scrollArea.style.overflow = originalOverflow;
          }

          if (img) {
            img.isDiagnosisPage = true;
            capturedImages.push(img);
            sectionIndex++;
          }
        }

        // 3. Capture Load Diagram
        const loadDiagram = document.querySelector(".load-diagram-card");
        if (analysisMode === "mainEngine" && loadDiagram) {
          const img = await captureElement(
            loadDiagram,
            `${sectionIndex}. Engine Load Diagram (SMCR Normalized)`,
          );
          if (img) {
            capturedImages.push(img);
            sectionIndex++;
          }
        }

        // 4. Capture Performance Charts
        const charts = document.querySelectorAll(
          ".charts-grid-enhanced .chart-card",
        );
        for (const chart of charts) {
          const title =
            chart.querySelector(".card-title-enhanced")?.textContent || "Chart";
          const isCenter = [
            "SFOC",
            "Pmax",
            "Scavenge",
            "EngSpeed",
            "Turbospeed",
          ].some((k) => title.toLowerCase().includes(k.toLowerCase()));
          const img = await captureElement(
            chart,
            `${sectionIndex}. ${title}`,
            isCenter,
          );
          if (img) {
            capturedImages.push(img);
            sectionIndex++;
          }
        }

        // 5. Capture History Table
        const historyTable = document.querySelector(".history-table-card");
        if (historyTable) {
          let tableTitle =
            analysisMode === "mainEngine"
              ? `${sectionIndex}. ME Historical Deviation`
              : `${sectionIndex}. AE Historical Deviation`;
          const img = await captureElement(historyTable, tableTitle);
          if (img) capturedImages.push(img);
        }

        // =========================================================
        // PART C: ADD IMAGES TO PDF (YOUR ORIGINAL LOGIC)
        // =========================================================

        // =========================================================
        // PART C: ADD IMAGES TO PDF (WITH FORCED DIAGNOSIS PAGE)
        // =========================================================

        for (const imgDataObj of capturedImages) {
          const { imgData, width, height, title, center, isDiagnosisPage } =
            imgDataObj;

          // CALCULATE DIMENSIONS
          const imgWidth =
            center || isDiagnosisPage
              ? pageWidth - margin * 2
              : pageWidth - margin * 2;
          const imgX = margin;
          const imgHeight = (height * imgWidth) / width;
          const sectionHeight = imgHeight + 25;

          // --- PROFESSIONAL FIX: FORCE NEW PAGE FOR DIAGNOSIS ---
          if (isDiagnosisPage) {
            pdf.addPage();
            currentY = drawHeader(pdf, margin);

            // Add a specialized "Findings" Header
            pdf.setFillColor(255, 247, 237); // Light orange bg like your UI
            pdf.rect(margin, currentY, pageWidth - margin * 2, 10, "F");
            pdf.setFont("helvetica", "bold");
            pdf.setFontSize(12);
            pdf.setTextColor(154, 52, 18); // Dark orange text
            pdf.text(
              `SECTION ${sectionIndex - capturedImages.length + 1}: ${title.toUpperCase()}`,
              margin + 2,
              currentY + 7,
            );

            currentY += 15;
          }
          // --- STANDARD PAGE BREAK CHECK FOR OTHER CHARTS ---
          else if (currentY + sectionHeight > pageHeight - 10) {
            pdf.addPage();
            currentY = drawHeader(pdf, margin);

            pdf.setFont("helvetica", "bold");
            pdf.setFontSize(11);
            pdf.setTextColor(0, 0, 0);
            pdf.text(title, margin, currentY);
            currentY += 6;
          } else {
            pdf.setFont("helvetica", "bold");
            pdf.setFontSize(11);
            pdf.setTextColor(0, 0, 0);
            pdf.text(title, margin, currentY);
            currentY += 6;
          }

          // Add the Image
          pdf.addImage(
            imgData,
            "JPEG",
            imgX,
            currentY,
            imgWidth,
            imgHeight,
            undefined,
            "FAST",
          );

          currentY += imgHeight + 18;
        }

        // =========================================================
        // PART D: SAVE / UPLOAD (YOUR ORIGINAL LOGIC)
        // =========================================================
        if (mode === "local") {
          pdf.save(fileName);
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

    // --- CRITICAL FIX: RESET ALL ANALYSIS STATES IMMEDIATELY ---
    // This prevents AE2 data from staying on screen while AE3 is loading.
    setBaseline({});
    setLoadDiagramData(null);
    setMeDeviationHistory([]);
    setAeDeviationHistory([]);
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

    // 2. Check if the selected data is ALREADY visible
    // We compare what is currently shown (displayedReportIds) vs what is selected
    const isDataReady =
      showReport &&
      displayedReportIds.length > 0 &&
      selectedReportIds.length === displayedReportIds.length &&
      selectedReportIds.every((id) => displayedReportIds.includes(id));

    if (isDataReady) {
      // Scenario A: Data is already there. Just download.
      downloadPDF("local");
    } else {
      // Scenario B: Data is NOT there. Load it, then trigger download.
      setBaseline({});
      handleViewReport(); // This fetches API and sets showReport(true)
      setTriggerLocalDownload(true); // This tells the new useEffect to wait & download
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
    <div className="performance-container">
      <div className="performance-header">
        <h1 className="performance-title">Performance Analysis</h1>
        <p className="performance-subtitle">
          {analysisMode === "mainEngine"
            ? "Main Engine performance analysis"
            : analysisMode === "auxiliaryEngine"
              ? "Auxiliary Engine  performance analysis"
              : "Lube Oil Analysis - Coming Soon"}
        </p>

        {/* --- START OF NEW 3-CARD LAYOUT --- */}
        {/* --- START OF NEW MASTER CONTROL CARD --- */}
        {/* --- PERFORMANCE CONTROL CONSOLE --- */}
        <div
          style={{
            display: "flex",
            flexDirection: "column",
            gap: "12px",
            marginBottom: "32px",
            width: "100%",
          }}
        >
          {/* --- UNIFIED CONTROL PANEL (Your Preferred Layout) --- */}
          <div
            style={{
              display: "flex",
              flexDirection: "row",
              alignItems: "flex-end",
              gap: "12px",
              background: "white",
              padding: "16px 20px",
              borderRadius: "12px",
              border: "1px solid #e2e8f0",
              boxShadow: "0 4px 6px -1px rgba(0, 0, 0, 0.05)",
              width: "100%",
              boxSizing: "border-box",
              flexWrap: "wrap",
            }}
          >
            {/* 1. Vessel Selector */}
            <div
              style={{
                display: "flex",
                flexDirection: "column",
                gap: "6px",
                flex: "1",
                minWidth: "180px",
              }}
            >
              <label
                style={{
                  fontSize: "0.65rem",
                  fontWeight: "800",
                  color: "#64748b",
                  textTransform: "uppercase",
                  letterSpacing: "0.05em",
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

            {/* 2. Engine Type Selector */}
            <div
              style={{
                display: "flex",
                flexDirection: "column",
                gap: "6px",
                width: "150px",
              }}
            >
              <label
                style={{
                  fontSize: "0.65rem",
                  fontWeight: "800",
                  color: "#64748b",
                  textTransform: "uppercase",
                  letterSpacing: "0.05em",
                }}
              >
                Engine Type
              </label>
              <SingleSelectDropdown
                value={analysisMode}
                disabled={!shipId}
                onChange={(val) => {
                  setAnalysisMode(val);
                  setUploadMode(val); // Logic: Keep sync logic
                }}
                options={[
                  { value: "mainEngine", label: "Main Engine" },
                  { value: "auxiliaryEngine", label: "Aux Engine" },
                ]}
              />
            </div>

            {/* 3. Unit Selector (FIXED: Restored loading-aware disabled logic) */}
            {analysisMode === "auxiliaryEngine" && (
              <div
                style={{
                  display: "flex",
                  flexDirection: "column",
                  gap: "6px",
                  width: "180px",
                }}
              >
                <label
                  style={{
                    fontSize: "0.65rem",
                    fontWeight: "800",
                    color: "#64748b",
                    textTransform: "uppercase",
                    letterSpacing: "0.05em",
                  }}
                >
                  Unit
                </label>
                <SingleSelectDropdown
                  value={selectedGeneratorId}
                  disabled={!shipId || (loading && generators.length === 0)} // Fixed Logic Point 1
                  onChange={(val) => {
                    const id = Number(val);
                    setSelectedGeneratorId(id);
                    setDownloadGenId(id);
                  }}
                  placeholder="Select Unit"
                  options={generators.map((gen) => ({
                    value: gen.generator_id,
                    label:
                      gen.designation ||
                      gen.generator_designation ||
                      `Aux Engine No.${gen.generator_id}`,
                  }))}
                />
              </div>
            )}

            {/* 4. MODE TOGGLE */}
            <div
              style={{ display: "flex", flexDirection: "column", gap: "6px" }}
            >
              <label
                style={{
                  fontSize: "0.65rem",
                  fontWeight: "800",
                  color: "transparent",
                  textTransform: "uppercase",
                }}
              >
                Mode
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
                  onClick={() => setActiveTab("view")}
                  style={{
                    padding: "0 14px",
                    borderRadius: "6px",
                    fontSize: "0.75rem",
                    fontWeight: "800",
                    border: "none",
                    cursor: "pointer",
                    backgroundColor:
                      activeTab === "view" ? "white" : "transparent",
                    color: activeTab === "view" ? "#0f172a" : "#94a3b8",
                    boxShadow:
                      activeTab === "view"
                        ? "0 2px 4px rgba(0,0,0,0.1)"
                        : "none",
                    transition: "all 0.2s",
                  }}
                >
                  VIEW
                </button>
                <button
                  onClick={() => setActiveTab("upload")}
                  style={{
                    padding: "0 14px",
                    borderRadius: "6px",
                    fontSize: "0.75rem",
                    fontWeight: "800",
                    border: "none",
                    cursor: "pointer",
                    backgroundColor:
                      activeTab === "upload" ? "white" : "transparent",
                    color: activeTab === "upload" ? "#0f172a" : "#94a3b8",
                    boxShadow:
                      activeTab === "upload"
                        ? "0 2px 4px rgba(0,0,0,0.1)"
                        : "none",
                    transition: "all 0.2s",
                  }}
                >
                  UPLOAD
                </button>
              </div>
            </div>

            {/* 5. DYNAMIC DROPDOWN (FIXED: Restored "Loading reports..." label) */}
            <div
              style={{
                display: "flex",
                flexDirection: "column",
                gap: "6px",
                flex: "2",
                minWidth: "250px",
              }}
            >
              <label
                style={{
                  fontSize: "0.65rem",
                  fontWeight: "800",
                  color: "#64748b",
                  textTransform: "uppercase",
                  letterSpacing: "0.05em",
                }}
              >
                {activeTab === "view"
                  ? "Select Reports to Analyze"
                  : "Download Original Uploaded PDFs"}
              </label>
              {activeTab === "view" ? (
                <MultiSelectDropdown
                  label="Select Reports"
                  options={availableReports}
                  selectedIds={selectedReportIds}
                  onChange={(ids) => setSelectedReportIds(ids)}
                />
              ) : (
                <div style={{ display: "flex", gap: "8px" }}>
                  <div style={{ flex: 1 }}>
                    <MultiSelectDropdown
                      label={
                        downloadableReports.length > 0
                          ? "Select Files for ZIP"
                          : "Loading reports..."
                      } // Fixed Logic Point 4
                      options={downloadableReports}
                      selectedIds={selectedRawDownloadIds}
                      onChange={(ids) => setSelectedRawDownloadIds(ids)}
                    />
                  </div>
                  <Button
                    variant="outline"
                    onClick={handleBatchRawDownload}
                    disabled={selectedRawDownloadIds.length === 0}
                    style={{ height: "42px", padding: "0 12px" }}
                  >
                    <Download size={18} />
                  </Button>
                </div>
              )}
            </div>

            {/* 6. ACTION BUTTONS */}
            <div style={{ display: "flex", gap: "8px" }}>
              {activeTab === "view" ? (
                <>
                  <Button
                    onClick={handleViewReport}
                    disabled={
                      !shipId ||
                      loading ||
                      selectedReportIds.length === 0 ||
                      (isAux && !selectedGeneratorId)
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
                    ANALYZE
                  </Button>
                  <Button
                    variant="secondary"
                    onClick={handleDirectDownloadClick}
                    disabled={isGeneratingPDF || selectedReportIds.length === 0}
                    style={{
                      height: "42px",
                      padding: "0 15px",
                      display: "flex",
                      alignItems: "center",
                    }}
                  >
                    {isGeneratingPDF ? "..." : <Download size={18} />}
                  </Button>
                </>
              ) : (
                <>
                  <input
                    type="file"
                    accept=".pdf"
                    id="file-upload-input"
                    style={{ display: "none" }}
                    onChange={handleFileUpload}
                  />
                  <Button
                    onClick={() =>
                      document.getElementById("file-upload-input").click()
                    }
                    disabled={!shipId || (isAux && !selectedGeneratorId)}
                    style={{
                      backgroundColor: "#0369a1",
                      color: "white",
                      height: "42px",
                      padding: "0 20px",
                      fontWeight: "800",
                      whiteSpace: "nowrap",
                    }}
                  >
                    UPLOAD PDF
                  </Button>
                </>
              )}
            </div>
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
              <div
                style={{ display: "flex", alignItems: "center", gap: "12px" }}
              >
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
      </div>

      {showReport && (
        <>
          {renderMissingAlert()}
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
                        tickFormatter={(v) => (isAux ? v.toFixed(1) : `${v}%`)}
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
        </>
      )}
      {isGeneratingPDF && (
        <div className="pdf-loading-overlay">
          <div className="pdf-spinner"></div>
          <div className="pdf-loading-text">Generating Report PDF...</div>
          <div
            style={{ color: "#64748b", fontSize: "0.9rem", marginTop: "8px" }}
          >
            Please wait while we format your charts
          </div>
        </div>
      )}
    </div>
  );
}

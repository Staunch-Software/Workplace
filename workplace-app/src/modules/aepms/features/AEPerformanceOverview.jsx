import React, { useEffect, useState, useMemo, useRef } from "react";
import { createPortal } from "react-dom";
import axiosAepms from '../api/axiosAepms';
import {
  Wrench,
  Clock,
  Activity,
  Cpu,
  ChevronLeft,
  ChevronRight,
  ChevronUp,
  ChevronDown,
  Download,
  Eye,
  X,
  Loader2,
  FileText,
  ArrowDownCircle,
} from "lucide-react";
import "../styles/AEPerformanceOverview.css";
import "../styles/Aeresponsiveness.css";

import jsPDF from "jspdf";
import autoTable from "jspdf-autotable";
// import ozellarLogo from "../assets/250714_OzellarMarine-Logo-Final.png";
import PerformanceNav from "./PerformanceNav";

// --- CONSTANTS ---
const AE_STANDARD_PARAMS = [
  { key: "pmax_graph_bar", label: "Pmax" },
  { key: "compression_pressure_bar", label: "Pcomp" },
  { key: "scav_air_pressure_bar", label: "ScavAir" },
  { key: "turbocharger_speed_rpm", label: "TurboSpeed" },
  { key: "engine_speed_rpm", label: "EngSpeed" },
  { key: "exh_temp_tc_inlet_graph_c", label: "Exh T/C In" },
  { key: "exh_temp_tc_outlet_graph_c", label: "Exh T/C Out" },
  { key: "exh_temp_cyl_outlet_avg_graph_c", label: "Exh Cyl Out" },
  { key: "fuel_pump_index_graph", label: "Fuel Index" },
  { key: "sfoc_graph_g_kwh", label: "SFOC" },
  { key: "load_kw", label: "Load (kW)" },
];

const AE_HISTORY_PARAMS = [
  { key: "pmax_bar", label: "Pmax", unit: "Bar" },
  { key: "fuel_pump_index_graph", label: "Fuel Index", unit: "mm" },
  { key: "scav_air_pressure_bar", label: "Scav Air", unit: "Bar" },
  { key: "exh_temp_tc_inlet_graph_c", label: "TC Inlet", unit: "°C" },
  { key: "exh_temp_tc_outlet_graph_c", label: "TC Outlet", unit: "°C" },
  { key: "exh_temp_cyl_outlet_avg_graph_c", label: "TC Cyl Out", unit: "°C" },
];

const safeFixed = (val, digits = 2) => {
  if (val === null || val === undefined || isNaN(val)) return "N/A";
  return Number(val).toFixed(digits);
};

const formatVesselDisplayName = (name) => {
  if (!name) return "";
  return name.toUpperCase().trim();
};

const formatDate = (dateString) => {
  if (!dateString) return "-";
  try {
    return new Date(dateString).toLocaleDateString("en-GB", {
      day: "numeric",
      month: "short",
      year: "numeric",
    });
  } catch {
    return dateString;
  }
};

// --- Custom Hook ---
const useAEPerformanceData = () => {
  const [loading, setLoading] = useState(true);
  const [runningHoursData, setRunningHoursData] = useState([]);
  const [loadHistoryData, setLoadHistoryData] = useState([]);
  const [statusHistoryData, setStatusHistoryData] = useState({});
  const [error, setError] = useState(null);

  useEffect(() => {
    const fetchData = async () => {
      try {
        setLoading(true);
        setError(null);
        const perfResponse = await axiosAepms.getAEPerformanceOverview();
        setRunningHoursData(perfResponse.running_hours_data || []);
        setLoadHistoryData(perfResponse.load_history_data || []);
        setStatusHistoryData(perfResponse.status_history_data || {});
      } catch (err) {
        console.error("Error fetching AE data:", err);
        setError(err.message);
      } finally {
        setLoading(false);
      }
    };
    fetchData();
  }, []);

  return {
    runningHoursData,
    loadHistoryData,
    statusHistoryData,
    loading,
    error,
  };
};

// --- MATH HELPERS ---
const interpolate = (targetX, points) => {
  if (!points || !Array.isArray(points) || points.length === 0) return null;
  const x = Number(targetX);
  const sorted = points
    .map((p) => [Number(p[0]), Number(p[1])])
    .sort((a, b) => a[0] - b[0]);
  if (x <= sorted[0][0]) return sorted[0][1];
  if (x >= sorted[sorted.length - 1][0]) return sorted[sorted.length - 1][1];
  for (let i = 0; i < sorted.length - 1; i++) {
    const [x1, y1] = sorted[i];
    const [x2, y2] = sorted[i + 1];
    if (x >= x1 && x <= x2) {
      if (x2 - x1 === 0) return y1;
      return y1 + ((x - x1) * (y2 - y1)) / (x2 - x1);
    }
  }
  return null;
};

const getDeviationStatus = (actual, baseline, paramKey = "") => {
  // 1. Only return normal if the ACTUAL data itself is missing
  if (actual === null || actual === undefined || isNaN(actual)) {
    return { dev: 0, delta: 0, status: "normal", colorClass: "text-gray-400" };
  }

  // 2. Treat baseline as 0 if null/undefined, but DO NOT exit if it is 0
  const base =
    baseline === null || baseline === undefined ? 0 : Number(baseline);

  // 3. Calculate absolute difference (Delta) - Essential for Temperatures
  const diff = actual - base;
  const absDiff = Math.abs(diff);

  // 4. Calculate percentage (Safe division to avoid Infinity)
  const devPercent = base === 0 ? 0 : (diff / base) * 100;
  const absDev = Math.abs(devPercent);

  let status = "normal";
  let colorClass = "text-emerald-600"; // Default Green
  const p = paramKey.toLowerCase();

  // --- 1. EXHAUST TEMPERATURE BUCKET (Absolute logic: 40°C / 60°C) ---
  const isExhaust =
    p.includes("temp") ||
    p.includes("exh") ||
    p.includes("tc in") ||
    p.includes("tc out") ||
    p.includes("cyl out");

  if (isExhaust) {
    // REPLICATE PERFORMANCE LOGIC:
    // Actual 490 - Baseline 0 = 490. 490 > 60.0 -> Critical.
    if (absDiff > 60.0) {
      status = "critical";
      colorClass = "text-red-600";
    } else if (absDiff >= 40.0) {
      status = "warning";
      colorClass = "text-amber-500";
    }
  }
  // --- 2. GROUP A & B BUCKET: Pressures, Index, SFOC ---
  else {
    // If baseline is 0 but we have an actual value, it's an anomaly
    if (base === 0 && actual > 0) {
      status = "critical";
      colorClass = "text-red-600";
    } else {
      const isGroupA =
        p.includes("pmax") ||
        p.includes("pcomp") ||
        p.includes("speed") ||
        p.includes("rpm") ||
        p.includes("turbo");

      if (isGroupA) {
        // STRICT % LOGIC: AMBER @ 3%, RED @ 5%
        if (absDev > 5.0) {
          status = "critical";
          colorClass = "text-red-600";
        } else if (absDev >= 3.0) {
          status = "warning";
          colorClass = "text-amber-500";
        }
      } else {
        // GROUP B BUCKET: FIPI, SFOC, Scav Air (5% / 10%)
        if (absDev > 10.0) {
          status = "critical";
          colorClass = "text-red-600";
        } else if (absDev >= 5.0) {
          status = "warning";
          colorClass = "text-amber-500";
        }
      }
    }
  }

  return { dev: devPercent, delta: diff, status, colorClass };
};

// --- MODAL COMPONENT ---
// --- UPDATED MODAL COMPONENT (STRICT FILTERING) ---
const PerformanceDetailsModal = ({
  isOpen,
  onClose,
  data,
  loading,
  onPdfAction,
}) => {
  if (!isOpen) return null;

  // --- 1. STRICT FILTER LOGIC ---
  const allRows = data?.rows || [];
  let displayedRows = allRows;

  // If Critical, show ONLY Critical rows.
  // If Warning, show ONLY Warning rows.
  // If Normal, show ALL rows (standard view).
  if (data?.status === "Critical") {
    displayedRows = allRows.filter((r) => r.status === "critical");
  } else if (data?.status === "Warning") {
    displayedRows = allRows.filter((r) => r.status === "warning");
  }

  // --- 2. STYLE HELPERS ---
  const getHeaderColor = () => {
    if (data?.status === "Critical")
      return { bg: "#fee2e2", text: "#991b1b", dot: "#ef4444" };
    if (data?.status === "Warning")
      return { bg: "#fef3c7", text: "#92400e", dot: "#f59e0b" };
    return { bg: "#d1fae5", text: "#065f46", dot: "#10b981" };
  };
  const headerStyle = getHeaderColor();

  const getRowStyle = (status) => {
    if (status === "critical")
      return {
        borderLeft: "4px solid #ef4444",
        bg: "#fef2f2",
        text: "#b91c1c",
        fontWeight: "700",
      };
    if (status === "warning")
      return {
        borderLeft: "4px solid #f59e0b",
        bg: "#fffbeb",
        text: "#b45309",
        fontWeight: "700",
      };
    return {
      borderLeft: "4px solid transparent",
      bg: "#ffffff",
      text: "#374151",
      fontWeight: "400",
    };
  };

  const safeFixed = (val, n = 2) =>
    val !== null && val !== undefined && !isNaN(val)
      ? Number(val).toFixed(n)
      : "-";

  return createPortal(
    <div className="perf-modal-overlay" onClick={onClose}>
      <div
        className="perf-modal-container"
        onClick={(e) => e.stopPropagation()}
        style={{ maxWidth: "850px", borderRadius: "12px", overflow: "hidden" }}
      >
        {/* --- HEADER --- */}
        <div
          className="perf-modal-header"
          style={{
            borderBottom: "1px solid #e5e7eb",
            padding: "16px 24px",
            background: "#fff",
          }}
        >
          <div>
            <h2
              className="perf-modal-title"
              style={{ fontSize: "1.25rem", marginBottom: "4px" }}
            >
              {data?.vessel_name || "Vessel Report"}
              {data?.generator_name && (
                <span style={{ color: "#6b7280", fontWeight: "400" }}>
                  {" "}
                  — {data.generator_name}
                </span>
              )}
            </h2>
            <div
              style={{
                fontSize: "0.85rem",
                color: "#6b7280",
                display: "flex",
                gap: "12px",
              }}
            >
              <span>📅 {formatDate(data?.report_date)}</span>
              <span>⚡ Load: {safeFixed(data?.load_pct, 1)}%</span>
            </div>
          </div>

          <div style={{ display: "flex", alignItems: "center", gap: "16px" }}>
            {/* Status Badge */}
            <div
              style={{
                backgroundColor: headerStyle.bg,
                color: headerStyle.text,
                padding: "6px 12px",
                borderRadius: "20px",
                fontSize: "0.85rem",
                fontWeight: "700",
                display: "flex",
                alignItems: "center",
                gap: "6px",
                border: `1px solid ${headerStyle.bg}`.replace("0.1", "0.3"),
              }}
            >
              <span
                style={{
                  width: "8px",
                  height: "8px",
                  borderRadius: "50%",
                  backgroundColor: headerStyle.dot,
                }}
              ></span>
              {data?.status?.toUpperCase() || "NORMAL"}
            </div>

            <button
              className="perf-close-btn"
              onClick={onClose}
              style={{
                background: "#f3f4f6",
                padding: "8px",
                borderRadius: "50%",
              }}
            >
              <X size={20} color="#4b5563" />
            </button>
          </div>
        </div>

        {/* --- BODY --- */}
        <div
          className="perf-modal-body"
          style={{
            padding: "0",
            maxHeight: "60vh",
            overflowY: "auto",
            background: "#f9fafb",
          }}
        >
          {loading ? (
            <div
              style={{
                height: "200px",
                display: "flex",
                justifyContent: "center",
                alignItems: "center",
              }}
            >
              <Loader2 className="animate-spin" size={32} color="#3b82f6" />
            </div>
          ) : (
            <table
              className="perf-modal-table"
              style={{ width: "100%", borderCollapse: "collapse" }}
            >
              <thead
                style={{
                  position: "sticky",
                  top: 0,
                  zIndex: 10,
                  boxShadow: "0 1px 2px rgba(0,0,0,0.05)",
                }}
              >
                <tr
                  style={{
                    background: "#f3f4f6",
                    color: "#64748b",
                    fontSize: "0.75rem",
                    textTransform: "uppercase",
                    letterSpacing: "0.05em",
                  }}
                >
                  <th style={{ padding: "12px 24px", textAlign: "left" }}>
                    Parameter
                  </th>
                  <th style={{ padding: "12px 24px", textAlign: "right" }}>
                    Baseline
                  </th>
                  <th style={{ padding: "12px 24px", textAlign: "right" }}>
                    Actual
                  </th>
                  <th style={{ padding: "12px 24px", textAlign: "right" }}>
                    Δ (Diff)
                  </th>
                  <th style={{ padding: "12px 24px", textAlign: "right" }}>
                    Dev %
                  </th>
                </tr>
              </thead>
              <tbody>
                {displayedRows.length > 0 ? (
                  displayedRows.map((row, index) => {
                    const style = getRowStyle(row.status);
                    const diffSign = row.delta > 0 ? "+" : "";
                    const pctSign = row.dev > 0 ? "+" : "";

                    return (
                      <tr
                        key={index}
                        style={{
                          backgroundColor: style.bg,
                          borderBottom: "1px solid #e5e7eb",
                        }}
                      >
                        <td
                          style={{
                            padding: "12px 24px",
                            borderLeft: style.borderLeft,
                            color: "#1f2937",
                            fontWeight: "600",
                            textAlign: "left",
                          }}
                        >
                          {row.label}
                          {row.unit && (
                            <span
                              style={{
                                color: "#9ca3af",
                                fontWeight: "400",
                                fontSize: "0.75rem",
                                marginLeft: "6px",
                              }}
                            >
                              ({row.unit})
                            </span>
                          )}
                        </td>
                        <td
                          style={{
                            padding: "12px 24px",
                            textAlign: "right",
                            color: "#6b7280",
                            fontFamily: "monospace",
                          }}
                        >
                          {safeFixed(row.baseline)}
                        </td>
                        <td
                          style={{
                            padding: "12px 24px",
                            textAlign: "right",
                            fontWeight: "700",
                            fontFamily: "monospace",
                          }}
                        >
                          {safeFixed(row.actual)}
                        </td>
                        <td
                          style={{
                            padding: "12px 24px",
                            textAlign: "right",
                            color: style.text,
                            fontWeight: "700",
                            fontFamily: "monospace",
                          }}
                        >
                          {diffSign}
                          {safeFixed(row.delta)}
                        </td>
                        <td
                          style={{
                            padding: "12px 24px",
                            textAlign: "right",
                            color: style.text,
                            fontWeight: "700",
                            fontFamily: "monospace",
                          }}
                        >
                          {pctSign}
                          {safeFixed(row.dev, 1)}%
                        </td>
                      </tr>
                    );
                  })
                ) : (
                  <tr>
                    <td
                      colSpan="5"
                      style={{
                        padding: "40px",
                        textAlign: "center",
                        color: "#9ca3af",
                      }}
                    >
                      No {data?.status} parameters found.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          )}
        </div>

        {/* --- FOOTER --- */}
        <div
          className="perf-modal-footer"
          style={{
            padding: "12px 24px",
            background: "#fff",
            borderTop: "1px solid #e5e7eb",
            display: "flex",
            justifyContent: "flex-end",
            alignItems: "center",
          }}
        >
          {/* PDF ACTIONS */}
          <div style={{ display: "flex", gap: "12px" }}>
            {/* <button className="pdf-preview-btn" onClick={() => onPdfAction("preview")}>
              <FileText size={16} /> Preview PDF
            </button> */}
            <button
              className="pdf-download-btn"
              onClick={() => onPdfAction("download")}
            >
              <Download size={16} /> Export PDF
            </button>
          </div>
        </div>
      </div>
    </div>,
    document.body,
  );
};

// --- DATA NORMALIZATION ---
const normalizeDesignation = (designation) => {
  if (!designation) return null;
  const upper = designation.toUpperCase().trim();
  if (upper.includes("1")) return "AE1";
  if (upper.includes("2")) return "AE2";
  if (upper.includes("3")) return "AE3";
  return null;
};

// --- MAIN PAGE COMPONENT ---
export default function AEPerformanceOverview({ embeddedMode = false, externalVesselId = "" }) {
  const {
    runningHoursData,
    loadHistoryData,
    statusHistoryData,
    loading,
    error,
  } = useAEPerformanceData();
  const totalGeneratorsReported = runningHoursData.length;
  const GENS = ["AE1", "AE2", "AE3"];
  const [viewOffset, setViewOffset] = useState(0);
  const [isSectionOpen, setIsSectionOpen] = useState(true);
  const [isLoadOpen, setIsLoadOpen] = useState(true);
  const [daysSortConfig, setDaysSortConfig] = useState({
    key: "vessel_name",
    direction: "asc",
  });
  const [modalDetails, setModalDetails] = useState(null);
  const [detailsLoading, setDetailsLoading] = useState(false);
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [isDownloading, setIsDownloading] = useState(false);
  const [selectedVesselDetails, setSelectedVesselDetails] = useState(null); // NEW
  const [isDetailLoading, setIsDetailLoading] = useState(false); // NEW
  const aeDaysCardRef = useRef(null);
  const aeTableWrapperRef = useRef(null);
  const detailsSectionRef = useRef(null); // NEW
  const [hoveredStatusDot, setHoveredStatusDot] = useState(null);
  const [selectedVesselsFilter, setSelectedVesselsFilter] = useState([]);
  const [isVesselDropdownOpen, setIsVesselDropdownOpen] = useState(false);
  const vesselDropdownRef = useRef(null);
  // ── Responsive visible month count ──
  // ── Responsive visible month count ──
  const getVisibleMonthCount = () => {
    const w = window.innerWidth;
    if (w <= 480)  return 3;
    if (w <= 768)  return 3;
    if (w <= 1024) return 5;
    if (w <= 1250) return 10;
    return 12; // Displays 12 months perfectly on 1440px and higher
  };

  // Initialize state
  const [visibleMonthCount, setVisibleMonthCount] = useState(12);

  useEffect(() => {
    // 1. Set correct count on initial mount
    setVisibleMonthCount(getVisibleMonthCount());

    // 2. Adjust count smoothly on window resize
    const handleResize = () => {
      const newCount = getVisibleMonthCount();
      setVisibleMonthCount(prev => {
        if (prev !== newCount) {
          setViewOffset(0); // Reset navigation when columns change
          return newCount;
        }
        return prev;
      });
    };

    window.addEventListener("resize", handleResize);
    return () => window.removeEventListener("resize", handleResize);
  }, []);
 
  // ── On resize: update count AND reset offset when count changes ─────────────
  useEffect(() => {
    const handleResize = () => {
      const newCount = getVisibleMonthCount();
      setVisibleMonthCount(prev => {
        if (prev !== newCount) {
          setViewOffset(0); // reset scroll position when column count changes
        }
        return newCount;
      });
    };
    window.addEventListener("resize", handleResize);
    return () => window.removeEventListener("resize", handleResize);
  }, []);
  const maxOffset = useMemo(() => {
    const today = new Date();
    const startYear = 2025;
    const startMonth = 0; // January

    // Total months from Jan 2025 to Today
    const totalMonthsSinceStart =
      (today.getFullYear() - startYear) * 12 + today.getMonth();

    // Stop scrolling when Jan 2025 is the 12th column (matching ME logic)
    return Math.max(0, totalMonthsSinceStart - (visibleMonthCount - 1));
  }, [visibleMonthCount]);

  useEffect(() => {
    const handleClickOutside = (event) => {
      if (
        vesselDropdownRef.current &&
        !vesselDropdownRef.current.contains(event.target)
      ) {
        setIsVesselDropdownOpen(false);
      }
    };
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);
  useEffect(() => {
  if (aeDaysCardRef.current) {
    setTimeout(() => {
      aeDaysCardRef.current.scrollIntoView({
        behavior: "smooth",
        block: "start",
      });
    }, 150);
  }
}, [isSectionOpen, selectedVesselsFilter]);

const groupedRunningHours = useMemo(() => {
    const grouped = {};
    runningHoursData.forEach((item) => {
      const vessel = item.vessel_name;
      const imo = item.imo_number;
      const d = normalizeDesignation(item.generator_designation);
      if (!d) return;
      if (!grouped[vessel])
        grouped[vessel] = { vessel_name: vessel, imo_number: imo };
      grouped[vessel][d] = item;
    });
    return Object.values(grouped).sort((a, b) =>
      a.vessel_name.localeCompare(b.vessel_name),
    );
  }, [runningHoursData]);

useEffect(() => {
  if (externalVesselId && groupedRunningHours.length > 0) {
    // Find the vessel object that matches the master console's ID
    const vessel = groupedRunningHours.find(v => String(v.imo_number) === String(externalVesselId));
    
    if (vessel) {
      setSelectedVesselsFilter([vessel]); // Auto-select the vessel
      setIsSectionOpen(true);            // Auto-expand the table
    }
  } else if (!externalVesselId) {
    setSelectedVesselsFilter([]);       // Clear filter if console is cleared
  }
}, [externalVesselId, groupedRunningHours]);

// Re-apply vessel filter if cleared externally (e.g. ME↔AE mode switch)
useEffect(() => {
  if (
    externalVesselId &&
    groupedRunningHours.length > 0 &&
    selectedVesselsFilter.length === 0
  ) {
    const vessel = groupedRunningHours.find(
      (v) => String(v.imo_number) === String(externalVesselId)
    );
    if (vessel) {
      setSelectedVesselsFilter([vessel]);
      setIsSectionOpen(true);
    }
  }
}, [selectedVesselsFilter.length, externalVesselId, groupedRunningHours]);

  // --- Generate 12 Months ---
  const visibleMonths = useMemo(() => {
    const months = [];
    const today = new Date();

    for (let i = viewOffset; i < viewOffset + visibleMonthCount; i++) {
      const d = new Date(today.getFullYear(), today.getMonth() - i, 1);

      // 🔥 STOP generating months if we hit 2024
      if (d.getFullYear() < 2025) break;

      months.push({
        label: d
          .toLocaleDateString("en-GB", { month: "short", year: "2-digit" })
          .toUpperCase(),
        key: `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`,
      });
    }
    return months;
  }, [viewOffset, visibleMonthCount]);

  // --- HANDLER: Expand Detailed History Section ---
  const handleVesselHistoryClick = async (vesselName, filterGen = null) => {
    window.scrollTo({ top: 0, behavior: "smooth" });
    setIsDetailLoading(true);

    // --- 1. NORMALIZATION HELPER (Preserved) ---
    const normalize = (name) => {
      if (!name) return "";
      return name
        .toString()
        .toUpperCase()
        .replace(/^(MV|M\.V\.|M\/V|M\.V)\s*/, "")
        .trim();
    };

    const targetNameNormalized = normalize(vesselName);

    // Initialize section with loading state (Preserved)
    setSelectedVesselDetails({
      name: vesselName,
      reports: [],
      loading: true,
      filter: filterGen || "All Generators",
    });

    // Smooth scroll to the bottom section (Preserved)
    setTimeout(() => {
      if (detailsSectionRef.current) {
        detailsSectionRef.current.scrollIntoView({
          behavior: "smooth",
          block: "start",
        });
      }
    }, 100);

    try {
      // 2. Extract relevant reports from statusHistoryData (Preserved logic for nested structures)
      let relevantReports = [];

      const extractReports = (item) => {
        if (!item) return;

        const itemVesselNormalized = normalize(item.vessel_name);

        if (itemVesselNormalized === targetNameNormalized) {
          const gen = normalizeDesignation(
            item.generator_designation || item.generator_name,
          );
          if (filterGen && gen !== filterGen) return;
          if (gen) relevantReports.push(item);
        }
      };

      if (Array.isArray(statusHistoryData)) {
        statusHistoryData.forEach(extractReports);
      } else if (
        typeof statusHistoryData === "object" &&
        statusHistoryData !== null
      ) {
        Object.values(statusHistoryData).forEach((group) => {
          if (Array.isArray(group)) {
            group.forEach(extractReports);
          } else if (typeof group === "object" && group !== null) {
            Object.values(group).forEach((sub) => {
              if (Array.isArray(sub)) sub.forEach(extractReports);
            });
          }
        });
      }

      // --- 3. FILTER BY LAST 6 MONTHS & REMOVE DUPLICATES (Updated Logic) ---

      // Calculate cutoff date (Today minus 6 months)
      const cutoffDate = new Date();
      cutoffDate.setMonth(cutoffDate.getMonth() - 6);

      // Remove duplicates based on ID first
      const uniqueReports = Array.from(
        new Map(relevantReports.map((r) => [r.report_id || r.id, r])).values(),
      );

      // Filter to only include reports >= cutoffDate, then Sort newest first
      const filteredReports = uniqueReports
        .filter((r) => {
          if (!r.report_date) return false;
          const reportDate = new Date(r.report_date);
          return reportDate >= cutoffDate;
        })
        .sort((a, b) => new Date(b.report_date) - new Date(a.report_date));

      // Optional: limit to 20 for performance if there are many reports in those 6 months
      const topReports = filteredReports.slice(0, 20);

      // --- 4. FETCH FULL DETAILS (Preserved logic for curves/deviations) ---
      const detailedPromises = topReports.map(async (r) => {
        try {
          const reportId = r.report_id || r.id;
          const detailsRes = await axiosAepms.getAEReportDetails(reportId);
          // Merge summary data with detailed curve data
          return { ...r, ...detailsRes.report, curves: detailsRes.curves };
        } catch (e) {
          console.warn(
            `Failed to fetch extra details for report ${r.report_id}`,
            e,
          );
          return r;
        }
      });

      const fullData = await Promise.all(detailedPromises);

      setSelectedVesselDetails({
        name: vesselName,
        filter: filterGen || "All Generators",
        reports: fullData,
        loading: false,
      });
      setTimeout(() => {
        if (detailsSectionRef.current) {
          detailsSectionRef.current.scrollIntoView({
            behavior: "smooth",
            block: "start",
          });
        }
      }, 300);          
    } catch (err) {
      console.error("Failed to load details", err);
    } finally {
      setIsDetailLoading(false);
    }
  };

  const mappedStatusHistory = useMemo(() => {
    const map = {};
    const processItem = (item) => {
      if (!item || !item.vessel_name || !item.report_date) return;
      const vName = item.vessel_name.trim().toUpperCase();
      const gen = normalizeDesignation(item.generator_designation);
      let dateKey = "";
      try {
        const d = new Date(item.report_date);
        const year = d.getFullYear();
        const month = String(d.getMonth() + 1).padStart(2, "0");
        dateKey = `${year}-${month}`;
      } catch (e) {
        return;
      }
      if (!gen || !dateKey) return;
      if (!map[vName]) map[vName] = {};
      if (!map[vName][gen]) map[vName][gen] = {};

      // 1. Initialize as array if not exists
      if (!map[vName][gen][dateKey]) {
        map[vName][gen][dateKey] = [];
      }

      // 2. Push report to array
      map[vName][gen][dateKey].push({
        status: item.status,
        report_id: item.report_id || item.id,
        counts: item.alert_counts || item.counts,
        report_date: item.report_date,
      });
    };

    if (Array.isArray(statusHistoryData)) {
      statusHistoryData.forEach(processItem);
    } else if (
      typeof statusHistoryData === "object" &&
      statusHistoryData !== null
    ) {
      Object.values(statusHistoryData).forEach((vesselGroup) => {
        if (Array.isArray(vesselGroup)) vesselGroup.forEach(processItem);
        else if (typeof vesselGroup === "object")
          Object.values(vesselGroup).forEach((genGroup) => {
            if (Array.isArray(genGroup)) genGroup.forEach(processItem);
          });
      });
    }

    // 3. Sort arrays chronologically (Oldest -> Newest)
    Object.keys(map).forEach((v) => {
      Object.keys(map[v]).forEach((g) => {
        Object.keys(map[v][g]).forEach((d) => {
          map[v][g][d].sort(
            (a, b) => new Date(a.report_date) - new Date(b.report_date),
          );
        });
      });
    });

    return map;
  }, [statusHistoryData]);

  const calculateDaysElapsed = (dateString) => {
    if (!dateString) return null;
    try {
      const reportDate = new Date(dateString);
      const today = new Date();
      reportDate.setHours(0, 0, 0, 0);
      today.setHours(0, 0, 0, 0);
      const diffTime = today.getTime() - reportDate.getTime();
      return Math.floor(diffTime / (1000 * 60 * 60 * 24));
    } catch {
      return null;
    }
  };

 const handleDotClick = async (reportId, vesselName) => {
  if (!reportId) return;
  setDetailsLoading(true);

  try {
    const response = await axiosAepms.getAEReportDetails(reportId);
    const { report, curves } = response;

    const currentLoad = report.load_percentage ?? report.load_percent ?? 0;

    let critCount = 0;
    let warnCount = 0;

    const calculatedRows = AE_HISTORY_PARAMS.map((paramConfig) => {
      const key = paramConfig.key;
      const actualVal = report[key];

      // --- IMPROVED ROBUST CURVE LOOKUP ---
      let curvePoints = [];
      if (curves) {
        // 1. Try exact match (e.g. pmax_bar)
        if (curves[key]) {
          curvePoints = curves[key];
        }
        // 2. Try 'graph' match (e.g. pmax_graph_bar)
        else if (
          curves[`${key.split("_")[0]}_graph_bar` || `${key}_graph` || key]
        ) {
          const potentialKey = Object.keys(curves).find((k) =>
            k.includes(key.split("_")[0]),
          );
          curvePoints = curves[potentialKey] || [];
        }
      }

      const baseline = interpolate(currentLoad, curvePoints);
      const { dev, delta, status, colorClass } = getDeviationStatus(
        actualVal,
        baseline,
        paramConfig.label,
      );

      if (status === "critical") critCount++;
      if (status === "warning") warnCount++;

      return {
        label: paramConfig.label,
        unit: paramConfig.unit,
        actual: actualVal,
        baseline: baseline,
        delta: delta,
        dev: dev,
        status: status,
        colorClass: colorClass,
      };
    });

    let reportStatus = "Normal";
    if (critCount > 0) reportStatus = "Critical";
    else if (warnCount > 0) reportStatus = "Warning";

    setModalDetails({
      vessel_name: vesselName || report.vessel_name,
      generator_name: report.generator_name,
      load_pct: currentLoad,
      load_kw: report.load_kw,
      report_date: report.report_date,
      status: reportStatus,
      rows: calculatedRows,
      raw_report_view_url: report.raw_report_view_url,
      raw_report_download_url: report.raw_report_download_url,
      generated_report_view_url: report.generated_report_view_url,
      generated_report_download_url: report.generated_report_download_url,
    });

    setIsModalOpen(true); // ← Moved here: opens ONLY after real data is ready

  } catch (err) {
    console.error("Failed to calculate report details for modal:", err);
  } finally {
    setDetailsLoading(false);
  }
};
  const getDaysElapsedClass = (days) => {
    if (days === null) return "";
    if (days > 60) return "ae-days-critical";
    if (days > 45) return "ae-days-warning";
    return "ae-days-success";
  };
  const getLoadClass = (load) => {
    if (load === null || typeof load !== "number") return "margin-default";
    if (load < 50) return "margin-critical";
    if (load > 90) return "margin-critical";
    if (load < 60 || load > 85) return "margin-warning";
    return "margin-success";
  };
  const formatLoad = (load) => {
    if (load === null || typeof load !== "number") return "-";
    return `${load.toFixed(1)}%`;
  };

  

  const groupedLoadHistory = useMemo(() => {
    const grouped = {};
    loadHistoryData.forEach((item) => {
      const vessel = item.vessel_name;
      const d = normalizeDesignation(item.generator_designation);
      if (!d) return;
      if (!grouped[vessel]) grouped[vessel] = { vessel_name: vessel };
      grouped[vessel][d] = item;
    });
    return Object.values(grouped).sort((a, b) =>
      a.vessel_name.localeCompare(b.vessel_name),
    );
  }, [loadHistoryData]);

  // const renderStatusDot = (vesselName, gen, monthKey) => {
  //   // 1. Safe Data Access
  //   const vNameNormalized = vesselName ? vesselName.trim().toUpperCase() : "";
  //   const vesselData = mappedStatusHistory[vNameNormalized];
  //   if (!vesselData || !vesselData[gen] || !vesselData[gen][monthKey]) {
  //     return <span className="status-dot dot-empty">•</span>;
  //   }

  //   const data = vesselData[gen][monthKey];

  //   // 2. Get Counts
  //   const counts = data.counts || { normal: 0, warning: 0, critical: 0 };
  //   const { normal, warning, critical } = counts;

  //   let finalStatus = "Normal";

  //   // 3. LOGIC: Calculate Status
  //   const totalReports = normal + warning + critical;

  //   if (totalReports === 0) {
  //     finalStatus = data.status || "Normal";
  //   } else {
  //     if (critical >= warning && critical >= normal) {
  //       finalStatus = "Critical";
  //     } else if (warning > critical && warning >= normal) {
  //       finalStatus = "Warning";
  //     } else {
  //       finalStatus = "Normal";
  //     }
  //   }

  //   // 4. Assign Color Class
  //   let dotClass = "dot-empty";
  //   if (finalStatus === "Normal") dotClass = "dot-normal";
  //   else if (finalStatus === "Warning") dotClass = "dot-warning";
  //   else if (finalStatus === "Critical") dotClass = "dot-critical";

  //   const reportId = data.report_id;

  //   // 🔥 UPDATED: Format the Specific Report Date
  //   const formattedDate = data.report_date
  //     ? new Date(data.report_date).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })
  //     : '-';

  //   return (
  //     <span
  //       className={`status-dot ${dotClass}`}
  //       onClick={() => reportId && handleDotClick(reportId, vesselName)}
  //       onMouseEnter={() => setHoveredStatusDot({ vesselName, gen, monthKey, finalStatus })}
  //       onMouseLeave={() => setHoveredStatusDot(null)}
  //       // 🔥 UPDATED: Tooltip now shows Date and Status
  //       title={`Date: ${formattedDate} | Status: ${finalStatus}`}
  //       style={{
  //         cursor: reportId ? "pointer" : "default",
  //         display: "inline-block",
  //         transform:
  //           hoveredStatusDot?.vesselName === vesselName &&
  //             hoveredStatusDot?.gen === gen &&
  //             hoveredStatusDot?.monthKey === monthKey
  //             ? "scale(1.5)"
  //             : "scale(1)",
  //         transition: "transform 0.18s ease-out",
  //       }}
  //     >
  //       ●
  //     </span>
  //   );
  // };

  const renderStatusDot = (vesselName, gen, monthKey) => {
    // 1. Safe Data Access
    const vNameNormalized = vesselName ? vesselName.trim().toUpperCase() : "";
    const vesselData = mappedStatusHistory[vNameNormalized];

    // Get the array of reports (or empty array)
    const reportsList =
      vesselData && vesselData[gen] && vesselData[gen][monthKey]
        ? vesselData[gen][monthKey]
        : [];

    // --- LOGIC PRESERVED: Empty State ---
    // Added a flex wrapper to force the gray dot to the absolute center of the cell
    if (reportsList.length === 0) {
      return (
        <div
          style={{
            display: "flex",
            justifyContent: "center",
            alignItems: "center",
            width: "100%",
            height: "100%",
          }}
        >
          <div
            style={{
              width: "6px",
              height: "6px",
              borderRadius: "50%",
              backgroundColor: "#929293",
            }}
          />
        </div>
      );
    }

    // --- LOGIC PRESERVED: Render container for active dots ---
    // Added width/height 100% to ensure centering works regardless of cell size
    return (
      <div
        style={{
          display: "flex",
          gap: "4px",
          justifyContent: "center",
          alignItems: "center",
          flexWrap: "wrap",
          width: "100%",
          height: "100%",
          minHeight: "20px", // Ensures consistency
        }}
      >
        {reportsList.map((data, index) => {
          // 2. Get Counts (Per Report) - LOGIC PRESERVED
          const counts = data.counts || { normal: 0, warning: 0, critical: 0 };
          const { warning, critical } = counts;

          let finalStatus = "Normal";
          const totalReports =
            (counts.normal || 0) + (warning || 0) + (critical || 0);

          // 3. LOGIC PRESERVED: Calculate Status (STRICT PRIORITY)
          if (totalReports === 0) {
            finalStatus = data.status || "Normal";
          } else {
            if (critical > 0) {
              finalStatus = "Critical";
            } else if (warning > 0) {
              finalStatus = "Warning";
            } else {
              finalStatus = "Normal";
            }
          }

          // --- COLORS PRESERVED: (Matches ME image styles) ---
          let dotColor = "#10b981"; // Green (Normal)
          if (finalStatus === "Warning") dotColor = "#f59e0b"; // Orange
          if (finalStatus === "Critical") dotColor = "#ef4444"; // Red

          const reportId = data.report_id;
          const uniqueKey = `${monthKey}-${index}`;

          const formattedDate = data.report_date
            ? new Date(data.report_date).toLocaleDateString("en-GB", {
                day: "numeric",
                month: "short",
                year: "numeric",
              })
            : "-";

          // Check if this specific dot is hovered
          const isHovered =
            hoveredStatusDot?.vesselName === vesselName &&
            hoveredStatusDot?.gen === gen &&
            hoveredStatusDot?.monthKey === monthKey &&
            hoveredStatusDot?.index === index;

          // --- VISUALS PRESERVED: Render 11px CSS Circle ---
          return (
            <div
              key={uniqueKey}
              onClick={() => reportId && handleDotClick(reportId, vesselName)}
              onMouseEnter={() =>
                setHoveredStatusDot({
                  vesselName,
                  gen,
                  monthKey,
                  index,
                  finalStatus,
                })
              }
              onMouseLeave={() => setHoveredStatusDot(null)}
              title={`Date: ${formattedDate} | Status: ${finalStatus}`}
              style={{
                width: "8px",
                height: "8px",
                borderRadius: "50%",
                backgroundColor: dotColor,
                cursor: reportId ? "pointer" : "default",
                boxShadow: "0 1px 2px rgba(0,0,0,0.1)",
                border: "1px solid rgba(0,0,0,0.05)",
                transform: isHovered ? "scale(1.3)" : "scale(1)",
                transition: "transform 0.18s ease-out",
              }}
            />
          );
        })}
      </div>
    );
  };

  const handleVesselToggle = (vessel) => {
  setSelectedVesselsFilter((prev) => {
    const exists = prev.find((v) => v.imo_number === vessel.imo_number);
    if (exists) return prev.filter((v) => v.imo_number !== vessel.imo_number);
    return [...prev, vessel];
  });
  setTimeout(() => {
    if (aeDaysCardRef.current) {
      aeDaysCardRef.current.scrollIntoView({ behavior: "smooth", block: "start" });
    }
  }, 150);
};

  const handleSelectAllVessels = () => {
  if (selectedVesselsFilter.length === groupedRunningHours.length) {
    setSelectedVesselsFilter([]);
  } else {
    setSelectedVesselsFilter(groupedRunningHours);
  }
  setTimeout(() => {
    if (aeDaysCardRef.current) {
      aeDaysCardRef.current.scrollIntoView({ behavior: "smooth", block: "start" });
    }
  }, 150);
};

  // The filtered data to be used in the table map
  const handleDaysSort = () => {
    if (daysSortConfig.key === "vessel_name") {
      setDaysSortConfig({ key: "days_elapsed", direction: "desc" });
    } else if (daysSortConfig.direction === "desc") {
      setDaysSortConfig({ key: "days_elapsed", direction: "asc" });
    } else {
      setDaysSortConfig({ key: "vessel_name", direction: "asc" });
    }
  };

  const filteredGroupedRunningHours = useMemo(() => {
    // 1️⃣ If nothing selected → show nothing
    if (selectedVesselsFilter.length === 0) {
      return [];
    }

    // 2️⃣ Filter by selected vessels
    let data = groupedRunningHours.filter((v) =>
      selectedVesselsFilter.some((s) => s.imo_number === v.imo_number),
    );

    // 3️⃣ Sort Logic
    data.sort((a, b) => {
      // Default: Alphabetical by Vessel Name
      if (daysSortConfig.key === "vessel_name") {
        return (a.vessel_name || "").localeCompare(b.vessel_name || "");
      }

      // Sort by Days Elapsed (uses the maximum days among the 3 AEs)
      if (daysSortConfig.key === "days_elapsed") {
        const getMaxDays = (vesselObj) => {
          const daysArr = GENS.map((gen) => {
            const reportDate = vesselObj[gen]?.report_date;
            return calculateDaysElapsed(reportDate) || 0;
          });
          return Math.max(...daysArr);
        };

        const valA = getMaxDays(a);
        const valB = getMaxDays(b);

        if (valA < valB) return daysSortConfig.direction === "asc" ? -1 : 1;
        if (valA > valB) return daysSortConfig.direction === "asc" ? 1 : -1;
        return 0;
      }

      return 0;
    });

    return data;
  }, [groupedRunningHours, selectedVesselsFilter, daysSortConfig]);

  const handlePdfAction = (type) => {
    if (!modalDetails || !modalDetails.rows) return;
    setIsDownloading(true);

    try {
      // --- 1. FILTER ROWS (Match Modal View Logic) ---
      let rowsToExport = modalDetails.rows;

      if (modalDetails.status === "Critical") {
        rowsToExport = modalDetails.rows.filter((r) => r.status === "critical");
      } else if (modalDetails.status === "Warning") {
        rowsToExport = modalDetails.rows.filter((r) => r.status === "warning");
      }
      // If Normal, we keep all rows (rowsToExport remains modalDetails.rows)

      const doc = new jsPDF();

      // --- 2. HEADER & LOGO ---
      // try {
      //   doc.addImage(ozellarLogo, "PNG", 14, 10, 35, 14);
      // } catch (e) {
      //   console.warn("Logo not found");
      // }

      doc.setFontSize(14);
      doc.setFont("helvetica", "bold");
      doc.text("AE Performance Report", 194, 15, { align: "right" });

      doc.setFontSize(10);
      doc.setFont("helvetica", "normal");

      const vesselText = `${modalDetails.vessel_name} [${modalDetails.generator_name || "AE"}]`;
      doc.text(`Vessel: ${vesselText}`, 194, 22, { align: "right" });

      const dateStr = new Date(modalDetails.report_date).toLocaleDateString(
        "en-GB",
      );
      doc.text(
        `Date: ${dateStr} | Load: ${safeFixed(modalDetails.load_pct, 1)}%`,
        194,
        28,
        { align: "right" },
      );

      // --- 3. STATUS INDICATOR ---
      let statusText = (modalDetails.status || "NORMAL").toUpperCase();
      let statusColor = [16, 185, 129]; // Green

      if (statusText === "CRITICAL") {
        statusColor = [220, 38, 38]; // Red
      } else if (statusText === "WARNING") {
        statusColor = [217, 119, 6]; // Orange
      }

      doc.setFont("helvetica", "bold");
      doc.setTextColor(statusColor[0], statusColor[1], statusColor[2]);
      doc.text(`STATUS: ${statusText}`, 194, 34, { align: "right" });

      // --- 4. GENERATE TABLE ROWS ---
      const tableRows = rowsToExport.map((row) => [
        row.label,
        safeFixed(row.baseline),
        safeFixed(row.actual),
        (row.delta > 0 ? "+" : "") + safeFixed(row.delta),
        (row.dev > 0 ? "+" : "") + safeFixed(row.dev, 1) + "%",
      ]);

      autoTable(doc, {
        startY: 45,
        head: [["Parameter", "Baseline", "Actual", "Diff", "Deviation %"]],
        body: tableRows,
        theme: "grid",
        headStyles: {
          fillColor: [243, 244, 246],
          textColor: [17, 24, 39],
          fontStyle: "bold",
        },
        styles: { fontSize: 9, cellPadding: 4 },
        columnStyles: {
          0: { fontStyle: "bold" },
          1: { halign: "right" },
          2: { halign: "right", fontStyle: "bold" },
          3: { halign: "right" },
          4: { halign: "right" },
        },
        didParseCell: (data) => {
          // Color code the Deviation % column in the PDF
          if (data.section === "body" && data.column.index === 4) {
            const rawRow = rowsToExport[data.row.index]; // Get original row data to check status
            if (rawRow) {
              if (rawRow.status === "critical") {
                data.cell.styles.textColor = [220, 38, 38];
              } // Red
              else if (rawRow.status === "warning") {
                data.cell.styles.textColor = [217, 119, 6];
              } // Orange
              else {
                data.cell.styles.textColor = [16, 185, 129];
              } // Green
            }
          }
        },
      });

      // --- 5. SAVE / OPEN ---
      if (type === "download") {
        doc.save(
          `AE_Report_${modalDetails.vessel_name}_${dateStr}_${statusText}.pdf`,
        );
      } else {
        window.open(doc.output("bloburl"), "_blank");
      }
    } catch (err) {
      console.error("PDF generation failed", err);
    } finally {
      setIsDownloading(false);
    }
  };
  const handleDownloadClick = (url) => {
    if (!url) return;
    const link = document.createElement("a");
    link.href = url;
    link.setAttribute("download", ""); // Browser fallback
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  if (loading)
    return (
      <div className="me-performance-container">
        <div className="loading-state-performance">
          <div className="loading-spinner-performance"></div>
          <p>Loading AE Data...</p>
        </div>
      </div>
    );
  if (error)
    return (
      <div className="me-performance-container">
        <div className="error-card-performance">
          <p>{error}</p>
        </div>
      </div>
    );
  
  
  if (embeddedMode) {
  return (
    <div style={{ width: "100%", minWidth: 0, maxWidth: "100%" }}>
      <PerformanceDetailsModal
        isOpen={isModalOpen}
        onClose={() => setIsModalOpen(false)}
        data={modalDetails}
        loading={detailsLoading}
        onPdfAction={handlePdfAction}
      />
      {/* <PerformanceNav /> */}
      {/* {!isSectionOpen && !selectedVesselDetails && (
        <div
          className="me-performance-header enhanced-header"
          style={{ padding: "12px 20px", minHeight: "auto" }}
        >
          <div className="header-icon-wrapper floating-icon">
            <Wrench size={24} />
          </div>
          <div className="header-text-content">
            <h1
              className="me-page-title gradient-text"
              style={{ fontSize: "1.5rem", marginBottom: "4px" }}
            >
              Auxiliary Engine Performance
            </h1>

            <p className="me-page-subtitle" style={{ fontSize: "0.85rem" }}>
              Fleet-wide Generator Status & 12-Month History
            </p>
          </div>
          <div className="header-stats-badge">
            <Activity size={20} />
            <span>{totalGeneratorsReported} Generators</span>
          </div>
        </div>
      )} */}

      <div
        className="performance-cards-grid"
        style={{ gridTemplateColumns: "1fr", gap: "24px", minWidth: 0 }}
      >
        <div
          ref={aeDaysCardRef}
          className="performance-data-card enhanced-card ae-days-card"
          style={{ minWidth: 0 }}
        >
          {/* --- UPDATED HEADER FOR AE PERFORMANCE --- */}
          <div
  className={`card-header-enhanced ${!isSectionOpen ? "header-closed" : ""}`}
  onClick={() => setIsSectionOpen(!isSectionOpen)}
>
            {/* 1. Icon Badge - The signature dark ME style */}
            <div className="card-icon-badge pulsing-icon">
  <Clock size={22} />
</div>

            {/* 2. Title Section - flex: 1 pushes everything else to the right */}
            <div className="card-title-group">
              <h2
                className="card-title-performance"
              >
                Report Status – Days Elapsed
              </h2>
              <p
                className="card-description"
              >
                Time since last report & 12-Month Alert History
              </p>
            </div>

            {/* 3. Vessel Dropdown - Logic preserved 100% */}
            <div
              className="vessel-filter-wrapper"
              ref={vesselDropdownRef}
              onClick={(e) => e.stopPropagation()}
            >
              <div style={{ position: "relative" }}>
                <button
                  className={`vessel-dropdown-btn ${isVesselDropdownOpen ? "active" : ""}`}
                  disabled={!externalVesselId}
                  onClick={(e) => {
                    e.stopPropagation();
                    setIsSectionOpen(true); // Table opens when interacting with filter
                    setIsVesselDropdownOpen(!isVesselDropdownOpen);
                  }}
                  style={{ minWidth: "180px" }}
                >
                  <div className="vessel-dropdown-icon">
                    <span>
                      {selectedVesselsFilter.length === 0
                        ? "Select the vessel"
                        : selectedVesselsFilter.length ===
                            groupedRunningHours.length
                          ? "✓ All"
                          : selectedVesselsFilter.length === 1
                            ? `✓ ${selectedVesselsFilter[0]?.vessel_name?.toUpperCase()}`
                            : `✓ ${selectedVesselsFilter.length} Selected`}
                    </span>
                  </div>
                  <ChevronDown size={18} color="#64748b" />
                </button>

                {isVesselDropdownOpen && (
                  <div className="vessel-dropdown-menu">
                    <div className="vessel-dropdown-sticky">
                      <div
                        className="vessel-select-all-item"
                        onClick={handleSelectAllVessels}
                      >
                        <label
                          className="vessel-select-all-label"
                          style={{ pointerEvents: "none" }}
                        >
                          <input
                            type="checkbox"
                            className="vessel-checkbox"
                            checked={
                              selectedVesselsFilter.length ===
                                groupedRunningHours.length &&
                              groupedRunningHours.length > 0
                            }
                            readOnly
                          />
                          Select All
                        </label>
                      </div>
                    </div>
                    <div className="vessel-dropdown-scroll">
                      {groupedRunningHours.map((vessel) => (
                        <div
                          key={vessel.imo_number}
                          className={`vessel-item ${selectedVesselsFilter.some((v) => v.imo_number === vessel.imo_number) ? "selected" : ""}`}
                          onClick={() => handleVesselToggle(vessel)}
                        >
                          <label
                            style={{
                              pointerEvents: "none",
                              width: "100%",
                              height: "100%",
                              display: "flex",
                              alignItems: "center",
                              gap: "10px",
                            }}
                          >
                            <input
                              type="checkbox"
                              className="vessel-checkbox"
                              checked={selectedVesselsFilter.some(
                                (v) => v.imo_number === vessel.imo_number,
                              )}
                              readOnly
                            />
                            <span>{formatVesselDisplayName(vessel.vessel_name)}</span>
                          </label>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            </div>

            {/* 4. Large Right Side Chevron Toggle - Logic moved here exclusively */}
            <div
              className="ae-days-chevron-btn"
              style={{ marginLeft: "auto" }}
              onClick={(e) => { e.stopPropagation(); setIsSectionOpen(!isSectionOpen); }}
            >
              {isSectionOpen ? (
                <ChevronUp size={24} color="#475569" strokeWidth={2.5} />
              ) : (
                <ChevronDown size={24} color="#475569" strokeWidth={2.5} />
              )}
            </div>
          </div>
          <div className="card-body-enhanced ae-days-card-body">
            {/* 1. CONTAINER: Strict overflow-x rule keeps the scrollbar inside the white card */}
            <div 
  ref={aeTableWrapperRef} 
  className={`ae-table-wrapper ${isSectionOpen ? "expanded" : "collapsed"}`}
  style={
    isSectionOpen && filteredGroupedRunningHours.length > 2
      ? { maxHeight: `${(2 * 3 * 48) + 42 + 36}px`, overflowY: 'auto' }
      : undefined
  }
>

              {(externalVesselId && filteredGroupedRunningHours.length > 0) ? (
                <table className="performance-table-modern ae-days-table">
                  <thead className="ae-days-thead">
                    <tr style={{ backgroundColor: "#fff" }}>
                      {/* STICKY CORNER */}
                      <th className="ae-th-vessel">Vessel Name</th>

                      {/* STICKY GEN */}
                      <th className="ae-th-gen">Gen</th>

                      {/* STICKY LAST REPORT */}
                      <th className="ae-th-lastReport">Last Report</th>

                      {/* STICKY DAYS */}
                      <th
                        className={`ae-th-days ${daysSortConfig.key === "days_elapsed" ? "ae-th-days--sorted" : ""}`}
                        onClick={handleDaysSort}
                      >
                        <div className="ae-sort-header-inner">
                          Days
                          <div className="ae-sort-arrows">
                            <ChevronUp size={10} className={daysSortConfig.key === "days_elapsed" && daysSortConfig.direction === "asc" ? "ae-sort-arrow--active" : "ae-sort-arrow--inactive"} />
                            <ChevronDown size={10} className={daysSortConfig.key === "days_elapsed" && daysSortConfig.direction === "desc" ? "ae-sort-arrow--active" : "ae-sort-arrow--inactive"} />
                          </div>
                        </div>
                      </th>

                      {/* NEW STICKY LOAD % COLUMN */}
                      <th className="ae-th-load">Load %</th>

                      {/* COMPACT NAVIGATION: OFFSET MOVED TO 440px TO PREVENT OVERLAP */}
                      <th className="ae-th-nav-left">
                        <button
                          className={`ae-nav-btn ${viewOffset === 0 ? "ae-nav-btn--disabled" : ""}`}
                          onClick={() => setViewOffset((curr) => Math.max(0, curr - 1))}
                          disabled={viewOffset === 0}
                        >
                          <ChevronLeft size={20} strokeWidth={2.5} color="#374151" />
                        </button>
                      </th>

                      {/* MONTH HEADERS */}
                      {visibleMonths.map((m, i) => {
                        const isLatestMonth = i === 0 && viewOffset === 0;
                        return (
                          <th
                            key={m.key}
                            className={`ae-th-month ${isLatestMonth ? "ae-th-month--current" : ""}`}
                          >
                            {m.label}
                          </th>
                        );
                      })}

                      {/* RIGHT NAVIGATION */}
                      <th className="ae-th-nav-right">
                        <button
                          className={`ae-nav-btn ${viewOffset >= maxOffset ? "ae-nav-btn--disabled" : ""}`}
                          onClick={() => setViewOffset((curr) => Math.min(maxOffset, curr + 1))}
                          disabled={viewOffset >= maxOffset}
                        >
                          <ChevronRight size={20} strokeWidth={2.5} color="#374151" />
                        </button>
                      </th>
                    </tr>
                  </thead>

                  <tbody>
                    {filteredGroupedRunningHours.map((row) => (
                      <React.Fragment key={formatVesselDisplayName(row.vessel_name)}>
                        {GENS.map((gen, index) => {
                          const genData = row[gen];
                          const reportDate = genData?.report_date;
                          const days = calculateDaysElapsed(reportDate);

                          // --- DECLARE lastLoad HERE ---
                          const loadVal = loadHistoryData.find(
                            (lh) =>
                              lh.vessel_name === row.vessel_name &&
                              normalizeDesignation(lh.generator_designation) ===
                                gen,
                          )?.load_history?.[0]?.load_percent;

                          // const loadVal = genData?.load_percentage ?? genData?.load_percent ?? null;

                          return (
                            <tr
  key={`${formatVesselDisplayName(row.vessel_name)}-${gen}`}
  className={`table-row-enhanced ae-days-tr ${index === GENS.length - 1 ? "ae-days-tr--last-gen" : ""}`}
>
                              {index === 0 && (
                                <td
  rowSpan={GENS.length}
  className="ae-td-vessel"
  onClick={() => handleVesselHistoryClick(row.vessel_name)}
>
  <div className="ae-vessel-name-inner">
    {(() => {
  // Get worst days across all 3 AEs for this vessel
  const allDays = GENS.map(gen => {
    const reportDate = row[gen]?.report_date;
    return calculateDaysElapsed(reportDate);
  }).filter(d => d !== null);

  let dotColor = "#16a34a"; // green default
  if (allDays.length === 0) {
    dotColor = "#94a3b8"; // grey if no data at all
  } else if (allDays.some(d => d > 60)) {
    dotColor = "#dc2626"; // red — any AE overdue > 60 days
  } else if (allDays.some(d => d > 45)) {
    dotColor = "#ca8a04"; // amber — any AE overdue > 45 days
  }

  return (
    <div 
      className="status-dot ae-blinking-dot" 
      style={{ background: dotColor, width: "8px", height: "8px", flexShrink: 0 }} 
    />
  );
})()}
    <span className="ae-vessel-name-text">{formatVesselDisplayName(row.vessel_name)}</span>
  </div>
</td>
                              )}

                              <td
  className="ae-td-gen"
  onClick={() => handleVesselHistoryClick(row.vessel_name, gen)}
>
  {gen}
</td>

                              <td className="ae-td-lastReport">{formatDate(reportDate)}</td>

                              <td className="ae-td-days">
  {days !== null ? (
    <span className={`ae-days-badge ${getDaysElapsedClass(days)}`}>{days}</span>
  ) : (
    "-"
  )}
</td>

                              {/* LOAD % COLUMN DATA */}
                              {/* 5. Load % (Sticky) - FIXED DATA SOURCE & ALIGNMENT */}
                              <td className="ae-td-load">
  {loadVal !== null && !isNaN(parseFloat(loadVal)) ? (
    <span
      className="ae-load-badge"
      style={{
        backgroundColor: loadVal < 60 ? "#fee2e2" : loadVal <= 75 ? "#fef3c7" : "#d1fae5",
        color: loadVal < 60 ? "#dc2626" : loadVal <= 75 ? "#ca8a04" : "#16a34a",
      }}
    >
      {Number(loadVal).toFixed(1)}%
    </span>
  ) : (
    <span style={{ color: "#4b5563" }}>-</span>
  )}
</td>

                              {/* NAVIGATION SPACER COLUMN: OFFSET MOVED TO 440px */}
                              <td className="ae-td-spacer"></td>

                              {visibleMonths.map((m, i) => {
                                const isLatestMonth =
                                  i === 0 && viewOffset === 0;
                                return (
                                  <td
  key={m.key}
  className={`ae-td-month ${isLatestMonth ? "ae-td-month--current" : ""}`}
>
  {renderStatusDot(row.vessel_name, gen, m.key)}
</td>
                                );
                              })}
                              <td className="ae-td-tail"></td>
                            </tr>
                          );
                        })}
                      </React.Fragment>
                    ))}
                  </tbody>

                  <tfoot className="ae-days-tfoot">
  <tr>
    <td colSpan="5" className="ae-tfoot-th-sticky"></td>
    <td className="ae-tfoot-th-spacer"></td>
    {visibleMonths.map((m, i) => {
      const isLatestMonth = i === 0 && viewOffset === 0;
      return (
        <td
          key={i}
          className={`ae-tfoot-th-month ${isLatestMonth ? "ae-tfoot-th-month--current" : ""}`}
        >
          {m.label}
        </td>
      );
    })}
    <td className="ae-tfoot-th-tail"></td>
  </tr>
</tfoot>
                </table>
              ) : (
                <div className="ae-days-empty-state">
  <p>👆 Select one or more vessels above to view Report Status</p>
</div>
              )}
            </div>
          </div>
        </div>

        {/* Load History Card */}
        {/* <div className="performance-data-card enhanced-card">
          <div className="section-header">
            <div className="section-header-left">
              <div className="section-header-icon floating-icon"><Cpu size={24} /></div>
              <div className="section-header-text">
                <h2 className="section-title">Load History (Last 3 Reports)</h2>
                <p className="section-subtitle">Reported Load % history per generator</p>
              </div>
            </div>
            <button className={`section-toggle-btn ${isLoadOpen ? 'open' : ''}`} onClick={() => setIsLoadOpen(!isLoadOpen)}>
              {isLoadOpen ? <ChevronUp size={18} /> : <ChevronDown size={18} />}
            </button>
          </div>
          <div className="card-body-enhanced">
            <div className={`performance-table-wrapper ${isLoadOpen ? 'expanded' : 'collapsed'}`}>
              <table className="performance-table-modern">
                <thead>
                  <tr>
                    <th rowSpan="2" className="sticky-col-header" style={{ width: '220px', left: 0 }}>VESSEL</th>
                    <th colSpan={3} className="text-center" style={{ borderBottom:'1px solid #e5e7eb' }}>LATEST REPORT</th>
                    <th colSpan={3} className="text-center" style={{ borderBottom:'1px solid #e5e7eb'}}>PREV REPORT</th>
                    <th colSpan={3} className="text-center" style={{ borderBottom:'1px solid #e5e7eb'}}>OLDER REPORT</th>
                  </tr>
                  <tr>{[1, 2, 3].map(r => <React.Fragment key={r}><th className="text-center" style={{fontSize:'0.75rem', padding:'8px'}}>AE1</th><th className="text-center" style={{fontSize:'0.75rem', padding:'8px'}}>AE2</th><th className="text-center" style={{fontSize:'0.75rem', padding:'8px'}}>AE3</th></React.Fragment>)}</tr>
                </thead>
                <tbody>
                  {groupedLoadHistory.map((row) => (
                    <tr key={row.vessel_name} className="table-row-enhanced">
                      <td className="vessel-name-col">{row.vessel_name}</td>
                      {[0, 1, 2].map(reportIdx => (
                             ['AE1', 'AE2', 'AE3'].map(gen => {
                                const report = row[gen]?.load_history?.[reportIdx];
                                const load = report?.load_percent;
                                return ( <td key={`r${reportIdx}-${gen}`} className="text-center"> {load !== undefined && load !== null ? ( <span className={`margin-value ${getLoadClass(load)}`}>{formatLoad(load)}</span> ) : <span className="na-text">-</span>} </td> );
                             })
                        ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </div> */}
        {/* --- DETAILED ANALYSIS SECTION --- */}
        {/* DETAILED ANALYSIS */}
        {selectedVesselDetails && (
  <div
    ref={detailsSectionRef}
    className="ae-detail-card performance-data-card enhanced-card"
  >
 
    {/* ── HEADER ─────────────────────────────────────────────────────────── */}
    <div className="ae-detail-header card-header-enhanced">
 
      {/* Icon — .ae-detail-header .card-icon-badge scopes the dark bg override */}
      <div className="card-icon-badge">
        <Activity size={24} />
      </div>
 
      {/* Title group */}
      <div className="card-title-group">
        <h2 className="card-title-performance">
          {formatVesselDisplayName(selectedVesselDetails.name)} — Detailed History
        </h2>
        <p className="card-description">
          {isDetailLoading
            ? "Fetching detailed data..."
            : `Showing historical data for: ${selectedVesselDetails.filter}`}
        </p>
      </div>
 
      {/* Close button */}
      <button
        className="ae-detail-close-btn"
        onClick={() => setSelectedVesselDetails(null)}
      >
        <X size={24} />
      </button>
    </div>
 
    {/* ── BODY ───────────────────────────────────────────────────────────── */}
    <div className="card-body-enhanced">
 
      {isDetailLoading ? (
        <div className="ae-detail-loading">
          <Loader2 className="animate-spin" size={40} color="#111827" />
          <p>Loading report details...</p>
        </div>
      ) : (
        <table className="ae-detail-table">
 
          {/* ── THEAD ──────────────────────────────────────────────────── */}
          <thead className="ae-detail-thead">
            <tr>
              {/* Sticky header cells */}
              <th className="ae-dth-gen">Gen</th>
              <th className="ae-dth-date">Report Date</th>
              <th className="ae-dth-load">Load %</th>
              <th className="ae-dth-status">Status</th>
              <th className="ae-dth-raw">Raw Rep</th>
              <th className="ae-dth-ana">Ana Rep</th>
 
              {/* Scrollable param headers */}
              {AE_HISTORY_PARAMS.map((param) => (
                <th key={param.key} className="ae-dth-param">
                  {param.label}
                </th>
              ))}
            </tr>
          </thead>
 
          {/* ── TBODY ──────────────────────────────────────────────────── */}
          <tbody>
            {selectedVesselDetails.reports.length === 0 ? (
              <tr className="ae-detail-no-reports">
                <td colSpan={6 + AE_HISTORY_PARAMS.length}>No reports found.</td>
              </tr>
            ) : (
              selectedVesselDetails.reports.map((r, i) => {
                const load = r.load_percentage || r.load_percent || 0;
 
                // ── Status calculation (100% original logic) ────────────────
                let calculatedStatus = "Normal";
                let critCount = 0;
                let warnCount = 0;
 
                AE_HISTORY_PARAMS.forEach((paramConfig) => {
                  const key = paramConfig.key;
                  const actualVal = r[key];
                  if (actualVal !== null && actualVal !== undefined) {
                    let curve = [];
                    if (r.curves) {
                      if (r.curves[key]) {
                        curve = r.curves[key];
                      } else {
                        const labelMatch = Object.entries(r.curves).find(([k]) =>
                          k.toLowerCase().includes(
                            paramConfig.label.toLowerCase().split(" ")[0]
                          )
                        );
                        if (labelMatch) curve = labelMatch[1];
                      }
                    }
                    const baseline = interpolate(load, curve);
                    const { status } = getDeviationStatus(
                      actualVal,
                      baseline,
                      paramConfig.label
                    );
                    if (status === "critical") critCount++;
                    if (status === "warning")  warnCount++;
                  }
                });
 
                if (critCount > 0)      calculatedStatus = "Critical";
                else if (warnCount > 0) calculatedStatus = "Warning";
 
                // ── Short generator name (100% original logic) ──────────────
                const rawName = String(
                  r.generator_designation || r.generator_name || ""
                ).toUpperCase();
                let shortGenName = "AE";
                if (rawName.includes("1"))      shortGenName = "AE1";
                else if (rawName.includes("2")) shortGenName = "AE2";
                else if (rawName.includes("3")) shortGenName = "AE3";
 
                // ── Status badge CSS variant class ──────────────────────────
                const statusVariant =
                  calculatedStatus === "Critical" ? "ae-status--critical" :
                  calculatedStatus === "Warning"  ? "ae-status--warning"  :
                                                    "ae-status--normal";
 
                // ── Row zebra class ─────────────────────────────────────────
                const rowClass =
                  i % 2 === 0 ? "ae-detail-row-even" : "ae-detail-row-odd";
 
                // ── renderCell (100% original logic, only style→class changed) ──
                const renderCell = (paramConfig) => {
                  const key = paramConfig.key;
                  const actualVal = r[key];
 
                  if (actualVal === null || actualVal === undefined) {
                    return <span className="ae-detail-empty">-</span>;
                  }
 
                  const findCurve = () => {
                    if (!r.curves) return [];
                    if (r.curves[key]) return r.curves[key];
                    const labelMatch = Object.entries(r.curves).find(([k]) =>
                      k.toLowerCase().includes(
                        paramConfig.label.toLowerCase().split(" ")[0]
                      )
                    );
                    if (labelMatch) return labelMatch[1];
                    return [];
                  };
 
                  const curve    = findCurve();
                  const baseline = interpolate(load, curve);
                  const { status: dotStatus, dev } = getDeviationStatus(
                    actualVal,
                    baseline,
                    paramConfig.label
                  );
 
                  // dotColor is a runtime JS value — stays inline
                  const dotColor =
                    dotStatus === "critical" ? "#ef4444" :
                    dotStatus === "warning"  ? "#f59e0b" :
                                               "#10b981";
 
                  const pctSign = dev > 0 ? "+" : "";
 
                  return (
                    <div className="ae-detail-param-dot-wrap">
                      <div
                        className="ae-detail-param-dot"
                        title={`Act: ${safeFixed(actualVal)} | Dev: ${pctSign}${safeFixed(dev, 1)}%`}
                        style={{ backgroundColor: dotColor }}
                      />
                    </div>
                  );
                };
 
                // ── Row render ──────────────────────────────────────────────
                return (
                  <tr key={i} className={rowClass}>
 
                    {/* GEN — sticky */}
                    <td className="ae-dtd-gen">
                      {shortGenName}
                    </td>
 
                    {/* REPORT DATE — sticky */}
                    <td className="ae-dtd-date">
                      {formatDate(r.report_date)}
                    </td>
 
                    {/* LOAD % — sticky */}
                    <td className="ae-dtd-load">
                      {safeFixed(load, 1)}%
                    </td>
 
                    {/* STATUS — sticky */}
                    <td className="ae-dtd-status">
                      <span className={`ae-detail-status-badge ${statusVariant}`}>
                        <span className="ae-detail-status-badge__dot" />
                        {calculatedStatus}
                      </span>
                    </td>
 
                    {/* RAW REP — sticky */}
                    <td className="ae-dtd-raw">
                      {r.raw_report_view_url ? (
                        <div className="ae-detail-icon-wrap">
                          <button
                            className="ae-detail-icon-btn"
                            onClick={() => window.open(r.raw_report_view_url, "_blank")}
                            title="View Raw"
                          >
                            <FileText size={15} />
                          </button>
                        </div>
                      ) : (
                        <span className="ae-detail-empty">-</span>
                      )}
                    </td>
 
                    {/* ANA REP — sticky (last pinned col, has shadow divider) */}
                    <td className="ae-dtd-ana">
                      {r.generated_report_view_url ? (
                        <div className="ae-detail-icon-wrap">
                          <button
                            className="ae-detail-icon-btn"
                            onClick={() =>
                              window.open(r.generated_report_view_url, "_blank")
                            }
                            title="View Analytical"
                          >
                            <FileText size={15} />
                          </button>
                        </div>
                      ) : (
                        <span className="ae-detail-empty">-</span>
                      )}
                    </td>
 
                    {/* SCROLLABLE PARAM CELLS */}
                    {AE_HISTORY_PARAMS.map((param) => (
                      <td key={param.key} className="ae-dtd-param">
                        {renderCell(param)}
                      </td>
                    ))}
 
                  </tr>
                );
              })
            )}
          </tbody>
 
        </table>
      )}
    </div>
 
  </div>
)}
      </div>
    </div>
  );
}
}

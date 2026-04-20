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
  { key: "fuel_pump_index_graph", label: "FIPI", unit: "mm" },
  { key: "scav_air_pressure_bar", label: "Scav Air", unit: "Bar" },
  { key: "exh_temp_tc_inlet_graph_c", label: "TC Inlet", unit: "°C" },
  { key: "exh_temp_tc_outlet_graph_c", label: "TC Outlet", unit: "°C" },
  { key: "exh_temp_cyl_outlet_avg_graph_c", label: "TC Cyl Out", unit: "°C" },
];

const safeFixed = (val, digits = 2) => {
  if (val === null || val === undefined || isNaN(val)) return "N/A";
  return Number(val).toFixed(digits);
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
  const [isSectionOpen, setIsSectionOpen] = useState(false);
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
  const detailsSectionRef = useRef(null); // NEW
  const [hoveredStatusDot, setHoveredStatusDot] = useState(null);
  const [selectedVesselsFilter, setSelectedVesselsFilter] = useState([]);
  const [isVesselDropdownOpen, setIsVesselDropdownOpen] = useState(false);
  const vesselDropdownRef = useRef(null);

  const maxOffset = useMemo(() => {
    const today = new Date();
    const startYear = 2025;
    const startMonth = 0; // January

    // Total months from Jan 2025 to Today
    const totalMonthsSinceStart =
      (today.getFullYear() - startYear) * 12 + today.getMonth();

    // Stop scrolling when Jan 2025 is the 12th column (matching ME logic)
    return Math.max(0, totalMonthsSinceStart - 11);
  }, []);

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

  // --- Generate 12 Months ---
  const visibleMonths = useMemo(() => {
    const months = [];
    const today = new Date();

    for (let i = viewOffset; i < viewOffset + 12; i++) {
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
  }, [viewOffset]);

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
    setIsModalOpen(true);
    setDetailsLoading(true);

    setModalDetails({ vessel_name: vesselName, rows: [], status: "Normal" });

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
    } catch (err) {
      console.error("Failed to calculate report details for modal:", err);
    } finally {
      setDetailsLoading(false);
    }
  };
  const getDaysElapsedClass = (days) => {
    if (days === null) return "days-default";
    if (days > 60) return "days-critical";
    if (days > 45) return "days-warning";
    return "days-success";
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
                width: "11px",
                height: "11px",
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
    window.scrollTo({ top: 0, behavior: "smooth" });
    setSelectedVesselsFilter((prev) => {
      const exists = prev.find((v) => v.imo_number === vessel.imo_number);
      if (exists) return prev.filter((v) => v.imo_number !== vessel.imo_number);
      return [...prev, vessel];
    });
  };

  const handleSelectAllVessels = () => {
    window.scrollTo({ top: 0, behavior: "smooth" });
    if (selectedVesselsFilter.length === groupedRunningHours.length) {
      setSelectedVesselsFilter([]);
    } else {
      setSelectedVesselsFilter(groupedRunningHours);
    }
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
    <div style={{ width: "100%" }}>
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
        style={{ gridTemplateColumns: "1fr", gap: "24px" }}
      >
        <div
          ref={aeDaysCardRef}
          className="performance-data-card enhanced-card"
          style={{
            borderRadius: "12px",
            overflow: "hidden",
            border: "1px solid #e2e8f0",
            scrollMarginTop: "100px",
            boxShadow:
              "0 4px 6px -1px rgba(0, 0, 0, 0.05), 0 2px 4px -1px rgba(0, 0, 0, 0.03)",
          }}
        >
          {/* --- UPDATED HEADER FOR AE PERFORMANCE --- */}
          <div
            className="card-header-enhanced"
            style={{
              cursor: "default", // Changed from pointer to default
              display: "flex",
              alignItems: "center",
              width: "100%",
              padding: "16px 24px",
              backgroundColor: "#fff",
              borderBottom: isSectionOpen ? "1px solid #f1f5f9" : "none",
              gap: "16px",
            }}
            onClick={(e) => {
                e.stopPropagation();
                setIsSectionOpen(!isSectionOpen); // Open/Close action moved to this specific element
              }}
            // onClick removed from here
          >
            {/* 1. Icon Badge - The signature dark ME style */}
            <div
              style={{
                backgroundColor: "#1e293b",
                color: "white",
                minWidth: "44px",
                height: "44px",
                borderRadius: "10px",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                flexShrink: 0,
              }}
            >
              <Clock size={22} />
            </div>

            {/* 2. Title Section - flex: 1 pushes everything else to the right */}
            <div className="card-title-group" style={{ flex: 1, minWidth: 0 }}>
              <h2
                className="card-title-performance"
                style={{
                  fontSize: "1.15rem",
                  fontWeight: "700",
                  color: "#1f2937",
                  margin: "0",
                  letterSpacing: "-0.01em",
                  lineHeight: "1.2",
                }}
              >
                Report Status – Days Elapsed
              </h2>
              <p
                className="card-description"
                style={{
                  margin: "4px 0 0 0",
                  fontSize: "0.85rem",
                  color: "#64748b",
                  fontWeight: "400",
                }}
              >
                Time since last report & 12-Month Alert History
              </p>
            </div>

            {/* 3. Vessel Dropdown - Logic preserved 100% */}
            <div
              className="vessel-filter-wrapper"
              ref={vesselDropdownRef}
              onClick={(e) => e.stopPropagation()}
              style={{
                marginRight: "8px",
                flexShrink: 0,
              }}
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
                            ? `✓ ${selectedVesselsFilter[0]?.vessel_name}`
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
                            <span>{vessel.vessel_name}</span>
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
              className="ae-header-toggle-wrapper"
              style={{
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                width: "40px",
                height: "40px",
                borderRadius: "50%",
                flexShrink: 0,
                cursor: "pointer", // Added pointer here
              }}
              onClick={(e) => {
                e.stopPropagation();
                setIsSectionOpen(!isSectionOpen); // Open/Close action moved to this specific element
              }}
              onMouseEnter={(e) =>
                (e.currentTarget.style.backgroundColor = "#f1f5f9")
              }
              onMouseLeave={(e) =>
                (e.currentTarget.style.backgroundColor = "transparent")
              }
            >
              {isSectionOpen ? (
                <ChevronUp size={32} color="#475569" strokeWidth={2.5} />
              ) : (
                <ChevronDown size={32} color="#475569" strokeWidth={2.5} />
              )}
            </div>
          </div>
          <div className="card-body-enhanced">
            {/* 1. CONTAINER: Strict overflow-x rule keeps the scrollbar inside the white card */}
            <div
              className={`performance-table-wrapper ${isSectionOpen ? "expanded" : "collapsed"}`}
              style={{
                overflowX: "auto",
                maxWidth: "100%",
                position: "relative",
                background: "#fff",
              }}
            >
              {(externalVesselId && filteredGroupedRunningHours.length > 0) ? (
                <table
                  className="performance-table-modern"
                  style={{
                    width: "max-content",
                    minWidth: "100%",
                    borderCollapse: "separate",
                    borderSpacing: 0,
                    tableLayout: "fixed",
                  }}
                >
                  <thead>
                    <tr style={{ backgroundColor: "#fff" }}>
                      {/* STICKY CORNER */}
                      <th
                        style={{
                          position: "sticky",
                          left: 0,
                          top: 0,
                          zIndex: 70,
                          backgroundColor: "#fff",
                          width: "150px",
                          minWidth: "140px",
                          textAlign: "left",
                          padding: "16px 12px 16px 20px",
                          color: "#6b7280",
                          fontSize: "0.7rem",
                          fontWeight: "700",
                          textTransform: "uppercase",
                          borderBottom: "2px solid #f3f4f6",
                        }}
                      >
                        Vessel Name
                      </th>

                      {/* STICKY GEN */}
                      <th
                        style={{
                          position: "sticky",
                          left: "140px",
                          top: 0,
                          zIndex: 70,
                          backgroundColor: "#fff",
                          width: "50px",
                          minWidth: "50px",
                          textAlign: "center",
                          padding: "16px 4px",
                          color: "#6b7280",
                          fontSize: "0.7rem",
                          fontWeight: "700",
                          textTransform: "uppercase",
                          borderBottom: "2px solid #f3f4f6",
                        }}
                      >
                        Gen
                      </th>

                      {/* STICKY LAST REPORT */}
                      <th
                        style={{
                          position: "sticky",
                          left: "190px",
                          top: 0,
                          zIndex: 70,
                          backgroundColor: "#fff",
                          width: "110px",
                          minWidth: "110px",
                          textAlign: "center",
                          padding: "16px 4px",
                          color: "#6b7280",
                          fontSize: "0.7rem",
                          fontWeight: "700",
                          textTransform: "uppercase",
                          borderBottom: "2px solid #f3f4f6",
                        }}
                      >
                        Last Report
                      </th>

                      {/* STICKY DAYS */}
                      <th
                        onClick={handleDaysSort}
                        style={{
                          position: "sticky",
                          left: "300px",
                          top: 0,
                          zIndex: 70,
                          backgroundColor: "#fff",
                          width: "70px",
                          minWidth: "70px",
                          textAlign: "center",
                          padding: "16px 4px",
                          color:
                            daysSortConfig.key === "days_elapsed"
                              ? "#1e3a8a"
                              : "#6b7280",
                          fontSize: "0.7rem",
                          fontWeight: "700",
                          textTransform: "uppercase",
                          borderBottom: "2px solid #f3f4f6",
                          boxShadow: "4px 0 4px -4px rgba(0,0,0,0.05)",
                          cursor: "pointer",
                          userSelect: "none",
                        }}
                      >
                        <div
                          style={{
                            display: "flex",
                            alignItems: "center",
                            justifyContent: "center",
                            gap: "4px",
                          }}
                        >
                          Days
                          <div
                            style={{
                              display: "flex",
                              flexDirection: "column",
                              lineHeight: 1,
                            }}
                          >
                            <ChevronUp
                              size={10}
                              style={{
                                opacity:
                                  daysSortConfig.key === "days_elapsed" &&
                                  daysSortConfig.direction === "asc"
                                    ? 1
                                    : 0.2,
                              }}
                            />
                            <ChevronDown
                              size={10}
                              style={{
                                opacity:
                                  daysSortConfig.key === "days_elapsed" &&
                                  daysSortConfig.direction === "desc"
                                    ? 1
                                    : 0.2,
                                marginTop: "-2px",
                              }}
                            />
                          </div>
                        </div>
                      </th>

                      {/* NEW STICKY LOAD % COLUMN */}
                      <th
                        style={{
                          position: "sticky",
                          left: "370px",
                          top: 0,
                          zIndex: 70,
                          backgroundColor: "#fff",
                          width: "70px",
                          minWidth: "70px",
                          textAlign: "center",
                          padding: "16px 4px",
                          color: "#6b7280",
                          fontSize: "0.7rem",
                          fontWeight: "700",
                          textTransform: "uppercase",
                          borderBottom: "2px solid #f3f4f6",
                        }}
                      >
                        Load %
                      </th>

                      {/* COMPACT NAVIGATION: OFFSET MOVED TO 440px TO PREVENT OVERLAP */}
                      <th
                        style={{
                          position: "sticky",
                          top: 0,
                          left: "440px",
                          zIndex: 70,
                          backgroundColor: "#fff",
                          width: "40px",
                          minWidth: "40px",
                          padding: "0",
                          borderBottom: "2px solid #f3f4f6",
                        }}
                      >
                        <button
                          onClick={() =>
                            setViewOffset((curr) => Math.max(0, curr - 1))
                          }
                          disabled={viewOffset === 0}
                          style={{
                            width: "100%",
                            height: "100%",
                            background: "transparent",
                            border: "none",
                            outline: "none",
                            cursor: viewOffset === 0 ? "default" : "pointer",
                            opacity: viewOffset === 0 ? 0.1 : 1,
                            display: "flex",
                            alignItems: "center",
                            justifyContent: "center",
                          }}
                        >
                          <ChevronLeft
                            size={20}
                            strokeWidth={2.5}
                            color="#374151"
                          />
                        </button>
                      </th>

                      {/* MONTH HEADERS */}
                      {visibleMonths.map((m, i) => {
                        const isLatestMonth = i === 0 && viewOffset === 0;
                        return (
                          <th
                            key={m.key}
                            style={{
                              position: "sticky",
                              top: 0,
                              zIndex: 50,
                              width: "73px",
                              minWidth: "73px",
                              textAlign: "center",
                              fontSize: "0.65rem",
                              color: isLatestMonth ? "#1e3a8a" : "#6b7280",
                              fontWeight: "700",
                              textTransform: "uppercase",
                              padding: "16px 0",
                              backgroundColor: isLatestMonth
                                ? "#eff6ff"
                                : "#fff",
                              borderBottom: "2px solid #f3f4f6",
                              borderLeft: "1px solid #f3f4f6",
                            }}
                          >
                            {m.label}
                          </th>
                        );
                      })}

                      {/* RIGHT NAVIGATION */}
                      <th
                        style={{
                          position: "sticky",
                          top: 0,
                          zIndex: 50,
                          backgroundColor: "#fff",
                          width: "40px",
                          minWidth: "40px",
                          padding: "0",
                          borderBottom: "2px solid #f3f4f6",
                        }}
                      >
                        <button
                          onClick={() =>
                            setViewOffset((curr) =>
                              Math.min(maxOffset, curr + 1),
                            )
                          }
                          disabled={viewOffset >= maxOffset}
                          style={{
                            width: "100%",
                            height: "100%",
                            background: "transparent",
                            border: "none",
                            outline: "none",
                            cursor:
                              viewOffset >= maxOffset ? "default" : "pointer",
                            opacity: viewOffset >= maxOffset ? 0.1 : 1,
                            display: "flex",
                            alignItems: "center",
                            justifyContent: "center",
                          }}
                        >
                          <ChevronRight
                            size={20}
                            strokeWidth={2.5}
                            color="#374151"
                          />
                        </button>
                      </th>
                    </tr>
                  </thead>

                  <tbody>
                    {filteredGroupedRunningHours.map((row) => (
                      <React.Fragment key={row.vessel_name}>
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
                              key={`${row.vessel_name}-${gen}`}
                              className="table-row-enhanced"
                            >
                              {index === 0 && (
                                <td
                                  rowSpan={GENS.length}
                                  style={{
                                    position: "sticky",
                                    left: 0,
                                    backgroundColor: "#fff",
                                    padding: "12px 12px 12px 20px",
                                    verticalAlign: "middle",
                                    borderBottom: "1px solid #cbd5e1",
                                    width: "140px",
                                  }}
                                  onClick={() =>
                                    handleVesselHistoryClick(row.vessel_name)
                                  }
                                >
                                  <div
                                    style={{
                                      display: "flex",
                                      alignItems: "center",
                                      gap: "8px",
                                    }}
                                  >
                                    <div
                                      className="status-dot blinking-dot"
                                      style={{
                                        background: "#3b82f6",
                                        width: "8px",
                                        height: "8px",
                                        flexShrink: 0,
                                      }}
                                    />
                                    <span
                                      style={{
                                        fontWeight: "600",
                                        color: "#374151",
                                        fontSize: "0.85rem",
                                        whiteSpace: "nowrap",
                                      }}
                                    >
                                      {row.vessel_name}
                                    </span>
                                  </div>
                                </td>
                              )}

                              <td
                                onClick={() =>
                                  handleVesselHistoryClick(row.vessel_name, gen)
                                }
                                style={{
                                  position: "sticky",
                                  left: "140px",
                                  backgroundColor: "#f9fafb",
                                  textAlign: "center",
                                  fontWeight: "600",
                                  color: "#4b5563",
                                  fontSize: "0.8rem",
                                  borderBottom:
                                    index === 2
                                      ? "1px solid #cbd5e1"
                                      : "1px solid #f3f4f6",
                                  cursor: "pointer",
                                }}
                              >
                                {gen}
                              </td>

                              <td
                                style={{
                                  position: "sticky",
                                  left: "190px",
                                  backgroundColor: "#fff",
                                  textAlign: "center",
                                  color: "#4b5563",
                                  fontSize: "0.8rem",
                                  borderBottom:
                                    index === 2
                                      ? "1px solid #cbd5e1"
                                      : "1px solid #f3f4f6",
                                }}
                              >
                                {formatDate(reportDate)}
                              </td>

                              <td
                                style={{
                                  position: "sticky",
                                  left: "300px",
                                  height: "53px",
                                  backgroundColor: "#fff",
                                  textAlign: "center",
                                  boxShadow: "4px 0 4px -4px rgba(0,0,0,0.05)",
                                  borderBottom:
                                    index === 2
                                      ? "1px solid #cbd5e1"
                                      : "1px solid #f3f4f6",
                                }}
                              >
                                {days !== null ? (
                                  <span
                                    className={`days-badge ${getDaysElapsedClass(days)}`}
                                    style={{
                                      minWidth: "40px",
                                      fontSize: "0.75rem",
                                    }}
                                  >
                                    {days}
                                  </span>
                                ) : (
                                  "-"
                                )}
                              </td>

                              {/* LOAD % COLUMN DATA */}
                              {/* 5. Load % (Sticky) - FIXED DATA SOURCE & ALIGNMENT */}
                              <td
                                style={{
                                  position: "sticky",
                                  left: "380px",
                                  backgroundColor: "#fff",
                                  textAlign: "center",
                                  borderBottom:
                                    index === 2
                                      ? "1px solid #cbd5e1"
                                      : "1px solid #f3f4f6",
                                }}
                              >
                                {loadVal !== null &&
                                !isNaN(parseFloat(loadVal)) ? (
                                  <span
                                    style={{
                                      backgroundColor:
                                        loadVal < 60
                                          ? "#fee2e2"
                                          : loadVal <= 75
                                            ? "#fef3c7"
                                            : "#d1fae5",
                                      color:
                                        loadVal < 60
                                          ? "#dc2626"
                                          : loadVal <= 75
                                            ? "#ca8a04"
                                            : "#16a34a",
                                      padding: "2px 6px",
                                      borderRadius: "4px",
                                      fontWeight: "700",
                                      fontSize: "0.75rem",
                                      display: "inline-block",
                                      minWidth: "45px",
                                    }}
                                  >
                                    {Number(loadVal).toFixed(1)}%
                                  </span>
                                ) : (
                                  <span style={{ color: "#d1d5db" }}>-</span>
                                )}
                              </td>

                              {/* NAVIGATION SPACER COLUMN: OFFSET MOVED TO 440px */}
                              <td
                                style={{
                                  position: "sticky",
                                  left: "440px",
                                  backgroundColor: "#fff",
                                  borderBottom:
                                    index === 2
                                      ? "1px solid #cbd5e1"
                                      : "1px solid #f3f4f6",
                                }}
                              ></td>

                              {visibleMonths.map((m, i) => {
                                const isLatestMonth =
                                  i === 0 && viewOffset === 0;
                                return (
                                  <td
                                    key={m.key}
                                    style={{
                                      textAlign: "center",
                                      verticalAlign: "middle",
                                      borderLeft: "1px solid #f3f4f6",
                                      borderBottom:
                                        index === 2
                                          ? "1px solid #cbd5e1"
                                          : "1px solid #f3f4f6",
                                      backgroundColor: isLatestMonth
                                        ? "#eff6ff"
                                        : "#fff",
                                      padding: "12px 0",
                                    }}
                                  >
                                    {renderStatusDot(
                                      row.vessel_name,
                                      gen,
                                      m.key,
                                    )}
                                  </td>
                                );
                              })}
                              <td
                                style={{
                                  backgroundColor: "#fff",
                                  borderBottom:
                                    index === 2
                                      ? "1px solid #cbd5e1"
                                      : "1px solid #f3f4f6",
                                }}
                              ></td>
                            </tr>
                          );
                        })}
                      </React.Fragment>
                    ))}
                  </tbody>

                  <tfoot style={{ position: "sticky", bottom: 0, zIndex: 50 }}>
                    <tr style={{ backgroundColor: "#fff" }}>
                      {/* UPDATED colSpan to 5 to cover Vessel, Gen, Last Report, Days, and Load % */}
                      <td
                        colSpan="5"
                        style={{
                          position: "sticky",
                          left: 0,
                          bottom: 0,
                          zIndex: 60,
                          backgroundColor: "#fff",
                          borderTop: "2px solid #e5e7eb",
                          height: "40px",
                        }}
                      ></td>

                      {/* UPDATED left offset to 440px */}
                      <td
                        style={{
                          position: "sticky",
                          left: "440px",
                          bottom: 0,
                          zIndex: 60,
                          backgroundColor: "#fff",
                          borderTop: "2px solid #e5e7eb",
                        }}
                      ></td>

                      {visibleMonths.map((m, i) => {
                        const isLatestMonth = i === 0 && viewOffset === 0;
                        return (
                          <td
                            key={i}
                            style={{
                              textAlign: "center",
                              fontSize: "0.65rem",
                              fontWeight: "700",
                              textTransform: "uppercase",
                              padding: "12px 0",
                              borderTop: "2px solid #e5e7eb",
                              borderLeft: "1px solid #f3f4f6",
                              color: isLatestMonth ? "#1e3a8a" : "#6b7280",
                              backgroundColor: isLatestMonth
                                ? "#eff6ff"
                                : "#fff",
                            }}
                          >
                            {m.label}
                          </td>
                        );
                      })}
                      <td
                        style={{
                          borderTop: "2px solid #e5e7eb",
                          backgroundColor: "#fff",
                        }}
                      ></td>
                    </tr>
                  </tfoot>
                </table>
              ) : (
                <div
                  style={{
                    padding: "72px 24px",
                    textAlign: "center",
                    color: "#94a3af",
                  }}
                >
                  <p style={{ margin: 0, fontSize: "1.1rem" }}>
                    👆 Select one or more vessels above to view Report Status
                  </p>
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
            className="performance-data-card enhanced-card"
            style={{
              width: "100%",
              marginTop: "16px",
              borderTop: "4px solid #111827",
              animation: "fadeIn 0.5s ease",
            }}
          >
            {/* Header */}
            <div
              className="card-header-enhanced"
              style={{
                backgroundColor: "#f9fafb",
                padding: "16px 24px",
                display: "flex",
                alignItems: "center",
                borderBottom: "1px solid #e5e7eb",
              }}
            >
              <div
                className="card-icon-badge"
                style={{
                  backgroundColor: "#111827",
                  color: "white",
                  padding: "8px",
                  borderRadius: "8px",
                  marginRight: "12px",
                }}
              >
                <Activity size={24} />
              </div>
              <div className="card-title-group">
                <h2
                  className="card-title-performance"
                  style={{
                    fontSize: "1.25rem",
                    fontWeight: "700",
                    color: "#1f2937",
                    margin: 0,
                  }}
                >
                  {selectedVesselDetails.name} — Detailed History
                </h2>
                <p
                  className="card-description"
                  style={{
                    color: "#6b7280",
                    fontSize: "0.875rem",
                    marginTop: "4px",
                  }}
                >
                  {isDetailLoading
                    ? "Fetching detailed data..."
                    : `Showing historical data for: ${selectedVesselDetails.filter}`}
                </p>
              </div>
              <button
                onClick={() => setSelectedVesselDetails(null)}
                style={{
                  marginLeft: "auto",
                  border: "none",
                  background: "transparent",
                  cursor: "pointer",
                }}
              >
                <X size={24} color="#6b7280" />
              </button>
            </div>

            {/* Table Body */}
            <div
              className="card-body-enhanced"
              style={{ padding: "0", overflowX: "hidden" }}
            >
              {isDetailLoading ? (
                <div
                  style={{
                    padding: "60px",
                    display: "flex",
                    justifyContent: "center",
                    alignItems: "center",
                    flexDirection: "column",
                    gap: "12px",
                  }}
                >
                  <Loader2 className="animate-spin" size={40} color="#111827" />
                  <p
                    style={{
                      color: "#6b7280",
                      fontSize: "0.9rem",
                      fontWeight: "500",
                    }}
                  >
                    Loading report details...
                  </p>
                </div>
              ) : (
                <table
                  style={{
                    width: "100%",
                    borderCollapse: "collapse",
                    textAlign: "center",
                    tableLayout: "fixed",
                  }}
                >
                  <thead
                    style={{
                      backgroundColor: "#f3f4f6",
                      position: "sticky",
                      top: 0,
                      zIndex: 40,
                    }}
                  >
                    <tr
                      style={{
                        fontSize: "0.7rem",
                        color: "#4b5563",
                        textTransform: "uppercase",
                        letterSpacing: "0.02em",
                      }}
                    >
                      <th
                        style={{
                          width: "5%",
                          padding: "14px 4px",
                          borderBottom: "1px solid #e5e7eb",
                          fontWeight: "700",
                          textAlign: "left",
                          paddingLeft: "24px",
                        }}
                      >
                        Gen
                      </th>
                      <th
                        style={{
                          width: "8.5%",
                          padding: "14px 4px",
                          borderBottom: "1px solid #e5e7eb",
                          fontWeight: "700",
                        }}
                      >
                        Report Date
                      </th>
                      <th
                        style={{
                          width: "6%",
                          padding: "14px 4px",
                          borderBottom: "1px solid #e5e7eb",
                          fontWeight: "700",
                        }}
                      >
                        Load %
                      </th>
                      <th
                        style={{
                          width: "9.5%",
                          padding: "14px 4px",
                          borderBottom: "1px solid #e5e7eb",
                          fontWeight: "700",
                        }}
                      >
                        Status
                      </th>
                      <th
                        style={{
                          width: "6%",
                          padding: "14px 4px",
                          borderBottom: "1px solid #e5e7eb",
                          fontWeight: "700",
                        }}
                      >
                        Raw Rep
                      </th>
                      <th
                        style={{
                          width: "6%",
                          padding: "14px 4px",
                          borderBottom: "1px solid #e5e7eb",
                          fontWeight: "700",
                          borderRight: "1px solid #e5e7eb",
                        }}
                      >
                        Ana Rep
                      </th>

                      {/* Dynamic Parameters (Fills the remaining 59%) */}
                      {AE_HISTORY_PARAMS.map((param) => (
                        <th
                          key={param.key}
                          style={{
                            width: `${59 / AE_HISTORY_PARAMS.length}%`,
                            padding: "14px 4px",
                            borderBottom: "1px solid #e5e7eb",
                            fontWeight: "700",
                          }}
                        >
                          {param.label}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {selectedVesselDetails.reports.length === 0 ? (
                      <tr>
                        <td
                          colSpan={6 + AE_HISTORY_PARAMS.length}
                          style={{
                            padding: "30px",
                            textAlign: "center",
                            color: "#9ca3af",
                          }}
                        >
                          No reports found.
                        </td>
                      </tr>
                    ) : (
                      selectedVesselDetails.reports.map((r, i) => {
                        const load = r.load_percentage || r.load_percent || 0;

                        // --- Status Logic ---
                        let calculatedStatus = "Normal";
                        let critCount = 0;
                        let warnCount = 0;

                        AE_HISTORY_PARAMS.forEach((paramConfig) => {
                          const key = paramConfig.key;
                          const actualVal = r[key];
                          if (actualVal !== null && actualVal !== undefined) {
                            let curve = [];
                            if (r.curves) {
                              if (r.curves[key]) curve = r.curves[key];
                              else {
                                const labelMatch = Object.entries(
                                  r.curves,
                                ).find(([k]) =>
                                  k
                                    .toLowerCase()
                                    .includes(
                                      paramConfig.label
                                        .toLowerCase()
                                        .split(" ")[0],
                                    ),
                                );
                                if (labelMatch) curve = labelMatch[1];
                              }
                            }
                            const baseline = interpolate(load, curve);
                            const { status } = getDeviationStatus(
                              actualVal,
                              baseline,
                              paramConfig.label,
                            );
                            if (status === "critical") critCount++;
                            if (status === "warning") warnCount++;
                          }
                        });

                        if (critCount > 0) calculatedStatus = "Critical";
                        else if (warnCount > 0) calculatedStatus = "Warning";

                        // --- Rename Logic ---
                        const rawName = String(
                          r.generator_designation || r.generator_name || "",
                        ).toUpperCase();
                        let shortGenName = "AE";
                        if (rawName.includes("1")) shortGenName = "AE1";
                        else if (rawName.includes("2")) shortGenName = "AE2";
                        else if (rawName.includes("3")) shortGenName = "AE3";

                        // --- Styles ---
                        const rowBg = i % 2 === 0 ? "#fff" : "#fafafa";

                        let statusColor = "green";
                        if (calculatedStatus === "Critical")
                          statusColor = "red";
                        else if (calculatedStatus === "Warning")
                          statusColor = "yellow";

                        const badgeStyle = {
                          red: {
                            bg: "#fee2e2",
                            text: "#991b1b",
                            border: "#fecaca",
                          },
                          yellow: {
                            bg: "#fef9c3",
                            text: "#854d0e",
                            border: "#fde047",
                          },
                          green: {
                            bg: "#dcfce7",
                            text: "#166534",
                            border: "#bbf7d0",
                          },
                        }[statusColor];

                        // --- Dot Render Helper ---
                        // --- Updated Dot Render Helper ---
                        const renderCell = (paramConfig) => {
                          const key = paramConfig.key;
                          const actualVal = r[key];
                          if (actualVal === null || actualVal === undefined)
                            return <span style={{ color: "#d1d5db" }}>-</span>;

                          const findCurve = () => {
                            if (!r.curves) return [];
                            if (r.curves[key]) return r.curves[key];
                            const labelMatch = Object.entries(r.curves).find(
                              ([k]) =>
                                k
                                  .toLowerCase()
                                  .includes(
                                    paramConfig.label
                                      .toLowerCase()
                                      .split(" ")[0],
                                  ),
                            );
                            if (labelMatch) return labelMatch[1];
                            return [];
                          };

                          const curve = findCurve();
                          const baseline = interpolate(load, curve);

                          // Destructure 'dev' (percentage) from the helper
                          const { status: dotStatus, dev } = getDeviationStatus(
                            actualVal,
                            baseline,
                            paramConfig.label,
                          );

                          let dotColor = "#10b981";
                          if (dotStatus === "warning") dotColor = "#f59e0b";
                          if (dotStatus === "critical") dotColor = "#ef4444";

                          // Format the sign for the percentage
                          const pctSign = dev > 0 ? "+" : "";

                          return (
                            <div
                              style={{
                                display: "flex",
                                justifyContent: "center",
                                alignItems: "center",
                                height: "100%",
                              }}
                            >
                              <div
                                // UPDATED TOOLTIP LOGIC HERE
                                title={`Act: ${safeFixed(actualVal)} | Dev: ${pctSign}${safeFixed(dev, 1)}%`}
                                style={{
                                  width: "10px",
                                  height: "10px",
                                  borderRadius: "50%",
                                  backgroundColor: dotColor,
                                  cursor: "help",
                                }}
                              />
                            </div>
                          );
                        };

                        const cellStyle = {
                          padding: "12px 2px",
                          borderBottom: "1px solid #f3f4f6",
                          fontSize: "0.8rem",
                          color: "#374151",
                          whiteSpace: "nowrap",
                          overflow: "hidden",
                          textOverflow: "ellipsis",
                        };

                        return (
                          <tr key={i} style={{ backgroundColor: rowBg }}>
                            {/* Gen Name - Left Aligned */}
                            <td
                              style={{
                                ...cellStyle,
                                fontWeight: "bold",
                                textAlign: "left",
                                paddingLeft: "24px",
                              }}
                            >
                              {shortGenName}
                            </td>

                            {/* Date - Centered to match other columns */}
                            <td style={{ ...cellStyle }}>
                              {formatDate(r.report_date)}
                            </td>

                            {/* Load - Centered Monospace */}
                            <td
                              style={{
                                ...cellStyle,
                                fontFamily: "monospace",
                                fontWeight: "600",
                              }}
                            >
                              {safeFixed(load, 1)}%
                            </td>

                            {/* Status - Badge */}
                            <td style={cellStyle}>
                              <div
                                style={{
                                  backgroundColor: badgeStyle.bg,
                                  color: badgeStyle.text,
                                  border: `1px solid ${badgeStyle.border}`,
                                  padding: "3px 8px",
                                  borderRadius: "4px",
                                  display: "inline-flex",
                                  alignItems: "center",
                                  gap: "4px",
                                  fontSize: "0.65rem",
                                  fontWeight: "700",
                                  textTransform: "uppercase",
                                }}
                              >
                                <span
                                  style={{
                                    width: "5px",
                                    height: "5px",
                                    borderRadius: "50%",
                                    background: badgeStyle.text,
                                  }}
                                ></span>
                                {calculatedStatus}
                              </div>
                            </td>

                            {/* Monthly Reports */}
                            <td style={cellStyle}>
                              {r.raw_report_view_url ? (
                                <div
                                  style={{
                                    display: "flex",
                                    gap: "8px",
                                    justifyContent: "center",
                                  }}
                                >
                                  <button
                                    onClick={() =>
                                      window.open(
                                        r.raw_report_view_url,
                                        "_blank",
                                      )
                                    }
                                    title="View Raw"
                                    style={{
                                      border: "none",
                                      background: "transparent",
                                      cursor: "pointer",
                                      color: "#4b5563",
                                      padding: 0,
                                    }}
                                  >
                                    <FileText size={15} />
                                  </button>
                                  {/* <button onClick={() => handleDownloadClick(r.raw_report_download_url)} title="Download Raw" style={{ border: 'none', background: 'transparent', cursor: 'pointer', color: '#2563eb', padding: 0 }}><ArrowDownCircle size={15} /></button> */}
                                </div>
                              ) : (
                                <span style={{ color: "#d1d5db" }}>-</span>
                              )}
                            </td>

                            {/* Analytical Reports */}
                            <td
                              style={{
                                ...cellStyle,
                                borderRight: "1px solid #e5e7eb",
                              }}
                            >
                              {r.generated_report_view_url ? (
                                <div
                                  style={{
                                    display: "flex",
                                    gap: "8px",
                                    justifyContent: "center",
                                  }}
                                >
                                  <button
                                    onClick={() =>
                                      window.open(
                                        r.generated_report_view_url,
                                        "_blank",
                                      )
                                    }
                                    title="View Analytical"
                                    style={{
                                      border: "none",
                                      background: "transparent",
                                      cursor: "pointer",
                                      color: "#4b5563",
                                      padding: 0,
                                    }}
                                  >
                                    <FileText size={15} />
                                  </button>
                                  {/* <button onClick={() => handleDownloadClick(r.generated_report_download_url)} title="Download Analytical" style={{ border: 'none', background: 'transparent', cursor: 'pointer', color: '#2563eb', padding: 0 }}><ArrowDownCircle size={15} /></button> */}
                                </div>
                              ) : (
                                <span style={{ color: "#d1d5db" }}>-</span>
                              )}
                            </td>

                            {/* Dynamic Parameters */}
                            {AE_HISTORY_PARAMS.map((param) => (
                              <td key={param.key} style={cellStyle}>
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

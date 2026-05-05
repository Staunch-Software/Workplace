import React, { useEffect, useState, useRef, useMemo } from "react";
import axiosAepms from "../api/axiosAepms";
import {
  Ship,
  Anchor,
  Clock,
  Wrench,
  Activity,
  X,
  Eye,
  Download,
  Loader2,
  LayoutDashboard,
  AlertCircle,
  CheckCircle,
  FileText,
  BarChart2,
  ArrowDownCircle,
  ChevronDown,
  ChevronUp,
  ChevronLeft,
  ChevronRight,
} from "lucide-react";
import { useNavigate, useLocation } from "react-router-dom";
import AppHeader from "../components/AppHeader";
import "../styles/Meresponsiveness.css";
import jsPDF from "jspdf";
import autoTable from "jspdf-autotable";
// import ozellarLogo from "../assets/250714_OzellarMarine-Logo-Final.png";
import PerformanceNav from "./PerformanceNav";
import AEPerformanceOverview from "./AEPerformanceOverview";
import Performance from "./UnifiedPerformance.jsx";

// --- CONSTANTS ---
const COLORS = {
  critical: "#ef4444",
  warning: "#f59e0b",
  normal: "#10b981",
  gray: "#d1d5db",
  noData: "#9ca3af",
};

const getParamUnit = (paramName) => {
  const p = paramName.toLowerCase();
  if (
    p.includes("pmax") ||
    p.includes("pcomp") ||
    p.includes("pmx") ||
    p.includes("pcp")
  )
    return "bar";
  if (p.includes("scav")) return "kg/cm²";
  if (p.includes("sfoc")) return "g/kWh";
  if (p.includes("foc")) return "kg/h";
  if (p.includes("temp") || p.includes("inlet") || p.includes("outlet"))
    return "°C";
  if (p.includes("speed") || p.includes("rpm") || p.includes("t/c"))
    return "RPM";
  if (p.includes("fipi") || p.includes("index")) return "mm";
  if (p.includes("margin") || p.includes("propeller")) return "%";
  return "";
};

const STANDARD_PARAMS = [
  { key: "engspeed", label: "Engine Speed" },
  { key: "turbospeed", label: "Turbo Speed" },
  { key: "fipi", label: "Fuel Pump Index" },
  { key: "pmax", label: "Pmax" },
  { key: "pcomp", label: "Pcomp" },
  { key: "scavair", label: "Scavenge Air Pressure" },
  { key: "exh_t/c_inlet", label: "Exh. T/C Inlet" },
  { key: "exh_t/c_outlet", label: "Exh. T/C Outlet" },
  { key: "exh_cylinder_outlet", label: "Exh. Cylinder Outlet" },
  { key: "sfoc", label: "SFOC" },
  // { key: 'foc', label: 'FOC' },
  { key: "propeller", label: "Power Margin" },
];

// --- CHART COMPONENT ---
const PropellerTrendChart = ({ history }) => {
  const [hoveredPoint, setHoveredPoint] = useState(null);

  const width = 500;
  const height = 120;
  const padding = { top: 15, bottom: 25, left: 40, right: 20 };

  // --- 1. DYNAMIC RANGE CALCULATION ---
  const { Y_MIN, Y_MAX, Y_RANGE } = useMemo(() => {
    let min = -15;
    let max = 15;

    if (history && history.length > 0) {
      const values = history
        .map((h) => Number(h.value))
        .filter((n) => !isNaN(n));
      if (values.length > 0) {
        const dataMin = Math.min(...values);
        const dataMax = Math.max(...values);
        if (dataMin < min) min = dataMin - 2;
        if (dataMax > max) max = dataMax + 2;
      }
    }
    return { Y_MIN: min, Y_MAX: max, Y_RANGE: max - min };
  }, [history]);

  const monthBuckets = useMemo(() => {
    const buckets = [];
    const today = new Date();
    for (let i = 11; i >= 0; i--) {
      const d = new Date(today.getFullYear(), today.getMonth() - i, 1);
      const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
      const label = d.toLocaleDateString("en-US", { month: "short" });
      buckets.push({ index: 11 - i, key, label });
    }
    return buckets;
  }, []);

  const getY = React.useCallback(
    (val) => {
      const clampedVal = Math.max(Y_MIN, Math.min(val, Y_MAX));
      const pct = (clampedVal - Y_MIN) / Y_RANGE;
      const drawingHeight = height - padding.bottom - padding.top;
      return height - padding.bottom - pct * drawingHeight;
    },
    [Y_MIN, Y_MAX, Y_RANGE],
  );

  const getX = React.useCallback((index) => {
    const step = (width - padding.left - padding.right) / 11;
    return padding.left + index * step;
  }, []);

  // --- UPDATED COLOR LOGIC ---
  // > 5     : Critical (Red)
  // 0 to 5  : Warning (Amber)
  // < 0     : Normal (Green)
  // --- UPDATED COLOR LOGIC FOR PROPELLER ---
  const getPointColor = (val) => {
    if (val > 5.0) return "#ef4444"; // Red (> 5%)
    if (val >= 0.0) return "#f59e0b"; // Amber (0 to 5%)
    return "#22c55e"; // Green (< 0%)
  };

  const chartPoints = useMemo(() => {
    if (!history || history.length === 0) return [];

    return history
      .map((h) => {
        const dateObj = new Date(h.date);
        if (isNaN(dateObj.getTime())) return null;
        const key = `${dateObj.getFullYear()}-${String(dateObj.getMonth() + 1).padStart(2, "0")}`;
        const bucketIndex = monthBuckets.findIndex((b) => b.key === key);
        if (bucketIndex === -1) return null;

        const val = Number(h.value);
        if (isNaN(val)) return null;

        return {
          x: getX(bucketIndex),
          y: getY(val),
          value: val,
          index: bucketIndex, // Included to calculate the curve formula
          dateObj: dateObj,
          bucketLabel: monthBuckets[bucketIndex].label,
        };
      })
      .filter(Boolean)
      .sort((a, b) => a.x - b.x);
  }, [history, monthBuckets, Y_MIN, Y_MAX, Y_RANGE, getX, getY]);

  // --- NEW: Quadratic Polynomial Regression (y = ax^2 + bx + c) ---
  const curveCoeffs = useMemo(() => {
    if (chartPoints.length < 3) return null;

    const n = chartPoints.length;
    const x = chartPoints.map((p) => p.index);
    const y = chartPoints.map((p) => p.value);

    let sumX = 0,
      sumX2 = 0,
      sumX3 = 0,
      sumX4 = 0;
    let sumY = 0,
      sumXY = 0,
      sumX2Y = 0;

    for (let i = 0; i < n; i++) {
      sumX += x[i];
      sumX2 += x[i] ** 2;
      sumX3 += x[i] ** 3;
      sumX4 += x[i] ** 4;
      sumY += y[i];
      sumXY += x[i] * y[i];
      sumX2Y += x[i] ** 2 * y[i];
    }

    const A = [
      [n, sumX, sumX2],
      [sumX, sumX2, sumX3],
      [sumX2, sumX3, sumX4],
    ];
    const B = [sumY, sumXY, sumX2Y];

    // Gaussian elimination
    for (let i = 0; i < 3; i++) {
      for (let j = i + 1; j < 3; j++) {
        const ratio = A[j][i] / A[i][i];
        for (let k = i; k < 3; k++) A[j][k] -= ratio * A[i][k];
        B[j] -= ratio * B[i];
      }
    }

    const c = [0, 0, 0];
    for (let i = 2; i >= 0; i--) {
      c[i] = B[i];
      for (let j = i + 1; j < 3; j++) c[i] -= A[i][j] * c[j];
      c[i] /= A[i][i];
    }
    return c;
  }, [chartPoints]);

  // --- NEW: Generate smooth curve SVG points ---
  const smoothCurvePoints = useMemo(() => {
    if (!curveCoeffs || chartPoints.length < 3) return null;

    const minIdx = Math.min(...chartPoints.map((p) => p.index));
    const maxIdx = Math.max(...chartPoints.map((p) => p.index));

    let pointsStr = "";
    // Step by 0.25 on the X-axis to create a smooth curve
    for (let idx = minIdx; idx <= maxIdx; idx += 0.25) {
      const curveVal =
        curveCoeffs[0] + curveCoeffs[1] * idx + curveCoeffs[2] * idx ** 2;
      pointsStr += `${getX(idx)},${getY(curveVal)} `;
    }

    // Cap exactly at the final point
    const lastVal =
      curveCoeffs[0] + curveCoeffs[1] * maxIdx + curveCoeffs[2] * maxIdx ** 2;
    pointsStr += `${getX(maxIdx)},${getY(lastVal)}`;

    return pointsStr.trim();
  }, [curveCoeffs, chartPoints, getX, getY]);

  const polylinePoints = chartPoints.map((p) => `${p.x},${p.y}`).join(" ");
  const showEmptyMessage = chartPoints.length === 0;

  // --- REFERENCE POSITIONS ---
  const yPlusFive = getY(5); // NEW: +5 Line (Critical Threshold)
  const yZero = getY(0); // Baseline (0 Line)
  const yMinusFive = getY(-14); // Warning/Ref Line (-5 Line)

  const yBottom = height - padding.bottom;
  const yTop = padding.top;

  const getTooltipStyle = () => {
    if (!hoveredPoint) return {};
    const xPos = hoveredPoint.x;
    const isVisualHighPoint = hoveredPoint.value > 0;

    let translateX = "-50%";
    let arrowLeft = "50%";
    if (xPos < 60) {
      translateX = "-10%";
      arrowLeft = "10%";
    } else if (xPos > width - 60) {
      translateX = "-90%";
      arrowLeft = "90%";
    }

    return {
      left: `${(xPos / width) * 100}%`,
      top: `calc(${(hoveredPoint.y / height) * 100}% + ${isVisualHighPoint ? "12px" : "-12px"})`,
      transform: `translate(${translateX}, ${isVisualHighPoint ? "0" : "-100%"})`,
      arrowLeft,
      arrowClass: isVisualHighPoint ? "arrow-up" : "arrow-down",
    };
  };
  const tooltipStyle = getTooltipStyle();

  if (!history || history.length === 0) {
    return (
      <div className="text-xs text-gray-400 flex items-center justify-center h-full">
        No Data Available
      </div>
    );
  }

  return (
    <div className="propeller-svg-wrapper">
      <svg
        viewBox={`0 0 ${width} ${height}`}
        preserveAspectRatio="none"
        style={{ width: "100%", height: "100%", overflow: "hidden" }}
      >
        <defs>
          <linearGradient id="gradRed" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="#fee2e2" stopOpacity="0.6" />
            <stop offset="100%" stopColor="#fee2e2" stopOpacity="0.2" />
          </linearGradient>
        </defs>

        {/* --- ZONES (Updated) --- */}

        {/* 1. RED Zone: Top down to +5 Line */}
        <rect
          x={padding.left}
          y={yTop}
          width={width - padding.left - padding.right}
          height={Math.max(0, yPlusFive - yTop)}
          fill="url(#gradRed)"
        />

        {/* 2. AMBER Zone: From +5 Line down to 0 Line */}
        <rect
          x={padding.left}
          y={yPlusFive}
          width={width - padding.left - padding.right}
          height={Math.max(0, yZero - yPlusFive)}
          fill="#fefce8"
          opacity="0.6"
        />

        {/* 3. GREEN Zone: From 0 Line down to Bottom */}
        <rect
          x={padding.left}
          y={yZero}
          width={width - padding.left - padding.right}
          height={Math.max(0, yBottom - yZero)}
          fill="#d7fbe2"
          opacity="0.6"
        />

        {/* --- Reference Lines and Labels --- */}

        {/* NEW: +5 Line (Critical Threshold) - Red Dashed */}
        {yPlusFive >= yTop && yPlusFive <= yBottom && (
          <>
            <line
              x1={padding.left}
              y1={yPlusFive}
              x2={width - padding.right}
              y2={yPlusFive}
              stroke="#ef4444"
              strokeWidth="1"
              strokeDasharray="4 2"
            />
            <text
              x={padding.left - 6}
              y={yPlusFive + 3}
              textAnchor="end"
              fontSize="9"
              fill="#ef4444"
              fontWeight="bold"
            >
              +5
            </text>
          </>
        )}

        {/* 0 Line (Solid Grey) */}
        {yZero >= yTop && yZero <= yBottom && (
          <>
            <line
              x1={padding.left}
              y1={yZero}
              x2={width - padding.right}
              y2={yZero}
              stroke="#64748b"
              strokeWidth="1.5"
              strokeOpacity="0.7"
            />
            <text
              x={padding.left - 6}
              y={yZero + 3}
              textAnchor="end"
              fontSize="9"
              fill="#64748b"
              fontWeight="bold"
            >
              0
            </text>
          </>
        )}

        {/* -5 Line (Visual Reference) - Amber Dashed */}
        {yMinusFive >= yTop && yMinusFive <= yBottom && (
          <>
            <line
              x1={padding.left}
              y1={yMinusFive}
              x2={width - padding.right}
              y2={yMinusFive}
              stroke="#0866ea"
              strokeWidth="1"
              strokeDasharray="4 2"
            />
            <text
              x={padding.left - 6}
              y={yMinusFive + 3}
              textAnchor="end"
              fontSize="9"
              fill="#0866ea"
              fontWeight="bold"
            >
              -14
            </text>
          </>
        )}

        {/* Axis Borders */}
        <line
          x1={padding.left}
          y1={yTop}
          x2={padding.left}
          y2={yBottom}
          stroke="#e2e8f0"
          strokeWidth="1"
        />
        <line
          x1={padding.left}
          y1={yBottom}
          x2={width - padding.right}
          y2={yBottom}
          stroke="#e2e8f0"
          strokeWidth="1"
        />

        {/* Draw a basic straight line if we only have 2 points */}
        {chartPoints.length === 2 && !smoothCurvePoints && (
          <polyline
            points={polylinePoints}
            fill="none"
            stroke="#64748b"
            strokeWidth="2.5"
            strokeLinecap="round"
            strokeLinejoin="round"
            style={{ filter: "drop-shadow(0px 1px 1px rgba(0,0,0,0.1))" }}
          />
        )}

        {/* Draw the smooth quadratic curve if we have >= 3 points */}
        {smoothCurvePoints && (
          <polyline
            points={smoothCurvePoints}
            fill="none"
            stroke="#64748b"
            strokeWidth="2.5"
            strokeLinecap="round"
            strokeLinejoin="round"
            style={{ filter: "drop-shadow(0px 1px 1px rgba(0,0,0,0.1))" }}
          />
        )}

        {chartPoints.map((p, i) => (
          <g key={i}>
            {hoveredPoint?.x === p.x && (
              <line
                x1={p.x}
                y1={p.y}
                x2={p.x}
                y2={yZero}
                stroke={getPointColor(p.value)}
                strokeWidth="1"
                strokeDasharray="2 2"
                opacity="0.5"
              />
            )}
            <circle
              cx={p.x}
              cy={p.y}
              r={hoveredPoint?.x === p.x ? 6 : 4}
              fill={getPointColor(p.value)}
              stroke="white"
              strokeWidth="1.5"
            />
            <circle
              cx={p.x}
              cy={p.y}
              r="15"
              fill="transparent"
              onMouseEnter={() => setHoveredPoint(p)}
              onMouseLeave={() => setHoveredPoint(null)}
              style={{ cursor: "pointer" }}
            />
          </g>
        ))}

        {monthBuckets.map((bucket, i) => (
          <text
            key={bucket.key}
            x={getX(i)}
            y={height - 8}
            textAnchor="middle"
            fontSize="9"
            fill="#94a3b8"
            fontWeight="500"
          >
            {bucket.label}
          </text>
        ))}

        {showEmptyMessage && history.length > 0 && (
          <text
            x={width / 2}
            y={height / 2}
            textAnchor="middle"
            fontSize="12"
            fill="#9ca3af"
            fontWeight="500"
            style={{ pointerEvents: "none" }}
          >
            No recent data in range
          </text>
        )}
      </svg>

      {hoveredPoint && (
        <div
          className="propeller-tooltip"
          style={{
            left: tooltipStyle.left,
            top: tooltipStyle.top,
            transform: tooltipStyle.transform,
          }}
        >
          <div className="propeller-tooltip-value">
            {hoveredPoint.value > 0 ? "+" : ""}
            {hoveredPoint.value.toFixed(1)}%
          </div>
          <div className="propeller-tooltip-date">
            {hoveredPoint.dateObj.toLocaleDateString("en-US", {
              day: "numeric",
              month: "short",
              year: "numeric",
            })}
          </div>
          <div
            style={{
              position: "absolute",
              left: tooltipStyle.arrowLeft,
              marginLeft: "-6px",
              width: 0,
              height: 0,
              borderLeft: "6px solid transparent",
              borderRight: "6px solid transparent",
              [tooltipStyle.arrowClass === "arrow-up" ? "bottom" : "top"]:
                "100%",
              [tooltipStyle.arrowClass === "arrow-up"
                ? "borderBottom"
                : "borderTop"]: "6px solid #1e293b",
            }}
          ></div>
        </div>
      )}
    </div>
  );
};

// --- HELPER FUNCTIONS ---
const safeFixed = (val, digits = 2) => {
  if (val === null || val === undefined || isNaN(val)) return "N/A";
  return Number(val).toFixed(digits);
};

const formatVesselDisplayName = (name) => {
  if (!name) return "";
  return name.toUpperCase().trim();
};

const getInterpolatedBaseline = (reference, paramKey, load) => {
  if (!reference || !paramKey || load == null) return null;
  if (paramKey === "propeller") return 100.0;

  const curve = reference[paramKey];
  if (!Array.isArray(curve) || curve.length === 0) return null;

  const sortedCurve = [...curve].sort((a, b) => a.load - b.load);
  const exactMatch = sortedCurve.find((p) => Math.abs(p.load - load) < 0.01);
  if (exactMatch) return exactMatch.value;

  if (load <= sortedCurve[0].load) return sortedCurve[0].value;
  if (load >= sortedCurve[sortedCurve.length - 1].load)
    return sortedCurve[sortedCurve.length - 1].value;

  for (let i = 0; i < sortedCurve.length - 1; i++) {
    const p1 = sortedCurve[i];
    const p2 = sortedCurve[i + 1];
    if (load >= p1.load && load <= p2.load) {
      return (
        p1.value +
        ((p2.value - p1.value) / (p2.load - p1.load)) * (load - p1.load)
      );
    }
  }
  return null;
};

const getLast12Months = () => {
  const months = [];
  const today = new Date();
  for (let i = 0; i < 12; i++) {
    const d = new Date(today.getFullYear(), today.getMonth() - i, 1);
    months.push({
      label: d.toLocaleDateString("en-US", { month: "short", year: "2-digit" }),
      key: `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`,
    });
  }
  return months;
};

const getParamStatus = (paramName, deviationPct, absoluteDiff, value) => {
  // Standardize parameter name for checking
  const p = paramName.toLowerCase().replace(/[^a-z0-9]/g, "");

  const absDev = Math.abs(deviationPct); // Percentage difference
  const absDelta = Math.abs(absoluteDiff); // Raw unit difference (used for °C)
  const absValue = Math.abs(value); // Raw value or pre-calculated deviation

  if (p.includes("turbo") || p.includes("turbospeed")) {
    if (absDelta >= 1000) return "Critical";
    if (absDelta >= 500) return "Warning";
    return "Normal";
  }
  // 1. Power Margin Logic (Red > 5, Amber 0 to 5, Green < 0)
  if (p.includes("propeller") || p.includes("powermargin")) {
    if (value > 5.0) return "Critical";
    if (value >= 0.0) return "Warning";
    return "Normal";
  }

  // 2. NEW: Exhaust Temperature Logic (Amber: 40°C, Red: 60°C absolute difference)
  // We check this before the percentage groups to ensure absolute limits take priority
  const exhaustKeys = ["exh", "temp", "cyl", "inlet", "outlet"];
  if (exhaustKeys.some((key) => p.includes(key))) {
    if (absDelta > 60) return "Critical";
    if (absDelta >= 40) return "Warning";
    return "Normal";
  }

  // 3. Absolute Deviation Logic for Pmax/Pcomp Dev columns (Red > 5.0, Amber > 3.0)
  // Used when 'value' represents the Bar deviation specifically
  // if (p.includes("pmaxdeviation") || p.includes("pcompdeviation") || p.includes("pmx") || p.includes("pcp")) {
  //     if (absValue > 5.0) return "Critical";
  //     if (absValue >= 3.0) return "Warning";
  //     return "Normal";
  // }

  // 4. Group A: 5% Red / 3% Amber (Pressures, Speeds, RPM)
  const groupA = ["pmax", "pcomp", "engspeed", "rpm"];
  if (groupA.some((key) => p.includes(key))) {
    if (absDev > 5.0) return "Critical";
    if (absDev >= 3.0) return "Warning";
    return "Normal";
  }

  // 5. Group B: 10% Red / 5% Amber (SFOC, FOC, FIPI/Fuel Index, Scavenge Air)
  // (Note: Exhaust strings removed here as they are handled in the absolute logic above)
  const groupB = ["sfoc", "foc", "fipi", "fuelindex", "scav", "scavair"];
  if (groupB.some((key) => p.includes(key))) {
    if (absDev > 10.0) return "Critical";
    if (absDev >= 5.0) return "Warning";
    return "Normal";
  }

  return "Normal";
};

export default function MEPerformanceOverview({ embeddedMode = false }) {
  const [loading, setLoading] = useState(true);
  const [viewOffset, setViewOffset] = useState(0);

  // ── Responsive visible month count — declared FIRST before maxOffset uses it ──
  const getVisibleMonthCount = () => {
    const w = window.innerWidth;
    if (w <= 480)  return 3;
    if (w <= 768)  return 5;
    if (w <= 1024) return 7;
    if (w <= 1250) return 10;
    return 12;
  };
  const [visibleMonthCount, setVisibleMonthCount] = useState(getVisibleMonthCount);
  useEffect(() => {
    const handleResize = () => setVisibleMonthCount(getVisibleMonthCount());
    window.addEventListener("resize", handleResize);
    return () => window.removeEventListener("resize", handleResize);
  }, []);
  const maxOffset = useMemo(() => {
    const today = new Date();
    const startYear = 2025;
    const startMonth = 0; // 0 is January

    // Total months from Jan 2025 to Today
    const totalMonthsSinceStart =
      (today.getFullYear() - startYear) * 12 + today.getMonth();

    const limit = Math.max(0, totalMonthsSinceStart - (visibleMonthCount - 1));
    return limit;
  }, [visibleMonthCount]);

  const visibleMonths = useMemo(() => {
    const months = [];
    const today = new Date();

    for (let i = viewOffset; i < viewOffset + visibleMonthCount; i++) {
      const d = new Date(today.getFullYear(), today.getMonth() - i, 1);

      // STOP generating months if we hit 2024
      if (d.getFullYear() < 2025) break;

      months.push({
        label: d.toLocaleDateString("en-US", {
          month: "short",
          year: "2-digit",
        }),
        key: `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`,
      });
    }
    return months;
  }, [viewOffset, visibleMonthCount]);

  const [daysElapsedData, setDaysElapsedData] = useState([]);
  const [propellerTrendData, setPropellerTrendData] = useState([]);
  const [alertHistory, setAlertHistory] = useState({});
  const [error, setError] = useState(null);
  const [isReportStatusOpen, setIsReportStatusOpen] = useState(false);
  const [isPropellerCardOpen, setIsPropellerCardOpen] = useState(false);
  const [showUnifiedPanel, setShowUnifiedPanel] = useState(false);
  const [unifiedEngineType, setUnifiedEngineType] = useState("mainEngine");
  const [selectedVesselDetails, setSelectedVesselDetails] = useState(null);
  const [isDetailLoading, setIsDetailLoading] = useState(false);
  const detailsSectionRef = useRef(null);
  const tableRowRef = useRef(null);
const [actualRowHeight, setActualRowHeight] = useState(48);
  const propellerCardRef = useRef(null); // Add this
  const [consoleShipId, setConsoleShipId] = useState("");
  const daysElapsedCardRef = useRef(null);
  const controlBarRef = useRef(null);
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [modalHeader, setModalHeader] = useState("");
  const [modalData, setModalData] = useState([]);
  const [filterStatus, setFilterStatus] = useState("ALL");
  const [isDownloading, setIsDownloading] = useState(false);
  const [selectedVesselsFilter, setSelectedVesselsFilter] = useState([]);
  const [isVesselDropdownOpen, setIsVesselDropdownOpen] = useState(false);
  const vesselDropdownRef = useRef(null);
  // ===== Report Status Filter (NEW) =====
  const [selectedDaysVesselsFilter, setSelectedDaysVesselsFilter] = useState(
    [],
  );
  const [isDaysDropdownOpen, setIsDaysDropdownOpen] = useState(false);
  const daysDropdownRef = useRef(null);
const [daysSortConfig, setDaysSortConfig] = useState({
  key: "vessel_name",
  direction: "asc",
});
 const [aeRefreshTrigger, setAeRefreshTrigger] = useState(0);


  // ===== NEW: Download State =====
  const handleDownloadClick = (url) => {
    if (!url) return;
    const link = document.createElement("a");
    link.href = url;
    link.setAttribute("download", "");
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  const handleVesselToggle = (vessel) => {
    setSelectedVesselsFilter((prev) => {
      const exists = prev.find((v) => v.imo_number === vessel.imo_number);
      if (exists) {
        return prev.filter((v) => v.imo_number !== vessel.imo_number);
      } else {
        return [...prev, vessel];
      }
    });
  };

  const handleSelectAllVessels = () => {
    if (selectedVesselsFilter.length === propellerTrendData.length) {
      setSelectedVesselsFilter([]);
    } else {
      setSelectedVesselsFilter(propellerTrendData);
    }
  };

  const handleRemoveVesselTag = (imo) => {
    setSelectedVesselsFilter((prev) =>
      prev.filter((v) => v.imo_number !== imo),
    );
  };

  const filteredPropellerData =
    selectedVesselsFilter.length > 0
      ? propellerTrendData.filter((v) =>
          selectedVesselsFilter.some((s) => s.imo_number === v.imo_number),
        )
      : [];

  // Auto-scroll for Propeller Card
  useEffect(() => {
    // We scroll if it's open AND either it just opened OR the vessel selection changed
    if (isPropellerCardOpen && propellerCardRef.current) {
      setTimeout(() => {
        propellerCardRef.current.scrollIntoView({
          behavior: "smooth",
          block: "start",
        });
      }, 150); // Slightly longer timeout to allow chart rendering
    }
  }, [isPropellerCardOpen, selectedVesselsFilter]); // Added selectedVesselsFilter here
  
  useEffect(() => {
    if (unifiedEngineType === "mainEngine" && consoleShipId) {
      const vessel = daysElapsedData.find(
        (v) => String(v.imo_number) === String(consoleShipId),
      );
      if (vessel) {
        setSelectedDaysVesselsFilter([vessel]);
        setIsReportStatusOpen(true);
      }
    } else if (unifiedEngineType !== "mainEngine") {
      setSelectedDaysVesselsFilter([]);
    } else {
      setSelectedDaysVesselsFilter([]);
    }
  }, [consoleShipId, daysElapsedData, unifiedEngineType]);
  // Auto-scroll for Report Status Card
  useEffect(() => {
    if (isReportStatusOpen && selectedDaysVesselsFilter.length > 0 && daysElapsedCardRef.current) {
      setTimeout(() => {
        if (isPropellerCardOpen && controlBarRef.current) {
          controlBarRef.current.scrollIntoView({
            behavior: "smooth",
            block: "start",
          });
        } else {
          daysElapsedCardRef.current.scrollIntoView({
            behavior: "smooth",
            block: "nearest",
          });
        }
      }, 300);
    }
  }, [selectedDaysVesselsFilter]);
  
  // --- PDF GENERATION ---
  const handlePdfAction = async (actionType) => {
    try {
      setIsDownloading(true);

      const safeHeader = modalHeader || "";
      const parts = safeHeader.split("—").map((s) => s.trim());

      let vesselName = "Unknown Vessel";
      let reportDateStr = "";
      let loadStr = "N/A";

      if (parts.length >= 2) {
        const datePart = parts[parts.length - 1];
        vesselName = parts[parts.length - 2];

        const loadMatch = datePart.match(/\(Load:\s*(.*?)\)/);
        if (loadMatch) {
          loadStr = loadMatch[1];
          reportDateStr = datePart.replace(/\(Load:.*?\)/, "").trim();
        } else {
          reportDateStr = datePart;
        }
      } else {
        vesselName = safeHeader;
      }

      const currentFilter = (filterStatus || "ALL").toUpperCase();

      let pdfRows = modalData.filter((row) => {
        const rowColor = (row.color || "gray").toLowerCase();

        if (currentFilter === "CRITICAL") return rowColor === "red";
        if (currentFilter === "WARNING") return rowColor === "yellow";
        if (currentFilter === "NORMAL")
          return rowColor === "green" || rowColor === "gray";

        return true;
      });

      pdfRows.sort((a, b) => Math.abs(b.devPct) - Math.abs(a.devPct));

      const pdf = new jsPDF("p", "mm", "a4");
      const pageWidth = pdf.internal.pageSize.getWidth();
      const margin = 14;
      let currentY = 15;

      const logoWidth = 35;
      const logoHeight = 14;
      // try {
      //   pdf.addImage(
      //     ozellarLogo,
      //     "PNG",
      //     margin,
      //     currentY,
      //     logoWidth,
      //     logoHeight,
      //   );
      // } catch (e) {
      //   console.warn("Logo missing");
      // }

      const rightX = pageWidth - margin;
      const lineHeight = 5;

      pdf.setFont("helvetica", "bold");
      pdf.setFontSize(14);
      pdf.setTextColor(17, 24, 39);
      pdf.text("ME Performance Report", rightX, currentY + 4, {
        align: "right",
      });

      currentY += 10;
      pdf.setFontSize(10);
      pdf.text(`Vessel: ${vesselName}`, rightX, currentY, { align: "right" });

      currentY += lineHeight;
      pdf.setFont("helvetica", "normal");
      pdf.setFontSize(9);
      pdf.setTextColor(55, 65, 81);
      pdf.text(
        `Load: ${loadStr}  |  Report Date: ${reportDateStr}`,
        rightX,
        currentY,
        { align: "right" },
      );

      currentY += lineHeight;
      const downloadDate = new Date().toLocaleString("en-US", {
        day: "numeric",
        month: "short",
        year: "numeric",
        hour: "2-digit",
        minute: "2-digit",
      });
      pdf.setTextColor(107, 114, 128);
      pdf.setFontSize(8);
      pdf.text(`Downloaded: ${downloadDate}`, rightX, currentY, {
        align: "right",
      });

      currentY += lineHeight + 2;
      let statusColor = [16, 185, 129];
      let statusText = "NORMAL";
      if (currentFilter === "CRITICAL") {
        statusColor = [220, 38, 38];
        statusText = "CRITICAL";
      } else if (currentFilter === "WARNING") {
        statusColor = [217, 119, 6];
        statusText = "WARNING";
      } else if (currentFilter === "ALL") {
        statusColor = [75, 85, 99];
        statusText = "ALL DATA";
      }

      pdf.setFont("helvetica", "bold");
      pdf.setTextColor(...statusColor);
      pdf.text(`STATUS: ${statusText}`, rightX, currentY, { align: "right" });

      const tableColumn = [
        "Parameter",
        "Baseline",
        "Actual",
        "Diff",
        "Deviation %",
      ];
      const tableRows = pdfRows.map((row) => [
        row.parameter,
        safeFixed(row.baseline),
        safeFixed(row.actual),
        (row.diff > 0 ? "+" : "") + safeFixed(row.diff),
        row.baseline
          ? (row.devPct > 0 ? "+" : "") + safeFixed(row.devPct, 1) + "%"
          : "-",
      ]);

      autoTable(pdf, {
        startY: currentY + 10,
        head: [tableColumn],
        body: tableRows,
        theme: "grid",
        headStyles: {
          fillColor: [243, 244, 246],
          textColor: [17, 24, 39],
          fontStyle: "bold",
          lineWidth: 0.1,
          lineColor: [209, 213, 219],
        },
        styles: {
          fontSize: 9,
          cellPadding: 4,
          lineColor: [229, 231, 235],
          lineWidth: 0.1,
          textColor: [55, 65, 81],
        },
        columnStyles: {
          0: { fontStyle: "bold", cellWidth: 50 },
          1: { halign: "right" },
          2: { halign: "right", fontStyle: "bold" },
          3: { halign: "right" },
          4: { halign: "right" },
        },
        didParseCell: function (data) {
          if (data.section === "body") {
            const rawRow = pdfRows[data.row.index];
            if (rawRow) {
              const color = (rawRow.color || "gray").toLowerCase();
              if (color === "red") {
                data.cell.styles.fillColor = [254, 242, 242];
                data.cell.styles.textColor = [185, 28, 28];
              } else if (color === "yellow") {
                data.cell.styles.fillColor = [255, 251, 235];
                data.cell.styles.textColor = [180, 83, 9];
              } else if (color === "green") {
                data.cell.styles.fillColor = [240, 253, 244];
                data.cell.styles.textColor = [21, 128, 61];
              }
            }
          }
        },
      });

      if (actionType === "download") {
        const cleanName = vesselName.replace(/[^a-z0-9]/gi, "_");
        pdf.save(`${cleanName}_${statusText}_Report.pdf`);
      } else {
        window.open(pdf.output("bloburl"), "_blank");
      }
    } catch (err) {
      console.error("PDF generation failed:", err);
      alert("PDF export failed.");
    } finally {
      setIsDownloading(false);
    }
  };
  // ===== Days Elapsed Filter Functions (NEW) =====
  const handleDaysVesselToggle = (vessel) => {
    setSelectedDaysVesselsFilter((prev) => {
      const exists = prev.find((v) => v.imo_number === vessel.imo_number);
      if (exists) return prev.filter((v) => v.imo_number !== vessel.imo_number);
      return [...prev, vessel];
    });
  };

  const handleSelectAllDaysVessels = () => {
    if (selectedDaysVesselsFilter.length === daysElapsedData.length) {
      setSelectedDaysVesselsFilter([]);
    } else {
      setSelectedDaysVesselsFilter(daysElapsedData);
    }
  };

  // filtered table data for report status card
  const filteredDaysElapsedData = useMemo(() => {
    // 1. Filter by selected vessels
    let data =
      selectedDaysVesselsFilter.length > 0
        ? daysElapsedData.filter((v) =>
            selectedDaysVesselsFilter.some(
              (s) => s.imo_number === v.imo_number,
            ),
          )
        : [...daysElapsedData];

    // 2. Sort the data
    data.sort((a, b) => {
      const key = daysSortConfig.key;
      const dir = daysSortConfig.direction;

      // Default Alphabetical Sort
      if (key === "vessel_name") {
        return (a.vessel_name || "").localeCompare(b.vessel_name || "");
      }

      // Numeric Sort for Days Elapsed
      const valA = a[key] || 0;
      const valB = b[key] || 0;

      if (valA < valB) return dir === "asc" ? -1 : 1;
      if (valA > valB) return dir === "asc" ? 1 : -1;
      return 0;
    });

    return data;
  }, [daysElapsedData, selectedDaysVesselsFilter, daysSortConfig]);

  // Function to handle the cycle: Default -> Desc -> Asc -> Default
  const handleDaysSort = () => {
    if (daysSortConfig.key === "vessel_name") {
      // From Default to Descending (Highest days first)
      setDaysSortConfig({ key: "days_elapsed", direction: "desc" });
    } else if (daysSortConfig.direction === "desc") {
      // From Descending to Ascending (Lowest days first)
      setDaysSortConfig({ key: "days_elapsed", direction: "asc" });
    } else {
      // Back to Default (Alphabetical)
      setDaysSortConfig({ key: "vessel_name", direction: "asc" });
    }
  };

  // ... handlePdfAction function ends ...

  // ADD THIS BLOCK:
  useEffect(() => {
    const handleClickOutside = (event) => {
      // close propeller dropdown
      if (
        vesselDropdownRef.current &&
        !vesselDropdownRef.current.contains(event.target)
      ) {
        setIsVesselDropdownOpen(false);
      }

      // close days elapsed dropdown
      if (
        daysDropdownRef.current &&
        !daysDropdownRef.current.contains(event.target)
      ) {
        setIsDaysDropdownOpen(false);
      }
    };

    document.addEventListener("mousedown", handleClickOutside);
    return () => {
      document.removeEventListener("mousedown", handleClickOutside);
    };
  }, []);

  // --- DATA FETCHING ---
  // --- DATA FETCHING ---
  const fetchDashboardData = async (isSilentRefresh = false) => {
    try {
      if (!isSilentRefresh) setLoading(true);
      setError(null);
      const [daysResponse, marginResponse] = await Promise.all([
        axiosAepms.getDaysElapsedOverview(),
        axiosAepms.getPropellerMarginTrend(),
      ]);

      const vessels = (daysResponse.data || []).sort((a, b) =>
        (a.vessel_name || "").localeCompare(b.vessel_name || ""),
      );

      const propellerData = (marginResponse.data || []).sort((a, b) =>
        (a.vessel_name || "").localeCompare(b.vessel_name || ""),
      );

      setDaysElapsedData(vessels);
      setPropellerTrendData(propellerData);

      await fetchAlertHistory(vessels);
    } catch (err) {
      setError(err.message || "Failed to load performance data");
    } finally {
      if (!isSilentRefresh) setLoading(false);
    }
  };

  useEffect(() => {
    fetchDashboardData(false);
  }, []);

  useEffect(() => {
  if (tableRowRef.current) {
    const firstRow = tableRowRef.current.querySelector('tbody tr');
    if (firstRow) {
      setActualRowHeight(firstRow.getBoundingClientRect().height);
    }
  }
}, [filteredDaysElapsedData]);
  // const fetchAlertHistory = async (vessels) => {
  //     const historyMap = {};
  //     const monthBuckets = getLast12Months();
  //     const promises = vessels.map(async (v) => {
  //         try {
  //             const imo = v.imo_number || v.imo;
  //             const response = await axiosAepms.getMEAlertHistory(imo, 60);
  //             let reports = response.history || response.data || [];

  //             const processedReports = reports.map(r => {
  //                 let counts = { Critical: 0, Warning: 0, Normal: 0 };

  //                 const checkMap = [
  //                     { key: 'pmax', histKey: 'pmax' },
  //                     { key: 'pcomp', histKey: 'pcomp' },
  //                     { key: 'scavair', histKey: 'scav' },
  //                     { key: 'turbospeed', histKey: 'turbo_rpm' },
  //                     { key: 'engspeed', histKey: 'engine_rpm' },
  //                     { key: 'foc', histKey: 'foc' },
  //                     { key: 'sfoc', histKey: 'sfoc' },
  //                     { key: 'exh_cylinder_outlet', histKey: 'exh_cyl_out' },
  //                     { key: 'exh_t/c_inlet', histKey: 'exh_tc_in' },
  //                     { key: 'exh_t/c_outlet', histKey: 'exh_tc_out' },
  //                     { key: 'propeller', histKey: 'propeller_margin' },
  //                     { key: 'fipi', histKey: 'fuel_index' },
  //                 ];

  //                 checkMap.forEach(item => {
  //                     const actual = r[`${item.histKey}_actual`];
  //                     const dev = r[`${item.histKey}_dev`];

  //                     let s = "Normal";
  //                     if (actual !== null && actual !== undefined) {
  //                         let baseline = actual - (dev || 0);
  //                         if (item.key === 'propeller') baseline = 100;
  //                         let devPct = 0;
  //                         if (baseline !== 0) devPct = (dev / baseline) * 100;
  //                         s = getParamStatus(item.key, devPct, dev, actual);
  //                         if (counts[s] !== undefined) counts[s]++;
  //                         else counts['Normal']++;
  //                     }
  //                 });

  //                 const maxCount = Math.max(counts.Critical, counts.Warning, counts.Normal);
  //                 let dominantStatus = "Normal";
  //                 if (maxCount === 0) dominantStatus = "No Data";
  //                 else {
  //                     if (counts.Critical === maxCount) dominantStatus = "Critical";
  //                     else if (counts.Warning === maxCount) dominantStatus = "Warning";
  //                 }

  //                 let color = COLORS.normal;
  //                 if (dominantStatus === 'Critical') color = COLORS.critical;
  //                 else if (dominantStatus === 'Warning') color = COLORS.warning;
  //                 else if (dominantStatus === 'No Data') color = COLORS.noData;

  //                 const d = new Date(r.report_date);
  //                 const monthKey = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
  //                 return { ...r, status: dominantStatus, color, monthKey };
  //             });

  //             const timeline = monthBuckets.map(bucket => {
  //                 const matches = processedReports.filter(r => r.monthKey === bucket.key);
  //                 matches.sort((a, b) => new Date(a.report_date) - new Date(b.report_date));
  //                 return { hasData: matches.length > 0, label: bucket.label, reports: matches };
  //             });
  //             processedReports.sort((a, b) => new Date(b.report_date) - new Date(a.report_date));
  //             historyMap[imo] = { timeline, flatReports: processedReports };
  //         } catch (e) {
  //             historyMap[v.imo_number] = { timeline: monthBuckets.map(b => ({ hasData: false, label: b.label, reports: [] })), flatReports: [] };
  //         }
  //     });
  //     await Promise.all(promises);
  //     setAlertHistory(historyMap);
  // };
  const fetchAlertHistory = async (vessels) => {
    const historyMap = {};
    const monthBuckets = getLast12Months();
    const promises = vessels.map(async (v) => {
      try {
        const imo = v.imo_number || v.imo;
        const response = await axiosAepms.getMEAlertHistory(imo, 60);
        let reports = response.history || response.data || [];

        const processedReports = reports.map((r) => {
          let counts = { Critical: 0, Warning: 0, Normal: 0 };

          const checkMap = [
            { key: "engspeed", histKey: "engine_rpm" },
            { key: "turbospeed", histKey: "turbo_rpm" },
            { key: "fipi", histKey: "fuel_index" },
            { key: "pmax", histKey: "pmax" },
            { key: "pcomp", histKey: "pcomp" },
            { key: "scavair", histKey: "scav" },
            { key: "exh_t/c_inlet", histKey: "exh_tc_in" },
            { key: "exh_t/c_outlet", histKey: "exh_tc_out" },
            { key: "exh_cylinder_outlet", histKey: "exh_cyl_out" },
            { key: "sfoc", histKey: "sfoc" },
            // { key: 'foc', histKey: 'foc' },
            { key: "propeller", histKey: "propeller_margin" },
          ];

          checkMap.forEach((item) => {
            const actual = r[`${item.histKey}_actual`];
            const dev = r[`${item.histKey}_dev`];

            let s = "Normal";
            if (actual !== null && actual !== undefined) {
              let baseline = actual - (dev || 0);
              if (item.key === "propeller") baseline = 100;
              let devPct = 0;
              if (baseline !== 0) devPct = (dev / baseline) * 100;

              // Determine status for this specific parameter
              s = getParamStatus(item.key, devPct, dev, actual);

              if (counts[s] !== undefined) counts[s]++;
              else counts["Normal"]++;
            }
          });

          // --- 🔥 UPDATED LOGIC START: Strict Severity Check ---
          // If ANY parameter is Critical -> Report is Critical
          // Else if ANY parameter is Warning -> Report is Warning
          // Else -> Normal

          let dominantStatus = "Normal";

          if (counts.Critical > 0) {
            dominantStatus = "Critical";
          } else if (counts.Warning > 0) {
            dominantStatus = "Warning";
          } else if (
            counts.Normal === 0 &&
            counts.Critical === 0 &&
            counts.Warning === 0
          ) {
            // Edge case: Report exists but no parameters matched/parsed
            dominantStatus = "No Data";
          }
          // --- UPDATED LOGIC END ---

          let color = COLORS.normal;
          if (dominantStatus === "Critical") color = COLORS.critical;
          else if (dominantStatus === "Warning") color = COLORS.warning;
          else if (dominantStatus === "No Data") color = COLORS.noData;

          const d = new Date(r.report_date);
          const monthKey = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
          return { ...r, status: dominantStatus, color, monthKey };
        });

        const timeline = monthBuckets.map((bucket) => {
          const matches = processedReports.filter(
            (r) => r.monthKey === bucket.key,
          );
          matches.sort(
            (a, b) => new Date(a.report_date) - new Date(b.report_date),
          );
          return {
            hasData: matches.length > 0,
            label: bucket.label,
            reports: matches,
          };
        });
        processedReports.sort(
          (a, b) => new Date(b.report_date) - new Date(a.report_date),
        );
        historyMap[imo] = { timeline, flatReports: processedReports };
      } catch (e) {
        historyMap[v.imo_number] = {
          timeline: monthBuckets.map((b) => ({
            hasData: false,
            label: b.label,
            reports: [],
          })),
          flatReports: [],
        };
      }
    });
    await Promise.all(promises);
    setAlertHistory(historyMap);
  };

  const handleVesselNameClick = async (vessel) => {
    const imo = vessel.imo_number || vessel.imo;
    const data = alertHistory[imo];

    if (data && data.flatReports && data.flatReports.length > 0) {
      window.scrollTo({ top: 0, behavior: "smooth" });
      setIsDetailLoading(true);
      const latestMcrLimit = data.flatReports[0]?.mcr_limit_kw || null;
      setSelectedVesselDetails({
        name: vessel.vessel_name,
        imo: imo,
        reports: [],
        baselineData: {},
      });

      setTimeout(() => {
        if (detailsSectionRef.current)
          detailsSectionRef.current.scrollIntoView({
            behavior: "smooth",
            block: "start",
          });
      }, 100);

      try {
        let baselineData = {};
        try {
          const baselineRes = await axiosAepms.getMEBaselineReference(imo);
          const rawBaseline = baselineRes.baseline_data || [];
          STANDARD_PARAMS.forEach((param) => {
            const key = param.key;
            const points = rawBaseline
              .filter((p) => p[key])
              .map((p) => ({
                load: Number(p.load_percentage),
                value: Number(p[key]),
              }))
              .sort((a, b) => a.load - b.load);
            if (points.length > 0) baselineData[key] = points;
          });
        } catch (e) {
          console.warn("Failed baseline fetch", e);
        }

        const detailedReportsPromises = data.flatReports.map(async (report) => {
          try {
            const detailRes = await axiosAepms.getMEAlertDetails(
              report.report_id,
            );
            return {
              ...report,
              mcr_limit_kw: detailRes.mcr_limit_kw || report.mcr_limit_kw,
              mcr_limit_percentage:
                detailRes.mcr_limit_percentage || report.mcr_limit_percentage,
              formatted_actuals: detailRes.formatted_actuals || {},
              raw_report_view_url: detailRes.raw_report_view_url,
              raw_report_download_url: detailRes.raw_report_download_url,
              generated_report_view_url: detailRes.generated_report_view_url,
              generated_report_download_url:
                detailRes.generated_report_download_url,
            };
          } catch (err) {
            return { ...report, formatted_actuals: {} };
          }
        });

        const enrichedReports = await Promise.all(detailedReportsPromises);

        // --- NEW LOGIC START: Filter for Last 6 Months ---
        const cutoffDate = new Date();
        cutoffDate.setMonth(cutoffDate.getMonth() - 6);

        const filteredReports = enrichedReports.filter((report) => {
          if (!report.report_date) return false;
          const reportDate = new Date(report.report_date);
          return reportDate >= cutoffDate;
        });
        // --- NEW LOGIC END ---

        setSelectedVesselDetails({
          name: vessel.vessel_name,
          imo: imo,
          mcr_limit_kw: latestMcrLimit,
          reports: filteredReports, // Updated to use filtered list
          baselineData: baselineData,
        });
      } catch (e) {
        console.error("Error fetching detailed history:", e);
      } finally {
        setIsDetailLoading(false);
      }
    } else {
      console.warn("No reports found for vessel:", vessel.vessel_name);
    }
  };

  const handleDotClick = async (
    vesselName,
    summaryReport,
    reportTitle = "",
    autoDownload = false,
  ) => {
    const imo =
      summaryReport.imo_number ||
      daysElapsedData.find((v) => v.vessel_name === vesselName)?.imo_number;

    let reportData = {};
    if (summaryReport.report_id) {
      try {
        const detailResponse = await axiosAepms.getMEAlertDetails(
          summaryReport.report_id,
        );
        reportData = detailResponse.formatted_actuals || {};
      } catch (err) {
        console.warn("Could not fetch full report details.", err);
      }
    }

    const currentLoad =
      Number(reportData.load_percentage) ||
      Number(summaryReport.load_percentage) ||
      85;

    let dynamicBaseline = {};
    if (imo) {
      try {
        const baselineRes = await axiosAepms.getMEBaselineReference(imo);
        const rawBaseline = baselineRes.baseline_data || [];

        STANDARD_PARAMS.forEach((param) => {
          const key = param.key;
          const points = rawBaseline
            .filter((p) => p[key] !== null && p[key] !== undefined)
            .map((p) => ({
              load: Number(p.load_percentage),
              value: Number(p[key]),
            }))
            .sort((a, b) => a.load - b.load);
          if (points.length > 0) dynamicBaseline[key] = points;
        });
      } catch (e) {
        console.warn("Could not fetch baseline", e);
      }
    }

    const formatted = STANDARD_PARAMS.map((param) => {
      const key = param.key;
      const actual =
        reportData[key] !== undefined ? Number(reportData[key]) : null;
      if (actual === null) return null;

      const devKeyMapping = {
        pmax: "pmax_dev",
        scavair: "scav_dev",
        turbospeed: "turbo_rpm_dev",
        sfoc: "sfoc_dev",
        foc: "foc_dev",
        pcomp: "pcomp_dev",
        "exh_t/c_inlet": "exh_tc_in_dev",
        "exh_t/c_outlet": "exh_tc_out_dev",
        exh_cylinder_outlet: "exh_cyl_out_dev",
        fipi: "fuel_index_dev",
        engspeed: "engine_rpm_dev",
      };

      const apiDevKey = devKeyMapping[key];
      let diff = 0;
      let baseline = null;
      let devPct = 0;

      if (key === "propeller") {
        // Backend returns the deviation (e.g., 0.57)
        baseline = 100.0;
        diff = actual; // The difference is the value itself (0.57)
        devPct = actual; // The deviation % is the same (0.57%)

        // We calculate the display value as 100 + deviation
        const displayActual = 100.0 + actual;

        return {
          parameter: param.label,
          unit: getParamUnit(param.label),
          baseline: 100.0,
          actual: displayActual, // This will now show 100.57
          diff: diff, // This will now show +0.57
          devPct: devPct, // This will now show +0.6%
          color: actual > 5.0 ? "red" : actual > 0 ? "yellow" : "green",
        };
      }

      if (
        apiDevKey &&
        reportData[apiDevKey] !== undefined &&
        reportData[apiDevKey] !== null
      ) {
        const apiDev = Number(reportData[apiDevKey]);
        diff = apiDev;
        baseline = actual - diff;
        if (baseline !== 0) devPct = (diff / baseline) * 100;
      } else if (key === "propeller") {
        baseline = 100.0;
        diff = baseline - actual;
        devPct = diff;
      } else {
        const interpolated = getInterpolatedBaseline(
          dynamicBaseline,
          key,
          currentLoad,
        );
        if (interpolated !== null) baseline = interpolated;
        if (baseline !== null && baseline !== 0) {
          diff = actual - baseline;
          devPct = (diff / baseline) * 100;
        }
      }

      const status = getParamStatus(param.key, devPct, diff, actual);
      let rowColor = "green";
      if (status === "Critical") rowColor = "red";
      else if (status === "Warning") rowColor = "yellow";

      return {
        parameter: param.label,
        unit: getParamUnit(param.label),
        baseline,
        actual,
        diff,
        devPct,
        color: rowColor,
      };
    }).filter((item) => item !== null);

    setModalData(formatted);
    let strictStatus = summaryReport.status || "Normal";
    setFilterStatus(strictStatus);

    const titlePrefix = reportTitle ? `${reportTitle} — ` : "";
    setModalHeader(
      `${titlePrefix}${vesselName} — ${formatDate(summaryReport.report_date)} (Load: ${currentLoad.toFixed(1)}%)`,
    );
    setIsModalOpen(true);

    if (autoDownload) {
      setTimeout(() => handlePdfAction("download"), 300);
    }
  };

  const formatDate = (dateString) => {
    if (!dateString) return "N/A";
    try {
      return new Date(dateString).toLocaleDateString("en-US", {
        year: "numeric",
        month: "short",
        day: "numeric",
      });
    } catch {
      return dateString;
    }
  };

  const getDaysColor = (days) => {
    if (days > 60) return { bg: "#fee2e2", text: "#dc2626", dot: "#dc2626" };
    if (days > 45) return { bg: "#fef3c7", text: "#ca8a04", dot: "#ca8a04" };
    return { bg: "#d1fae5", text: "#16a34a", dot: "#16a34a" };
  };

  if (loading)
    return (
      <div className="me-performance-container">
        <div className="loading-state-performance">
          <div className="loading-spinner-performance"></div>
          <p>Loading...</p>
        </div>
      </div>
    );
  if (error)
    return (
      <div className="me-performance-container">
        <div className="error-card-performance">
          <p>Error: {error}</p>
        </div>
      </div>
    );

  return (
    <>
      {/* <PerformanceNav /> */}
      <AppHeader />
      <div
        className="me-performance-container aepms-engine-console"
        style={{
          width: "100%",
          paddingTop: embeddedMode ? "0" : "80px" /* clears fixed header */,
          paddingLeft: embeddedMode ? "0" : "50px",
          paddingRight: embeddedMode ? "0" : "50px",
          paddingBottom: embeddedMode ? "0" : "50px",
        }}
      >
        <div className="performance-cards-grid">
          {/* CARD 1: Propeller Margin */}
          <div
            ref={propellerCardRef}
            className="performance-data-card enhanced-card propeller-card"
          >
            <div
              className={`card-header-enhanced ${!isPropellerCardOpen ? "header-closed" : ""}`}
              style={{ cursor: "pointer" }}
              onClick={() => setIsPropellerCardOpen(!isPropellerCardOpen)}
            >
              {/* Icon */}
              <div className="card-icon-badge pulsing-icon">
                <Anchor size={16} />
              </div>

              {/* Title Group */}
              <div className="card-title-group">
                <h2 className="card-title-performance">
                  Propeller Margin Performance
                </h2>
                <p className="card-description">
                  Current margin status & 12-month trend
                </p>
              </div>

              {/* Dropdown Filter - Right Side */}
              <div
                className="vessel-filter-wrapper"
                ref={vesselDropdownRef}
                onClick={(e) => e.stopPropagation()}
              >
                <div style={{ position: "relative" }}>
                  <button
                    className={`vessel-dropdown-btn ${isVesselDropdownOpen ? "active" : ""}`}
                    onClick={(e) => {
                      e.stopPropagation();
                      setIsPropellerCardOpen(true);
                      setIsVesselDropdownOpen(!isVesselDropdownOpen);
                    }}
                  >
                    <div className="vessel-dropdown-icon">
                      <span>
                        {selectedVesselsFilter.length === 0
                          ? "Select the vessel"
                          : selectedVesselsFilter.length ===
                              propellerTrendData.length
                            ? "✓ All"
                            : selectedVesselsFilter.length === 1
                              ? `✓ ${selectedVesselsFilter[0]?.vessel_name?.toUpperCase() || "1 Vessel Selected"}`
                              : `✓ ${selectedVesselsFilter.length} Vessels Selected`}
                      </span>
                    </div>
                    <ChevronDown size={18} color="#64748b" />
                  </button>

                  {/* Dropdown Menu */}
                  {isVesselDropdownOpen && (
                    <div
                      className="vessel-dropdown-menu"
                      onClick={(e) => e.stopPropagation()}
                    >
                      <div className="vessel-dropdown-sticky">
                        <div
                          className="vessel-select-all-item"
                          onClick={handleSelectAllVessels}
                        >
                          {/* Added pointerEvents: none to label */}
                          <label
                            className="vessel-select-all-label"
                            style={{ pointerEvents: "none" }}
                          >
                            <input
                              type="checkbox"
                              className="vessel-checkbox"
                              checked={
                                selectedVesselsFilter.length ===
                                  propellerTrendData.length &&
                                propellerTrendData.length > 0
                              }
                              readOnly // Changed to readOnly
                            />
                            Select All
                          </label>
                        </div>
                      </div>

                      <div
                        className="vessel-dropdown-scroll"
                        style={{ maxHeight: "144px", overflowY: "auto" }}
                      >
                        {propellerTrendData.map((vessel) => (
                          <div
                            key={vessel.imo_number}
                            className={`vessel-item ${selectedVesselsFilter.some((v) => v.imo_number === vessel.imo_number) ? "selected" : ""}`}
                            onClick={() => handleVesselToggle(vessel)}
                          >
                            {/* Added pointerEvents: none to label so the parent DIV handles the click */}
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
                                readOnly // Changed to readOnly
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

              {/* --- FIXED BIG CHEVRON BUTTON --- */}
              <div
                className="propeller-chevron-btn"
                onClick={(e) => {
                  e.stopPropagation();
                  setIsPropellerCardOpen(!isPropellerCardOpen);
                }}
              >
                {isPropellerCardOpen ? (
                  <ChevronUp
                    size={25}
                    color="#475569"
                    strokeWidth={2.5}
                  /> /* Increased Size & Stroke */
                ) : (
                  <ChevronDown size={25} color="#475569" strokeWidth={2.5} />
                )}
              </div>
            </div>
            {/* ... Body content remains the same ... */}

            {isPropellerCardOpen && (
              <div
                className="card-body-enhanced"
                style={{ padding: 0, overflow: "visible" }}
              >
                {selectedVesselsFilter.length > 0 ? (
                  <div className="performance-grid-wrapper propeller-grid-wrapper">
                    {/* GRID CONTAINER: 2 Columns (50% each) */}
                    <div className="propeller-responsive-grid">
                      {filteredPropellerData.map((vessel, index) => {
                        const margin = vessel.current_margin;

                        // --- Color Logic ---
                        let marginColor = "#dcfce7";
                        let textColor = "#166534";
                        let borderColor = "#bbf7d0";
                        let dotColor = "#22c55e";
                        let cardBg = "#ffffff";
                        let cardBorderColor = "#e2e8f0";

                        if (margin > 5.0) {
                          // CRITICAL (Red) - Above +5.0
                          marginColor = "#fee2e2";
                          textColor = "#991b1b";
                          borderColor = "#fecaca";
                          dotColor = "#ef4444";
                        } else if (margin > 0.0) {
                          // WARNING (Amber) - Between 0.0 and 5.0
                          marginColor = "#fef9c3";
                          textColor = "#854d0e";
                          borderColor = "#fde047";
                          dotColor = "#eab308";
                        }

                        // --- Chart Data Logic ---
                        let graphHistory = [];
                        const vesselAlerts = alertHistory[vessel.imo_number];

                        const getPropellerDeviation = (val) => {
                          if (val === null || val === undefined) return null;
                          const num = Number(val);
                          return Math.abs(num) > 50 ? num - 100 : num;
                        };

                        if (
                          vesselAlerts &&
                          vesselAlerts.flatReports &&
                          vesselAlerts.flatReports.length > 0
                        ) {
                          graphHistory = vesselAlerts.flatReports
                            .map((r) => {
                              const rawValue =
                                r.propeller_margin_actual ??
                                r.parameters?.find(
                                  (p) => p.parameter === "propeller",
                                )?.actual ??
                                null;
                              return {
                                date: r.report_date,
                                value: getPropellerDeviation(rawValue),
                              };
                            })
                            .filter((item) => item.value !== null);
                        } else {
                          graphHistory = (vessel.history || [])
                            .map((h) => ({
                              date: h.date,
                              value: getPropellerDeviation(h.value),
                            }))
                            .filter((item) => item.value !== null);
                        }

                        // --- CARD RENDER ---
                        return (
                          <div
                            key={vessel.imo_number}
                            className="propeller-vessel-card"
                            style={{
                              backgroundColor: cardBg,
                              border: `1px solid ${cardBorderColor}`,
                              animationDelay: `${index * 0.05}s`,
                            }}
                          >
                            {/* HEADER: Name & Value */}
                            <div className="propeller-vessel-header">
                              {/* Left: Vessel Name */}
                              <div className="propeller-vessel-name-block">
                                <div
                                  className="propeller-vessel-dot blinking-dot"
                                  style={{ background: dotColor }}
                                />
                                <span className="propeller-vessel-name">
                                  {formatVesselDisplayName(vessel.vessel_name)}
                                </span>
                              </div>

                              {/* Right: Label + Badge (Replaces Table Header) */}
                              <div className="propeller-badge-col">
                                <span className="propeller-badge-label">
                                  Latest Power Margin (%)
                                </span>
                                <span
                                  className="propeller-margin-badge"
                                  style={{
                                    backgroundColor: marginColor,
                                    color: textColor,
                                    border: `1px solid ${borderColor}`,
                                  }}
                                >
                                  {margin !== null
                                    ? `${margin > 0 ? "+" : ""}${margin.toFixed(1)}%`
                                    : "N/A"}
                                </span>
                              </div>
                            </div>

                            {/* BODY: Chart */}
                            <div className="propeller-chart-area">
                              <div className="propeller-chart-container">
                                <PropellerTrendChart history={graphHistory} />
                              </div>
                            </div>
                          </div>
                        );
                      })}
                    </div>

                    {filteredPropellerData.length === 0 && (
                      <div className="propeller-no-data">
                        <p>No propeller data available matching criteria</p>
                      </div>
                    )}
                  </div>
                ) : (
                  <div className="propeller-empty-state">
                    <p>
                      👆 Select one or more vessels above to view their
                      propeller margin performance
                    </p>
                  </div>
                )}
              </div>
            )}
          </div>

          {/* ===== UNIFIED PERFORMANCE CARD ===== */}
          <div ref={controlBarRef} style={{ width: "100%", minWidth: 0 }}>
            <Performance
              embeddedMode={true}
              onEngineTypeChange={(type) => {
                setUnifiedEngineType(type);
                setSelectedVesselDetails(null);
                setSelectedDaysVesselsFilter([]);
              }}
              onShipChange={(id) => {
                setConsoleShipId(id);
                setSelectedVesselDetails(null);
                setSelectedDaysVesselsFilter([]);
              }}
              onUploadSuccess={() => {
                // If ME is active, refresh ME data silently. If AE, bump AE trigger.
                if (unifiedEngineType === "mainEngine") {
                  fetchDashboardData(true); 
                } else {
                  setAeRefreshTrigger(prev => prev + 1);
                }
              }}
            />
          </div>

          {/* Alert Summary Card */}
          {/* Alert Summary Card */}
          {/* Alert Summary Card */}
          {consoleShipId &&
            (unifiedEngineType === "mainEngine" ? (
              <div
                ref={daysElapsedCardRef}
                className="performance-data-card enhanced-card days-card"
              >
                <div
                  className={`card-header-enhanced ${!isReportStatusOpen ? "header-closed" : ""}`}
                  style={{ cursor: "pointer" }}
                  onClick={() => setIsReportStatusOpen(!isReportStatusOpen)}
                >
                  <div className="card-icon-badge pulsing-icon">
                    <Clock size={24} />
                  </div>

                  <div className="card-title-group">
                    <h2 className="card-title-performance">
                      Report Status - Days Elapsed
                    </h2>
                    <p className="card-description">
                      Time since last report & 12-Month Alert History
                    </p>
                  </div>

                  {/* Dropdown Filter - Report Status */}
                  <div
                    className="vessel-filter-wrapper"
                    ref={daysDropdownRef}
                    onClick={(e) => e.stopPropagation()}
                  >
                    <div style={{ position: "relative" }}>
                      <button
                        className={`vessel-dropdown-btn ${isDaysDropdownOpen ? "active" : ""}`}
                        disabled={!consoleShipId}
                        onClick={(e) => {
                          e.stopPropagation();
                          setIsReportStatusOpen(true);
                          setIsDaysDropdownOpen(!isDaysDropdownOpen);
                        }}
                      >
                        <div className="vessel-dropdown-icon">
                          <span>
                            {selectedDaysVesselsFilter.length === 0
                              ? "Select the vessel"
                              : selectedDaysVesselsFilter.length ===
                                  daysElapsedData.length
                                ? "✓ All"
                                : selectedDaysVesselsFilter.length === 1
                                    ? `✓ ${selectedDaysVesselsFilter[0]?.vessel_name?.toUpperCase() || "1 Vessel Selected"}`
                                  : `✓ ${selectedDaysVesselsFilter.length} Vessels Selected`}
                          </span>
                        </div>
                        <ChevronDown size={18} color="#64748b" />
                      </button>

                      {/* Dropdown Menu */}
                      {isDaysDropdownOpen && (
                        <div
                          className="vessel-dropdown-menu"
                          onClick={(e) => e.stopPropagation()}
                        >
                          <div className="vessel-dropdown-sticky">
                            <div
                              className="vessel-select-all-item"
                              onClick={handleSelectAllDaysVessels}
                            >
                              {/* Added pointerEvents: none */}
                              <label
                                className="vessel-select-all-label"
                                style={{ pointerEvents: "none" }}
                              >
                                <input
                                  type="checkbox"
                                  className="vessel-checkbox"
                                  checked={
                                    selectedDaysVesselsFilter.length ===
                                      daysElapsedData.length &&
                                    daysElapsedData.length > 0
                                  }
                                  readOnly
                                />
                                Select All
                              </label>
                            </div>
                          </div>

                          <div className="vessel-dropdown-scroll">
                            {daysElapsedData.map((vessel) => (
                              <div
                                key={vessel.imo_number}
                                className={`vessel-item ${selectedDaysVesselsFilter.some((v) => v.imo_number === vessel.imo_number) ? "selected" : ""}`}
                                onClick={() => handleDaysVesselToggle(vessel)}
                              >
                                {/* Added pointerEvents: none so the parent DIV handles the click */}
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
                                    checked={selectedDaysVesselsFilter.some(
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

                  {/* --- FIXED BIG CHEVRON BUTTON --- */}
                  <div
                    className="days-chevron-btn"
                    onClick={(e) => {
                      e.stopPropagation();
                      setIsReportStatusOpen(!isReportStatusOpen);
                    }}
                  >
                    {isReportStatusOpen ? (
                      <ChevronUp size={24} color="#475569" strokeWidth={2.5} /> /* Increased Size & Stroke */
                    ) : (
                      <ChevronDown size={24} color="#475569" strokeWidth={2.5} />
                    )}
                  </div>
                </div>
                {/* ... Body content remains the same ... */}

                {isReportStatusOpen && (
                  <div className="card-body-enhanced days-card-body">
                    {consoleShipId && selectedDaysVesselsFilter.length > 0 ? (
                      /* 1. WRAPPER: Height set to approx 380px to show ~6 vessels cleanly */
                      <div
  className="performance-table-wrapper days-table-wrapper"
  ref={tableRowRef}
  style={{
    maxHeight: filteredDaysElapsedData.length > 6
      ? `${(6 * actualRowHeight) + 42 + 36}px`
      : 'none',
    overflowY: filteredDaysElapsedData.length > 6 ? 'auto' : 'hidden'
  }}
>
                        <table className="performance-table-modern days-table">
                          <thead className="days-thead">
                            <tr>
                              {/* STICKY 1: Vessel Name (Width 160) */}
                              <th className="days-th-vessel">Vessel Name</th>

                              {/* STICKY 2: Last Report (Width 100) */}
                              <th className="days-th-lastReport">
                                Last Report
                              </th>

                              {/* STICKY 3: Days (Width 65) */}
                              {/* STICKY 3: Days (Width 65) with Sort Arrows */}
                              <th
                                className={`days-th-days ${daysSortConfig.key === "days_elapsed" ? "days-th-days--sorted" : ""}`}
                                onClick={handleDaysSort}
                              >
                                <div className="days-sort-header-inner">
                                  Days
                                  <div className="days-sort-arrows">
                                    <ChevronUp
                                      size={10}
                                      className={
                                        daysSortConfig.key === "days_elapsed" &&
                                        daysSortConfig.direction === "asc"
                                          ? "days-sort-arrow--active"
                                          : "days-sort-arrow--inactive"
                                      }
                                    />
                                    <ChevronDown
                                      size={10}
                                      className={
                                        daysSortConfig.key === "days_elapsed" &&
                                        daysSortConfig.direction === "desc"
                                          ? "days-sort-arrow--active"
                                          : "days-sort-arrow--inactive"
                                      }
                                    />
                                  </div>
                                </div>
                              </th>

                              {/* STICKY 4: Load % (Width 70) */}
                              <th className="days-th-load">Load %</th>

                              {/* STICKY 5: Nav Button Left (Width 45) */}
                              <th className="days-th-nav-left">
                                <button
                                  className={`days-nav-btn ${viewOffset === 0 ? "days-nav-btn--disabled" : ""}`}
                                  onClick={() =>
                                    setViewOffset((curr) =>
                                      Math.max(0, curr - 1),
                                    )
                                  }
                                  disabled={viewOffset === 0}
                                >
                                  <ChevronLeft size={16} strokeWidth={2} color="#374151" />
                                </button>
                              </th>

                              {/* SCROLLABLE MONTHS (Width 75 for professional expansion) */}
                              {visibleMonths.map((m, i) => {
                                const isLatestMonth =
                                  i === 0 && viewOffset === 0;
                                return (
                                  <th
                                    key={i}
                                    className={`days-th-month ${isLatestMonth ? "days-th-month--current" : ""}`}
                                  >
                                    {m.label}
                                  </th>
                                );
                              })}

                              {/* NAV BUTTON RIGHT */}
                              <th className="days-th-nav-right">
                                <button
                                  className={`days-nav-btn ${viewOffset >= maxOffset ? "days-nav-btn--disabled" : ""}`}
                                  onClick={() =>
                                    setViewOffset((curr) =>
                                      Math.min(maxOffset, curr + 1),
                                    )
                                  }
                                  disabled={viewOffset >= maxOffset}
                                >
                                  <ChevronRight size={16} strokeWidth={2} color="#374151" />
                                </button>
                              </th>
                            </tr>
                          </thead>

                          <tbody>
                            {filteredDaysElapsedData.map((vessel) => {
                              const colors = getDaysColor(vessel.days_elapsed);
                              return (
                                <tr
                                  key={vessel.imo_number}
                                  className="table-row-enhanced days-tr"
                                >
                                  {/* 1. VESSEL NAME: No width change needed here, just the sticky logic */}
                                  {/* 1. VESSEL NAME (left: 0) */}
                                  <td
                                    className="days-td-vessel"
                                    onClick={() =>
                                      handleVesselNameClick(vessel)
                                    }
                                  >
                                    <div className="days-vessel-name-inner">
                                      <div
                                        className="status-dot blinking-dot"
                                        style={{ background: colors.dot }}
                                      />
                                      <span className="days-vessel-name-text">
                                        {formatVesselDisplayName(vessel.vessel_name)}
                                      </span>
                                    </div>
                                  </td>

                                  {/* 2. LAST REPORT (left: 160) */}
                                  <td className="days-td-lastReport">
                                    {formatDate(vessel.report_date)}
                                  </td>

                                  {/* 3. DAYS (left: 260) */}
                                  <td className="days-td-days">
                                    <span
                                      className={`days-badge ${vessel.days_elapsed > 60 ? "days-critical" : vessel.days_elapsed > 45 ? "days-warning" : "days-success"}`}
                                    >
                                      {vessel.days_elapsed}
                                    </span>
                                  </td>

                                  {/* 4. LOAD % (left: 325) */}
                                  <td className="days-td-load">
                                    {(() => {
                                      const loadVal =
                                        vessel.load_percentage ||
                                        alertHistory[vessel.imo_number]
                                          ?.flatReports[0]?.load_percentage;
                                      const loadNum = parseFloat(loadVal);
                                      let bgColor = "#f3f4f6";
                                      let textColor = "#6b7280";
                                      if (!isNaN(loadNum)) {
                                        if (loadNum < 60) {
                                          bgColor = "#fee2e2";
                                          textColor = "#dc2626";
                                        } else if (loadNum <= 75) {
                                          bgColor = "#fef3c7";
                                          textColor = "#ca8a04";
                                        } else {
                                          bgColor = "#d1fae5";
                                          textColor = "#16a34a";
                                        }
                                      }
                                      return (
                                        <span
                                          className="days-load-badge"
                                          style={{
                                            backgroundColor: bgColor,
                                            color: textColor,
                                          }}
                                        >
                                          {loadNum
                                            ? `${loadNum.toFixed(1)}%`
                                            : "N/A"}
                                        </span>
                                      );
                                    })()}
                                  </td>

                                  {/* 5. SPACER UNDER NAV BUTTON (left: 395) */}
                                  <td className="days-td-spacer"></td>
                                  {visibleMonths.map((bucket, i) => {
                                    // 1. Define if this is the latest month (matches Header logic)
                                    const isLatestMonth =
                                      i === 0 && viewOffset === 0;

                                    const vesselReports =
                                      alertHistory[vessel.imo_number]
                                        ?.flatReports || [];
                                    const reportsForMonth =
                                      vesselReports.filter(
                                        (r) => r.monthKey === bucket.key,
                                      );
                                    const hasData = reportsForMonth.length > 0;

                                    return (
                                      <td
                                        key={bucket.key}
                                        className={`days-td-month ${isLatestMonth ? "days-td-month--current" : ""}`}
                                      >
                                        <div className="days-dots-wrapper">
                                          {hasData ? (
                                            reportsForMonth.map(
                                              (report, rIndex) => (
                                                <div
                                                  key={rIndex}
                                                  className="days-dot"
                                                  onClick={(e) => {
                                                    e.stopPropagation();
                                                    handleDotClick(
                                                      vessel.vessel_name,
                                                      report,
                                                    );
                                                  }}
                                                  style={{
                                                    backgroundColor:
                                                      report?.color ||
                                                      "#e5e7eb",
                                                  }}
                                                />
                                              ),
                                            )
                                          ) : (
                                            <div className="days-dot--empty" />
                                          )}
                                        </div>
                                      </td>
                                    );
                                  })}
                                  <td className="days-td-tail"></td>
                                </tr>
                              );
                            })}
                          </tbody>

                          {/* --- FOOTER (Fixed to BOTTOM) --- */}
                          <tfoot className="days-tfoot">
                            <tr>
                              <td
                                colSpan="4"
                                className="days-tfoot-th-sticky"
                              ></td>

                              {/* Footer Spacer matched to 395px */}
                              <td className="days-tfoot-th-spacer"></td>

                              {visibleMonths.map((m, i) => {
                                const isLatestMonth =
                                  i === 0 && viewOffset === 0;
                                return (
                                  <td
                                    key={i}
                                    className={`days-tfoot-th-month ${isLatestMonth ? "days-tfoot-th-month--current" : ""}`}
                                  >
                                    {m.label}
                                  </td>
                                );
                              })}
                              <td className="days-tfoot-th-tail"></td>
                            </tr>
                          </tfoot>
                        </table>
                      </div>
                    ) : (
                      <div className="days-empty-state">
                        <p>
                          👆 Select one or more vessels above to view Report
                          Status
                        </p>
                      </div>
                    )}
                  </div>
                )}
              </div>
            ) : (
              <AEPerformanceOverview
                embeddedMode={true}
                externalVesselId={consoleShipId}
                refreshTrigger={aeRefreshTrigger}
              />
            ))}

          {/* DETAILED ANALYSIS */}
          {/* DETAILED ANALYSIS */}
          {selectedVesselDetails && unifiedEngineType === "mainEngine" && (
            <div ref={detailsSectionRef} className="performance-data-card enhanced-card detail-card">
              <div className="card-header-enhanced">
                <div className="card-icon-badge">
                  <LayoutDashboard size={24} />
                </div>
                <div className="card-title-group">
                  <h2 className="card-title-performance">
                    {selectedVesselDetails.name} — Detailed History
                  </h2>
                  <p className="card-description">
                    {isDetailLoading
                      ? "Fetching detailed ISO corrected data..."
                      : "Complete historical performance data."}
                  </p>
                </div>
                <button onClick={() => setSelectedVesselDetails(null)} className="detail-close-btn">
                  <X size={24} color="#6b7280" />
                </button>
              </div>

              <div className="card-body-enhanced">
                {isDetailLoading ? (
                  <div className="detail-loading-wrapper">
                    <Loader2
                      className="animate-spin"
                      size={32}
                      color="#111827"
                    />
                    <p className="detail-loading-text">Loading report details...</p>
                  </div>
                ) : (
                  /* FIX 1: tableLayout: 'fixed' ensures strict column widths */
                  <div className="detail-table-wrapper">
                  <table className="detail-table">
                    <thead>
                      <tr>
                        {/* Metadata Columns */}
                        <th title="Report Date" className="detail-th-date">Date</th>
                        <th title="Engine Power (kW)" className="detail-th-power">Power</th>
                        <th title="MCR Power Limit (kW)" className="detail-th-mcr">MCR Lim</th>
                        <th title="Engine Load Percentage" className="detail-th-load">Load%</th>
                        <th title="Report Status (Critical/Warning/Normal)" className="detail-th-status">Sts</th>
                        <th title="Raw Report" className="detail-th-raw">Raw</th>
                        <th title="Analytical Report" className="detail-th-ana">Ana</th>

                        {/* Parameter Columns */}
                        {/* <th title="Engine Speed (RPM)" style={{ width: '5.25%', padding: '10px 2px', borderBottom: '1px solid #e5e7eb', fontWeight: '700', cursor: 'help' }}>RPM</th> */}
                        <th title="Power Margin"                      className="detail-th-param">Power</th>
                        <th title="Turbocharger Speed"                className="detail-th-param">T/C</th>
                        <th title="Fuel Index Pump Indicator"         className="detail-th-param">FIPI</th>
                        <th title="Maximum Pressure (Pmax)"           className="detail-th-param">Pmax</th>
                        <th title="Pmax Deviation"                    className="detail-th-param">ΔPmx</th>
                        <th title="Compression Pressure (Pcomp)"      className="detail-th-param">Pcomp</th>
                        <th title="Pcomp Deviation"                   className="detail-th-param">ΔPcp</th>
                        <th title="Scavenge Air Pressure"             className="detail-th-param">Scav</th>
                        <th title="Exhaust Gas Temp - T/C Inlet"      className="detail-th-param">TC In</th>
                        <th title="Exhaust Gas Temp - T/C Outlet"     className="detail-th-param">TC Out</th>
                        <th title="Exhaust Gas Temp - Cylinder Outlet" className="detail-th-param">Cyl Out</th>
                      </tr>
                    </thead>
                    <tbody>
                      {selectedVesselDetails.reports.map((r, i) => {
                        const details = r.formatted_actuals || {};
                        const power =
                          details.power || r.shaft_power_kw || r.power_kw;
                        const load =
                          details.load_percentage || r.load_percentage;
                        const powerValue = power ? Number(power) : null;
                        const mcrLimit = r.mcr_limit_kw
                          ? Number(r.mcr_limit_kw)
                          : null;

                        const rowBg = i % 2 === 0 ? "#fff" : "#fafafa";
                        let isRedAlert = false;
                        if (powerValue !== null && mcrLimit !== null) {
                          const diff = mcrLimit - powerValue;
                          const tenPercentThreshold = mcrLimit * 0.1;

                          // Only triggers if Power is LOWER than the limit by more than 10%
                          if (diff > tenPercentThreshold) {
                            isRedAlert = true;
                          }
                        }

                        const renderParamCell = (paramKey) => {
                          const actualVal = details[paramKey];
                          if (actualVal === null || actualVal === undefined) {
                            return <span className="detail-null">-</span>;
                          }

                          const actualNum = Number(actualVal);
                          const currentLoad = load ? Number(load) : 0;
                          let status = "Normal";
                          let tooltipText = "";

                          // --- 1. SET REFERENCE KEY FOR STATUS LOGIC ---
                          // If the key is a Delta column, we point the logic to the Parent parameter
                          let referenceKey = paramKey;
                          if (paramKey === "pmax_dev") referenceKey = "pmax";
                          if (paramKey === "pcomp_dev") referenceKey = "pcomp";

                          // --- 2. CALCULATE STATUS & TOOLTIP ---

                          // Special Logic for Power Margin (Propeller)
                          if (paramKey === "propeller") {
                            const baseline = 100.0;
                            const diff = actualNum;
                            const devPct = actualNum;
                            status = getParamStatus(
                              paramKey,
                              devPct,
                              diff,
                              actualNum,
                            );

                            tooltipText = `Actual: ${(100 + actualNum).toFixed(2)} (Dev: ${actualNum >= 0 ? "+" : ""}${actualNum.toFixed(1)}%) - ${status}`;
                          }
                          // Logic for Standard Metrics AND Deviation Columns
                          else {
                            // We always fetch the baseline for the referenceKey (e.g., Shop Trial Pmax)
                            const baseline = getInterpolatedBaseline(
                              selectedVesselDetails.baselineData,
                              referenceKey,
                              currentLoad,
                            );

                            if (baseline !== null && baseline !== 0) {
                              // For Delta columns, the 'diff' is the actualNum (e.g., +9.0 Bar).
                              // For Main columns, we calculate diff as Actual - Baseline.
                              const diff =
                                paramKey === "pmax_dev" ||
                                paramKey === "pcomp_dev"
                                  ? actualNum
                                  : actualNum - baseline;

                              const devPct = (diff / baseline) * 100;

                              // We pass referenceKey to getParamStatus so Pmax and ΔPMX run the exact same logic
                              status = getParamStatus(
                                referenceKey,
                                devPct,
                                diff,
                                actualNum,
                              );

                              if (
                                paramKey === "pmax_dev" ||
                                paramKey === "pcomp_dev"
                              ) {
                                tooltipText = `${actualNum >= 0 ? "+" : ""}${actualNum.toFixed(2)} Bar (${status})`;
                              } else {
                                tooltipText = `${actualNum.toFixed(2)} (Dev: ${devPct >= 0 ? "+" : ""}${devPct.toFixed(1)}%) - ${status}`;
                              }
                            } else {
                              tooltipText = `${actualNum.toFixed(2)} - No Baseline`;
                            }
                          }

                          // --- 3. RENDER DOT ---
                          let dotColor = "#10b981"; // Green
                          if (status === "Critical")
                            dotColor = "#ef4444"; // Red
                          else if (status === "Warning") dotColor = "#f59e0b"; // Amber

                          return (
  <div className="detail-param-dot-wrapper">
    <div title={tooltipText} className="detail-param-dot" style={{ backgroundColor: dotColor }} />
  </div>
);
                        };


                        let overallColor = "green";
                        if (r.status === "Critical") overallColor = "red";
                        else if (r.status === "Warning")
                          overallColor = "yellow";

                        const getStatusIcon = (c) => {
                          if (c === "red")
                            return <AlertCircle size={16} color="#dc2626" />;
                          if (c === "yellow")
                            return <AlertCircle size={16} color="#d97706" />;
                          return <CheckCircle size={16} color="#16a34a" />;
                        };

                        return (
                          <tr key={i} style={{ backgroundColor: rowBg }}>
                            <td className="detail-td--date">{formatDate(r.report_date)}</td>
                            <td className={`detail-td--num detail-td--power${isRedAlert ? " detail-td--alert" : ""}`}>
  {powerValue !== null ? powerValue.toLocaleString() : "-"}
</td>

                            <td className="detail-td--num detail-td--mcr" title={r.mcr_limit_percentage != null ? `MCR Limit Percentage: ${r.mcr_limit_percentage}%` : "No percentage data"}>
  {r.mcr_limit_kw != null ? Number(r.mcr_limit_kw).toLocaleString() : "-"}
</td>
                            <td className="detail-td--num detail-td--load">{load ? Number(load).toFixed(1) + "%" : "-"}</td>

                            <td className="detail-td detail-td--status">
  <div className="detail-status-icon" title={r.status}>
    {getStatusIcon(overallColor)}
  </div>
</td>

                            <td className="detail-td detail-td--raw">
  {r.raw_report_view_url ? (
    <div className="detail-report-btns">
      <button onClick={() => window.open(r.raw_report_view_url, "_blank")} title="View Raw" className="detail-report-btn">
        <FileText size={14} />
      </button>
    </div>
  ) : (
    <span className="detail-null">-</span>
  )}
</td>

                            <td className="detail-td detail-td--ana">
  {r.generated_report_view_url ? (
    <div className="detail-report-btns">
      <button onClick={() => window.open(r.generated_report_view_url, "_blank")} title="View Analytical" className="detail-report-btn">
        <FileText size={14} />
      </button>
    </div>
  ) : (
    <span className="detail-null">-</span>
  )}
</td>

                            {/* <td style={cellStyle}>{renderParamCell('engspeed')}</td> */}
                            <td className="detail-td--param">{renderParamCell("propeller")}</td>
                            <td className="detail-td--param">{renderParamCell("turbospeed")}</td>
                            <td className="detail-td--param">{renderParamCell("fipi")}</td>
                            <td className="detail-td--param">{renderParamCell("pmax")}</td>
                            <td className="detail-td--param">{renderParamCell("pmax_dev")}</td>
                            <td className="detail-td--param">{renderParamCell("pcomp")}</td>
                            <td className="detail-td--param">{renderParamCell("pcomp_dev")}</td>
                            <td className="detail-td--param">{renderParamCell("scavair")}</td>
                            <td className="detail-td--param">{renderParamCell("exh_t/c_inlet")}</td>
                            <td className="detail-td--param">{renderParamCell("exh_t/c_outlet")}</td>
                            <td className="detail-td--param">{renderParamCell("exh_cylinder_outlet")}</td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                  </div>
                )}
              </div>
            </div>
          )}
        </div>

        {/* ===== MODAL ===== */}
        {isModalOpen &&
          (() => {
            if (!modalData || !Array.isArray(modalData)) return null;

            const currentFilter = (filterStatus || "ALL").toUpperCase();

            let visibleRows = modalData.filter((row) => {
              const rowColor = (row.color || "gray").toLowerCase();
              if (currentFilter === "CRITICAL") return rowColor === "red";
              if (currentFilter === "WARNING") return rowColor === "yellow";
              if (currentFilter === "NORMAL")
                return rowColor === "green" || rowColor === "gray";
              return true;
            });

            visibleRows.sort((a, b) => Math.abs(b.devPct) - Math.abs(a.devPct));

            let headerColor = "#10b981";
            if (currentFilter === "CRITICAL") headerColor = "#ef4444";
            if (currentFilter === "WARNING") headerColor = "#f59e0b";

            const getRowStyle = (color) => {
              switch (color) {
                case "red":
                  return {
                    borderLeft: "4px solid #ef4444",
                    bg: "#fef2f2",
                    text: "#b91c1c",
                  };
                case "yellow":
                  return {
                    borderLeft: "4px solid #f59e0b",
                    bg: "#fffbeb",
                    text: "#b45309",
                  };
                case "green":
                  return {
                    borderLeft: "4px solid #10b981",
                    bg: "#f0fdf4",
                    text: "#15803d",
                  };
                default:
                  return {
                    borderLeft: "4px solid #d1d5db",
                    bg: "#ffffff",
                    text: "#374151",
                  };
              }
            };

            return (
              <div
                className="modal-overlay"
                onClick={() => setIsModalOpen(false)}
                style={{
                  position: "fixed",
                  top: 0,
                  left: 0,
                  right: 0,
                  bottom: 0,
                  backgroundColor: "rgba(0, 0, 0, 0.6)",
                  display: "flex",
                  justifyContent: "center",
                  alignItems: "center",
                  zIndex: 9999,
                  backdropFilter: "blur(3px)",
                }}
              >
                <div
                  className="modal-content"
                  onClick={(e) => e.stopPropagation()}
                  style={{
                    width: "900px",
                    maxHeight: "85vh",
                    display: "flex",
                    flexDirection: "column",
                    backgroundColor: "white",
                    borderRadius: "12px",
                    boxShadow: "0 25px 50px -12px rgba(0,0,0,0.25)",
                    overflow: "hidden",
                  }}
                >
                  <div
                    id="pdf-content"
                    style={{
                      display: "flex",
                      flexDirection: "column",
                      height: "100%",
                      overflow: "hidden",
                    }}
                  >
                    <div
                      style={{
                        padding: "16px 24px",
                        borderBottom: "1px solid #e5e7eb",
                        display: "flex",
                        justifyContent: "space-between",
                        alignItems: "center",
                        backgroundColor: "#f9fafb",
                        flexShrink: 0,
                      }}
                    >
                      <div
                        style={{
                          display: "flex",
                          alignItems: "center",
                          gap: "12px",
                        }}
                      >
                        <h2
                          style={{
                            fontSize: "1.15rem",
                            fontWeight: "700",
                            color: "#111827",
                            margin: 0,
                          }}
                        >
                          {modalHeader}
                        </h2>
                        <div
                          style={{
                            display: "flex",
                            alignItems: "center",
                            gap: "6px",
                            fontSize: "0.9rem",
                            color: "#374151",
                            backgroundColor: "#fff",
                            padding: "4px 10px",
                            borderRadius: "20px",
                            border: "1px solid #e5e7eb",
                          }}
                        >
                          <span
                            style={{
                              height: "10px",
                              width: "10px",
                              borderRadius: "50%",
                              backgroundColor: headerColor,
                              display: "inline-block",
                            }}
                          ></span>
                          <span
                            style={{
                              fontWeight: "600",
                              textTransform: "uppercase",
                              fontSize: "0.8rem",
                            }}
                          >
                            Status: {filterStatus}
                          </span>
                        </div>
                      </div>
                      <button
                        className="modal-close-btn"
                        onClick={() => setIsModalOpen(false)}
                        style={{
                          border: "none",
                          background: "#e5e7eb",
                          borderRadius: "4px",
                          cursor: "pointer",
                          padding: "4px",
                          display: "flex",
                        }}
                      >
                        <X size={20} color="#4b5563" />
                      </button>
                    </div>

                    <div
                      className="modal-scroll-area"
                      style={{
                        padding: "0",
                        overflowY: "auto",
                        backgroundColor: "#ffffff",
                      }}
                    >
                      <table
                        style={{
                          width: "100%",
                          borderCollapse: "collapse",
                          fontSize: "0.9rem",
                        }}
                      >
                        <thead
                          style={{ position: "sticky", top: 0, zIndex: 10 }}
                        >
                          <tr
                            style={{
                              backgroundColor: "#f8fafc",
                              color: "#64748b",
                              textTransform: "uppercase",
                              fontSize: "0.75rem",
                              letterSpacing: "0.05em",
                              boxShadow: "0 1px 2px rgba(0,0,0,0.05)",
                            }}
                          >
                            <th
                              style={{
                                padding: "10px 24px",
                                textAlign: "left",
                                fontWeight: "600",
                              }}
                            >
                              Parameter
                            </th>
                            <th
                              style={{
                                padding: "10px 24px",
                                textAlign: "right",
                                fontWeight: "600",
                              }}
                            >
                              Baseline
                            </th>
                            <th
                              style={{
                                padding: "10px 24px",
                                textAlign: "right",
                                fontWeight: "600",
                              }}
                            >
                              Actual
                            </th>
                            <th
                              style={{
                                padding: "10px 24px",
                                textAlign: "right",
                                fontWeight: "600",
                              }}
                            >
                              Δ (Diff)
                            </th>
                            <th
                              style={{
                                padding: "10px 24px",
                                textAlign: "right",
                                fontWeight: "600",
                              }}
                            >
                              Deviation %
                            </th>
                          </tr>
                        </thead>
                        <tbody>
                          {visibleRows.length > 0 ? (
                            visibleRows.map((row, index) => {
                              const style = getRowStyle(row.color || "gray");
                              const diffPrefix = row.diff >= 0 ? "+" : "";
                              const pctPrefix = row.devPct >= 0 ? "+" : "";

                              return (
                                <tr
                                  key={index}
                                  style={{
                                    borderBottom: "1px solid #f1f5f9",
                                    backgroundColor: style.bg,
                                  }}
                                >
                                  <td
                                    style={{
                                      padding: "10px 24px",
                                      borderLeft: style.borderLeft,
                                      fontWeight: "600",
                                      color: "#1f2937",
                                    }}
                                  >
                                    {row.parameter}
                                    {/* 🔥 ADD THE UNIT DISPLAY HERE */}
                                    <span
                                      style={{
                                        fontSize: "0.75rem",
                                        color: "#94a3b8",
                                        marginLeft: "6px",
                                        fontWeight: "500",
                                      }}
                                    >
                                      ({row.unit})
                                    </span>
                                  </td>
                                  <td
                                    style={{
                                      padding: "10px 24px",
                                      textAlign: "right",
                                      fontFamily: "monospace",
                                      color: "#6b7280",
                                    }}
                                  >
                                    {safeFixed(row.baseline)}
                                  </td>
                                  <td
                                    style={{
                                      padding: "10px 24px",
                                      textAlign: "right",
                                      fontFamily: "monospace",
                                      color: "#111827",
                                      fontWeight: "700",
                                    }}
                                  >
                                    {safeFixed(row.actual)}
                                  </td>
                                  <td
                                    style={{
                                      padding: "10px 24px",
                                      textAlign: "right",
                                      fontFamily: "monospace",
                                      color: style.text,
                                      fontWeight: "700",
                                    }}
                                  >
                                    {diffPrefix}
                                    {safeFixed(row.diff)}
                                  </td>
                                  <td
                                    style={{
                                      padding: "10px 24px",
                                      textAlign: "right",
                                      fontFamily: "monospace",
                                      color: style.text,
                                      fontWeight: "700",
                                    }}
                                  >
                                    {row.baseline
                                      ? `${pctPrefix}${safeFixed(row.devPct, 1)}%`
                                      : "-"}
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
                                  fontStyle: "italic",
                                }}
                              >
                                No {filterStatus.toLowerCase()} parameters found
                                in this report.
                              </td>
                            </tr>
                          )}
                        </tbody>
                      </table>
                    </div>

                    <div
                      data-html2canvas-ignore="true"
                      style={{
                        padding: "16px 24px",
                        borderTop: "1px solid #e5e7eb",
                        display: "flex",
                        gap: "12px",
                        flexShrink: 0,
                        backgroundColor: "#fff",
                        justifyContent: "flex-end",
                      }}
                    >
                      {/* <button onClick={() => handlePdfAction('preview')} disabled={isDownloading} style={{ backgroundColor: '#fff', color: '#374151', border: '1px solid #d1d5db', padding: '8px 16px', borderRadius: '6px', fontSize: '0.875rem', fontWeight: '500', cursor: isDownloading ? 'wait' : 'pointer', display: 'flex', alignItems: 'center', gap: '8px', opacity: isDownloading ? 0.7 : 1 }}>{isDownloading ? <Loader2 size={16} className="animate-spin" /> : <Eye size={16} />} Preview PDF</button> */}
                      <button
                        onClick={() => handlePdfAction("download")}
                        disabled={isDownloading}
                        style={{
                          backgroundColor: "#111827",
                          color: "white",
                          border: "none",
                          padding: "8px 16px",
                          borderRadius: "6px",
                          fontSize: "0.875rem",
                          fontWeight: "500",
                          cursor: isDownloading ? "wait" : "pointer",
                          display: "flex",
                          alignItems: "center",
                          gap: "8px",
                          opacity: isDownloading ? 0.7 : 1,
                        }}
                      >
                        {isDownloading ? (
                          <Loader2 size={16} className="animate-spin" />
                        ) : (
                          <Download size={16} />
                        )}{" "}
                        Export PDF
                      </button>
                    </div>
                  </div>
                </div>
              </div>
            );
          })()}
      </div>
    </>
  );
}

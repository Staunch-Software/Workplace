// src/components/VesselMonthlyPerformance.jsx (FIXED MONTHLY FILTER)
import React, { useState, useMemo, useEffect } from 'react';
import { Card, CardContent, CardHeader, CardDescription } from './ui/Card';
import ReactDOM from 'react-dom'; 
import Select from './ui/Select';
import Button from './ui/Button';
import jsPDF from "jspdf";
// import OzellarLogo from "../assets/250714_OzellarMarine-Logo-Final.jpg";

// =======================================================================
// DESIGN SYSTEM - BLACK/ASH/GRAY Color System
// =======================================================================
// Convert image URL to Base64 so jsPDF can embed it
const toBase64 = (url) =>
  fetch(url)
    .then((res) => res.blob())
    .then(
      (blob) =>
        new Promise((resolve) => {
          const reader = new FileReader();
          reader.onloadend = () => resolve(reader.result);
          reader.readAsDataURL(blob);
        })
    );

// Extract vessel name from modalHeader
const vesselNameFromHeader = (header) => {
  if (!header) return "N/A";
  return header.split(" — ")[0] || "N/A";
};

const getMonthName = (dateString) => {
  try {
    const dt = new Date(dateString);
    if (isNaN(dt)) return "N/A";
    return dt.toLocaleString("en-US", { month: "long" });
  } catch {
    return "N/A";
  }
};




const COLORS = {
  dark: '#1a1a1a',
  ash: '#3a3a3a',
  gray900: '#525252',
  gray700: '#737373',
  gray500: '#a3a3a3',
  gray300: '#d4d4d4',
  gray200: '#e5e5e5',
  gray100: '#f5f5f5',
  success: '#10b981',
  warning: '#f59e0b',
  danger: '#ef4444',
  white: '#ffffff'
};

const FONTS = {
  primary: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif',
  mono: '"SF Mono", Monaco, "Cascadia Code", "Courier New", monospace'
};

// =======================================================================
// UI COMPONENTS
// =======================================================================

const Modal = ({ isOpen, onClose, title, children, style = {} }) => {
  if (!isOpen) return null;
  
  return ReactDOM.createPortal(
    <div 
      style={{
        position: 'fixed', 
        top: 0, 
        left: 0, 
        right: 0, 
        bottom: 0, 
        backgroundColor: 'rgba(0, 0, 0, 0.6)', 
        display: 'flex', 
        justifyContent: 'center', 
        alignItems: 'center', 
        zIndex: 999999,
        backdropFilter: 'blur(2px)',
        animation: 'fadeIn 0.2s ease',
        padding: '20px'
      }}
      onClick={onClose}
    >
      <div 
        style={{ 
          backgroundColor: '#ffffff', 
          borderRadius: '8px', 
          boxShadow: '0 10px 40px rgba(0, 0, 0, 0.3)',
          position: 'relative',
          maxHeight: '90vh', 
          animation: 'slideUp 0.2s ease',
          maxWidth: '1100px',
          width: '100%',
          fontFamily: FONTS.primary,
          display: 'flex',
          flexDirection: 'column',
          ...style 
        }}
        onClick={(e) => e.stopPropagation()} 
      >
        <div style={{ 
          display: 'flex', 
          justifyContent: 'space-between', 
          alignItems: 'center', 
          backgroundColor: '#f5f5f5',
          padding: '20px 32px',
          borderBottom: '2px solid #e5e5e5',
          borderTopLeftRadius: '8px',
          borderTopRightRadius: '8px',
          position: 'sticky',
          top: 0,
          zIndex: 10
        }}>
          <h3 style={{ 
            margin: 0, 
            fontSize: '1.25rem', 
            fontWeight: '600',
            color: '#1a1a1a'
          }}>{title}</h3>
          <button 
            onClick={onClose} 
            style={{ 
              border: 'none', 
              background: '#e5e5e5',
              color: '#525252',
              width: '32px',
              height: '32px',
              borderRadius: '6px',
              fontSize: '1.25rem', 
              cursor: 'pointer',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              transition: 'background-color 0.2s ease',
              fontWeight: '500',
              flexShrink: 0
            }}
            onMouseEnter={(e) => e.target.style.background = '#d4d4d4'}
            onMouseLeave={(e) => e.target.style.background = '#e5e5e5'}
          >×</button>
        </div>
        
        <div style={{ 
          padding: '24px 32px 32px 32px',
          overflowY: 'auto',
          flex: 1
        }}>
          {children}
        </div>
      </div>
    </div>,
    document.body
  );
};

const BaseCircle = ({ color, onClick, title, outlined }) => (
  <div 
    style={{ 
      width: '16px', 
      height: '16px', 
      borderRadius: '50%', 
      backgroundColor: outlined ? 'transparent' : color,
      border: outlined ? `2px solid ${color}` : 'none',
      margin: '0 1px', 
      display: 'inline-block', 
      cursor: onClick ? 'pointer' : 'default',
      flexShrink: 0,
      transition: 'transform 0.2s ease',
      position: 'relative'
    }} 
    onClick={onClick}
    title={title}
    onMouseEnter={(e) => { if (onClick) e.target.style.transform = 'scale(1.15)'; }}
    onMouseLeave={(e) => { if (onClick) e.target.style.transform = 'scale(1)'; }}
  />
);

const RCircle = (props) => <BaseCircle color={COLORS.danger} title={props.title || "Critical Deviation"} {...props} />;
const YCircle = (props) => <BaseCircle color={COLORS.warning} title={props.title || "Warning Deviation"} {...props} />;
const GCircle = (props) => <BaseCircle color={COLORS.success} title={props.title || "Normal Performance"} {...props} />;
const NoReportCircle = (props) => <BaseCircle color={COLORS.gray500} outlined title={props.title || "No Report"} {...props} />;

const HealthIndicatorMap = {
  'Critical': RCircle,
  'Warning': YCircle,
  'Normal': GCircle
};

// =======================================================================
// UTILITY FUNCTIONS
// =======================================================================

const getDaysInMonth = (year, monthIndex) => {
  return new Date(year, monthIndex, 0).getDate();
}

const getConsolidatedStatus = (categories) => {
  if (!categories || categories.length === 0) return null;
  if (categories.includes('Critical')) return 'Critical';
  if (categories.includes('Warning')) return 'Warning';
  if (categories.includes('Normal')) return 'Normal';
  return null;
}

// =======================================================================
// 🔧 CRITICAL FIX: DATA TRANSFORMATION WITH DYNAMIC KEYING
// =======================================================================

const transformApiData = (apiData, isMonthlySummaryView) => {
  const grouped = {};
  
  apiData.forEach(item => {
    const key = item.imo_number;
    if (!grouped[key]) {
      grouped[key] = {
        imo: item.imo_number,
        name: item.vessel_name,
        reports: {}
      };
    }
    
    let reportKey;
    if (isMonthlySummaryView) {
      // For "All Months" view, key by Month Name (e.g., 'June')
      const reportDate = new Date(item.report_date + 'T00:00:00Z'); // Parse as UTC to prevent timezone issues
      reportKey = reportDate.toLocaleString('en-us', { month: 'long', timeZone: 'UTC' }); 
    } else {
      // Daily View: Key by full date string (e.g., '2025-06-18')
      reportKey = item.report_date; 
    }

    // Since a vessel can have multiple reports on the same day/month with different severities,
    // we need to consolidate the status. (Although the backend is likely consolidating this already).
    if (!grouped[key].reports[reportKey]) {
        grouped[key].reports[reportKey] = {
            report_id: item.report_id,
            categories: [item.status],
            parameters: item.dominant_parameters,
            status: item.status,
            report_date: item.report_date
        };
    } else {
        // Simple consolidation: take the highest severity
        grouped[key].reports[reportKey].categories.push(item.status);
        const consolidated = getConsolidatedStatus(grouped[key].reports[reportKey].categories);
        grouped[key].reports[reportKey].status = consolidated;
        // Keep the first report ID, but this is a compromise as one day might have multiple reports
        // The table is designed to show ONE indicator per day/month.
    }
  });
  
  return Object.values(grouped);
};

// =======================================================================
// MAIN COMPONENT
// =======================================================================

export default function VesselMonthlyPerformance({ fleet, axiosAepms, analysisMode }) {
  // --- MODIFIED DEFAULT STATE FOR LAST 6 MONTHS VIEW (CURRENT YEAR & ALL MONTHS) ---
  const currentYear = new Date().getFullYear().toString();
  
  const [selectedYear, setSelectedYear] = useState(currentYear);
  const [selectedMonth, setSelectedMonth] = useState("Last 6 Months");
  // --- END: MODIFIED DEFAULT STATE ---

  const [selectedVessel, setSelectedVessel] = useState("All Vessels");
  
  const [reportsData, setReportsData] = useState([]);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState(null);
  
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [modalData, setModalData] = useState([]);
  const [modalHeader, setModalHeader] = useState("");
  const [modalCategory, setModalCategory] = useState('');
  const [modalReportDate, setModalReportDate] = useState(null);

  const years = useMemo(() => ["2025", "2024", "2023"], []);
  const months = useMemo(() => [
    "Last 6 Months", "January", "February", "March", "April", "May", "June", 
    "July", "August", "September", "October", "November", "December"
  ], []);

  const vessels = useMemo(() => ["All Vessels", ...fleet.map(s => s.name)], [fleet]);

  // ✅ FETCH REAL DATA FROM BACKEND WITH CORRECT TRANSFORMATION
  useEffect(() => {
    const fetchReports = async () => {
      setIsLoading(true);
      setError(null);
      
      try {
        const isMonthlySummary = 
    selectedMonth === "All Months" || selectedMonth === "Last 6 Months";
        const monthIndex = isMonthlySummary ? null : months.indexOf(selectedMonth);
        const selectedVesselIMO = selectedVessel === "All Vessels" ? null : 
          fleet.find(s => s.name === selectedVessel)?.imo;
        
        console.log('📊 Fetching ME Dashboard Data:', { 
          year: selectedYear, 
          month: monthIndex, 
          imo: selectedVesselIMO,
          isMonthlySummary 
        });
        
        const response = await axiosAepms.getMEDashboardSummary(
          parseInt(selectedYear),
          monthIndex,
          selectedVesselIMO
        );
        
        console.log('✅ API Response:', response);
        
        // 🌟 CRITICAL: Pass the isMonthlySummary flag to transformer
        const transformedData = transformApiData(response.data || [], isMonthlySummary);
        
        console.log('✅ Transformed Data:', transformedData);
        setReportsData(transformedData);
        
      } catch (error) {
        console.error('❌ Failed to fetch ME dashboard data:', error);
        setError(error.message);
        setReportsData([]);
      } finally {
        setIsLoading(false);
      }
    };
    
    if (fleet.length > 0) {
      fetchReports();
    }
  }, [selectedYear, selectedMonth, selectedVessel, axiosAepms, fleet, months]);
  
  const filteredData = useMemo(() => {
    return reportsData.filter(ship => 
      selectedVessel === "All Vessels" || ship.name === selectedVessel
    );
  }, [reportsData, selectedVessel]);

  const getSelectValue = (e) => e?.target?.value !== undefined ? e.target.value : e;
  
  const handleIndicatorClick = (vesselName, dateOrMonth, category) => {
    const vessel = reportsData.find(v => v.name === vesselName);
    
    // For monthly view, dateOrMonth is the month name; for daily view, it's the date
    const report = vessel?.reports[dateOrMonth];
    
    let parameters = report?.parameters || [];
    
    const formattedParams = parameters.map(p => ({
      parameter: p.parameter,
      baseline: p.baseline,
      actual: p.actual,
      deviation: p.actual - p.baseline,
      deviation_pct: p.deviation_pct,
      status_color: category === 'Critical' ? 'red' : 
                   category === 'Warning' ? 'yellow' : 'green'
    }));
    
    const statusEmoji = category === 'Critical' ? '🔴' : 
                       category === 'Warning' ? '🟡' : '🟢';
    
    // For monthly view, show the actual report date from the report object
    let displayDate;

    // Daily view → already a full date like 2025-06-18
    if (/^\d{4}-\d{2}-\d{2}$/.test(dateOrMonth)) {
      displayDate = dateOrMonth;
    }
    // Monthly view → report.report_date is ALWAYS available in transformed data
    else if (report?.report_date) {
      displayDate = report.report_date; // <-- FIX
    }
    // fallback
    else {
      displayDate = dateOrMonth;
    }

    setModalData(formattedParams);
    setModalCategory(category);
    setModalHeader(`${vesselName} — ${displayDate} — Status: ${statusEmoji} ${category}`);
    setModalReportDate(displayDate);
    setIsModalOpen(true);
  };

  // Helper to determine which months should be displayed (last 6, reverse order)
  const getMonthsToRender = (isDailyView) => {
  const fullMonths = months.slice(1); // ['January', ..., 'December']

  // 1️⃣ Daily view -> show only selected month
  if (isDailyView) {
    return [selectedMonth];
  }

  // 2️⃣ Identify modes
  const isLast6 = selectedMonth === "Last 6 Months";
  const isAllMonths = selectedMonth === "All Months";

  // 3️⃣ Last 6 Months -> show last 6 months dynamically
  if (isLast6) {
    const now = new Date();
    const current = now.getMonth(); // 0 to 11

    const result = [];
    for (let i = 0; i < 6; i++) {
      const idx = (current - i + 12) % 12; // wrap around backwards
      result.push(fullMonths[idx]);
    }

    return result; // Already reversed: e.g., DEC, NOV, OCT, SEP, AUG, JUL
  }

  // 4️⃣ All Months -> show all 12 months (Dec -> Jan)
  if (isAllMonths) {
    return [...fullMonths].reverse();
  }

  // 5️⃣ Should not happen—but safe fallback
  return [selectedMonth];
};


  const renderMonthHeaders = () => {
    // Use the helper to get the reversed list of months
    const monthsToRender = getMonthsToRender(false);

    return monthsToRender.map(month => (
      <th key={month} style={{ 
        minWidth: '125px', // ⬅️ WIDTH CHANGE: Adjusted to 125px
        textAlign: 'center',
        padding: '12px 8px',
        fontWeight: '600',
        fontSize: '0.8rem',
        textTransform: 'uppercase',
        letterSpacing: '0.05em',
        color: COLORS.white
      }}>{month.substring(0, 3)}</th>
    ));
  };

  const renderDayHeaders = () => {
    const monthIndex = months.indexOf(selectedMonth);
    const daysInMonth = getDaysInMonth(parseInt(selectedYear), monthIndex);
    const headerDays = Array.from({ length: daysInMonth }, (_, i) => i + 1);

    return (
      <>
        {headerDays.map(day => (
          <th key={day} style={{ 
            width: '36px', 
            textAlign: 'center', 
            padding: '12px 6px',
            fontWeight: '600',
            fontSize: '0.75rem',
            color: COLORS.white
          }}>{day}</th>
        ))}
      </>
    );
  };

  const renderDailyRow = (ship) => {
    const monthIndex = months.indexOf(selectedMonth);
    const daysInMonth = getDaysInMonth(parseInt(selectedYear), monthIndex);
    const days = Array.from({ length: daysInMonth }, (_, i) => i + 1);
    const currentMonthString = String(monthIndex).padStart(2, '0');

    return (
      <>
        {days.map(day => {
          const dateString = `${selectedYear}-${currentMonthString}-${String(day).padStart(2, '0')}`;
          const report = ship.reports[dateString];
          
          const consolidatedStatus = getConsolidatedStatus(report?.categories);
          const Indicator = HealthIndicatorMap[consolidatedStatus];
          
          return (
            <td key={dateString} style={{ 
              textAlign: 'center', 
              padding: '8px 4px', 
              minWidth: '36px',
              backgroundColor: COLORS.white
            }}>
              <div style={{ 
                display: 'flex', 
                justifyContent: 'center', 
                alignItems: 'center' 
              }}>
                {Indicator ? (
                  <Indicator 
                    onClick={() => handleIndicatorClick(ship.name, dateString, consolidatedStatus)} 
                  />
                ) : (
                  <NoReportCircle />
                )}
              </div>
            </td>
          );
        })}
      </>
    );
  };
  
  const renderMonthlyRow = (ship) => {
    // Use the helper to get the reversed list of months (e.g., Nov, Oct, Sep...)
    const monthsToRender = getMonthsToRender(false);
    
    return monthsToRender.map((monthName) => {
      const report = ship.reports[monthName]; // Key is now month name (e.g., "June")
      
      const consolidatedStatus = getConsolidatedStatus(report?.categories);
      const Indicator = HealthIndicatorMap[consolidatedStatus];

      return (
        <td key={monthName} style={{ 
          textAlign: 'center', 
          padding: '8px 4px', 
          minWidth: '125px', // ⬅️ WIDTH CHANGE: Adjusted to 125px
          backgroundColor: COLORS.white
        }}>
          <div style={{ 
            display: 'flex', 
            justifyContent: 'center', 
            alignItems: 'center' 
          }}>
            {Indicator ? (
              <Indicator 
                onClick={() => handleIndicatorClick(ship.name, monthName, consolidatedStatus)} 
              />
            ) : (
              <NoReportCircle />
            )}
          </div>
        </td>
      );
    });
  }

  const renderTable = () => {
    /////go
    const isDailyView =
    selectedMonth !== "All Months" &&
    selectedMonth !== "Last 6 Months";

    
    let dynamicWidth;
    let monthsToRenderCount = 0;

    if (isDailyView) {
      const monthIndex = months.indexOf(selectedMonth);
      const daysInMonth = getDaysInMonth(parseInt(selectedYear), monthIndex);
      dynamicWidth = daysInMonth * 36;
    } else {
      const dynamicColumnsArray = getMonthsToRender(isDailyView);
      monthsToRenderCount = dynamicColumnsArray.length;
      dynamicWidth = monthsToRenderCount * 125; // Use the new width (750px for 6 months)
    }
    
    // The Vessel column has a minWidth of 150px
    const minTableWidth = `${150 + dynamicWidth}px`; // 150 + 750 = 900px

    if (isLoading) {
      return (
        <Card style={{ marginTop: '20px', padding: '40px', textAlign: 'center' }}>
          <p style={{ color: COLORS.gray700 }}>Loading performance data...</p>
        </Card>
      );
    }

    if (error) {
      return (
        <Card style={{ marginTop: '20px', padding: '40px', textAlign: 'center' }}>
          <p style={{ color: COLORS.danger }}>Error: {error}</p>
        </Card>
      );
    }

    if (filteredData.length === 0) {
      return (
        <Card style={{ marginTop: '20px', padding: '40px', textAlign: 'center' }}>
          <p style={{ color: COLORS.gray700 }}>No reports found for the selected criteria</p>
        </Card>
      );
    }
    
    return (
      <Card style={{ 
        marginTop: '20px',
        border: `1px solid ${COLORS.gray200}`,
        boxShadow: '0 1px 3px 0 rgba(0, 0, 0, 0.1)',
        borderRadius: '8px',
        overflow: 'hidden'
      }}>
        <CardHeader style={{
          background: COLORS.gray100,
          borderBottom: `1px solid ${COLORS.gray200}`,
          padding: '20px 24px'
        }}>
          <h2 style={{
            fontSize: '1.125rem', 
            fontWeight: '600', 
            color: COLORS.dark, 
            margin: '0 0 4px 0',
            fontFamily: FONTS.primary
          }}>
            {isDailyView 
              ? `${selectedMonth} ${selectedYear} - Daily Status` 
              : `${selectedYear} - Monthly Summary`}
          </h2>
          <CardDescription style={{
            fontSize: '0.875rem',
            color: COLORS.gray700
          }}>
            Click a colored indicator to view parameter deviation details.
          </CardDescription>
        </CardHeader>
        <CardContent style={{ 
          overflowX: 'auto', 
          padding: '0'
        }}>
          <table style={{ 
            width: 'auto', 
            minWidth: minTableWidth, 
            borderCollapse: 'collapse',
            fontFamily: FONTS.primary
          }}>
            <thead>
              <tr style={{ 
                background: COLORS.dark,
                borderBottom: `2px solid ${COLORS.ash}`
              }}>
                <th style={{ 
                  padding: '14px 16px', 
                  textAlign: 'left', 
                  minWidth: '150px', 
                  fontWeight: '600', 
                  textTransform: 'uppercase', 
                  fontSize: '0.75rem',
                  color: COLORS.white,
                  letterSpacing: '0.05em',
                  position: 'sticky',
                  left: 0,
                  zIndex: 20,
                  background: COLORS.dark
                }}>Vessel</th>
                {isDailyView ? renderDayHeaders() : renderMonthHeaders()}
              </tr>
            </thead>
            <tbody>
              {filteredData.map((ship) => (
                <tr key={ship.imo} style={{ 
                  borderBottom: `1px solid ${COLORS.gray200}`,
                  transition: 'background-color 0.15s ease'
                }}
                onMouseEnter={(e) => e.currentTarget.style.backgroundColor = COLORS.gray100}
                onMouseLeave={(e) => e.currentTarget.style.backgroundColor = COLORS.white}>
                  <td style={{ 
                    padding: '12px 16px', 
                    fontWeight: '500',
                    color: COLORS.dark,
                    position: 'sticky',
                    left: 0,
                    background: 'inherit',
                    zIndex: 10
                  }}>{ship.name}</td>
                  {isDailyView ? renderDailyRow(ship) : renderMonthlyRow(ship)}
                </tr>
              ))}
            </tbody>
          </table>
        </CardContent>
      </Card>
    );
  };

  const getModalRowStyle = (status_color) => {
    const styles = {
      red: { 
        backgroundColor: '#FEF2F2', 
        borderLeft: `3px solid ${COLORS.danger}`
      },
      yellow: { 
        backgroundColor: '#FFFBEB', 
        borderLeft: `3px solid ${COLORS.warning}`
      },
      green: { 
        backgroundColor: '#F0FDF4', 
        borderLeft: `3px solid ${COLORS.success}`
      }
    };
    return styles[status_color] || {};
  }

  React.useEffect(() => {
    if (typeof document !== 'undefined' && !document.getElementById('me-performance-animations')) {
      const styleSheet = document.createElement('style');
      styleSheet.id = 'me-performance-animations';
      styleSheet.textContent = `
        @keyframes fadeIn {
          from { opacity: 0; }
          to { opacity: 1; }
        }
        @keyframes slideUp {
          from {
            opacity: 0;
            transform: translateY(20px);
          }
          to {
            opacity: 1;
            transform: translateY(0);
          }
        }
      `;
      document.head.appendChild(styleSheet);
    }
  }, []);


  //export pdf
const exportModalPDF = async (reportDate) => {
  if (!modalData || modalData.length === 0) {
    alert("No data available to export.");
    return;
  }

  const doc = new jsPDF("p", "mm", "a4");
  const pageWidth = doc.internal.pageSize.getWidth();

  // ============================================
  // 1. Extract header values (unchanged)
  // ============================================
  const vesselName = vesselNameFromHeader(modalHeader);
  // const cleanHeader = modalHeader.replace(/[^\w\s—:]/g, "");
  // const { reportMonth } = extractDateInfo(cleanHeader);
  const reportMonth = reportDate ? getMonthName(reportDate) : "N/A";
  // ============================================
  // 2. FIXED DATE (PASSED FROM PARENT)
  // ============================================
  let realDate = "N/A";

  if (reportDate) {
    const dt = new Date(reportDate);

    // Only accept valid dates
    if (!isNaN(dt)) {
      realDate = dt.toLocaleDateString("en-GB", {
        day: "2-digit",
        month: "short",
        year: "numeric",
      });
    }
  }


  // ============================================
  // 3. Add logo
  // ============================================
  let logoW = 40;
  let logoH = 18;
  const logoX = 10;
  const logoY = 15;

  // try {
  //   const img = new Image();
  //   img.src = OzellarLogo;
  //   await new Promise((resolve) => (img.onload = resolve));

  //   const scale = logoW / img.width;
  //   logoH = img.height * scale;

  //   doc.addImage(await toBase64(OzellarLogo), "PNG", logoX, logoY, logoW, logoH);
  // } catch (err) {
  //   console.warn("Logo load failed:", err);
  // }

  // ============================================
  // 4. TEXT AREA ALIGNMENT (RIGHT SIDE ONLY)
  // ============================================
  const rightMargin = 10;
  const textAreaX = logoX + logoW + 10;
  const textAreaWidth = pageWidth - textAreaX - rightMargin;

  const centerX = textAreaX + textAreaWidth / 2;

  const textCenterY = logoY + logoH / 2;
  const line1 = textCenterY - 8;
  const line2 = textCenterY + 0;
  const line3 = textCenterY + 9;

  // Title
  doc.setFont("helvetica", "bold");
  doc.setFontSize(18);
  doc.text("Main Engine Performance Report", centerX, line1, { align: "center" });

  // Vessel Name
  doc.setFontSize(14);
  doc.text(vesselName, centerX, line2, { align: "center" });

  // Report Period + Date
  doc.setFontSize(12);
  doc.setTextColor(90);
  doc.text(
    `Report Period: ${reportMonth} | Date: ${realDate}`,
    centerX,
    line3,
    { align: "center" }
  );
  doc.setTextColor(0);

  // ============================================
  // 5. STATUS BADGE
  // ============================================
  let overallStatus = "NORMAL";
  let statusColor = [0, 150, 0];

  if (modalData.some((r) => r.status_color === "red")) {
    overallStatus = "ALERT";
    statusColor = [200, 0, 0];
  } else if (modalData.some((r) => r.status_color === "yellow")) {
    overallStatus = "WARNING";
    statusColor = [220, 160, 0];
  }

  const statusText = `Status: ${overallStatus}`;
  const statusWidth = doc.getTextWidth(statusText);

  const badgeX = centerX - (statusWidth + 16) / 2;
  const badgeY = line3 + 6;

  doc.setFillColor(...statusColor);
  doc.roundedRect(badgeX, badgeY, statusWidth + 16, 10, 3, 3, "F");

  doc.setFont("helvetica", "bold");
  doc.setFontSize(12);
  doc.setTextColor(255, 255, 255);
  doc.text(statusText, centerX, badgeY + 7, { align: "center" });

  doc.setTextColor(0);

  // ============================================
  // 6. TABLE STARTS BELOW STATUS
  // ============================================
  let y = badgeY + 20;

  doc.setFillColor(230, 230, 230);
  doc.rect(10, y, pageWidth - 20, 10, "F");

  doc.setFont("helvetica", "bold");
  doc.setFontSize(11);
  doc.text("Parameter", 12, y + 7);
  doc.text("Baseline", 75, y + 7);
  doc.text("Actual", 115, y + 7);
  doc.text("Diff", 155, y + 7);

  y += 12;

  // Rows
  doc.setFont("helvetica", "normal");
  doc.setFontSize(10);

  modalData.forEach((row) => {
    if (row.status_color === "red") doc.setFillColor(255, 200, 200);
    else if (row.status_color === "yellow") doc.setFillColor(255, 245, 185);
    else doc.setFillColor(215, 245, 225);

    doc.rect(10, y, pageWidth - 20, 9, "F");

    const wrapped = doc.splitTextToSize(row.parameter, 60);
    doc.text(wrapped, 12, y + 6);

    doc.text(String(row.baseline ?? "N/A"), 75, y + 6);
    doc.text(String(row.actual ?? "N/A"), 115, y + 6);

    const diff =
      row.deviation >= 0
        ? `+${row.deviation.toFixed(2)}`
        : row.deviation.toFixed(2);
    doc.text(diff, 155, y + 6);

    y += 11;

    if (y > 275) {
      doc.addPage();
      y = 20;
    }
  });

  // Save
  doc.save("ME-Performance-Report.pdf");
};



  return (
    <div style={{ fontFamily: FONTS.primary }}>
      <h1 style={{
        fontSize: '1.875rem',
        fontWeight: '700',
        margin: '0 0 8px 0',
        color: COLORS.dark
      }}>Main Engine Performance Dashboard</h1>
      <p style={{
        fontSize: '0.875rem',
        color: COLORS.gray700,
        margin: '0 0 24px 0'
      }}>Monthly and Daily deviation status overview for Main Engines (ME)</p>

      <div style={{ 
        display: 'flex', 
        gap: '12px', 
        margin: '20px 0', 
        flexWrap: 'wrap'
      }}>
        <Select 
          value={selectedYear} 
          onChange={(e) => setSelectedYear(getSelectValue(e))} 
          style={{ 
            minWidth: '120px',
            border: `1px solid ${COLORS.gray300}`,
            fontFamily: FONTS.primary
          }}
        >
          {years.map(y => <option key={y} value={y}>{y}</option>)}
        </Select>
        <Select 
          value={selectedMonth} 
          onChange={(e) => setSelectedMonth(getSelectValue(e))} 
          style={{ 
            minWidth: '160px',
            border: `1px solid ${COLORS.gray300}`,
            fontFamily: FONTS.primary
          }}
        >
          {months.map(m => <option key={m} value={m}>{m}</option>)}
        </Select>
        <Select 
          value={selectedVessel} 
          onChange={(e) => setSelectedVessel(getSelectValue(e))} 
          style={{ 
            minWidth: '200px',
            border: `1px solid ${COLORS.gray300}`,
            fontFamily: FONTS.primary
          }}
        >
          {vessels.map(v => <option key={v} value={v}>{v}</option>)}
        </Select>
      </div>
      
      {renderTable()}

      <Modal 
        isOpen={isModalOpen} 
        onClose={() => setIsModalOpen(false)} 
        title={modalHeader}
      >
        {modalData.length === 0 ? (
          <p style={{ textAlign: 'center', color: COLORS.gray700, padding: '20px' }}>
            No parameter data available
          </p>
        ) : (
          <>
            <table style={{ 
              width: '100%', 
              borderCollapse: 'collapse', 
              marginTop: '8px', 
              fontSize: '0.875rem',
              fontFamily: FONTS.primary
            }}>
              <thead>
                <tr style={{ 
                  background: COLORS.gray100,
                  borderBottom: `2px solid ${COLORS.gray300}`
                }}>
                  <th style={{ 
                    padding: '12px', 
                    textAlign: 'left', 
                    minWidth: '180px', 
                    textTransform: 'uppercase', 
                    fontWeight: '600',
                    fontSize: '0.75rem',
                    color: COLORS.dark,
                    letterSpacing: '0.05em'
                  }}>PARAMETER</th>
                  <th style={{ 
                    padding: '12px', 
                    textAlign: 'right', 
                    textTransform: 'uppercase', 
                    fontWeight: '600',
                    fontSize: '0.75rem',
                    color: COLORS.dark,
                    letterSpacing: '0.05em'
                  }}>BASELINE</th>
                  <th style={{ 
                    padding: '12px', 
                    textAlign: 'right', 
                    textTransform: 'uppercase', 
                    fontWeight: '600',
                    fontSize: '0.75rem',
                    color: COLORS.dark,
                    letterSpacing: '0.05em'
                  }}>ACTUAL</th>
                  <th style={{ 
                    padding: '12px', 
                    textAlign: 'right', 
                    textTransform: 'uppercase', 
                    fontWeight: '600',
                    fontSize: '0.75rem',
                    color: COLORS.dark,
                    letterSpacing: '0.05em'
                  }}>Δ (DIFF)</th>
                  <th style={{ 
                    padding: '12px', 
                    textAlign: 'right', 
                    minWidth: '120px', 
                    textTransform: 'uppercase', 
                    fontWeight: '600',
                    fontSize: '0.75rem',
                    color: COLORS.dark,
                    letterSpacing: '0.05em'
                  }}>DEVIATION %</th>
                </tr>
              </thead>
              <tbody>
                {modalData.map((row, index) => (
                  <tr key={index} style={{
                    ...getModalRowStyle(row.status_color),
                    transition: 'background-color 0.15s ease'
                  }}
                  onMouseEnter={(e) => e.currentTarget.style.opacity = '0.8'}
                  onMouseLeave={(e) => e.currentTarget.style.opacity = '1'}>
                    <td style={{ 
                      padding: '12px', 
                      fontWeight: '500',
                      color: COLORS.dark
                    }}>{row.parameter}</td>
                    <td style={{ 
                      padding: '12px', 
                      textAlign: 'right',
                      color: COLORS.gray900,
                      fontFamily: FONTS.mono
                    }}>{row.baseline?.toFixed(2) || 'N/A'}</td>
                    <td style={{ 
                      padding: '12px', 
                      textAlign: 'right',
                      color: COLORS.gray900,
                      fontFamily: FONTS.mono
                    }}>{row.actual?.toFixed(2) || 'N/A'}</td>
                    <td style={{ 
                      padding: '12px', 
                      textAlign: 'right', 
                      fontWeight: '600',
                      color: row.status_color === 'red' ? COLORS.danger : 
                             row.status_color === 'yellow' ? COLORS.warning : COLORS.success,
                      fontFamily: FONTS.mono
                    }}>{row.deviation >= 0 ? '+' : ''}{row.deviation?.toFixed(2) || 'N/A'}</td>
                    <td style={{ 
                      padding: '12px', 
                      textAlign: 'right', 
                      fontWeight: '600',
                      fontSize: '0.9375rem',
                      color: row.status_color === 'red' ? COLORS.danger : 
                             row.status_color === 'yellow' ? COLORS.warning : COLORS.success,
                      fontFamily: FONTS.mono
                    }}>{row.deviation_pct >= 0 ? '+' : ''}{row.deviation_pct?.toFixed(1) || 'N/A'}%</td>
                  </tr>
                ))}
              </tbody>
            </table>
            <Button 
              variant="secondary" 
              style={{ 
                marginTop: '24px',
                background: COLORS.dark,
                color: COLORS.white,
                border: 'none',
                padding: '10px 20px',
                borderRadius: '6px',
                fontWeight: '500',
                cursor: 'pointer',
                transition: 'background-color 0.2s ease',
                fontFamily: FONTS.primary
              }}
              onMouseEnter={(e) => e.target.style.background = COLORS.ash}
              onMouseLeave={(e) => e.target.style.background = COLORS.dark}
              onClick={() => exportModalPDF(modalReportDate)}
            >Export PDF</Button>
          </>
        )}
      </Modal>
      
      <div style={{ 
        marginTop: '24px', 
        padding: '16px 20px', 
        border: `1px solid ${COLORS.gray200}`, 
        borderRadius: '8px', 
        background: COLORS.gray100,
        display: 'flex',
        alignItems: 'center',
        flexWrap: 'wrap',
        gap: '16px',
        fontFamily: FONTS.primary
      }}>
        <span style={{ 
          fontWeight: '600', 
          color: COLORS.dark,
          fontSize: '0.875rem'
        }}>Legend (Highest Priority):</span>
        <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
          <RCircle /> 
          <span style={{ fontWeight: '500', color: COLORS.danger, fontSize: '0.875rem' }}>Critical</span>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
          <YCircle /> 
          <span style={{ fontWeight: '500', color: COLORS.warning, fontSize: '0.875rem' }}>Warning</span>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
          <GCircle /> 
          <span style={{ fontWeight: '500', color: COLORS.success, fontSize: '0.875rem' }}>Normal</span>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
          <NoReportCircle /> 
          <span style={{ fontWeight: '500', color: COLORS.gray700, fontSize: '0.875rem' }}>No Report</span>
        </div>
      </div>
    </div>
  );
}
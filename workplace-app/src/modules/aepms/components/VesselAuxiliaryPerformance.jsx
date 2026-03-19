// src/components/VesselAuxiliaryPerformance.jsx (REAL API INTEGRATION + MODAL Z-INDEX FIX)
import React, { useState, useMemo, useEffect } from 'react';
import { Card, CardContent, CardHeader, CardDescription } from './ui/Card';
import ReactDOM from 'react-dom';
import Select from './ui/Select';
import Button from './ui/Button';
import jsPDF from "jspdf";
// import OzellarLogo from "../assets/250714_OzellarMarine-Logo-Final.jpg";

// =======================================================================
// DESIGN SYSTEM & CONSTANTS
// =======================================================================
const extractMonthFromDate = (dateString) => {
  if (!dateString) return "N/A";
  const dt = new Date(dateString);
  if (isNaN(dt)) return "N/A";
  return dt.toLocaleString("en-GB", { month: "long" });
};


const COLORS = {
  dark: '#1a1a1a', ash: '#3a3a3a', gray900: '#525252', gray700: '#737373', gray500: '#a3a3a3',
  gray300: '#d4d4d4', gray200: '#e5e5e5', gray100: '#f5f5f5', success: '#10b981',
  warning: '#f59e0b', danger: '#ef4444', white: '#ffffff'
};

const FONTS = {
  primary: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif',
  mono: '"SF Mono", Monaco, "Cascadia Code", "Courier New", monospace'
};

const GENERATOR_KEYS = ["AE#1", "AE#2", "AE#3"]; 

// =======================================================================
// UTILITY FUNCTIONS
// =======================================================================
const getDaysInMonth = (year, monthIndex) => new Date(year, monthIndex, 0).getDate();
const getConsolidatedStatus = (categories) => {
  if (!categories || categories.length === 0) return null;
  if (categories.includes('Critical')) return 'Critical';
  if (categories.includes('Warning')) return 'Warning';
  if (categories.includes('Normal')) return 'Normal';
  return null;
}
const getMonthlySummary = (reports, year, monthIndex) => {
  const month = String(monthIndex).padStart(2, '0');
  const statuses = [];
  for (let day = 1; day <= getDaysInMonth(year, monthIndex); day++) {
    const dateString = `${year}-${month}-${String(day).padStart(2, '0')}`;
    const report = reports[dateString];
    if (report) statuses.push(...report.categories);
  }
  if (statuses.includes('Critical')) return { status: 'Critical', hasReport: true };
  if (statuses.includes('Warning')) return { status: 'Warning', hasReport: true };
  if (statuses.includes('Normal')) return { status: 'Normal', hasReport: true };
  return { status: null, hasReport: false };
};

// =======================================================================
// UI COMPONENTS (Modal, Circles)
// =======================================================================

const Modal = ({ isOpen, onClose, title, children, style = {} }) => {
  if (!isOpen) return null;
  
  // ⬇️ CRITICAL FIX: Render modal at document.body level using Portal
  return ReactDOM.createPortal(
    <div 
      style={{
        position: 'fixed', top: 0, left: 0, right: 0, bottom: 0, 
        backgroundColor: 'rgba(0, 0, 0, 0.6)', display: 'flex', 
        justifyContent: 'center', alignItems: 'center', zIndex: 999999, // ⬅️ Now this will work because modal is at body level
        backdropFilter: 'blur(2px)', animation: 'fadeIn 0.2s ease', padding: '20px'
      }}
      onClick={onClose}
    >
      <div 
        style={{ 
          backgroundColor: COLORS.white, borderRadius: '8px', boxShadow: '0 10px 40px rgba(0, 0, 0, 0.3)',
          position: 'relative', maxHeight: '90vh', overflowY: 'auto', 
          animation: 'slideUp 0.2s ease', maxWidth: '1100px', width: '100%', 
          fontFamily: FONTS.primary, display: 'flex', flexDirection: 'column', ...style 
        }}
        onClick={(e) => e.stopPropagation()} 
      >
        <div style={{ 
          display: 'flex', justifyContent: 'space-between', alignItems: 'center', 
          backgroundColor: COLORS.gray100, padding: '20px 32px', borderBottom: `2px solid ${COLORS.gray200}`,
          borderTopLeftRadius: '8px', borderTopRightRadius: '8px', position: 'sticky', top: 0, zIndex: 10
        }}>
          <h3 style={{ margin: 0, fontSize: '1.25rem', fontWeight: '600', color: COLORS.dark }}>{title}</h3>
          <button 
            onClick={onClose} 
            style={{ 
              border: 'none', background: COLORS.gray200, color: COLORS.gray900,
              width: '32px', height: '32px', borderRadius: '6px', fontSize: '1.25rem', 
              cursor: 'pointer', display: 'flex', alignItems: 'center',
              justifyContent: 'center', transition: 'background-color 0.2s ease',
              fontWeight: '500', flexShrink: 0
            }}
            onMouseEnter={(e) => e.target.style.background = COLORS.gray300}
            onMouseLeave={(e) => e.target.style.background = COLORS.gray200}
          >
            &times;
          </button>
        </div>
        
        <div style={{ padding: '24px 32px 32px 32px', overflowY: 'auto', flex: 1 }}>
          {children}
        </div>
      </div>
    </div>,
    document.body  // ⬅️ CRITICAL: Render at body level, not inside Fleet container
  );
};

const BaseCircle = ({ color, onClick, title, outlined }) => (
  <div 
    style={{ 
      width: '16px', height: '16px', borderRadius: '50%', 
      backgroundColor: outlined ? 'transparent' : color, border: outlined ? `2px solid ${color}` : 'none',
      margin: '0 1px', display: 'inline-block', cursor: onClick ? 'pointer' : 'default', flexShrink: 0,
      transition: 'transform 0.2s ease', position: 'relative'
    }} 
    onClick={onClick} title={title}
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
  'Normal': GCircle,
  'No Report': NoReportCircle
};


// =======================================================================
// MAIN COMPONENT
// =======================================================================

export default function VesselAuxiliaryPerformance({ fleet, axiosAepms, analysisMode }) {
  // --- MODIFIED DEFAULT STATE FOR LAST 6 MONTHS VIEW ---
  const currentYear = new Date().getFullYear().toString();
  
  const [selectedYear, setSelectedYear] = useState(currentYear);
  const [selectedMonth, setSelectedMonth] = useState("Last 6 Months"); // Default to "All Months" to enable the monthly summary view
  // --- END: MODIFIED DEFAULT STATE FOR LAST 6 MONTHS VIEW ---
  
  const [selectedVessel, setSelectedVessel] = useState("All Vessels");
  
  const [reportsData, setReportsData] = useState([]);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState(null);
  
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [modalData, setModalData] = useState([]);
  const [modalHeader, setModalHeader] = useState("");
  const [modalCategory, setModalCategory] = useState('');
  const [modalReportDate, setModalReportDate] = useState("");
  const [modalGenerator, setModalGenerator] = useState("");


  const years = useMemo(() => ["2025", "2024", "2023"], []);
  const months = useMemo(() => [
    "Last 6 Months", "January", "February", "March", "April", "May", "June", 
    "July", "August", "September", "October", "November", "December"
  ], []);

  const vessels = useMemo(() => ["All Vessels", ...fleet.map(s => s.name)], [fleet]);

  // 🎯 FETCH REAL DATA FROM API
  useEffect(() => {
    fetchAEDashboardData();
  }, [selectedYear, selectedMonth, selectedVessel]);

  const fetchAEDashboardData = async () => {
    setIsLoading(true);
    setError(null);
    
    try {
      // Convert month name to number
      let monthIndex = null;
      if (selectedMonth !== "All Months" && selectedMonth !== "Last 6 Months") {
      monthIndex = months.indexOf(selectedMonth);
      }
      // Get IMO number from selected vessel
      const vessel = fleet.find(v => v.name === selectedVessel);
      const imoNumber = selectedVessel === "All Vessels" ? null : (vessel?.imo || null);
      
      // Call backend API
      console.log('📊 Fetching AE Dashboard Data:', { year: selectedYear, month: monthIndex, imo: imoNumber });
      const response = await axiosAepms.getAEDashboardSummary(
        parseInt(selectedYear),
        monthIndex,
        imoNumber
      );
      
      console.log('API Response:', response);
      
      // Transform API response to match component structure
      const transformedData = transformAPIResponse(response.data || []);
      setReportsData(transformedData);
      
      if (transformedData.length === 0) {
        console.warn('No data returned from API');
      }
      
    } catch (err) {
      console.error('Failed to fetch AE dashboard data:', err);
      setError(err.message || 'Failed to load data');
    } finally {
      setIsLoading(false);
    }
  };

  // Helper function to transform API response
  const transformAPIResponse = (apiData) => {
    if (!Array.isArray(apiData) || apiData.length === 0) {
      console.warn('⚠️ Empty or invalid API data received');
      return [];
    }

    console.log('🔄 Transforming', apiData.length, 'records');

    // Group by vessel
    const vesselMap = {};
    
    
    apiData.forEach(report => {
      console.log("➡ RAW AE REPORT ROW:", report);
      const key = `${report.imo_number}`;
      console.log("REPORT STATUS CHECK:", report.report_date, report.generator_designation, report.status);
      if (!vesselMap[key]) {
        vesselMap[key] = {
          imo: report.imo_number,
          name: report.vessel_name,
          generators: { 'AE#1': {}, 'AE#2': {}, 'AE#3': {} }
        };
      }
      
      // Map generator designation to AE# format
      const genKey = report.generator_designation.includes('1') ? 'AE#1' 
                   : report.generator_designation.includes('2') ? 'AE#2' 
                   : 'AE#3';
      
      // Store report by date with report_id
      vesselMap[key].generators[genKey][report.report_date] = {
        report_id: report.report_id,
        categories: [ report.status || "No Report" ]
      };
    });
    
    const result = Object.values(vesselMap);
    console.log('✅ Transformed into', result.length, 'vessels');
    return result;
  };
  
  const filteredData = useMemo(() => {
    return reportsData.filter(ship => 
      selectedVessel === "All Vessels" || ship.name === selectedVessel
    );
  }, [reportsData, selectedVessel]);

  const getSelectValue = (e) => e?.target?.value !== undefined ? e.target.value : e;
  
  // 🎯 FETCH REAL ALERT DETAILS
  const handleIndicatorClick = async (vesselName, date, category, generator, reportId) => {
    if (!reportId) {
      console.error(' No report ID provided');
      return;
    }

    try {
      setIsLoading(true);
      
      console.log('🔍 Fetching alert details:', { reportId, category });
      
      // Fetch real alert details from backend
      const alertData = await axiosAepms.getAEAlertDetails(reportId);
      
      console.log('✅ Alert details received:', alertData);
      
      // Filter by category (Normal/Warning/Critical)
      const categoryKey = category.toLowerCase();
      const categoryData = alertData[categoryKey] || [];
      
      console.log(`📋 ${category} alerts:`, categoryData.length);
      
      const statusEmoji = category === 'Critical' ? '🔴' 
                        : category === 'Warning' ? '🟡' 
                        : '🟢';
      
      setModalData(categoryData);
      setModalCategory(category);
      setModalHeader(`${vesselName} — ${generator} — ${date} — Status: ${statusEmoji} ${category}`);
      setModalReportDate(date);
      setModalGenerator(generator);
      setIsModalOpen(true);
      
    } catch (err) {
      console.error('❌ Failed to fetch alert details:', err);
      setError(err.message || 'Failed to load alert details');
    } finally {
      setIsLoading(false);
    }
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

  // --- RENDERER 1: TOP HEADER ROW (COLSPANS) ---
  const renderMonthHeaders = () => {
    const isDailyView = selectedMonth !== "All Months" && selectedMonth !== "Last 6 Months";
    if (isDailyView) return null;

    const totalColsPerGroup = GENERATOR_KEYS.length;
    
    // Use the helper to get the reversed list of months
    const monthsToRender = getMonthsToRender(isDailyView);

    return monthsToRender.map(month => (
      <th key={month} colSpan={totalColsPerGroup} style={{ 
        minWidth: `${90 * totalColsPerGroup}px`, textAlign: 'center', padding: '12px 0 0 0', fontWeight: '600',
        fontSize: '0.9rem', textTransform: 'uppercase', letterSpacing: '0.05em', color: COLORS.white, 
        borderLeft: `1px solid ${COLORS.ash}`
      }}>{month.substring(0, 3)}</th>
    ));
  };

  const renderDayHeaders = () => {
    const monthIndex = months.indexOf(selectedMonth);
    const daysInMonth = getDaysInMonth(parseInt(selectedYear), monthIndex);
    const headerDays = Array.from({ length: daysInMonth }, (_, i) => i + 1);
    const totalColsPerGroup = GENERATOR_KEYS.length;

    return (
      <>
        {headerDays.map(day => (
          <th key={day} colSpan={totalColsPerGroup} style={{ 
            width: `${36 * totalColsPerGroup}px`, textAlign: 'center', padding: '12px 6px 0 6px', fontWeight: '600',
            fontSize: '0.9rem', color: COLORS.white, borderLeft: `1px solid ${COLORS.ash}`
          }}>{day}</th>
        ))}
      </>
    );
  };

  // --- RENDERER 2 & 3: ROWS & TABLE ---
  
  const renderDailyRow = (ship) => {
    const monthIndex = months.indexOf(selectedMonth);
    const daysInMonth = getDaysInMonth(parseInt(selectedYear), monthIndex);
    const days = Array.from({ length: daysInMonth }, (_, i) => i + 1);
    const currentMonthString = String(monthIndex).padStart(2, '0');
    
    const generatorReports = ship.generators || {};

    return (
      <>
        {days.map(day => {
          const dateString = `${selectedYear}-${currentMonthString}-${String(day).padStart(2, '0')}`;
          
          return (
            <React.Fragment key={day}>
              {GENERATOR_KEYS.map(genKey => {
                  const report = generatorReports[genKey]?.[dateString];
                  const consolidatedStatus = getConsolidatedStatus(report?.categories);
                  const Indicator = HealthIndicatorMap[consolidatedStatus];

                  return (
                      <td key={genKey} style={{ 
                          textAlign: 'center', padding: '8px 4px', minWidth: '36px',
                          backgroundColor: COLORS.white, borderLeft: `1px solid ${COLORS.gray200}`
                      }}>
                          <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center' }}>
                              {Indicator ? (
                                  <Indicator 
                                      onClick={() => handleIndicatorClick(
                                        ship.name, 
                                        dateString, 
                                        consolidatedStatus, 
                                        genKey,
                                        report.report_id
                                      )} 
                                  />
                              ) : (
                                  <NoReportCircle />
                              )}
                          </div>
                      </td>
                  );
              })}
            </React.Fragment>
          );
        })}
      </>
    );
  };
  
  const renderMonthlyRow = (ship) => {
    const currentYear = parseInt(selectedYear);
    
    // Use the helper to get the reversed list of months (e.g., Nov, Oct, Sep...)
    const monthsToRender = getMonthsToRender(false);

    return monthsToRender.map((monthName) => {
      const monthIndex = months.indexOf(monthName);
      const monthString = String(monthIndex).padStart(2, '0');
      
      return (
        <React.Fragment key={monthName}>
          {GENERATOR_KEYS.map(genKey => {
            const generatorReports = ship.generators[genKey] || {};
            
            const allGeneratorReportsForMonth = Object.entries(generatorReports).filter(([date]) => 
              date.startsWith(`${selectedYear}-${monthString}`)
            ).reduce((acc, [date, data]) => {
              acc[date] = data;
              return acc;
            }, {});

            const summary = getMonthlySummary(allGeneratorReportsForMonth, currentYear, monthIndex);
            const Indicator = HealthIndicatorMap[summary.status];
            
            const dateString = `${monthName} ${currentYear}`;
            
            // Get first report_id from the month for the modal
            const firstReport = Object.values(allGeneratorReportsForMonth)[0];
            const reportId = firstReport?.report_id;

            return (
              <td key={genKey} style={{ 
                textAlign: 'center', padding: '8px 4px', minWidth: '90px',
                backgroundColor: COLORS.white, borderLeft: `1px solid ${COLORS.gray200}`
              }}>
                <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center' }}>
                  {Indicator ? (
                    <Indicator 
                      onClick={() => handleIndicatorClick(
                        ship.name, 
                        dateString, 
                        summary.status, 
                        genKey,
                        reportId
                      )} 
                    />
                  ) : (
                    <NoReportCircle />
                  )}
                </div>
              </td>
            );
          })}
        </React.Fragment>
      );
    });
  }

  const renderTable = () => {
    const isDailyView = selectedMonth !== "All Months" && selectedMonth !== "Last 6 Months";    
    let totalDynamicCols;

    if (isDailyView) {
        const monthIndex = months.indexOf(selectedMonth);
        const daysInMonth = getDaysInMonth(parseInt(selectedYear), monthIndex);
        totalDynamicCols = daysInMonth * GENERATOR_KEYS.length;
    } else {
        // Use the helper to get the count of months being rendered (which is 6 for default view)
        const monthsToRenderCount = getMonthsToRender(isDailyView).length;
        totalDynamicCols = monthsToRenderCount * GENERATOR_KEYS.length;
    }

    const minTableWidth = `${150 + (totalDynamicCols * 36)}px`; 

    // Loading State
    if (isLoading) {
      return (
        <Card style={{ marginTop: '20px', padding: '40px', textAlign: 'center' }}>
          <div style={{ fontSize: '1.1rem', color: COLORS.gray700 }}>
            ⏳ Loading AE performance data...
          </div>
        </Card>
      );
    }

    // Error State
    if (error) {
      return (
        <Card style={{ marginTop: '20px', padding: '40px', textAlign: 'center' }}>
          <div style={{ fontSize: '1.1rem', color: COLORS.danger, marginBottom: '12px' }}>
            ❌ Error loading data
          </div>
          <div style={{ fontSize: '0.9rem', color: COLORS.gray700, marginBottom: '20px' }}>
            {error}
          </div>
          <Button 
            onClick={fetchAEDashboardData}
            style={{ 
              background: COLORS.dark, 
              color: COLORS.white, 
              border: 'none',
              padding: '10px 20px',
              borderRadius: '6px',
              cursor: 'pointer'
            }}
          >
            Retry
          </Button>
        </Card>
      );
    }

    // No Data State
    if (filteredData.length === 0) {
      return (
        <Card style={{ marginTop: '20px', padding: '40px', textAlign: 'center' }}>
          <div style={{ fontSize: '1.1rem', color: COLORS.gray700 }}>
            No data available for the selected filters
          </div>
          <div style={{ fontSize: '0.9rem', color: COLORS.gray500, marginTop: '8px' }}>
            Try selecting a different year, month, or vessel
          </div>
        </Card>
      );
    }
    
    const dynamicColumnsArray = isDailyView 
      ? Array.from({ length: getDaysInMonth(parseInt(selectedYear), months.indexOf(selectedMonth)) })
      : getMonthsToRender(isDailyView);

    return (
      <Card style={{ 
        marginTop: '20px', border: `1px solid ${COLORS.gray200}`, boxShadow: '0 4px 10px rgba(0,0,0,0.1)', 
        borderRadius: '8px', overflow: 'hidden'
      }}>
        <CardHeader style={{
          background: COLORS.gray100, borderBottom: `1px solid ${COLORS.gray200}`, padding: '20px 24px'
        }}>
          <h2 style={{
            fontSize: '1.25rem', fontWeight: '600', color: COLORS.dark, margin: '0 0 4px 0', fontFamily: FONTS.primary
          }}>
            {isDailyView ? `${selectedMonth} ${selectedYear} - Daily Status` : `${selectedYear} - Monthly Summary`}
          </h2>
          <CardDescription style={{
            fontSize: '0.875rem', color: COLORS.gray700
          }}>
            Click a colored indicator to view parameter deviation details for the selected generator.
          </CardDescription>
        </CardHeader>
        <CardContent style={{ overflowX: 'auto', padding: '0' }}>
          <table style={{ width: 'auto', minWidth: minTableWidth, borderCollapse: 'collapse', fontFamily: FONTS.primary }}>
            <thead>
              <tr style={{ background: COLORS.dark, borderBottom: `1px solid ${COLORS.ash}` }}>
                <th style={{ 
                  padding: '12px 16px', textAlign: 'left', minWidth: '150px', fontWeight: '600', 
                  textTransform: 'uppercase', fontSize: '0.8rem', color: COLORS.white,
                  letterSpacing: '0.05em', position: 'sticky', left: 0, zIndex: 30, background: COLORS.dark
                }}>Vessel</th>
                {isDailyView ? renderDayHeaders() : renderMonthHeaders()}
              </tr>

              <tr style={{ background: COLORS.ash }}>
                <th style={{ 
                    padding: '8px 16px', background: COLORS.dark, position: 'sticky', left: 0, zIndex: 20
                }}></th> 
                
                {dynamicColumnsArray.map((item, colIndex) => (
                    <React.Fragment key={isDailyView ? colIndex : item}>
                        {GENERATOR_KEYS.map(gen => (
                            <th key={gen} style={{
                                padding: '8px 4px', textAlign: 'center', fontWeight: '500', 
                                fontSize: '0.65rem', color: COLORS.white,
                                borderLeft: `1px solid ${COLORS.gray900}`, width: '36px' 
                            }}>
                                {gen.replace('#', '')}
                            </th> 
                        ))}
                    </React.Fragment>
                ))}
              </tr>
            </thead>
            <tbody>
              {filteredData.map(ship => (
                <tr key={ship.imo} style={{ 
                  borderBottom: `1px solid ${COLORS.gray200}`, transition: 'background-color 0.15s ease'
                }}
                onMouseEnter={(e) => e.currentTarget.style.backgroundColor = COLORS.gray100}
                onMouseLeave={(e) => e.currentTarget.style.backgroundColor = COLORS.white}>
                  <td style={{ 
                    padding: '12px 16px', fontWeight: '500', color: COLORS.dark,
                    position: 'sticky', left: 0, background: 'inherit', zIndex: 10
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
        backgroundColor: '#FEEFEF',
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

  const formatParameterName = (paramName) => {
    // Convert snake_case to Title Case
    return paramName
      .split('_')
      .map(word => word.charAt(0).toUpperCase() + word.slice(1))
      .join(' ');
  };

  // Inject CSS animations
  React.useEffect(() => {
    if (typeof document !== 'undefined' && !document.getElementById('ae-performance-animations')) {
      const styleSheet = document.createElement('style');
      styleSheet.id = 'ae-performance-animations';
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

//export to PDF function
 // Convert image to Base64
const toBase64 = (url) =>
  new Promise((resolve, reject) => {
    const img = new Image();
    img.crossOrigin = "Anonymous";
    img.src = url;
    img.onload = () => {
      const canvas = document.createElement("canvas");
      canvas.width = img.width;
      canvas.height = img.height;
      const ctx = canvas.getContext("2d");
      ctx.drawImage(img, 0, 0);
      resolve(canvas.toDataURL("image/jpeg"));
    };
    img.onerror = (error) => reject(error);
  });

// MAIN PDF EXPORT
// ===============================================
// FINAL FIXED & IMPROVED AE PDF EXPORT FUNCTION
// ===============================================
const exportAEPDF = async (
  modalData,
  modalHeader,
  modalReportDate,
  modalGenerator,
  modalCategory
) => {

  const doc = new jsPDF("p", "mm", "a4");
  const pageWidth = doc.internal.pageSize.getWidth();
  const leftMargin = 12;

  // -------------------------------
  // 1) Extract Vessel & Dates
  // -------------------------------
  const vesselName = modalHeader.split(" — ")[0];
  const reportMonth = extractMonthFromDate(modalReportDate);

  const realDate = new Date(modalReportDate).toLocaleDateString("en-GB", {
    day: "2-digit",
    month: "short",
    year: "numeric",
  });

  // -------------------------------
  // 2) ADD LOGO (Perfect Left Side)
  // -------------------------------
  // -------------------------------
// 2) ADD LOGO (Centered vertically on left)
// -------------------------------
let logoWidth = 45;
let logoHeight = 20;

// try {
//   const base64Logo = await toBase64(OzellarLogo);

//   // Header area vertical centering
//   const headerTopY = 12;    
//   const headerBottomY = 52; 
//   const headerCenterY = (headerTopY + headerBottomY) / 2;
//   const logoY = headerCenterY - (logoHeight / 2);  // perfect vertical alignment

//   doc.addImage(base64Logo, "JPEG", leftMargin, logoY, logoWidth, logoHeight);
// } catch (err) {
//   console.warn("Logo load failed:", err);
// }


  // -------------------------------
  // 3) CENTERED TEXT BLOCK
  // -------------------------------
  const textBlockX = leftMargin + logoWidth + 10;
  const textBlockWidth = pageWidth - textBlockX - leftMargin;
  const centerX = textBlockX + textBlockWidth / 2;

  doc.setFont("helvetica", "bold");
  doc.setFontSize(17);
  doc.text("Auxiliary Engine Performance Report", centerX, 22, { align: "center" });

  doc.setFontSize(14);
  doc.text(vesselName, centerX, 32, { align: "center" });

  doc.setFontSize(12);
  doc.text(`Report Period: ${reportMonth}  |  Date: ${realDate}`,
    centerX,
    40,
    { align: "center" }
  );

  doc.text(`Generator: ${modalGenerator}`, centerX, 48, { align: "center" });

  // -------------------------------
  // 4) STATUS BADGE (Centered)
  // -------------------------------
  let statusColor = [0, 160, 0];
  let statusText = "NORMAL";

  if (modalCategory === "Warning") {
    statusColor = [240, 170, 0];
    statusText = "WARNING";
  }

  if (modalCategory === "Critical") {
    statusColor = [220, 0, 0];
    statusText = "CRITICAL";
  }

  const badgeWidth = doc.getTextWidth(statusText) + 18;
  const badgeX = centerX - badgeWidth / 2;
  const badgeY = 58;

  doc.setFillColor(...statusColor);
  doc.roundedRect(badgeX, badgeY, badgeWidth, 11, 3, 3, "F");

  doc.setTextColor(255, 255, 255);
  doc.setFontSize(11);
  doc.text(statusText, centerX, badgeY + 7.5, { align: "center" });
  doc.setTextColor(0);

  // -------------------------------
  // 5) TABLE HEADER (No Collision)
  // -------------------------------
  let y = badgeY + 20;

  doc.setFillColor(230, 230, 230);
  doc.rect(10, y, pageWidth - 20, 12, "F");

  doc.setFont("helvetica", "bold");
  doc.setFontSize(11);

  doc.text("Parameter", 14, y + 8);
  doc.text("Baseline", 88, y + 8);
  doc.text("Actual", 130, y + 8);
  doc.text("Diff", 170, y + 8);

  y += 16;

  // -------------------------------
  // 6) TABLE ROWS WITH COLOR BANDS
  // -------------------------------
  modalData.forEach((row) => {
    let rowColor = [215, 245, 225]; // default green

    if (modalCategory === "Warning") rowColor = [255, 245, 185];
    if (modalCategory === "Critical") rowColor = [255, 210, 210];

    doc.setFillColor(...rowColor);
    doc.rect(10, y - 6, pageWidth - 20, 10, "F");

    const parameter = row.metric_name || row.parameter || "N/A";
    const baseline = row.baseline_value ?? row.baseline ?? "N/A";
    const actual = row.actual_value ?? row.actual ?? "N/A";
    const diffVal = row.deviation ?? 0;
    const diff = diffVal >= 0 ? `+${diffVal.toFixed(2)}` : diffVal.toFixed(2);

    doc.setFont("helvetica", "normal");
    doc.setFontSize(10);

    doc.text(String(parameter), 14, y);
    doc.text(String(baseline), 88, y);
    doc.text(String(actual), 130, y);
    doc.text(diff, 170, y);

    y += 10;

    if (y > 275) {
      doc.addPage();
      y = 20;
    }
  });

  // -------------------------------
  // 7) SAVE FILE
  // -------------------------------
  doc.save(`AE-Performance-${modalGenerator}.pdf`);
};


  return (
    <div style={{ fontFamily: FONTS.primary }}>
      <h1 style={{
        fontSize: '1.65rem', fontWeight: '700', margin: '0 0 4px 0', color: COLORS.dark
      }}>Auxiliary Engine Performance Dashboard</h1>
      <p style={{
        fontSize: '0.9rem', color: COLORS.gray700, margin: '0 0 24px 0'
      }}>Monthly and Daily deviation status overview for Auxiliary Engines (AE)</p>

      {/* Filters */}
      <div style={{ display: 'flex', gap: '12px', margin: '20px 0', flexWrap: 'wrap' }}>
        <Select value={selectedYear} onChange={(e) => setSelectedYear(getSelectValue(e))} style={{ minWidth: '120px', border: `1px solid ${COLORS.gray300}`, fontFamily: FONTS.primary }}>
          {years.map(y => <option key={y} value={y}>{y}</option>)}
        </Select>
        <Select value={selectedMonth} onChange={(e) => setSelectedMonth(getSelectValue(e))} style={{ minWidth: '160px', border: `1px solid ${COLORS.gray300}`, fontFamily: FONTS.primary }}>
          {months.map(m => <option key={m} value={m}>{m}</option>)}
        </Select>
        <Select value={selectedVessel} onChange={(e) => setSelectedVessel(getSelectValue(e))} style={{ minWidth: '200px', border: `1px solid ${COLORS.gray300}`, fontFamily: FONTS.primary }}>
          {vessels.map(v => <option key={v} value={v}>{v}</option>)}
        </Select>
      </div>
      
      {/* Table View */}
      {renderTable()}

      {/* Modal Popup */}
      <Modal 
        isOpen={isModalOpen} 
        onClose={() => setIsModalOpen(false)} 
        title={modalHeader}
      >
        {isLoading ? (
          <p style={{ textAlign: 'center', color: COLORS.gray700, padding: '20px' }}>
            ⏳ Loading details...
          </p>
        ) : modalData.length === 0 ? (
          <p style={{ textAlign: 'center', color: COLORS.gray700, padding: '20px' }}>
            No parameter data available
          </p>
        ) : (
          <>
            <table style={{ 
              width: '100%', borderCollapse: 'collapse', marginTop: '8px', fontSize: '0.875rem', fontFamily: FONTS.primary
            }}>
              <thead>
                <tr style={{ background: COLORS.gray100, borderBottom: `2px solid ${COLORS.gray300}` }}>
                  <th style={{ padding: '12px', textAlign: 'left', minWidth: '180px', textTransform: 'uppercase', fontWeight: '600', fontSize: '0.75rem', color: COLORS.dark, letterSpacing: '0.05em' }}>PARAMETER</th>
                  <th style={{ padding: '12px', textAlign: 'right', textTransform: 'uppercase', fontWeight: '600', fontSize: '0.75rem', color: COLORS.dark, letterSpacing: '0.05em' }}>BASELINE</th>
                  <th style={{ padding: '12px', textAlign: 'right', textTransform: 'uppercase', fontWeight: '600', fontSize: '0.75rem', color: COLORS.dark, letterSpacing: '0.05em' }}>ACTUAL</th>
                  <th style={{ padding: '12px', textAlign: 'right', textTransform: 'uppercase', fontWeight: '600', fontSize: '0.75rem', color: COLORS.dark, letterSpacing: '0.05em' }}>&Delta; (DIFF)</th>
                  <th style={{ padding: '12px', textAlign: 'right', minWidth: '120px', textTransform: 'uppercase', fontWeight: '600', fontSize: '0.75rem', color: COLORS.dark, letterSpacing: '0.05em' }}>DEVIATION %</th>
                </tr>
              </thead>
              <tbody>
                {modalData.map((row, index) => {
                  // Determine status color based on deviation
                  const deviationPct = row.deviation_pct || 0;
                  const status_color = modalCategory === 'Critical' ? 'red' 
                                     : modalCategory === 'Warning' ? 'yellow' 
                                     : 'green';
                  
                  const deviationTextColor = status_color === 'red' || status_color === 'yellow' 
                    ? COLORS.danger 
                    : COLORS.success;

                  return (
                    <tr key={index} style={{
                      ...getModalRowStyle(status_color), transition: 'background-color 0.15s ease'
                    }} onMouseEnter={(e) => e.currentTarget.style.opacity = '0.8'} onMouseLeave={(e) => e.currentTarget.style.opacity = '1'}>
                      <td style={{ 
                        padding: '12px', fontWeight: '500', color: COLORS.dark
                      }}>{formatParameterName(row.metric_name || row.parameter || 'Unknown')}</td>
                      <td style={{ padding: '12px', textAlign: 'right', color: COLORS.gray900, fontFamily: FONTS.mono }}>{row.baseline_value?.toFixed(2) || row.baseline?.toFixed(2) || 'N/A'}</td>
                      <td style={{ padding: '12px', textAlign: 'right', color: COLORS.gray900, fontFamily: FONTS.mono }}>{row.actual_value?.toFixed(2) || row.actual?.toFixed(2) || 'N/A'}</td>
                      <td style={{ 
                        padding: '12px', textAlign: 'right', fontWeight: '600',
                        color: deviationTextColor,
                        fontFamily: FONTS.mono
                      }}>{row.deviation >= 0 ? '+' : ''}{row.deviation?.toFixed(2) || 'N/A'}</td>
                      <td style={{ 
                        padding: '12px', textAlign: 'right', fontWeight: '600', fontSize: '0.9375rem',
                        color: deviationTextColor,
                        fontFamily: FONTS.mono
                      }}>{row.deviation_pct >= 0 ? '+' : ''}{row.deviation_pct?.toFixed(1) || 'N/A'}%</td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
            <Button 
              variant="secondary" 
              style={{ 
                marginTop: '24px', background: COLORS.dark, color: COLORS.white, border: 'none', padding: '10px 20px', borderRadius: '6px', 
                fontWeight: '500', cursor: 'pointer', transition: 'background-color 0.2s ease', fontFamily: FONTS.primary
              }} 
              onMouseEnter={(e) => e.target.style.background = COLORS.ash} 
              onMouseLeave={(e) => e.target.style.background = COLORS.dark}
              onClick={() => exportAEPDF(modalData, modalHeader, modalReportDate, modalGenerator)}
            >
              Export PDF
            </Button>
          </>
        )}
      </Modal>
      
      {/* Legend */}
      <div style={{ 
        marginTop: '24px', padding: '16px 20px', border: `1px solid ${COLORS.gray200}`, borderRadius: '8px', background: COLORS.gray100, 
        display: 'flex', alignItems: 'center', flexWrap: 'wrap', gap: '16px', fontFamily: FONTS.primary
      }}>
        <span style={{ fontWeight: '600', color: COLORS.dark, fontSize: '0.875rem' }}>Legend (Highest Priority):</span>
        <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}><RCircle /> <span style={{ fontWeight: '500', color: COLORS.danger, fontSize: '0.875rem' }}>Critical</span></div>
        <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}><YCircle /> <span style={{ fontWeight: '500', color: COLORS.warning, fontSize: '0.875rem' }}>Warning</span></div>
        <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}><GCircle /> <span style={{ fontWeight: '500', color: COLORS.success, fontSize: '0.875rem' }}>Normal</span></div>
        <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}><NoReportCircle /> <span style={{ fontWeight: '500', color: COLORS.gray700, fontSize: '0.875rem' }}>No Report</span></div>
      </div>
    </div>
  );
}
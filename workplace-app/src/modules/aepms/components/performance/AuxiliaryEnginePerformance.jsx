import React, { useEffect, useState, useMemo } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '../ui/Card';
import Select from '../ui/Select';
import Button from '../ui/Button';
import { LineChart, Line, ReferenceDot, XAxis, YAxis, CartesianGrid, ResponsiveContainer, Tooltip, Legend } from 'recharts';
import jsPDF from 'jspdf';
import html2canvas from 'html2canvas';

// =======================================================================
// DESIGN SYSTEM & CONSTANTS
// =======================================================================

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

// Auxiliary Engine Metric Mappings
const AUX_METRIC_MAPPING = {
    "Pmax": "pmax_graph_bar",
    "BoostAirPressure": "boost_air_pressure_graph_bar",
    "Exh_T/C_inlet": "exh_temp_tc_inlet_graph_c",
    "Exh_Cylinder_outlet": "exh_temp_cyl_outlet_avg_graph_c",
    "Exh_T/C_outlet": "exh_temp_tc_outlet_graph_c",
    "FIPI": "fuel_pump_index_graph",
    "SFOC": "sfoc_graph_g_kwh",
    "FOC": "fuel_consumption_total_graph_kg_h"
};

const AUX_GRAPH_ORDER = [
    "FIPI",
    "Pmax",
    "BoostAirPressure",
    "Exh_Cylinder_outlet",
    "Exh_T/C_inlet",
    "Exh_T/C_outlet"
];

// Metric Units
const AUX_METRIC_UNITS = {
    "Pmax": "Bar", "BoostAirPressure": "Bar", "Exh_T/C_inlet": "°C",
    "Exh_Cylinder_outlet": "°C", "Exh_T/C_outlet": "°C", "FIPI": "index",
    "SFOC": "g/kWh", "FOC": "kg/h"
};

const AUX_METRIC_DEFAULTS_DOMAIN = {
    "Pmax": [80, 140], "BoostAirPressure": [1.5, 3.5], "Exh_T/C_inlet": [350, 500],
    "Exh_Cylinder_outlet": [300, 450], "Exh_T/C_outlet": [250, 400], "FIPI": [5, 15],
    "SFOC": [180, 240], "FOC": [1.0, 5.0]
};

// =======================================================================
// CORE UTILITY FUNCTIONS
// =======================================================================

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

const getMonthColor = (month) => {
    const monthColorMap = {
        '01': '#dc2626', '02': '#2563eb', '03': '#16a34a', '04': '#ca8a04',
        '05': '#9333ea', '06': '#c2410c', '07': '#059669', '08': '#7c3aed',
        '09': '#db2777', '10': '#0891b2', '11': '#65a30d', '12': '#dc2626'
    };
    if (!month) return '#dc2626';
    const monthNum = month.split('-')[1];
    return monthColorMap[monthNum] || '#dc2626';
};

const getMonthDisplayName = (month) => {
    const monthNames = {
        '01': 'Jan', '02': 'Feb', '03': 'Mar', '04': 'Apr',
        '05': 'May', '06': 'Jun', '07': 'Jul', '08': 'Aug',
        '09': 'Sep', '10': 'Oct', '11': 'Nov', '12': 'Dec'
    };
    if (!month) return 'Unknown';
    const [year, monthNum] = month.split('-');
    return `${monthNames[monthNum] || monthNum} ${year}`;
};

const interpolateBaselineAux = (baselineData, targetLoad, metricKey, xAxis) => {
    if (!baselineData || !baselineData[metricKey]) return null;
    const series = baselineData[metricKey];
    if (!series || series.length === 0) return null;
    
    const sortedData = series.slice().sort((a, b) => a[xAxis] - b[xAxis]);
    const exactMatch = sortedData.find(point => Math.abs(point[xAxis] - targetLoad) < 0.01);
    if (exactMatch) return exactMatch.value;
    
    for (let i = 0; i < sortedData.length - 1; i++) {
        const current = sortedData[i];
        const next = sortedData[i + 1];
        if (current[xAxis] <= targetLoad && targetLoad <= next[xAxis]) {
            const t = (targetLoad - current[xAxis]) / (next[xAxis] - current[xAxis]);
            return current.value + t * (next.value - current.value);
        }
    }
    return targetLoad <= sortedData[0][xAxis] ? sortedData[0].value : sortedData[sortedData.length - 1].value;
};

// ====================================================================
// UPDATED FUNCTION: getAlertStatusClass
// Implements detailed Auxiliary Engine deviation criteria with 3%/5% thresholds
// ====================================================================
const getAlertStatusClass = (metricKey, baselineValue, actualValue) => {
    if (baselineValue == null || actualValue == null) return 'Normal'; 

    const devPctRaw = (actualValue - baselineValue) / baselineValue * 100;

    const auxWarningThresholdPct = 3.0;  // 3%
    const auxCriticalThresholdPct = 5.0; // 5%
    const auxFipiWarningDiff = 2.0;      // BL + 2.0
    const auxFipiCriticalDiff = 3.5;     // BL + 3.5

    // FIPI (Absolute difference criteria)
    if (metricKey === "FIPI") {
        const diff = actualValue - baselineValue;
        if (diff >= auxFipiCriticalDiff) { // R: >= BL+3.5
            return "Critical";
        } else if (diff >= auxFipiWarningDiff) { // Y: BL+2.0 to BL+3.5
            return "Warning";
        } else { // G: < BL+2.0
            return "Success";
        }
    } 

    // Pmax, BoostAirPressure (Danger if LOW criteria)
    if (metricKey === "Pmax" || metricKey === "BoostAirPressure") {
        if (devPctRaw < -auxCriticalThresholdPct) { // R: < -5%
            return "Critical";
        } else if (devPctRaw < -auxWarningThresholdPct) { // Y: -5% to -3%
            return "Warning";
        } else { // G: >= -3% (positive deviation is also good/success)
            return "Success"; 
        }
    } 

    // Exh Temps, SFOC, FOC (Danger if HIGH criteria)
    if (metricKey.includes("Exh") || metricKey === "SFOC" || metricKey === "FOC") {
        if (devPctRaw > auxCriticalThresholdPct) { // R: > +5%
            return "Critical";
        } else if (devPctRaw > auxWarningThresholdPct) { // Y: +3% to +5%
            return "Warning";
        } else { // G: <= +3% (negative deviation is also good/success)
            return "Success";
        }
    }
    
    // Default fallback - symmetrical % deviation (for any other metrics)
    const absDevPct = Math.abs(devPctRaw);
    if (absDevPct <= auxWarningThresholdPct) return "Success";
    else if (absDevPct <= auxCriticalThresholdPct) return "Warning";
    else return "Critical";
};

const getRowBackgroundColor = (status) => {
    switch(status) {
        case "Critical": return "#fee2e2"; // Light Red
        case "Warning": return "#fef3c7"; // Light Yellow
        case "Success": return "#d1fae5"; // Light Green
        default: return "inherit";
    }
};

const getYAxisDomain = (metricKey, baselineData, reports) => {
    const allValues = [];
    
    if (baselineData && baselineData[metricKey]) {
        baselineData[metricKey].forEach(point => {
            if (point.value != null && !isNaN(point.value)) allValues.push(point.value);
        });
    }
    
    if (reports && reports.length > 0) {
        reports.forEach(report => {
            if (report[metricKey] != null && !isNaN(report[metricKey])) {
                allValues.push(report[metricKey]);
            }
        });
    }
    
    if (allValues.length === 0) {
        return AUX_METRIC_DEFAULTS_DOMAIN[metricKey] || [0, 100];
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

const getCustomTicks = (domain) => {
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

const CustomColoredXMarker = ({ cx, cy, fill }) => (
    <g>
        <line x1={cx - 4} y1={cy - 4} x2={cx + 4} y2={cy + 4} stroke={fill} strokeWidth={3} />
        <line x1={cx - 4} y1={cy + 4} x2={cx + 4} y2={cy - 4} stroke={fill} strokeWidth={3} />
    </g>
);

const CustomTooltip = ({ active, payload, label, unit, xAxisType }) => {
    if (active && payload && payload.length) {
        const xLabel = xAxisType === 'load_kw' ? `${label} kW` : `${label}%`;
        return (
            <div style={{ 
                backgroundColor: 'white', 
                padding: '12px 16px', 
                border: '2px solid #e2e8f0', 
                borderRadius: '8px',
                boxShadow: '0 4px 6px -1px rgba(0, 0, 0, 0.1)'
            }}>
                <p style={{ margin: '0 0 8px 0', fontWeight: '700', color: '#1e293b' }}>{xLabel}</p>
                {payload.map((pld, index) => (
                    <p key={index} style={{ color: pld.color, margin: '4px 0', fontWeight: '600' }}>
                        {`${pld.name}: ${pld.value?.toFixed(2)} ${unit || ''}`}
                    </p>
                ))}
            </div>
        );
    }
    return null;
};

const CustomInlineLegend = ({ monthlyReports }) => {
    const legendItems = [
        { value: 'Shop Trial Baseline', type: 'line', color: '#ca8a04' }
    ];
    
    monthlyReports.forEach((report) => {
        legendItems.push({
            value: report.displayName || getMonthDisplayName(report.month),
            type: 'symbol',
            color: report.color
        });
    });
    
    return (
        <div style={{ display: 'flex', justifyContent: 'center', gap: '24px', padding: '16px', flexWrap: 'wrap' }}>
            {legendItems.map((item, index) => (
                <div key={index} style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                    {item.type === 'line' ? (
                        <div style={{ width: '32px', height: '3px', backgroundColor: item.color, borderRadius: '2px' }} />
                    ) : (
                        <span style={{ color: item.color, fontSize: '22px', fontWeight: 'bold' }}>×</span>
                    )}
                    <span style={{ fontSize: '14px', fontWeight: '600', color: '#475569' }}>{item.value}</span>
                </div>
            ))}
        </div>
    );
};

// =======================================================================
// MAIN COMPONENT
// =======================================================================

export default function AuxiliaryEnginePerformance({ vesselId, vessels, apiService }) {
    const [timeFilter, setTimeFilter] = useState("current");
    const [monthlyReports, setMonthlyReports] = useState([]);
    const [historicalReports, setHistoricalReports] = useState([]);
    const [baseline, setBaseline] = useState({});
    const [baselineSource, setBaselineSource] = useState(null);
    const [currentReferenceMonth, setCurrentReferenceMonth] = useState(null);
    const [selectedMetric, setSelectedMetric] = useState("all");
    
    const [generators, setGenerators] = useState([]);
    const [selectedGeneratorId, setSelectedGeneratorId] = useState(null);
    const [xAxisType, setXAxisType] = useState('load_kw');
    const [loading, setLoading] = useState(false);
    const [availableMetrics, setAvailableMetrics] = useState([]);
    const [xAxisOptions, setXAxisOptions] = useState([]);
    const [reportDate, setReportDate] = useState(null);

    const getMetricUnit = (metricKey) => {
        return AUX_METRIC_UNITS[metricKey] || "";
    };

    // Load generators
    useEffect(() => {
        if (!vesselId) return;
        
        const vessel = vessels.find(v => v.id === vesselId);
        if (!vessel) return;
        
        const imoNumber = parseInt(vessel.imo || vessel.imo_number);
        if (!imoNumber) return;
        
        setLoading(true);
        apiService.getGeneratorsList(imoNumber)
            .then(res => {
                const genList = res.generators || [];
                setGenerators(genList);
                if (genList.length > 0 && !selectedGeneratorId) {
                    setSelectedGeneratorId(genList[0].generator_id);
                }
            })
            .catch(error => {
                console.error('Failed to load generators:', error);
                setGenerators([]);
            })
            .finally(() => setLoading(false));
    }, [vesselId, vessels, apiService]);

    // Load baseline
    useEffect(() => {
        if (baselineSource === 'upload' || !selectedGeneratorId) return;
        
        const vessel = vessels.find(v => v.id === vesselId);
        if (!vessel) return;
        
        const imoNumber = parseInt(vessel.imo || vessel.imo_number);
        if (!imoNumber) return;
        
        setLoading(true);
        apiService.getAuxiliaryBaseline(imoNumber)
            .then(res => {
                if (res.baseline_data && Array.isArray(res.baseline_data)) {
                    const transformedBaseline = {};
                    
                    Object.entries(AUX_METRIC_MAPPING).forEach(([frontendKey, backendKey]) => {
                        const points = res.baseline_data
                            .filter(point => point[backendKey] !== null && point[backendKey] !== undefined)
                            .map(point => ({
                                load_kw: point.load_kw,
                                load_percentage: point.load_percentage,
                                value: point[backendKey]
                            }))
                            .sort((a, b) => a.load_kw - b.load_kw);
                        
                        if (points.length > 0) {
                            transformedBaseline[frontendKey] = points;
                        }
                    });
                    
                    if (Object.keys(transformedBaseline).length > 0) {
                        setBaseline(transformedBaseline);
                        setBaselineSource('api');
                    }
                }
            })
            .catch(error => {
                console.error('Failed to load auxiliary baseline:', error);
            })
            .finally(() => setLoading(false));
    }, [selectedGeneratorId, vesselId, vessels, baselineSource, apiService]);

    // Load latest report
    useEffect(() => {
        if (!selectedGeneratorId) return;
        
        setLoading(true);
        apiService.getAuxPerformance(selectedGeneratorId)
            .then(data => {
                if (data.graph_data) {
                    if (data.graph_data.available_metrics) {
                        setAvailableMetrics(data.graph_data.available_metrics);
                    }
                    if (data.graph_data.chart_config) {
                        setXAxisOptions(data.graph_data.chart_config.x_axis_options || []);
                        setXAxisType(data.graph_data.chart_config.default_x_axis || 'load_kw');
                    }
                    
                    if (data.graph_data.report_info) {
                        setReportDate(data.graph_data.report_info.report_date || new Date().toISOString().split('T')[0]);
                    }
                    
                    if (data.graph_data.monthly_performance && data.graph_data.report_info) {
                        const monthlyPoint = data.graph_data.monthly_performance;
                        const reportMonth = data.graph_data.report_info.report_month;
                        
                        const newReport = {
                            month: reportMonth,
                            load_kw: monthlyPoint.load_kw,
                            load_percentage: monthlyPoint.load_percentage,
                            color: getMonthColor(reportMonth),
                            displayName: getMonthDisplayName(reportMonth),
                            report_id: data.graph_data.report_info.report_id
                        };
                        
                        Object.entries(AUX_METRIC_MAPPING).forEach(([frontendKey, backendKey]) => {
                            newReport[frontendKey] = monthlyPoint[backendKey] || null;
                        });
                        
                        setMonthlyReports([newReport]);
                        setCurrentReferenceMonth(reportMonth);
                    }
                }
            })
            .catch(error => {
                console.error('Failed to load performance data:', error);
            })
            .finally(() => setLoading(false));
    }, [selectedGeneratorId, apiService]);

    // Load historical data
    useEffect(() => {
        if (!selectedGeneratorId || timeFilter === "current") {
            setHistoricalReports([]);
            return;
        }
        
        const vessel = vessels.find(v => v.id === vesselId);
        if (!vessel) return;
        
        const imoNumber = parseInt(vessel.imo || vessel.imo_number);
        if (!imoNumber) return;
        
        setLoading(true);
        const periodMap = { "2months": 2, "3months": 3, "6months": 6 };
        const period = periodMap[timeFilter];
        
        apiService.getAuxiliaryPerformanceHistory(imoNumber, period, currentReferenceMonth, true)
            .then(data => {
                if (data.monthly_performance_list && data.monthly_performance_list.length > 0) {
                    const transformedHistorical = data.monthly_performance_list.map(report => {
                        const transformed = {
                            month: report.report_month,
                            load_kw: report.load_kw,
                            load_percentage: report.load_percentage,
                            color: getMonthColor(report.report_month),
                            displayName: getMonthDisplayName(report.report_month),
                            report_id: report.report_id
                        };
                        
                        Object.entries(AUX_METRIC_MAPPING).forEach(([frontendKey, backendKey]) => {
                            transformed[frontendKey] = report[backendKey] || null;
                        });
                        
                        return transformed;
                    });
                    
                    setHistoricalReports(transformedHistorical);
                } else {
                    setHistoricalReports([]);
                }
            })
            .catch(error => {
                console.error('Failed to load historical data:', error);
                setHistoricalReports([]);
            })
            .finally(() => setLoading(false));
    }, [selectedGeneratorId, timeFilter, currentReferenceMonth, vesselId, vessels, apiService]);

    const allMonthlyReports = useMemo(() => {
        if (timeFilter === "current") {
            return monthlyReports;
        } else {
            const combined = [...monthlyReports, ...historicalReports];
            const uniqueByMonth = combined.reduce((acc, report) => {
                if (!acc[report.month]) {
                    acc[report.month] = report;
                }
                return acc;
            }, {});
            return Object.values(uniqueByMonth).sort((a, b) => b.month.localeCompare(a.month));
        }
    }, [monthlyReports, historicalReports, timeFilter]);

    const handleFileUpload = async (event) => {
        const file = event.target.files?.[0];
        if (!file) return;
        
        const vessel = vessels.find(v => v.id === vesselId);
        if (!vessel) {
            alert('Please select a vessel first');
            return;
        }
        
        const imoNumber = parseInt(vessel.imo || vessel.imo_number);
        
        try {
            setLoading(true);
            const result = await apiService.uploadAuxReport(imoNumber, file);
            
            if (result.graph_data) {
                if (result.graph_data.shop_trial_baseline) {
                    const transformedBaseline = {};
                    
                    Object.entries(AUX_METRIC_MAPPING).forEach(([frontendKey, backendKey]) => {
                        const points = result.graph_data.shop_trial_baseline
                            .filter(point => point[backendKey] !== null && point[backendKey] !== undefined)
                            .map(point => ({
                                load_kw: point.load_kw,
                                load_percentage: point.load_percentage,
                                value: point[backendKey]
                            }))
                            .sort((a, b) => a.load_kw - b.load_kw);
                        
                        if (points.length > 0) {
                            transformedBaseline[frontendKey] = points;
                        }
                    });
                    
                    setBaseline(transformedBaseline);
                    setBaselineSource('upload');
                }
                
                if (result.graph_data.report_info) {
                    setReportDate(result.graph_data.report_info.report_date || new Date().toISOString().split('T')[0]);
                }
                
                if (result.graph_data.monthly_performance && result.graph_data.report_info) {
                    const monthlyPoint = result.graph_data.monthly_performance;
                    const reportMonth = result.graph_data.report_info.report_month;
                    
                    setCurrentReferenceMonth(reportMonth);
                    
                    const newReport = {
                        month: reportMonth,
                        load_kw: monthlyPoint.load_kw,
                        load_percentage: monthlyPoint.load_percentage,
                        color: getMonthColor(reportMonth),
                        displayName: getMonthDisplayName(reportMonth),
                        report_id: result.report_id
                    };
                    
                    Object.entries(AUX_METRIC_MAPPING).forEach(([frontendKey, backendKey]) => {
                        newReport[frontendKey] = monthlyPoint[backendKey] || null;
                    });
                    
                    setMonthlyReports([newReport]);
                }
                
                if (result.graph_data.available_metrics) {
                    setAvailableMetrics(result.graph_data.available_metrics);
                }
                if (result.graph_data.chart_config) {
                    setXAxisOptions(result.graph_data.chart_config.x_axis_options || []);
                    setXAxisType(result.graph_data.chart_config.default_x_axis || 'load_kw');
                }
                
                alert(result.message || '✅ Upload successful!');
            }
        } catch (error) {
            console.error('Upload failed:', error);
            alert(`❌ Upload failed: ${error.message}`);
        } finally {
            setLoading(false);
        }
    };

    const deviation = useMemo(() => {
        if (selectedMetric === 'all' || !allMonthlyReports[0] || !baseline) return null;
        
        const currentReport = allMonthlyReports[0];
        const targetLoad = currentReport[xAxisType];
        const monthlyVal = currentReport[selectedMetric];
        const baselineVal = interpolateBaselineAux(baseline, targetLoad, selectedMetric, xAxisType);
        
        if (baselineVal == null || monthlyVal == null) return null;
        
        const diff = monthlyVal - baselineVal;
        const pct = (diff / baselineVal) * 100;
        return { baseAt: baselineVal, monthlyVal, diff, pct };
    }, [baseline, allMonthlyReports, selectedMetric, xAxisType]);

    // ====================================================================
    // UPDATED RENDERER: renderSummaryTable
    // ====================================================================
    const renderSummaryTable = () => {
        if (timeFilter !== "current") return null;
        if (!allMonthlyReports.length || !baseline || Object.keys(baseline).length === 0) return null;
        
        const currentMonthReport = allMonthlyReports[0];
        if (!currentMonthReport) return null;
        
        const load = currentMonthReport.load_percentage;
        const loadKw = currentMonthReport.load_kw;
        
        return (
            <Card className="summary-table-card" style={{ marginBottom: '20px' }}>
                <CardHeader>
                    <CardTitle>Performance Summary @ {load?.toFixed(2) || 'N/A'}% ({loadKw?.toFixed(0) || 'N/A'} kW) Load</CardTitle>
                    <CardDescription>Baseline vs Actual - {currentMonthReport.displayName}</CardDescription>
                </CardHeader>
                <CardContent>
                    <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                        <thead>
                            <tr style={{ borderBottom: '2px solid #ddd' }}>
                                <th style={{ padding: '8px', textAlign: 'left', width: '35%' }}>Parameter</th>
                                <th style={{ padding: '8px', textAlign: 'right', width: '15%' }}>Baseline</th>
                                <th style={{ padding: '8px', textAlign: 'right', width: '15%' }}>Actual</th>
                                <th style={{ padding: '8px', textAlign: 'right', width: '17.5%' }}>Δ</th>
                                <th style={{ padding: '8px', textAlign: 'right', width: '17.5%' }}>Deviation %</th>
                            </tr>
                        </thead>
                        <tbody>
                            {Object.keys(AUX_METRIC_MAPPING).map((metricKey) => {
                                const unit = getMetricUnit(metricKey);
                                const baselineValue = interpolateBaselineAux(baseline, currentMonthReport[xAxisType], metricKey, xAxisType) ?? 0;
                                const actualValue = currentMonthReport[metricKey] ?? baselineValue;
                                const delta = actualValue - baselineValue;
                                const deviationPercent = baselineValue !== 0 ? (delta / baselineValue) * 100 : 0;
                                
                                // Determine status and apply colors
                                const rowStatus = getAlertStatusClass(metricKey, baselineValue, actualValue);
                                const bgColor = getRowBackgroundColor(rowStatus);
                                const textColor = (rowStatus === 'Critical' || rowStatus === 'Warning') 
                                    ? '#dc2626' // Red text for Critical and Warning
                                    : rowStatus === 'Success'
                                    ? '#16a34a' // Green text for Success
                                    : '#1e293b'; // Neutral text for Normal
                                
                                return (
                                    <tr key={metricKey} style={{ backgroundColor: bgColor, borderBottom: '1px solid #eee' }}>
                                        <td style={{ padding: '8px' }}>{metricKey} (<span style={{ color: '#64748b' }}>{unit}</span>)</td>
                                        <td style={{ padding: '8px', textAlign: 'right' }}>{baselineValue.toFixed(2)}</td>
                                        <td style={{ padding: '8px', textAlign: 'right' }}>{actualValue.toFixed(2)}</td>
                                        <td style={{ padding: '8px', textAlign: 'right', color: textColor, fontWeight: 'bold' }}>
                                            {delta >= 0 ? '+' : ''}{delta.toFixed(2)}
                                        </td>
                                        <td style={{ padding: '8px', textAlign: 'right', color: textColor, fontWeight: 'bold' }}>
                                            {deviationPercent >= 0 ? '+' : ''}{deviationPercent.toFixed(1)}%
                                        </td>
                                    </tr>
                                );
                            })}
                        </tbody>
                    </table>
                </CardContent>
            </Card>
        );
    };

    const renderAllCharts = () => {
        if (!baseline || Object.keys(baseline).length === 0) return null;
        
        return (
            <>
                {renderSummaryTable()}
                <div className="charts-grid" style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(400px, 1fr))', gap: '20px', marginTop: '20px' }}>
                    {AUX_GRAPH_ORDER.map((metricKey) => {
                        const chartData = baseline[metricKey] ?
                            baseline[metricKey].map(point => ({
                                x: point[xAxisType],
                                y: point.value
                            })).filter(point => point.x != null && point.y != null)
                            : [];
                        
                        const yDomain = getYAxisDomain(metricKey, baseline, allMonthlyReports);
                        const customTicks = getCustomTicks(yDomain);
                        const unit = getMetricUnit(metricKey);
                        const xLabel = xAxisOptions.find(opt => opt.key === xAxisType)?.label || xAxisType;
                        
                        return (
                            <Card key={metricKey} className="chart-card">
                                <CardHeader>
                                    <CardTitle>{metricKey}</CardTitle>
                                    <CardDescription>{unit} vs {xLabel}</CardDescription>
                                </CardHeader>
                                <CardContent>
                                    <ResponsiveContainer width="100%" height={300}>
                                        <LineChart data={chartData} margin={{ left: 8, right: 8, top: 8, bottom: 8 }}>
                                            <CartesianGrid strokeDasharray="3 3" />
                                            <XAxis dataKey="x" type="number" />
                                            <YAxis width={50} domain={yDomain} ticks={customTicks} tickFormatter={(v) => v.toFixed(1)} />
                                            <Line type="monotone" dataKey="y" stroke="#ca8a04" strokeWidth={2} dot={true} name="Shop Trial Baseline" />
                                            {allMonthlyReports.map((report) => (
                                                <ReferenceDot
                                                    key={report.month}
                                                    x={report[xAxisType]}
                                                    y={report[metricKey] ?? interpolateBaselineAux(baseline, report[xAxisType], metricKey, xAxisType) ?? 0}
                                                    shape={<CustomColoredXMarker />}
                                                    fill={report.color}
                                                />
                                            ))}
                                            <Tooltip content={<CustomTooltip unit={unit} xAxisType={xAxisType} />} />
                                            <Legend content={<CustomInlineLegend monthlyReports={allMonthlyReports} />} />
                                        </LineChart>
                                    </ResponsiveContainer>
                                </CardContent>
                            </Card>
                        );
                    })}
                </div>
            </>
        );
    };

    const downloadPDF = async () => {
        let pdf;
        let fileName = 'performance-report.pdf';
        const elementsToRevert = [];
        const generator = generators.find(g => g.generator_id === selectedGeneratorId);
        const vessel = vessels.find(v => v.id === vesselId);
        const report = allMonthlyReports[0];

        try {
            pdf = new jsPDF('l', 'mm', 'a4');
            const margin = 10;
            const pageWidth = pdf.internal.pageSize.getWidth();
            const pageHeight = pdf.internal.pageSize.getHeight();
            const contentWidth = pageWidth - 2 * margin;
            let currentY = margin;

            pdf.setFont('helvetica', 'bold');
            pdf.setFontSize(16);
            pdf.text(`Auxiliary Engine Performance Analysis Report – ${vessel?.name || 'Unknown Vessel'}`, margin, currentY);
            currentY += 8;
            
            pdf.setFont('helvetica', 'normal');
            pdf.setFontSize(12);
            pdf.text(`Generator: ${generator?.designation || 'N/A'}`, margin, currentY);
            currentY += 6;

            const loadDisplay = report ? `${report.load_percentage?.toFixed(2) || 'N/A'}% (${report.load_kw?.toFixed(0) || 'N/A'} kW) Load` : 'N/A Load';
            const dateDisplay = report?.report_date || reportDate || new Date().toLocaleDateString();

            pdf.text(`Report Date: ${dateDisplay}`, margin, currentY);
            currentY += 6;
            
            pdf.setFont('helvetica', 'bold');
            pdf.setFontSize(13);
            pdf.text(`1. Performance Summary @ ${loadDisplay}`, margin, currentY);
            pdf.text(`Baseline vs Actual - ${report?.displayName || 'N/A Month'}`, margin, currentY + 6);
            currentY += 14;

            const summaryTableElement = document.querySelector('.summary-table-card');
            if (summaryTableElement) {
                const cardHeader = summaryTableElement.querySelector('[class*="card-header"]');
                const originalDisplay = cardHeader ? cardHeader.style.display : null;
                if (cardHeader) cardHeader.style.display = 'none';

                const tableContent = summaryTableElement.querySelector('[class*="card-content"]') || summaryTableElement;
                
                const tableCanvas = await html2canvas(tableContent, {
                    scale: 3, useCORS: true, backgroundColor: '#ffffff', allowTaint: false,
                    width: tableContent.offsetWidth, height: tableContent.offsetHeight
                });
                
                const tableImgData = tableCanvas.toDataURL('image/png');
                const tableImgHeight = (tableCanvas.height * contentWidth) / tableCanvas.width;

                if (currentY + tableImgHeight + 10 > pageHeight - margin) {
                    pdf.addPage();
                    currentY = margin;
                }

                pdf.addImage(tableImgData, 'PNG', margin, currentY, contentWidth, tableImgHeight);
                currentY += tableImgHeight + 15;

                if (cardHeader && originalDisplay !== null) cardHeader.style.display = originalDisplay;
            }

            let index = 2;
            const charts = Array.from(document.querySelectorAll('.charts-grid .chart-card'));
            for (const chart of charts) {
                const canvas = await html2canvas(chart, { scale: 2, useCORS: true, backgroundColor: '#ffffff', allowTaint: false });
                const imgData = canvas.toDataURL('image/png');
                const imgWidth = contentWidth * 0.9;
                const imgHeight = (canvas.height * imgWidth) / canvas.width;
                
                if (currentY + imgHeight + 15 > pageHeight - margin) {
                    pdf.addPage();
                    currentY = margin;
                }

                const title = chart.querySelector('[class*="card-title"]')?.textContent || 'Chart';
                pdf.setFont('helvetica', 'bold');
                pdf.setFontSize(13);
                pdf.text(`${index}. ${title} vs Load`, margin, currentY);
                currentY += 6;
                
                pdf.addImage(imgData, 'PNG', margin, currentY, imgWidth, imgHeight);
                currentY += imgHeight + 10;
                index++;
            }

            const monthPart = report?.displayName?.replace(/\s+/g, '') || 'report';
            const vesselPart = vessel?.name?.replace(/[^a-z0-9]/gi, '_') || 'vessel';
            fileName = `aux-engine-${monthPart}-${vesselPart}.pdf`;
            
        } catch (error) {
            console.error('PDF generation failed:', error);
            alert('Failed to generate PDF. Please try again.');
        } finally {
            elementsToRevert.forEach(({ el, oldWidth, oldHeight }) => {
                if (document.body.contains(el)) {
                    el.style.width = oldWidth;
                    el.style.height = oldHeight;
                }
            });
            
            if (pdf) {
                pdf.save(fileName);
            }
        }
    };

    if (loading && generators.length === 0) {
        return <div style={{ padding: '20px' }}>Loading auxiliary engine data...</div>;
    }

    const series = baseline[selectedMetric] ?
        baseline[selectedMetric].map(p => ({ x: p[xAxisType], y: p.value })).filter(p => p.x != null && p.y != null)
        : [];

    const currentMetricUnit = getMetricUnit(selectedMetric);
    const xLabel = xAxisOptions.find(opt => opt.key === xAxisType)?.label || xAxisType;

    return (
        <div style={{ padding: '20px' }}>
            <div style={{ display: 'flex', gap: '15px', marginBottom: '20px', flexWrap: 'wrap' }}>
                <Select value={selectedGeneratorId || ''} onChange={(e) => setSelectedGeneratorId(parseInt(e.target.value))} style={{ minWidth: '200px' }}>
                    {generators.map(gen => (
                        <option key={gen.generator_id} value={gen.generator_id}>{gen.designation}</option>
                    ))}
                </Select>

                <Select value={selectedMetric} onChange={(e) => setSelectedMetric(e.target.value)} style={{ minWidth: '250px' }}>
                    <option value="all">All Metrics</option>
                    {Object.keys(AUX_METRIC_MAPPING).map(metricKey => (
                        <option key={metricKey} value={metricKey}>
                            {metricKey} ({getMetricUnit(metricKey)})
                        </option>
                    ))}
                </Select>

                <Select value={xAxisType} onChange={(e) => setXAxisType(e.target.value)} style={{ minWidth: '150px' }}>
                    {xAxisOptions.map(opt => (
                        <option key={opt.key} value={opt.key}>{opt.label}</option>
                    ))}
                </Select>

                <Select value={timeFilter} onChange={(e) => setTimeFilter(e.target.value)} style={{ minWidth: '180px' }}>
                    <option value="current">Current Month</option>
                    <option value="2months">Last 2 Months</option>
                    <option value="3months">Last 3 Months</option>
                    <option value="6months">Last 6 Months</option>
                </Select>

                <input type="file" accept=".pdf" style={{ display: 'none' }} id="aux-pdf-upload" onChange={handleFileUpload} />
                <Button variant="outline" size="sm" onClick={() => document.getElementById('aux-pdf-upload').click()}>
                    Upload Monthly PDF
                </Button>
                <Button variant="secondary" size="sm" onClick={downloadPDF}>Download PDF</Button>
            </div>

            {selectedMetric === "all" ? renderAllCharts() : (
                <Card>
                    <CardHeader>
                        <CardTitle>Baseline vs Monthly - {selectedMetric}</CardTitle>
                        <CardDescription>
                            {allMonthlyReports.length > 0
                                ? `Showing ${allMonthlyReports.length} month(s) - ${timeFilter === "current" ? "Current month only" : timeFilter.replace('months', ' months')}`
                                : "Upload monthly PDF to overlay data points"
                            }
                        </CardDescription>
                    </CardHeader>
                    <CardContent>
                        <div className="main-chart-container" style={{ width: '100%', height: '400px' }}>
                            <ResponsiveContainer width="100%" height="100%">
                                <LineChart data={series} margin={{ left: 16, right: 16, top: 8, bottom: 8 }}>
                                    <CartesianGrid strokeDasharray="3 3" />
                                    <XAxis dataKey="x" type="number" label={{ value: xLabel, position: 'insideBottom', offset: -10 }} />
                                    <YAxis 
                                        width={60}
                                        domain={getYAxisDomain(selectedMetric, baseline, allMonthlyReports)}
                                        ticks={getCustomTicks(getYAxisDomain(selectedMetric, baseline, allMonthlyReports))}
                                        tickFormatter={(v) => v.toFixed(1)}
                                        label={{ value: currentMetricUnit, angle: -90, position: 'insideLeft' }}
                                    />
                                    <Line type="monotone" dataKey="y" stroke="#ca8a04" strokeWidth={2} dot={true} name="Shop Trial Baseline" />
                                    {allMonthlyReports.map((report) => (
                                        <ReferenceDot
                                            key={report.month}
                                            x={report[xAxisType]}
                                            y={report[selectedMetric] ?? interpolateBaselineAux(baseline, report[xAxisType], selectedMetric, xAxisType) ?? 0}
                                            shape={<CustomColoredXMarker />}
                                            fill={report.color}
                                        />
                                    ))}
                                    <Tooltip content={<CustomTooltip unit={currentMetricUnit} xAxisType={xAxisType} />} />
                                    <Legend content={<CustomInlineLegend monthlyReports={allMonthlyReports} />} />
                                </LineChart>
                            </ResponsiveContainer>
                        </div>
                    </CardContent>
                </Card>
            )}

            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(300px, 1fr))', gap: '20px', marginTop: '20px' }}>
                <Card>
                    <CardHeader>
                        <CardTitle>Selected Generator</CardTitle>
                        <CardDescription>{generators.find(g => g.generator_id === selectedGeneratorId)?.designation}</CardDescription>
                    </CardHeader>
                    <CardContent>
                        {allMonthlyReports[0] ? (
                            <div>
                                <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '8px' }}>
                                    <span>Load:</span>
                                    <span style={{ fontWeight: 'bold' }}>
                                        {allMonthlyReports[0].load_percentage}% ({allMonthlyReports[0].load_kw} kW)
                                    </span>
                                </div>
                                {selectedMetric !== 'all' && (
                                    <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '8px' }}>
                                        <span>{selectedMetric}:</span>
                                        <span style={{ fontWeight: 'bold' }}>
                                            {(allMonthlyReports[0][selectedMetric] ?? interpolateBaselineAux(baseline, allMonthlyReports[0][xAxisType], selectedMetric, xAxisType))?.toFixed(2)} {currentMetricUnit}
                                        </span>
                                    </div>
                                )}
                                <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                                    <span>Historical points:</span>
                                    <span style={{ fontWeight: 'bold' }}>{allMonthlyReports.length}</span>
                                </div>
                            </div>
                        ) : (
                            <div style={{ textAlign: 'center', color: '#999' }}>Awaiting monthly upload...</div>
                        )}
                    </CardContent>
                </Card>

                {selectedMetric !== 'all' && (
                    <Card>
                        <CardHeader>
                            <CardTitle>Deviation</CardTitle>
                            <CardDescription>Difference from baseline at same load</CardDescription>
                        </CardHeader>
                        <CardContent>
                            {deviation ? (
                                <div>
                                    <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '8px' }}>
                                        <span>Baseline:</span>
                                        <span style={{ fontWeight: 'bold' }}>{deviation.baseAt.toFixed(2)}</span>
                                    </div>
                                    <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '8px' }}>
                                        <span>Monthly:</span>
                                        <span style={{ fontWeight: 'bold' }}>{deviation.monthlyVal.toFixed(2)}</span>
                                    </div>
                                    <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '8px' }}>
                                        <span>Diff:</span>
                                        <span style={{ fontWeight: 'bold', color: deviation.diff >= 0 ? '#dc2626' : '#16a34a' }}>
                                            {deviation.diff >= 0 ? '+' : ''}{deviation.diff.toFixed(2)}
                                        </span>
                                    </div>
                                    <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                                        <span>Deviation %:</span>
                                        <span style={{ fontWeight: 'bold', color: deviation.pct >= 0 ? '#dc2626' : '#16a34a' }}>
                                            {deviation.pct >= 0 ? '+' : ''}{deviation.pct.toFixed(2)}%
                                        </span>
                                    </div>
                                </div>
                            ) : (
                                <div style={{ textAlign: 'center', color: '#999' }}>Upload a monthly PDF to see deviation</div>
                            )}
                        </CardContent>
                    </Card>
                )}
            </div>
        </div>
    );
}
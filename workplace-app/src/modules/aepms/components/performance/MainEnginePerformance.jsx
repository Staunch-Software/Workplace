import React, { useEffect, useMemo, useState } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '../ui/Card';
import Select from '../ui/Select';
import Button from '../ui/Button';
import { LineChart, Line, ReferenceDot, XAxis, YAxis, CartesianGrid, ResponsiveContainer, Tooltip, Legend } from 'recharts';
import jsPDF from 'jspdf';
import html2canvas from 'html2canvas';
import ozellarLogo from "../../assets/250714_OzellarMarine-Logo-Final.png";
export default function MainEnginePerformance({ shipId, fleet, apiService }) {
    const [timeFilter, setTimeFilter] = useState("current");
    const [monthlyReports, setMonthlyReports] = useState([]);
    const [historicalReports, setHistoricalReports] = useState([]);
    const [baseline, setBaseline] = useState({});
    const [baselineSource, setBaselineSource] = useState(null);
    const [graphData, setGraphData] = useState(null);
    const [loading, setLoading] = useState(false);
    const [currentReferenceMonth, setCurrentReferenceMonth] = useState(null);
    const [selectedMetric, setSelectedMetric] = useState("all");

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

    const interpolateBaseline = (baselineData, targetLoad, metric) => {
        if (!baselineData || !baselineData[metric]) return null;
        const series = baselineData[metric];
        if (!series || series.length === 0) return null;
        const sortedSeries = series.slice().sort((a, b) => a.load - b.load);
        const exactMatch = sortedSeries.find(point => Math.abs(point.load - targetLoad) < 0.01);
        if (exactMatch) return exactMatch.value;
        for (let i = 0; i < sortedSeries.length - 1; i++) {
            const current = sortedSeries[i];
            const next = sortedSeries[i + 1];
            if (current.load <= targetLoad && targetLoad <= next.load) {
                const t = (targetLoad - current.load) / (next.load - current.load);
                return current.value + t * (next.value - current.value);
            }
        }
        return targetLoad <= sortedSeries[0].load ? sortedSeries[0].value : sortedSeries[sortedSeries.length - 1].value;
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
            baselineData[metricKey].forEach(point => {
                if (point.value != null && !isNaN(point.value)) allValues.push(point.value);
            });
        }
        if (monthlyReports && monthlyReports.length > 0) {
            monthlyReports.forEach(report => {
                if (report[metricKey] != null && !isNaN(report[metricKey])) {
                    allValues.push(report[metricKey]);
                }
            });
        }
        if (allValues.length === 0) {
            const defaults = {
                "SFOC": [160, 200], "Pmax": [80, 140], "Turbospeed": [8, 16],
                "EngSpeed": [100, 130], "ScavAir": [1.5, 3.0],
                "Exh_T/C_inlet": [350, 450], "Exh_Cylinder_outlet": [300, 400],
                "Exh_T/C_outlet": [250, 350], "FIPI": [8, 16], "FOC": [1.5, 4.0]
            };
            return defaults[metricKey] || [0, 100];
        }
        const minValue = Math.min(...allValues);
        const maxValue = Math.max(...allValues);
        const range = maxValue - minValue;
        const expandedRange = range < 0.1 ? 0.1 : range;
        const padding = expandedRange * 0.15;
        const domainMin = minValue - padding;
        const domainMax = maxValue + padding;
        const roughTickSize = expandedRange / 4;
        const niceTickSize = getNiceNumber(roughTickSize);
        const niceDomainMin = Math.floor(domainMin / niceTickSize) * niceTickSize;
        const niceDomainMax = Math.ceil(domainMax / niceTickSize) * niceTickSize;
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

    useEffect(() => {
        if (baselineSource === 'upload' || !shipId) return;
        setBaseline({});
        setMonthlyReports([]);
        setHistoricalReports([]);
        setGraphData(null);
        setCurrentReferenceMonth(null);
        setLoading(true);
        const ship = fleet.find(s => s.id === shipId);
        if (!ship) {
            setLoading(false);
            return;
        }
        const imoNumber = parseInt(ship.imo || ship.imo_number);
        if (!imoNumber) {
            setLoading(false);
            return;
        }
        apiService.getBaseline(imoNumber)
            .then(res => {
                if (res.baseline_data && Array.isArray(res.baseline_data)) {
                    const transformedBaseline = {};
                    const metricMapping = {
                        "SFOC": "sfoc_g_kwh", "Pmax": "max_combustion_pressure_bar",
                        "Turbospeed": "turbocharger_speed_x1000_rpm", "EngSpeed": "engine_speed_rpm",
                        "ScavAir": "scav_air_pressure_kg_cm2", "Exh_T/C_inlet": "exh_temp_tc_inlet_c",
                        "Exh_Cylinder_outlet": "cyl_exhaust_gas_temp_outlet_c",
                        "Exh_T/C_outlet": "exh_temp_tc_outlet_c", "FIPI": "fuel_inj_pump_index_mm",
                        "FOC": "fuel_consumption_total_kg_h"
                    };
                    Object.entries(metricMapping).forEach(([frontendKey, backendKey]) => {
                        const points = res.baseline_data
                            .filter(point => point[backendKey] !== null && point[backendKey] !== undefined && !isNaN(point[backendKey]))
                            .map(point => ({ load: point.load_percentage, value: point[backendKey] }))
                            .sort((a, b) => a.load - b.load);
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
                console.error('Failed to load baseline:', error);
            })
            .finally(() => {
                setLoading(false);
            });
    }, [shipId, fleet, baselineSource, apiService]);

    useEffect(() => {
        if (shipId && timeFilter !== "current") {
            loadHistoricalData();
        } else {
            setHistoricalReports([]);
        }
    }, [shipId, timeFilter, currentReferenceMonth]);

    const loadHistoricalData = async () => {
        if (!shipId || timeFilter === "current") return;
        setLoading(true);
        try {
            const periodMap = { "2months": 2, "3months": 3, "6months": 6 };
            const period = periodMap[timeFilter];
            const ship = fleet.find(s => s.id === shipId);
            const imoNumber = parseInt(ship.imo || ship.imo_number);
            const data = await apiService.getPerformanceData(imoNumber, timeFilter, currentReferenceMonth);
            if (data.monthly_performance_list && data.monthly_performance_list.length > 0) {
                const transformedHistorical = data.monthly_performance_list.map(report => ({
                    month: report.report_month, load: report.load_percentage,
                    SFOC: report.sfoc_g_kwh, Pmax: report.max_combustion_pressure_bar,
                    Turbospeed: report.turbocharger_speed_x1000_rpm, EngSpeed: report.engine_speed_rpm,
                    ScavAir: report.scav_air_pressure_kg_cm2, "Exh_T/C_inlet": report.exh_temp_tc_inlet_c,
                    "Exh_Cylinder_outlet": report.cyl_exhaust_gas_temp_outlet_c,
                    "Exh_T/C_outlet": report.exh_temp_tc_outlet_c, FIPI: report.fuel_inj_pump_index_mm,
                    FOC: report.fuel_consumption_total_kg_h, color: getMonthColor(report.report_month),
                    displayName: getMonthDisplayName(report.report_month), report_id: report.report_id
                }));
                setHistoricalReports(transformedHistorical);
            } else {
                setHistoricalReports([]);
            }
        } catch (error) {
            console.error('Failed to load historical data:', error);
            setHistoricalReports([]);
        } finally {
            setLoading(false);
        }
    };

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

    // UPDATED handleCSV function for MainEnginePerformance.jsx
async function handleCSV(file) {
    try {
        setLoading(true);
        setMonthlyReports([]);
        setGraphData(null);
        
        const response = await apiService.uploadCsv(shipId, file);
        
        if (!response.graph_data) {
            throw new Error("No graph data in upload response");
        }
        
        setGraphData(response.graph_data);
        
        const transformedBaseline = {};
        const shopTrialData = response.graph_data.shop_trial_baseline;
        const metricMapping = {
            "SFOC": "sfoc_g_kwh", "Pmax": "max_combustion_pressure_bar",
            "Turbospeed": "turbocharger_speed_x1000_rpm", "EngSpeed": "engine_speed_rpm",
            "ScavAir": "scav_air_pressure_kg_cm2", "Exh_T/C_inlet": "exh_temp_tc_inlet_c",
            "Exh_Cylinder_outlet": "cyl_exhaust_gas_temp_outlet_c",
            "Exh_T/C_outlet": "exh_temp_tc_outlet_c", "FIPI": "fuel_inj_pump_index_mm",
            "FOC": "fuel_consumption_total_kg_h"
        };
        
        Object.entries(metricMapping).forEach(([frontendKey, backendKey]) => {
            const baselinePoints = shopTrialData
                .filter(point => point[backendKey] !== null && point[backendKey] !== undefined && !isNaN(point[backendKey]))
                .map(point => ({ load: point.load_percentage, value: point[backendKey] }))
                .sort((a, b) => a.load - b.load);
            if (baselinePoints.length > 0) {
                transformedBaseline[frontendKey] = baselinePoints;
            }
        });
        
        setBaseline(transformedBaseline);
        setBaselineSource('upload');
        
        const monthlyPoint = response.graph_data.monthly_performance;
        const currentMonth = response.graph_data.report_info?.report_month || new Date().toISOString().slice(0, 7);
        
        // ✅ UPDATE REFERENCE MONTH
        setCurrentReferenceMonth(currentMonth);
        
        const newReport = {
            month: currentMonth, load: monthlyPoint.load_percentage || 0,
            SFOC: monthlyPoint.sfoc_g_kwh || null, Pmax: monthlyPoint.max_combustion_pressure_bar || null,
            Turbospeed: monthlyPoint.turbocharger_speed_x1000_rpm || null,
            EngSpeed: monthlyPoint.engine_speed_rpm || null,
            ScavAir: monthlyPoint.scav_air_pressure_kg_cm2 || null,
            "Exh_T/C_inlet": monthlyPoint.exh_temp_tc_inlet_c || null,
            "Exh_Cylinder_outlet": monthlyPoint.cyl_exhaust_gas_temp_outlet_c || null,
            "Exh_T/C_outlet": monthlyPoint.exh_temp_tc_outlet_c || null,
            FIPI: monthlyPoint.fuel_inj_pump_index_mm || null,
            FOC: monthlyPoint.fuel_consumption_total_kg_h || null,
            color: getMonthColor(currentMonth), displayName: getMonthDisplayName(currentMonth)
        };
        
        setMonthlyReports([newReport]);
        
        // ✅ DISPLAY BACKEND MESSAGE
        alert(response.message || '✅ Upload successful!');
        
    } catch (error) {
        console.error('Upload failed:', error);
        alert(`❌ Upload failed: ${error.message}`);
    } finally {
        setLoading(false);
    }
}
    const handleFileUpload = (event) => {
        const file = event.target.files?.[0];
        if (file) {
            handleCSV(file);
        }
    };

    const getMetricUnit = (metricKey) => {
        const units = {
            "SFOC": "g/kWh", "Pmax": "bar", "Turbospeed": "Ã—1000 RPM",
            "EngSpeed": "RPM", "ScavAir": "kg/cmÂ²", "Exh_T/C_inlet": "Â°C",
            "Exh_Cylinder_outlet": "Â°C", "Exh_T/C_outlet": "Â°C", "FIPI": "mm", "FOC": "kg/h"
        };
        return units[metricKey] || "";
    };

    const CustomColoredXMarker = ({ cx, cy, fill }) => {
        return (
            <g>
                <line x1={cx - 4} y1={cy - 4} x2={cx + 4} y2={cy + 4} stroke={fill} strokeWidth={3} />
                <line x1={cx - 4} y1={cy + 4} x2={cx + 4} y2={cy - 4} stroke={fill} strokeWidth={3} />
            </g>
        );
    };

    const CustomTooltip = ({ active, payload, label }) => {
        if (active && payload && payload.length) {
            return (
                <div style={{ background: 'white', border: '1px solid #ccc', padding: '10px', borderRadius: '4px' }}>
                    <p style={{ margin: '0 0 5px 0', fontWeight: 'bold' }}>{`Load: ${label}%`}</p>
                    {payload.map((pld, index) => (
                        <p key={index} style={{ color: pld.color, margin: '2px 0' }}>
                            {`${pld.name}: ${pld.value?.toFixed(1)} ${getMetricUnit(selectedMetric)}`}
                        </p>
                    ))}
                </div>
            );
        }
        return null;
    };

    const CustomInlineLegend = () => {
        const legendItems = [];
        legendItems.push({ value: 'Shop Trial Baseline', type: 'line', color: '#ca8a04' });
        allMonthlyReports.forEach((report) => {
            legendItems.push({
                value: report.displayName || getMonthDisplayName(report.month),
                type: 'symbol', color: report.color
            });
        });
        return (
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: '12px', marginTop: '8px', justifyContent: 'center' }}>
                {legendItems.map((item, index) => (
                    <div key={index} style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
                        {item.type === 'line' ? (
                            <div style={{ width: '20px', height: '2px', backgroundColor: item.color }}></div>
                        ) : (
                            <span style={{ color: item.color, fontSize: '20px', fontWeight: 'bold' }}>Ã—</span>
                        )}
                        <span style={{ fontSize: '12px' }}>{item.value}</span>
                    </div>
                ))}
            </div>
        );
    };

    const renderSummaryTable = () => {
        if (timeFilter !== "current") return null;
        if (!allMonthlyReports.length || !baseline || Object.keys(baseline).length === 0) return null;
        const currentMonthReport = allMonthlyReports[0];
        if (!currentMonthReport) return null;
        const load = currentMonthReport.load;
        const tableData = [
            { param: "SFOC (g/kWh)", metric: "SFOC" },
            { param: "Pmax (bar)", metric: "Pmax" },
            { param: "Turbospeed (Ã—1000 rpm)", metric: "Turbospeed" },
            { param: "Engine Speed (rpm)", metric: "EngSpeed" },
            { param: "Scav Air Pressure (kg/cmÂ²)", metric: "ScavAir" },
            { param: "Exh T/C Inlet (Â°C)", metric: "Exh_T/C_inlet" },
            { param: "Exh Cylinder Outlet (Â°C)", metric: "Exh_Cylinder_outlet" },
            { param: "Exh T/C Outlet (Â°C)", metric: "Exh_T/C_outlet" },
            { param: "FIPI (mm)", metric: "FIPI" },
            { param: "FOC (kg/h)", metric: "FOC" }
        ];
        return (
            <Card className="summary-table-card" style={{ marginBottom: '20px' }}>
                <CardHeader>
                    <CardTitle>Performance Summary @ {load}% Load - {currentMonthReport.displayName}</CardTitle>
                    <CardDescription>Baseline vs Actual Performance Comparison</CardDescription>
                </CardHeader>
                <CardContent>
                    <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                        <thead>
                            <tr style={{ borderBottom: '2px solid #ddd' }}>
                                <th style={{ padding: '8px', textAlign: 'left' }}>Parameter</th>
                                <th style={{ padding: '8px', textAlign: 'right' }}>Baseline</th>
                                <th style={{ padding: '8px', textAlign: 'right' }}>Actual</th>
                                <th style={{ padding: '8px', textAlign: 'right' }}>Î”</th>
                                <th style={{ padding: '8px', textAlign: 'right' }}>Deviation %</th>
                            </tr>
                        </thead>
                        <tbody>
                            {tableData.map(({ param, metric }) => {
                                const baselineValue = interpolateBaseline(baseline, load, metric) ?? 0;
                                const actualValue = currentMonthReport[metric] ?? baselineValue;
                                const delta = actualValue - baselineValue;
                                const deviationPercent = baselineValue !== 0 ? (delta / baselineValue) * 100 : 0;
                                return (
                                    <tr key={metric} style={{ borderBottom: '1px solid #eee' }}>
                                        <td style={{ padding: '8px' }}>{param}</td>
                                        <td style={{ padding: '8px', textAlign: 'right' }}>{baselineValue.toFixed(2)}</td>
                                        <td style={{ padding: '8px', textAlign: 'right' }}>{actualValue.toFixed(2)}</td>
                                        <td style={{ padding: '8px', textAlign: 'right', color: delta >= 0 ? '#dc2626' : '#16a34a', fontWeight: 'bold' }}>
                                            {delta >= 0 ? '+' : ''}{delta.toFixed(2)}
                                        </td>
                                        <td style={{ padding: '8px', textAlign: 'right', color: deviationPercent >= 0 ? '#dc2626' : '#16a34a', fontWeight: 'bold' }}>
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
        const metrics = ["SFOC", "Turbospeed", "Pmax", "EngSpeed", "ScavAir", "Exh_T/C_inlet", 
                        "Exh_Cylinder_outlet", "Exh_T/C_outlet", "FIPI", "FOC"];
        return (
            <>
                {renderSummaryTable()}
                <div className="charts-grid" style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(400px, 1fr))', gap: '20px', marginTop: '20px' }}>
                    {metrics.map((metricKey) => {
                        const chartData = baseline[metricKey] ?
                            baseline[metricKey]
                                .filter((point, index, arr) => arr.findIndex(p => p.load === point.load) === index)
                                .map((p) => ({ x: p.load, y: p.value })) : [];
                        const yDomain = getYAxisDomain(metricKey, { [metricKey]: baseline[metricKey] }, allMonthlyReports);
                        const customTicks = getCustomTicks(yDomain);
                        return (
                            <Card key={metricKey} className="chart-card">
                                <CardHeader>
                                    <CardTitle>{metricKey}</CardTitle>
                                    <CardDescription>{getMetricUnit(metricKey)} vs Load</CardDescription>
                                </CardHeader>
                                <CardContent>
                                    <ResponsiveContainer width="100%" height={300}>
                                        <LineChart data={chartData} margin={{ left: 8, right: 8, top: 8, bottom: 8 }}>
                                            <CartesianGrid strokeDasharray="3 3" />
                                            <XAxis dataKey="x" type="number" domain={[0, 110]} ticks={[25, 50, 75, 100, 110]} tickFormatter={(v) => `${v}%`} />
                                            <YAxis width={50} domain={yDomain} ticks={customTicks} tickFormatter={(v) => v.toFixed(1)} />
                                            <Line type="monotone" dataKey="y" stroke="#ca8a04" strokeWidth={2} dot={true} name="Shop Trial Baseline" />
                                            {allMonthlyReports.map((report) => (
                                                <ReferenceDot key={report.month} x={report.load}
                                                    y={report[metricKey] ?? interpolateBaseline(baseline, report.load, metricKey) ?? 0}
                                                    shape={<CustomColoredXMarker />} fill={report.color} />
                                            ))}
                                            <Tooltip content={<CustomTooltip />} />
                                            <Legend content={<CustomInlineLegend />} />
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

    const series = baseline[selectedMetric] ?
        baseline[selectedMetric].filter((point, index, arr) => arr.findIndex(p => p.load === point.load) === index)
            .map((p) => ({ load: p.load, value: p.value })) : [];

    const deviation = useMemo(() => {
        if (selectedMetric === "all") return null;
        const currentMonthReport = allMonthlyReports[0];
        if (!currentMonthReport) return null;
        const baseAt = interpolateBaseline(baseline, currentMonthReport.load, selectedMetric);
        if (baseAt == null) return null;
        const monthlyVal = currentMonthReport[selectedMetric] ?? baseAt;
        const diff = monthlyVal - baseAt;
        const pct = (diff / baseAt) * 100;
        return { baseAt, monthlyVal, diff, pct };
    }, [baseline, allMonthlyReports, selectedMetric]);

    const downloadPDF = async () => {
        try {
            const pdf = new jsPDF('l', 'mm', 'a4');
            const ship = fleet.find(s => s.id === shipId);
            const reportMonthReport = allMonthlyReports[0];
            const reportMonth = reportMonthReport ? reportMonthReport.month : new Date().toISOString().slice(0, 7);
            const reportMonthFormatted = new Date(reportMonth + '-01').toLocaleDateString('en-US', { year: 'numeric', month: 'long' });
            const pageWidth = pdf.internal.pageSize.getWidth();
            const pageHeight = pdf.internal.pageSize.getHeight();
            const margin = 15;
            const contentWidth = pageWidth - (2 * margin);
            let currentY = margin;

            pdf.setFontSize(16);
            pdf.text(`Performance Report - ${ship?.name || 'Unknown Vessel'}`, margin, currentY + 10);
            pdf.setFontSize(12);
            pdf.text(`IMO: ${ship?.imo || ship?.imo_number || 'N/A'} | Report Month: ${reportMonthFormatted}`, margin, currentY + 20);
            currentY = margin + 30;

            const checkAndAddNewPage = (requiredHeight) => {
                if (currentY + requiredHeight > pageHeight - margin) {
                    pdf.addPage();
                    currentY = margin;
                    return true;
                }
                return false;
            };

            if (selectedMetric === "all") {
                const summaryTableElement = document.querySelector('.summary-table-card');
                if (summaryTableElement && window.getComputedStyle(summaryTableElement).display !== 'none') {
                    const tableCanvas = await html2canvas(summaryTableElement, {
                        scale: 3, useCORS: true, backgroundColor: '#ffffff', allowTaint: false,
                        width: summaryTableElement.offsetWidth, height: summaryTableElement.offsetHeight
                    });
                    const tableImgData = tableCanvas.toDataURL('image/png');
                    const tableImgHeight = (tableCanvas.height * contentWidth) / tableCanvas.width;
                    checkAndAddNewPage(tableImgHeight);
                    pdf.addImage(tableImgData, 'PNG', margin, currentY, contentWidth, tableImgHeight);
                    currentY += tableImgHeight + 15;
                }

                const chartElements = Array.from(document.querySelectorAll('.charts-grid .chart-card'));
                for (let i = 0; i < chartElements.length; i++) {
                    const canvas = await html2canvas(chartElements[i], {
                        scale: 3, useCORS: true, backgroundColor: '#ffffff', allowTaint: false,
                        width: chartElements[i].offsetWidth, height: chartElements[i].offsetHeight
                    });
                    const imgData = canvas.toDataURL('image/png');
                    const imgWidth = contentWidth * 0.6;
                    const imgHeight = (canvas.height * imgWidth) / canvas.width;
                    checkAndAddNewPage(imgHeight);
                    pdf.addImage(imgData, 'PNG', margin, currentY, imgWidth, imgHeight);
                    currentY += imgHeight + 10;
                }
            } else {
                const chartContainer = document.querySelector('.main-chart-container');
                if (chartContainer) {
                    const canvas = await html2canvas(chartContainer, {
                        scale: 3, useCORS: true, backgroundColor: '#ffffff', allowTaint: false,
                        width: chartContainer.offsetWidth, height: chartContainer.offsetHeight
                    });
                    const imgData = canvas.toDataURL('image/png');
                    const imgWidth = contentWidth * 0.7;
                    const imgHeight = (canvas.height * imgWidth) / canvas.width;
                    pdf.addImage(imgData, 'PNG', margin, currentY, imgWidth, imgHeight);
                }
            }

            pdf.save(`performance-${ship?.name || shipId}-${new Date().toISOString().split('T')[0]}.pdf`);
        } catch (error) {
            console.error('PDF generation failed:', error);
            alert('Failed to generate PDF. Please try again.');
        }
    };

    if (loading) {
        return <div style={{ padding: '20px', textAlign: 'center' }}>Loading...</div>;
    }

    return (
        <div style={{ padding: '20px' }}>
            <div style={{ marginBottom: '20px', display: 'flex', gap: '10px', flexWrap: 'wrap', alignItems: 'center' }}>
                <Select value={selectedMetric} onChange={(e) => setSelectedMetric(e.target.value)} style={{ minWidth: '200px' }}>
                    <option value="all">All Metrics</option>
                    <option value="SFOC">SFOC (g/kWh)</option>
                    <option value="Turbospeed">Turbocharger speed (rpm)</option>
                    <option value="Pmax">Max.Combustion Pressure (bar)</option>
                    <option value="EngSpeed">Engine Speed (rpm)</option>
                    <option value="ScavAir">Scav.air pressure (kg/cm2)</option>
                    <option value="Exh_T/C_inlet">Exh.Temp T/C inlet (Â°C)</option>
                    <option value="Exh_Cylinder_outlet">Exh.Temp Cylinder outlet (Â°C)</option>
                    <option value="Exh_T/C_outlet">Exh.Temp T/C outlet (Â°C)</option>
                    <option value="FIPI">Fuel injection pump index (mm)</option>
                    <option value="FOC">Fuel oil consumption (kg/h)</option>
                </Select>

                <Select value={timeFilter} onChange={(e) => setTimeFilter(e.target.value)} style={{ minWidth: '180px' }}>
                    <option value="current">Current Month</option>
                    <option value="2months">Last 2 Months</option>
                    <option value="3months">Last 3 Months</option>
                    <option value="6months">Last 6 Months</option>
                </Select>

                <input type="file" accept=".pdf" style={{ display: 'none' }} id="monthly-pdf-upload" onChange={handleFileUpload} />
                <Button onClick={() => document.getElementById('monthly-pdf-upload')?.click()}>Upload Monthly PDF</Button>
                <Button onClick={downloadPDF} variant="secondary">Download PDF</Button>
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
                                    <XAxis dataKey="load" type="number" domain={[0, 110]} ticks={[25, 50, 75, 100, 110]} tickFormatter={(v) => `${v}%`} />
                                    <YAxis width={50} domain={getYAxisDomain(selectedMetric, baseline, allMonthlyReports)}
                                        ticks={getCustomTicks(getYAxisDomain(selectedMetric, baseline, allMonthlyReports))}
                                        tickFormatter={(v) => v.toFixed(1)} />
                                    <Line type="monotone" dataKey="value" stroke="#ca8a04" strokeWidth={2} dot={true} name="Shop Trial Baseline" />
                                    {allMonthlyReports.map((report) => (
                                        <ReferenceDot key={report.month} x={report.load}
                                            y={report[selectedMetric] ?? interpolateBaseline(baseline, report.load, selectedMetric) ?? 0}
                                            shape={<CustomColoredXMarker />} fill={report.color} />
                                    ))}
                                    <Tooltip content={<CustomTooltip />} />
                                    <Legend content={<CustomInlineLegend />} />
                                </LineChart>
                            </ResponsiveContainer>
                        </div>
                    </CardContent>
                </Card>
            )}

            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(300px, 1fr))', gap: '20px', marginTop: '20px' }}>
                <Card>
                    <CardHeader>
                        <CardTitle>Selected Ship</CardTitle>
                        <CardDescription>{fleet.find((s) => s.id === shipId)?.name}</CardDescription>
                    </CardHeader>
                    <CardContent>
                        {allMonthlyReports[0] && selectedMetric !== "all" ? (
                            <div>
                                <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '8px' }}>
                                    <span>Load:</span>
                                    <span style={{ fontWeight: 'bold' }}>{allMonthlyReports[0].load}%</span>
                                </div>
                                <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '8px' }}>
                                    <span>{selectedMetric}:</span>
                                    <span style={{ fontWeight: 'bold' }}>
                                        {(allMonthlyReports[0][selectedMetric] ?? interpolateBaseline(baseline, allMonthlyReports[0].load, selectedMetric))?.toFixed(1)}
                                    </span>
                                </div>
                                <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                                    <span>Historical points:</span>
                                    <span style={{ fontWeight: 'bold' }}>{allMonthlyReports.length}</span>
                                </div>
                            </div>
                        ) : (
                            <div style={{ textAlign: 'center', color: '#999' }}>
                                {selectedMetric === "all" ? "Select a specific metric to view details" : "Awaiting monthly upload..."}
                            </div>
                        )}
                    </CardContent>
                </Card>

                <Card>
                    <CardHeader>
                        <CardTitle>Deviation</CardTitle>
                        <CardDescription>Difference from baseline at same load</CardDescription>
                    </CardHeader>
                    <CardContent>
                        {deviation && selectedMetric !== "all" ? (
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
                            <div style={{ textAlign: 'center', color: '#999' }}>
                                {selectedMetric === "all" ? "Select a specific metric to view deviation" : "Upload a monthly PDF to see deviation"}
                            </div>
                        )}
                    </CardContent>
                </Card>
            </div>
        </div>
    );
}
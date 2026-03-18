// src/components/ShopTrialCharts.jsx (FULL REPLACEMENT - Chart Layout Fixed & Tooltip Unit Fixed)
import React, { useEffect, useState, useMemo } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '../components/ui/Card';
import { LineChart, Line, XAxis, YAxis, CartesianGrid, ResponsiveContainer, Tooltip } from 'recharts';
import '../styles/shop-trial-charts.css'; 

// --- Interpolation Helpers ---
const interpolateBaseline = (baselineData, targetLoad, metric) => {
  if (!baselineData || !baselineData[metric]) return null;

  const series = baselineData[metric];
  if (!series || series.length === 0) return null;

  for (let i = 0; i < series.length - 1; i++) {
    const current = series[i];
    const next = series[i + 1];

    if (current.load <= targetLoad && targetLoad <= next.load) {
      const t = (targetLoad - current.load) / (next.load - current.load);
      return current.value + t * (next.value - current.value);
    }
  }
  return targetLoad <= series[0].load ? series[0].value : series[series.length - 1].value;
};

// Tooltip formatter for Mini Charts (FIXED Turbospeed unit to show x1000)
const CustomTooltipFormatter = (metric) => (value) => {
  const units = {
    "SFOC": " g/kWh", "Pmax": " bar", "Turbospeed": " x1000 rpm", 
    "EngSpeed": " rpm", "ScavAir": " kg/cm²", "Exh_T/C_inlet": "°C",
    "Exh_Cylinder_outlet": "°C", "Exh_T/C_outlet": "°C", "FIPI": " mm", "FOC": " kg/h"
  };
  // Scav Air often needs more precision
  const fixed = metric === 'ScavAir' ? 2 : 1;
  return [`${value.toFixed(fixed)}${units[metric]}`, metric];
};
// --- END Helpers ---

export default function ShopTrialCharts({ selectedShipId, fleet, axiosAepms }) {
  const [dashboardData, setDashboardData]     = useState(null);
  const [chartsLoading, setChartsLoading]     = useState(false);
  
  const ship = fleet.find((s) => s.id === selectedShipId) || {};

  // --- Data Fetching for Single Ship ---
  useEffect(() => {
    if (!selectedShipId || !axiosAepms) {
        setDashboardData(null);
        return;
    }

    const loadDashboardData = async () => {
      setChartsLoading(true);
      try {
        // Fetching single ship KPIs/Baselines using the old endpoint
        const kpiResponse = await axiosAepms.getDashboardKpis(selectedShipId);
        setDashboardData(kpiResponse);
      } catch (error) {
        console.error("Failed to load shop trial charts data:", error);
        setDashboardData(null); // Clear data on error
      } finally {
        setChartsLoading(false);
      }
    };

    loadDashboardData();
  }, [selectedShipId, axiosAepms]);

  // --- Precompute Series ---
  const series = useMemo(() => {
    if (!dashboardData?.baseline_series) return {};
    const apiSeries = {};
    Object.entries(dashboardData.baseline_series).forEach(([metric, points]) => {
      apiSeries[metric] = points.map(p => ({ x: p.load, y: p.value }));
    });
    return apiSeries;
  }, [dashboardData]);

  // --- KPI Derivation (for single ship KIPs) ---
  const kpiLoad = 75;
  const kpi = {
    load: kpiLoad,
    SFOC: interpolateBaseline(dashboardData?.baseline_series, kpiLoad, "SFOC") ?? 0,
    ExhTemp: interpolateBaseline(dashboardData?.baseline_series, kpiLoad, "ExhTemp") ?? 0,
    Pmax: interpolateBaseline(dashboardData?.baseline_series, kpiLoad, "Pmax") ?? 0,
  };

  // Fleet health is still useful context for the user
  const healthyCount = fleet.filter((s) => s.status === "Healthy").length;
  const watchCount = fleet.filter((s) => s.status === "Watch").length;
  const alertCount = fleet.filter((s) => s.status === "Alert").length;

  if (!selectedShipId) {
      return <div className="loading-state" style={{ padding: '40px', textAlign: 'center', color: '#64748b' }}>Please select a ship from the dropdown above to view its shop trial data.</div>;
  }
  
  const chartMetrics = [
    { key: "SFOC", title: "SFOC Baseline", desc: "g/kWh vs Load", domain: [160, 200], stroke: "#2563eb" },
    { key: "Pmax", title: "Pmax", desc: "bar vs Load", domain: [60, 160], stroke: "#16a34a" },
    { key: "Turbospeed", title: "Turbospeed", desc: "x1000 rpm vs Load", domain: [0, 20], stroke: "#ca8a04" },
    { key: "EngSpeed", title: "Engine Speed", desc: "rpm vs Load", domain: ['dataMin - 5', 'dataMax + 5'], stroke: "#9333ea" },
    { key: "ScavAir", title: "Scav Air Pressure", desc: "kg/cm² vs Load", domain: ['dataMin - 5', 'dataMax + 5'], stroke: "#c2410c" },
    { key: "Exh_T/C_inlet", title: "Exh T/C Inlet", desc: "°C vs Load", domain: ['dataMin - 5', 'dataMax + 5'], stroke: "#dc2626" },
    { key: "Exh_Cylinder_outlet", title: "Exh Cylinder Outlet", desc: "°C vs Load", domain: ['dataMin - 5', 'dataMax + 5'], stroke: "#dc2626" },
    { key: "Exh_T/C_outlet", title: "Exh T/C Outlet", desc: "°C vs Load", domain: ['dataMin - 5', 'dataMax + 5'], stroke: "#dc2626" },
    { key: "FIPI", title: "FIPI", desc: "mm vs Load", domain: ['dataMin - 5', 'dataMax + 5'], stroke: "#16a34a" },
    { key: "FOC", title: "FOC", desc: "kg/h vs Load", domain: ['dataMin - 5', 'dataMax + 5'], stroke: "#9333ea" },
  ];


  return (
    <div className="shop-trial-charts-view">
        <h1 className="dashboard-title">Ship Baseline Charts</h1>
        <p className="dashboard-subtitle">Monitoring single-ship shop trial performance curves: {ship.name} (IMO: {ship.imo})</p>
        
        {/* KPIs */}
        <div className="kpi-grid">
            <Card>
            <CardHeader>
                <CardTitle className="kpi-card-title">{ship.name}</CardTitle>
                <CardDescription>IMO {ship.imo} • {ship.class}</CardDescription>
            </CardHeader>
            <CardContent>
                <div className="kpi-label">Last report</div>
                <div className="kpi-value-large">{ship.lastReport ?? "—"}</div>
            </CardContent>
            </Card>

            <Card>
            <CardHeader>
                <CardTitle className="kpi-card-title">SFOC @ {kpiLoad}% load</CardTitle>
                <CardDescription>Baseline</CardDescription>
            </CardHeader>
            <CardContent>
                <div className="kpi-value-xl">
                {Math.round(kpi.SFOC)}
                <span className="kpi-unit"> g/kWh</span>
                </div>
            </CardContent>
            </Card>

            <Card>
            <CardHeader>
                <CardTitle className="kpi-card-title">Fleet Health</CardTitle>
                <CardDescription>Healthy • Watch • Alert</CardDescription>
            </CardHeader>
            <CardContent>
                <div className="health-stats">
                <div className="health-stat">
                    <span className="health-label">Healthy</span>
                    <span className="health-value">{healthyCount}</span>
                </div>
                <div className="health-stat">
                    <span className="health-label">Watch</span>
                    <span className="health-value">{watchCount}</span>
                </div>
                <div className="health-stat">
                    <span className="health-label">Alert</span>
                    <span className="health-value">{alertCount}</span>
                </div>
                </div>
            </CardContent>
            </Card>

            <Card>
            <CardHeader>
                <CardTitle className="kpi-card-title">Pmax @ {kpiLoad}%</CardTitle>
                <CardDescription>Baseline</CardDescription>
            </CardHeader>
            <CardContent>
                <div className="kpi-value-xl">
                {kpi.Pmax.toFixed(1)}
                <span className="kpi-unit"> bar</span>
                </div>
            </CardContent>
            </Card>
        </div>

        {/* Mini charts */}
        <div className="charts-grid">
            {chartsLoading ? (
            <div className="charts-loading">Loading charts...</div>
            ) : (
                chartMetrics.map((chart) => (
                    <Card key={chart.key}>
                        <CardHeader>
                            <CardTitle className="chart-title">{chart.title}</CardTitle>
                            <CardDescription>{chart.desc}</CardDescription>
                        </CardHeader>
                        <CardContent>
                            <div className="chart-container">
                                <ResponsiveContainer width="100%" height="100%">
                                    <LineChart data={series[chart.key] || []} margin={{ left: 8, right: 8, top: 8, bottom: 8 }}>
                                        <CartesianGrid strokeDasharray="3 3" />
                                        <XAxis 
                                            dataKey="x" 
                                            type="number" 
                                            domain={[0, 110]} 
                                            ticks={[25, 50, 75, 100, 110]} 
                                            tickFormatter={(v) => `${v}%`} 
                                        />
                                        <YAxis width={40} domain={chart.domain} />
                                        <Line 
                                            type="monotone" 
                                            dataKey="y" 
                                            stroke={chart.stroke} 
                                            strokeWidth={2} 
                                            dot={true} 
                                        />
                                        <Tooltip
                                            formatter={CustomTooltipFormatter(chart.key)}
                                            labelFormatter={(load) => `Load: ${load}%`}
                                        />
                                    </LineChart>
                                </ResponsiveContainer>
                            </div>
                        </CardContent>
                    </Card>
                ))
            )}
        </div>
    </div>
  );
}
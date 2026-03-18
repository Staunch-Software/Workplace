import React, { useState } from 'react';
import {
  LineChart, Line, BarChart, Bar, XAxis, YAxis, CartesianGrid,
  Tooltip, ResponsiveContainer, ComposedChart, Area
} from 'recharts';
import { 
  Ship, Gauge, Activity, BarChart3, ChevronDown, ChevronUp, 
  Layers, HardHat
} from 'lucide-react';
import "../styles/Voyage.css";
import PerformanceNav from './PerformanceNav';

const Voyage = () => {
  const [selectedVessel, setSelectedVessel] = useState("");
  const [selectedYear, setSelectedYear] = useState("");
  const [isEmissionExpanded, setIsEmissionExpanded] = useState(true);
  const [voyageNo, setVoyageNo] = useState("");
  const [voyageDate, setVoyageDate] = useState("");
  const [loadingCondition, setLoadingCondition] = useState("Laden");
  const [showAnalysis, setShowAnalysis] = useState(false);
  const [isCalculating, setIsCalculating] = useState(false);

  const vessels = ["GCL Yamuna", "GCL Ganga", "GCL Tapi", "GCL Narmada", "GCL Sabarmati"];
  const voyages = ["60", "61", "62", "63"];

  const handleApplyAnalysis = () => {
    setIsCalculating(true);
    setTimeout(() => {
      setShowAnalysis(true);
      setIsCalculating(false);
    }, 1000);
  };

  return (
    <div className="vessel-analytics-wrapper">
      <PerformanceNav />
      
      <div className="voyage-scroll-container">
        {/* HEADER - Sticky but below PerformanceNav */}
        <header className="voyage-header">
          <div className="brand">
            <Ship className="brand-icon" />
            <h1 className="white-text">Vessel Performance <span>Calculator</span></h1>
          </div>
          <div className="vessel-selector-main">
            <label>SELECT VESSEL</label>
            <select value={selectedVessel} onChange={(e) => setSelectedVessel(e.target.value)}>
              <option value="">-- Choose Vessel --</option>
              {vessels.map(v => <option key={v} value={v}>{v.toUpperCase()}</option>)}
            </select>
          </div>
        </header>

        {!selectedVessel ? (
          <div className="empty-state">
            <Ship size={64} opacity={0.2} />
            <p className="white-text">Please select a vessel from the dropdown to start analysis</p>
          </div>
        ) : (
          <main className="content-fade-in">
            
            {/* 1. VESSEL DETAILS */}
            <section className="dashboard-section">
              <div className="section-header">
                <Layers size={18} color="#0891b2" /> <h2 className="white-text">Vessel Details</h2>
              </div>
              <div className="details-grid">
                <div className="details-card">
                  <div className="data-row"><span>Vessel Name</span><strong className="white-text">{selectedVessel}</strong></div>
                  <div className="data-row"><span>IMO Number</span><strong className="white-text">9458211</strong></div>
                  <div className="data-row"><span>Flag</span><strong className="white-text">Singapore</strong></div>
                  <div className="data-row"><span>Vessel Type</span><strong className="white-text">Bulk Carrier</strong></div>
                </div>
                <div className="details-card">
                  <div className="data-row"><span>Length Overall [m]</span><strong className="white-text">229.00</strong></div>
                  <div className="data-row"><span>Beam [m]</span><strong className="white-text">32.26</strong></div>
                  <div className="data-row"><span>Design Draft [m]</span><strong className="white-text">14.50</strong></div>
                  <div className="data-row"><span>Deadweight [MT]</span><strong className="white-text">81,500</strong></div>
                </div>
                <div className="details-card">
                  <div className="data-row"><span>ME Engine Type</span><strong className="white-text">MAN B&W 6S60ME-C</strong></div>
                  <div className="data-row"><span>ME Engine MCR</span><strong className="white-text">9,800 kW</strong></div>
                  <div className="data-row"><span>AE Engine Type</span><strong className="white-text">Yanmar 6EY18AL</strong></div>
                </div>
                <div className="details-card maintenance">
                  <div className="data-row"><span>Drydock Date</span><strong className="cyan-text">15 Nov 2023</strong></div>
                  <div className="data-row"><span>Coating Type</span><strong className="cyan-text">Silyl Acrylate</strong></div>
                  <div className="data-row"><span>Hull Cleaning</span><strong className="cyan-text">22 May 2024</strong></div>
                </div>
              </div>
            </section>

            {/* 2. EMISSION DETAILS */}
            <section className="dashboard-section collapsible-section">
              <div className="section-header" onClick={() => setIsEmissionExpanded(!isEmissionExpanded)}>
                <div style={{display:'flex', alignItems:'center', gap:'10px'}}>
                  <span className="collapsible-tag">COLLAPSIBLE</span>
                  <Activity size={18} color="#0891b2" /> <h2 className="white-text">Emission Details</h2>
                </div>
                <div className="header-controls">
                  <select className="year-select" value={selectedYear} onClick={(e) => e.stopPropagation()} onChange={(e) => setSelectedYear(e.target.value)}>
                      <option value="">SELECT YEAR</option>
                      <option value="2023">2023</option>
                      <option value="2024">2024 (Current)</option>
                  </select>
                  {isEmissionExpanded ? <ChevronUp /> : <ChevronDown />}
                </div>
              </div>

              {isEmissionExpanded && selectedYear && (
                <div className="emission-grid animate-slide-down">
                  <div className="emission-card">
                     <label>CII RATING</label>
                     <div className="value rating-b">B</div>
                     <small>{selectedYear === '2024' ? '(Till date)' : '(Final)'}</small>
                  </div>
                  <div className="emission-card">
                     <label>ETS EUA (MT)</label>
                     <div className="value white-text">14,250.40</div>
                     <small>{selectedYear === '2024' ? '(Est.)' : '(Audited)'}</small>
                  </div>
                  <div className="emission-card">
                     <label>FUEL EU CREDITS (€)</label>
                     <div className="value credit-plus">+ 42,300.00</div>
                     <small>Current Balance</small>
                  </div>
                </div>
              )}
            </section>

            {/* 3. PERFORMANCE ANALYSIS FILTERS */}
            <section className="review-action-bar">
               <div className="review-title">
                 <HardHat size={20} color="#0891b2" />
                 <h3 className="white-text">Vessel Review & Performance Analysis</h3>
               </div>
               
               <div className="filter-row">
                  <div className="input-group">
                    <label>Voyage No</label>
                    <select value={voyageNo} onChange={(e) => setVoyageNo(e.target.value)}>
                      <option value="">Select Voyage</option>
                      {voyages.map(v => <option key={v} value={v}>{v}</option>)}
                    </select>
                  </div>
                  <div className="input-group">
                    <label>Date Range</label>
                    <input type="date" value={voyageDate} onChange={(e) => setVoyageDate(e.target.value)} />
                  </div>
                  <div className="input-group">
                    <label>Loading Condition</label>
                    <div className="toggle-group">
                      <button className={loadingCondition === 'Laden' ? 'active' : ''} onClick={() => setLoadingCondition('Laden')}>LADEN</button>
                      <button className={loadingCondition === 'Ballast' ? 'active' : ''} onClick={() => setLoadingCondition('Ballast')}>BALLAST</button>
                    </div>
                  </div>
                  <button className={`apply-btn ${isCalculating ? 'loading' : ''}`} onClick={handleApplyAnalysis} disabled={!voyageNo}>
                    {isCalculating ? 'CALCULATING...' : 'APPLY ANALYSIS'}
                  </button>
               </div>
            </section>

            {/* 4. ANALYTICS RESULTS */}
            {showAnalysis && (
              <div className="analysis-results animate-fade-in dashboard-section">
                <div className="charts-grid">
                  <div className="chart-container">
                      <h4 className="white-text"><BarChart3 size={14}/> Speed vs Slip Analysis</h4>
                      <ResponsiveContainer width="100%" height={250}>
                          <ComposedChart data={mockChartData}>
                              <CartesianGrid strokeDasharray="3 3" stroke="#334155" vertical={false} />
                              <XAxis dataKey="day" stroke="#94a3b8" fontSize={10} />
                              <YAxis stroke="#94a3b8" fontSize={10} />
                              <Tooltip contentStyle={{backgroundColor: '#1e293b', border: 'none', borderRadius: '8px', color: '#fff'}} />
                              <Area type="monotone" dataKey="slip" fill="#0891b2" fillOpacity={0.1} stroke="#0891b2" />
                              <Line type="monotone" dataKey="speed" stroke="#ffffff" strokeWidth={2} />
                          </ComposedChart>
                      </ResponsiveContainer>
                  </div>
                  <div className="chart-container">
                      <h4 className="white-text"><Gauge size={14}/> Daily Fuel Consumption</h4>
                      <ResponsiveContainer width="100%" height={250}>
                          <BarChart data={mockChartData}>
                              <CartesianGrid strokeDasharray="3 3" stroke="#334155" vertical={false} />
                              <XAxis dataKey="day" stroke="#94a3b8" fontSize={10} />
                              <YAxis stroke="#94a3b8" fontSize={10} />
                              <Tooltip cursor={{fill: '#334155'}} contentStyle={{backgroundColor: '#1e293b', border: 'none', color: '#fff'}} />
                              <Bar dataKey="fuel" fill="#22d3ee" radius={[4, 4, 0, 0]} />
                          </BarChart>
                      </ResponsiveContainer>
                  </div>
                </div>

                <div className="table-container">
                  <table className="analysis-table">
                    <thead>
                      <tr>
                        <th className="white-text">Parameters</th>
                        <th className="white-text">Observed Avg</th>
                        <th className="white-text">Charter Party</th>
                        <th className="white-text">Deviation</th>
                        <th className="white-text">Status</th>
                      </tr>
                    </thead>
                    <tbody>
                      <tr>
                        <td className="white-text">Speed (knots)</td>
                        <td className="white-text">11.4</td>
                        <td className="white-text">11.0</td>
                        <td className="pos">+0.4</td>
                        <td><span className="badge-ok">Optimal</span></td>
                      </tr>
                      <tr>
                        <td className="white-text">ME Consumption (MT/day)</td>
                        <td className="white-text">23.2</td>
                        <td className="white-text">24.5</td>
                        <td className="pos">-1.3</td>
                        <td><span className="badge-ok">Saving</span></td>
                      </tr>
                    </tbody>
                  </table>
                </div>
              </div>
            )}
          </main>
        )}
      </div>
    </div>
  );
};

const mockChartData = [
  { day: 'Day 1', speed: 10.5, fuel: 22.1, slip: 12 },
  { day: 'Day 2', speed: 11.2, fuel: 24.5, slip: 14 },
  { day: 'Day 3', speed: 10.8, fuel: 23.0, slip: 18 },
  { day: 'Day 4', speed: 11.5, fuel: 25.1, slip: 13 },
  { day: 'Day 5', speed: 11.1, fuel: 23.8, slip: 15 },
];

export default Voyage;
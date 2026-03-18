// pages/Fleet.js (FULL REPLACEMENT - Final link to VesselME & VesselAE Performance)
import React, { useMemo, useState, useEffect } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '../components/ui/Card';
import Select from '../components/ui/Select';
import Button from '../components/ui/Button';
import axiosAepms from '../api/axiosAepms';
import { Ship, TrendingUp } from 'lucide-react'; 
import ShopTrialCharts from '../components/ShopTrialCharts'; 
import VesselMonthlyPerformance from '../components/VesselMonthlyPerformance'; 
import VesselAuxiliaryPerformance from '../components/VesselAuxiliaryPerformance'; // <--- CRITICAL NEW IMPORT
import '../styles/fleet.css';

export default function Fleet() {
  const [fleet, setFleet] = useState([]);
  const [loading, setLoading] = useState(true);
  const [shopTrialData, setShopTrialData] = useState([]);
  const [activeView, setActiveView] = useState('ShopTrialOverview'); 
  const [selectedShipId, setSelectedShipId] = useState(() => localStorage.getItem("selectedShipId") || ""); 
  const navigate = useNavigate();
  const location = useLocation();

  // Access Check
  useEffect(() => {
    const checkAccess = async () => {
      try {
        setLoading(false);
      } catch (error) {
        console.error('❌ Access check failed:', error);
        setLoading(false);
      }
    };
    checkAccess();
  }, [navigate]);

  // Load Data
  useEffect(() => {
    if (loading) return;

    axiosAepms.get('/api/fleet')
      .then(res => setFleet(res.data.fleet || res.data.data || []))
      .catch(err => console.error("Fleet API error:", err));

    axiosAepms.get('/api/fleet/shop-trial-summary')
      .then(res => setShopTrialData(res.data.summary || []))
      .catch(err => console.error("Shop Trial Summary API error:", err));
  }, [loading]);

  // Handle Navigation State from Dashboard
  useEffect(() => {
    if (location.state?.initialView) {
      setActiveView(location.state.initialView);
      navigate(location.pathname, { replace: true, state: {} });
    }
  }, [location.state, navigate, location.pathname]);


  // Updated handleSelectShip to be robust to both event objects and plain IDs
  const handleSelectShip = (valueOrEvent) => {
    const id = valueOrEvent?.target?.value !== undefined 
      ? valueOrEvent.target.value // From Select change event
      : valueOrEvent; // From Button/Card click with ID
      
    setSelectedShipId(id); 
    localStorage.setItem("selectedShipId", id);
    window.dispatchEvent(new CustomEvent("ship:selected", { detail: { id } }));
  };

  // VIEW: Shop Trial Overview
  const renderShopTrialOverview = () => {
    const hasData = shopTrialData.length > 0;
    const isShipSelected = selectedShipId !== "" && fleet.some(d => d.id === selectedShipId);

    return (
      <div className="shop-trial-overview">
        <div style={{ display: 'flex', gap: '16px', alignItems: 'center', marginBottom: '20px', flexWrap: 'wrap' }}>
            <h1 className="fleet-title" style={{marginBottom: 0}}>Shop Trial Overview</h1>
            <Select
                value={selectedShipId}
                onChange={handleSelectShip} 
                style={{ minWidth: '250px' }}
            >
                <option value="">Select a Ship for Detailed Charts</option>
                {fleet.filter(s => s.id != null).map((s) => (
                <option key={s.id} value={s.id}>
                    {s.name}
                </option>
                ))}
            </Select>
        </div>


        {isShipSelected ? (
            <ShopTrialCharts 
                selectedShipId={selectedShipId} 
                fleet={fleet} 
                apiService={axiosAepms}
            />
        ) : (
          <>
            <p className="fleet-subtitle">Aggregate Baseline metrics for all ships (select a ship above for charts)</p>
            <Card>
                <CardContent className="card-content-enhanced" style={{ overflowX: 'auto' }}>
                    {!hasData && !loading ? (
                    <p style={{ textAlign: 'center', color: '#64748b', padding: '20px' }}>No Shop Trial data available in the system yet.</p>
                    ) : (
                    <table className="summary-table-enhanced" style={{ minWidth: '800px' }}>
                        <thead>
                            <tr>
                                <th>Vessel</th>
                                <th>IMO</th>
                                <th style={{ textAlign: 'right' }}>ME Configured</th>
                                <th style={{ textAlign: 'right' }}>Base SFOC (g/kWh) @ 75%</th>
                                <th style={{ textAlign: 'right' }}>Base Pmax (bar) @ 75%</th>
                                <th style={{ textAlign: 'right' }}>Base Exh Temp (°C) @ 75%</th>
                                <th>Action</th>
                            </tr>
                        </thead>
                        <tbody>
                            {shopTrialData.map(ship => (
                                <tr key={ship.id}>
                                    <td>{ship.name}</td>
                                    <td>{ship.imo}</td>
                                    <td style={{ textAlign: 'right', color: ship.me_configured ? '#16a34a' : '#dc2626', fontWeight: '600' }}>{ship.me_configured ? 'Yes' : 'No'}</td>
                                    <td style={{ textAlign: 'right' }}>{ship.baseSFOC.toFixed(1)}</td>
                                    <td style={{ textAlign: 'right' }}>{ship.basePmax.toFixed(1)}</td>
                                    <td style={{ textAlign: 'right' }}>{ship.baseExhTemp.toFixed(1)}</td>
                                    <td>
                                        <Button 
                                            size="sm" 
                                            variant="link" 
                                            onClick={(e) => {
                                                e.stopPropagation();
                                                handleSelectShip(ship.id);
                                            }}
                                        >
                                            View Charts
                                        </Button>
                                    </td>
                                </tr>
                            ))}
                        </tbody>
                    </table>
                    )}
                </CardContent>
            </Card>
          </>
        )}
      </div>
    );
  };

  // NEW VIEW: Performance Status ME (Uses the ME component)
  const renderPerformanceStatusME = () => (
    <div className="performance-status-me-view">
        <VesselMonthlyPerformance 
            fleet={fleet} 
            apiService={axiosAepms} 
            analysisMode="mainEngine" 
        />
    </div>
  );

  // NEW VIEW: Performance Status AE (Uses the NEW AE component)
  const renderPerformanceStatusAE = () => (
    <div className="performance-status-ae-view">
        <VesselAuxiliaryPerformance 
            fleet={fleet} 
            apiService={axiosAepms} 
            analysisMode="auxiliaryEngine" 
        />
    </div>
  );

  if (loading) {
    return (
      <div className="fleet-hub-container" style={{ padding: '32px' }}>
        <div className="loading-state">Loading fleet data...</div>
      </div>
    );
  }

  return (
    <div className="fleet-hub-container">
      <aside className="fleet-hub-sidebar">
        <div className="sidebar-header">
          <h2 className="sidebar-title">Fleet Analytics</h2>
        </div>

        <nav className="sidebar-nav">
          <div
            className={`sidebar-item ${activeView === 'ShopTrialOverview' ? 'active' : ''}`}
            onClick={() => setActiveView('ShopTrialOverview')}
          >
            <Ship size={20} />
            <span>Shop Trial Overview</span>
          </div>
          <div
            className={`sidebar-item ${activeView === 'PerformanceStatusME' ? 'active' : ''}`}
            onClick={() => setActiveView('PerformanceStatusME')}
          >
            <TrendingUp size={20} />
            <span>Performance Status ME</span>
          </div>
          <div
            className={`sidebar-item ${activeView === 'PerformanceStatusAE' ? 'active' : ''}`}
            onClick={() => setActiveView('PerformanceStatusAE')}
          >
            <TrendingUp size={20} />
            <span>Performance Status AE</span>
          </div>
        </nav>
      </aside>

      <main className="fleet-hub-content">
        {activeView === 'ShopTrialOverview' && renderShopTrialOverview()}
        {activeView === 'PerformanceStatusME' && renderPerformanceStatusME()}
        {activeView === 'PerformanceStatusAE' && renderPerformanceStatusAE()}
      </main>
    </div>
  );
}
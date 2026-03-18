import React from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import Button from '../components/ui/Button'; 
// 1. ADDED 'Navigation' to the imports below
import { Ship, Wrench, Anchor, Droplet, Navigation } from 'lucide-react';

export default function PerformanceNav() {
    const navigate = useNavigate();
    const location = useLocation();

    // Determine which page is active based on the URL
    const isDashboard = location.pathname === '/dashboard';
    
    // 2. ADDED this line to fix the "isVoyage is not defined" error
    // Note: Use '/Voyage' to match your navigate('/Voyage') call below
    const isVoyage = location.pathname === '/Voyage'; 

    const isMePerformance = location.pathname === '/me-performance';
    const isAePerformance = location.pathname === '/ae-performance';
    const isLuboil = location.pathname === '/luboil-analysis';

    const handleConfigClick = () => {
        navigate('/dashboard');
    }

    const buttonStyle = {
        flexGrow: 0, 
        minWidth: '180px', 
        maxWidth: '250px', 
        padding: '10px 15px', 
        fontSize: '0.90rem' 
    };

    return (
        <div 
            className="kpi-grid-new performance-nav-grid" 
            style={{
                display: 'flex', 
                justifyContent: 'center', 
                flexWrap: 'wrap', 
                marginBottom: '24px', 
                gap: '12px'
            }}
        >
            {/* 1. Configuration (Dashboard) */}
            <Button 
                className={`nav-pill-btn ${isDashboard ? 'active-nav-btn' : ''}`}
                onClick={handleConfigClick}
                style={buttonStyle}
            >
                <Ship size={18} style={{marginRight: '8px'}} />
                Configuration
            </Button>

            {/* 3. ME Performance */}
            <Button 
                className={`nav-pill-btn ${isMePerformance ? 'active-nav-btn' : ''}`}
                onClick={() => navigate('/me-performance')}
                style={buttonStyle}
            >
                <Anchor size={18} style={{marginRight: '8px'}} />
                ME Performance
            </Button>

            {/* 4. AE Performance */}
            <Button 
                className={`nav-pill-btn ${isAePerformance ? 'active-nav-btn' : ''}`}
                onClick={() => navigate('/ae-performance')}
                style={buttonStyle}
            >
                <Wrench size={18} style={{marginRight: '8px'}} />
                AE Performance
            </Button>

            {/* 5. Lube Oil Analysis */}
            <Button 
                className={`nav-pill-btn ${isLuboil ? 'active-nav-btn' : ''}`}
                onClick={() => navigate('/luboil-analysis')}
                style={buttonStyle}
            >
                <Droplet size={18} style={{marginRight: '8px'}} />
                Lube Oil Analysis
            </Button>

            {/* 2. Voyage Performance - THIS NOW WORKS */}
            <Button 
                className={`nav-pill-btn ${isVoyage ? 'active-nav-btn' : ''}`}
                onClick={() => navigate('/Voyage')}
                style={buttonStyle}
            >
                <Navigation size={18} style={{marginRight: '8px'}} />
                Voyage Performance
            </Button>
        </div>
    );
}
import React, { useEffect, useState, useMemo, useRef } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import Button from '../components/ui/Button';
import axiosAepms from '../api/axiosAepms';
import {
    Ship, Cpu, Wrench, Clock, ChevronRight, TrendingUp, UploadCloud,
    FileText, X, CheckCircle, RefreshCw, Eye, Settings, AlertCircle
} from 'lucide-react';
import '../styles/dashboard.css';
import '../styles/MEPerformanceOverview.css';
import PerformanceNav from './PerformanceNav';
const formatVesselName = (name) => {
    if (!name) return "";
    return name.replace(/^(?:MV|M\.V\.|M\.V|M\/V)\s*/i, "").trim();
};
const AeVesselRow = ({ vessel, onViewPdf, onViewData }) => {
    const [generators, setGenerators] = useState([]);
    const [loading, setLoading] = useState(true);

    useEffect(() => {
        let isMounted = true;
        const fetchGens = async () => {
            try {
                const data = await axiosAepms.getGeneratorsList(vessel.imo || vessel.imo_number);
                if (isMounted) setGenerators(data || []);
            } catch (error) {
                console.error(`Error fetching gens for ${vessel.name}`, error);
            } finally {
                if (isMounted) setLoading(false);
            }
        };
        fetchGens();
        return () => { isMounted = false; };
    }, [vessel]);

    if (loading) return <tr><td colSpan="4" className="p-4 text-center text-xs text-slate-400">Loading generators...</td></tr>;
    if (generators.length === 0) return null;

    return (
        <tr className="table-row-AE-config">
            <td className="ship-name-td">
                <div className="vessel-name-div">
                    <div className="vessel-icon">
                        <Ship size={17} />
                    </div>
                    {formatVesselName(vessel.name)}
                </div>
            </td>
            <td className="vessel-imo">
                {vessel.imo || vessel.imo_number}
            </td>
            <td className="py-2 pr-6" colSpan="2">
                <div className="flex flex-col justify-evenly">
                    {generators.map((gen) => (
                        <div key={gen.generator_id} className="ae-generator">
                            <div>
                                <span className="generator-span">
                                    {gen.designation}
                                </span>
                                <span className="report-span">
                                    {gen.engine_model}
                                </span>
                            </div>



                            <div className="flex-center-gap">
                                <button onClick={() => onViewData(gen)} className="view-button" title="View Data">
                                    <Eye size={15} strokeWidth={2.0} />
                                </button>

                                <button onClick={() => onViewPdf(gen)} className="view-button" title="View PDF">
                                    <FileText size={15} strokeWidth={2.0} />
                                </button>
                            </div>
                        </div>
                    ))}
                </div>
            </td>
        </tr>
    );
};

const ShopTrialModal = ({ isOpen, onClose, data, type }) => {
    if (!isOpen || !data) return null;

    const meParameters = [
        { label: "Engine Speed", key: "engine_speed", unit: "rpm" },
        { label: "Engine Output", key: "engine_output", unit: "kW" },
        { label: "Max Comb. Pressure", key: "pmax", unit: "bar" },
        { label: "Comp. Pressure", key: "pcomp", unit: "bar" },
        { label: "Mean Eff. Pressure", key: "pmean", unit: "bar" },
        { label: "Scav Air Pressure", key: "scav_air_press", unit: "kg/cm²" },
        { label: "Scav Air Temp", key: "scav_air_temp", unit: "°C" },
        { label: "Exh Temp (Cyl Avg)", key: "exh_temp_cyl_out", unit: "°C" },
        { label: "Exh Temp (TC In)", key: "exh_temp_tc_in", unit: "°C" },
        { label: "Exh Temp (TC Out)", key: "exh_temp_tc_out", unit: "°C" },
        { label: "Turbo Speed", key: "turbo_speed", unit: "rpm" },
        { label: "Fuel Index", key: "fipi", unit: "mm" },
        { label: "Fuel Consumption", key: "foc_kg_h", unit: "kg/h" },
        { label: "SFOC (ISO)", key: "sfoc_iso", unit: "g/kWh" },
    ];

    const aeParameters = [
        // { label: "Engine Speed", key: "engine_speed", unit: "rpm" },
        { label: "Load (Power)", key: "engine_output", unit: "kW" },
        { label: "Max Comb. Pressure", key: "pmax", unit: "bar" },
        // { label: "Comp. Pressure", key: "pcomp", unit: "bar" },
        { label: "Scav Air Pressure", key: "scav_air_press", unit: "bar" },
        { label: "Exh Temp (Cyl Avg)", key: "exh_temp_cyl_out", unit: "°C" },
        { label: "Exh Temp (TC In)", key: "exh_temp_tc_in", unit: "°C" },
        { label: "Exh Temp (TC Out)", key: "exh_temp_tc_out", unit: "°C" },
        // { label: "Turbo Speed", key: "turbo_speed", unit: "rpm" },
        { label: "Fuel Rack / Index", key: "fipi", unit: "mm" },
        // { label: "Fuel Consumption", key: "foc_kg_h", unit: "kg/h" },
        { label: "SFOC", key: "sfoc_iso", unit: "g/kWh" },
    ];

    const parameters = type === 'AE' ? aeParameters : meParameters;
    const sortedColumns = data.data ? [...data.data].sort((a, b) => a.load_percentage - b.load_percentage) : [];

    return (
        <div className='modal-overlay'>
            <div className='modal-container'>
                <div className='modal-header'>
                    <div>
                        <h3 className="title-heading">
                            {type === 'AE' ? <Wrench size={28} className="text-purple-600" /> : <Ship size={28} className="text-blue-700" />}
                            {formatVesselName(data.vessel_name)} — {data.engine_no || "Engine"} Data
                        </h3>
                        <div className="flex-gap-6">
                            {data.test_date && (
                                <span className="flex-center-box">
                                    <span className="text-label">Source:</span>
                                    <span className="text-value">
                                        {data.test_date
                                            ? new Date(data.test_date).toLocaleDateString("en-GB", {
                                                day: "2-digit",
                                                month: "short",
                                                year: "numeric",
                                            })
                                            : "-"}
                                    </span>
                                </span>
                            )}
                        </div>
                    </div>
                    <button onClick={onClose} className="X-icon-btn">
                        <X size={24} />
                    </button>
                </div>

                <div className='flex-container'>
                    {sortedColumns.length === 0 ? (
                        <div className="empty-state">
                            <AlertCircle size={56} className="text-slate-300" />
                            <p className="no-data-text">No data points available for this report.</p>
                        </div>
                    ) : (
                        <table className="vessel-table">
                            <thead className='vessel-header'>
                                <tr>
                                    <th className="th-parameter">Parameter</th>
                                    <th className="th-unit">Unit</th>
                                    {sortedColumns.map((col, idx) => (
                                        <th key={idx} className="th-cell">
                                            <span className="badge-dark">{col.load_percentage}%</span>
                                        </th>
                                    ))}
                                </tr>
                            </thead>
                            <tbody className="divide-y divide-slate-200">
                                {parameters.map((param, rowIdx) => (
                                    <tr key={rowIdx} className={rowIdx % 2 === 0 ? "bg-white-hover-blue" : "bg-slate-hover-blue"}>
                                        <td className="table-cell">{param.label}</td>

                                        <td className="table-cell-mono">{param.unit}</td>

                                        {sortedColumns.map((col, colIdx) => (
                                            <td key={colIdx} className="table-cell-mono">
                                                {col[param.key] !== null && col[param.key] !== undefined
                                                    ? col[param.key].toLocaleString('en-US', { maximumFractionDigits: 2 })
                                                    : <span className="text-slate-300 font-normal">—</span>}
                                            </td>
                                        ))}
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    )}
                </div>

                <div className='modal-footer'>
                    <button onClick={onClose} className="btn-primary">
                        Close
                    </button>
                </div>
            </div>
        </div>
    );
};

export default function Dashboard() {
    const navigate = useNavigate();
    const location = useLocation();
    const [activeView, setActiveView] = useState('configuration');

    const [showMeConfigDetails, setShowMeConfigDetails] = useState(false);
    const fileInputRef = useRef(null);
    const [selectedUploadImo, setSelectedUploadImo] = useState("");
    const [isUploading, setIsUploading] = useState(false);

    const [showAeConfigDetails, setShowAeConfigDetails] = useState(false);
    const [selectedAeUploadShip, setSelectedAeUploadShip] = useState("");
    const [selectedAeUploadGen, setSelectedAeUploadGen] = useState("");
    const [availableGenerators, setAvailableGenerators] = useState([]);
    const aeFileInputRef = useRef(null);

    const [isModalOpen, setIsModalOpen] = useState(false);
    const [modalData, setModalData] = useState(null);
    const [modalType, setModalType] = useState('ME');

    const [loading, setLoading] = useState(true);
    const [configSummary, setConfigSummary] = useState(null);
    const [fleet, setFleet] = useState([]);

    useEffect(() => {
        const loadData = async () => {
            try {
                // 1. Fetch Fleet and Sort Alphabetically
                const fleetResponse = await axiosAepms.getFleet();
                const sortedFleet = (fleetResponse.fleet || []).sort((a, b) => 
                    formatVesselName(a.name).localeCompare(formatVesselName(b.name))
                );
                setFleet(sortedFleet);

                // 2. Fetch Config Summary and Sort Unconfigured lists
                const configResponse = await axiosAepms.getFleetConfigurationSummary();
                if (configResponse.me_unconfigured_list) {
                    configResponse.me_unconfigured_list.sort((a, b) => 
                        formatVesselName(a.name).localeCompare(formatVesselName(b.name))
                    );
                }
                if (configResponse.ae_unconfigured_list) {
                    configResponse.ae_unconfigured_list.sort((a, b) => 
                        formatVesselName(a.name).localeCompare(formatVesselName(b.name))
                    );
                }
                setConfigSummary(configResponse);
            } catch (error) {
                console.error("Failed to load dashboard data:", error);
            } finally {
                setLoading(false);
            }
        };
        loadData();
    }, []);

    const fleetShips = configSummary?.total_ships ?? fleet.length;
    const meConfiguredCount = configSummary?.me_configured_ships ?? 0;
    const aeConfiguredCount = configSummary?.ae_configured_ships ?? 0;
    const meUnconfiguredList = configSummary?.me_unconfigured_list ?? [];
    const aeUnconfiguredList = configSummary?.ae_unconfigured_list ?? [];

    const meConfiguredList = useMemo(() => {
        if (!fleet.length) return [];
        const unconfiguredImos = meUnconfiguredList.map(s => String(s.imo));
        const filtered = fleet.filter(s => !unconfiguredImos.includes(String(s.imo || s.imo_number)));
        return filtered.sort((a, b) => formatVesselName(a.name).localeCompare(formatVesselName(b.name)));
    }, [fleet, meUnconfiguredList]);

    useEffect(() => {
        if (selectedAeUploadShip) {
            const fetchGens = async () => {
                try {
                    const gens = await axiosAepms.getGeneratorsList(selectedAeUploadShip);
                    setAvailableGenerators(gens);
                    setSelectedAeUploadGen("");
                } catch (err) {
                    console.error("Failed to fetch generators", err);
                    setAvailableGenerators([]);
                }
            };
            fetchGens();
        } else {
            setAvailableGenerators([]);
        }
    }, [selectedAeUploadShip]);

    const handleKpiCardClick = (type) => {
        if (type === 'ME_CONFIG') {
            setShowMeConfigDetails(!showMeConfigDetails);
            setShowAeConfigDetails(false);
            if (!showMeConfigDetails) {
                setTimeout(() => window.scrollTo({ top: document.body.scrollHeight, behavior: 'smooth' }), 100);
            }
        } else if (type === 'AE_CONFIG') {
            setShowAeConfigDetails(!showAeConfigDetails);
            setShowMeConfigDetails(false);
            if (!showAeConfigDetails) {
                setTimeout(() => window.scrollTo({ top: document.body.scrollHeight, behavior: 'smooth' }), 100);
            }
        }
    };

    const handleUploadClick = () => {
        if (!selectedUploadImo) { alert("Please select a vessel to upload data for."); return; }
        if (fileInputRef.current) { fileInputRef.current.value = ""; fileInputRef.current.click(); }
    };

    const handleFileChange = async (event) => {
        const file = event.target.files?.[0];
        if (!file || !selectedUploadImo) return;
        setIsUploading(true);
        try {
            const formData = new FormData();
            formData.append('file', file);
            formData.append('imo_number', selectedUploadImo);
            await axiosAepms.uploadShopTrialReport(formData);
            alert(`✅ Shop Trial PDF uploaded successfully!`);
            window.location.reload();
        } catch (error) {
            alert("❌ Upload failed: " + (error.message || "Unknown error"));
        } finally { setIsUploading(false); }
    };

    const handleViewShopTrialPDF = async (vessel) => {
        try {
            const imo = vessel.imo || vessel.imo_number;
            const response = await axiosAepms.getShopTrialUrl(imo);
            if (response && response.url) window.open(response.url, '_blank');
            else throw new Error("PDF URL not found.");
        } catch (error) {
            alert(`⚠️ PDF Report Missing.\nPlease upload the Shop Trial PDF for ${vessel.name}.`);
        }
    };

    const handleViewShopTrialData = async (vessel) => {
        try {
            const imo = vessel.imo || vessel.imo_number;
            const response = await axiosAepms.getShopTrialDataValues(imo);
            if (response && response.data && response.data.length > 0) {
                setModalType('ME');
                setModalData(response);
                setIsModalOpen(true);
            } else {
                alert("No data points found in Shop Trial for this vessel.");
            }
        } catch (error) { alert("Failed to load Shop Trial data values."); }
    };

    const handleAeUploadClick = () => {
        if (!selectedAeUploadGen) { alert("Please select a specific Generator (e.g., AE1) to upload data for."); return; }
        if (aeFileInputRef.current) { aeFileInputRef.current.value = ""; aeFileInputRef.current.click(); }
    };

    const handleAeFileChange = async (event) => {
        const file = event.target.files?.[0];
        if (!file || !selectedAeUploadGen) return;
        setIsUploading(true);
        try {
            const formData = new FormData();
            formData.append('file', file);
            formData.append('generator_id', selectedAeUploadGen);
            await axiosAepms.uploadAEShopTrialReport(formData);
            alert(`✅ Auxiliary Engine Shop Trial PDF uploaded successfully!`);
            window.location.reload();
        } catch (error) { alert("❌ Upload failed: " + (error.message || "Unknown error")); }
        finally { setIsUploading(false); }
    };

    const handleViewAEShopTrialPDF = async (gen) => {
        try {
            const response = await axiosAepms.getAEShopTrialUrl(gen.generator_id);
            if (response && response.url) window.open(response.url, '_blank');
        } catch (error) {
            alert(`⚠️ PDF Report Missing for ${gen.designation}.`);
        }
    };

    const handleViewAEShopTrialData = async (gen) => {
        try {
            const response = await axiosAepms.getAEShopTrialDataValues(gen.generator_id);
            if (response && response.data && response.data.length > 0) {
                setModalType('AE');
                setModalData(response);
                setIsModalOpen(true);
            } else {
                alert(`No baseline data found for ${gen.designation}. Please upload shop trial.`);
            }
        } catch (error) {
            alert(`Failed to load data for ${gen.designation}: ` + error.message);
        }
    };

    const renderKpiCard = (icon, title, value, subtext, index, type = null) => (
        <div className={`dashboard-kpi-card-enhanced ${type ? 'cursor-pointer hover:scale-[1.02] transition-transform ring-offset-2 hover:ring-2 ring-blue-100' : ''}`} style={{ animationDelay: `${index * 0.1}s` }} onClick={() => type && handleKpiCardClick(type)}>
            <div className="kpi-icon-circle">{icon}</div>
            <div className="kpi-content-new"><p className="kpi-title-enhanced">{title}</p><h2 className="kpi-value-enhanced">{value}</h2><p className="kpi-subtext-enhanced">{subtext}</p></div>
            <div className="kpi-trend-indicator">{type ? <ChevronRight size={16} /> : <TrendingUp size={16} />}</div>
        </div>
    );

    const renderUnconfiguredVesselTable = (list, engineType, index) => (
        <div className="config-table-card" style={{ animationDelay: `${0.4 + index * 0.1}s` }}>
            <div className="table-card-header">
                <div className="table-header-content"><h3 className="table-title-enhanced">{engineType} Unconfigured Vessels</h3><span className="vessel-count-badge">{list.length}</span></div>
                <p className="table-subtitle">Ships requiring {engineType} shop trial data for analysis</p>
            </div>
            <div className="table-card-body">
                <div className="vessel-table-wrapper">
                    <table className="vessel-table-enhanced">
                        <thead><tr><th>Vessel Name</th><th>IMO Number</th><th>Status</th></tr></thead>
                        <tbody>
                            {list.length === 0 ? (<tr><td colSpan="3" className="all-configured-cell"><div className="success-message">All vessels configured!</div></td></tr>) : (
                                list.map((ship) => (<tr key={ship.id}><td className="vessel-name-cell">{formatVesselName(ship.name)}</td><td className="imo-cell">{ship.imo}</td><td><span className="status-badge status-error">Not Configured</span></td></tr>))
                            )}
                        </tbody>
                    </table>
                </div>
            </div>
        </div>
    );

    const renderMeConfigurationDetails = () => (
        <div className="enhanced-card card-animated">
            <div className="card-header-me">
    <div className="card-title-wrapper">
  <h3 className="card-title-enhanced flex-items-xl">
    <Cpu className="text-blue-600" size={24} />
    Main Engine Configuration Details
  </h3>
  <p className="card-description-enhanced text-slate-600">
    Manage Shop Trial data and view configured vessel reports
  </p>
</div>

    <div className="header-controls-me">
        <div className="select-wrapper-me">
            <select
                className="select-input-me"
                value={selectedUploadImo}
                onChange={(e) => setSelectedUploadImo(e.target.value)}
                onMouseDown={(e) => {
                    e.currentTarget.parentElement.toggleAttribute("data-open");
                }}
                onBlur={(e) => {
                    e.currentTarget.parentElement.removeAttribute("data-open");
                }}
            >
                <option value="" disabled>
                    Select Vessel to Upload PDF...
                </option>
                {fleet.map(ship => {
                    const isConfigured = !meUnconfiguredList.find(u => u.id === ship.id);
                    return (
                        <option key={ship.id} value={ship.imo || ship.imo_number}>
                            {formatVesselName(ship.name)} {isConfigured ? "(Update PDF)" : "(New Setup)"}
                        </option>
                    );
                })}
            </select>
        </div>

        <button onClick={handleUploadClick} disabled={isUploading || !selectedUploadImo} className="btn-upload-me">
            {isUploading ? <RefreshCw className="animate-spin" size={18} /> : <UploadCloud size={18} />}
            <span>{isUploading ? 'Uploading...' : 'Upload Shop Trial'}</span>
        </button>
        <button onClick={() => setShowMeConfigDetails(false)} className="close-btn-me"><X size={22} /></button>
    </div>
</div>
            <div className="card-content-enhanced p-6">
                <div className="vessel-table-wrapper">
                    <table className="vessel-table-enhanced">
                        <thead><tr><th className="w-1/3">Vessel Name</th><th className="w-1/4">IMO Number</th><th className="w-1/4">Configuration Status</th><th className="w-1/6 text-center">Actions</th></tr></thead>
                        <tbody>
                            {meConfiguredList.length === 0 ? (<tr><td colSpan="4" className="text-center py-12 text-slate-500">No vessels configured yet.</td></tr>) : (
                                meConfiguredList.map((vessel) => (
                                    <tr key={vessel.id} className="groupVessel">
                                        <td className="custom-cell"><div className="vessel-icon"><Ship size={17} /></div>{formatVesselName(vessel.name)}</td>
                                        <td className="vessel-imo">{vessel.imo || vessel.imo_number}</td>
                                        <td><span className="custom-badge"><CheckCircle size={13} /> Configured</span></td>
                                        <td className="text-right">
                                            <div className="flex items-center justify-evenly gap-2">
                                                <button onClick={() => handleViewShopTrialData(vessel)} className="view-button" title="View Shop Trial Data">
                                                    <Eye size={18} strokeWidth={2.0} />
                                                </button>
                                                <button onClick={() => handleViewShopTrialPDF(vessel)} className="view-button" title="View Shop Trial PDF">
                                                    <FileText size={18} strokeWidth={2.0

                                                    } />
                                                </button>
                                            </div>
                                        </td>
                                    </tr>
                                ))
                            )}
                        </tbody>
                    </table>
                </div>
            </div>
        </div>
    );

    const renderAeConfigurationDetails = () => (
    <div className="enhanced-card">
        <div className="card-header-ae">
            {/* TITLE BLOCK */}
            <div>
                <h3 className="card-title-enhanced">
                    <Wrench className="text-purple-600" size={24} />
                    Auxiliary Engine Configuration
                </h3>
                <p className="card-description-enhanced">
                    Manage AE Shop Trial PDFs for each generator
                </p>
            </div>

            {/* CONTROLS CONTAINER */}
            <div className="header-controls-ae">

                {/* ROW 1: VESSEL SELECT + GENERATOR SELECT + BUTTONS (All devices) */}
                <div className="ae-controls-row-1">
                    {/* VESSEL SELECT */}
                    <div className="ae-select-wrapper-vessel">
                        <select
                            className="select-vessel-ae"
                            value={selectedAeUploadShip}
                            onChange={(e) => setSelectedAeUploadShip(e.target.value)}
                            onMouseDown={(e) => e.currentTarget.parentElement.toggleAttribute("data-open")}
                            onBlur={(e) => e.currentTarget.parentElement.removeAttribute("data-open")}
                        >
                            <option value="" disabled>
                                Select Vessel...
                            </option>
                            {fleet.map((ship) => (
                                <option key={ship.id} value={ship.imo || ship.imo_number}>
                                    {formatVesselName(ship.name)}
                                </option>
                            ))}
                        </select>
                    </div>

                    {/* GENERATOR SELECT – Desktop shows here, Mobile hides via CSS */}
                    <div className="ae-select-wrapper-gen">
                        <select
                            className="select-gen-ae"
                            value={selectedAeUploadGen}
                            onChange={(e) => setSelectedAeUploadGen(e.target.value)}
                            disabled={!selectedAeUploadShip}
                            onMouseDown={(e) => e.currentTarget.parentElement.toggleAttribute("data-open")}
                            onBlur={(e) => e.currentTarget.parentElement.removeAttribute("data-open")}
                        >
                            <option value="" disabled>
                                Select Generator...
                            </option>
                            {availableGenerators.map((gen) => (
                                <option key={gen.generator_id} value={gen.generator_id}>
                                    {gen.designation} ({gen.engine_model})
                                </option>
                            ))}
                        </select>
                    </div>

                    {/* UPLOAD BUTTON */}
                    <button
                        className="btn-upload-ae"
                        onClick={handleAeUploadClick}
                        disabled={isUploading || !selectedAeUploadGen}
                        title="Upload Shop Trial PDF"
                    >
                        {isUploading ? (
                            <RefreshCw className="animate-spin" size={18} />
                        ) : (
                            <UploadCloud size={18} />
                        )}
                        <span>Upload</span>
                    </button>

                    {/* CLOSE BUTTON */}
                    <button
                        className="close-btn-ae"
                        onClick={() => setShowAeConfigDetails(false)}
                        title="Close AE Configuration"
                    >
                        <X size={22} />
                    </button>
                </div>

                {/* ROW 2: GENERATOR SELECT (Mobile only - shown via CSS) */}
                <div className="ae-controls-row-2">
                    <div className="ae-select-wrapper-gen">
                        <select
                            className="select-gen-ae"
                            value={selectedAeUploadGen}
                            onChange={(e) => setSelectedAeUploadGen(e.target.value)}
                            disabled={!selectedAeUploadShip}
                            onMouseDown={(e) => e.currentTarget.parentElement.toggleAttribute("data-open")}
                            onBlur={(e) => e.currentTarget.parentElement.removeAttribute("data-open")}
                        >
                            <option value="" disabled>
                                Select Generator...
                            </option>
                            {availableGenerators.map((gen) => (
                                <option key={gen.generator_id} value={gen.generator_id}>
                                    {gen.designation} ({gen.engine_model})
                                </option>
                            ))}
                        </select>
                    </div>
                </div>

            </div>
        </div>

        {/* TABLE CONTENT */}
        <div className="card-content-enhanced">
            <div className="vessel-table-wrapper">
                <table className="vessel-table-enhanced">
                    <thead>
                        <tr>
                            <th>Vessel Name</th>
                            <th>IMO Number</th>
                            <th className="text-center">Generators & Reports</th>
                        </tr>
                    </thead>
                    <tbody>
                        {fleet.length === 0 ? (
                            <tr>
                                <td colSpan="3" className="empty-state">
                                    No vessels found in fleet.
                                </td>
                            </tr>
                        ) : (
                            fleet.map((vessel) => (
                                <AeVesselRow
                                    key={vessel.id || vessel.imo}
                                    vessel={vessel}
                                    onViewData={handleViewAEShopTrialData}
                                    onViewPdf={handleViewAEShopTrialPDF}
                                />
                            ))
                        )}
                    </tbody>
                </table>
            </div>
        </div>
    </div>
);

    if (loading) return (<div className="dashboard-container"><div className="loading-state-enhanced"><div className="loading-spinner"></div><p>Loading dashboard data...</p></div></div>);

    return (
    <>
        {/* Modal FIRST - outside all containers */}
        <ShopTrialModal isOpen={isModalOpen} onClose={() => setIsModalOpen(false)} data={modalData} type={modalType} />
        
        {/* Now the padded content wrapper */}
        <div style={{ }}>
            <div className="dashboard-container-enhanced">
                <input type="file" ref={fileInputRef} style={{ display: 'none' }} accept=".pdf" onChange={handleFileChange} />
                <input type="file" ref={aeFileInputRef} style={{ display: 'none' }} accept=".pdf" onChange={handleAeFileChange} />

                <PerformanceNav activeView={activeView} setActiveView={setActiveView} isDashboard={location.pathname === '/dashboard'} />

                <div className="performance-content-wrapper">
                    {/* KPI Cards and other content */}
                    <div className="kpi-grid-enhanced mb-8">
                        {renderKpiCard(<Ship size={32} />, "Total Fleet Ships", fleetShips, "Active vessels in system", 0)}
                        {renderKpiCard(<Cpu size={32} />, "ME Configured", meConfiguredCount, `${fleetShips - meConfiguredCount} pending setup`, 1, 'ME_CONFIG')}
                        {renderKpiCard(<Wrench size={32} />, "AE Configured", aeConfiguredCount, `${fleetShips - aeConfiguredCount} pending setup`, 2, 'AE_CONFIG')}
                        {renderKpiCard(<Clock size={32} />, "Config. Gaps", (fleetShips - meConfiguredCount) + (fleetShips - aeConfiguredCount), "Total configurations needed", 3)}
                    </div>

                    {showMeConfigDetails ? renderMeConfigurationDetails() : showAeConfigDetails ? renderAeConfigurationDetails() : (
                        <div className="tables-grid-enhanced animate-in fade-in slide-in-from-bottom-2 duration-500">
                            {renderUnconfiguredVesselTable(meUnconfiguredList, 'ME', 0)}
                            {renderUnconfiguredVesselTable(aeUnconfiguredList, 'AE', 1)}
                        </div>
                    )}
                </div>
            </div>
        </div>
    </>
);
}
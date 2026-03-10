import React, { useState, useMemo, useEffect } from 'react';
import { useQuery } from '@tanstack/react-query';
import { getVessels } from '@drs/api/vessels';
import api from '@drs/api/axios';
import { 
  UserPlus, Save, Search, CheckSquare, Square, X, Ship, Briefcase, AlertCircle 
} from 'lucide-react';

const AdminUserPanel = () => {
  // 1. Fetch Vessels
  const { data: vessels = [], isLoading } = useQuery({ 
    queryKey: ['vessels'], 
    queryFn: getVessels 
  });

  // 2. Form State
  const [formData, setFormData] = useState({
    full_name: '', 
    email: '', 
    password: '', 
    job_title: 'Chief Engineer', 
    role: 'VESSEL', // <--- FIXED: Default is now VESSEL (was USER)
    assigned_vessel_imos: []
  });

  const [searchTerm, setSearchTerm] = useState('');

  // --- SMART LOGIC: Auto-set Role based on Job Title ---
  useEffect(() => {
    const title = formData.job_title;
    if (['Superintendent', 'Fleet Manager', 'Technical Assistant'].includes(title)) {
      setFormData(prev => ({ ...prev, role: 'SHORE' }));
    } else if (['Master', 'Chief Engineer', '2nd Engineer', 'Chief Officer'].includes(title)) {
      setFormData(prev => ({ ...prev, role: 'VESSEL' }));
    }
  }, [formData.job_title]);

  // --- FILTER LOGIC ---
  const filteredVessels = useMemo(() => {
    return vessels.filter(v => 
      v.name.toLowerCase().includes(searchTerm.toLowerCase()) || 
      v.imo_number.includes(searchTerm)
    );
  }, [vessels, searchTerm]);

  // --- SELECTION HANDLERS ---
  const handleVesselToggle = (imo) => {
    setFormData(prev => {
      const current = prev.assigned_vessel_imos;
      if (current.includes(imo)) {
        return { ...prev, assigned_vessel_imos: current.filter(i => i !== imo) };
      } else {
        return { ...prev, assigned_vessel_imos: [...current, imo] };
      }
    });
  };

  const removeVessel = (imo) => {
    setFormData(prev => ({
      ...prev,
      assigned_vessel_imos: prev.assigned_vessel_imos.filter(i => i !== imo)
    }));
  };

  const handleSelectAll = () => {
    const visibleImos = filteredVessels.map(v => v.imo_number);
    const allSelected = visibleImos.every(imo => formData.assigned_vessel_imos.includes(imo));

    if (allSelected) {
      setFormData(prev => ({
        ...prev,
        assigned_vessel_imos: prev.assigned_vessel_imos.filter(imo => !visibleImos.includes(imo))
      }));
    } else {
      setFormData(prev => ({
        ...prev,
        assigned_vessel_imos: [...new Set([...prev.assigned_vessel_imos, ...visibleImos])]
      }));
    }
  };

  const createUser = async () => {
    if (!formData.email || !formData.password || !formData.full_name) {
      alert("Please fill in all required fields.");
      return;
    }
    
    // VALIDATION: Vessel Users MUST have a ship assigned
    if (formData.role === 'VESSEL' && formData.assigned_vessel_imos.length === 0) {
       alert("⚠️ Action Required: A Vessel Crew member (Master/Chief Eng) must be assigned to at least one ship.");
       return;
    }

    try {
        await api.post('/users/', formData);
        alert(`User '${formData.full_name}' Created Successfully!`);
        // Reset Form
        setFormData({ 
            full_name: '', email: '', password: '', 
            job_title: 'Chief Engineer', role: 'VESSEL', 
            assigned_vessel_imos: [] 
        });
        setSearchTerm('');
    } catch (e) {
        console.error(e);
        alert("Error: " + (e.response?.data?.detail || "Failed to create user"));
    }
  };

  return (
    <div className="dashboard-container">
      <div className="section-header-with-filters">
         <h1 className="page-title"><UserPlus size={22} style={{marginRight:'10px'}}/> Create New User</h1>
      </div>
      
      <div className="form-card" style={{maxWidth: '100%', display:'grid', gridTemplateColumns:'1fr 1fr', gap:'30px'}}>
        
        {/* --- LEFT COLUMN: USER INFO --- */}
        <div className="left-col">
            <h3 style={{marginBottom:'15px', color:'#334155', display:'flex', alignItems:'center', gap:'8px'}}>
                <Briefcase size={18}/> User Details
            </h3>

            <div className="form-group">
                <label>Full Name</label>
                <input className="input-field" value={formData.full_name} onChange={e => setFormData({...formData, full_name: e.target.value})} placeholder="e.g. Capt. John Doe"/>
            </div>

            <div className="form-group">
                <label>Email (Login ID)</label>
                <input className="input-field" value={formData.email} onChange={e => setFormData({...formData, email: e.target.value})} placeholder="master.alfa@drs.com"/>
            </div>

            <div className="form-group">
                <label>Password</label>
                <input className="input-field" type="password" value={formData.password} onChange={e => setFormData({...formData, password: e.target.value})} />
            </div>

            <div className="form-group">
                <label>Job Title</label>
                <select className="input-field" value={formData.job_title} onChange={e => setFormData({...formData, job_title: e.target.value})}>
                    <optgroup label="Vessel Crew">
                        <option value="Master">Master</option>
                        <option value="Chief Engineer">Chief Engineer</option>
                        <option value="Chief Officer">Chief Officer</option>
                        <option value="2nd Engineer">2nd Engineer</option>
                    </optgroup>
                    <optgroup label="Shore Staff">
                        <option value="Fleet Manager">Fleet Manager</option>
                        <option value="Superintendent">Superintendent</option>
                        <option value="Technical Assistant">Technical Assistant</option>
                    </optgroup>
                </select>
            </div>

            <div className="form-group">
                <label>System Permissions</label>
                <select 
                    className="input-field" 
                    value={formData.role} 
                    onChange={e => setFormData({...formData, role: e.target.value})}
                    style={{fontWeight:'600', color: formData.role === 'ADMIN' ? '#dc2626' : '#0f172a'}}
                >
                    <option value="VESSEL">VESSEL (Crew App Only)</option>
                    <option value="SHORE">SHORE (Dashboard View)</option>
                    <option value="ADMIN">ADMIN (Full System Control)</option>
                </select>
                <small style={{color:'#64748b', fontSize:'11px', marginTop:'5px', display:'block'}}>
                   {formData.role === 'VESSEL' && "Can only Create Defects for assigned ships."}
                   {formData.role === 'SHORE' && "Can View & Approve Defects for assigned ships."}
                   {formData.role === 'ADMIN' && "Full access to create users and register ships."}
                </small>
            </div>
        </div>

        {/* --- RIGHT COLUMN: VESSEL ASSIGNMENT --- */}
        <div className="right-col">
            <h3 style={{marginBottom:'15px', color:'#334155', display:'flex', alignItems:'center', gap:'8px'}}>
                <Ship size={18}/> Assign Vessels
            </h3>

            {/* 1. SELECTED TAGS */}
            <div style={{minHeight:'40px', marginBottom:'10px', display:'flex', flexWrap:'wrap', gap:'6px'}}>
                {formData.assigned_vessel_imos.length === 0 && (
                    <div style={{fontSize:'13px', color:'#ef4444', background:'#fef2f2', padding:'8px', borderRadius:'6px', display:'flex', gap:'6px', width:'100%'}}>
                        <AlertCircle size={16}/> Please select at least one vessel.
                    </div>
                )}
                {formData.assigned_vessel_imos.map(imo => {
                    const vessel = vessels.find(v => v.imo_number === imo);
                    return (
                        <div key={imo} className="vessel-tag" style={{
                            background:'#eff6ff', border:'1px solid #bfdbfe', borderRadius:'4px',
                            padding:'4px 8px', fontSize:'12px', display:'flex', alignItems:'center', gap:'5px', color:'#1e40af', fontWeight:'500'
                        }}>
                            {vessel ? vessel.name : imo}
                            <X size={14} style={{cursor:'pointer', opacity:0.6}} onClick={() => removeVessel(imo)}/>
                        </div>
                    )
                })}
            </div>

            {/* 2. SEARCH & SELECTOR */}
            <div className="vessel-selector" style={{border: '1px solid #cbd5e1', borderRadius: '6px', overflow:'hidden', height:'350px', display:'flex', flexDirection:'column'}}>
                
                {/* Header */}
                <div style={{padding:'10px', background:'#f8fafc', borderBottom:'1px solid #e2e8f0'}}>
                    <div style={{position:'relative', marginBottom:'8px'}}>
                        <Search size={14} style={{position:'absolute', left:'8px', top:'9px', color:'#64748b'}}/>
                        <input 
                            type="text" 
                            placeholder="Search fleet..." 
                            value={searchTerm}
                            onChange={(e) => setSearchTerm(e.target.value)}
                            style={{width:'100%', padding:'6px 8px 6px 28px', borderRadius:'4px', border:'1px solid #cbd5e1', fontSize:'13px'}}
                        />
                    </div>
                    <button 
                        onClick={handleSelectAll}
                        style={{
                            width:'100%', fontSize:'12px', background:'white', border:'1px solid #cbd5e1', 
                            padding:'6px', borderRadius:'4px', cursor:'pointer', display:'flex', justifyContent:'center', gap:'5px'
                        }}
                    >
                        <CheckSquare size={14}/> 
                        {filteredVessels.length > 0 && filteredVessels.every(v => formData.assigned_vessel_imos.includes(v.imo_number)) ? 'Deselect Visible' : 'Select Visible'}
                    </button>
                </div>

                {/* List */}
                <div style={{flex:1, overflowY: 'auto', padding:'5px'}}>
                    {isLoading && <div style={{padding:'20px', textAlign:'center', color:'#64748b'}}>Loading Fleet...</div>}
                    
                    {!isLoading && filteredVessels.length === 0 && (
                        <div style={{padding:'20px', textAlign:'center', color:'#94a3b8', fontSize:'13px'}}>No vessels found.</div>
                    )}

                    {filteredVessels.map(v => {
                        const isSelected = formData.assigned_vessel_imos.includes(v.imo_number);
                        return (
                            <div 
                                key={v.imo_number} 
                                onClick={() => handleVesselToggle(v.imo_number)}
                                style={{
                                    padding:'8px 10px', display:'flex', alignItems:'center', gap:'10px', 
                                    cursor:'pointer', borderRadius:'4px', marginBottom:'2px',
                                    background: isSelected ? '#f0fdf4' : 'white',
                                    border: isSelected ? '1px solid #bbf7d0' : '1px solid transparent',
                                    transition: 'all 0.2s'
                                }}
                            >
                                {isSelected ? <CheckSquare size={18} color="#16a34a" fill="#dcfce7"/> : <Square size={18} color="#cbd5e1"/>}
                                <div style={{flex:1}}>
                                    <div style={{fontSize:'13px', fontWeight: isSelected ? '600' : '400', color: isSelected ? '#15803d' : '#334155'}}>
                                        {v.name}
                                    </div>
                                    <div style={{fontSize:'10px', color:'#94a3b8'}}>IMO: {v.imo_number}</div>
                                </div>
                            </div>
                        );
                    })}
                </div>
            </div>
            
            <button className="btn-primary" onClick={createUser} style={{marginTop: '20px', width: '100%', height:'45px', fontSize:'15px'}}>
                <Save size={18} /> Create User Account
            </button>
        </div>

      </div>
    </div>
  );
};

export default AdminUserPanel;
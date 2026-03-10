// ========================================
// FILE 1: CreateDefect.jsx - UPDATED---old logic
// ========================================

import React, { useState, useEffect, useRef } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { Save, Paperclip, MessageSquare, X, Upload, ChevronDown, Plus, Trash2, Eye } from 'lucide-react';
import { useAuth } from '@/context/AuthContext';
import { generateId } from '@drs/services/idGenerator';
import { blobUploadService } from '@drs/services/blobUploadService';
import { defectApi } from '@drs/services/defectApi';

const COMPONENT_OPTIONS = [
  "AIR CON AND REF SYSTEM", "AIR SYSTEM", "AUTOMATION", "AUX BOILER", "AUX ENGINE",
  "CARGO AND BALLAST SYSTEM", "ELECTRIC POWER GENERATION", "FRESH WATER SYSTEM",
  "FUEL OIL SYSTEM", "SHIP ACCESS", "MAIN PROPULSION SYTEM", "MARPOL SYSTEM",
  "MOORING AND ANCHORING", "NAVIGATION AND RADIO", "OTHERS", "LSA & FFA",
  "SEA WATER SYSTEM", "STEERING GEAR AND RUDDER", "VENTILATION SYSTEM", "LO SYSTEM"
];

const DEFECT_SOURCE_OPTIONS = [
  "Office - Technical", "Office - Operation", "Internal Audit", "External Audit",
  "Third Party - RS", "Third Party - PnI", "Third Party - Charterer", 
  "Third Party - Other", "Owner's Inspection"
];

// ✅ Image Gallery Modal with Navigation
const ImageGalleryModal = ({ images, initialIndex = 0, onClose }) => {
  const [currentIndex, setCurrentIndex] = useState(initialIndex);

  if (!images || images.length === 0) return null;

  const handlePrev = () => setCurrentIndex((prev) => (prev === 0 ? images.length - 1 : prev - 1));
  const handleNext = () => setCurrentIndex((prev) => (prev === images.length - 1 ? 0 : prev + 1));

  return (
    <div 
      onClick={onClose}
      style={{
        position: 'fixed',
        top: 0,
        left: 0,
        right: 0,
        bottom: 0,
        background: 'rgba(0, 0, 0, 0.95)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        zIndex: 9999,
        cursor: 'pointer'
      }}
    >
      <button
        onClick={(e) => { e.stopPropagation(); onClose(); }}
        style={{
          position: 'absolute',
          top: '20px',
          right: '20px',
          background: 'white',
          border: 'none',
          borderRadius: '50%',
          width: '40px',
          height: '40px',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          cursor: 'pointer',
          boxShadow: '0 2px 8px rgba(0,0,0,0.3)',
          zIndex: 10000
        }}
      >
        <X size={20} />
      </button>

      {images.length > 1 && (
        <>
          <button
            onClick={(e) => { e.stopPropagation(); handlePrev(); }}
            style={{
              position: 'absolute',
              left: '20px',
              background: 'white',
              border: 'none',
              borderRadius: '50%',
              width: '40px',
              height: '40px',
              cursor: 'pointer',
              fontSize: '20px',
              boxShadow: '0 2px 8px rgba(0,0,0,0.3)'
            }}
          >
            ‹
          </button>
          <button
            onClick={(e) => { e.stopPropagation(); handleNext(); }}
            style={{
              position: 'absolute',
              right: '20px',
              background: 'white',
              border: 'none',
              borderRadius: '50%',
              width: '40px',
              height: '40px',
              cursor: 'pointer',
              fontSize: '20px',
              boxShadow: '0 2px 8px rgba(0,0,0,0.3)'
            }}
          >
            ›
          </button>
        </>
      )}

      <div style={{ textAlign: 'center' }} onClick={(e) => e.stopPropagation()}>
        <img 
          src={images[currentIndex].url} 
          alt={images[currentIndex].name}
          style={{
            maxWidth: '85vw',
            maxHeight: '85vh',
            objectFit: 'contain',
            borderRadius: '8px'
          }}
        />
        <p style={{ color: 'white', marginTop: '15px', fontSize: '14px' }}>
          {currentIndex + 1} / {images.length} - {images[currentIndex].name}
        </p>
      </div>
    </div>
  );
};

const CreateDefect = () => {
  const location = useLocation();
  const { user } = useAuth();
  const navigate = useNavigate();

  const [isSaving, setIsSaving] = useState(false);
  const [initialComment, setInitialComment] = useState("");
  const [files, setFiles] = useState([]);
  const [previewImages, setPreviewImages] = useState([]);
  const [selectedGallery, setSelectedGallery] = useState(null);
  const [prNumbers, setPrNumbers] = useState([{ id: generateId(), value: '', description: '' }]);
  
  const [showComponentDropdown, setShowComponentDropdown] = useState(false);
  const [componentSearch, setComponentSearch] = useState("");
  const dropdownRef = useRef(null);

  const [mentionList, setMentionList] = useState([]);
  const [showMentions, setShowMentions] = useState(false);
  const [taggedUsers, setTaggedUsers] = useState([]);
  const [cursorPosition, setCursorPosition] = useState(0);

  const [formData, setFormData] = useState({
    date: new Date().toISOString().split('T')[0],
    target_close_date: '',
    equipment: '',
    description: '',
    priority: 'NORMAL',
    status: 'OPEN',
    responsibility: 'Engine Dept',
    defect_source: 'Internal Audit'
  });

  const vesselImo = user?.assignedVessels?.[0] || '';
  const isEditMode = !!location.state?.defectToEdit;
  
  const { data: vesselUsers = [] } = useQuery({
    queryKey: ['vessel-users-create', vesselImo],
    queryFn: async () => {
      if (!vesselImo) return [];
      try {
        return await defectApi.getVesselUsers(vesselImo);
      } catch (error) {
        return [];
      }
    },
    enabled: !!vesselImo && !isEditMode,
    staleTime: 1000 * 60 * 5 
  });

  useEffect(() => {
    if (location.state?.defectToEdit) {
      const d = location.state.defectToEdit;
      setFormData({
        date: d.date_identified ? d.date_identified.split('T')[0] : '',
        target_close_date: d.target_close_date ? d.target_close_date.split('T')[0] : '',
        equipment: d.equipment_name || '',
        description: d.description || '',
        priority: d.priority || 'NORMAL',
        status: d.status || 'OPEN',
        responsibility: d.responsibility || 'Engine Dept',
        defect_source: d.defect_source || 'Internal Audit'
      });
      setComponentSearch(d.equipment_name || '');
      
      if (d.pr_entries && d.pr_entries.length > 0) {
        setPrNumbers(d.pr_entries.map(pr => ({
          id: pr.id,
          value: pr.pr_number,
          description: pr.pr_description || ''
        })));
      }
    }
  }, [location]);

  useEffect(() => {
    const handleClickOutside = (event) => {
      if (dropdownRef.current && !dropdownRef.current.contains(event.target)) {
        setShowComponentDropdown(false);
      }
    };
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  const handleChange = (e) => {
    const { name, value } = e.target;
    setFormData(prev => ({ ...prev, [name]: value }));
  };

  const handleComponentChange = (e) => {
    const value = e.target.value;
    setComponentSearch(value);
    setFormData(prev => ({ ...prev, equipment: value }));
    setShowComponentDropdown(true);
  };

  const selectComponent = (comp) => {
    setComponentSearch(comp);
    setFormData(prev => ({ ...prev, equipment: comp }));
    setShowComponentDropdown(false);
  };

  const filteredComponents = COMPONENT_OPTIONS.filter(c => 
    c.toLowerCase().includes(componentSearch.toLowerCase())
  );

  const addPrNumber = () => {
    setPrNumbers([...prNumbers, { id: generateId(), value: '', description: '' }]);
  };

  const removePrNumber = (id) => {
    if (prNumbers.length === 1) return;
    setPrNumbers(prNumbers.filter(pr => pr.id !== id));
  };

  const updatePrNumber = (id, field, value) => {
    setPrNumbers(prNumbers.map(pr => 
      pr.id === id ? { ...pr, [field]: value } : pr
    ));
  };

  const handleCommentChange = (e) => {
    const text = e.target.value;
    const cursorPos = e.target.selectionStart;
    setInitialComment(text);
    setCursorPosition(cursorPos);

    const textBeforeCursor = text.slice(0, cursorPos);
    const lastAtIndex = textBeforeCursor.lastIndexOf('@');

    if (lastAtIndex !== -1 && (lastAtIndex === 0 || text[lastAtIndex - 1] === ' ')) {
      const searchTerm = textBeforeCursor.slice(lastAtIndex + 1);
      const filtered = vesselUsers.filter(u =>
        u.name.toLowerCase().includes(searchTerm.toLowerCase())
      );
      setMentionList(filtered);
      setShowMentions(filtered.length > 0);
    } else {
      setShowMentions(false);
    }
  };

  const selectMention = (selectedUser) => {
    const textBeforeCursor = initialComment.slice(0, cursorPosition);
    const lastAtIndex = textBeforeCursor.lastIndexOf('@');
    const textAfterCursor = initialComment.slice(cursorPosition);
    const newText = initialComment.slice(0, lastAtIndex) + `@${selectedUser.name} ` + textAfterCursor;
    setInitialComment(newText);
    if (!taggedUsers.includes(selectedUser.id)) {
      setTaggedUsers([...taggedUsers, selectedUser.id]);
    }
    setShowMentions(false);
  };

  const handleFileChange = (e) => {
    const newFiles = Array.from(e.target.files);
    const MAX_SIZE = 1024 * 1024; // 1MB
    const validFiles = [];
    const rejectedFiles = [];

    newFiles.forEach(file => {
      if (file.size > MAX_SIZE) {
        rejectedFiles.push(`${file.name} (${(file.size / 1024 / 1024).toFixed(2)}MB)`);
      } else {
        validFiles.push(file);
        
        if (file.type.startsWith('image/')) {
          const reader = new FileReader();
          reader.onload = (e) => {
            setPreviewImages(prev => [...prev, {
              id: generateId(),
              url: e.target.result,
              name: file.name
            }]);
          };
          reader.readAsDataURL(file);
        }
      }
    });

    if (rejectedFiles.length > 0) {
      alert(`⚠️ The following files exceed 1MB and were rejected:\n\n${rejectedFiles.join('\n')}`);
    }

    if (validFiles.length > 0) {
      setFiles(prev => [...prev, ...validFiles]);
    }
  };

  const removeFile = (index) => {
    const fileToRemove = files[index];
    setFiles(prev => prev.filter((_, i) => i !== index));
    
    if (fileToRemove.type.startsWith('image/')) {
      setPreviewImages(prev => prev.filter(preview => preview.name !== fileToRemove.name));
    }
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    
    if (!formData.equipment || !formData.description) {
      alert("⚠️ Please fill in Component Name and Description.");
      return;
    }

    setIsSaving(true);

    try {
      const defectId = location.state?.defectToEdit?.id || generateId();
      const threadId = generateId();

      const attachmentMetadata = [];
      if (files.length > 0) {
        for (let i = 0; i < files.length; i++) {
          const file = files[i];
          const attachmentId = generateId();
          try {
            const blobPath = await blobUploadService.uploadBinary(file, defectId, attachmentId);
            attachmentMetadata.push({
              id: attachmentId,
              thread_id: threadId,
              file_name: file.name,
              file_size: file.size,
              content_type: file.type,
              blob_path: blobPath
            });
          } catch (uploadError) {
            throw new Error(`Failed to upload "${file.name}": ${uploadError.message}`);
          }
        }
      }

      const validPrNumbers = prNumbers
        .filter(pr => pr.value.trim() !== '')
        .map(pr => ({ number: pr.value, description: pr.description }));

      const fullPackage = {
        ...formData,
        defectId,
        initialComment,
        attachments: attachmentMetadata,
        taggedUsers,
        pr_numbers: validPrNumbers,
        vessel_imo: user.assignedVessels?.[0] || 'UNKNOWN',
        created_at: new Date().toISOString()
      };
      
      console.log('📦 [CREATE] Uploading JSON metadata to Azure...');
      const jsonBackupPath = await blobUploadService.uploadMetadataJSON(fullPackage, defectId);
      console.log('✅ [CREATE] JSON backup path received:', jsonBackupPath);

      if (isEditMode) {
        const updatePayload = {
          equipment_name: formData.equipment,
          description: formData.description,
          priority: formData.priority,
          status: formData.status,
          responsibility: formData.responsibility,
          defect_source: formData.defect_source,
          target_close_date: formData.target_close_date || null,
          json_backup_path: jsonBackupPath
        };
        console.log('📝 [UPDATE] Payload:', updatePayload);
        await defectApi.updateDefect(defectId, updatePayload);
      } else {
        const createPayload = {
          id: defectId,
          vessel_imo: user.assignedVessels?.[0] || 'UNKNOWN',
          date: formData.date,
          equipment: formData.equipment,
          description: formData.description,
          priority: formData.priority,
          status: formData.status,
          responsibility: formData.responsibility,
          defect_source: formData.defect_source,
          target_close_date: formData.target_close_date || null,
          json_backup_path: jsonBackupPath  // ✅ CRITICAL: This must be included!
        };
        
        console.log('💾 [CREATE] Payload with json_backup_path:', createPayload);
        await defectApi.createDefect(createPayload);

        await defectApi.createThread({
          id: threadId,
          defect_id: defectId,
          author: user?.job_title || user?.full_name || 'Chief Engineer',
          body: initialComment || "Defect reported with attachments",
          tagged_user_ids: taggedUsers
        });
      }

      for (const attachment of attachmentMetadata) {
        await defectApi.createAttachment(attachment);
      }

      for (const pr of validPrNumbers) {
        await defectApi.createPrEntry({
          defect_id: defectId,
          pr_number: pr.number,
          pr_description: pr.description
        });
      }

      alert(isEditMode ? "✅ Defect Updated Successfully!" : "✅ Defect Created Successfully!");
      navigate('/drs/vessel/dashboard');

    } catch (err) {
      console.error("❌ Submission Error:", err);
      alert(`❌ Failed to save defect: ${err.message}`);
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <div className="create-defect-container">
      <div className="form-header-row">
        <h1 className="page-title">
          {isEditMode ? 'Update Defect' : 'Report New Defect'}
        </h1>
        <button className="btn-primary" onClick={handleSubmit} disabled={isSaving}>
          <Save size={18} />
          {isSaving ? 'Syncing...' : (isEditMode ? 'Update Changes' : 'Save to Cloud')}
        </button>
      </div>

      <div className="form-layout">
        <div className="form-card">
          <h3>Defect Details</h3>
          <form className="defect-form" onSubmit={handleSubmit}>
            
            <div className="form-row">
              <div className="form-group">
                <label>Date Identified *</label>
                <input 
                  type="date" 
                  name="date" 
                  className="input-field" 
                  value={formData.date} 
                  onChange={handleChange} 
                  required
                />
              </div>
              
              <div className="form-group">
                <label>Target Closing Date</label>
                <input 
                  type="date" 
                  name="target_close_date" 
                  className="input-field" 
                  value={formData.target_close_date} 
                  onChange={handleChange} 
                  style={{ borderColor: '#6366f1' }}
                />
                <small style={{fontSize: '11px', color: '#64748b'}}>When should this be closed?</small>
              </div>
            </div>

            <div className="form-group">
              <label>Defect Source *</label>
              <select 
                name="defect_source" 
                className="input-field" 
                value={formData.defect_source} 
                onChange={handleChange}
                required
              >
                {DEFECT_SOURCE_OPTIONS.map(option => (
                  <option key={option} value={option}>{option}</option>
                ))}
              </select>
            </div>

            <div className="form-group" style={{ position: 'relative' }} ref={dropdownRef}>
              <label>Component Name *</label>
              <div style={{ position: 'relative' }}>
                <input 
                  type="text" 
                  name="equipment" 
                  className="input-field" 
                  placeholder="Type to search component..." 
                  value={componentSearch} 
                  onChange={handleComponentChange}
                  onFocus={() => setShowComponentDropdown(true)}
                  required
                  autoComplete="off"
                />
                <ChevronDown 
                  size={16} 
                  style={{ position: 'absolute', right: '12px', top: '12px', color: '#94a3b8', pointerEvents: 'none' }} 
                />
              </div>
              
              {showComponentDropdown && (
                <ul style={{
                  position: 'absolute',
                  top: '100%',
                  left: 0,
                  right: 0,
                  background: 'white',
                  border: '1px solid #e2e8f0',
                  borderRadius: '0 0 8px 8px',
                  boxShadow: '0 4px 6px -1px rgba(0, 0, 0, 0.1)',
                  maxHeight: '250px',
                  overflowY: 'auto',
                  zIndex: 50,
                  margin: 0,
                  padding: 0,
                  listStyle: 'none'
                }}>
                  {filteredComponents.length > 0 ? (
                    filteredComponents.map((comp, idx) => (
                      <li 
                        key={idx}
                        onClick={() => selectComponent(comp)}
                        style={{
                          padding: '10px 16px',
                          cursor: 'pointer',
                          fontSize: '14px',
                          borderBottom: '1px solid #f1f5f9',
                          transition: 'background 0.1s'
                        }}
                        onMouseEnter={(e) => e.target.style.background = '#f8fafc'}
                        onMouseLeave={(e) => e.target.style.background = 'white'}
                      >
                        {comp}
                      </li>
                    ))
                  ) : (
                    <li style={{ padding: '10px 16px', color: '#94a3b8', fontSize: '13px' }}>
                      No components found. You can type a custom name.
                    </li>
                  )}
                </ul>
              )}
            </div>

            <div className="form-group">
              <label>Defect Description *</label>
              <textarea 
                className="input-field area" 
                name="description" 
                rows="3" 
                placeholder="Describe the failure in detail..." 
                value={formData.description} 
                onChange={handleChange}
                required
              />
            </div>

            <div className="form-row three-col">
              <div className="form-group">
                <label>Priority</label>
                <select name="priority" className="input-field" value={formData.priority} onChange={handleChange}>
                  <option value="NORMAL">Normal</option>
                  <option value="MEDIUM">Medium</option>
                  <option value="HIGH">High</option>
                  <option value="CRITICAL">Critical</option>
                </select>
              </div>
              <div className="form-group">
                <label>Status</label>
                <select name="status" className="input-field" value={formData.status} onChange={handleChange}>
                  <option value="OPEN">Open</option>
                  <option value="IN_PROGRESS">In Progress</option>
                  <option value="CLOSED">Closed</option>
                </select>
              </div>
              <div className="form-group">
                <label>Responsibility</label>
                <select name="responsibility" className="input-field" value={formData.responsibility} onChange={handleChange}>
                  <option>Engine Dept</option>
                  <option>Deck Dept</option>
                  <option>Electrical</option>
                  <option>Catering</option>
                </select>
              </div>
            </div>

            <div className="form-group">
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '10px' }}>
                <label style={{ margin: 0 }}>PR Numbers (Optional)</label>
                <button 
                  type="button"
                  onClick={addPrNumber}
                  style={{
                    background: '#10b981',
                    color: 'white',
                    border: 'none',
                    padding: '6px 12px',
                    borderRadius: '6px',
                    display: 'flex',
                    alignItems: 'center',
                    gap: '6px',
                    fontSize: '13px',
                    cursor: 'pointer',
                    fontWeight: '600'
                  }}
                >
                  <Plus size={16} /> Add PR
                </button>
              </div>
              
              {prNumbers.map((pr, index) => (
                <div key={pr.id} style={{ display: 'flex', gap: '10px', marginBottom: '10px', alignItems: 'flex-start' }}>
                  <div style={{ flex: 1 }}>
                    <input 
                      type="text" 
                      className="input-field" 
                      placeholder="PR Number (e.g., PR-2024-001)"
                      value={pr.value}
                      onChange={(e) => updatePrNumber(pr.id, 'value', e.target.value)}
                      style={{ marginBottom: '6px' }}
                    />
                    <input 
                      type="text" 
                      className="input-field" 
                      placeholder="Description (optional)"
                      value={pr.description}
                      onChange={(e) => updatePrNumber(pr.id, 'description', e.target.value)}
                    />
                  </div>
                  {prNumbers.length > 1 && (
                    <button 
                      type="button"
                      onClick={() => removePrNumber(pr.id)}
                      style={{
                        background: '#ef4444',
                        color: 'white',
                        border: 'none',
                        padding: '8px',
                        borderRadius: '6px',
                        cursor: 'pointer',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        marginTop: '0'
                      }}
                      title="Remove PR"
                    >
                      <Trash2 size={16} />
                    </button>
                  )}
                </div>
              ))}
            </div>
          </form>
        </div>

        <div className="side-panel">
          <div className="panel-card">
            <h3><Paperclip size={18} /> Attachments</h3>
            <div className="upload-zone">
              <input 
                type="file" 
                multiple 
                id="file-upload" 
                onChange={handleFileChange} 
                accept="image/*,.pdf,.doc,.docx" 
                hidden 
              />
              <label htmlFor="file-upload" className="upload-label">
                <Upload size={24} />
                <span>Click to Upload Files</span>
                <small>Max 1MB per file | Photos, PDFs, Docs</small>
              </label>
            </div>

            {files.length > 0 && (
              <div style={{ marginTop: '15px' }}>
                <div style={{display:'flex', justifyContent:'space-between', alignItems:'center', marginBottom:'10px'}}>
                  <p style={{ fontSize: '13px', color: '#64748b', margin:0, fontWeight: '600' }}>
                    {files.length} file(s) ready to upload
                  </p>
                  {previewImages.length > 0 && (
                    <button
                      type="button"
                      onClick={() => setSelectedGallery(previewImages)}
                      style={{
                        background:'#0ea5e9',
                        color:'white',
                        border:'none',
                        padding:'6px 12px',
                        borderRadius:'6px',
                        fontSize:'12px',
                        fontWeight:'600',
                        cursor:'pointer',
                        display:'flex',
                        alignItems:'center',
                        gap:'6px'
                      }}
                    >
                      <Eye size={14} /> Preview All ({previewImages.length})
                    </button>
                  )}
                </div>
                <ul className="file-list">
                  {files.map((f, i) => (
                    <li key={i}>
                      <div className="file-info">
                        <span className="file-name">{f.name}</span>
                        <span className="size">({(f.size / 1024).toFixed(1)} KB)</span>
                      </div>
                      <button 
                        type="button"
                        className="btn-remove" 
                        onClick={() => removeFile(i)}
                        title="Remove file"
                      >
                        <X size={14} />
                      </button>
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </div>

          {!isEditMode && (
            <div className="panel-card" style={{ position: 'relative' }}>
              <h3><MessageSquare size={18} /> Initial Comment</h3>
              <textarea 
                className="input-field area" 
                rows="4" 
                placeholder="Add your initial comments or tag @Superintendent for assistance..." 
                value={initialComment} 
                onChange={handleCommentChange}
                style={{ position: 'relative' }}
              />
              
              {showMentions && (
                <div 
                  style={{ 
                    position: 'absolute', 
                    bottom: '90px', 
                    left: '20px', 
                    background: 'white', 
                    border: '1px solid #e2e8f0', 
                    borderRadius: '8px', 
                    boxShadow: '0 4px 12px rgba(0,0,0,0.1)', 
                    maxHeight: '200px', 
                    overflowY: 'auto', 
                    zIndex: 1000, 
                    minWidth: '200px' 
                  }}
                >
                  {mentionList.map(u => (
                    <div 
                      key={u.id} 
                      onClick={() => selectMention(u)} 
                      style={{ 
                        padding: '10px', 
                        cursor: 'pointer', 
                        fontSize: '13px', 
                        borderBottom: '1px solid #f1f5f9',
                        display: 'flex',
                        justifyContent: 'space-between'
                      }}
                      onMouseEnter={(e) => e.currentTarget.style.background = '#f8fafc'}
                      onMouseLeave={(e) => e.currentTarget.style.background = 'white'}
                    >
                      <span>{u.name}</span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>
      </div>

      {selectedGallery && (
        <ImageGalleryModal 
          images={selectedGallery}
          initialIndex={0}
          onClose={() => setSelectedGallery(null)}
        />
      )}
    </div>
  );
};

export default CreateDefect;
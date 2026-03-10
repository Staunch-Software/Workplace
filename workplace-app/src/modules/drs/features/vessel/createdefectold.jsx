import React, { useState, useEffect } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { Save, Paperclip, MessageSquare, X } from 'lucide-react';
import { useAuth } from '@/context/AuthContext';

// Phase 1 Services
import { generateId } from '@drs/services/idGenerator';
import { blobUploadService } from '@drs/services/blobUploadService';
import { defectApi } from '@drs/services/defectApi';

const CreateDefect = () => {
  const location = useLocation();
  const { user } = useAuth();
  const navigate = useNavigate();

  const [isSaving, setIsSaving] = useState(false);
  const [initialComment, setInitialComment] = useState("");
  const [files, setFiles] = useState([]);

  const [formData, setFormData] = useState({
    date: new Date().toISOString().split('T')[0],
    equipment: '',
    description: '',
    remarks: '',
    priority: 'Normal',
    status: 'Open',
    responsibility: 'Engine Dept',
    officeSupport: 'No',
    prNumber: '',
    prStatus: ''
  });

  useEffect(() => {
    if (location.state?.defectToEdit) {
      const d = location.state.defectToEdit;

      // Manually map Backend Keys -> Frontend Form Keys
      setFormData({
        // 1. Format Date (Backend ISO -> Frontend YYYY-MM-DD)
        date: d.date_identified ? d.date_identified.split('T')[0] : '',

        // 2. Map Equipment
        equipment: d.equipment_name || '',

        // 3. Map Description & Remarks
        description: d.description || '',
        remarks: d.ships_remarks || '',

        // 4. Map Enums (Convert UPPERCASE from DB to Title Case for UI if needed)
        // If your <option> values are "NORMAL", keep them as is.
        priority: d.priority || 'NORMAL',
        status: d.status || 'OPEN',

        responsibility: d.responsibility || 'Engine Dept',

        // 5. Map Office Support (Boolean -> String for Dropdown)
        officeSupport: d.office_support_required ? 'Yes' : 'No',

        // 6. Map PR Details
        prNumber: d.pr_number || '',
        prStatus: d.pr_status || ''
      });
    }
  }, [location]);

  const handleChange = (e) => {
    const { name, value } = e.target;
    setFormData(prev => ({ ...prev, [name]: value }));
  };

  const handleFileChange = (e) => {
    setFiles(prev => [...prev, ...Array.from(e.target.files)]);
  };

  const removeFile = (index) => {
    setFiles(prev => prev.filter((_, i) => i !== index));
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!formData.equipment || !formData.description) {
      alert("Please fill in the Component Name and Description.");
      return;
    }

    setIsSaving(true);
    const isEdit = !!location.state?.defectToEdit;

    try {
      // FIX 1: Use a real UUID. DEF-timestamp is NOT a valid UUID.
      const defectId = location.state?.defectToEdit?.id || generateId();
      const threadId = generateId();

      // STEP 1: Upload Binaries to Azure Blob
      const attachmentMeta = [];
      for (const file of files) {
        const attId = generateId();
        const path = await blobUploadService.uploadBinary(file, defectId, attId);
        attachmentMeta.push({
          id: attId,
          thread_id: threadId,
          file_name: file.name,
          file_size: file.size,
          content_type: file.type,
          blob_path: path
        });
      }

      // STEP 2: Upload JSON Metadata to Azure
      const fullPackage = {
        ...formData,
        defectId,
        initialComment,
        attachments: attachmentMeta,
        vessel_imo: user.assignedVessels[0] // <--- Use real IMO from AuthContext
      };

      const jsonPath = await blobUploadService.uploadMetadataJSON(fullPackage, defectId);

      if (isEdit) {
        await defectApi.updateDefect(defectId, {
          ...formData,
          json_backup_path: jsonPath
        });
      } else {
        // Create new record
        await defectApi.createDefect({
          ...formData,
          id: defectId,
          vessel_imo: user.assignedVessels[0],
          json_backup_path: jsonPath
        });

        // Only create the initial thread for NEW defects
        await defectApi.createThread({
          id: threadId,
          defect_id: defectId,
          author: 'Chief Engineer',
          body: initialComment || "Defect Reported"
        });
      }

      // Register new attachments (works for both new and edit)
      for (const att of attachmentMeta) {
        await defectApi.createAttachment(att);
      }

      alert(isEdit ? "Defect Updated Successfully!" : "Defect Created Successfully!");
      navigate('/drs/vessel/dashboard');
    } catch (err) {
      console.error("Sync Error:", err);
      alert("Sync Failed: " + err.message);
    } finally {
      setIsSaving(false);
    }
  };

  // const handleSubmit = async (e) => {
  //   e.preventDefault();
  //   setIsSaving(true);

  //   try {
  //     // FIX: Use a real UUID instead of "TEST-..."
  //     const defectId = generateId();
  //     const threadId = generateId();

  //     // Ensure date is in YYYY-MM-DD format for the backend
  //     const formattedDate = new Date(formData.date).toISOString().split('T')[0];

  //     const payload = {
  //       id: defectId, // This will now be a valid UUID string
  //       date: formattedDate,
  //       equipment: formData.equipment,
  //       description: formData.description,
  //       remarks: formData.remarks || "",
  //       priority: formData.priority || "Normal",
  //       status: formData.status || "Open",
  //       responsibility: formData.responsibility || "Engine Dept",
  //       officeSupport: formData.officeSupport || "No",
  //       prNumber: formData.prNumber || "",
  //       prStatus: formData.prStatus || "",
  //       json_backup_path: "MOCK_AZURE_PATH/metadata.json"
  //     };

  //     console.log("🚀 Sending Valid UUID Payload:", payload);

  //     // 1. Create Defect
  //     await defectApi.createDefect(payload);

  //     // 2. Create Thread (Also needs a valid UUID)
  //     await defectApi.createThread({
  //       id: threadId,
  //       defect_id: defectId,
  //       author: "Chief Engineer",
  //       body: initialComment || "Defect reported via integration test."
  //     });

  //     alert("Success! Data stored in PostgreSQL with valid UUIDs.");
  //     navigate('/drs/vessel/dashboard');

  //   } catch (error) {
  //     console.error("API Error:", error);
  //     alert(`API Error: ${error.message}`);
  //   } finally {
  //     setIsSaving(false);
  //   }
  // };

  return (
    <div className="create-defect-container">
      <div className="form-header-row">
        <h1 className="page-title">
          {location.state?.defectToEdit ? `Update Defect: ${location.state.defectToEdit.id}` : 'Report New Defect'}
        </h1>

        <button className="btn-primary" onClick={handleSubmit} disabled={isSaving}>
          <Save size={18} />
          {isSaving ? 'Syncing Cloud...' : (location.state?.defectToEdit ? 'Update Changes' : 'Save to Cloud')}
        </button>
      </div>

      <div className="form-layout">
        <div className="form-card">
          <h3>Defect Details</h3>
          <form className="defect-form">
            <div className="form-row">
              <div className="form-group">
                <label>Date Identified</label>
                <input type="date" name="date" className="input-field" value={formData.date} onChange={handleChange} />
              </div>
              <div className="form-group flex-2">
                <label>Component Name</label>
                <input type="text" name="equipment" className="input-field" placeholder="e.g. Main Engine Fuel Pump #2" value={formData.equipment} onChange={handleChange} />
              </div>
            </div>

            <div className="form-group">
              <label>Defect Description</label>
              <textarea className="input-field area" name="description" rows="3" placeholder="Describe the failure detail..." value={formData.description} onChange={handleChange}></textarea>
            </div>

            <div className="form-group">
              <label>Ship's Remarks / Action Taken</label>
              <textarea className="input-field area" name="remarks" rows="2" placeholder="Temporary repairs done? Spares used?" value={formData.remarks} onChange={handleChange}></textarea>
            </div>

            <div className="form-row three-col">
              <div className="form-group">
                <label>Priority</label>
                <select name="priority" className="input-field" value={formData.priority} onChange={handleChange}>
                  <option value="NORMAL">Normal</option>
                  <option value="HIGH">High</option>
                  <option value="CRITICAL">Critical</option>
                </select>
              </div>
              <div className="form-group">
                <label>Status</label>
                <select name="status" className="input-field" value={formData.status} onChange={handleChange}>
                  <option value="OPEN">Open</option><option value="IN_PROGRESS">In Progress</option><option value="CLOSED">Closed</option>
                </select>
              </div>
              <div className="form-group">
                <label>Responsibility</label>
                <select name="responsibility" className="input-field" value={formData.responsibility} onChange={handleChange}>
                  <option>Engine Dept</option><option>Deck Dept</option><option>Electrical</option>
                </select>
              </div>
            </div>

            <div className="form-row">
              <div className="form-group">
                <label>Office Support Required?</label>
                <select name="officeSupport" className="input-field" value={formData.officeSupport} onChange={handleChange}>
                  <option>No</option><option>Yes - Spares</option><option>Yes - Service Engineer</option>
                </select>
              </div>
              <div className="form-group">
                <label>PR Number (Optional)</label>
                <input type="text" name="prNumber" className="input-field" value={formData.prNumber} onChange={handleChange} />
              </div>
              <div className="form-group">
                <label>PR Status</label>
                <input type="text" name="prStatus" className="input-field" value={formData.prStatus} onChange={handleChange} />
              </div>
            </div>
          </form>
        </div>

        <div className="side-panel">
          <div className="panel-card">
            <h3><Paperclip size={18} /> Attachments</h3>
            <div className="upload-zone">
              <input type="file" multiple id="file-upload" onChange={handleFileChange} accept="image/*,.pdf" hidden />
              <label htmlFor="file-upload" className="upload-label">
                <span>Click to Upload Photos/PDF</span>
                <small>Direct Cloud Upload</small>
              </label>
            </div>
            {files.length > 0 && (
              <ul className="file-list">
                {files.map((f, i) => (
                  <li key={i}>
                    <div className="file-info">
                      <span className="file-name">{f.name}</span>
                      <span className="size">({(f.size / 1024).toFixed(0)}kb)</span>
                    </div>
                    <button className="btn-remove" onClick={() => removeFile(i)}><X size={14} /></button>
                  </li>
                ))}
              </ul>
            )}
          </div>

          {!location.state?.defectToEdit && (
            <div className="panel-card">
              <h3><MessageSquare size={18} /> Initial Comment</h3>
              <textarea className="input-field area" rows="4" placeholder="Tag @Superintendent..." value={initialComment} onChange={(e) => setInitialComment(e.target.value)}></textarea>
              <div className="hint-text">This starts the cloud chat thread.</div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

export default CreateDefect;
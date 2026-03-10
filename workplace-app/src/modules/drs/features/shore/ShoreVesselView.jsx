import React, { useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { 
  ArrowLeft, MessageSquare, ChevronDown, ChevronUp, 
  CheckCircle, X, ShieldAlert 
} from 'lucide-react';

const ShoreVesselView = () => {
  const { id } = useParams(); // Get vessel ID from URL
  const navigate = useNavigate();
  const [expandedRow, setExpandedRow] = useState(null);
  const [isModalOpen, setIsModalOpen] = useState(false);

  // MOCK DEFECTS FOR SELECTED VESSEL
  const defects = [
    { 
      id: 'DEF-001', title: 'Fuel Pump Leak', priority: 'Critical', 
      status: 'Open', description: 'Leaking heavily.', remarks: 'Spares ordered.',
      comments: 4
    },
    { 
      id: 'DEF-004', title: 'Radar Motor Issue', priority: 'Medium', 
      status: 'In Progress', description: 'Belt slipping.', remarks: 'Tightened.',
      comments: 2
    }
  ];

  const toggleExpand = (id) => setExpandedRow(expandedRow === id ? null : id);

  return (
    <div className="dashboard-container">
      <div className="header-row">
        <button className="back-btn" onClick={() => navigate('/drs/shore/dashboard')}>
          <ArrowLeft size={18} /> Back to Fleet
        </button>
        <h1 className="page-title">Vessel: {id === 'v1' ? 'MT ALFA' : 'MT BRAVO'}</h1>
      </div>

      <div className="table-card">
        <table className="data-table">
          <thead>
            <tr>
              <th>ID</th>
              <th>Title</th>
              <th>Priority</th>
              <th>Status</th>
              <th>Conversation</th>
              <th>Details</th>
            </tr>
          </thead>
          <tbody>
            {defects.map((defect) => (
              <React.Fragment key={defect.id}>
                <tr>
                  <td className="id-cell">{defect.id}</td>
                  <td className="title-cell">{defect.title}</td>
                  <td><span className={`badge badge-${defect.priority.toLowerCase()}`}>{defect.priority}</span></td>
                  <td><span className="status-dot"></span>{defect.status}</td>
                  <td>
                    <button className="thread-btn" onClick={() => setIsModalOpen(true)}>
                      <MessageSquare size={16} /> 
                      {defect.comments > 0 && <span className="msg-count">{defect.comments}</span>}
                    </button>
                  </td>
                  <td>
                    <button className="action-btn" onClick={() => toggleExpand(defect.id)}>
                      {expandedRow === defect.id ? <ChevronUp size={20} /> : <ChevronDown size={20} />}
                    </button>
                  </td>
                </tr>
                
                {/* EXPANDED VIEW FOR SHORE (ReadOnly + Approval Actions) */}
                {expandedRow === defect.id && (
                  <tr className="detail-row">
                    <td colSpan="6">
                      <div className="detail-content">
                        <div className="detail-grid">
                          <div><strong>Description:</strong> <p>{defect.description}</p></div>
                          <div><strong>Ship Remarks:</strong> <p>{defect.remarks}</p></div>
                        </div>
                        <div className="detail-actions">
                          {/* SHORE SPECIFIC ACTIONS */}
                          <button className="btn-action close-task">
                            <CheckCircle size={16} /> Approve Closure
                          </button>
                          <button className="btn-action edit">
                            <ShieldAlert size={16} /> Raise Priority
                          </button>
                        </div>
                      </div>
                    </td>
                  </tr>
                )}
              </React.Fragment>
            ))}
          </tbody>
        </table>
      </div>

      {/* REUSED CHAT MODAL (Simplified for brevity) */}
      {isModalOpen && (
        <div className="modal-overlay">
          <div className="modal-content">
            <div className="modal-header">
              <h3>Thread: {defects[0].title}</h3>
              <button onClick={() => setIsModalOpen(false)}><X size={20} /></button>
            </div>
            <div className="modal-body">
              <div className="chat-msg vessel"><strong>Chief Eng:</strong> <p>Leakage found.</p></div>
              <div className="chat-msg shore"><strong>You:</strong> <p>Is spare available?</p></div>
            </div>
            <div className="modal-footer">
              <input type="text" placeholder="Reply to vessel..." />
              <button className="btn-primary">Send</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default ShoreVesselView;
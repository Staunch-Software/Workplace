import React from 'react';
import './DefectWorkspace.css';

const DefectWorkspace = () => {
  return (
    <div className="workspace-container">
      
      {/* PANE 1: CONTEXT (Left) */}
      <aside className="pane-context">
        <div className="pane-header">
          <h3>Defect #2025-099</h3>
          <span className="badge badge-critical">Critical</span>
        </div>
        
        <div className="details-list">
          <div className="detail-item">
            <label>Equipment</label>
            <p>Main Engine / Fuel Pump #2</p>
          </div>
          <div className="detail-item">
            <label>Reported Date</label>
            <p>26 Dec 2025</p>
          </div>
          <div className="detail-item">
            <label>Status</label>
            <select className="status-select">
              <option>Open</option>
              <option>Deferral Requested</option>
            </select>
          </div>
        </div>
      </aside>

      {/* PANE 2: WORKFLOW (Center) */}
      <main className="pane-workflow">
        <div className="pane-header">
          <h2>Corrective Actions</h2>
          <button className="btn-small">+ Add Task</button>
        </div>
        
        <div className="task-tree">
          <div className="task-item completed">
             <input type="checkbox" checked readOnly />
             <div className="task-content">
               <span className="task-title">Isolate Fuel Line</span>
               <span className="task-meta">Completed by 2/E • 10:00 AM</span>
             </div>
          </div>
          
          <div className="task-item active">
             <input type="checkbox" />
             <div className="task-content">
               <span className="task-title">Replace O-Ring Seal</span>
               <span className="task-meta">Assigned to: 3/E</span>
             </div>
          </div>
        </div>
      </main>

      {/* PANE 3: COLLABORATION (Right) */}
      <aside className="pane-collab">
        <div className="pane-header">
          <div className="tabs">
            <button className="tab active">Chat</button>
            <button className="tab">Files</button>
          </div>
        </div>
        
        <div className="chat-thread">
          <div className="message shore">
            <div className="msg-bubble">Please confirm spare part availability.</div>
            <div className="msg-info">Supt. Smith • 09:15</div>
          </div>
          
          <div className="message vessel">
            <div className="msg-bubble">Checking store room now.</div>
            <div className="msg-info">C/E John • 09:20</div>
          </div>
        </div>
        
        <div className="chat-input-area">
          <input type="text" placeholder="Type a message..." />
          <button>➤</button>
        </div>
      </aside>

    </div>
  );
};

export default DefectWorkspace;
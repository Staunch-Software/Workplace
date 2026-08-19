import React, { useState } from 'react';
import { X, Maximize2, Columns } from 'lucide-react';
import AttachmentsPanel from './AttachmentsPanel';
import ThreadPanel from './ThreadPanel';
import VesselThreadPanel from './VesselThreadPanel';
import '../styles/Reports.css';

export default function ReportViewerModal({ report, role, onClose, focusPane }) {
  // When opened from a mention notification (focusPane="thread"), collapse
  // the document pane so the conversation is immediately visible full-width
  // instead of landing on the default document view.
  const [isPdfCollapsed, setIsPdfCollapsed] = useState(focusPane === 'thread');
  const [isChatCollapsed, setIsChatCollapsed] = useState(false);

  if (!report) return null;

  return (
    <div className="rt-modal-backdrop" onClick={onClose}>
      <div 
        className="rt-modal-container"
        onClick={e => e.stopPropagation()}
      >
        <div className="rt-modal-header">
          <div className="rt-modal-title-group">
            <h2 className="rt-modal-title">{report.report_name}</h2>
            <span className="rt-modal-subtitle">{report.job_order_no || report.report_code}</span>
          </div>

          <div className="rt-modal-controls">
            <button className="rt-modal-close" onClick={onClose}>
              <X size={18} />
            </button>
          </div>
        </div>

        <div className="rt-modal-body">
          {/* LEFT: Attachments */}
          <div className={`rt-modal-pane rt-pane-pdf ${isPdfCollapsed ? 'collapsed' : ''}`}>
            <AttachmentsPanel 
              reportId={report.id}
              reportName={report.report_name}
              attachments={report.attachments}
              isCollapsed={isPdfCollapsed}
              onToggle={() => {
                if (isPdfCollapsed) setIsPdfCollapsed(false);
                else {
                  setIsPdfCollapsed(true);
                  setIsChatCollapsed(false); // Ensure both are not collapsed
                }
              }}
            />
          </div>

          {/* RIGHT: Thread */}
          <div className={`rt-modal-pane rt-pane-chat ${isChatCollapsed ? 'collapsed' : ''}`}>
            {role === 'VESSEL' ? (
              <VesselThreadPanel 
                reportId={report.id} 
                reportName={report.report_name} 
                reportMeta={report}
                isCollapsed={isChatCollapsed}
                onToggle={() => {
                  if (isChatCollapsed) setIsChatCollapsed(false);
                  else {
                    setIsChatCollapsed(true);
                    setIsPdfCollapsed(false); // Ensure both are not collapsed
                  }
                }} 
              />
            ) : (
              <ThreadPanel 
                reportId={report.id} 
                reportName={report.report_name} 
                reportMeta={report} 
                isCollapsed={isChatCollapsed}
                onToggle={() => {
                  if (isChatCollapsed) setIsChatCollapsed(false);
                  else {
                    setIsChatCollapsed(true);
                    setIsPdfCollapsed(false); // Ensure both are not collapsed
                  }
                }}
              />
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

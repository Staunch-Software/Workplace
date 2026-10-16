import React, { useEffect } from 'react';
import { X } from 'lucide-react';
import './kanban.css';

const VesselFeedDrawer = ({ title, onClose, children }) => {
  useEffect(() => {
    const onKey = (e) => {
      if (e.key === 'Escape' && !document.querySelector('.feed-modal-overlay')) onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  return (
    <div className="kanban-feed-drawer" onClick={onClose}>
      <div className="kanban-feed-drawer__panel" onClick={(e) => e.stopPropagation()}>
        <div className="kanban-feed-drawer__head">
          <span>{title}</span>
          <button type="button" className="kanban-feed-drawer__close" onClick={onClose} title="Close">
            <X size={18} />
          </button>
        </div>
        <div className="kanban-feed-drawer__body">{children}</div>
      </div>
    </div>
  );
};

export default VesselFeedDrawer;

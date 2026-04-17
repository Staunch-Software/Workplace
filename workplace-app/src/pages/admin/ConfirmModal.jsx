import React from "react";
import { AlertTriangle } from "lucide-react";
import "./AdminPanel.css";

export default function ConfirmModal({ isOpen, title, message, onConfirm, onCancel, loading }) {
  if (!isOpen) return null;
  return (
    <div className="ap-confirm-backdrop" onClick={onCancel}>
      <div className="ap-confirm-modal" onClick={e => e.stopPropagation()}>
        <div className="ap-confirm-icon">
          <AlertTriangle size={36} color="#ef4444" />
        </div>
        <h3 className="ap-confirm-title">{title}</h3>
        <p className="ap-confirm-message">{message}</p>
        <div className="ap-confirm-actions">
          <button className="ap-btn ap-btn-secondary" onClick={onCancel} disabled={loading}>
            Cancel
          </button>
          <button className="ap-btn ap-btn-danger" onClick={onConfirm} disabled={loading}>
            {loading ? "Deleting..." : "Delete"}
          </button>
        </div>
      </div>
    </div>
  );
}

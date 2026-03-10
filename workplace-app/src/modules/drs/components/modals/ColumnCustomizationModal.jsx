import React, { useState, useEffect } from 'react';
// import { X, Columns, Check, RotateCcw, Save, Eye, EyeOff } from 'lucide-react';
// ✅ FIXED - All imports included
import { X, Columns, Check, RotateCcw, Save, Eye, EyeOff, Info, AlertTriangle } from 'lucide-react';
import './ColumnCustomizationModal.css';

/**
 * 🎨 Enhanced Column Customization Modal
 * Allows users to select which columns they want to see in the vessel dashboard
 * with improved UI/UX and visual feedback
 */
const ColumnCustomizationModal = ({ 
  isOpen, 
  onClose, 
  currentColumns, 
  onSave,
  availableColumns = [] // 🔥 CRITICAL: Receive available columns from parent
}) => {
  const [selectedColumns, setSelectedColumns] = useState(currentColumns);
  const [isSaving, setIsSaving] = useState(false);
  const [hasChanges, setHasChanges] = useState(false);

  // Update local state when modal opens with new currentColumns
  useEffect(() => {
    if (isOpen) {
      setSelectedColumns([...currentColumns]);
      setHasChanges(false);
    }
  }, [isOpen, currentColumns]);

  // Check for changes
useEffect(() => {
  const columnsChanged =
    selectedColumns.length !== currentColumns.length ||
    selectedColumns.some((col, index) => col !== currentColumns[index]);

  setHasChanges(columnsChanged);
}, [selectedColumns, currentColumns]);


  const toggleColumn = (columnId) => {
    setSelectedColumns(prev => {
      if (prev.includes(columnId)) {
        // Don't allow deselecting if it's the last column
        if (prev.length === 1) {
          return prev;
        }
        return prev.filter(id => id !== columnId);
      } else {
        return [...prev, columnId];
      }
    });
  };

  const handleSelectAll = () => {
    const allColumnIds = availableColumns.map(col => col.id);
    setSelectedColumns(allColumnIds);
  };

  const handleDeselectAll = () => {
    // Keep at least one column (first column)
    if (availableColumns.length > 0) {
      setSelectedColumns([availableColumns[0].id]);
    }
  };

  const handleSave = async () => {
    if (selectedColumns.length === 0) {
      alert('Please select at least one column');
      return;
    }

    setIsSaving(true);
    try {
      await onSave(selectedColumns);
      onClose();
    } catch (error) {
      console.error('Failed to save column preferences:', error);
      alert('Failed to save preferences. Please try again.');
    } finally {
      setIsSaving(false);
    }
  };

  const handleReset = () => {
    // Reset to all columns visible
    const allColumnIds = availableColumns.map(col => col.id);
    setSelectedColumns(allColumnIds);
  };

  if (!isOpen) return null;

  // 🎯 Categorize columns for better organization
  const coreColumns = availableColumns.filter(col => 
    ['date', 'deadline', 'source', 'equipment', 'description'].includes(col.id)
  );
  
  const iconColumns = availableColumns.filter(col => 
    ['priority', 'status', 'deadline_icon', 'chat'].includes(col.id)
  );
  
  const otherColumns = availableColumns.filter(col => 
    !['date', 'deadline', 'source', 'equipment', 'description', 'priority', 'status', 'deadline_icon', 'chat'].includes(col.id)
  );

  const renderColumnGroup = (title, columns, icon) => {
    if (columns.length === 0) return null;

    return (
      <div className="column-group">
        <div className="column-group-header">
          {icon}
          <h3>{title}</h3>
          <span className="group-count">{columns.filter(col => selectedColumns.includes(col.id)).length}/{columns.length}</span>
        </div>
        <div className="column-group-items">
          {columns.map(column => {
            const isSelected = selectedColumns.includes(column.id);
            const isLastSelected = selectedColumns.length === 1 && isSelected;

            return (
              <div 
                key={column.id}
                className={`column-item ${isSelected ? 'selected' : ''} ${isLastSelected ? 'disabled' : ''}`}
                onClick={() => !isLastSelected && toggleColumn(column.id)}
              >
                <div className="column-checkbox">
                  <div className={`custom-checkbox ${isSelected ? 'checked' : ''} ${isLastSelected ? 'disabled' : ''}`}>
                    {isSelected && <Check size={14} />}
                  </div>
                  <label htmlFor={`column-${column.id}`}>
                    <div className="column-info">
                      <span className="column-label">{column.label}</span>
                      <span className="column-description">{column.description}</span>
                    </div>
                  </label>
                </div>
                <div className="column-status">
                  {isSelected ? (
                    <Eye size={16} className="status-icon visible" />
                  ) : (
                    <EyeOff size={16} className="status-icon hidden" />
                  )}
                </div>
              </div>
            );
          })}
        </div>
      </div>
    );
  };

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal-content column-customization-modal" onClick={(e) => e.stopPropagation()}>
        {/* 🎨 Enhanced Header */}
        <div className="modal-header" style={{padding:'10px'}}>
          <div className="modal-title-wrapper">
            <div className="title-icon-wrapper">
              <Columns size={28} />
            </div>
            <div className="title-text">
              <h2>Customize Table Columns</h2>
              <p className="subtitle">Choose which columns to display in your dashboard</p>
            </div>
          </div>
          <button className="close-btn" onClick={onClose} aria-label="Close modal">
            <X size={22} />
          </button>
        </div>

        {/* 🎨 Enhanced Info Banner */}
        <div className="modal-info">
          <Info size={18} />
          <div className="info-content">
            <p><strong>Note:</strong> S.NO and Delete columns are always visible and cannot be hidden.</p>
            <p className="info-hint">Your preferences will be saved automatically for future sessions.</p>
          </div>
        </div>

        {/* 🎨 Quick Actions Bar */}
        <div className="quick-actions">
          <button 
            className="quick-action-btn"
            onClick={handleSelectAll}
            disabled={isSaving || selectedColumns.length === availableColumns.length}
          >
            <Check size={16} />
            Select All
          </button>
          <button 
            className="quick-action-btn"
            onClick={handleDeselectAll}
            disabled={isSaving || selectedColumns.length === 1}
          >
            <X size={16} />
            Deselect All
          </button>
          <button 
            className="quick-action-btn"
            onClick={handleReset}
            disabled={isSaving || selectedColumns.length === availableColumns.length}
          >
            <RotateCcw size={16} />
            Reset
          </button>
        </div>

        {/* 🎨 Enhanced Column Selection List with Categories */}
        <div className="columns-list">
          {renderColumnGroup(
            "Core Information", 
            coreColumns,
            <Columns size={18} className="group-icon" />
          )}
          
          {renderColumnGroup(
            "Status Icons", 
            iconColumns,
            <Eye size={18} className="group-icon" />
          )}
          
          {renderColumnGroup(
            "Additional Details", 
            otherColumns,
            <Columns size={18} className="group-icon" />
          )}
        </div>

        {/* 🎨 Enhanced Selection Summary */}
        <div className="selection-summary">
          <div className="summary-left">
            <div className="summary-badge">
              {selectedColumns.length} / {availableColumns.length}
            </div>
            <span className="summary-text">columns selected</span>
          </div>
          {selectedColumns.length === 1 && (
            <div className="warning-badge">
              <AlertTriangle size={14} />
              <span>At least one column must be visible</span>
            </div>
          )}
          {hasChanges && (
            <div className="changes-badge">
              <Check size={14} />
              <span>Unsaved changes</span>
            </div>
          )}
        </div>

        {/* 🎨 Enhanced Footer Actions */}
        <div className="modal-footer">
          <button 
            className="btn btn-secondary" 
            onClick={onClose}
            disabled={isSaving}
          >
            <X size={18} />
            Cancel
          </button>
          <div className="footer-actions-right">
            <button 
              className="btn btn-primary" 
              onClick={handleSave}
              disabled={isSaving || selectedColumns.length === 0 || !hasChanges}
            >
              <Save size={18} />
              {isSaving ? 'Saving...' : hasChanges ? 'Save Changes' : 'No Changes'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};

export default ColumnCustomizationModal;

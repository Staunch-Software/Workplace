import React, { useState, useEffect, useMemo, useRef } from 'react';
import { defectApi } from '../../services/defectApi';
import { getDefectSourceLabel, formatDate, toLocalDateInput } from './constants'
import {
  SortableContext,
  useSortable,
} from '@dnd-kit/sortable';

import {
  Filter,
  ArrowUpDown,
  ArrowRightLeft,
  X,
  Check,
  Edit3,
  Trash2
} from 'lucide-react';


// Filter Header Component
export const FilterHeader = ({
  label,
  field,
  currentFilter,
  currentFilterSort,
  onFilterChange,
  type = 'text',
  options = [],
  width,
  onResize,
  onSort,
  sortState
}) => {


  const [isOpen, setIsOpen] = useState(false);
  const [tempRange, setTempRange] = useState(currentFilter || { from: '', to: '' });
  const [tempDate, setTempDate] = useState(currentFilter || '');
  const filterRef = useRef(null);
  const isActive =
    type === 'date-range'
      ? !!currentFilter?.from || !!currentFilter?.to
      : Array.isArray(currentFilter)
        ? currentFilter.length > 0
        : !!currentFilter;

  useEffect(() => {
    const handleClickOutside = (e) => {
      if (!filterRef.current?.contains(e.target)) {
        setIsOpen(false);
      }
    };

    if (isOpen) {
      if (type === 'date-range') {
        setTempRange(currentFilter || { from: '', to: '' });
      }

      if (type === 'date') {
        setTempDate(currentFilter || '');
      }

      document.addEventListener('mousedown', handleClickOutside);
    }

    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
    };
  }, [isOpen, currentFilter, type]);



  return (
    <div
      className="filter-header"
      style={{
        position: 'relative'
      }}
    >
      <div className="header-content">
        <span
          onClick={(e) => { e.stopPropagation(); onSort && onSort(); }}
          title={
            !onSort ? undefined
              : sortState === 'asc' ? 'Sorted A → Z (click for Z → A)'
                : sortState === 'desc' ? 'Sorted Z → A (click to clear)'
                  : 'Click to sort A → Z'
          }
          style={{
            cursor: onSort ? 'pointer' : 'default',
            textDecorationLine: sortState ? 'underline' : 'none',
            textDecorationStyle: sortState ? 'dotted' : 'none',
            textUnderlineOffset: '2px'
          }}
        >
          {label}
        </span>
        <div className="filter-wrapper" style={{ position: 'relative' }} ref={filterRef}>
          <Filter
            size={18}
            className={`filter-icon ${isActive ? 'active' : ''}`}
            onClick={(e) => { e.stopPropagation(); setIsOpen(!isOpen); }}
          />
          {isOpen && (
            <div
              className={`filter-popover ${type === 'date-range' ? 'date-range' : ''}`}
              onClick={(e) => e.stopPropagation()}
            >
              {type === 'text' && (
                <input
                  autoFocus
                  type="text"
                  placeholder={`Filter ${label}...`}
                  value={currentFilter || ''}
                  onChange={(e) => onFilterChange(field, e.target.value)}
                />
              )}
              {/* {type === 'select' && (
                <select
                  value={currentFilter || ''}
                  onChange={(e) => {
                    onFilterChange(field, e.target.value === 'ALL' ? '' : e.target.value);
                    setIsOpen(false);
                  }}
                >
                  <option value="ALL">All</option>
                  {options.map(opt => (
                    <option key={opt} value={opt}>{opt}</option>
                  ))}
                </select>
              )} */}
              {type === 'select' && (
                <select
                  value={currentFilter || ''}
                  onChange={(e) => {
                    onFilterChange(field, e.target.value === 'ALL' ? '' : e.target.value);
                    setIsOpen(false);
                  }}
                >
                  <option value="ALL">All</option>
                  {options.map(opt => {
                    // Handle both string arrays and object arrays
                    const val = typeof opt === 'object' ? opt.value : opt;
                    const label = typeof opt === 'object' ? opt.label : opt;
                    return (
                      <option key={val} value={val}>
                        {label}
                      </option>
                    );
                  })}
                </select>
              )}
              {type === 'date' && (
                <>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                    <input
                      type="date"
                      value={tempDate}
                      onChange={(e) => setTempDate(e.target.value)}
                    />

                    {/* SORT TOGGLE */}
                    {/* <button
                      onClick={() => {
                        const next =
                          currentFilterSort === 'asc'
                            ? 'desc'
                            : currentFilterSort === 'desc'
                              ? ''
                              : 'asc';

                        onFilterChange(`${field}_sort`, next);
                      }}
                      style={{
                        border: 'none',
                        background: 'transparent',
                        cursor: 'pointer',
                        padding: '4px',
                        color: currentFilterSort ? '#ea580c' : '#94a3b8'
                      }}
                    >
                      <ArrowUpDown size={16} />
                    </button> */}
                  </div>

                  {/* ACTIONS */}
                  <div
                    style={{
                      display: 'flex',
                      justifyContent: 'space-between',
                      marginTop: '10px'
                    }}
                  >
                    {/* CLEAR */}
                    <button
                      onClick={() => {
                        setTempDate('');
                        onFilterChange(field, '');
                        setIsOpen(false);
                      }}
                      style={{
                        background: 'transparent',
                        border: 'none',
                        color: '#ea580c',
                        fontSize: '11px',
                        fontWeight: 600,
                        cursor: 'pointer'
                      }}
                    >
                      Clear
                    </button>

                    {/* DONE */}
                    <button
                      onClick={() => {
                        onFilterChange(field, tempDate);
                        setIsOpen(false);
                      }}
                      disabled={!tempDate}
                      style={{
                        background: '#ea580c',
                        color: 'white',
                        border: 'none',
                        borderRadius: '4px',
                        padding: '4px 10px',
                        fontSize: '11px',
                        fontWeight: 600,
                        opacity: !tempDate ? 0.6 : 1,
                        cursor: 'pointer'
                      }}
                    >
                      Done
                    </button>
                  </div>
                </>
              )}

              {type === 'date-range' && (
                <>
                  <div
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      gap: '8px'
                    }}
                  >
                    {/* FROM */}
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '2px' }}>
                      <label style={{ fontSize: '10px', fontWeight: 600 }}>From</label>
                      <input
                        type="date"
                        value={tempRange.from}
                        onChange={(e) =>
                          setTempRange(prev => ({ ...prev, from: e.target.value }))
                        }
                        style={{ fontSize: '12px' }}
                      />
                    </div>

                    {/* TO */}
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '2px' }}>
                      <label style={{ fontSize: '10px', fontWeight: 600 }}>To</label>
                      <input
                        type="date"
                        value={tempRange.to}
                        min={tempRange.from}
                        onChange={(e) =>
                          setTempRange(prev => ({ ...prev, to: e.target.value }))
                        }
                        style={{ fontSize: '12px' }}
                      />
                    </div>

                    {/* SORT ICON (between inputs) */}
                    {/* <button
                      onClick={() => {
                        const next =
                          currentFilterSort === 'asc'
                            ? 'desc'
                            : currentFilterSort === 'desc'
                              ? ''
                              : 'asc';

                        onFilterChange(`${field}_sort`, next);
                      }}
                      title="Toggle sort order"
                      style={{
                        border: 'none',
                        background: 'transparent',
                        cursor: 'pointer',
                        paddingTop: '25px', // aligns icon vertically with inputs
                        color:
                          currentFilterSort === 'asc'
                            ? '#16a34a'
                            : currentFilterSort === 'desc'
                              ? '#dc2626'
                              : '#94a3b8'
                      }}
                    >
                      <ArrowUpDown size={16} />
                    </button> */}
                  </div>
                  <div
                    style={{
                      display: 'flex',
                      justifyContent: 'space-between',
                      marginTop: '10px'
                    }}
                  >
                    {/* CLEAR */}
                    <button
                      onClick={() => {
                        setTempRange({ from: '', to: '' });
                        onFilterChange(field, { from: '', to: '' });
                        setIsOpen(false);
                      }}
                      style={{
                        background: 'transparent',
                        border: 'none',
                        color: '#ea580c',
                        fontSize: '11px',
                        fontWeight: 600,
                        cursor: 'pointer'
                      }}
                    >
                      Clear
                    </button>

                    {/* DONE */}
                    <button
                      onClick={() => {
                        onFilterChange(field, tempRange); // ✅ APPLY FILTER
                        setIsOpen(false);                 // ✅ CLOSE CARD
                      }}
                      disabled={!tempRange.from && !tempRange.to}
                      style={{
                        background: '#ea580c',
                        color: 'white',
                        border: 'none',
                        borderRadius: '4px',
                        padding: '4px 10px',
                        fontSize: '11px',
                        fontWeight: 600,
                        cursor: 'pointer',
                        opacity: (!tempRange.from && !tempRange.to) ? 0.6 : 1
                      }}
                    >
                      Done
                    </button>
                  </div>
                </>

              )}


              {type !== 'date-range' && type !== 'date' && (
                <div
                  style={{ textAlign: 'right', fontSize: '11px', color: '#ea580c', cursor: 'pointer' }}
                  onClick={() => {
                    onFilterChange(field, '');
                    setIsOpen(false);
                  }}
                >
                  Clear
                </div>
              )}

            </div>
          )}
        </div>
      </div>
      {/* {onResize && (
        <div
          onMouseDown={(e) => {
            e.stopPropagation();
            onResize(e, field);
          }}
          className="col-resizer"
        />

      )} */}

    </div>
  );
};

export const PrManagerPopover = ({ defect, onClose, onRefresh }) => {
  const [isAdding, setIsAdding] = useState(false);
  const [editingId, setEditingId] = useState(null);
  const [inputValue, setInputValue] = useState('');
  const popoverRef = useRef(null);

  // Close on click outside
  useEffect(() => {
    const handleClick = (e) => {
      if (popoverRef.current && !popoverRef.current.contains(e.target)) onClose();
    };
    document.addEventListener('mousedown', handleClick);
    return () => document.removeEventListener('mousedown', handleClick);
  }, [onClose]);

  const handleAdd = async () => {
    if (!inputValue.trim()) return;
    try {
      // Assuming defectApi has a method to add PR or update defect entries
      await defectApi.createPrEntry({ defect_id: defect.id, pr_number: inputValue });

      setInputValue('');
      setIsAdding(false);
      onRefresh();
    } catch (err) { alert(err.message); }
  };

  const handleUpdate = async (prId) => {
    if (!inputValue.trim()) return;
    try {
      await defectApi.updatePrEntry(prId, { pr_number: inputValue });
      setEditingId(null);
      setInputValue('');
      onRefresh();
    } catch (err) { alert(err.message); }
  };

  const [deletingId, setDeletingId] = useState(null);

  const handleDelete = async (prId) => {
    if (!window.confirm("Delete this PR number?")) return;
    if (deletingId) return;

    setDeletingId(prId);
    try {
      await defectApi.deletePrEntry(prId);
      onRefresh();
    } finally {
      setDeletingId(null);
    }
  };


  return (
    <div ref={popoverRef} className="filter-popover pr-no" style={{ width: '220px', padding: '12px', zIndex: 1000 }}>
      <div style={{ fontWeight: '700', fontSize: '12px', marginBottom: '10px', color: '#1e293b', display: 'flex', justifyContent: 'flex-end' }}>
        <X
          size={14}
          style={{ cursor: 'pointer' }}
          onMouseDown={(e) => {
            e.stopPropagation();
            onClose();
          }}
        />

      </div>

      <div style={{ display: 'flex', flexDirection: 'column', gap: '8px', maxHeight: '200px', overflowY: 'auto', marginBottom: '10px' }}>
        {defect.pr_entries?.filter(p => !p.is_deleted).map(pr => (
          <div key={pr.id} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', background: '#f8fafc', padding: '6px 8px', borderRadius: '4px', border: '1px solid #e2e8f0' }}>
            {editingId === pr.id ? (
              <input
                autoFocus
                className="ghost-input"
                value={inputValue}
                onChange={(e) => setInputValue(e.target.value)}
                style={{ width: '100px' }}
              />
            ) : (
              <span style={{ fontSize: '12px', fontWeight: '600' }}>{pr.pr_number}</span>
            )}

            <div style={{ display: 'flex', gap: '6px' }}>
              {editingId === pr.id ? (
                <>
                  {/* SAVE BUTTON */}
                  <button
                    onClick={() => handleUpdate(pr.id)}
                    title="Save PR number" // 👈 Tooltip text
                    style={{
                      background: 'none',
                      border: 'none',
                      padding: '2px',
                      cursor: 'pointer',
                      display: 'flex',
                      alignItems: 'center'
                    }}
                  >
                    <Check size={14} color="#10b981" />
                  </button>

                  {/* CANCEL BUTTON */}
                  <button
                    onClick={() => {
                      setEditingId(null);
                      setInputValue('');
                    }}
                    title="Cancel editing" // 👈 Tooltip text
                    style={{
                      background: 'none',
                      border: 'none',
                      padding: '2px',
                      cursor: 'pointer',
                      display: 'flex',
                      alignItems: 'center'
                    }}
                  >
                    <X size={14} color="#ef4444" />
                  </button>
                </>
              ) : (
                <>
                  {/* EDIT BUTTON */}
                  <button
                    onClick={() => {
                      setEditingId(pr.id);
                      setInputValue(pr.pr_number);
                    }}
                    title="Edit this PR" // 👈 Tooltip text
                    style={{
                      background: 'none',
                      border: 'none',
                      padding: '2px',
                      cursor: 'pointer',
                      display: 'flex',
                      alignItems: 'center'
                    }}
                  >
                    <Edit3 size={14} color="#2b82fc" />
                  </button>

                  {/* DELETE BUTTON */}
                  <button
                    onClick={() => handleDelete(pr.id)}
                    title="Delete PR number" // 👈 Tooltip text
                    style={{
                      background: 'none',
                      border: 'none',
                      padding: '2px',
                      cursor: 'pointer',
                      display: 'flex',
                      alignItems: 'center'
                    }}
                  >
                    <Trash2 size={14} color="#ef4444" />
                  </button>
                </>
              )}
            </div>

          </div>
        ))}
      </div>

      {isAdding ? (
        <div style={{ display: 'flex', gap: '4px', alignItems: 'center', borderTop: '1px solid #e2e8f0', paddingTop: '10px' }}>
          <input
            autoFocus
            placeholder="PR Number"
            className="ghost-input"
            value={inputValue}
            onChange={(e) => setInputValue(e.target.value)}
          />
          <button title='Save' onClick={handleAdd} style={{ background: '#10b981', color: 'white', border: 'none', borderRadius: '4px', padding: '4px' }}><Check size={14} /></button>
          <button title='Delete' onClick={() => { setIsAdding(false); setInputValue(''); }} style={{ background: '#ef4444', color: 'white', border: 'none', borderRadius: '4px', padding: '4px' }}><X size={14} /></button>
        </div>
      ) : (
        <button
          onClick={() => setIsAdding(true)}
          style={{ width: '100%', padding: '6px', fontSize: '11px', fontWeight: '600', color: '#ea580c', background: '#fff7ed', border: '1px dashed #ea580c', borderRadius: '4px', cursor: 'pointer' }}
        >
          + Add PR Number
        </button>
      )}
    </div>
  );
};


export function EquipmentFilter({
  label,
  options = [],           // ✅ default
  selectedValues = [],    // ✅ default
  onChange,
  width,
  onResize,
  onSort,
  sortState
}) {

  const [open, setOpen] = useState(false);
  const ref = useRef(null);

  useEffect(() => {
    const handleClick = (e) => {
      if (ref.current && !ref.current.contains(e.target)) {
        setOpen(false);
      }
    };
    document.addEventListener('mousedown', handleClick);
    return () => document.removeEventListener('mousedown', handleClick);
  }, []);

  const toggleValue = (value) => {
    if (selectedValues.includes(value)) {
      onChange(selectedValues.filter(v => v !== value));
    } else {
      onChange([...selectedValues, value]);
    }
  };

  return (
    <div
      className="filter-header"
      ref={ref}
      style={{
        width,
        position: 'relative'
      }}
    >
      <div className="header-content">
        <span
          onClick={(e) => { e.stopPropagation(); onSort && onSort(); }}
          title={
            !onSort ? undefined
              : sortState === 'asc' ? 'Sorted A → Z (click for Z → A)'
                : sortState === 'desc' ? 'Sorted Z → A (click to clear)'
                  : 'Click to sort A → Z'
          }
          style={{
            cursor: onSort ? 'pointer' : 'default',
            textDecorationLine: sortState ? 'underline' : 'none',
            textDecorationStyle: sortState ? 'dotted' : 'none',
            textUnderlineOffset: '2px'
          }}
        >
          {label}
          {selectedValues.length > 0 && (
            <span style={{ marginLeft: 4, color: '#ea580c', fontWeight: 600 }}>
              ({selectedValues.length})
            </span>
          )}
        </span>

        <div className="filter-wrapper" style={{ position: 'relative' }}>
          <Filter
            size={18}
            className={`filter-icon ${selectedValues.length ? 'active' : ''}`}
            onClick={(e) => {
              e.stopPropagation();
              setOpen(!open);
            }}
          />

          {open && (
            <div
              style={{
                position: 'absolute',
                top: '120%',
                left: '50%',
                transform: 'translateX(-50%)',
                background: '#fff',
                border: '1px solid #e5e7eb',
                borderRadius: 8,
                padding: 10,
                zIndex: 100,
                minWidth: 220,
                maxHeight: 260,
                overflowY: 'auto',
                boxShadow: '0 8px 24px rgba(0,0,0,0.15)'
              }}
              onClick={(e) => e.stopPropagation()}
            >
              {options.map(opt => (
                <label
                  key={opt}
                  style={{
                    display: 'flex',
                    gap: 8,
                    fontSize: 12,
                    cursor: 'pointer',
                    padding: '4px 0'
                  }}
                >
                  <input
                    type="checkbox"
                    checked={selectedValues.includes(opt)}
                    onChange={() => toggleValue(opt)}
                  />
                  {opt}
                </label>
              ))}

              {selectedValues.length > 0 && (
                <div
                  style={{
                    marginTop: 8,
                    textAlign: 'right',
                    fontSize: 11,
                    fontWeight: 600,
                    color: '#ea580c',
                    cursor: 'pointer'
                  }}
                  onClick={() => onChange([])}
                >
                  Clear
                </div>
              )}
            </div>
          )}
        </div>
      </div>


    </div>
  );
}

export function DefectSourceFilter({
  label,
  options,
  selectedValues,
  onChange,
  width,
  onResize,
  onSort,
  sortState
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef(null);

  useEffect(() => {
    const handleClick = (e) => {
      if (ref.current && !ref.current.contains(e.target)) {
        setOpen(false);
      }
    };
    document.addEventListener('mousedown', handleClick);
    return () => document.removeEventListener('mousedown', handleClick);
  }, []);

  const toggleValue = (value) => {
    if (selectedValues.includes(value)) {
      onChange(selectedValues.filter(v => v !== value));
    } else {
      onChange([...selectedValues, value]);
    }
  };

  return (
    <div className="filter-header" ref={ref} style={{ width, position: 'relative' }}>
      <div className="header-content">
        <span
          onClick={(e) => { e.stopPropagation(); onSort && onSort(); }}
          title={
            !onSort ? undefined
              : sortState === 'asc' ? 'Sorted A → Z (click for Z → A)'
                : sortState === 'desc' ? 'Sorted Z → A (click to clear)'
                  : 'Click to sort A → Z'
          }
          style={{
            cursor: onSort ? 'pointer' : 'default',
            textDecorationLine: sortState ? 'underline' : 'none',
            textDecorationStyle: sortState ? 'dotted' : 'none',
            textUnderlineOffset: '2px'
          }}
        >
          {label}
          {selectedValues.length > 0 && (
            <span style={{ marginLeft: 4, color: '#ea580c', fontWeight: 600 }}>
              ({selectedValues.length})
            </span>
          )}
        </span>

        <div className="filter-wrapper">
          <Filter
            size={18}
            className={`filter-icon ${selectedValues.length ? 'active' : ''}`}
            onClick={(e) => {
              e.stopPropagation();
              setOpen(!open);
            }}
          />

          {open && (
            <div
              style={{
                position: 'absolute',
                top: '120%',
                left: '50%',
                transform: 'translateX(-50%)',
                background: '#fff',
                border: '1px solid #e5e7eb',
                borderRadius: 8,
                padding: 10,
                zIndex: 100,
                minWidth: 240,
                maxHeight: 260,
                overflowY: 'auto',
                boxShadow: '0 8px 24px rgba(0,0,0,0.15)'
              }}
              onClick={(e) => e.stopPropagation()}
            >
              {options.map(opt => (
                <label
                  key={opt}
                  style={{
                    display: 'flex',
                    gap: 8,
                    fontSize: 12,
                    cursor: 'pointer',
                    padding: '4px 0'
                  }}
                >
                  <input
                    type="checkbox"
                    checked={selectedValues.includes(opt)}
                    onChange={() => toggleValue(opt)}
                  />
                  {getDefectSourceLabel(opt)}
                </label>
              ))}

              {selectedValues.length > 0 && (
                <div
                  style={{
                    marginTop: 8,
                    textAlign: 'right',
                    fontSize: 11,
                    fontWeight: 600,
                    color: '#ea580c',
                    cursor: 'pointer'
                  }}
                  onClick={() => onChange([])}
                >
                  Clear
                </div>
              )}
            </div>
          )}
        </div>
      </div>

      {/* {onResize && (
        <div
          className="col-resizer"
          onMouseDown={(e) => {
            e.stopPropagation();
            onResize(e, 'defect_source');
          }}
        />
      )} */}

    </div>
  );
}

export const FloatingSelectWithIcon = ({
  icon,
  value,
  options,
  iconRenderer,
  onChange,
  disabled
}) => {
  const [open, setOpen] = useState(false);
  const ref = useRef(null);

  useEffect(() => {
    const close = (e) => {
      if (ref.current && !ref.current.contains(e.target)) setOpen(false);
    };
    document.addEventListener('mousedown', close);
    return () => document.removeEventListener('mousedown', close);
  }, []);

  return (
    <div ref={ref} style={{ position: 'relative', display: 'inline-flex' }}>
      {/* ICON ONLY (NORMAL + EDIT MODE) */}
      <span
        onClick={() => !disabled && setOpen(!open)}
        style={{
          cursor: disabled ? 'not-allowed' : 'pointer',
          display: 'inline-flex',
          alignItems: 'center'
        }}
        title={value}
      >
        {icon}
      </span>

      {/* FLOATING SELECT (ICON + NAME) */}
      {open && !disabled && (
        <div
          style={{
            position: 'absolute',
            top: '120%',
            left: '50%',
            transform: 'translateX(-50%)',
            background: 'white',
            border: '1px solid #e2e8f0',
            borderRadius: '6px',
            boxShadow: '0 8px 24px rgba(0,0,0,0.2)',
            zIndex: 1000,
            minWidth: '140px'
          }}
        >
          {options.map(opt => (
            <div
              key={opt}
              onClick={() => {
                onChange(opt);
                setOpen(false);
              }}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: '8px',
                padding: '8px 12px',
                fontSize: '12px',
                cursor: 'pointer',
                fontWeight: opt === value ? 700 : 500
              }}
              onMouseEnter={e => e.currentTarget.style.background = '#f1f5f9'}
              onMouseLeave={e => e.currentTarget.style.background = 'white'}
            >
              {iconRenderer(opt)}
              <span>{opt}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
};

export const InlineDateEdit = ({ value, min, onSave, disabled }) => {
  const inputRef = useRef(null);

  const openPicker = () => {
    if (disabled) return;
    if (!inputRef.current) return;

    // Chrome / Edge
    if (inputRef.current.showPicker) {
      inputRef.current.showPicker();
    } else {
      // Fallback
      inputRef.current.click();
    }
  };

  return (
    <>
      {/* DISPLAY TEXT */}
      <span
        onClick={openPicker}
        title="Click to edit date"
        style={{
          cursor: disabled ? 'default' : 'pointer',
          fontSize: '13px',
          borderBottom: !disabled ? '1px dashed #cbd5e1' : 'none',
          paddingBottom: '1px',
          display: 'inline-block'
        }}
      >
        {formatDate(value)}
      </span>

      {/* HIDDEN DATE INPUT */}
      <input
        ref={inputRef}
        type="date"
        value={toLocalDateInput(value)}
        min={min}
        onChange={(e) => onSave(e.target.value)}
        disabled={disabled}
        style={{
          position: 'absolute',
          opacity: 0,
          pointerEvents: 'none',
          width: 0,
          height: 0
        }}
      />
    </>
  );
};

export const FloatingSelectText = ({
  value,
  options,
  onChange,
  disabled = false,
  width = '100%'
}) => {
  const [open, setOpen] = useState(false);
  const ref = useRef(null);

  useEffect(() => {
    const close = (e) => {
      if (ref.current && !ref.current.contains(e.target)) {
        setOpen(false);
      }
    };
    document.addEventListener('mousedown', close);
    return () => document.removeEventListener('mousedown', close);
  }, []);

  return (
    <div
      ref={ref}
      style={{
        position: 'relative',
        display: 'inline-block',
        width
      }}
    >
      {/* DISPLAY TEXT */}
      <span
        onClick={() => !disabled && setOpen(!open)}
        title={value}
        style={{
          cursor: disabled ? 'default' : 'pointer',
          fontSize: '13px',
          whiteSpace: 'nowrap',
          overflow: 'hidden',
          textOverflow: 'ellipsis',
          display: 'inline-block',
          maxWidth: '100%',
          borderBottom: !disabled ? '1px dashed #cbd5e1' : 'none'
        }}
      >
        {getDefectSourceLabel(value) || '—'}
      </span>

      {/* FLOATING DROPDOWN */}
      {open && !disabled && (
        <div
          style={{
            position: 'absolute',
            top: '120%',
            left: 0,
            background: 'white',
            border: '1px solid #e2e8f0',
            borderRadius: '6px',
            boxShadow: '0 8px 24px rgba(0,0,0,0.15)',
            zIndex: 1000,
            minWidth: '220px',
            maxHeight: '260px',
            overflowY: 'auto'
          }}
        >
          {options.map(opt => (
            <div
              key={opt}
              onClick={() => {
                onChange(opt);
                setOpen(false);
              }}
              style={{
                padding: '8px 12px',
                fontSize: '12px',
                cursor: 'pointer',
                fontWeight: opt === value ? 700 : 500
              }}
              onMouseEnter={e => e.currentTarget.style.background = '#f1f5f9'}
              onMouseLeave={e => e.currentTarget.style.background = 'white'}
            >
              {getDefectSourceLabel(opt)}
            </div>
          ))}
        </div>
      )}
    </div>
  );
};


export const OwnerFloatingSelectWithIcon = ({
  icon,
  value,
  options,
  iconRenderer,
  labelRenderer, // Added this prop
  onChange,
  disabled
}) => {
  const [open, setOpen] = useState(false);
  const ref = useRef(null);

  useEffect(() => {
    const close = (e) => {
      if (ref.current && !ref.current.contains(e.target)) setOpen(false);
    };
    document.addEventListener('mousedown', close);
    return () => document.removeEventListener('mousedown', close);
  }, []);

  return (
    <div ref={ref} style={{ position: 'relative', display: 'inline-flex' }}>
      <span
        onClick={() => !disabled && setOpen(!open)}
        style={{
          cursor: disabled ? 'not-allowed' : 'pointer',
          display: 'inline-flex',
          alignItems: 'center'
        }}
        // Convert boolean to string for the title attribute
        title={typeof value === 'boolean' ? (value ? 'Owner' : 'Not Owner') : value}
      >
        {icon}
      </span>

      {open && !disabled && (
        <div
          style={{
            position: 'absolute',
            top: '120%',
            left: '50%',
            transform: 'translateX(-50%)',
            background: 'white',
            border: '1px solid #e2e8f0',
            borderRadius: '6px',
            boxShadow: '0 8px 24px rgba(0,0,0,0.2)',
            zIndex: 1000,
            minWidth: '140px'
          }}
        >
          {options.map(opt => (
            <div
              key={opt.toString()} // Ensure key is a string
              onClick={() => {
                onChange(opt);
                setOpen(false);
              }}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: '8px',
                padding: '8px 12px',
                fontSize: '12px',
                cursor: 'pointer',
                background: opt === value ? '#f8fafc' : 'white',
                fontWeight: opt === value ? 700 : 500,
                color: '#334155'
              }}
              onMouseEnter={e => e.currentTarget.style.background = '#f1f5f9'}
              onMouseLeave={e => e.currentTarget.style.background = opt === value ? '#f8fafc' : 'white'}
            >
              {iconRenderer(opt)}
              {/* Use labelRenderer if provided, otherwise fallback to opt */}
              <span>{labelRenderer ? labelRenderer(opt) : opt}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
};

export function VesselFilter({
  label,
  vessels = [],          // [{ vessel_name, vessel_imo }]
  selectedValues = [],   // stores IMO values
  onChange,
  width,
  onSort,
  sortState,
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef(null);

  useEffect(() => {
    const handleClick = (e) => {
      if (ref.current && !ref.current.contains(e.target)) {
        setOpen(false);
      }
    };
    document.addEventListener('mousedown', handleClick);
    return () => document.removeEventListener('mousedown', handleClick);
  }, []);

  const toggleValue = (imo) => {
    if (selectedValues.includes(imo)) {
      onChange(selectedValues.filter(v => v !== imo));
    } else {
      onChange([...selectedValues, imo]);
    }
  };

  return (
    <div
      className="filter-header"
      ref={ref}
      style={{ width, position: 'relative' }}
    >
      <div className="header-content">
        <span
          onClick={(e) => { e.stopPropagation(); onSort && onSort(); }}
          title={
            !onSort ? undefined
              : sortState === 'asc' ? 'Sorted A → Z (click for Z → A)'
                : sortState === 'desc' ? 'Sorted Z → A (click to clear)'
                  : 'Click to sort A → Z'
          }
          style={{
            cursor: onSort ? 'pointer' : 'default',
            textDecorationLine: sortState ? 'underline' : 'none',
            textDecorationStyle: sortState ? 'dotted' : 'none',
            textUnderlineOffset: '2px'
          }}
        >
          {label}
          {selectedValues.length > 0 && (
            <span style={{ marginLeft: 4, color: '#ea580c', fontWeight: 600 }}>
              ({selectedValues.length})
            </span>
          )}
        </span>

        <div className="filter-wrapper" style={{ position: 'relative' }}>
          <Filter
            size={18}
            className={`filter-icon ${selectedValues.length ? 'active' : ''}`}
            onClick={(e) => {
              e.stopPropagation();
              setOpen(!open);
            }}
          />

          {open && (
            <div
              style={{
                position: 'absolute',
                top: '120%',
                left: '50%',
                transform: 'translateX(-50%)',
                background: '#fff',
                border: '1px solid #e5e7eb',
                borderRadius: 8,
                padding: 10,
                zIndex: 100,
                minWidth: 220,
                maxHeight: 260,
                overflowY: 'auto',
                boxShadow: '0 8px 24px rgba(0,0,0,0.15)'
              }}
              onClick={(e) => e.stopPropagation()}
            >
              {vessels.map(vessel => (
                <label
                  key={vessel.vessel_imo}
                  style={{
                    display: 'flex',
                    gap: 8,
                    fontSize: 12,
                    cursor: 'pointer',
                    padding: '4px 0'
                  }}
                >
                  <input
                    type="checkbox"
                    checked={selectedValues.includes(vessel.vessel_imo)}
                    onChange={() => toggleValue(vessel.vessel_imo)}
                  />
                  {vessel.vessel_name}
                </label>
              ))}

              {selectedValues.length > 0 && (
                <div
                  style={{
                    marginTop: 8,
                    textAlign: 'right',
                    fontSize: 11,
                    fontWeight: 600,
                    color: '#ea580c',
                    cursor: 'pointer'
                  }}
                  onClick={() => onChange([])}
                >
                  Clear
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

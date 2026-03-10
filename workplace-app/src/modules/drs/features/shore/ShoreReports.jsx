import React, { useState, useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { defectApi } from '@drs/services/defectApi';
import { useAuth } from '@/context/AuthContext';
import {
  Download,
  RefreshCw,
  Settings,
  X,
  Upload,
  FileUp,
  AlertCircle,
  CheckCircle,
  AlertTriangle,
  FileSpreadsheet
} from 'lucide-react';

import {
  FilterHeader,
  EquipmentFilter,
  DefectSourceFilter,
  VesselFilter
} from '@drs/components/shared/TableControls';
import {
  STATUS_OPTIONS,
  PRIORITY_OPTIONS,
  DEADLINE_STATUS_OPTIONS,
  DEFECT_SOURCE_OPTIONS,
  DEFECT_SOURCE_MAP,
  formatDate,
  FILTER_STATUS_OPTIONS,

} from '@drs/components/shared/constants';

const ShoreReports = () => {
  const { user } = useAuth();

  // ==================== STATE ====================
  const [filters, setFilters] = useState({
    vessel: [],
    date_identified_from: '',
    date_identified_to: '',
    target_close_date: '',
    defect_source: [],
    equipment: [],
    description: '',
    priority: '',
    status: '',
    deadline_status: '',
    pr_number: '',
    is_owner: '',
    text_sort: { field: null, dir: 'asc' }
  });

  const [visibleColumns, setVisibleColumns] = useState([
    'date',
    'deadline',
    'source',
    'equipment',
    'description',
    'priority',
    'status',
    'owner',
    'pr_details',
  ]);
  const [showColumnModal, setShowColumnModal] = useState(false);
  const [isImporting, setIsImporting] = useState(false);
  const [showImportModal, setShowImportModal] = useState(false);
  const [file, setFile] = useState(null);
  const [skipErrors, setSkipErrors] = useState(false);
  const [uploadResult, setUploadResult] = useState(null);
  const [dragActive, setDragActive] = useState(false);



  // ==================== FETCH DATA ====================
  const { data: defectsData = [], isLoading, refetch } = useQuery({
    queryKey: ['defects', 'global-list'],
    queryFn: () => defectApi.getDefects(),
  });

  // ==================== HELPER FUNCTIONS ====================
  const getDeadlineStatus = (deadline) => {
    if (!deadline) return 'NORMAL';
    const now = new Date();
    const target = new Date(deadline);
    const diff = Math.ceil((target - now) / (1000 * 60 * 60 * 24));

    if (diff < 0) return 'OVERDUE';
    if (diff <= 15) return 'WARNING';
    return 'NORMAL';
  };

  const toIST = (dateStr) => {
    if (!dateStr) return '';
    const d = new Date(dateStr);
    // Add fixed 5 hours 30 minutes for IST (no relying on browser timezone)
    const istOffset = 5.5 * 60 * 60 * 1000; // 5.5 hours in milliseconds
    const istDate = new Date(d.getTime() + istOffset);
    return istDate.toISOString().slice(0, 10);
  };

  // ==================== FILTER LOGIC - ✅ FIXED ====================
  const filteredData = useMemo(() => {
    const result = defectsData.filter((defect) => {
      if (filters.vessel.length > 0) {
        if (!filters.vessel.includes(defect.vessel_imo)) return false;
      }

      if (filters.date_identified_from) {
        const defectDate = toIST(defect.date_identified);
        if (defectDate < filters.date_identified_from) return false;
      }
      if (filters.date_identified_to) {
        const defectDate = toIST(defect.date_identified);
        if (defectDate > filters.date_identified_to) return false;
      }

      if (filters.target_close_date) {
        if (!defect.target_close_date) return false;
        const targetDate = toIST(defect.target_close_date);
        if (targetDate > filters.target_close_date) return false;
      }

      if (filters.defect_source.length > 0) {
        if (!filters.defect_source.includes(defect.defect_source)) return false;
      }

      if (filters.equipment.length > 0) {
        if (!filters.equipment.includes(defect.equipment_name)) return false;
      }

      if (filters.description) {
        const searchText = filters.description.toLowerCase();
        const matchesEquipment = defect.equipment_name?.toLowerCase().includes(searchText);
        const matchesDescription = defect.description?.toLowerCase().includes(searchText);
        const matchesVessel = defect.vessel_name?.toLowerCase().includes(searchText);
        const matchesResponsibility = defect.responsibility?.toLowerCase().includes(searchText);
        if (!matchesEquipment && !matchesDescription && !matchesVessel && !matchesResponsibility) {
          return false;
        }
      }

      if (filters.priority && defect.priority !== filters.priority) return false;
      if (filters.status && defect.status !== filters.status) return false;

      if (filters.deadline_status) {
        const deadlineStatus = getDeadlineStatus(defect.target_close_date);
        if (deadlineStatus !== filters.deadline_status) return false;
      }

      if (filters.pr_number) {
        const prMatch = defect.pr_entries?.some(pr =>
          pr.pr_number?.toLowerCase().includes(filters.pr_number.toLowerCase())
        );
        if (!prMatch) return false;
      }

      if (filters.is_owner !== '') {
        const ownerValue = filters.is_owner === 'true';
        if (defect.is_owner !== ownerValue) return false;
      }

      return true;
    });

    // ✅ Sort runs AFTER filter, on the result array
    if (filters.text_sort?.field) {
      const { field, dir } = filters.text_sort;
      const fieldMap = {
        vessel: 'vessel_name',
        equipment: 'equipment_name',
        source: 'defect_source',
        description: 'description',
        date: 'date_identified',      // Added
        deadline: 'target_close_date',
        priority: 'priority',
        status: 'status',
        owner: 'is_owner'  
      };
        const key = fieldMap[field];
    if (key) {
      result.sort((a, b) => {
        // 1. Handle Dates
        if (field === 'date' || field === 'deadline') {
          const valA = a[key] ? new Date(a[key]).getTime() : 0;
          const valB = b[key] ? new Date(b[key]).getTime() : 0;
          return dir === 'asc' ? valA - valB : valB - valA;
        }

        // 2. Handle Priority (Logical Order)
        if (field === 'priority') {
          const priorityOrder = { 'CRITICAL': 0, 'HIGH': 1, 'MEDIUM': 2, 'LOW': 3 };
          const valA = priorityOrder[a[key]] ?? 99;
          const valB = priorityOrder[b[key]] ?? 99;
          return dir === 'asc' ? valA - valB : valB - valA;
        }

        // 3. Handle Status (Workflow Order)
        if (field === 'status') {
          const statusOrder = { 'OPEN': 0, 'PENDING_CLOSURE': 1, 'CLOSED': 2 };
          const valA = statusOrder[a[key]] ?? 99;
          const valB = statusOrder[b[key]] ?? 99;
          return dir === 'asc' ? valA - valB : valB - valA;
        }

        // 4. Handle Owner (Boolean)
        if (field === 'owner') {
          const valA = a[key] ? 1 : 0;
          const valB = b[key] ? 1 : 0;
          // Ascending: No (0) then Yes (1). Descending: Yes (1) then No (0)
          return dir === 'asc' ? valA - valB : valB - valA;
        }

        // 5. Default Alphabetical (Vessel, Equipment, Source, Description)
        const va = (a[key] || '').toString().toLowerCase();
        const vb = (b[key] || '').toString().toLowerCase();
        return dir === 'asc' ? va.localeCompare(vb) : vb.localeCompare(va);
      });
    }
  }
    return result;
  }, [defectsData, filters]);



  const handleFilterChange = (field, value) => {
    setFilters(prev => ({ ...prev, [field]: value }));
  };

  const clearAllFilters = () => {
    setFilters({
      vessel: [],
      date_identified_from: '',
      date_identified_to: '',
      target_close_date: '',
      defect_source: [],
      equipment: [],
      description: '',
      priority: '',
      status: '',
      deadline_status: '',
      pr_number: '',
      is_owner: '',
      text_sort: { field: null, dir: 'asc' }
    });
  };

  const handleTextSort = (field) => {
    setFilters(prev => {
      const current = prev.text_sort;
      const nextDir = current.field === field
        ? current.dir === 'asc' ? 'desc'
          : current.dir === 'desc' ? null
            : 'asc'
        : 'asc';

      return {
        ...prev,
        text_sort: nextDir === null
          ? { field: null, dir: 'asc' }
          : { field, dir: nextDir }
      };
    });
  };

  const activeFilterCount = useMemo(() => {
    let count = 0;
    if (filters.vessel.length > 0) count++;
    if (filters.date_identified_from) count++;
    if (filters.date_identified_to) count++;
    if (filters.target_close_date) count++;
    if (filters.defect_source.length > 0) count++;
    if (filters.equipment.length > 0) count++;
    if (filters.description) count++;
    if (filters.priority) count++;
    if (filters.status) count++;
    if (filters.deadline_status) count++;
    if (filters.pr_number) count++;
    if (filters.is_owner !== '') count++;
    if (filters.text_sort?.field) count++;
    return count;
  }, [filters]);

  // ==================== EXCEL EXPORT ====================
  const handleExport = () => {
    const activeFilters = {};

    // Date Filters
    if (filters.date_identified_from) {
      activeFilters['date_identified_from'] = filters.date_identified_from;
    }
    if (filters.date_identified_to) {
      activeFilters['date_identified_to'] = filters.date_identified_to;
    }
    if (filters.target_close_date) {
      activeFilters['target_close_date'] = filters.target_close_date;
    }

    // Text Search Filters
    if (filters.description) {
      activeFilters['description'] = filters.description;
    }
    if (filters.pr_number) {
      activeFilters['pr_number'] = filters.pr_number;
    }

    // Single Select Filters
    if (filters.status) {
      activeFilters['status'] = [filters.status];
    }
    if (filters.priority) {
      activeFilters['priority'] = [filters.priority];
    }
    if (filters.is_owner !== '') {
      activeFilters['is_owner'] = filters.is_owner;
    }

    // Multi-Select Array Filters
    if (filters.equipment && filters.equipment.length > 0) {
      activeFilters['equipment_name'] = filters.equipment;
    }
    if (filters.vessel && filters.vessel.length > 0) {
      activeFilters['vessel_imo'] = filters.vessel;
    }
    if (filters.defect_source && filters.defect_source.length > 0) {
      activeFilters['defect_source'] = filters.defect_source;
    }

    // Prepare Visible Columns
    const columnsToExport = visibleColumns
      .filter(col => col !== 'chat' && col !== 'deadline_icon')
      .join(',');

    console.log('📊 Exporting with filters:', activeFilters);
    console.log('📊 Exporting columns:', columnsToExport);

    // Call Export API
    defectApi.exportDefects(activeFilters, columnsToExport);
  };


  const handleImport = async () => {
    if (!file) {
      alert("Please select a file first");
      return;
    }

    setIsImporting(true);
    setUploadResult(null);

    try {
      const formData = new FormData();
      formData.append("file", file);

      const response = await defectApi.importDefects(formData);

      setUploadResult(response);

      // refresh table after import
      refetch();

    } catch (err) {
      setUploadResult({
        message: "Import failed",
        total_rows_processed: 0,
        success_count: 0,
        error_count: 1,
        errors: [
          { row: "-", error: err.response?.data?.detail || err.message }
        ]
      });
    } finally {
      setIsImporting(false);
    }
  };


  const handleDownloadTemplate = async () => {
    try {
      await defectApi.downloadTemplate();
    } catch (err) {
      alert("Failed to download template");
    }
  };

  // ==================== COLUMN OPTIONS ====================
  const ALL_COLUMNS = [
    { id: 'date', label: 'Report Date' },
    { id: 'deadline', label: 'Target Deadline' },
    { id: 'source', label: 'Defect Source' },
    { id: 'equipment', label: 'Area of Concern' },
    { id: 'description', label: 'Description' },
    { id: 'priority', label: 'Priority' },
    { id: 'status', label: 'Status' },
    { id: 'owner', label: 'Owner' },
    { id: 'pr_details', label: 'PR Details' },
  ];

  const toggleColumn = (columnId) => {
    if (visibleColumns.includes(columnId)) {
      if (visibleColumns.length > 1) {
        setVisibleColumns(prev => prev.filter(col => col !== columnId));
      }
    } else {
      setVisibleColumns(prev => [...prev, columnId]);
    }
  };

  // ==================== VESSEL & EQUIPMENT OPTIONS ====================
  const VESSEL_OPTIONS = useMemo(() => {
    const unique = new Map();

    defectsData.forEach(d => {
      if (d.vessel_imo && d.vessel_name) {
        unique.set(d.vessel_imo, {
          vessel_name: d.vessel_name,
          vessel_imo: d.vessel_imo
        });
      }
    });

    return Array.from(unique.values()).sort((a, b) =>
      a.vessel_name.localeCompare(b.vessel_name)
    );
  }, [defectsData]);



  const equipmentList = useMemo(() => {
    if (!defectsData || defectsData.length === 0) return [];
    return [...new Set(defectsData.map(d => d.equipment_name).filter(Boolean))];
  }, [defectsData]);

  // ==================== RENDER ====================
  if (isLoading) {
    return (
      <div className="dashboard-container">
        <div style={{ textAlign: 'center', padding: '40px', color: '#64748b', fontSize: '14px' }}>
          <RefreshCw size={20} style={{ animation: 'spin 1s linear infinite', marginBottom: '10px' }} />
          <div>Loading reports data...</div>
        </div>
      </div>
    );
  }

  const previewData = filteredData.slice(0, 50);

  const handleFileChange = (e) => {
    if (e.target.files && e.target.files[0]) {
      setFile(e.target.files[0]);
    }
  };

  return (
    <div className="dashboard-container">
      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '20px' }}>
        <div>
          <h1 className="page-title">Report Generation</h1>
          <p style={{ fontSize: '13px', color: '#64748b', marginTop: '5px' }}>
            Filter defects and customize columns to generate Excel reports • <strong>{filteredData.length}</strong> records matching filters
          </p>
        </div>

        <div style={{ display: 'flex', gap: '10px' }}>
          <button
            onClick={() => setShowColumnModal(true)}
            style={{
              background: 'white',
              color: '#334155',
              border: '1px solid #cbd5e1',
              padding: '8px 16px',
              borderRadius: '6px',
              fontSize: '13px',
              fontWeight: '600',
              cursor: 'pointer',
              display: 'flex',
              alignItems: 'center',
              gap: '8px',
              transition: 'all 0.2s',
            }}
            onMouseEnter={(e) => {
              e.currentTarget.style.background = '#f8fafc';
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.background = 'white';
            }}
          >
            <Settings size={16} />
            Customize Columns ({visibleColumns.length}/{ALL_COLUMNS.length})
          </button>

          {activeFilterCount > 0 && (
            <button
              onClick={clearAllFilters}
              style={{
                background: 'white',
                color: '#ef4444',
                border: '1px solid #fecaca',
                padding: '8px 16px',
                borderRadius: '6px',
                fontSize: '13px',
                fontWeight: '600',
                cursor: 'pointer',
                display: 'flex',
                alignItems: 'center',
                gap: '8px',
                transition: 'all 0.2s',
              }}
              onMouseEnter={(e) => {
                e.currentTarget.style.background = '#fef2f2';
              }}
              onMouseLeave={(e) => {
                e.currentTarget.style.background = 'white';
              }}
            >
              <X size={16} />
              Clear Filters ({activeFilterCount})
            </button>
          )}

          <button
            onClick={() => refetch()}
            style={{
              background: 'white',
              color: '#334155',
              border: '1px solid #cbd5e1',
              padding: '8px 16px',
              borderRadius: '6px',
              fontSize: '13px',
              fontWeight: '600',
              cursor: 'pointer',
              display: 'flex',
              alignItems: 'center',
              gap: '8px',
              transition: 'all 0.2s',
            }}
            onMouseEnter={(e) => {
              e.currentTarget.style.background = '#f8fafc';
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.background = 'white';
            }}
          >
            <RefreshCw size={16} />
            Refresh
          </button>

          <div style={{ display: 'flex', gap: '10px', alignItems: 'center' }}>
            {/* Customize Columns Button */}

            {/* Hidden File Input */}
            <input
              type="file"
              id="defect-import-excel"
              accept=".xlsx"
              onChange={handleImport}
              disabled={isImporting}
              style={{ display: 'none' }}
            />

            {/* Professional Import Button */}
            <button
              onClick={() => setShowImportModal(true)}
              disabled={isImporting}
              style={{
                background: isImporting ? '#f3f4f6' : '#6366f1',
                color: isImporting ? '#94a3b8' : 'white',
                border: isImporting ? '1px solid #e2e8f0' : 'none',
                padding: '8px 16px',
                borderRadius: '6px',
                fontSize: '13px',
                fontWeight: '600',
                cursor: isImporting ? 'not-allowed' : 'pointer',
                display: 'flex',
                alignItems: 'center',
                gap: '8px',
                transition: 'all 0.2s shadow',
                boxShadow: isImporting ? 'none' : '0 1px 2px rgba(0,0,0,0.05)',
              }}
            >
              {isImporting ? (
                <RefreshCw size={16} style={{ animation: 'spin 1s linear infinite' }} />
              ) : (
                <FileUp size={16} />
              )}
              {isImporting ? "Processing..." : "Import Defects"}
            </button>

            {/* Download Excel Button */}
            <button
              onClick={handleExport}
              disabled={filteredData.length === 0}
              style={{
                background: filteredData.length > 0 ? '#10b981' : '#d1d5db',
                color: 'white',
                border: 'none',
                padding: '8px 16px',
                borderRadius: '6px',
                fontSize: '13px',
                fontWeight: '600',
                cursor: filteredData.length > 0 ? 'pointer' : 'not-allowed',
                display: 'flex',
                alignItems: 'center',
                gap: '8px',
              }}
            >
              <Download size={16} />
              Export ({filteredData.length})
            </button>
          </div>
        </div>
      </div>

      {/* ✅ TABLE WITH PURPLE GRADIENT HEADERS */}
      <div className="table-scroll-wrapper">
        <table className="data-table">
          <thead>
            <tr>
              <th style={{
                width: 60,
                background: 'linear-gradient(135deg, #667eea 0%, #764ba2 100%)',
                color: 'white',
                fontWeight: '600',
                textAlign: 'center',
                top: "65px"
              }}>
                S.No
              </th>
              <th style={{
                width: 120,
                background: 'linear-gradient(135deg, #667eea 0%, #764ba2 100%)',
                color: 'white',
                top: "65px"
              }}>
                <VesselFilter
                  label="Vessel"
                  vessels={VESSEL_OPTIONS}
                  selectedValues={filters.vessel}
                  onChange={(vals) => setFilters(prev => ({ ...prev, vessel: vals }))}
                  onSort={() => handleTextSort('vessel')}
                  sortState={filters.text_sort.field === 'vessel' ? filters.text_sort.dir : null}
                />
              </th>

              {visibleColumns.map((colId) => {
                const headerStyle = {
                  background: 'linear-gradient(135deg, #667eea 0%, #764ba2 100%)',
                  color: 'white',
                };

                switch (colId) {
                  case 'date':
                    return (
                      <th key="date-header" style={{ width: 150, ...headerStyle, top: "65px" }}>
                        <FilterHeader
                          label="Report Date"
                          field="date_identified"
                          currentFilter={{
                            from: filters.date_identified_from,
                            to: filters.date_identified_to
                          }}
                          onFilterChange={(field, val) => {
                            if (typeof val === 'object') {
                              setFilters(prev => ({
                                ...prev,
                                date_identified_from: val.from || '',
                                date_identified_to: val.to || ''
                              }));
                            } else {
                              handleFilterChange(field, val);
                            }
                          }}
                          type="date-range"
                          // ✅ ADDED SORT PROPS
                          onSort={() => handleTextSort('date')}
                          sortState={filters.text_sort.field === 'date' ? filters.text_sort.dir : null}
                        />
                      </th>
                    );

                  case 'deadline':
                    return (
                      <th key="deadline-header" style={{ width: 150, ...headerStyle, top: "65px" }}>
                        <FilterHeader
                          label="Target Deadline"
                          field="target_close_date"
                          currentFilter={filters.target_close_date}
                          onFilterChange={handleFilterChange}
                          type="date"
                          // ✅ ADDED SORT PROPS
                          onSort={() => handleTextSort('deadline')}
                          sortState={filters.text_sort.field === 'deadline' ? filters.text_sort.dir : null}
                        />
                      </th>
                    );

                  case 'source':
                    return (
                      <th key="source-header" style={{ width: 180, ...headerStyle, top: "65px" }}>
                        <DefectSourceFilter
                          label="Defect Source"
                          options={DEFECT_SOURCE_OPTIONS}
                          selectedValues={filters.defect_source}
                          onChange={(vals) => setFilters(prev => ({ ...prev, defect_source: vals }))}
                          onSort={() => handleTextSort('source')}
                          sortState={filters.text_sort.field === 'source' ? filters.text_sort.dir : null}
                        />
                      </th>
                    );

                  case 'equipment':
                    return (
                      <th key="equipment-header" style={{ width: 180, ...headerStyle, top: "65px" }}>
                        <EquipmentFilter
                          label="Area of Concern"
                          options={equipmentList || []}
                          selectedValues={filters.equipment}
                          onChange={(vals) =>
                            setFilters(prev => ({ ...prev, equipment: vals }))
                          }
                          onSort={() => handleTextSort('equipment')}
                          sortState={filters.text_sort.field === 'equipment' ? filters.text_sort.dir : null}

                        />

                      </th>
                    );

                  case 'description':
                    return (
                      <th key="description-header" style={{ width: 300, ...headerStyle, top: "65px" }}>
                        <FilterHeader
                          label="Description"
                          field="description"
                          currentFilter={filters.description}
                          onFilterChange={handleFilterChange}
                          onSort={() => handleTextSort('description')}
                          sortState={filters.text_sort.field === 'description' ? filters.text_sort.dir : null}
                        />
                      </th>
                    );



                  case 'priority':
                    return (
                      <th key="priority-header" style={{ width: 100, textAlign: 'center', ...headerStyle, top: "65px" }}>
                        <FilterHeader
                          label="Priority"
                          field="priority"
                          currentFilter={filters.priority}
                          onFilterChange={handleFilterChange}
                          type="select"
                          options={PRIORITY_OPTIONS}
                          onSort={() => handleTextSort('priority')}
                          sortState={filters.text_sort.field === 'priority' ? filters.text_sort.dir : null}
                        />
                      </th>
                    );

                  case 'status':
                    return (
                      <th key="status-header" style={{ width: 100, textAlign: 'center', ...headerStyle, top: "65px" }}>
                        <FilterHeader
                          label="Status"
                          field="status"
                          currentFilter={filters.status}
                          onFilterChange={handleFilterChange}
                          type="select"
                          options={FILTER_STATUS_OPTIONS}
                          onSort={() => handleTextSort('status')}
                          sortState={filters.text_sort.field === 'status' ? filters.text_sort.dir : null}
                        />
                      </th>
                    );

                  case 'owner':
                    return (
                      <th key="owner-header" style={{ width: 100, textAlign: 'center', ...headerStyle, top: "65px" }}>
                        <FilterHeader
                          label="Owner"
                          field="is_owner"
                          currentFilter={filters.is_owner}
                          onFilterChange={handleFilterChange}
                          type="select"
                          options={[
                            { label: "Owner", value: "true" },
                            { label: "Others", value: "false" }
                          ]}
                          onSort={() => handleTextSort('owner')}
                          sortState={filters.text_sort.field === 'owner' ? filters.text_sort.dir : null}
                        />
                      </th>
                    );

                  case 'pr_details':
                    return (
                      <th key="pr-header" style={{ width: 150, ...headerStyle, top: "65px" }}>
                        <FilterHeader
                          label="PR Details"
                          field="pr_number"
                          currentFilter={filters.pr_number}
                          onFilterChange={handleFilterChange}
                        />
                      </th>
                    );

                  default:
                    return null;
                }
              })}
            </tr>
          </thead>

          <tbody>
            {previewData.length === 0 ? (
              <tr>
                <td colSpan={visibleColumns.length + 2} style={{ textAlign: 'center', padding: '40px', color: '#94a3b8' }}>
                  No defects match your filters
                </td>
              </tr>
            ) : (
              previewData.map((defect, index) => {
                const activePrs = defect.pr_entries?.filter(p => !p.is_deleted) || [];

                return (
                  <tr key={`defect-row-${defect.id}`} style={{ background: index % 2 === 0 ? '#ffffff' : '#f8fafc' }}>
                    <td style={{ textAlign: 'center', fontWeight: '500' }}>{index + 1}</td>
                    <td style={{ fontWeight: '500' }}>{defect.vessel_name}</td>

                    {visibleColumns.map(colId => {
                      switch (colId) {
                        case 'date':
                          return <td key={`${defect.id}-date`}>{formatDate(defect.date_identified)}</td>;

                        case 'deadline':
                          return <td key={`${defect.id}-deadline`}>{formatDate(defect.target_close_date)}</td>;

                        case 'source':
                          return (
                            <td key={`${defect.id}-source`}>
                              {DEFECT_SOURCE_MAP[defect.defect_source] || defect.defect_source}
                            </td>
                          );

                        case 'equipment':
                          return <td key={`${defect.id}-equipment`}>{defect.equipment_name}</td>;

                        case 'description':
                          return (
                            <td key={`${defect.id}-description`} style={{ maxWidth: 300 }}>
                              <div

                                style={{
                                  cursor: 'pointer',
                                  fontSize: '13px',
                                  display: '-webkit-box',
                                  WebkitLineClamp: 2,
                                  WebkitBoxOrient: 'vertical',
                                  overflow: 'hidden',
                                  textOverflow: 'ellipsis',
                                  lineHeight: '1.4',
                                  maxHeight: '2.8em', // 2 lines * 1.4 line-height
                                  textTransform: 'uppercase',
                                }}
                                title="Click to view full description"
                              >
                                {defect.description}
                              </div>
                            </td>
                          );

                        case 'priority':
                          return (
                            <td key={`${defect.id}-priority`} style={{ textAlign: 'center' }}>
                              <span style={{
                                padding: '4px 8px',
                                borderRadius: '4px',
                                fontSize: '12px',
                                fontWeight: '600',
                                background: defect.priority === 'CRITICAL' ? '#fee2e2' :
                                  defect.priority === 'HIGH' ? '#ffedd5' :
                                    defect.priority === 'MEDIUM' ? '#dbeafe' : '#d1fae5',
                                color: defect.priority === 'CRITICAL' ? '#991b1b' :
                                  defect.priority === 'HIGH' ? '#9a3412' :
                                    defect.priority === 'MEDIUM' ? '#1e40af' : '#065f46'
                              }}>
                                {defect.priority}
                              </span>
                            </td>
                          );

                        case 'status':
                          return (
                            <td key={`${defect.id}-status`} style={{ textAlign: 'center' }}>
                              <span style={{
                                padding: '4px 8px',
                                borderRadius: '4px',
                                fontSize: '12px',
                                fontWeight: '600',
                                background:
                                  defect.status === 'CLOSED' ? '#dcfce7' :
                                    defect.status === 'PENDING_CLOSURE' ? '#fef3c7' :
                                      '#dbeafe',

                                color:
                                  defect.status === 'CLOSED' ? '#166534' :
                                    defect.status === 'PENDING_CLOSURE' ? '#92400e' :
                                      '#1e40af',

                              }}>
                                {defect.status}
                              </span>
                            </td>
                          );

                        case 'owner':
                          return (
                            <td key={`${defect.id}-owner`} style={{ textAlign: 'center' }}>
                              <span style={{
                                padding: '4px 8px',
                                borderRadius: '4px',
                                fontSize: '12px',
                                fontWeight: '600',
                                background: defect.is_owner ? '#d1fae5' : '#f3f4f6',
                                color: defect.is_owner ? '#065f46' : '#6b7280'
                              }}>
                                {defect.is_owner ? 'Yes' : 'No'}
                              </span>
                            </td>
                          );

                        case 'pr_details':
                          return (
                            <td key={`${defect.id}-pr`} style={{ whiteSpace: "normal" }}>
                              {activePrs.length > 0
                                ? activePrs.map(pr => pr.pr_number).join(', ')
                                : '-'}
                            </td>
                          );

                        default:
                          return null;
                      }
                    })}
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </div>

      {filteredData.length > 50 && (
        <div style={{
          marginTop: '20px',
          padding: '12px 16px',
          background: '#fef3c7',
          border: '1px solid #fbbf24',
          borderRadius: '6px',
          fontSize: '13px',
          color: '#92400e',
          textAlign: 'center',
          fontWeight: '500'
        }}>
          📋 Showing first 50 of <strong>{filteredData.length}</strong> records. All {filteredData.length} records will be included in Excel export.
        </div>
      )}

      {showColumnModal && (
        <div
          style={{
            position: 'fixed',
            top: 0,
            left: 0,
            right: 0,
            bottom: 0,
            background: 'rgba(0, 0, 0, 0.5)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            zIndex: 9999,
          }}
          onClick={() => setShowColumnModal(false)}
        >
          <div
            style={{
              background: 'white',
              borderRadius: '8px',
              padding: '24px',
              width: '500px',
              maxHeight: '80vh',
              overflow: 'auto',
            }}
            onClick={(e) => e.stopPropagation()}
          >
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '20px' }}>
              <h3 style={{ margin: 0, fontSize: '16px', fontWeight: '600' }}>
                Customize Columns ({visibleColumns.length}/{ALL_COLUMNS.length} selected)
              </h3>
              <button
                onClick={() => setShowColumnModal(false)}
                style={{
                  background: 'none',
                  border: 'none',
                  cursor: 'pointer',
                  padding: '4px',
                }}
              >
                <X size={20} color="#64748b" />
              </button>
            </div>

            <p style={{ fontSize: '13px', color: '#64748b', marginBottom: '16px' }}>
              Select at least 1 column. Click on any column to toggle visibility.
            </p>

            <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
              {ALL_COLUMNS.map(col => {
                const isSelected = visibleColumns.includes(col.id);
                return (
                  <button
                    key={`modal-col-${col.id}`}
                    onClick={() => toggleColumn(col.id)}
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'space-between',
                      padding: '12px 16px',
                      background: isSelected ? '#f0f9ff' : 'white',
                      border: isSelected ? '2px solid #3b82f6' : '1px solid #e2e8f0',
                      borderRadius: '6px',
                      cursor: 'pointer',
                      transition: 'all 0.2s',
                    }}
                  >
                    <span style={{ fontSize: '14px', fontWeight: isSelected ? '600' : '400', color: '#1e293b' }}>
                      {col.label}
                    </span>
                    {isSelected && (
                      <div style={{
                        width: '20px',
                        height: '20px',
                        borderRadius: '50%',
                        background: '#3b82f6',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                      }}>
                        <span style={{ color: 'white', fontSize: '12px', fontWeight: 'bold' }}>✓</span>
                      </div>
                    )}
                  </button>
                );
              })}
            </div>

            <button
              onClick={() => setShowColumnModal(false)}
              style={{
                marginTop: '20px',
                width: '100%',
                background: '#3b82f6',
                color: 'white',
                border: 'none',
                padding: '10px',
                borderRadius: '6px',
                fontSize: '14px',
                fontWeight: '600',
                cursor: 'pointer',
              }}
            >
              Done
            </button>
          </div>
        </div>
      )}

      {showImportModal && (
        <div
          style={{
            position: "fixed",
            top: 0,
            left: 0,
            right: 0,
            bottom: 0,
            background: "rgba(0,0,0,0.5)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            zIndex: 9999
          }}
          onClick={() => setShowImportModal(false)}
        >
          <div
            onClick={(e) => e.stopPropagation()}
            style={{
              background: "white",
              borderRadius: "12px",
              width: "90%",
              maxWidth: "600px",
              maxHeight: "90vh",
              overflow: "auto",
              boxShadow: "0 10px 40px rgba(0,0,0,0.2)"
            }}
          >
            {/* HEADER */}
            <div
              style={{
                padding: "20px 24px",
                borderBottom: "1px solid #e2e8f0",
                display: "flex",
                justifyContent: "space-between",
                alignItems: "center"
              }}
            >
              <h2 style={{ margin: 0, fontSize: "20px", fontWeight: 700 }}>
                📊 Bulk Import Defects
              </h2>

              <button
                onClick={() => setShowImportModal(false)}
                style={{
                  background: "none",
                  border: "none",
                  cursor: "pointer"
                }}
              >
                <X size={22} />
              </button>
            </div>

            {/* BODY */}
            <div style={{ padding: "24px" }}>

              {/* STEP 1 */}
              <div
                style={{
                  background: "#f0f9ff",
                  padding: "16px",
                  borderRadius: "8px",
                  border: "1px solid #bae6fd",
                  marginBottom: "20px",
                  display: "flex",          // Added flex
                  alignItems: "center",     // Vertically center content
                  justifyContent: "space-between", // Push text left, button right
                  gap: "20px"               // Gap for smaller screens
                }}
              >
                {/* Left Side: Text Content */}
                <div style={{ flex: 1 }}>
                  <h3 style={{ margin: "0 0 4px 0", fontSize: "14px", fontWeight: 700, color: "#0369a1" }}>
                    Step 1: Download Template
                  </h3>
                  <p style={{ margin: 0, fontSize: "13px", color: "#475569", lineHeight: "1.4" }}>
                    Smart Template includes dropdowns for Priority, Status & Source.
                  </p>
                </div>

                {/* Right Side: Button */}
                <button
                  onClick={handleDownloadTemplate}
                  style={{
                    background: "#0ea5e9",
                    color: "white",
                    border: "none",
                    padding: "10px 16px",
                    borderRadius: "6px",
                    fontWeight: 600,
                    display: "flex",
                    alignItems: "center",
                    gap: "8px",
                    cursor: "pointer",
                    whiteSpace: "nowrap",    // Prevent button text from wrapping
                    transition: "background 0.2s"
                  }}
                  onMouseEnter={(e) => e.target.style.background = "#0284c7"}
                  onMouseLeave={(e) => e.target.style.background = "#0ea5e9"}
                >
                  <Download size={16} />
                  Download Template
                </button>
              </div>
              {/* STEP 2 */}
              <h3 style={{ marginBottom: "10px", fontSize: "14px" }}>
                Step 2: Upload Your File
              </h3>

              <input
                id="file-input"
                type="file"
                accept=".xlsx,.xls"
                onChange={handleFileChange}
                style={{ display: "none" }}
              />

              <button
                onClick={() => document.getElementById("file-input").click()}
                style={{
                  width: "100%",
                  border: "2px dashed #cbd5e1",
                  padding: "30px",
                  borderRadius: "8px",
                  background: "#f8fafc",
                  cursor: "pointer"
                }}
              >
                <Upload size={36} style={{ marginBottom: "8px" }} />
                <div style={{ fontSize: "14px", fontWeight: 600 }}>
                  {file ? file.name : "Click to select Excel file"}
                </div>
                <div style={{ fontSize: "12px", color: "#64748b" }}>
                  Supported: .xlsx, .xls
                </div>
              </button>

              {file && (
                <button
                  onClick={() => setFile(null)}
                  style={{
                    marginTop: "8px",
                    background: "none",
                    border: "none",
                    color: "#ef4444",
                    cursor: "pointer",
                    fontSize: "12px",
                    fontWeight: 600
                  }}
                >
                  Remove file
                </button>
              )}

              {/* PARTIAL IMPORT */}
              {/* <div
                style={{
                  marginTop: "16px",
                  background: "#fef3c7",
                  border: "1px solid #fbbf24",
                  padding: "10px",
                  borderRadius: "6px"
                }}
              >
                <label style={{ display: "flex", gap: "8px", fontSize: "13px" }}>
                  <input
                    type="checkbox"
                    checked={skipErrors}
                    onChange={(e) => setSkipErrors(e.target.checked)}
                  />
                  <AlertTriangle size={16} />
                  Allow Partial Import (skip invalid rows)
                </label>
              </div> */}

              {/* IMPORT BUTTON */}
              <button
                onClick={handleImport}
                disabled={!file || isImporting}
                style={{
                  width: "100%",
                  marginTop: "16px",
                  background: !file || isImporting ? "#cbd5e1" : "#ea580c",
                  color: "white",
                  border: "none",
                  padding: "12px",
                  borderRadius: "6px",
                  fontWeight: 600,
                  cursor: !file || isImporting ? "not-allowed" : "pointer"
                }}
              >
                {isImporting ? "Uploading..." : "Upload & Import"}
              </button>

              {/* RESULT */}
              {uploadResult && (
                <div
                  style={{
                    marginTop: "20px",
                    padding: "16px",
                    borderRadius: "8px",
                    background:
                      uploadResult.error_count === 0 ? "#dcfce7" : "#fff7ed",
                    border:
                      uploadResult.error_count === 0
                        ? "1px solid #86efac"
                        : "1px solid #fdba74"
                  }}
                >
                  <div style={{ marginBottom: "10px", fontWeight: "600" }}>
                    📊 Import Summary
                  </div>

                  <p style={{ margin: "4px 0", fontSize: "13px" }}>
                    Total Rows Processed:
                    <strong> {uploadResult.total_rows_processed}</strong>
                  </p>

                  <p style={{ margin: "4px 0", fontSize: "13px", color: "#16a34a" }}>
                    ✅ Successfully Saved:
                    <strong> {uploadResult.success_count}</strong>
                  </p>

                  <p style={{ margin: "4px 0", fontSize: "13px", color: "#dc2626" }}>
                    ❌ Failed Rows:
                    <strong> {uploadResult.error_count}</strong>
                  </p>

                  {/* ERROR LIST */}
                  {uploadResult.errors?.length > 0 && (
                    <div
                      style={{
                        marginTop: "12px",
                        maxHeight: "180px",
                        overflowY: "auto",
                        background: "white",
                        border: "1px solid #e2e8f0",
                        borderRadius: "6px",
                        padding: "10px"
                      }}
                    >
                      <strong style={{ fontSize: "13px" }}>Row Errors:</strong>
                      <ul style={{ marginTop: "8px", paddingLeft: "18px" }}>
                        {uploadResult.errors.map((err, idx) => (
                          <li key={idx} style={{ fontSize: "12px", color: "#dc2626" }}>
                            Row {err.row} → {err.error}
                          </li>
                        ))}
                      </ul>
                    </div>
                  )}
                </div>
              )}

            </div>
          </div>
        </div>
      )}


    </div>
  );
};

export default ShoreReports;
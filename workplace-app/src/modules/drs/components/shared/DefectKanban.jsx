import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  DndContext,
  DragOverlay,
  PointerSensor,
  useSensor,
  useSensors,
  useDraggable,
  useDroppable,
} from '@dnd-kit/core';
import { Flag, Paperclip, Calendar, GripVertical, Ship, ChevronDown, Check, Search, X } from 'lucide-react';
import {
  PrioritySignalBarsIcon,
  StatusStageIcon,
  PRIORITY_COLORS,
  getStatusColor,
  getDeadlineStatus,
  formatDate,
} from '@drs/components/shared/constants';
import './kanban.css';

const COLUMNS = [
  { id: 'OPEN', label: 'Open' },
  { id: 'PENDING_CLOSURE', label: 'Pending closure' },
  { id: 'CLOSED', label: 'Closed' },
];

const PRIORITY_WEIGHT = { CRITICAL: 4, HIGH: 3, MEDIUM: 2, LOW: 1 };
const PRIORITY_LEVEL = PRIORITY_WEIGHT;

const sortCards = (a, b) => {
  const pw = (PRIORITY_WEIGHT[b.priority] || 0) - (PRIORITY_WEIGHT[a.priority] || 0);
  if (pw !== 0) return pw;
  const ad = a.target_close_date ? new Date(a.target_close_date).getTime() : Infinity;
  const bd = b.target_close_date ? new Date(b.target_close_date).getTime() : Infinity;
  return ad - bd;
};

// Returns { action } for an allowed drop, or { blocked } with a reason.
const resolveDrop =(isShore, from, to) => {
  if (from === to) return {};
  if (isShore) {
    if (from === 'OPEN' && (to === 'CLOSED' || to === 'PENDING_CLOSURE')) {
      return { blocked: 'Only the vessel can request closure. Shore closes a defect by approving that request.' };
    }
    if (from === 'PENDING_CLOSURE' && to === 'CLOSED') return { action: 'approve' };
    if (from === 'PENDING_CLOSURE' && to === 'OPEN') return { action: 'reject' };
    if (from === 'CLOSED' && to === 'OPEN') return { action: 'reopen' };
    return { blocked: 'That move is not allowed.' };
  }
  if (from === 'OPEN' && to === 'PENDING_CLOSURE') return { action: 'close' };
  return { blocked: 'Vessels can only request closure of open defects.' };
};

const KanbanCard = ({ defect, draggable, onClick, overlay = false }) => {
  const { attributes, listeners, setNodeRef, isDragging } = useDraggable({
    id: String(defect.id),
    data: { defect },
    disabled: !draggable || overlay,
  });
  const deadline = defect.status === 'CLOSED' ? 'NORMAL' : getDeadlineStatus(defect.target_close_date);
  const priorityColor = PRIORITY_COLORS[defect.priority] || '#94a3b8';

  return (
    <div
      ref={overlay ? undefined : setNodeRef}
      className={`kanban-card${isDragging ? ' kanban-card--ghost' : ''}${overlay ? ' kanban-card--overlay' : ''}${draggable ? '' : ' kanban-card--locked'}`}
      onClick={() => onClick?.(defect)}
      {...(overlay ? {} : attributes)}
      {...(overlay ? {} : listeners)}
    >
      <div className="kanban-card__top">
        <span className="kanban-card__id">{defect.defect_number || `#${defect.id}`}</span>
        <span className="kanban-card__icons">
          {defect.is_flagged && <Flag size={13} color="#dc2626" />}
          {defect.has_thread_messages && <Paperclip size={13} color="#64748b" />}
          {draggable && <GripVertical size={14} color="#94a3b8" />}
        </span>
      </div>
      <div className="kanban-card__title">{defect.equipment_name || defect.title || 'Untitled defect'}</div>
      {defect.description && <div className="kanban-card__desc">{defect.description}</div>}
      <div className="kanban-card__vessel">{defect.vessel_name || defect.vessel_imo}</div>
      <div className="kanban-card__foot">
        <span className="kanban-pill" style={{ background: `${priorityColor}1a`, color: priorityColor }}>
          <PrioritySignalBarsIcon size={12} color={priorityColor} level={PRIORITY_LEVEL[defect.priority]} />
          {defect.priority}
        </span>
        <span className={`kanban-card__due${deadline === 'OVERDUE' ? ' is-overdue' : deadline === 'WARNING' ? ' is-warning' : ''}`}>
          <Calendar size={12} /> {formatDate(defect.target_close_date)}
        </span>
      </div>
    </div>
  );
};

const VesselSelect = ({ value, options, counts, onChange }) => {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const ref = useRef(null);

  useEffect(() => {
    if (!open) return undefined;
    const onDown = (e) => { if (ref.current && !ref.current.contains(e.target)) setOpen(false); };
    const onKey = (e) => { if (e.key === 'Escape') setOpen(false); };
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  const shown = options.filter((o) => o.toLowerCase().includes(query.trim().toLowerCase()));
  const pick = (v) => { onChange(v); setOpen(false); setQuery(''); };

  return (
    <div className="kanban-select" ref={ref}>
      <button
        type="button"
        className={`kanban-select__btn${open ? ' is-open' : ''}${value ? ' has-value' : ''}`}
        onClick={() => setOpen((o) => !o)}
        aria-haspopup="listbox"
        aria-expanded={open}
      >
        <Ship size={15} />
        <span className="kanban-select__label">{value || 'All vessels'}</span>
        {value ? (
          <span
            className="kanban-select__clear"
            role="button"
            aria-label="Clear vessel filter"
            onClick={(e) => { e.stopPropagation(); pick(''); }}
          >
            <X size={13} />
          </span>
        ) : (
          <ChevronDown size={15} className="kanban-select__chev" />
        )}
      </button>
      {open && (
        <div className="kanban-select__menu" role="listbox">
          {options.length > 6 && (
            <div className="kanban-select__search">
              <Search size={14} />
              <input autoFocus placeholder="Search vessel" value={query} onChange={(e) => setQuery(e.target.value)} />
            </div>
          )}
          <div className="kanban-select__list">
            <button type="button" className={`kanban-select__opt${!value ? ' is-selected' : ''}`} onClick={() => pick('')}>
              <span>All vessels</span>
              {!value && <Check size={14} />}
            </button>
            {shown.map((o) => (
              <button
                key={o}
                type="button"
                role="option"
                aria-selected={value === o}
                className={`kanban-select__opt${value === o ? ' is-selected' : ''}`}
                onClick={() => pick(o)}
              >
                <span>{o}</span>
                <span className="kanban-select__meta">
                  {counts[o] || 0}
                  {value === o && <Check size={14} />}
                </span>
              </button>
            ))}
            {shown.length === 0 && <div className="kanban-select__none">No vessels found</div>}
          </div>
        </div>
      )}
    </div>
  );
};

const KanbanColumn = ({ column, cards, canDrag, onCardClick, isOver }) => {
  const { setNodeRef } = useDroppable({ id: column.id });
  const color = getStatusColor(column.id);
  return (
    <div ref={setNodeRef} className={`kanban-col${isOver ? ' kanban-col--over' : ''}`}>
      <div className="kanban-col__head">
        <span className="kanban-col__title">
          <StatusStageIcon size={14} color={color} status={column.id} />
          {column.label}
        </span>
        <span className="kanban-col__count">{cards.length}</span>
      </div>
      <div className="kanban-col__body">
        {cards.map((d) => (
          <KanbanCard key={d.id} defect={d} draggable={canDrag(d)} onClick={onCardClick} />
        ))}
        {cards.length === 0 && <div className="kanban-col__empty">No defects</div>}
      </div>
    </div>
  );
};

const DefectKanban = ({
  defects = [],
  role,
  onCardClick,
  onRequestClose,
  onApproveReject,
  onRequestReopen,
  onBlocked,
}) => {
  const isShore = role === 'SHORE' || role === 'ADMIN';
  const [activeId, setActiveId] = useState(null);
  const [overId, setOverId] = useState(null);

  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 6 } }));

  const [vesselFilter, setVesselFilter] = useState('');
  const [priorityFilter, setPriorityFilter] = useState([]);

  const vesselOptions = useMemo(
    () => [...new Set(defects.map((d) => d.vessel_name || d.vessel_imo).filter(Boolean))].sort(),
    [defects]
  );

  const vesselCounts = useMemo(() => {
    const c = {};
    defects.forEach((d) => {
      const v = d.vessel_name || d.vessel_imo;
      if (v) c[v] = (c[v] || 0) + 1;
    });
    return c;
  }, [defects]);

  const visibleDefects = useMemo(
    () =>
      defects.filter(
        (d) =>
          (!vesselFilter || (d.vessel_name || d.vessel_imo) === vesselFilter) &&
          (priorityFilter.length === 0 || priorityFilter.includes(d.priority))
      ),
    [defects, vesselFilter, priorityFilter]
  );

  const togglePriority = (p) =>
    setPriorityFilter((prev) => (prev.includes(p) ? prev.filter((x) => x !== p) : [...prev, p]));
  const hasFilters = vesselFilter !== '' || priorityFilter.length > 0;

  const grouped = useMemo(() => {
    const g = { OPEN: [], PENDING_CLOSURE: [], CLOSED: [] };
    visibleDefects.forEach((d) => {
      if (g[d.status]) g[d.status].push(d);
    });
    Object.values(g).forEach((list) => list.sort(sortCards));
    return g;
  }, [visibleDefects]);

  const canDrag = (d) => (isShore ? true : d.status === 'OPEN');
  const activeDefect = activeId ? defects.find((d) => String(d.id) === activeId) : null;

  const handleDragEnd = ({ active, over }) => {
    setActiveId(null);
    setOverId(null);
    if (!over) return;
    const defect = active.data.current?.defect;
    if (!defect) return;
    const { action, blocked } = resolveDrop(isShore, defect.status, over.id);
    if (blocked) {
      onBlocked?.(blocked);
      return;
    }
    if (action === 'close') onRequestClose?.(defect);
    else if (action === 'approve') onApproveReject?.(defect, 'CLOSED');
    else if (action === 'reject') onApproveReject?.(defect, 'OPEN');
    else if (action === 'reopen') onRequestReopen?.(defect);
  };

  return (
    <>
    <div className="kanban-filters">
      {vesselOptions.length > 1 && (
        <div className="kanban-filters__field">
          <span>Vessel</span>
          <VesselSelect value={vesselFilter} options={vesselOptions} counts={vesselCounts} onChange={setVesselFilter} />
        </div>
      )}
      <div className="kanban-filters__field">
        <span>Priority</span>
        <div className="kanban-filters__chips">
          {['CRITICAL', 'HIGH', 'MEDIUM', 'LOW'].map((p) => {
            const on = priorityFilter.includes(p);
            const c = PRIORITY_COLORS[p];
            return (
              <button
                key={p}
                type="button"
                className={`kanban-chip${on ? ' is-on' : ''}`}
                style={on ? { background: c, borderColor: c, color: '#fff' } : { color: c, borderColor: `${c}66` }}
                onClick={() => togglePriority(p)}
              >
                {p.charAt(0) + p.slice(1).toLowerCase()}
              </button>
            );
          })}
        </div>
      </div>
      {hasFilters && (
        <button type="button" className="kanban-filters__clear" onClick={() => { setVesselFilter(''); setPriorityFilter([]); }}>
          Clear filters
        </button>
      )}
      <span className="kanban-filters__count">{visibleDefects.length} of {defects.length} defects</span>
    </div>
    <DndContext
      sensors={sensors}
      onDragStart={({ active }) => setActiveId(String(active.id))}
      onDragOver={({ over }) => setOverId(over ? String(over.id) : null)}
      onDragCancel={() => { setActiveId(null); setOverId(null); }}
      onDragEnd={handleDragEnd}
    >
      <div className="kanban-board">
        {COLUMNS.map((col) => (
          <KanbanColumn
            key={col.id}
            column={col}
            cards={grouped[col.id]}
            canDrag={canDrag}
            onCardClick={onCardClick}
            isOver={overId === col.id && activeDefect && activeDefect.status !== col.id}
          />
        ))}
      </div>
      <DragOverlay>
        {activeDefect ? <KanbanCard defect={activeDefect} draggable overlay /> : null}
      </DragOverlay>
    </DndContext>
    </>
  );
};

export default DefectKanban;

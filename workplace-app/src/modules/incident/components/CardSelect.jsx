import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Check, ChevronDown, Search, X } from 'lucide-react';
import '../styles/cardSelect.css';

export default function CardSelect({
  value = '',
  onChange,
  options = [],
  placeholder = 'Select…',
  icon: Icon = null,
  searchable = undefined,
  allowClear = undefined,
  isBlock = false,
  size = 'md',
  required = false,
  error = false,
  disabled = false,
  name = undefined,
  ariaLabel = undefined,
  multi = false,
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [dropUp, setDropUp] = useState(false);
  const [pos, setPos] = useState(null);

  const rootRef = useRef(null);
  const menuRef = useRef(null);
  const searchInputRef = useRef(null);

  // Normalize options into uniform shape: { value: string, label: string, sublabel?: string }
  const normalizedOptions = useMemo(() => {
    return options.map((opt) => {
      if (typeof opt === 'string') {
        return { value: opt, label: opt };
      }
      if (opt && typeof opt === 'object') {
        const val = opt.value ?? opt.imo ?? opt.id ?? '';
        const lbl = opt.label ?? opt.name ?? opt.title ?? String(val);
        const sub = opt.sublabel ?? (opt.imo ? `IMO ${opt.imo}` : undefined);
        return { value: String(val), label: String(lbl), sublabel: sub };
      }
      return { value: String(opt), label: String(opt) };
    });
  }, [options]);

  // Selected values as an array of strings
  const selectedValues = useMemo(() => {
    if (!multi) return value ? [String(value)] : [];
    if (Array.isArray(value)) return value.map(String).filter(Boolean);
    if (typeof value === 'string' && value.trim()) {
      return value.split(',').map((v) => v.trim()).filter(Boolean);
    }
    return [];
  }, [value, multi]);

  const selectedOption = useMemo(() => {
    if (multi) return null;
    return normalizedOptions.find((o) => String(o.value) === String(value));
  }, [normalizedOptions, value, multi]);

  // Compute trigger label
  const triggerLabel = useMemo(() => {
    if (!multi) {
      return selectedOption ? selectedOption.label : placeholder;
    }
    if (selectedValues.length === 0) return placeholder;
    const selectedLabels = normalizedOptions
      .filter((o) => selectedValues.includes(String(o.value)))
      .map((o) => o.label);

    if (selectedLabels.length === 0) return placeholder;
    if (selectedLabels.length === 1) return selectedLabels[0];
    if (selectedLabels.length === 2) return `${selectedLabels[0]}, ${selectedLabels[1]}`;
    return `${selectedLabels[0]}, ${selectedLabels[1]} +${selectedLabels.length - 2}`;
  }, [multi, selectedOption, selectedValues, normalizedOptions, placeholder]);

  // Determine whether search is enabled (auto if > 5 options unless explicitly specified)
  const isSearchable = searchable !== undefined ? searchable : normalizedOptions.length > 5;

  // Filter options by search query
  const filteredOptions = useMemo(() => {
    if (!query.trim()) return normalizedOptions;
    const q = query.trim().toLowerCase();
    return normalizedOptions.filter(
      (o) => o.label.toLowerCase().includes(q) || (o.sublabel && o.sublabel.toLowerCase().includes(q)),
    );
  }, [normalizedOptions, query]);

  // Clean search input placeholder: "Select vessel…" -> "Search vessels…"
  const searchPlaceholder = useMemo(() => {
    const clean = placeholder.replace(/^(select|all)\s+/i, '').replace(/[…\.]+$/g, '').trim();
    return clean ? `Search ${clean.toLowerCase()}…` : 'Search options…';
  }, [placeholder]);

  // Update floating menu position in screen coordinates
  const updatePosition = useCallback(() => {
    if (!rootRef.current) return;
    const r = rootRef.current.getBoundingClientRect();
    const roomBelow = window.innerHeight - r.bottom;
    const roomAbove = r.top;

    // Desired dropdown width: at least the trigger width, and at least 320px for vessel & IMO
    const targetWidth = Math.min(Math.max(r.width, 320), window.innerWidth - 24);

    // Make sure menu doesn't bleed off the right screen edge
    let left = r.left;
    if (left + targetWidth > window.innerWidth - 12) {
      left = Math.max(12, window.innerWidth - targetWidth - 12);
    }

    // Determine whether to flip upward
    const shouldFlip = roomBelow < 270 && roomAbove > roomBelow;
    setDropUp(shouldFlip);

    const availableHeight = shouldFlip ? roomAbove - 16 : roomBelow - 16;
    const maxHeight = Math.min(320, Math.max(160, availableHeight));

    if (shouldFlip) {
      setPos({
        position: 'fixed',
        left,
        bottom: window.innerHeight - r.top + 6,
        top: 'auto',
        width: targetWidth,
        maxWidth: window.innerWidth - 24,
        maxHeight,
        zIndex: 10500,
      });
    } else {
      setPos({
        position: 'fixed',
        left,
        top: r.bottom + 6,
        bottom: 'auto',
        width: targetWidth,
        maxWidth: window.innerWidth - 24,
        maxHeight,
        zIndex: 10500,
      });
    }
  }, []);

  // Recalculate position when opened, resized, or scrolled anywhere in the app
  useLayoutEffect(() => {
    if (open) {
      updatePosition();
    }
  }, [open, updatePosition]);

  useEffect(() => {
    if (!open) return undefined;
    const onScrollOrResize = () => {
      updatePosition();
    };
    window.addEventListener('scroll', onScrollOrResize, true);
    window.addEventListener('resize', onScrollOrResize);
    return () => {
      window.removeEventListener('scroll', onScrollOrResize, true);
      window.removeEventListener('resize', onScrollOrResize);
    };
  }, [open, updatePosition]);

  // Click outside and Esc handling
  useEffect(() => {
    if (!open) return undefined;
    const onMouseDown = (e) => {
      const inTrigger = rootRef.current && rootRef.current.contains(e.target);
      const inMenu = menuRef.current && menuRef.current.contains(e.target);
      if (!inTrigger && !inMenu) {
        setOpen(false);
      }
    };
    const onKeyDown = (e) => {
      if (e.key === 'Escape') {
        setOpen(false);
      }
    };
    document.addEventListener('mousedown', onMouseDown);
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('mousedown', onMouseDown);
      document.removeEventListener('keydown', onKeyDown);
    };
  }, [open]);

  const toggleOpen = useCallback(() => {
    if (disabled) return;
    if (!open) {
      setQuery('');
      setOpen(true);
      setTimeout(() => searchInputRef.current?.focus(), 60);
    } else {
      setOpen(false);
    }
  }, [disabled, open]);

  const handleItemClick = (val) => {
    if (multi) {
      const s = String(val);
      let next;
      if (selectedValues.includes(s)) {
        next = selectedValues.filter((v) => v !== s);
      } else {
        next = [...selectedValues, s];
      }
      onChange?.(typeof value === 'string' ? next.join(',') : next);
    } else {
      onChange?.(val);
      setOpen(false);
      setQuery('');
    }
  };

  const handleClear = (e) => {
    e.stopPropagation();
    onChange?.(typeof value === 'string' ? '' : []);
    if (!multi) setOpen(false);
  };

  const handleSelectAll = (e) => {
    e.stopPropagation();
    const allVals = normalizedOptions.map((o) => o.value);
    onChange?.(typeof value === 'string' ? allVals.join(',') : allVals);
  };

  const hasSelection = selectedValues.length > 0;
  const canClear = allowClear !== undefined ? allowClear : (hasSelection && !required);

  // The portal host: document.body ensures it breaks out of modal overflow clipping
  const portalHost = typeof document !== 'undefined' ? document.body : null;

  return (
    <div
      ref={rootRef}
      className={`inc-cselect inc-cselect--${size}${isBlock ? ' inc-cselect--block' : ''}`}
    >
      <button
        type="button"
        className={`inc-cselect__trigger${open ? ' inc-cselect__trigger--open' : ''}${
          hasSelection ? ' inc-cselect__trigger--has' : ''
        }${error ? ' inc-cselect__trigger--error' : ''}`}
        onClick={toggleOpen}
        disabled={disabled}
        aria-expanded={open}
        aria-haspopup="listbox"
        aria-label={ariaLabel || placeholder}
      >
        <span className="inc-cselect__content">
          {Icon && <span className="inc-cselect__icon"><Icon size={14} /></span>}
          <span className={`inc-cselect__label${!hasSelection ? ' inc-cselect__placeholder' : ''}`}>
            {triggerLabel}
          </span>
          {multi && selectedValues.length > 1 && (
            <span className="inc-cselect__count-badge">{selectedValues.length}</span>
          )}
        </span>
        <span className="inc-cselect__actions">
          {canClear && (
            <span
              role="button"
              tabIndex={0}
              className="inc-cselect__clear"
              onClick={handleClear}
              onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') handleClear(e); }}
              title="Clear selection"
              aria-label="Clear selection"
            >
              <X size={11} />
            </span>
          )}
          <ChevronDown size={14} className={`inc-cselect__chev${open ? ' inc-cselect__chev--open' : ''}`} />
        </span>
      </button>

      {/* Hidden input for standard form serialization/required validation if name is given */}
      {name && (
        <input
          type="hidden"
          name={name}
          value={Array.isArray(value) ? value.join(',') : value}
          required={required}
        />
      )}

      {/* Render dropdown menu through portal so it never gets clipped by modals or containers */}
      {portalHost && open && pos && createPortal(
        <div
          ref={menuRef}
          style={pos}
          className={`inc-cselect__menu${dropUp ? ' inc-cselect__menu--up' : ''}`}
          role="listbox"
          aria-label={ariaLabel || placeholder}
        >
          {isSearchable && (
            <div className="inc-cselect__search">
              <Search size={13} className="inc-cselect__search-icon" />
              <input
                ref={searchInputRef}
                type="text"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder={searchPlaceholder}
                onClick={(e) => e.stopPropagation()}
              />
              {query && (
                <button
                  type="button"
                  className="inc-cselect__search-clear"
                  onClick={(e) => {
                    e.stopPropagation();
                    setQuery('');
                    searchInputRef.current?.focus();
                  }}
                  title="Clear search"
                >
                  <X size={12} />
                </button>
              )}
            </div>
          )}

          {multi && (
            <div className="inc-cselect__multibar">
              <button
                type="button"
                className="inc-cselect__multibtn"
                onClick={handleSelectAll}
              >
                Select all ({normalizedOptions.length})
              </button>
              {selectedValues.length > 0 && (
                <button
                  type="button"
                  className="inc-cselect__multibtn inc-cselect__multibtn--clear"
                  onClick={handleClear}
                >
                  Clear selection ({selectedValues.length})
                </button>
              )}
            </div>
          )}

          <div className="inc-cselect__list">
            {!multi && !required && !query && (
              <div
                className={`inc-cselect__item inc-cselect__item--all${!hasSelection ? ' inc-cselect__item--active' : ''}`}
                onClick={() => handleItemClick('')}
                role="option"
                aria-selected={!hasSelection}
              >
                <div className="inc-cselect__item-left">
                  <span className="inc-cselect__item-text">{placeholder}</span>
                </div>
                {!hasSelection && <Check size={14} className="inc-cselect__check" />}
              </div>
            )}

            {filteredOptions.length === 0 ? (
              <div className="inc-cselect__empty">No matching options</div>
            ) : (
              filteredOptions.map((opt) => {
                const isSelected = selectedValues.includes(String(opt.value));
                return (
                  <div
                    key={opt.value}
                    className={`inc-cselect__item${isSelected ? ' inc-cselect__item--active' : ''}`}
                    onClick={() => handleItemClick(opt.value)}
                    role="option"
                    aria-selected={isSelected}
                  >
                    <div className="inc-cselect__item-left">
                      {multi && (
                        <span className={`inc-cselect__checkbox${isSelected ? ' inc-cselect__checkbox--checked' : ''}`}>
                          {isSelected && <Check size={11} strokeWidth={3} />}
                        </span>
                      )}
                      <span className="inc-cselect__item-text" title={opt.label}>{opt.label}</span>
                      {opt.sublabel && <span className="inc-cselect__item-sub">{opt.sublabel}</span>}
                    </div>
                    {!multi && isSelected && <Check size={14} className="inc-cselect__check" />}
                  </div>
                );
              })
            )}
          </div>
        </div>,
        portalHost
      )}
    </div>
  );
}

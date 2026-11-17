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

  const selectedOption = useMemo(() => {
    return normalizedOptions.find((o) => String(o.value) === String(value));
  }, [normalizedOptions, value]);

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

    // Desired dropdown width: at least the trigger width, and at least 340px for vessel & IMO
    const minW = Math.max(r.width, 340);
    const maxW = Math.min(Math.max(r.width, 440), window.innerWidth - 24);

    // Make sure menu doesn't bleed off the right screen edge
    let left = r.left;
    if (left + minW > window.innerWidth - 12) {
      left = Math.max(12, window.innerWidth - minW - 12);
    }

    // Determine whether to flip upward
    const shouldFlip = roomBelow < 270 && roomAbove > roomBelow;
    setDropUp(shouldFlip);

    const availableHeight = shouldFlip ? roomAbove - 16 : roomBelow - 16;
    const maxHeight = Math.min(300, Math.max(160, availableHeight));

    if (shouldFlip) {
      setPos({
        position: 'fixed',
        left,
        bottom: window.innerHeight - r.top + 6,
        top: 'auto',
        minWidth: Math.min(minW, window.innerWidth - 24),
        maxWidth: maxW,
        width: isBlock ? Math.max(r.width, 340) : 'max-content',
        maxHeight,
        zIndex: 10500,
      });
    } else {
      setPos({
        position: 'fixed',
        left,
        top: r.bottom + 6,
        bottom: 'auto',
        minWidth: Math.min(minW, window.innerWidth - 24),
        maxWidth: maxW,
        width: isBlock ? Math.max(r.width, 340) : 'max-content',
        maxHeight,
        zIndex: 10500,
      });
    }
  }, [isBlock]);

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

  const handleSelect = (val) => {
    onChange?.(val);
    setOpen(false);
    setQuery('');
  };

  const handleClear = (e) => {
    e.stopPropagation();
    onChange?.('');
    setOpen(false);
  };

  const canClear = allowClear !== undefined ? allowClear : !!value && !required;

  // The portal host: document.body ensures it breaks out of modal overflow clipping
  const portalHost = typeof document !== 'undefined' ? document.body : null;

  const menuElement = open && pos && (
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

      <div className="inc-cselect__list">
        {!required && !query && (
          <div
            className={`inc-cselect__item inc-cselect__item--all${!value ? ' inc-cselect__item--active' : ''}`}
            onClick={() => handleSelect('')}
            role="option"
            aria-selected={!value}
          >
            <div className="inc-cselect__item-left">
              <span className="inc-cselect__item-text">{placeholder}</span>
            </div>
            {!value && <Check size={14} className="inc-cselect__check" />}
          </div>
        )}

        {filteredOptions.length === 0 ? (
          <div className="inc-cselect__empty">No matching options</div>
        ) : (
          filteredOptions.map((opt) => {
            const isSelected = String(opt.value) === String(value);
            return (
              <div
                key={opt.value}
                className={`inc-cselect__item${isSelected ? ' inc-cselect__item--active' : ''}`}
                onClick={() => handleSelect(opt.value)}
                role="option"
                aria-selected={isSelected}
              >
                <div className="inc-cselect__item-left">
                  <span className="inc-cselect__item-text" title={opt.label}>{opt.label}</span>
                  {opt.sublabel && <span className="inc-cselect__item-sub">{opt.sublabel}</span>}
                </div>
                {isSelected && <Check size={14} className="inc-cselect__check" />}
              </div>
            );
          })
        )}
      </div>
    </div>
  );

  return (
    <div
      ref={rootRef}
      className={`inc-cselect inc-cselect--${size}${isBlock ? ' inc-cselect--block' : ''}`}
    >
      <button
        type="button"
        className={`inc-cselect__trigger${open ? ' inc-cselect__trigger--open' : ''}${
          value ? ' inc-cselect__trigger--has' : ''
        }${error ? ' inc-cselect__trigger--error' : ''}`}
        onClick={toggleOpen}
        disabled={disabled}
        aria-expanded={open}
        aria-haspopup="listbox"
        aria-label={ariaLabel || placeholder}
      >
        <span className="inc-cselect__content">
          {Icon && <span className="inc-cselect__icon"><Icon size={14} /></span>}
          <span className={`inc-cselect__label${!value ? ' inc-cselect__placeholder' : ''}`}>
            {selectedOption ? selectedOption.label : placeholder}
          </span>
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
      {name && <input type="hidden" name={name} value={value} required={required} />}

      {/* Render dropdown menu through portal so it never gets clipped by modals or containers */}
      {portalHost ? createPortal(menuElement, portalHost) : menuElement}
    </div>
  );
}

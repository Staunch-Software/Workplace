import { useState, useRef, useEffect, useLayoutEffect, useCallback } from 'react';
import { createPortal } from 'react-dom';
import { ChevronDown, Check } from 'lucide-react';

// Custom select replacement so every filter dropdown in the app gets a
// consistently styled, scrollable popup (native <select> popups are
// rendered by the browser/OS and can't be restyled with CSS).
//
// options: [{ value, label, dot?, hint? }]  dot = a colour shown before the label, hint = small text on the right.
// portal:  draw the list on top of the page instead of inside the parent, so a table that scrolls or clips its
//          content (overflow) cannot cut it off. It flips upward when there is no room below.
// size:    'sm' for a compact control inside table rows.
export default function Dropdown({ value, onChange, options, placeholder = 'All', style, portal = false, size, disabled = false, ariaLabel }) {
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(-1);          // option highlighted with the keyboard
  const [pos, setPos] = useState(null);              // portal mode: where to draw the list
  const rootRef = useRef(null);
  const triggerRef = useRef(null);
  const menuRef = useRef(null);

  const selectedIndex = options.findIndex(o => String(o.value) === String(value));
  const selected = selectedIndex >= 0 ? options[selectedIndex] : null;

  const close = useCallback(() => setOpen(false), []);

  useEffect(() => {
    if (!open) return undefined;
    const onDocClick = (e) => {
      const inside = (rootRef.current && rootRef.current.contains(e.target)) || (menuRef.current && menuRef.current.contains(e.target));
      if (!inside) close();
    };
    const onKey = (e) => { if (e.key === 'Escape') { close(); triggerRef.current?.focus(); } };
    // a list drawn over the page would drift away from its control, so it closes when the page moves
    const onMove = (e) => { if (!menuRef.current || !menuRef.current.contains(e.target)) close(); };
    document.addEventListener('mousedown', onDocClick);
    document.addEventListener('keydown', onKey);
    if (portal) {
      window.addEventListener('scroll', onMove, true);
      window.addEventListener('resize', close);
    }
    return () => {
      document.removeEventListener('mousedown', onDocClick);
      document.removeEventListener('keydown', onKey);
      window.removeEventListener('scroll', onMove, true);
      window.removeEventListener('resize', close);
    };
  }, [open, portal, close]);

  // place the portal list under the control, or above it when the bottom of the window is too close
  useLayoutEffect(() => {
    if (!open || !portal || !triggerRef.current) return;
    const r = triggerRef.current.getBoundingClientRect();
    const room = window.innerHeight - r.bottom;
    const flip = room < 220 && r.top > room;
    setPos({
      left: r.left, minWidth: r.width,
      ...(flip ? { bottom: window.innerHeight - r.top + 4, maxHeight: Math.min(240, r.top - 12) }
               : { top: r.bottom + 4, maxHeight: Math.min(240, room - 12) }),
    });
  }, [open, portal]);

  // keep the keyboard-highlighted option in view
  useEffect(() => {
    if (!open || active < 0) return;
    menuRef.current?.children[active]?.scrollIntoView({ block: 'nearest' });
  }, [active, open]);

  const choose = (o) => { onChange(o.value); setOpen(false); triggerRef.current?.focus(); };

  const onTriggerKey = (e) => {
    if (disabled) return;
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      if (!open) { setOpen(true); setActive(Math.max(selectedIndex, 0)); return; }
      const step = e.key === 'ArrowDown' ? 1 : -1;
      setActive(a => (a + step + options.length) % options.length);
    } else if ((e.key === 'Enter' || e.key === ' ') && open && active >= 0) {
      e.preventDefault();
      choose(options[active]);
    }
  };

  const toggle = () => {
    if (disabled) return;
    setOpen(o => !o);
    setActive(selectedIndex);
  };

  const list = (
    <ul
      ref={menuRef}
      className={`dropdown__menu${portal ? ' dropdown__menu--fixed' : ''}`}
      role="listbox"
      style={portal ? (pos || { visibility: 'hidden' }) : undefined}
    >
      {options.map((o, i) => {
        const isSelected = i === selectedIndex;
        return (
          <li
            key={o.value}
            role="option"
            aria-selected={isSelected}
            className={`dropdown__option${isSelected ? ' dropdown__option--selected' : ''}${i === active ? ' dropdown__option--active' : ''}`}
            onClick={() => choose(o)}
            onMouseEnter={() => setActive(i)}
          >
            <span className="dropdown__label">
              {o.dot && <span className="dropdown__dot" style={{ background: o.dot }} aria-hidden="true" />}
              <span>{o.label}</span>
            </span>
            {o.hint && <span className="dropdown__hint">{o.hint}</span>}
            {isSelected && <Check size={15} className="dropdown__check" />}
          </li>
        );
      })}
    </ul>
  );

  const host = portal && open ? (rootRef.current?.closest('.orb-root') || document.body) : null;

  return (
    <div className={`dropdown${size === 'sm' ? ' dropdown--sm' : ''}${disabled ? ' dropdown--disabled' : ''}`} ref={rootRef} style={style}>
      <button
        type="button"
        ref={triggerRef}
        className="form-control dropdown__trigger"
        onClick={toggle}
        onKeyDown={onTriggerKey}
        disabled={disabled}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-label={ariaLabel}
      >
        <span className={`dropdown__trigger-text${selected ? '' : ' dropdown__placeholder'}`}>
          {selected?.dot && <span className="dropdown__dot" style={{ background: selected.dot }} aria-hidden="true" />}
          {selected ? selected.label : placeholder}
        </span>
        <ChevronDown size={16} className={`dropdown__chevron${open ? ' dropdown__chevron--open' : ''}`} />
      </button>
      {open && (host ? createPortal(list, host) : list)}
    </div>
  );
}

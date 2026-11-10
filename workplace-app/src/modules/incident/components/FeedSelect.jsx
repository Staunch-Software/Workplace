import { useEffect, useRef, useState } from 'react';
import { ChevronDown } from 'lucide-react';

// The dropdown the DRS feed uses for its filters: a button that opens a list with a "reset" row on top.
export default function FeedSelect({ value, onChange, options, placeholder }) {
  const [open, setOpen] = useState(false);
  const ref = useRef(null);

  useEffect(() => {
    const onDown = (e) => { if (ref.current && !ref.current.contains(e.target)) setOpen(false); };
    document.addEventListener('mousedown', onDown);
    return () => document.removeEventListener('mousedown', onDown);
  }, []);

  const selected = options.find((o) => o.value === value);

  return (
    <div ref={ref} className="inc-sel">
      <button type="button" onClick={() => setOpen(!open)} className={`inc-sel__trigger${value ? ' inc-sel__trigger--has' : ''}`}>
        <span className="inc-sel__label">{selected ? selected.label : placeholder}</span>
        <ChevronDown size={14} className={`inc-sel__chev${open ? ' inc-sel__chev--open' : ''}`} />
      </button>
      {open && (
        <div className="inc-sel__menu">
          <div className="inc-sel__reset" onClick={() => { onChange(''); setOpen(false); }}>{placeholder}</div>
          {options.map((o) => (
            <div key={o.value} onClick={() => { onChange(o.value); setOpen(false); }}
                 className={`inc-sel__item${value === o.value ? ' inc-sel__item--on' : ''}`}>{o.label}</div>
          ))}
        </div>
      )}
    </div>
  );
}

// --- START OF FILE Select.jsx (FINAL VERSION FOR MODERN BROWSERS) ---

import React from 'react';
import '../../styles/components.css';

export default function Select({ children, value, onChange, className = "", ...props }) {
  return (
    // 🔥 FINAL FIX: Wrap the <select> in a div with high z-index and position: relative
    // This forces the dropdown list to open on top of any layered cards/sections.
    <div style={{ position: 'relative', zIndex: 99999 }}> 
      <select 
        className={`select ${className}`}
        value={value}
        // onChange function now correctly passes only the value
        onChange={(e) => onChange && onChange(e.target.value)}
        {...props}
      >
        {children}
      </select>
    </div>
  );
}

// --- END OF FILE Select.jsx ---
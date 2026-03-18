import React from 'react';
import '../../styles/components.css';

export default function Checkbox({ checked, onChange, className = "", ...props }) {
  return (
    <input 
      type="checkbox"
      className={`checkbox ${className}`}
      checked={checked}
      onChange={(e) => onChange && onChange(e.target.checked)}
      {...props}
    />
  );
}
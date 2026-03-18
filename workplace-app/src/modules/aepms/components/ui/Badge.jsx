import React from 'react';
import '../../styles/components.css';

export default function Badge({ children, variant = "default", className = "" }) {
  return (
    <span className={`badge badge-${variant} ${className}`}>
      {children}
    </span>
  );
}
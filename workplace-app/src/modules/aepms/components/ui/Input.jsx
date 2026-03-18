import React from 'react';
import '../../styles/components.css';

export default function Input({ className = "", ...props }) {
  return (
    <input className={`input ${className}`} {...props} />
  );
}
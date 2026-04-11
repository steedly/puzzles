// Copyright (c) 2025-2026 Drew Steedly. All rights reserved.
// Licensed under the MIT License. See LICENSE file in the project root.

export default function GoldMedal({ className = '', title = 'Optimal solution' }) {
  return (
    <svg
      className={`gold-medal ${className}`.trim()}
      viewBox="0 0 24 24"
      width="1em"
      height="1em"
      role="img"
      aria-label={title}
    >
      <title>{title}</title>
      <circle cx="12" cy="13" r="9" fill="#7a5a00" />
      <circle cx="12" cy="13" r="8" fill="#d99a1a" />
      <circle cx="12" cy="13" r="7" fill="#ffcc33" />
      <circle cx="12" cy="11" r="4.8" fill="#fff0a8" opacity="0.55" />
      <path
        d="M12 8.8 L13.25 11.8 L16.4 11.8 L13.85 13.65 L14.85 16.7 L12 14.8 L9.15 16.7 L10.15 13.65 L7.6 11.8 L10.75 11.8 Z"
        fill="#7a5a00"
      />
    </svg>
  );
}

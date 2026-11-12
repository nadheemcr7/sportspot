import React, { useState } from 'react';

interface TurfImageProps {
  src?: string;
  alt: string;
  variant?: 'hero' | 'football' | 'cricket';
  className?: string;
}

const FALLBACK_SVG_BY_VARIANT: Record<'hero' | 'football' | 'cricket', string> = {
  hero: `data:image/svg+xml;utf8,${encodeURIComponent(`
    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1200 720" width="1200" height="720">
      <defs>
        <linearGradient id="sky" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stop-color="#050811"/>
          <stop offset="55%" stop-color="#0B192C"/>
          <stop offset="100%" stop-color="#0F3822"/>
        </linearGradient>
        <linearGradient id="turf" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0%" stop-color="#14532D"/>
          <stop offset="50%" stop-color="#166534"/>
          <stop offset="100%" stop-color="#064E3B"/>
        </linearGradient>
        <radialGradient id="floodL" cx="0.2" cy="0.15" r="0.45">
          <stop offset="0%" stop-color="#ECFCCB" stop-opacity="0.55"/>
          <stop offset="40%" stop-color="#A3E635" stop-opacity="0.18"/>
          <stop offset="100%" stop-color="#050811" stop-opacity="0"/>
        </radialGradient>
        <radialGradient id="floodR" cx="0.8" cy="0.15" r="0.45">
          <stop offset="0%" stop-color="#ECFCCB" stop-opacity="0.55"/>
          <stop offset="40%" stop-color="#A3E635" stop-opacity="0.18"/>
          <stop offset="100%" stop-color="#050811" stop-opacity="0"/>
        </radialGradient>
      </defs>
      <rect width="1200" height="720" fill="url(#sky)"/>
      <rect width="1200" height="720" fill="url(#floodL)"/>
      <rect width="1200" height="720" fill="url(#floodR)"/>
      <circle cx="240" cy="105" r="18" fill="#FEF9C3"/>
      <circle cx="960" cy="105" r="18" fill="#FEF9C3"/>
      <polygon points="80,410 1120,410 1200,720 0,720" fill="url(#turf)"/>
      <polygon points="160,440 1040,440 1140,690 60,690" fill="none" stroke="#A3E635" stroke-opacity="0.55" stroke-width="3"/>
      <line x1="600" y1="440" x2="600" y2="690" stroke="#A3E635" stroke-opacity="0.55" stroke-width="3"/>
      <ellipse cx="600" cy="565" rx="115" ry="48" fill="none" stroke="#A3E635" stroke-opacity="0.55" stroke-width="3"/>
      <rect x="520" y="365" width="160" height="75" fill="none" stroke="#E2E8F0" stroke-opacity="0.65" stroke-width="4"/>
    </svg>
  `)}`,
  football: `data:image/svg+xml;utf8,${encodeURIComponent(`
    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 800 500" width="800" height="500">
      <defs>
        <linearGradient id="bg1" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0%" stop-color="#06281E"/>
          <stop offset="50%" stop-color="#14532D"/>
          <stop offset="100%" stop-color="#091526"/>
        </linearGradient>
      </defs>
      <rect width="800" height="500" fill="url(#bg1)"/>
      <rect x="55" y="45" width="690" height="410" rx="8" fill="none" stroke="#A3E635" stroke-opacity="0.5" stroke-width="3"/>
      <line x1="400" y1="45" x2="400" y2="455" stroke="#A3E635" stroke-opacity="0.5" stroke-width="3"/>
      <circle cx="400" cy="250" r="68" fill="none" stroke="#A3E635" stroke-opacity="0.5" stroke-width="3"/>
      <rect x="55" y="150" width="95" height="200" fill="none" stroke="#A3E635" stroke-opacity="0.5" stroke-width="3"/>
      <rect x="650" y="150" width="95" height="200" fill="none" stroke="#A3E635" stroke-opacity="0.5" stroke-width="3"/>
    </svg>
  `)}`,
  cricket: `data:image/svg+xml;utf8,${encodeURIComponent(`
    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 800 500" width="800" height="500">
      <defs>
        <linearGradient id="bg2" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0%" stop-color="#0A192F"/>
          <stop offset="55%" stop-color="#114B3E"/>
          <stop offset="100%" stop-color="#06281E"/>
        </linearGradient>
      </defs>
      <rect width="800" height="500" fill="url(#bg2)"/>
      <ellipse cx="400" cy="250" rx="330" ry="195" fill="none" stroke="#38BDF8" stroke-opacity="0.45" stroke-width="3" stroke-dasharray="10 6"/>
      <rect x="355" y="120" width="90" height="260" rx="4" fill="#D97706" fill-opacity="0.28" stroke="#FBBF24" stroke-opacity="0.65" stroke-width="2.5"/>
      <line x1="365" y1="145" x2="435" y2="145" stroke="#F8FAFC" stroke-width="2.5"/>
      <line x1="365" y1="355" x2="435" y2="355" stroke="#F8FAFC" stroke-width="2.5"/>
    </svg>
  `)}`,
};

export const TurfImage: React.FC<TurfImageProps> = ({
  src,
  alt,
  variant = 'football',
  className = '',
}) => {
  const fallbackDataUri = FALLBACK_SVG_BY_VARIANT[variant];
  const [imgSrc, setImgSrc] = useState<string>(
    !src || src.startsWith('/src/assets/') ? fallbackDataUri : src
  );

  return (
    <img
      src={imgSrc}
      alt={alt}
      referrerPolicy="no-referrer"
      onError={() => {
        if (imgSrc !== fallbackDataUri) {
          setImgSrc(fallbackDataUri);
        }
      }}
      className={className}
    />
  );
};

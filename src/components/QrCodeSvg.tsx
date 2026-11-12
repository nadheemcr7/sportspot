import React from 'react';
import { generateDeterministicQrMatrix } from '../utils/bookingEngine';

interface QrCodeSvgProps {
  value: string;
  size?: number;
  label?: string;
}

export const QrCodeSvg: React.FC<QrCodeSvgProps> = ({ value, size = 188, label }) => {
  const matrix = React.useMemo(() => generateDeterministicQrMatrix(value, 25), [value]);
  const moduleCount = matrix.length;
  const quietZone = 2;
  const totalModules = moduleCount + quietZone * 2;

  return (
    <div className="inline-flex flex-col items-center bg-white p-3 rounded-xl border border-slate-200 shadow-sm">
      <svg
        width={size}
        height={size}
        viewBox={`0 0 ${totalModules} ${totalModules}`}
        shapeRendering="crispEdges"
        role="img"
        aria-label={label || 'UPI Payment QR Code'}
      >
        <rect width={totalModules} height={totalModules} fill="#FFFFFF" />
        {matrix.map((row, rIdx) =>
          row.map((cell, cIdx) =>
            cell ? (
              <rect
                key={`${rIdx}-${cIdx}`}
                x={cIdx + quietZone}
                y={rIdx + quietZone}
                width={1}
                height={1}
                fill="#090D16"
              />
            ) : null
          )
        )}
      </svg>
      {label && (
        <span className="mt-1.5 text-[11px] font-mono font-semibold text-slate-700 tracking-tight">
          {label}
        </span>
      )}
    </div>
  );
};

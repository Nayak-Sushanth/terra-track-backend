import React from 'react';

interface MetricTileProps {
  label: string;
  value: string | number;
  delta?: string;
  deltaTone?: 'neutral' | 'positive' | 'negative' | 'telemetry';
  subtext?: string;
  onClick?: () => void;
}

export const MetricTile: React.FC<MetricTileProps> = ({
  label,
  value,
  delta,
  deltaTone = 'neutral',
  subtext,
  onClick,
}) => {
  const toneClass = {
    neutral: 'text-[#52627A]',
    positive: 'text-[#15803D]',
    negative: 'text-[#DC2626]',
    telemetry: 'text-[#0F766E]',
  }[deltaTone];

  const Wrapper = onClick ? 'button' : 'div';

  return (
    <Wrapper
      type={onClick ? 'button' : undefined}
      onClick={onClick}
      className={`w-full text-left p-4 ${
        onClick ? 'neu-card-interactive cursor-pointer' : 'neu-card'
      }`}
    >
      <div className="label-caps text-[#718096] truncate">{label}</div>
      <div className="mt-2 text-[24px] font-bold leading-7 tracking-[-0.025em] text-[#17243A] tabular-nums">
        {value}
      </div>
      {(delta || subtext) && (
        <div className="mt-2.5 flex items-center justify-between gap-2 border-t neu-divider pt-2 font-mono text-[11px] leading-4">
          {delta && <span className={`font-semibold truncate ${toneClass}`}>{delta}</span>}
          {subtext && <span className="text-[#718096] truncate">{subtext}</span>}
        </div>
      )}
    </Wrapper>
  );
};

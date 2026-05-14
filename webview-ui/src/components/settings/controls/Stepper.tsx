import { useCallback } from 'react';

import { stepperNext, stepperPrev } from './stepperUtils.js';

interface StepperProps {
  value: number;
  min: number;
  max: number;
  step: number;
  precision?: number;
  ariaLabel?: string;
  onChange: (v: number) => void;
}

export function Stepper({ value, min, max, step, precision, ariaLabel, onChange }: StepperProps) {
  const displayPrecision = precision ?? (step.toString().split('.')[1] ?? '').length;
  const onPrev = useCallback(
    () => onChange(stepperPrev(value, step, min, max)),
    [value, step, min, max, onChange],
  );
  const onNext = useCallback(
    () => onChange(stepperNext(value, step, min, max)),
    [value, step, min, max, onChange],
  );

  return (
    <div style={{ display: 'inline-flex', alignItems: 'center', gap: 12 }} aria-label={ariaLabel}>
      <button
        type="button"
        onClick={onPrev}
        disabled={value <= min}
        style={{
          background: 'var(--pixel-bg)',
          border: '2px solid var(--pixel-border)',
          fontSize: 12,
          padding: '0 8px',
          cursor: value <= min ? 'not-allowed' : 'pointer',
          opacity: value <= min ? 0.5 : 1,
        }}
      >
        −
      </button>
      <span style={{ minWidth: 40, textAlign: 'center', fontVariantNumeric: 'tabular-nums' }}>
        {value.toFixed(displayPrecision)}
      </span>
      <button
        type="button"
        onClick={onNext}
        disabled={value >= max}
        style={{
          background: 'var(--pixel-bg)',
          border: '2px solid var(--pixel-border)',
          fontSize: 12,
          padding: '0 8px',
          cursor: value >= max ? 'not-allowed' : 'pointer',
          opacity: value >= max ? 0.5 : 1,
        }}
      >
        +
      </button>
    </div>
  );
}

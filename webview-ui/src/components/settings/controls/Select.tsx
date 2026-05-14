interface SelectOption<T extends string> {
  value: T;
  label: string;
}

interface SelectProps<T extends string> {
  value: T;
  options: SelectOption<T>[];
  ariaLabel?: string;
  onChange: (v: T) => void;
}

export function Select<T extends string>({ value, options, ariaLabel, onChange }: SelectProps<T>) {
  return (
    <select
      value={value}
      onChange={(e) => onChange(e.target.value as T)}
      aria-label={ariaLabel}
      style={{
        background: 'var(--pixel-bg)',
        color: 'inherit',
        border: '2px solid var(--pixel-border)',
        padding: '4px 8px',
        fontSize: 12,
        cursor: 'pointer',
      }}
    >
      {options.map((o) => (
        <option key={o.value} value={o.value}>
          {o.label}
        </option>
      ))}
    </select>
  );
}

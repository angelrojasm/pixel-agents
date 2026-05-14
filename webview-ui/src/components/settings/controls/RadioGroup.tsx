interface RadioOption<T extends string> {
  value: T;
  label: string;
}

interface RadioGroupProps<T extends string> {
  value: T;
  options: RadioOption<T>[];
  ariaLabel?: string;
  onChange: (v: T) => void;
}

export function RadioGroup<T extends string>({
  value,
  options,
  ariaLabel,
  onChange,
}: RadioGroupProps<T>) {
  return (
    <div
      role="radiogroup"
      aria-label={ariaLabel}
      style={{ display: 'inline-flex', gap: 16, flexWrap: 'wrap' }}
    >
      {options.map((o) => (
        <label
          key={o.value}
          style={{ display: 'inline-flex', gap: 6, alignItems: 'center', cursor: 'pointer' }}
        >
          <input
            type="radio"
            checked={value === o.value}
            onChange={() => onChange(o.value)}
            style={{ accentColor: 'var(--pixel-accent)' }}
          />
          <span>{o.label}</span>
        </label>
      ))}
    </div>
  );
}

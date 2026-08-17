import type { InputHTMLAttributes, Ref } from 'react';

interface InputProps extends InputHTMLAttributes<HTMLInputElement> {
  ref?: Ref<HTMLInputElement>;
}

/** Pixel-styled text input: solid dark background, 2px border, sharp corners. */
export function Input({ className = '', ...rest }: InputProps) {
  return (
    <input
      {...rest}
      className={`w-full box-border px-8 py-6 bg-bg-dark border-2 border-border rounded-none text-text text-sm outline-none ${className}`}
    />
  );
}

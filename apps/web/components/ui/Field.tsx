'use client';

import { forwardRef, useId, type InputHTMLAttributes, type ReactNode } from 'react';

interface FieldProps extends InputHTMLAttributes<HTMLInputElement> {
  label?: string;
  error?: string | undefined;
  hint?: ReactNode;
  suffix?: ReactNode;
}

export const Field = forwardRef<HTMLInputElement, FieldProps>(function Field(
  { label, error, hint, suffix, className, ...rest },
  ref,
) {
  const id = useId();
  const describedBy = error ? `${id}-error` : hint ? `${id}-hint` : undefined;

  return (
    <div className={className}>
      {label ? (
        <label className="label" htmlFor={id}>
          {label}
        </label>
      ) : null}
      <div className="relative">
        <input
          ref={ref}
          id={id}
          aria-invalid={error ? true : undefined}
          aria-describedby={describedBy}
          className={`field ${error ? 'field-error' : ''} ${suffix ? 'pr-9' : ''}`}
          {...rest}
        />
        {suffix ? (
          <div className="absolute top-0 right-1 flex h-full items-center" style={{ color: 'var(--text-faint)' }}>
            {suffix}
          </div>
        ) : null}
      </div>
      {error ? (
        <p id={`${id}-error`} className="mt-1.5 text-[0.75rem]" style={{ color: 'var(--color-rust)' }} role="alert">
          {error}
        </p>
      ) : hint ? (
        <p id={`${id}-hint`} className="mt-1.5 text-[0.75rem]" style={{ color: 'var(--text-faint)' }}>
          {hint}
        </p>
      ) : null}
    </div>
  );
});

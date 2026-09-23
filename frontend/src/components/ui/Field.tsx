import type { InputHTMLAttributes, ReactNode, SelectHTMLAttributes } from 'react'
import { useId } from 'react'
import styles from './Field.module.css'

interface FieldWrapperProps {
  label: string
  htmlFor: string
  hint?: string
  error?: string
  children: ReactNode
}

function FieldWrapper({ label, htmlFor, hint, error, children }: FieldWrapperProps) {
  return (
    <div className={styles.field}>
      <label className={styles.label} htmlFor={htmlFor}>
        {label}
      </label>
      {children}
      {error ? (
        <p className={styles.error} role="alert">
          {error}
        </p>
      ) : (
        hint && <p className={styles.hint}>{hint}</p>
      )}
    </div>
  )
}

interface InputProps extends InputHTMLAttributes<HTMLInputElement> {
  label: string
  hint?: string
  error?: string
}

/** Campo de texto com label, hint e mensagem de erro acessíveis. */
export function Input({ label, hint, error, id, className, ...props }: InputProps) {
  const generatedId = useId()
  const inputId = id ?? generatedId
  return (
    <FieldWrapper label={label} htmlFor={inputId} hint={hint} error={error}>
      <input
        id={inputId}
        className={[styles.control, error ? styles.invalid : '', className ?? '']
          .filter(Boolean)
          .join(' ')}
        aria-invalid={error ? true : undefined}
        {...props}
      />
    </FieldWrapper>
  )
}

export interface SelectOption {
  value: string
  label: string
  disabled?: boolean
}

interface SelectProps extends SelectHTMLAttributes<HTMLSelectElement> {
  label: string
  options: SelectOption[]
  hint?: string
  error?: string
  placeholder?: string
}

/** Campo de seleção nativo (acessível) com opções. */
export function Select({
  label,
  options,
  hint,
  error,
  placeholder,
  id,
  className,
  ...props
}: SelectProps) {
  const generatedId = useId()
  const selectId = id ?? generatedId
  return (
    <FieldWrapper label={label} htmlFor={selectId} hint={hint} error={error}>
      <select
        id={selectId}
        className={[styles.control, styles.select, error ? styles.invalid : '', className ?? '']
          .filter(Boolean)
          .join(' ')}
        aria-invalid={error ? true : undefined}
        {...props}
      >
        {placeholder && (
          <option value="" disabled>
            {placeholder}
          </option>
        )}
        {options.map((option) => (
          <option key={option.value} value={option.value} disabled={option.disabled}>
            {option.label}
          </option>
        ))}
      </select>
    </FieldWrapper>
  )
}
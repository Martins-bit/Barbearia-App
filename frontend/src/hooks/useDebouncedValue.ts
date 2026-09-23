import { useEffect, useState } from 'react'

/**
 * Retorna o valor após um atraso sem alterações. Útil para buscas e filtros
 * que não devem disparar a cada tecla.
 */
export function useDebouncedValue<T>(value: T, delayMs = 300): T {
  const [debounced, setDebounced] = useState(value)

  useEffect(() => {
    const timer = window.setTimeout(() => setDebounced(value), delayMs)
    return () => window.clearTimeout(timer)
  }, [value, delayMs])

  return debounced
}
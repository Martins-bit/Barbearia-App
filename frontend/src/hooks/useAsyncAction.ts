import { useCallback, useRef, useState } from 'react'

export interface AsyncAction<TArgs extends unknown[], TResult> {
  /** Executa a ação. Propaga o erro após registrar `loading`/`error`. */
  run: (...args: TArgs) => Promise<TResult>
  loading: boolean
  error: unknown
  reset: () => void
}

/**
 * Ação assíncrona que altera estado no servidor (criar/cancelar). Expõe
 * `loading` para bloquear reenvio e captura o erro para que a tela o apresente
 * (mensagem vinda do backend, quando existir).
 */
export function useAsyncAction<TArgs extends unknown[], TResult>(
  action: (...args: TArgs) => Promise<TResult>,
): AsyncAction<TArgs, TResult> {
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<unknown>(null)
  const actionRef = useRef(action)
  actionRef.current = action

  const run = useCallback(async (...args: TArgs) => {
    setLoading(true)
    setError(null)
    try {
      return await actionRef.current(...args)
    } catch (caught: unknown) {
      setError(caught)
      throw caught
    } finally {
      setLoading(false)
    }
  }, [])

  const reset = useCallback(() => setError(null), [])

  return { run, loading, error, reset }
}
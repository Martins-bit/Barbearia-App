import { useCallback, useEffect, useRef, useState } from 'react'
import { ApiError } from '../services/api/ApiError'

export interface ApiResource<T> {
  data: T | null
  loading: boolean
  error: ApiError | null
  /** Recarrega mantendo o estado de carregamento (usado em retentativas). */
  reload: () => void
}

function toApiError(error: unknown): ApiError {
  if (error instanceof ApiError) return error
  return new ApiError('Ocorreu um erro inesperado.', 0)
}

/**
 * Executa uma requisição da camada de API e expõe loading/erro/dados de forma
 * previsível. `key` identifica a requisição: quando muda, a anterior é
 * descartada (resposta obsoleta nunca sobrescreve a atual) e uma nova chamada
 * é disparada. Trata também o cancelamento por AbortSignal e o desmonte.
 */
export function useApiResource<T>(
  key: string | null,
  request: (signal: AbortSignal) => Promise<T>,
): ApiResource<T> {
  const [data, setData] = useState<T | null>(null)
  const [loading, setLoading] = useState(key !== null)
  const [error, setError] = useState<ApiError | null>(null)
  const [attempt, setAttempt] = useState(0)

  // Mantém a função mais recente sem reexecutar o efeito a cada render.
  const requestRef = useRef(request)
  requestRef.current = request

  // Limpeza SÍNCRONA ao trocar de chave (padrão "reset state on prop change").
  // Precisa acontecer no render: se a limpeza ficasse dentro do efeito, ela
  // executaria DEPOIS e apagaria a resposta que acabou de chegar (inclusive no
  // duplo-render de verificação do StrictMode), deixando a tela sem dados.
  const [chaveAnterior, setChaveAnterior] = useState(key)
  if (chaveAnterior !== key) {
    setChaveAnterior(key)
    setData(null)
    setError(null)
    setLoading(key !== null)
  }

  useEffect(() => {
    if (key === null) return

    const controller = new AbortController()
    let active = true

    setLoading(true)
    setError(null)

    requestRef
      .current(controller.signal)
      .then((result) => {
        if (!active) return
        setData(result)
        setLoading(false)
      })
      .catch((caught: unknown) => {
        if (!active || controller.signal.aborted) return
        setData(null)
        setError(toApiError(caught))
        setLoading(false)
      })

    return () => {
      active = false
      controller.abort()
    }
  }, [key, attempt])

  const reload = useCallback(() => setAttempt((value) => value + 1), [])

  return { data, loading, error, reload }
}
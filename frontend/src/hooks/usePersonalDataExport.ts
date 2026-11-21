import { useCallback, useEffect, useRef, useState } from 'react'
import { useToast } from '../contexts/useToast'
import { ApiError } from '../services/api/ApiError'
import { authService } from '../services/api/authService'
import { subscribeToAuthSessionChanges } from '../services/api/http'
import {
  downloadJsonStream,
  PersonalDataExportTooLargeError,
  personalDataExportFilename,
  type PersonalDataDownloadPhase,
} from '../utils/downloadJson'
import { JsonStreamValidationError } from '../utils/jsonStreamValidator'

function isAbortError(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    'name' in error &&
    error.name === 'AbortError'
  )
}

function exportErrorMessage(error: unknown): string {
  if (error instanceof PersonalDataExportTooLargeError) {
    return 'O arquivo excede 10 MiB. Use um navegador compatível com gravação progressiva para baixar esta exportação.'
  }
  if (error instanceof JsonStreamValidationError) {
    return 'O arquivo recebido está incompleto ou inválido. Tente exportar novamente.'
  }

  if (error instanceof ApiError) {
    if (error.status === 401) {
      return 'Sua sessão expirou. Entre novamente para exportar seus dados.'
    }
    if (error.status === 403) {
      return 'Sua conta não tem permissão para exportar estes dados.'
    }
    if (error.status === 409) {
      return 'Já existe uma exportação em andamento. Aguarde e tente novamente.'
    }
    if (error.status === 503) {
      return 'A exportação está temporariamente indisponível. Tente novamente em alguns instantes.'
    }
    return error.message
  }

  return 'Não foi possível concluir o download dos seus dados. Tente novamente.'
}

export function usePersonalDataExport() {
  const toast = useToast()
  const [phase, setPhase] = useState<PersonalDataDownloadPhase | null>(null)
  const activeController = useRef<AbortController | null>(null)
  const mounted = useRef(false)

  useEffect(() => {
    mounted.current = true
    const unsubscribe = subscribeToAuthSessionChanges(() => {
      activeController.current?.abort()
    })

    return () => {
      mounted.current = false
      unsubscribe()
      activeController.current?.abort()
    }
  }, [])

  const start = useCallback(() => {
    if (activeController.current) return

    const controller = new AbortController()
    activeController.current = controller
    setPhase('choosing')

    let operation: Promise<'saved' | 'started'>
    try {
      operation = downloadJsonStream(
        (signal) => authService.exportPersonalData(signal),
        personalDataExportFilename(),
        controller.signal,
        (nextPhase) => {
          if (mounted.current && activeController.current === controller) {
            setPhase(nextPhase)
          }
        },
      )
    } catch (error) {
      operation = Promise.reject(error)
    }

    void operation
      .then((result) => {
        if (!mounted.current || activeController.current !== controller) return
        toast.success(
          result === 'saved'
            ? 'Sua cópia JSON foi salva.'
            : 'O download da sua cópia JSON foi iniciado.',
          'Dados exportados',
        )
      })
      .catch((error: unknown) => {
        if (!mounted.current || activeController.current !== controller) return
        if (isAbortError(error)) return
        if (controller.signal.aborted && !(error instanceof ApiError)) return
        toast.error(exportErrorMessage(error), 'Falha ao exportar')
      })
      .finally(() => {
        if (activeController.current === controller) {
          activeController.current = null
        }
        if (mounted.current) setPhase(null)
      })
  }, [toast])

  const cancel = useCallback(() => {
    activeController.current?.abort()
  }, [])

  return {
    phase,
    isExporting: phase !== null,
    canCancel: phase === 'downloading',
    start,
    cancel,
  }
}

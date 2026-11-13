import { ApiError } from '../../services/api/ApiError.ts'
import type {
  CategoriaSolicitacaoTitular,
  SolicitacaoTitular,
  StatusSolicitacaoTitular,
} from '../../types/domain'

export const privacyRequestCategories: ReadonlyArray<{
  value: CategoriaSolicitacaoTitular
  label: string
}> = [
  { value: 'ACESSO_EXPORTACAO', label: 'Acesso e exportação' },
  { value: 'CORRECAO', label: 'Correção' },
  {
    value: 'EXCLUSAO_ANONIMIZACAO',
    label: 'Exclusão ou anonimização',
  },
  { value: 'OUTRA', label: 'Outras solicitações' },
]

export interface PrivacyRequestAttempt {
  categoria: CategoriaSolicitacaoTitular
  idempotencyKey: string
}

export class PrivacyRequestSubmissionGuard {
  private submitting = false

  acquire(): boolean {
    if (this.submitting) return false
    this.submitting = true
    return true
  }

  release(): void {
    this.submitting = false
  }
}

export function getOrCreatePrivacyRequestAttempt(
  categoria: CategoriaSolicitacaoTitular,
  current: PrivacyRequestAttempt | null,
  generateKey: () => string = () => globalThis.crypto.randomUUID(),
): PrivacyRequestAttempt {
  if (current?.categoria === categoria) return current
  return { categoria, idempotencyKey: generateKey() }
}

export function privacyRequestCategoryLabel(
  categoria: CategoriaSolicitacaoTitular,
): string {
  return (
    privacyRequestCategories.find((option) => option.value === categoria)?.label ??
    categoria
  )
}

export function privacyRequestStatusLabel(
  status: StatusSolicitacaoTitular,
): string {
  if (status === 'RECEBIDA') return 'Recebida'
  return status
}

export function formatPrivacyRequestDate(value: string): string {
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return value

  return new Intl.DateTimeFormat('pt-BR', {
    dateStyle: 'short',
    timeStyle: 'short',
  }).format(date)
}

export function privacyRequestErrorMessage(error: unknown): string {
  if (error instanceof ApiError) {
    if (error.status === 401) {
      return 'Sua sessão expirou. Entre novamente para consultar ou registrar solicitações.'
    }
    if (error.status === 403) {
      return 'Sua conta não tem permissão para acessar este recurso.'
    }
    return error.message
  }

  return 'Não foi possível concluir a operação. Tente novamente.'
}

export function privacyRequestCreatedMessage(
  request: Pick<SolicitacaoTitular, 'status'>,
): string {
  return request.status === 'RECEBIDA'
    ? 'Sua solicitação foi registrada. “Recebida” confirma apenas o registro, não a análise ou conclusão do pedido.'
    : 'Sua solicitação foi registrada.'
}

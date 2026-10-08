import { useEffect, useState } from 'react'
import { messagesBadge } from '../services/api/messagesBadge'

/** Observa o total de mensagens não lidas (fonte única: messagesBadge). */
export function useMensagensNaoLidas(): number {
  const [total, setTotal] = useState(messagesBadge.get())
  useEffect(() => messagesBadge.subscribe(setTotal), [])
  return total
}

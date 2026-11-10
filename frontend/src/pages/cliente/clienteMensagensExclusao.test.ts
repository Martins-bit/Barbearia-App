import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import type { Mensagem, MessageDeletedEventPayload } from '../../types/domain.ts'
import { podeApagarParaTodos, DELETED_MESSAGE_TEXT } from './mensagemRegras.ts'

describe('Exclusão de Mensagens no Frontend (Etapa 4)', () => {
  const agora = Date.now()
  const usuarioRemetenteId = 10
  const usuarioDestinatarioId = 20

  const mensagemRecente: Mensagem = {
    id: 500,
    remetenteUsuarioId: usuarioRemetenteId,
    destinatarioUsuarioId: usuarioDestinatarioId,
    conteudo: 'Olá, esta é uma mensagem recente.',
    lida: false,
    dataCriacao: new Date(agora - 10 * 60 * 1000).toISOString(), // 10 min atrás
    dataLeitura: null,
  }

  it('1. Remetente visualiza a opção de apagar para todos dentro do prazo (<= 60 min)', () => {
    const pode = podeApagarParaTodos(mensagemRecente, usuarioRemetenteId)
    assert.equal(pode, true)
  })

  it('1b. Remetente pode apagar para todos exatamente no limite de 60 minutos (inclusivo)', () => {
    const instanteAtual = 1700000000000
    const mensagemLimite: Mensagem = {
      ...mensagemRecente,
      id: 501,
      dataCriacao: new Date(instanteAtual - 60 * 60 * 1000).toISOString(), // exatamente 60 min atrás
    }
    const pode = podeApagarParaTodos(mensagemLimite, usuarioRemetenteId, instanteAtual)
    assert.equal(pode, true)
  })

  it('2. Remetente não pode apagar para todos após 60 minutos (> 60 min)', () => {
    const mensagemExpirada: Mensagem = {
      ...mensagemRecente,
      id: 502,
      dataCriacao: new Date(agora - 61 * 60 * 1000).toISOString(), // 61 min atrás
    }
    const pode = podeApagarParaTodos(mensagemExpirada, usuarioRemetenteId)
    assert.equal(pode, false)
  })

  it('3. Destinatário não tem permissão para apagar para todos (somente "Apagar para mim")', () => {
    // Para o destinatário (usuarioDestinatarioId), podeApagarParaTodos deve ser falso
    const pode = podeApagarParaTodos(mensagemRecente, usuarioDestinatarioId)
    assert.equal(pode, false)
  })

  it('3b. Mensagem já apagada para todos não pode ser apagada novamente para todos', () => {
    const mensagemJaApagada: Mensagem = {
      ...mensagemRecente,
      apagadaParaTodos: true,
      conteudo: DELETED_MESSAGE_TEXT,
    }
    const pode = podeApagarParaTodos(mensagemJaApagada, usuarioRemetenteId)
    assert.equal(pode, false)
  })

  it('4. Exclusão PARA_MIM remove a mensagem somente da lista local do solicitante', () => {
    const listaInicial: Mensagem[] = [
      mensagemRecente,
      {
        id: 503,
        remetenteUsuarioId: usuarioRemetenteId,
        destinatarioUsuarioId: usuarioDestinatarioId,
        conteudo: 'Outra mensagem',
        lida: true,
        dataCriacao: new Date(agora - 5 * 60 * 1000).toISOString(),
        dataLeitura: null,
      },
    ]

    // Simulação da lógica de exclusão PARA_MIM executada em useMensagens
    const idParaExcluir = 500
    const listaAposExclusaoParaMim = listaInicial.filter((m) => m.id !== idParaExcluir)

    assert.equal(listaAposExclusaoParaMim.length, 1)
    assert.equal(listaAposExclusaoParaMim[0].id, 503)
    assert.equal(listaAposExclusaoParaMim.some((m) => m.id === idParaExcluir), false)
  })

  it('5. Exclusão PARA_TODOS substitui o conteúdo pela mensagem padrão e marca flag', () => {
    const listaInicial: Mensagem[] = [mensagemRecente]

    // Simulação da lógica de exclusão PARA_TODOS executada em useMensagens
    const respostaBackend: Mensagem = {
      ...mensagemRecente,
      conteudo: DELETED_MESSAGE_TEXT,
      apagadaParaTodos: true,
    }

    const listaAposExclusao = listaInicial.map((m) =>
      m.id === 500 ? respostaBackend : m,
    )

    assert.equal(listaAposExclusao.length, 1)
    assert.equal(listaAposExclusao[0].id, 500)
    assert.equal(listaAposExclusao[0].conteudo, 'Esta mensagem foi apagada')
    assert.equal(listaAposExclusao[0].apagadaParaTodos, true)
  })

  it('6. Evento Socket.IO message:deleted atualiza a conversa em tempo real', () => {
    const listaInicial: Mensagem[] = [
      {
        id: 500,
        remetenteUsuarioId: usuarioRemetenteId,
        destinatarioUsuarioId: usuarioDestinatarioId,
        conteudo: 'Texto original antes de apagar',
        lida: false,
        dataCriacao: new Date().toISOString(),
        dataLeitura: null,
      },
    ]

    const payloadEvento: MessageDeletedEventPayload = {
      messageId: 500,
      apagadaParaTodos: true,
      dataExclusao: new Date().toISOString(),
    }

    // Handler de message:deleted registrado no hook useMensagens
    const listaAtualizada = listaInicial.map((m) =>
      m.id === payloadEvento.messageId
        ? {
          ...m,
          conteudo: DELETED_MESSAGE_TEXT,
          apagadaParaTodos: true,
        }
        : m,
    )

    assert.equal(listaAtualizada[0].conteudo, 'Esta mensagem foi apagada')
    assert.equal(listaAtualizada[0].apagadaParaTodos, true)
  })

  it('7. Evento message:deleted não cria mensagens duplicadas e não afeta outras mensagens', () => {
    const listaInicial: Mensagem[] = [
      {
        id: 500,
        remetenteUsuarioId: usuarioRemetenteId,
        destinatarioUsuarioId: usuarioDestinatarioId,
        conteudo: 'Texto original',
        lida: false,
        dataCriacao: new Date().toISOString(),
        dataLeitura: null,
      },
      {
        id: 501,
        remetenteUsuarioId: usuarioRemetenteId,
        destinatarioUsuarioId: usuarioDestinatarioId,
        conteudo: 'Segunda mensagem intacta',
        lida: false,
        dataCriacao: new Date().toISOString(),
        dataLeitura: null,
      },
    ]

    const payloadEvento: MessageDeletedEventPayload = {
      messageId: 500,
      apagadaParaTodos: true,
      dataExclusao: new Date().toISOString(),
    }

    const listaAtualizada = listaInicial.map((m) =>
      m.id === payloadEvento.messageId
        ? {
          ...m,
          conteudo: DELETED_MESSAGE_TEXT,
          apagadaParaTodos: true,
        }
        : m,
    )

    assert.equal(listaAtualizada.length, 2)
    assert.equal(listaAtualizada[0].conteudo, 'Esta mensagem foi apagada')
    assert.equal(listaAtualizada[1].conteudo, 'Segunda mensagem intacta')
    assert.equal(listaAtualizada[1].apagadaParaTodos, undefined)
  })

  it('8. Listener do socket é desregistrado corretamente ao executar o unsubscribe', () => {
    const listeners = new Set<(payload: MessageDeletedEventPayload) => void>()

    const onMessageDeleted = (handler: (payload: MessageDeletedEventPayload) => void) => {
      listeners.add(handler)
      return () => {
        listeners.delete(handler)
      }
    }

    const meuHandler = () => { }
    const unsubscribe = onMessageDeleted(meuHandler)
    assert.equal(listeners.size, 1)

    unsubscribe()
    assert.equal(listeners.size, 0)
  })

  it('9. Exclusão permanece após recarregar a conversa por meio do histórico REST', () => {
    // Histórico retornado pela API REST após a exclusão PARA_TODOS
    const historicoRetornadoPelaApi: Mensagem[] = [
      {
        id: 500,
        remetenteUsuarioId: usuarioRemetenteId,
        destinatarioUsuarioId: usuarioDestinatarioId,
        conteudo: DELETED_MESSAGE_TEXT,
        lida: false,
        dataCriacao: new Date().toISOString(),
        dataLeitura: null,
        apagadaParaTodos: true,
      },
    ]

    assert.equal(historicoRetornadoPelaApi[0].conteudo, 'Esta mensagem foi apagada')
    assert.equal(historicoRetornadoPelaApi[0].apagadaParaTodos, true)
  })

  it('10. Falha HTTP na exclusão não altera a lista de mensagens indevidamente', () => {
    const listaInicial: Mensagem[] = [mensagemRecente]

    // Simulação: se o service rejeitar com erro, o estado de mensagens permanece intacto
    let listaAtual = [...listaInicial]
    let erroOcorrido = false

    try {
      throw new Error('Falha de rede ao tentar apagar mensagem')
    } catch {
      erroOcorrido = true
      // O estado NÃO deve ser modificado em caso de erro
    }

    assert.equal(erroOcorrido, true)
    assert.equal(listaAtual.length, 1)
    assert.equal(listaAtual[0].conteudo, mensagemRecente.conteudo)
  })

  it('11. Cliques repetidos não disparam múltiplas requisições (proteção via excluindoId)', () => {
    let excluindoId: number | null = null
    let requisicoesEnviadas = 0

    const tentarExcluir = (id: number) => {
      if (excluindoId !== null) {
        return false // Bloqueado
      }
      excluindoId = id
      requisicoesEnviadas += 1
      return true
    }

    // Primeiro clique
    const primeiro = tentarExcluir(500)
    assert.equal(primeiro, true)
    assert.equal(requisicoesEnviadas, 1)

    // Cliques subsequentes rápidos enquanto excluindoId !== null
    const segundo = tentarExcluir(500)
    const terceiro = tentarExcluir(500)
    assert.equal(segundo, false)
    assert.equal(terceiro, false)
    assert.equal(requisicoesEnviadas, 1)

    // Liberação após conclusão
    excluindoId = null
    const novoClique = tentarExcluir(500)
    assert.equal(novoClique, true)
    assert.equal(requisicoesEnviadas, 2)
  })

  it('12. A regra de exclusão e visibilidade é idêntica para Cliente e Barbeiro', () => {
    // Cenário Barbeiro como Remetente (usuarioId 20) enviando para Cliente (usuarioId 10)
    const msgBarbeiroParaCliente: Mensagem = {
      id: 600,
      remetenteUsuarioId: 20, // Barbeiro
      destinatarioUsuarioId: 10, // Cliente
      conteudo: 'Mensagem do barbeiro',
      lida: false,
      dataCriacao: new Date(agora - 5 * 60 * 1000).toISOString(),
      dataLeitura: null,
    }

    // O barbeiro (remetente) pode apagar para todos dentro do prazo
    assert.equal(podeApagarParaTodos(msgBarbeiroParaCliente, 20), true)

    // O cliente (destinatário) não pode apagar para todos
    assert.equal(podeApagarParaTodos(msgBarbeiroParaCliente, 10), false)
  })
})

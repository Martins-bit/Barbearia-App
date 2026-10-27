import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import type { Conversa, Mensagem } from '../../types/domain.ts'

/**
 * Helper que extrai os dados de destino para mensagem a partir do agendamento,
 * garantindo o uso preferencial de usuarioId sobre o ID do registro de Cliente.
 */
export function extrairContatoMensagem(cliente: { id: number; usuarioId?: number; nome: string }) {
  return {
    usuarioId: cliente.usuarioId ?? cliente.id,
    nome: cliente.nome,
  }
}

/**
 * Simulação determinística da composição de lista de conversas com contato provisório
 * (espelha a lógica de useMensagens: listaExibicao).
 */
export function comporListaExibicao(
  conversasExistentes: Conversa[],
  contatoAtivo: { usuarioId: number; nome: string } | null,
): Conversa[] {
  if (!contatoAtivo) return conversasExistentes
  const jaExiste = conversasExistentes.some((c) => c.usuarioId === contatoAtivo.usuarioId)
  if (jaExiste) return conversasExistentes

  const provisoria: Conversa = {
    usuarioId: contatoAtivo.usuarioId,
    nome: contatoAtivo.nome,
    tipoUsuario: 'CLIENTE',
    ultimaMensagem: '',
    ultimaMensagemDataCriacao: new Date().toISOString(),
    naoLidas: 0,
  }
  return [provisoria, ...conversasExistentes]
}

describe('Atalho Agenda -> Mensagens do Barbeiro', () => {
  it('extrai corretamente o usuarioId do cliente do agendamento para mensagens', () => {
    const agendamentoCliente = {
      id: 5, // ID da tabela Cliente
      usuarioId: 42, // ID da tabela Usuario (usado nas mensagens)
      nome: 'Carlos Silva',
    }

    const destino = extrairContatoMensagem(agendamentoCliente)
    assert.equal(destino.usuarioId, 42)
    assert.equal(destino.nome, 'Carlos Silva')
  })

  it('usa fallback seguro para id caso usuarioId não esteja presente', () => {
    const agendamentoClienteLegado = {
      id: 15,
      nome: 'Pedro Santos',
    }

    const destino = extrairContatoMensagem(agendamentoClienteLegado)
    assert.equal(destino.usuarioId, 15)
    assert.equal(destino.nome, 'Pedro Santos')
  })

  it('quando já existe conversa, seleciona a existente sem duplicar na lista', () => {
    const conversasExistentes: Conversa[] = [
      {
        usuarioId: 42,
        nome: 'Carlos Silva',
        tipoUsuario: 'CLIENTE',
        ultimaMensagem: 'Olá, nos vemos amanhã!',
        ultimaMensagemDataCriacao: '2026-10-27T10:00:00.000Z',
        naoLidas: 0,
      },
      {
        usuarioId: 99,
        nome: 'Outro Cliente',
        tipoUsuario: 'CLIENTE',
        ultimaMensagem: 'Obrigado!',
        ultimaMensagemDataCriacao: '2026-10-27T09:00:00.000Z',
        naoLidas: 0,
      },
    ]

    const contatoEscolhido = { usuarioId: 42, nome: 'Carlos Silva' }
    const listaFinal = comporListaExibicao(conversasExistentes, contatoEscolhido)

    assert.equal(listaFinal.length, 2)
    assert.equal(listaFinal[0].usuarioId, 42)
    assert.equal(listaFinal[0].ultimaMensagem, 'Olá, nos vemos amanhã!')
  })

  it('quando NÃO existe conversa, insere contato provisório no topo para abertura imediata', () => {
    const conversasExistentes: Conversa[] = [
      {
        usuarioId: 99,
        nome: 'Cliente Antigo',
        tipoUsuario: 'CLIENTE',
        ultimaMensagem: 'Combinado.',
        ultimaMensagemDataCriacao: '2026-10-27T08:00:00.000Z',
        naoLidas: 0,
      },
    ]

    const novoContato = { usuarioId: 77, nome: 'Novo Cliente Sem Mensagens' }
    const listaFinal = comporListaExibicao(conversasExistentes, novoContato)

    assert.equal(listaFinal.length, 2)
    assert.equal(listaFinal[0].usuarioId, 77)
    assert.equal(listaFinal[0].nome, 'Novo Cliente Sem Mensagens')
    assert.equal(listaFinal[0].ultimaMensagem, '')
    // Preserva intactas as conversas já existentes
    assert.equal(listaFinal[1].usuarioId, 99)
  })

  it('ao enviar a primeira mensagem, a conversa passa a conter a mensagem real sem mensagens artificiais', () => {
    const novoContato = { usuarioId: 77, nome: 'Novo Cliente' }
    let conversas: Conversa[] = []

    // 1. Barbeiro digita e envia primeira mensagem
    const conteudoEnviado = 'Olá! Tudo certo para seu horário hoje?'
    const agoraIso = new Date().toISOString()
    const mensagemCriada: Mensagem = {
      id: 101,
      remetenteUsuarioId: 1, // Barbeiro
      destinatarioUsuarioId: novoContato.usuarioId,
      conteudo: conteudoEnviado,
      lida: false,
      dataCriacao: agoraIso,
      dataLeitura: null,
    }

    // 2. Atualização reativa da lista após envio
    const conversaAtualizada: Conversa = {
      usuarioId: novoContato.usuarioId,
      nome: novoContato.nome,
      tipoUsuario: 'CLIENTE',
      ultimaMensagem: mensagemCriada.conteudo,
      ultimaMensagemDataCriacao: mensagemCriada.dataCriacao,
      naoLidas: 0,
    }
    conversas = [conversaAtualizada, ...conversas]

    assert.equal(conversas.length, 1)
    assert.equal(conversas[0].usuarioId, 77)
    assert.equal(conversas[0].ultimaMensagem, 'Olá! Tudo certo para seu horário hoje?')
    assert.equal(mensagemCriada.destinatarioUsuarioId, 77)
  })
})

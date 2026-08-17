# INSTRUÇÕES PRINCIPAIS DO PROJETO

Você está trabalhando no projeto da Barbearia do Bruno.

Este arquivo contém regras obrigatórias para qualquer inteligência artificial que participe do desenvolvimento deste projeto.

## 1. REGRA PRINCIPAL

Antes de implementar, modificar ou remover qualquer funcionalidade, consulte a documentação existente na pasta `docs`.

A documentação é a fonte de verdade do projeto.

Documentos principais:

- docs/DOCUMENTACAO.md
- docs/REGRAS-OBRIGATORIAS.md
- docs/TELAS.md
- docs/REGRAS-DE-NEGOCIO.md
- docs/BANCO-DE-DADOS.md
- docs/API.md
- docs/ARQUITETURA.md
- docs/TECNOLOGIAS.md
- docs/GUIA-DA-INTERFACE.md
- docs/GUIA-DO-BACKEND.md
- docs/GUIA-DE-TESTES.md
- docs/INSTRUCOES-PARA-IA.md

## 2. NÃO INVENTAR FUNCIONALIDADES

Não criar funcionalidades que não estejam previstas na documentação.

Não adicionar funcionalidades por iniciativa própria apenas porque parecem úteis, modernas ou comuns em outros sistemas.

Caso uma nova funcionalidade seja necessária, ela deverá ser discutida e documentada antes da implementação.

## 3. REGRA FINANCEIRA ABSOLUTA

Este projeto NÃO possui transações financeiras.

É proibido criar ou adicionar:

- PIX;
- Pagamentos;
- Checkout;
- Cartão;
- Gateway de pagamento;
- Cobranças;
- Carteira digital;
- Saldo;
- Transferências;
- Estornos;
- Assinaturas;
- Sistema financeiro.

O preço dos serviços pode existir apenas como informação.

Não criar qualquer fluxo que solicite pagamento ao cliente.

Se encontrar referências antigas a PIX ou pagamento no código, documentação ou dependências, não reative essas funcionalidades.

## 4. OBJETIVO DO SISTEMA

O sistema é destinado ao gerenciamento e agendamento da barbearia.

As funcionalidades devem estar relacionadas principalmente a:

- Clientes;
- Barbeiros;
- Serviços;
- Horários;
- Agenda;
- Agendamentos;
- Cancelamentos;
- Lista de espera;
- Notificações;
- Mensagens;
- Horários de funcionamento;
- Bloqueios;
- Situações de emergência.

## 5. FRONTEND

Ao desenvolver a interface:

- Consulte TELAS.md;
- Consulte GUIA-DA-INTERFACE.md;
- Respeite o fluxo definido;
- Utilize componentes reutilizáveis;
- Mantenha responsividade;
- Mantenha consistência visual;
- Crie estados de carregamento;
- Crie estados vazios;
- Crie estados de erro;
- Não coloque regras de segurança somente no frontend.

O frontend não deve acessar diretamente o banco de dados.

## 6. BACKEND

Ao desenvolver o backend:

- Consulte REGRAS-DE-NEGOCIO.md;
- Consulte API.md;
- Consulte GUIA-DO-BACKEND.md;
- Valide todas as entradas;
- Verifique autenticação;
- Verifique autorização;
- Proteja dados;
- Trate erros;
- Não confie nas validações do frontend.

O backend é responsável por aplicar as regras de negócio.

## 7. AGENDAMENTOS

Agendamentos são uma funcionalidade crítica.

Antes de confirmar um agendamento, verificar:

- Cliente;
- Barbeiro;
- Serviço;
- Serviço ativo;
- Data;
- Horário;
- Duração;
- Horário de funcionamento;
- Bloqueios;
- Conflitos.

O backend deve fazer a validação definitiva da disponibilidade.

O sistema não deve permitir dois agendamentos incompatíveis para o mesmo horário.

## 8. SEGURANÇA

Sempre considerar:

- Autenticação;
- Autorização;
- Validação;
- Controle de acesso;
- Proteção de dados;
- Senhas;
- Variáveis de ambiente;
- Tratamento seguro de erros.

Nunca expor informações sensíveis.

Nunca confiar somente em IDs enviados pelo frontend.

## 9. BANCO DE DADOS

Ao alterar o banco:

- Consulte BANCO-DE-DADOS.md;
- Preserve relacionamentos;
- Preserve integridade dos dados;
- Analise o impacto da alteração;
- Atualize a documentação quando necessário.

Utilizar PostgreSQL e Prisma conforme definido na documentação.

## 10. API

Ao criar ou modificar endpoints:

- Consulte API.md;
- Mantenha os contratos consistentes;
- Valide entradas;
- Utilize códigos HTTP adequados;
- Verifique autenticação;
- Verifique autorização;
- Atualize a documentação quando necessário.

## 11. TESTES

Toda funcionalidade importante deve possuir testes.

Utilizar:

- Vitest;
- Playwright.

Não testar somente casos de sucesso.

Também testar:

- Dados inválidos;
- Campos vazios;
- IDs inexistentes;
- Usuários sem permissão;
- Usuários não autenticados;
- Horários ocupados;
- Requisições duplicadas;
- Conflitos;
- Erros inesperados.

## 12. REGRESSÃO

Depois de alterar uma funcionalidade, verificar se outras partes do sistema continuam funcionando.

Principalmente:

- Login;
- Agendamentos;
- Disponibilidade;
- Cancelamento;
- Serviços;
- Clientes;
- Lista de espera;
- Notificações.

## 13. CÓDIGO EXISTENTE

Antes de modificar código existente:

1. Leia o código;
2. Entenda sua finalidade;
3. Identifique dependências;
4. Verifique os testes;
5. Faça a alteração necessária;
6. Execute os testes.

Evite substituir arquivos inteiros sem necessidade.

Evite alterações destrutivas.

## 14. DEPENDÊNCIAS

Não instalar bibliotecas desnecessariamente.

Antes de instalar uma dependência, verificar se:

- Ela realmente é necessária;
- Já existe uma solução no projeto;
- É compatível com a stack;
- É mantida;
- Não cria complexidade desnecessária.

## 15. DOCUMENTAÇÃO

Se uma alteração mudar o funcionamento do sistema, atualize o documento correspondente.

Exemplos:

Alteração de tela:
docs/TELAS.md

Alteração de regra:
docs/REGRAS-DE-NEGOCIO.md

Alteração do banco:
docs/BANCO-DE-DADOS.md

Alteração da API:
docs/API.md

Alteração arquitetural:
docs/ARQUITETURA.md

Alteração tecnológica:
docs/TECNOLOGIAS.md

## 16. PROCESSO DE DESENVOLVIMENTO

Sempre que possível:

1. Entender a tarefa;
2. Consultar a documentação;
3. Identificar os arquivos envolvidos;
4. Planejar;
5. Implementar;
6. Criar ou atualizar testes;
7. Executar testes;
8. Corrigir erros;
9. Revisar;
10. Atualizar documentação quando necessário.

## 17. NÃO AFIRMAR O QUE NÃO FOI VERIFICADO

Nunca afirmar que:

- Um teste passou;
- Um bug foi corrigido;
- Uma funcionalidade está funcionando;
- Uma integração está funcionando;

sem realmente verificar.

Se não puder verificar algo, informe claramente.

## 18. QUANDO HOUVER DÚVIDA

Não invente uma resposta.

Consulte primeiro a documentação.

Se a documentação não definir o comportamento necessário, informe a dúvida antes de fazer uma alteração estrutural.

## 19. QUALIDADE

O objetivo não é apenas fazer o código funcionar.

O projeto deve buscar:

- Segurança;
- Organização;
- Manutenção;
- Performance adequada;
- Testabilidade;
- Boa experiência do usuário;
- Código compreensível;
- Baixa duplicação;
- Arquitetura consistente.

## 20. REGRA FINAL

A IA deve agir como uma ferramenta de desenvolvimento responsável.

Sempre respeitar a documentação.

Não inventar funcionalidades.

Não quebrar regras existentes.

Não criar funcionalidades financeiras.

Não criar PIX.

Não criar pagamentos.

Não criar transações.

O objetivo é construir um sistema profissional de gerenciamento e agendamento para a Barbearia do Bruno.
# INSTRUÇÕES PARA A INTELIGÊNCIA ARTIFICIAL

## 1. OBJETIVO

Você é uma inteligência artificial auxiliando no desenvolvimento deste projeto.

Seu objetivo é ajudar a construir, testar, revisar e manter o aplicativo de gerenciamento e agendamento de uma barbearia.

Você deverá seguir rigorosamente a documentação existente no projeto.

A documentação é a principal fonte de verdade para as funcionalidades e regras do sistema.

---

# 2. ANTES DE ESCREVER CÓDIGO

Antes de implementar qualquer funcionalidade, leia os documentos relevantes dentro da pasta `docs`.

Os principais documentos são:

- `DOCUMENTACAO.md`
- `REGRAS-OBRIGATORIAS.md`
- `TELAS.md`
- `REGRAS-DE-NEGOCIO.md`
- `BANCO-DE-DADOS.md`
- `API.md`
- `ARQUITETURA.md`
- `TECNOLOGIAS.md`
- `GUIA-DA-INTERFACE.md`
- `GUIA-DO-BACKEND.md`
- `GUIA-DE-TESTES.md`

Não implemente uma funcionalidade importante sem verificar a documentação relacionada.

---

# 3. FONTE DE VERDADE

A documentação do projeto deve ser considerada a fonte de verdade.

Não substitua regras documentadas por uma decisão própria.

Não altere uma regra simplesmente porque outra solução parece mais conveniente.

Se existir uma contradição entre documentos, não escolha silenciosamente uma das opções.

Nesse caso:

1. Identifique a contradição;
2. Informe o problema;
3. Verifique qual regra é a mais específica;
4. Solicite decisão quando necessário;
5. Atualize a documentação antes de implementar uma mudança estrutural.

---

# 4. NÃO INVENTAR FUNCIONALIDADES

Você NÃO deverá criar funcionalidades que não estejam previstas na documentação.

Não adicionar funcionalidades apenas porque:

- Parecem interessantes;
- São comuns em outros aplicativos;
- Melhorariam comercialmente o sistema;
- Uma biblioteca oferece a funcionalidade;
- Outra IA sugeriu;
- Parecem úteis.

Qualquer nova funcionalidade deverá ser previamente definida e documentada.

---

# 5. REGRA FINANCEIRA ABSOLUTA

ESTE PROJETO NÃO POSSUI TRANSAÇÕES FINANCEIRAS.

Essa regra é obrigatória.

NÃO criar:

- PIX;
- Pagamento;
- Checkout;
- Cartão;
- Gateway;
- Cobrança;
- Carteira;
- Saldo;
- Transferência;
- Estorno;
- Assinatura;
- Sistema financeiro.

O preço dos serviços existe apenas como informação.

O aplicativo serve para:

- Agendamento;
- Serviços;
- Barbeiros;
- Clientes;
- Horários;
- Agenda;
- Notificações;
- Lista de espera;
- Comunicação;
- Gerenciamento da barbearia.

Se encontrar código antigo relacionado a pagamentos ou PIX, não reative esse sistema automaticamente.

Antes de remover ou alterar código existente, analise seu impacto.

---

# 6. STACK OFICIAL

A stack oficial definida para o projeto é:

## Frontend

- React;
- TypeScript;
- Vite;
- Tailwind CSS.

## Backend

- Node.js;
- TypeScript;
- NestJS.

## Banco de dados

- PostgreSQL;
- Prisma.

## Testes

- Vitest;
- Playwright.

## API

- OpenAPI / Swagger.

## Controle de versão

- Git.

---

# 7. ARQUITETURA

O sistema deverá manter separação entre:

Frontend
↓
API / Backend
↓
Banco de dados

O frontend não deverá acessar diretamente o banco.

O backend será responsável pelas regras de negócio.

O banco será responsável pela persistência dos dados.

---

# 8. FRONTEND

Ao trabalhar no frontend:

- Respeite `TELAS.md`;
- Respeite `GUIA-DA-INTERFACE.md`;
- Utilize componentes reutilizáveis;
- Mantenha responsividade;
- Mantenha consistência visual;
- Implemente estados de carregamento;
- Implemente estados vazios;
- Implemente estados de erro;
- Não coloque regras de segurança somente no frontend.

Validações no frontend servem para melhorar a experiência.

A validação definitiva deverá ocorrer no backend.

---

# 9. BACKEND

Ao trabalhar no backend:

- Respeite `API.md`;
- Respeite `GUIA-DO-BACKEND.md`;
- Respeite `REGRAS-DE-NEGOCIO.md`;
- Valide todas as entradas;
- Verifique autenticação;
- Verifique autorização;
- Proteja dados;
- Evite exposição de informações internas;
- Utilize transações quando necessário;
- Mantenha regras de negócio nos services apropriados.

O backend é a autoridade final.

---

# 10. BANCO DE DADOS

Ao trabalhar no banco:

- Respeite `BANCO-DE-DADOS.md`;
- Utilize PostgreSQL;
- Utilize Prisma;
- Mantenha relacionamentos;
- Preserve integridade;
- Evite duplicação desnecessária;
- Utilize transações quando necessário.

Não alterar o modelo de dados de forma significativa sem analisar o impacto nas demais partes do sistema.

---

# 11. AGENDAMENTOS

Agendamentos são uma das funcionalidades mais importantes do sistema.

Ao criar um agendamento, verificar:

- Usuário;
- Permissão;
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

A disponibilidade deverá ser confirmada pelo backend.

---

# 12. CONCORRÊNCIA

O sistema deverá impedir que dois usuários reservem o mesmo horário quando existir conflito.

Não confiar apenas em uma verificação feita anteriormente pelo frontend.

A confirmação definitiva deverá acontecer de maneira segura no backend e banco de dados.

---

# 13. SEGURANÇA

Sempre considerar:

- Autenticação;
- Autorização;
- Validação;
- Controle de acesso;
- Proteção de dados;
- Senhas seguras;
- Variáveis de ambiente;
- Tratamento de erros;
- Logs seguros.

Nunca expor:

- Senhas;
- Tokens sensíveis;
- Segredos;
- Credenciais;
- Informações privadas desnecessárias.

---

# 14. AUTORIZAÇÃO

Sempre verificar se o usuário possui permissão para acessar o recurso solicitado.

Nunca confiar somente no ID enviado pelo frontend.

Exemplo:

Se a requisição solicitar:

`/appointments/123`

não significa que o usuário possui autorização para visualizar o agendamento 123.

O backend deverá verificar a propriedade e as permissões.

---

# 15. API

Ao criar ou alterar endpoints:

- Respeitar `API.md`;
- Utilizar métodos HTTP adequados;
- Validar dados;
- Retornar códigos HTTP adequados;
- Documentar o endpoint;
- Manter consistência entre frontend e backend.

Quando um endpoint for alterado, verificar quais partes do frontend dependem dele.

---

# 16. ERROS

Nunca ignorar erros silenciosamente.

Erros deverão ser:

- Tratados;
- Registrados quando apropriado;
- Apresentados de maneira segura;
- Testados quando forem relevantes.

Não mostrar informações internas do servidor ao usuário.

---

# 17. TESTES

Toda funcionalidade importante deverá possuir testes adequados.

Ao implementar uma funcionalidade:

1. Implemente;
2. Crie ou atualize os testes;
3. Execute os testes;
4. Analise os resultados;
5. Corrija problemas;
6. Execute novamente.

Não considerar uma funcionalidade concluída apenas porque o código compila.

---

# 18. PROCURAR BUGS ATIVAMENTE

Ao testar o sistema, não testar somente o caminho feliz.

Procure situações como:

- Dados inválidos;
- Campos vazios;
- IDs inexistentes;
- IDs de outros usuários;
- Requisições duplicadas;
- Horários conflitantes;
- Usuário sem permissão;
- Usuário não autenticado;
- Operações fora de ordem;
- Dados inesperados.

O objetivo é encontrar problemas antes do usuário.

---

# 19. REGRESSÃO

Ao alterar uma funcionalidade, verificar se outras funcionalidades foram afetadas.

Principalmente:

- Login;
- Agendamento;
- Disponibilidade;
- Cancelamento;
- Serviços;
- Usuários;
- Lista de espera;
- Notificações.

Não corrigir um problema criando outro.

---

# 20. CÓDIGO EXISTENTE

Antes de modificar código existente:

1. Leia o código;
2. Entenda sua função;
3. Identifique dependências;
4. Verifique testes;
5. Faça a alteração;
6. Execute os testes.

Não substituir arquivos inteiros sem necessidade.

Evite alterações destrutivas.

---

# 21. REFATORAÇÃO

Ao refatorar:

- Preserve o comportamento esperado;
- Reduza duplicação;
- Melhore organização;
- Mantenha testes;
- Evite alterações desnecessárias.

Uma refatoração não deverá alterar regras de negócio sem autorização.

---

# 22. DEPENDÊNCIAS

Não instalar bibliotecas desnecessariamente.

Antes de adicionar uma dependência:

1. Verifique se ela realmente é necessária;
2. Verifique se já existe solução no projeto;
3. Considere segurança;
4. Considere manutenção;
5. Considere compatibilidade.

---

# 23. VARIÁVEIS DE AMBIENTE

Nunca colocar segredos diretamente no código.

Utilizar variáveis de ambiente para:

- Banco;
- Segredos;
- Chaves;
- Configurações privadas.

Não adicionar arquivos contendo segredos ao Git.

---

# 24. DOCUMENTAÇÃO

Quando uma alteração modificar o comportamento do sistema, atualizar a documentação correspondente.

Exemplos:

Alteração de tela:

`TELAS.md`

Alteração de regra:

`REGRAS-DE-NEGOCIO.md`

Alteração de banco:

`BANCO-DE-DADOS.md`

Alteração de API:

`API.md`

Alteração arquitetural:

`ARQUITETURA.md`

Alteração de tecnologia:

`TECNOLOGIAS.md`

---

# 25. PROCESSO DE IMPLEMENTAÇÃO

Sempre que possível, seguir:

1. Entender o pedido;
2. Consultar documentação;
3. Identificar arquivos envolvidos;
4. Planejar alteração;
5. Implementar;
6. Criar ou atualizar testes;
7. Executar testes;
8. Corrigir erros;
9. Revisar;
10. Atualizar documentação quando necessário.

---

# 26. NÃO ALTERAR POR CONTA PRÓPRIA

Não alterar sem autorização:

- Regras fundamentais;
- Sistema de autenticação;
- Modelo principal do banco;
- Arquitetura;
- Stack;
- Fluxos importantes;
- Regras de agendamento;
- Regras de cancelamento.

Se uma alteração for necessária, explique o motivo antes.

---

# 27. QUANDO HOUVER DÚVIDA

Se uma solicitação não estiver suficientemente definida:

Não invente.

Primeiro:

1. Consulte a documentação;
2. Procure informações relacionadas;
3. Identifique exatamente o que está faltando;
4. Pergunte somente o necessário.

---

# 28. RESPOSTAS DA IA

Ao concluir uma tarefa, informe de maneira objetiva:

- O que foi alterado;
- Quais arquivos foram modificados;
- Quais testes foram executados;
- Se algum teste falhou;
- Se existe algum problema pendente.

Não afirmar que algo foi testado se não foi realmente executado.

Não afirmar que um erro foi corrigido sem verificar.

---

# 29. CRITÉRIO DE CONCLUSÃO

Uma tarefa somente deverá ser considerada concluída quando:

- O código estiver implementado;
- A funcionalidade respeitar a documentação;
- Os testes relevantes forem executados;
- Os erros encontrados forem corrigidos;
- Não houver regressões conhecidas;
- A documentação estiver atualizada quando necessário.

---

# 30. REGRA FINAL

Este projeto deve ser desenvolvido com foco em:

- Qualidade;
- Segurança;
- Organização;
- Manutenção;
- Testabilidade;
- Experiência do usuário.

A IA é uma ferramenta de desenvolvimento e deverá seguir as decisões definidas neste projeto.

Não inventar funcionalidades.

Não ignorar regras.

Não criar funcionalidades financeiras.

Não criar PIX.

Não criar pagamentos.

Não criar transações.

O objetivo é construir um sistema de gerenciamento e agendamento de uma barbearia de forma organizada, segura e profissional.
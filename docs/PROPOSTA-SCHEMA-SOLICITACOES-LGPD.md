# Proposta de Schema — Solicitações de Direitos dos Titulares

**Escopo:** proposta para a primeira fase, tecnicamente estruturada para
revisão e validação, ainda não aplicada. A relação com `Usuario` usará
`ON DELETE RESTRICT`: a exclusão física de uma conta fica bloqueada enquanto
houver solicitações vinculadas. Solicitações não serão apagadas
automaticamente. Exclusão ou anonimização dependerá de procedimento
específico, autorizado e documentado. Retenção, canal e prazos continuam
pendentes. Este documento não altera `schema.prisma`, banco ou migrations. A
primeira fase registra e lista solicitações do próprio usuário autenticado.
Não oferece atendimento administrativo nem executa o direito solicitado
automaticamente.

Esta proposta não define bases legais, prazos de resposta, identidade do
controlador, canal de atendimento ou política de retenção. Não é uma declaração
de conformidade com a LGPD.

## 1. Escopo da primeira fase

Clientes e barbeiros autenticados poderão:

- abrir solicitação escolhendo uma categoria;
- consultar somente as solicitações vinculadas à própria conta;
- ver o status `RECEBIDA` e a data de criação.

Toda solicitação é criada com o status `RECEBIDA`. O titular não pode definir
nem alterar status, titular, data ou qualquer outro campo protegido. Não haverá
painel administrativo, perfil de atendente, atribuição, análise, pedido de
informações adicionais, encerramento, exclusão automática ou alteração
automática de dados.

Lista fechada de categorias, alinhada à página de privacidade:

- `ACESSO_EXPORTACAO` — acessar e exportar dados;
- `CORRECAO` — corrigir dados;
- `EXCLUSAO_ANONIMIZACAO` — solicitar exclusão ou anonimização;
- `OUTRA` — outras solicitações.

O registro representa a abertura de um pedido, não seu deferimento ou
execução. Em particular, `EXCLUSAO_ANONIMIZACAO` não apaga nem altera dados;
`CORRECAO` não atualiza o perfil; `ACESSO_EXPORTACAO` não dispara a exportação
já disponível. Esses recursos existentes permanecem separados.

Não há campo de descrição livre na primeira fase. A categoria é o único
conteúdo do pedido, para minimizar a coleta de dados pessoais, de informações
sensíveis e de dados de terceiros. A categoria `OUTRA` registra que o pedido
não se enquadra nas opções, mas não permite explicá-lo nesta fase. Se a
operação exigir contexto adicional, sua necessidade e seus controles devem
ser avaliados antes de acrescentar um campo.

## 2. Modelo Prisma proposto

O modelo `Usuario` existente tem os papéis `CLIENTE` e `BARBEIRO`, ambos
elegíveis para a funcionalidade. A proposta acrescenta uma única relação
inversa nomeada a `Usuario`; não exige modelo de atendente. Os nomes são
propostos e ainda não devem ser copiados para `schema.prisma` sem autorização.

```prisma
enum CategoriaSolicitacaoTitular {
  ACESSO_EXPORTACAO
  CORRECAO
  EXCLUSAO_ANONIMIZACAO
  OUTRA
}

enum StatusSolicitacaoTitular {
  RECEBIDA
}

model SolicitacaoTitular {
  id                Int                       @id @default(autoincrement())
  titularId         Int
  chaveIdempotencia String                    @db.Uuid
  categoria         CategoriaSolicitacaoTitular
  status            StatusSolicitacaoTitular  @default(RECEBIDA)
  dataCriacao       DateTime                  @default(now())

  titular Usuario @relation("TitularSolicitacao", fields: [titularId], references: [id], onDelete: Restrict, onUpdate: Cascade)

  @@unique([titularId, chaveIdempotencia], map: "SolicitacaoTitular_titularId_chaveIdempotencia_key")
  @@index([titularId, dataCriacao, id], map: "SolicitacaoTitular_titularId_dataCriacao_id_idx")
}
```

Adicionar ao modelo `Usuario` somente esta relação inversa:

```prisma
solicitacoesTitular SolicitacaoTitular[] @relation("TitularSolicitacao")
```

### Justificativa dos campos e índices

- `id`: identificador interno da solicitação; não concede acesso.
- `titularId`: vínculo obrigatório com a conta autenticada.
- `chaveIdempotencia`: UUID aleatório, sem dados pessoais, usado para
  reconhecer reenvios da mesma tentativa. Sua unicidade é por titular, não
  global, e ela não é credencial.
- `categoria`: tipo estruturado do pedido, sem cópia de dados do usuário.
- `status`: estado explícito, limitado nesta fase a `RECEBIDA`.
- `dataCriacao`: fornecida pelo banco via `now()`, não pelo frontend.
- A chave única composta suporta reenvio idempotente por titular.
- O índice por titular, data e ID suporta listagem isolada e ordenação
  determinística, inclusive quando duas criações tiverem timestamps iguais.
  Seu prefixo também indexa a chave estrangeira `titularId`.

Esses são os únicos dados propostos para a primeira fase: não guardar nome,
e-mail, telefone, descrição, anexos, cópias de dados ou conteúdo de mensagens.
A chave de idempotência não carrega dados pessoais por si só, mas, por estar
associada ao titular na tabela, deve receber os mesmos controles de acesso e
proteção da solicitação.

Não são necessários nesta fase `responsavelId`, `versao`, `dataAtualizacao`,
campos de ator, nem uma tabela de eventos: não há atribuição, mudança de status
ou edição de solicitações. Não se cria índice separado por status, pois o
status será `RECEBIDA` em todos os registros da primeira fase e as consultas
sempre são isoladas por titular.

`onDelete: Restrict` evita remoção em cascata e segue o padrão de relações
revisado no schema atual. Esta estratégia está aprovada: a exclusão física de
uma conta fica bloqueada enquanto houver solicitações vinculadas. Não haverá
exclusão automática dessas solicitações. Qualquer exclusão ou anonimização
dependerá de procedimento específico, autorizado e documentado.

## 3. SQL PostgreSQL proposto

Este SQL corresponde aos modelos e índices da seção 2. É uma proposta
informativa, não deve ser executada nesta etapa. O campo UUID é fornecido pela
aplicação; não depende de extensão ou de default de UUID no PostgreSQL.

```sql
CREATE TYPE "CategoriaSolicitacaoTitular" AS ENUM (
  'ACESSO_EXPORTACAO',
  'CORRECAO',
  'EXCLUSAO_ANONIMIZACAO',
  'OUTRA'
);

CREATE TYPE "StatusSolicitacaoTitular" AS ENUM (
  'RECEBIDA'
);

CREATE TABLE "SolicitacaoTitular" (
  "id" SERIAL NOT NULL,
  "titularId" INTEGER NOT NULL,
  "chaveIdempotencia" UUID NOT NULL,
  "categoria" "CategoriaSolicitacaoTitular" NOT NULL,
  "status" "StatusSolicitacaoTitular" NOT NULL DEFAULT 'RECEBIDA',
  "dataCriacao" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "SolicitacaoTitular_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "SolicitacaoTitular_titularId_fkey"
    FOREIGN KEY ("titularId") REFERENCES "Usuario"("id")
    ON DELETE RESTRICT ON UPDATE CASCADE
);

CREATE UNIQUE INDEX "SolicitacaoTitular_titularId_chaveIdempotencia_key"
  ON "SolicitacaoTitular"("titularId", "chaveIdempotencia");
CREATE INDEX "SolicitacaoTitular_titularId_dataCriacao_id_idx"
  ON "SolicitacaoTitular"("titularId", "dataCriacao", "id");
```

O status e a data têm defaults no banco para que solicitações persistidas por
qualquer caminho não dependam de valores enviados pelo cliente. A aplicação
deve também omitir esses campos na criação e não expô-los como editáveis.

## 4. Autorização e consultas

- Proteger criação e consulta com a autenticação vigente do backend; permitir
  usuários autenticados dos papéis `CLIENTE` e `BARBEIRO`.
- Obter `titularId` exclusivamente da identidade validada da sessão/JWT
  (`@CurrentUser` e o identificador autenticado). Nunca aceitar um ID de
  titular do corpo, query, rota ou outro valor controlado pelo frontend.
- Na criação, aceitar somente categoria e chave de idempotência. Rejeitar
  campos adicionais, incluindo `titularId`, `status` e `dataCriacao`.
- Na listagem, filtrar toda consulta por `titularId` autenticado, mesmo que a
  rota não receba um ID de solicitação. Se houver consulta por ID, aplicar
  simultaneamente `id` e `titularId`; não fazer busca por ID isolada.
- Não confirmar a existência de solicitações alheias. IDs sequenciais e chaves
  de idempotência nunca são autorização.
- Não retornar relação completa de `Usuario` nem outros dados da conta. A
  resposta deve limitar-se ao identificador da solicitação, categoria, status
  e data de criação.
- Ordenar por `dataCriacao` e `id` de forma determinística. A implementação
  deve limitar o tamanho das páginas e derivar todos os filtros de titular da
  identidade autenticada.

### Idempotência e concorrência na abertura

O cliente gera um UUID aleatório por tentativa lógica e o envia, por exemplo,
no header `Idempotency-Key`. A chave não deve codificar nome, e-mail, telefone,
IDs de usuário ou qualquer outro dado pessoal. O backend valida o formato e
associa a chave ao titular autenticado. O comportamento é:

- mesma chave, mesmo titular e mesma categoria: retornar a solicitação já
  criada, sem inserir outra;
- mesma chave e mesmo titular, mas categoria diferente: retornar conflito
  (`409`), sem alterar a solicitação existente;
- mesma chave usada por titulares diferentes: tratar cada combinação
  titular/chave independentemente. Cada titular só pode receber sua própria
  solicitação; não compartilhar, localizar nem revelar a solicitação do outro.

A restrição única composta `(titularId, chaveIdempotencia)` é a garantia
definitiva contra duas criações concorrentes para o mesmo titular. Se duas
tentativas concorrentes colidirem, a aplicação deve reler usando ambos
`titularId` autenticado e chave: retornar o registro se a categoria coincidir,
ou conflito se divergir. Não revelar existência nem dados de outro titular.

Não registrar a chave em logs ou URLs. O backend não deve aceitá-la como
identidade, token de acesso ou substituto de autenticação. Não armazenar o
corpo completo da requisição ou dados pessoais adicionais para comparar
repetições.

## 5. Preparação reservada para a segunda fase

Não incluir os itens abaixo no schema ou no SQL da primeira fase. Quando uma
fase administrativa for aprovada, sua proposta deverá ser revisada com as
decisões operacionais correspondentes:

- Expandir o enum de status para análise, espera por informações, atendimento
  e encerramento, com transições permitidas validadas no backend.
- Criar uma tabela de eventos append-only para registrar mudanças de estado,
  ator e data, dentro da mesma transação da atualização da solicitação.
- Definir uma versão de concorrência/CAS para alterações administrativas
  simultâneas e garantir que a trilha e o estado atual permaneçam consistentes.
- Definir identidade e autorização de atendentes; não inferir permissão de
  atendimento dos papéis `CLIENTE` ou `BARBEIRO`.
- Definir se e quais eventos o titular poderá consultar, minimizando dados
  pessoais de atendentes e terceiros.
- Avaliar campos de contexto apenas se indispensáveis, com limites e controles
  contra conteúdo sensível ou de terceiros.

Não haverá rota ou interface de análise administrativa nesta primeira fase.
Uma nova fase exigirá migration aditiva revisada, autorização própria e testes
de isolamento e concorrência antes de habilitar qualquer alteração de status.

## 6. Retenção, exclusão de conta e decisões pendentes

- Prazo e critérios de retenção de solicitações: **[PENDENTE DE DEFINIÇÃO]**.
- Canal operacional de atendimento: **[PENDENTE DE DEFINIÇÃO]**.
- Prazos de atendimento: **[PENDENTE DE DEFINIÇÃO]**.
- Confirmar se a sequência de criação e consulta sem atendimento é adequada
  antes da implementação.

Não haverá exclusão automática de solicitações ou de dados enquanto não
existir política de retenção aprovada. Nenhuma categoria implica deferimento
ou execução automática.

### Consequências das estratégias de chave estrangeira

- `RESTRICT` (decisão aprovada): impede que a exclusão física do usuário apague
  solicitações por acidente e preserva o vínculo para controle de acesso. A
  exclusão física da conta fica bloqueada enquanto existirem solicitações
  relacionadas. Não define quanto tempo manter os registros nem, por si só,
  resolve como atender um pedido de exclusão ou anonimização.
- `CASCADE`: excluiria automaticamente as solicitações junto com a conta.
  Isso poderia apagar registros sem política aprovada e sem decisão explícita
  sobre a trilha; não será usado nesta proposta.
- `SET NULL` ou outra desassociação: manteria a solicitação sem titular
  relacionado, exigiria tornar a FK opcional e definir quem poderia acessá-la,
  por quanto tempo e como tratar sua associação/anonimização; não corresponde
  à decisão aprovada e não será usado nesta proposta.

Assim, `RESTRICT` é a estratégia aprovada para evitar perda acidental. A
operação de exclusão da conta deve verificar explicitamente se existem
solicitações e bloquear a exclusão física enquanto houver vínculos; não pode
prosseguir silenciosamente nem apagar solicitações para contornar a restrição.
Se for necessário excluir ou anonimizar a conta apesar desses vínculos, será
necessário um procedimento específico, autorizado e documentado antes de
qualquer ação. Esse procedimento não está definido nesta proposta.

A restrição da FK diz respeito a `DELETE` físico no banco; não impede por si só
desativação lógica ou alterações de dados da conta. Nenhuma exclusão,
anonimização ou outra alteração será disparada automaticamente por uma
solicitação nesta fase. A rotina de exclusão da conta deverá verificar
explicitamente as solicitações e respeitar a estratégia aprovada.

## 7. Compatibilidade e sequência segura

O schema existente usa PostgreSQL, `Usuario.id` inteiro autoincremental,
`TipoUsuario` com `CLIENTE` e `BARBEIRO`, enums PostgreSQL, nomes de tabelas
PascalCase entre aspas, timestamps `TIMESTAMP(3)` e relações com
`ON DELETE RESTRICT ON UPDATE CASCADE`. A proposta segue essas convenções:
uma tabela nova, dois enums, uma relação inversa nomeada, UUID PostgreSQL
nativo e nenhuma dependência de extensão. A lista declarada de pacotes contém
Prisma `7.9.1`; o gerador e a configuração atuais também foram considerados
na proposta. Essa revisão documental não substitui `prisma validate` nem a
comparação com o SQL gerado, que deverão ocorrer em uma implementação
autorizada.

Sequência futura:

1. Resolver as pendências da seção 6: política de retenção, canal operacional
   e prazos de atendimento.
2. Definir e documentar o procedimento específico necessário para tratar
   exclusão ou anonimização de conta com solicitações vinculadas. Até lá, a
   exclusão física permanece bloqueada por `RESTRICT`.
3. Autorizar a implementação e confirmar categorias, idempotência e contrato
   de criação/consulta.
4. Adicionar somente os dois enums, `SolicitacaoTitular` e sua relação inversa
   em `Usuario`; validar o schema com a versão de Prisma do projeto.
5. Gerar uma migration aditiva e revisar todo o SQL gerado contra esta proposta,
   incluindo defaults, nomes, índices e FK. Não editar migrations anteriores.
6. Aplicar a migration somente com autorização explícita e no ambiente
   autorizado.
7. Implementar endpoints autenticados com titular derivado do JWT, filtro
   obrigatório por titular, validação estrita do corpo e idempotência.
8. Testar clientes e barbeiros, acesso não autenticado, isolamento contra
   IDs/chaves de outros titulares, submissões repetidas e concorrentes, status
   inicial e datas; usar ambiente de teste isolado sem dados reais.
9. Habilitar a interface de abertura/consulta somente depois de confirmados o
   processo e as orientações apresentados ao titular.

Nenhum modelo, SQL ou operação foi aplicado. A central existente permanece
informativa até a implementação autorizada.

# GUIA DA INTERFACE

## 1. OBJETIVO

Este documento define as diretrizes visuais e de experiência do usuário para o aplicativo da barbearia.

A interface deverá transmitir:

- Profissionalismo;
- Modernidade;
- Organização;
- Elegância;
- Facilidade de uso;
- Confiança.

A interface deverá ser visualmente agradável sem prejudicar a usabilidade.

---

## 2. PRINCÍPIO PRINCIPAL

A interface deverá ser construída seguindo a documentação existente.

A IA responsável pelo frontend NÃO deverá inventar:

- Funcionalidades;
- Telas;
- Fluxos;
- Campos;
- Sistemas de pagamento;
- Funcionalidades administrativas não documentadas.

Quando uma informação visual não estiver definida, deverá ser escolhida uma solução coerente com o restante da interface, sem criar uma nova funcionalidade.

---

## 3. IDENTIDADE VISUAL

A interface deverá possuir uma aparência moderna e profissional relacionada ao segmento de barbearia.

O visual deverá evitar aparência:

- Infantil;
- Exageradamente colorida;
- Desorganizada;
- Genérica;
- Excessivamente carregada.

A interface deverá priorizar uma aparência sofisticada e limpa.

---

## 4. CORES

A paleta definitiva deverá ser definida durante a criação do design.

A interface deverá utilizar:

- Uma cor principal;
- Uma cor secundária;
- Cores neutras;
- Cores específicas para estados de sucesso, alerta e erro.

As cores deverão possuir contraste adequado para leitura.

A paleta deverá permanecer consistente em todas as telas.

---

## 5. TIPOGRAFIA

A interface deverá utilizar uma fonte moderna e de fácil leitura.

Deverá existir hierarquia visual entre:

- Títulos;
- Subtítulos;
- Textos;
- Informações secundárias;
- Botões;
- Labels.

A tipografia deverá permanecer consistente em todo o aplicativo.

---

## 6. ESPAÇAMENTO

O layout deverá utilizar espaçamentos consistentes.

Elementos relacionados deverão permanecer visualmente próximos.

Elementos diferentes deverão possuir separação suficiente para facilitar a compreensão.

O espaçamento deverá ser responsivo.

---

## 7. COMPONENTES

A interface deverá utilizar componentes reutilizáveis.

Exemplos:

- Botões;
- Inputs;
- Selects;
- Cards;
- Modal;
- Alertas;
- Badges;
- Menus;
- Cabeçalhos;
- Rodapés;
- Navegação;
- Calendário;
- Seleção de horários;
- Listas;
- Tabelas, quando necessárias.

Componentes semelhantes deverão possuir aparência consistente.

---

## 8. BOTÕES

Os botões deverão possuir hierarquia visual.

### Botão principal

Utilizado para ações importantes.

Exemplos:

- Agendar;
- Confirmar;
- Salvar;
- Entrar.

### Botão secundário

Utilizado para ações complementares.

### Botão de perigo

Utilizado para ações como:

- Cancelar agendamento;
- Excluir ou desativar algo, quando permitido.

Ações destrutivas deverão possuir confirmação quando necessário.

---

## 9. FORMULÁRIOS

Os formulários deverão:

- Possuir labels claros;
- Informar campos obrigatórios;
- Validar informações;
- Mostrar erros próximos ao campo;
- Evitar mensagens técnicas;
- Possuir estados de carregamento;
- Impedir múltiplos envios acidentais.

As validações visuais não substituem as validações do backend.

---

## 10. TELA DE LOGIN

A tela de login deverá ser simples e objetiva.

Deverá possuir:

- Identificação do usuário;
- Campo de senha;
- Botão de entrada;
- Acesso ao cadastro, quando aplicável;
- Mensagens de erro.

A tela não deverá possuir qualquer elemento relacionado a pagamento.

---

## 11. TELA DE CADASTRO

A tela de cadastro deverá apresentar somente os dados necessários.

O usuário deverá compreender facilmente:

- O que precisa preencher;
- Quais campos são obrigatórios;
- Como concluir o cadastro.

Após o cadastro, o usuário deverá receber feedback visual apropriado.

---

## 12. TELA INICIAL DO CLIENTE

A tela inicial deverá apresentar as principais ações disponíveis para o cliente.

Poderá apresentar:

- Próximo agendamento;
- Acesso aos serviços;
- Acesso à agenda;
- Notificações;
- Lista de espera;
- Perfil.

A organização deverá priorizar as ações mais importantes.

---

## 13. SERVIÇOS

Os serviços deverão ser apresentados de maneira clara.

Cada serviço poderá apresentar:

- Nome;
- Descrição;
- Duração;
- Preço informativo;
- Botão para agendar.

O preço deverá ser apresentado somente como informação.

Não deverá existir botão de pagamento.

---

## 14. ESCOLHA DO SERVIÇO

O usuário deverá conseguir compreender rapidamente:

- Qual serviço está escolhendo;
- Quanto tempo dura;
- Qual o preço informativo;
- Qual ação deverá realizar em seguida.

A seleção deverá possuir feedback visual.

---

## 15. ESCOLHA DA DATA

A seleção de data deverá ser simples.

O calendário deverá:

- Destacar a data selecionada;
- Indicar datas disponíveis;
- Impedir seleção de datas inválidas;
- Possuir boa visualização em dispositivos móveis.

---

## 16. ESCOLHA DO HORÁRIO

Os horários disponíveis deverão ser apresentados de forma clara.

Exemplo visual:

09:00
09:30
10:00
10:30
11:00

Horários indisponíveis não deverão ser selecionáveis.

O usuário deverá perceber claramente qual horário está selecionado.

---

## 17. CONFIRMAÇÃO DO AGENDAMENTO

Antes da confirmação, a interface deverá apresentar um resumo.

O resumo poderá conter:

- Serviço;
- Barbeiro;
- Data;
- Horário;
- Duração;
- Preço informativo.

A ação de confirmação deverá ser clara.

Não deverá existir qualquer etapa de pagamento.

---

## 18. AGENDAMENTO CONFIRMADO

Após um agendamento realizado com sucesso, a interface deverá apresentar:

- Confirmação;
- Serviço;
- Data;
- Horário;
- Barbeiro;
- Informações importantes;
- Próximas ações disponíveis.

O usuário deverá saber claramente que o agendamento foi concluído.

---

## 19. MEUS AGENDAMENTOS

A tela deverá permitir visualizar os agendamentos do cliente.

Poderão existir categorias como:

- Próximos;
- Histórico;
- Cancelados.

Cada agendamento deverá apresentar informações essenciais.

---

## 20. CANCELAMENTO

O cancelamento deverá possuir uma ação clara.

Quando a ação for importante ou irreversível, deverá existir confirmação.

A interface deverá informar ao cliente quando o cancelamento não estiver disponível devido ao prazo estabelecido.

Não deverá existir qualquer informação sobre multa ou cobrança.

---

## 21. LISTA DE ESPERA

A interface deverá permitir:

- Entrar na lista de espera;
- Visualizar solicitações;
- Cancelar solicitação;
- Visualizar status.

Quando uma vaga estiver disponível, o usuário deverá receber uma indicação clara.

---

## 22. NOTIFICAÇÕES

A interface deverá possuir acesso às notificações.

Notificações não lidas deverão possuir indicação visual.

A tela deverá permitir diferenciar notificações importantes de informações comuns.

---

## 23. MENSAGENS

A interface de mensagens deverá ser simples.

O usuário deverá conseguir:

- Visualizar mensagens;
- Enviar mensagem;
- Identificar mensagens novas.

O campo deverá respeitar o limite de 50 caracteres definido nas regras de negócio.

---

## 24. PERFIL

A tela de perfil deverá permitir visualizar e alterar informações permitidas.

A interface deverá evitar exposição de informações sensíveis.

---

# ÁREA DO BARBEIRO

## 25. PAINEL DO BARBEIRO

O painel deverá apresentar uma visão geral da operação.

Poderá apresentar:

- Próximos atendimentos;
- Agenda;
- Serviços;
- Clientes;
- Lista de espera;
- Notificações;
- Configurações;
- Situações de emergência.

---

## 26. AGENDA

A agenda deverá ser uma das principais telas administrativas.

Deverá facilitar a visualização:

- Dos horários;
- Dos clientes;
- Dos serviços;
- Dos status dos agendamentos.

A visualização deverá ser organizada para evitar confusão.

---

## 27. GERENCIAMENTO DE SERVIÇOS

O barbeiro deverá conseguir:

- Criar serviço;
- Editar serviço;
- Ativar serviço;
- Desativar serviço.

A interface não deverá apagar automaticamente o histórico relacionado ao serviço.

---

## 28. HORÁRIOS DE FUNCIONAMENTO

O barbeiro deverá conseguir configurar:

- Dias de funcionamento;
- Horários;
- Períodos disponíveis.

A interface deverá alertar quando uma alteração puder afetar a agenda existente.

---

## 29. BLOQUEIOS

O barbeiro deverá conseguir criar e remover bloqueios da agenda.

A interface deverá apresentar claramente:

- Data;
- Horário;
- Motivo.

---

## 30. EMERGÊNCIA

A funcionalidade de emergência deverá ser visualmente destacada, mas não exagerada.

Antes de confirmar uma emergência, a interface deverá informar que determinados agendamentos poderão ser afetados.

Deverá existir confirmação antes da ação.

---

## 31. CLIENTES

A área administrativa poderá apresentar informações necessárias para o gerenciamento dos clientes.

O barbeiro deverá visualizar somente informações permitidas.

---

## 32. LISTA DE ESPERA ADMINISTRATIVA

O barbeiro deverá conseguir visualizar a lista de espera de forma organizada.

A prioridade deverá ser visualmente compreensível.

---

## 33. RELATÓRIOS

Os relatórios deverão apresentar informações operacionais.

Exemplos:

- Agendamentos;
- Atendimentos;
- Cancelamentos;
- Faltas;
- Serviços mais utilizados;
- Horários mais utilizados.

Não deverão existir relatórios financeiros.

---

# EXPERIÊNCIA DO USUÁRIO

## 34. FEEDBACK

Toda ação importante deverá fornecer feedback.

Exemplos:

- Sucesso;
- Erro;
- Carregamento;
- Confirmação;
- Atualização.

O usuário nunca deverá ficar sem saber se uma ação foi executada.

---

## 35. ESTADOS VAZIOS

Quando não houver informações, a interface deverá apresentar um estado vazio amigável.

Exemplos:

- Nenhum agendamento;
- Nenhuma notificação;
- Nenhuma mensagem;
- Nenhum horário disponível.

O estado vazio deverá explicar o que está acontecendo e, quando possível, oferecer uma próxima ação.

---

## 36. ESTADOS DE ERRO

Erros deverão ser apresentados de forma compreensível.

Não mostrar mensagens técnicas como:

"500 Internal Server Error"

diretamente para o usuário.

A interface deverá apresentar uma mensagem adequada e, quando possível, uma ação para tentar novamente.

---

## 37. RESPONSIVIDADE

A interface deverá ser totalmente responsiva.

Deverá funcionar adequadamente em:

- Desktop;
- Tablet;
- Smartphone.

Elementos importantes não deverão ficar escondidos ou difíceis de utilizar em telas pequenas.

---

## 38. ACESSIBILIDADE

A interface deverá seguir boas práticas de acessibilidade.

Deverá considerar:

- Contraste;
- Tamanho adequado de textos;
- Labels;
- Navegação por teclado;
- Estados de foco;
- Textos alternativos quando necessários;
- Elementos interativos identificáveis.

---

## 39. ANIMAÇÕES

As animações deverão ser utilizadas com moderação.

Podem ser utilizadas para:

- Transições;
- Feedback;
- Carregamento;
- Mudança de estado.

As animações não deverão prejudicar:

- Desempenho;
- Legibilidade;
- Acessibilidade;
- Velocidade de uso.

---

## 40. RESPONSABILIDADE DA IA DE FRONTEND

A IA responsável pelo frontend deverá:

- Ler toda a documentação antes de implementar;
- Respeitar `TELAS.md`;
- Respeitar `REGRAS-DE-NEGOCIO.md`;
- Respeitar `API.md`;
- Respeitar `TECNOLOGIAS.md`;
- Utilizar componentes reutilizáveis;
- Manter o código organizado;
- Criar uma interface responsiva;
- Não inventar funcionalidades.

---

## 41. PROIBIÇÕES

A IA NÃO deverá adicionar:

- PIX;
- Pagamentos;
- Checkout;
- Cartão;
- Carteira;
- Saldo;
- Cobranças;
- Assinaturas;
- Publicidade;
- Funcionalidades não documentadas.

O aplicativo existe para gerenciamento e agendamento da barbearia.

---

## 42. REGRA FINAL

A interface deverá ser construída com base em toda a documentação do projeto.

Em caso de dúvida:

1. Consultar `TELAS.md`;
2. Consultar `REGRAS-DE-NEGOCIO.md`;
3. Consultar `API.md`;
4. Consultar `ARQUITETURA.md`;
5. Consultar `TECNOLOGIAS.md`;
6. Não inventar uma funcionalidade.

A interface deverá priorizar simplicidade, profissionalismo, clareza e facilidade de utilização.
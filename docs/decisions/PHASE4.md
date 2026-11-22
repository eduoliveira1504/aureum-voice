# Fase 4

Status: ✅ 4.1 concluída. 4.2 em andamento (um bloco por vez, na ordem).
Regras de produção e ritual de release do PHASE3.md valem aqui também.
Regras do CLAUDE.md: sem IA no produto, custo R$ 0 (exceções já aprovadas continuam), segredos só em .env, commits em inglês, nada copiado do Discord, dependência nova: perguntar antes (licença permissiva).

## Fase 4.1 (concluída)
- 4.1.1 Menu de avatar/banner ficava atrás do modal de perfil: Modal e menu de contexto tinham o mesmo z-50. Menu agora acima de modais.
- 4.1.2 Call mostrava no máximo 4 pessoas: grade e cards do Início limitavam a 4.
- 4.1.3 Amigo aparecia com 374h de Valorant: atividade ficava no Redis sem expirar. Agora expira sem sinal do app.
- 4.1.4 Botão de atualização não aparecia para todos após a beta.10: updater passou a registrar log e a checar de forma confiável.

# Fase 4.2

Ordem (mudada em 22/11): 4.2.8 (categoria Addons) → 4.2.9 (PiP) → 4.2.4 (busca) → 4.2.5 (atividade)
→ 4.2.10 (joguinhos), mais o 4.2.12 (menções), pedido no caminho. Todos com o código pronto.
TFT (4.2.3) e LoL (4.2.11) SAÍRAM da 4.2 (Eduardo, 22/11): os addons de jogo dependem da chave da
Riot e ficam para a Fase 5 (anotados em FUTURO.md). As specs abaixo ficam como referência.
Agora: teste manual do Eduardo no dev de tudo o que foi feito, depois a release beta.12.
Já prontos: 4.2.1, 4.2.2 (código) e 4.2.6. Com o e-mail de volta, falta o teste manual do 4.2.2 e do 4.2.6
e a produção (backup + migrações do 4.2.1 e do 4.2.2) numa release beta.12, com OK do Eduardo.
Toda tela nova já nasce com as chaves de tradução (pt-BR e en), desde o primeiro commit.
A revisão de usabilidade (4.2.7) roda junto, o tempo todo.

## 4.2.1 Tipo de servidor ✅ concluído (testado pelo Eduardo no dev)

Ver docs/decisions/0048-server-types.md.
Produção: backup, depois `alembic upgrade heads` (core c9e5a1b3d486 cria servers.type, todos os
servidores existentes viram Misto) e reiniciar a API, com OK do Eduardo. API antes do app: apps
antigos continuam criando servidor (vira Misto). Teste manual: criar um servidor de cada tipo e
conferir a lista de addons e o painel de sons na call (feito no dev, 12/11).

### Comportamento
- Na criação do servidor, a pessoa escolhe um tipo: Jogo, Trabalho ou Misto.
- Cada tipo tem uma lista fixa de addons disponíveis. O tipo é definido na criação e fica TRAVADO: não dá para trocar depois, nem pela API.
- Addon fora da lista do tipo não aparece na interface e a API recusa instalar.
- Servidores que já existem viram "Misto" na migração (nada some para ninguém).
- Campo de nome do servidor: o exemplo vira só "(Nome do servidor)", apagadinho, no placeholder. Remover "Os Brabos" de todo lugar (tela de criar servidor e textos de ajuda).

### Tabela de addons por tipo (confirmada pelo Eduardo)
| Addon | Jogo | Trabalho | Misto |
|---|---|---|---|
| Enquetes | sim | sim | sim |
| Eventos | sim | sim | sim |
| Calendário | sim | sim | sim |
| Painel de sons (recurso do servidor, não addon; controlado pela mesma lista) | sim | não | sim |
| Kanban | não | sim | sim |
| Quadro branco | não | sim | sim |
| TFT (entra na lista no 4.2.3) | sim | não | sim |
| LoL (entra na lista no 4.2.11) | sim | não | sim |

Enquetes em DM e grupo não mudam: não dependem de tipo de servidor.

### Técnica
- Coluna servers.type (enum: game, work, mixed), NOT NULL, migração Alembic com default mixed para os existentes.
- A lista de addons por tipo mora num lugar só (constante/config no backend) e o app lê da API. Nada de lista duplicada no cliente.
- Tela de criação: três cartões com título e uma linha explicando o que vem em cada tipo. Mostrar o aviso "O tipo não pode ser alterado depois".

### Testes
Criar servidor de cada tipo; addon fora da lista recusado pela API e escondido na interface; tentativa de trocar o tipo recusada; servidores antigos viram Misto; placeholder correto.

## 4.2.2 Desativar e excluir conta ✅ código concluído (falta teste manual e produção)

Ver docs/decisions/0049-account-deletion.md (inclui a tabela do que é apagado e do que fica).
Decidido com o Eduardo: e-mail liberado na hora da exclusão; @ preso por 90 dias (só HMAC);
"Passar a posse" novo em Configurações do servidor › Membros; conta desativada continua nos
servidores, como "Conta desativada". A tela ficou em Editar perfil › Conta. A rotina confere de hora
em hora, no processo da API. Dry-run do purge no banco de dev (12/11): 0 candidatas.
Produção: backup, depois `alembic upgrade heads` (core d1f7b3c5e598: estados da conta, código
delete_account, released_usernames) e reiniciar a API, com OK do Eduardo. Teste manual (o e-mail do
Eduardo voltou a funcionar): desativar e reativar; excluir com conta de teste e cancelar; passar a posse.

### Estados da conta
ativa → desativada (reversível) → exclusão agendada (30 dias) → excluída.

### Desativar
- Esconde o perfil e tira a pessoa da lista de amigos e de presença; mensagens ficam.
- Entrar de novo com e-mail e senha reativa a conta na hora.
- Precisa confirmar com a senha.

### Excluir
- Confirma com senha + código de 6 dígitos por e-mail (reaproveitar o fluxo do 2.10).
- Carência de 30 dias: a conta fica desativada e marcada para exclusão. Entrar nesse prazo oferece "Cancelar exclusão".
- Quem é DONO de algum servidor precisa passar a posse antes (ou excluir o servidor). Enquanto for dono, a exclusão é recusada, com a lista dos servidores.
- Caixinha "Apagar também minhas mensagens":
  - marcada: apaga as mensagens da pessoa (canais, DMs e grupos) e os anexos delas;
  - desmarcada: as mensagens ficam e o autor aparece como "Usuário excluído".
- Ao concluir, apaga: avatar e banner (arquivos no MinIO), perfil, amizades, pedidos, tokens e sessões, convites criados. O número de Pioneiro NÃO é reutilizado.
- E-mail de aviso ao agendar e ao concluir.

### Comando de admin
- accounts purge (CLI), com --dry-run obrigatório antes: lista contas candidatas e só apaga com confirmação. Serve para limpar contas fake.

### Testes
Desativar e reativar; excluir com e sem a caixinha; dono bloqueado até passar a posse; cancelar dentro dos 30 dias; job conclui só as vencidas; autor vira "Usuário excluído"; arquivos apagados do MinIO; purge em dry-run não apaga nada.

## 4.2.3 Addon TFT ⏭️ adiado para a Fase 5 (depende da chave da Riot; ver FUTURO.md)

Mockup aprovado (quatro telas): https://claude.ai/artifact/5jymvkv7859u7QsNNtsXsD
Seguir o visual do mockup e os tokens do ADR 0003. Dados de exemplo sempre com o selo "Dados de exemplo" enquanto não houver dado real.

### Limites da Riot (obrigatórios, valem para tudo aqui e para o LoL)
- Overlay só com informação estática, escolhida pelo usuário. Nada que leia o estado da partida nem dê dica em tempo real (posição de itens, o que comprar, etc.).
- Sem win rate de augment.
- Mostrar o Riot ID sempre que aparecer um jogador.
- Aviso visível: "O Aureum não é endossado pela Riot Games."
- Uma chave por produto. Beta fechado por convite: chave pessoal serve. Chave de produção e login pela Riot (RSO) ficam para quando o app abrir.
- Chave de desenvolvimento (24h) só para teste local, nunca distribuída.
- Limites da chave pessoal: 20 requisições/s e 100 a cada 2 min. Respeitar com fila e cache.
- Registro do produto no portal da Riot: feito pelo Eduardo (em andamento em 22/11).

### Camada 1: casca e UI (dados de exemplo)
- Addon novo no framework do ADR 0013, só nos tipos Jogo e Misto, e na categoria Addons (4.2.8).
- Abas: Comps, Itens, Augments, Campeões, Histórico.
- Comps: tier S a C, lista de comps; detalhe com traços, itens do carry e posicionamento modelo; botão "Fixar como meu plano".
- Itens: componentes e itens combinados (filtros Ataque, Magia, Tanque), campeão em que rende melhor e posição média.
- Augments: lista e descrição, sem win rate.
- Campeões: lista e traços, seguindo o padrão das outras abas.
- Overlay "Meu plano" (reaproveitar widgets de overlay do ADR 0040/0042): mostra a comp fixada (tier, campeões, itens, mini tabuleiro). Arrastar pelo cabeçalho, minimizar em pílula, posição e estado salvos. Atalho para mostrar/ocultar configurável (padrão Alt+T, avisar se conflitar). Só aparece quando o jogo está aberto (mesma regra do overlay existente) e o usuário ligou "Mostrar no overlay".
- Privacidade do overlay: regras do 2.7 valem (só atalho configurado, nunca registrar teclas).

### Camada 2: dados estáticos do jogo
- Campeões, traços, itens e augments de fonte pública do jogo. Claude Code confirma antes: o set atual existe na fonte? A licença/termos permitem o uso? Me mostra o resultado antes de integrar.
- Baixar e guardar no servidor (cache por patch), nunca depender da fonte a cada abertura do app.
- Arte: só o que os termos permitirem; se não der, usar ícones próprios simples (letras/cores, como no mockup).

### Camada 3: estatísticas (atrás de uma interface única)
- Interface única de dados (ex: TftStatsProvider) com duas implementações: fixtures (exemplo) e Riot API. A UI não sabe qual está usando.
- Coleta e cálculo SEMPRE no servidor, chave só em variável de ambiente. O app desktop nunca vê a chave.
- Estatísticas por patch (posição média, top 4, comps, itens) a partir de partidas ranqueadas amostradas. Respeitar os limites de taxa, com fila, cache e retry.
- Histórico do jogador: precisa do Riot ID. Sem RSO não dá para provar que a conta é da pessoa, então o vínculo é digitar Riot ID + região e aparece como "não verificado". Verificação real só com a chave de produção. Mostrar só o que a chave liberar; se não liberar PDL/elo, mostrar posição média e top 4.
- Esta camada só começa depois do aval da Riot para a chave. Até lá, a UI roda nos fixtures.

### Testes
Addon só aparece em Jogo e Misto; fixar plano persiste e aparece no overlay; atalho e posição do overlay salvos; overlay some fora do jogo; troca de provider não altera a UI; chave nunca aparece em log nem no cliente; limite de taxa respeitado (teste com mock).

## 4.2.4 Busca dentro do servidor ✅ código concluído (falta teste manual e produção)

Ver docs/decisions/0051-server-search.md.
Produção: backup com data no nome, depois `alembic upgrade heads` (core f3b9d5a7c820 cria só o
índice de busca) e reiniciar a API, com OK do Eduardo. Apps antigos não mudam (rota nova).
- Campo de busca no servidor: procura mensagens nos canais que a pessoa pode ver (VIEW_CHANNEL), respeitando canais privados.
- Filtros: canal, autor, data. Resultado leva ao ponto da mensagem no canal.
- Busca de texto do próprio Postgres (config portuguesa). Sem serviço novo, custo zero.
- Paginação e limite de resultados; campo vazio e "nada encontrado" tratados.
- Testes: não retorna mensagem de canal privado sem acesso; filtros; permissão checada na API.

## 4.2.5 Atividade ao vivo ✅ código concluído (falta teste manual)

Já existia (2.5 e 4.1.3): a atividade guarda o início, expira sem sinal do app, chega por WebSocket
e a opção "Mostrar o jogo que estou jogando" desliga a detecção (o app manda "nada" na hora). O
cartão de perfil já mostrava o tempo. Feito agora: "Jogando X · há 2 h" na lista de amigos e no hub
do Início (salas ao vivo e Ativos agora), atualizando a cada minuto. Sem mudança na API. De quebra,
quatro textos fixos em português que o 4.2.6 deixou passar (pessoas, transmitindo, membros, mensagem
de voz) agora usam as traduções.

- Mostrar "Jogando X" com o tempo (ex: "há 2 h") no cartão de perfil, na lista de amigos e no hub do Início.
- Usa o que o 2.5 já detecta (lista própria de jogos). Depende do fix da 4.1.3 (atividade expira sem sinal).
- Respeitar a opção de privacidade de atividade que já existe; se não existir, criar "Mostrar o que estou jogando".
- Só o nome do jogo e o tempo. NADA de dados da partida (KDA, placar) nesta fase.
- Atualização por WebSocket, sem polling.
- Testes: atividade some quando o app fecha ou fica sem sinal; opção de privacidade esconde; tempo atualiza.

## 4.2.6 Idioma (português e inglês) ✅ concluído (teste manual pendente)

Ver docs/decisions/0050-i18n.md. Aprovado com o Eduardo: i18next + react-i18next (MIT); três opções
(Seguir o sistema, Português (Brasil), English); a escolha fica neste computador, não na conta.
Tudo no app desktop, sem migração nem mudança na API. Ficam em português: textos que a API escreve
(insígnias, avisos da @aureum, avisos 503), e-mails e o CHANGELOG das Novidades. Teste manual:
trocar o idioma com uma call aberta, a janela destacada e o overlay; conferir bandeja e menu do Mac.
Telas novas (a partir daqui) já nascem com as chaves de tradução, nos dois idiomas.

## 4.2.7 Revisão de usabilidade (transversal)
- Durante a fase, Claude Code anota atritos que encontrar em docs/decisions/USABILIDADE.md (tela, problema, sugestão).
- Eduardo escolhe o que entra. Coisa pequena entra no commit do bloco; o resto vira item novo.
- Ao fim da 4.2, uma passada ponto a ponto de teste em todas as telas principais.

## 4.2.8 Categoria Addons (correção) ✅ código concluído (falta teste manual e produção)

Ver o adendo do docs/decisions/0037-channel-categories.md.
Produção: backup com data no nome, depois `alembic upgrade heads` (core e2a8c4f6b719 cria
channel_categories.kind e arruma cada servidor) e reiniciar a API, com OK do Eduardo. API antes do
app: apps antigos continuam criando addon (vai para a Addons sem erro).

Problema (achado pelo Eduardo): desde o 3.12 (ADR 0037) "Addons" é uma categoria comum. O "+" dela
abre "Criar canal" (Sidebar.tsx, onAdd da categoria) e o "Adicionar addon" tem seletor de categoria
(modals.tsx), então dá para criar canal dentro de Addons e addon dentro de Salas ou Conversas.

### Regras
- Todo servidor tem UMA categoria Addons, especial: nasce com o servidor, pode ficar vazia, não pode ser
  excluída nem renomeada. O nome aparece traduzido pela interface.
- Só addon vive nela, e addon só vive nela. Canal de texto ou de voz nunca entra em Addons, e addon nunca
  sai dela (criar, mover, arrastar, "Mover para...").
- O "+" de Addons abre só "Adicionar addon" (o mesmo modal da Visão geral), SEM seletor de categoria.
- O "Criar canal" não lista Addons como categoria. Salas, Conversas e as outras continuam como estão.
- Vale na API, não só na tela.

### Técnica
- channel_categories ganha um tipo (normal ou addons), no máximo uma addons por servidor.
- Migração: em cada servidor, marcar como addons a categoria "Addons"; se foi renomeada ou excluída,
  criar uma; mover para ela todo addon que estiver fora. Backup antes (regras de produção).
- create_server (DEFAULT_CATEGORIES em routers/servers.py) cria a categoria addons junto com Salas e Conversas.
- API: addon sem categoria ou em outra vai para a categoria addons, sem erro (apps anteriores continuam
  funcionando); canal comum pedido dentro de addons e mover canal ou addon entre tipos de categoria recebem
  erro legível. Ordenação em lote e movimentos de categoria respeitam a regra.
- Desktop: Sidebar (onAdd da categoria), CreateAddonModal e CreateChannel sem a opção, arrastar sem
  indicador de soltura nos lugares errados.
- Testes: criação e movimento recusados na API; migração com categoria renomeada e com addon fora; "+" de
  cada categoria abre o modal certo; app antigo ainda cria addon.

## 4.2.9 Picture in picture das chamadas privadas ✅ código concluído (falta teste manual)

Feito: a escolha de quem fica grande mora em lib/callFocus.ts (fixado → tela de outra pessoa →
1 a 1 a outra pessoa → no grupo quem fala, e quem já estava entre uma frase e outra), usada pelo PiP
e pela janela destacada. A fixação fica no store de navegação, presa à chamada, e é a mesma da tela
de chamada (que abre em foco quando há alguém fixado). O PiP usa os tiles da tela de chamada, até 3
miniaturas e "+N" (que abre a chamada). Controles: silenciar, desligar, voltar à chamada; destacar
e esconder continuam como ícones da janela. Sem migração nem mudança na API.

- Hoje useSubject (CallPip.tsx) mostra a tela de alguém ou quem está falando, e pula de pessoa em pessoa.
  A janela destacada (DetachedCall) usa o mesmo, então a mudança vale para as duas.
- O PiP passa a usar o mesmo componente e visual da tela de chamada (modo foco do 2.2).
- Grande por padrão: 1 a 1 = a outra pessoa; grupo = quem está fixado ou, sem fixado, quem fala (proposta);
  tela compartilhada tem prioridade.
- Clicar em alguém no PiP o fixa, e a fixação é a mesma da chamada principal. Demais em miniaturas, "+N".
- Controles mínimos: silenciar, desligar, voltar à chamada.
- Testes: 1 a 1 mostra só a outra pessoa; fixar no PiP reflete na chamada; transmissão tem prioridade;
  entrar e sair não faz piscar.

## 4.2.10 Joguinhos diários (Início) ✅ código concluído (falta teste manual e produção)

Escolhas do Eduardo (22/11): Sudoku, Trilha e Caça-palavras nesta rodada (cruzadas depois); lista de
palavras própria; puzzle gerado e conferido pela API; ranking com o tempo dos amigos, para desafiar.
Ver docs/decisions/0053-daily-games.md. Feito: os três jogos, o cartão "Jogos do dia" (sequência,
quem jogou, posição no ranking ou o tempo a bater), o ranking dos amigos no resultado, e o desafio
por mensagem privada ou num canal do servidor, com o ranking de quem está ali.
Produção: backup com data no nome, `alembic upgrade heads` (core b5d1f7c9e042 cria daily_puzzles e
daily_results, c6e2a8d0f153 cria daily_shares, d8a4c0e2f364 guarda a resolução) e reiniciar a API,
com OK do Eduardo. Apps antigos veem o desafio como texto simples.
Ajustes do teste do Eduardo (22/11): página "Jogos do dia" na barra lateral do Início, "Ver jogo"
depois de resolver, Trilha redesenhada (grade desalinhada e paredes confusas) e Caça-palavras mais
difícil (12×12, metade na diagonal). Proposta em aberto: insígnias de sequência (4.2.13).

- Cartão "Jogos do dia" no Início (3.4): jogos, sequência de dias, e quais amigos já jogaram hoje.
- Ordem de construção (proposta): Sudoku, jogo de ligar os pontos passando por todo o caminho, caça-palavras,
  palavras cruzadas por último (precisa de pistas em português; sem IA no produto, então vem de base com
  licença ou fica para depois).
- Puzzle determinístico pela data (dia de Brasília), igual para todos, gerado por algoritmo, com solver
  que garante solução única. Nada de IA. Só o resultado vai ao banco (jogo, dia, tempo, tentativas,
  completou), um por pessoa por jogo por dia.
- Nomes, visual e regras com identidade própria; nada copiado do LinkedIn (nem o nome "Zip").
- Compartilhar ao terminar: "Compartilhar com amigos" (escolhe amigos, vai por mensagem privada) e
  "Compartilhar em servidor" (escolhe o servidor e um canal de texto onde a pessoa pode escrever). A
  mensagem é um desafio: jogo, dia e resultado resumido (tempo e tentativas, SEM revelar a resposta) e um
  botão "Jogar". Quem já jogou vê o próprio resultado. Mensagem de apps antigos aparece como texto simples.
- Anti-spam: um desafio por jogo por dia por canal.
- Dependência nova (lista de palavras em português, por exemplo): perguntar antes, licença permissiva.
- Testes: mesmo puzzle para todos no mesmo dia; solução única; resultado único por dia; compartilhar
  respeita permissão de escrita no canal; mensagem sem spoiler.

## 4.2.11 Addon LoL ⏭️ adiado para a Fase 5 (consulta de confronto; depende da chave da Riot; ver FUTURO.md)
- Tela de consulta, não é dica durante a partida e NÃO lê o jogo. A pessoa escolhe campeão, lane e
  campeão inimigo (ex: Aurelion Sol no mid contra Zed) e vê: melhor build e ordem de itens, runas,
  win rate do confronto e indicadores de como o confronto costuma ser (mais agressivo ou passivo), tirados
  dos dados (ex: abates iniciais, CS aos 10 min), sem texto de conselho escrito por IA.
- Limites da Riot do 4.2.3 valem aqui (conteúdo geral, Riot ID visível, aviso de não endossado).
- Confrontos com poucas partidas mostram "poucos dados". Com chave pessoal a amostra é pequena; melhora
  com chave de produção.
- Coleta e cálculo só no servidor, por patch, atrás da mesma interface única de dados do TFT (fixtures
  primeiro, Riot API depois). Chave só em .env.
- Addon só nos tipos Jogo e Misto e na categoria Addons (4.2.8).

## 4.2.12 Menções no chat (pedido do Eduardo, 22/11) ✅ código concluído (falta teste manual e produção)

Achado do Eduardo: digitar "@" no chat não mostrava ninguém para escolher, e só `@usuario` digitado à
mão notificava. Feito entre o 4.2.4 e o 4.2.5. Ver docs/decisions/0052-mentions.md.
- "@" abre uma lista em cima do campo: pessoas que veem o canal, cargos que a pessoa pode marcar,
  `@all` (todos que veem o canal) e `@here` (quem está online). ↑/↓, Enter ou Tab, Esc.
- `@all`, `@here` e cargo não mencionável pedem "Mencionar @all, @here e cargos" (MENTION_EVERYONE);
  cargo mencionável qualquer um marca. Nomes de usuário "all" e "here" ficam reservados.
- Produção: antes, conferir que nenhuma conta se chama "all" ou "here"; backup com data no nome;
  `alembic upgrade heads` (core a4c0e6b8d931 cria messages.mentions) e reiniciar a API, com OK do
  Eduardo. Apps antigos mostram a menção de cargo como `<@&…>` até atualizar (ainda notifica).

## Depois do advogado (início de 2027)
- Idade mínima 18+, termos de uso, política de privacidade, LGPD (a exclusão de conta já ajuda no direito de apagar).
- Moderação entre usuários: bloquear e reportar.

## Backlog (não fazer agora)
- Addon Mundo: mapa ao vivo e quem está online em servidor de Minecraft (BlueMap ou Dynmap, qualquer versão
  suportada por eles, com ou sem mods) e Hytale (plugins de mapa web). O Aureum embute o mapa e lê os
  jogadores; não renderiza nada. Discutir com o Eduardo antes.
- Bot modular do Aureum: avisos programados, lembretes, enquete, sorteio, filtro de palavras e spam, logs só para admin, conta de bot de verdade, entra só se escolhido na criação do servidor. Música no bot só depois de pesquisar licenciamento. API pública de bots no futuro.
- Addon de Valorant. Chave de produção e RSO da Riot.
- Barra de pesquisa global e atalho Ctrl+K.
- Celular (2027), importar servidores do Discord, login com Google e Discord.
- Domínio e identidade visual final.
- Pré-lançamento (a definir com o Eduardo): itens 8 e 10 da 3.18, revisão do inglês, textos da API em inglês.

## Perguntas em aberto
- Barra de pesquisa global / Ctrl+K: fica fora da 4.2, certo?
- Categoria Addons: pode reordenar, recolher e ter permissão própria? (proposta: sim, sem excluir nem renomear)
- Mensagem de desafio dos joguinhos: só resultado resumido, sem spoiler. Está certo?
- Palavras cruzadas por último e dependente de base de pistas com licença. Aceita?
- LoL: aceitar "poucos dados" nos confrontos até a chave de produção?

## Pronto quando (Fase 4.2)
- Criar servidor pede o tipo e a lista de addons segue o tipo, travada.
- Dá para desativar e excluir a conta com 30 dias de carência, dono bloqueado até passar a posse, e limpar contas fake pelo comando de admin.
- Categoria Addons só aceita addons, e addons só existem nela, na tela e na API.
- PiP das chamadas privadas mostra a pessoa certa e deixa escolher quem fica grande.
- Busca dentro do servidor, atividade ao vivo e idioma português/inglês funcionando.
- Joguinhos diários no Início, com compartilhamento em servidor e com amigos.
- Menções no chat: pessoa, cargo, @all e @here, com a lista ao digitar @.
- (TFT e LoL saíram da 4.2: Fase 5, ver FUTURO.md.)
- USABILIDADE.md revisado e a passada final de teste feita.
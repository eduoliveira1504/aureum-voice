# Aureum Voice — Fase 2

Base: fase 1 pronta e rodando no plano B (LiveKit Cloud + Tailscale Funnel).
Regras do CLAUDE.md continuam valendo (custo R$0, segredos só no .env, commits em inglês).
Executar UM bloco por vez, na ordem. Cada bloco: migrações Alembic, testes da API,
atualização do README e um docs/decisions quando houver escolha de arquitetura.
Nada copiado do Discord (sons, ícones, textos, layout idêntico): o Aureum tem identidade própria.

## 2.1 Design system e temas (fazer primeiro)
Todo o app passa a usar tokens (CSS variables + Tailwind theme). Nenhuma cor hardcoded nos componentes.

Fontes (Google Fonts, empacotadas localmente no app): Sora (títulos: 500/600/700),
Figtree (texto/UI: 400/500/600/700).
Raios: 8px (itens de lista), 12px (botões, inputs, cards), 16–20px (painéis, modais).
Ícones: traço 1.8px, estilo linha (ex: lucide), nunca emoji como ícone.

Tokens — modo escuro (padrão):
  bg-rail #0A0908 | bg-panel #12110D | bg-main #17150F | bg-elevated #201D16
  border #2A261D | text #F4EFE4 | text-muted #A8A090
  success #3FBF7F | danger #C7363B | idle #E8B531 | dnd #E5484D
Tokens — modo claro:
  bg-rail #EFE9DC | bg-panel #F6F2E8 | bg-main #FFFFFF | bg-elevated #F3EEE2
  border #E4DCCB | text #1C1810 | text-muted #6B6354
  success #2E9E65 | danger #C7363B | idle #C98F00 | dnd #C7363B
Cor de destaque (accent): padrão Dourado #E8B531. Presets: Ametista #8B5CF6,
Esmeralda #3FBF7F, Brasa #E06A4E, Safira #4F8CC9, mais seletor livre.
- on-accent (texto sobre o accent) calculado automaticamente por contraste
  (WCAG, escolher entre #1A1406 e #FFFFFF, o que der maior contraste).
- No modo claro, quando o accent for usado como TEXTO, escurecer automaticamente
  até atingir 4.5:1 sobre o fundo.
- Preferências por usuário salvas no servidor (tabela user_settings: theme
  dark|light|system, accent_color, sound settings) e aplicadas ao logar.
Tela de Configurações > Aparência: tema, accent (presets + seletor), prévia ao vivo.
Revisar TODAS as telas existentes para usar os tokens.

## 2.2 Call: foco e grade
- Dois modos na call: Grade (todos iguais) e Foco (um tile grande + faixa lateral
  com os outros). Clicar em qualquer tile coloca ele em foco. Botão Foco/Grade no topo.
- Tile de tela compartilhada tem selo "AO VIVO", botão de volume da transmissão e tela cheia.
- Quem está falando ganha anel na cor accent.
- Várias telas ao vivo ao mesmo tempo devem funcionar.
- Economia de banda (IMPORTANTE, cota do LiveKit Cloud): adaptiveStream e dynacast
  ligados; simulcast nas câmeras e telas; tiles pequenos/fora de foco recebem a camada
  de menor resolução; tiles fora da tela não recebem vídeo.

## 2.L Layout novo do Aureum (fazer antes do 2.4)
Objetivo: sair da estrutura do Discord (coluna de servidores + canais + chat + membros).
Nova estrutura do app (shell):

### Barra superior (abas)
- Logo à esquerda. Depois, ABAS: a primeira é sempre "Início" (casa) com contador de
  pendências (pedidos de amizade, DMs não lidas, chamadas perdidas); em seguida, uma
  aba por servidor aberto (ícone + nome). A aba ativa "encaixa" no conteúdo abaixo
  (mesma cor do painel, cantos superiores arredondados).
- Bolinha vermelha na aba quando alguém está transmitindo tela no servidor; badge com
  número de menções.
- Botão "+" para abrir/criar/entrar em servidor. Abas podem ser reordenadas por
  arrastar e fechadas (o servidor continua na conta, só sai da barra). Ordem salva por usuário.
- À direita: botão de busca global "Buscar · Ctrl K", notificações e o botão de perfil
  (avatar com status + nome) que abre o menu: ver perfil, status, configurações, sair.

### Barra lateral (contexto da aba atual)
- Servidor: nome + configurações + botão recolher. Itens: "Visão geral", e as seções
  colapsáveis SALAS (canais de voz: bolinha verde se tem gente, contador, selo AO VIVO),
  CONVERSAS (canais de texto, badge de não lidas na cor accent) e ADDONS (canais addon
  com o ícone do addon).
- Início: Amigos (com contador), lista de DMs e grupos, botão de novo grupo.
- Recolhida: vira uma faixa estreita só com ícones. Estado salvo por usuário.
- Quando o usuário está numa call, o PÉ da barra mostra o card da call (sala, quem
  está falando, mic, tela, "mostrar janelinha", sair), sempre que a janelinha estiver minimizada.

### Visão geral do servidor (tela padrão ao abrir um servidor)
- Banner do servidor no topo (com ícone, nome, "N online · N transmitindo · N membros",
  botão Convidar).
- "Salas agora": cards das salas de voz, ao vivo. Sala com transmissão mostra a
  miniatura da tela (snapshot de baixa resolução, atualizado a cada poucos segundos,
  para não gastar banda) com selo AO VIVO; sem transmissão mostra os avatares grandes
  com anel em quem fala. Card da sala onde o usuário está tem borda accent e
  "VOCÊ ESTÁ AQUI". Salas vazias aparecem com borda tracejada e "Abrir a sala".
- "Addons do servidor": card resumo por addon (ex: quadro com barra de progresso
  a fazer/fazendo/feito; cinema com quantos assistindo; mapa com status do servidor).
- Coluna lateral: "Novidades" (últimas mensagens não lidas dos canais) e "Online agora".

### Painéis (área de conteúdo)
- Conversas, addons e a call em tela grande abrem em PAINÉIS com abas próprias.
- Até 2 painéis lado a lado (ex: chat + quadro). Abrir com clique do meio, Ctrl+clique
  ou arrastando a aba para a lateral; divisor arrastável; fechar painel no X.
- Na barra lateral, item aberto em painel fica destacado e indica "painel 1/2".
- Layout de painéis salvo por servidor e por usuário.
- Chat em balões: mensagens dos outros à esquerda com avatar quadrado arredondado;
  as do próprio usuário à direita, com fundo accent escurecido.
- Eventos de addon aparecem no chat como linha de sistema
  (ex: "Eduardo moveu Sistema de classes para Fazendo").

### Call
- Janelinha flutuante (picture-in-picture) no canto inferior direito, arrastável para os
  4 cantos: mostra a tela em foco ou quem fala, nome da sala, "X está falando",
  mic, expandir (abre a call num painel ou tela cheia, com os modos Foco/Grade do 2.2)
  e sair. Pode ser minimizada para o card no pé da barra lateral.
- A janelinha usa a camada de menor resolução do vídeo (economia de banda).

### Lista de membros
- Sai da coluna fixa da direita. Fica acessível por um botão "Membros" no cabeçalho
  do canal/painel, abrindo um painel lateral recolhível (mesmo agrupamento por cargo do 2.4).

### Responsivo
- Abaixo de ~1100px: barra lateral recolhe para ícones automaticamente e só 1 painel.

Pronto quando: abrir o app cai no Início; abrir um servidor cai na Visão geral com
salas ao vivo; dá pra abrir #geral e o Quadro lado a lado; entrar numa call mostra a
janelinha, que pode ser minimizada para a barra lateral.
Visual de referência: tokens do 2.1 (tema escuro, accent dourado, Sora + Figtree).

## 2.3 Social: amigos, DMs e chamadas privadas
Modelo:
- friendships: requester_id, addressee_id, status (pending|accepted|blocked), created_at
- channels type dm (2 pessoas) e group_dm (até 10), server_id NULL; channel_members
- calls: id, channel_id, started_by, started_at, ended_at; call_participants
Funcionalidades:
- Tela Amigos (Início): abas Online, Todos, Pendentes (com contador), Bloqueados;
  "Adicionar amigo" por @username; aceitar/recusar/cancelar/bloquear.
- Lista de DMs e grupos na barra lateral do Início; criar grupo a partir dos amigos.
- Chamada privada em DM/grupo: botão ligar → evento call.ringing via WebSocket →
  popup "X está te ligando" com atender/recusar e som de toque; tempo limite de 30s;
  adicionar mais pessoas a uma call em andamento.
- Painel "Ativo agora": amigos em call (com botão entrar) e atividade atual.
- Presença: online, ausente (inatividade), não perturbe (silencia toques e sons), invisível.
- Só amigos podem iniciar DM e ligação (configurável depois).

## 2.4 Servidor: cargos, banner/ícone, barra de membros
- Ícone e banner do servidor (PNG/JPG/GIF/WebP animado, máx 8MB, MinIO), exibidos
  como no mockup: banner no topo da lista de canais com o nome por cima.
- Barra de membros recolhível (botão no cabeçalho do canal), estado lembrado por usuário.
- Membros agrupados por cargo "exibido separadamente", com contador; offline no fim.
Cargos completos:
- roles: id, server_id, name, color, icon_url, position (hierarquia), permissions (bigint
  bitfield), hoist (exibir separado), mentionable; member_roles (N:N); cargo @everyone implícito.
- Permissões (mínimo): ADMINISTRATOR, MANAGE_SERVER, MANAGE_ROLES, MANAGE_CHANNELS,
  KICK_MEMBERS, BAN_MEMBERS, CREATE_INVITE, CHANGE_NICKNAME, MANAGE_NICKNAMES,
  VIEW_CHANNEL, SEND_MESSAGES, ATTACH_FILES, ADD_REACTIONS, MENTION_EVERYONE,
  MANAGE_MESSAGES, READ_HISTORY, CONNECT, SPEAK, VIDEO, STREAM, MUTE_MEMBERS,
  DEAFEN_MEMBERS, MOVE_MEMBERS, MANAGE_ADDONS.
- Hierarquia: ninguém edita/atribui cargo igual ou acima do seu; dono ignora tudo.
- Overrides por canal: channel_permission_overrides (channel_id, target role|member,
  allow bitfield, deny bitfield). Ordem de cálculo documentada em docs/decisions.
- Todas as rotas e eventos do WebSocket checam permissão no servidor (nunca só no front).
- Telas: Configurações do servidor > Cargos (criar, reordenar por arrastar, cor,
  permissões com toggles), Membros (atribuir cargos, expulsar, banir), e aba
  Permissões nas configurações de cada canal.
- Testes cobrindo o cálculo de permissões e a hierarquia.

## 2.5 Perfil turbinado
Campos novos: pronouns, custom_status (texto + expiração), profile_color (cor do cartão),
avatar_frame (moldura: none | accent | escolha de presets), favorite_song (título,
artista, link opcional), links (lista de {label, url}, máx 5, só https), activity
(jogando X: manual por enquanto; detecção automática de jogo fica pra depois).
Insígnias (badges) são definidas pelo sistema, não pelo usuário (ex: Fundador, Beta).
Cartão de perfil (popover ao clicar no nome/avatar) igual ao mockup: banner, avatar com
moldura e status, insígnias, nome, @user · pronomes, status personalizado, Sobre mim,
"Membro desde", bloco AGORA (jogando / música do perfil), cargos do servidor atual,
links, botões Mensagem / Ligar / mais opções.
Tela Configurações > Perfil com prévia ao vivo do cartão.

## 2.6 Sons
Eventos: entrar na call, sair, alguém entrou, alguém saiu, mutar, desmutar,
ensurdecer, mensagem nova (DM/menção), chamada tocando (loop), chamada recusada/encerrada,
tela compartilhada iniciada.
- Sons próprios: gerar via síntese (Web Audio / script que exporta .ogg) OU usar
  bibliotecas CC0 (ex: Kenney). Registrar origem e licença de cada arquivo em
  docs/sounds/LICENSES.md. Nada de sons do Discord ou de outros apps.
- Configurações > Sons: volume geral e liga/desliga por evento. Não perturbe silencia.

## 2.7 Overlay em jogo
- BrowserWindow separada: transparente, sem moldura, alwaysOnTop nível 'screen-saver',
  skipTaskbar, setIgnoreMouseEvents(true, { forward: true }) (clique passa pro jogo).
- Mostra: participantes da call atual (avatar, nome, anel de quem fala, ícone de mudo)
  e, opcionalmente, câmeras ligadas em miniatura (incluindo a própria).
- Atalho global para ligar/desligar o overlay e para entrar em "modo edição"
  (aí recebe clique, dá pra arrastar e redimensionar; posição salva).
- Configurações > Overlay: ligar/desligar, posição, tamanho, opacidade, mostrar câmeras.
- Limitação documentada: funciona em jogos no modo janela/sem borda; tela cheia
  exclusiva não é suportada. Sem injeção em processo de jogo (anti-cheat).

## 2.8 Addons
Framework:
- Novo tipo de canal: addon (channels.type = 'addon', addon_key, config jsonb).
- Registro de addons no backend (addon_key, nome, ícone, rotas, permissões);
  cada addon é um módulo isolado em apps/api/app/addons/<key>/ com router, models
  (tabelas com prefixo addon_<key>_) e migrações próprias, e no desktop em
  apps/desktop/src/addons/<key>/. Permissão MANAGE_ADDONS para criar/configurar.
Addon 1 — Kanban (quadro): pensado para virar produto separado no futuro, então
  nenhuma dependência direta de servidor/canal dentro do módulo além de uma
  "workspace_id" genérica. Colunas, cards (título, descrição, responsável, etiquetas,
  prazo), arrastar entre colunas, tempo real via WebSocket, histórico de alterações.
Addon 2 — Assistir junto (YouTube): YouTube IFrame Player API oficial; fila de vídeos,
  play/pause/seek/troca sincronizados via WebSocket (um "host" com controle, transferível);
  card no chat "Assistir junto · #canal · N assistindo · Entrar".
  PROIBIDO: bloquear anúncios, baixar ou extrair o stream do vídeo, ou qualquer coisa
  que viole os termos do YouTube. Anúncios aparecem normalmente (quem tem Premium não vê).
Depois (não agora): mapa Minecraft (BlueMap), status do servidor de Mine, dados/fichas
  de RPG, ouvir junto no Spotify.

## Pronto quando
- Tema claro/escuro e accent personalizável em todas as telas.
- Duas pessoas que são amigas se ligam sem servidor; dá pra adicionar uma terceira.
- Um servidor com cargos personalizados restringe um canal só para um cargo.
- Call com 2 telas ao vivo + câmeras, com foco por clique.
- Overlay mostra quem fala por cima de um jogo em janela sem borda.
- Kanban e Assistir junto funcionando em canais de addon.
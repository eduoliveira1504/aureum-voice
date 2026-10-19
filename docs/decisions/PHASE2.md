# Aureum Voice — Fase 2

Base: fase 1 pronta e rodando no plano B (LiveKit Cloud + Tailscale Funnel).
Regras do CLAUDE.md continuam valendo (custo R$0, segredos só no .env, commits em inglês,
sem IA no produto).
Executar UM bloco por vez, na ordem. Cada bloco: migrações Alembic, testes da API,
atualização do README e um docs/decisions quando houver escolha de arquitetura.
Nada copiado do Discord (sons, ícones, textos, layout idêntico): o Aureum tem identidade própria.

Status: blocos com ✅ estão prontos; NÃO refazer. Próximo: 2.9 (Polimentos concluídos; Cinema adiado).
Ordem restante: 2.9.

## 2.1 Design system e temas ✅ concluído
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

## 2.2 Call: foco e grade ✅ concluído
- Dois modos na call: Grade (todos iguais) e Foco (um tile grande + faixa lateral
  com os outros). Clicar em qualquer tile coloca ele em foco. Botão Foco/Grade no topo.
- Tile de tela compartilhada tem selo "AO VIVO", botão de volume da transmissão e tela cheia.
- Quem está falando ganha anel na cor accent.
- Várias telas ao vivo ao mesmo tempo devem funcionar.
- Economia de banda: adaptiveStream e dynacast ligados; simulcast nas câmeras e telas;
  tiles pequenos/fora de foco recebem a camada de menor resolução; tiles fora da tela
  não recebem vídeo.

## 2.L Layout novo do Aureum ✅ concluído
Objetivo: sair da estrutura do Discord (coluna de servidores + canais + chat + membros).

### Barra superior (abas)
- Logo à esquerda. Depois, ABAS: a primeira é sempre "Início" (casa) com contador de
  pendências (pedidos de amizade, DMs não lidas, chamadas perdidas); em seguida, uma
  aba por servidor aberto (ícone + nome). A aba ativa "encaixa" no conteúdo abaixo.
- Bolinha vermelha na aba quando alguém está transmitindo tela no servidor; badge com
  número de menções.
- Botão "+" para abrir/criar/entrar em servidor. Abas reordenáveis e fecháveis
  (o servidor continua na conta). Ordem salva por usuário.
- À direita: busca global "Buscar · Ctrl K", notificações e botão de perfil
  (avatar com status + nome): ver perfil, status, configurações, sair.

### Barra lateral (contexto da aba atual)
- Servidor: nome + configurações + recolher. Itens: "Visão geral", e as seções
  colapsáveis SALAS, CONVERSAS e ADDONS.
- Início: Amigos (com contador), lista de DMs e grupos, botão de novo grupo.
- Recolhida: faixa estreita só com ícones. Estado salvo por usuário.

### Visão geral do servidor (tela padrão ao abrir um servidor)
- Banner do servidor no topo (ícone, nome, "N online · N transmitindo · N membros", Convidar).
- "Salas agora": cards das salas de voz ao vivo (miniatura da tela em baixa resolução
  pela API/WebSocket; avatares com anel em quem fala; "VOCÊ ESTÁ AQUI"; salas vazias
  tracejadas com "Abrir a sala").
- "Addons do servidor": card resumo por addon.
- Coluna lateral: "Novidades" e "Membros" (ver 2.R).

### Painéis (área de conteúdo)
- Conversas, addons e a call em tela grande abrem em PAINÉIS com abas próprias.
- Até 2 painéis lado a lado; divisor arrastável; layout salvo por servidor e usuário.
- Chat em balões; eventos de addon aparecem como linha de sistema no chat.

### Call
- Janelinha flutuante (picture-in-picture), arrastável para os 4 cantos, com a camada
  de menor resolução; expandir abre a call em painel/tela cheia (Foco/Grade do 2.2).

### Lista de membros
- Painel lateral recolhível aberto pelo botão "Membros" no cabeçalho do canal/painel.

### Responsivo
- Abaixo de ~1100px: barra lateral recolhe para ícones e só 1 painel.

Read-state mínimo: channel_reads (user_id, channel_id, last_read_message_id, mention_count).

## 2.3 Social: amigos, DMs e chamadas privadas ✅ concluído
- friendships (pending|accepted|blocked); channels dm/group_dm (até 10) com channel_members;
  calls + call_participants.
- Tela Amigos (Online, Todos, Pendentes, Bloqueados), adicionar por @username.
- DMs e grupos na barra do Início; chamada privada com toque (call.ringing), atender/recusar,
  tempo limite de 30s, adicionar pessoas à call.
- Painel "Ativo agora"; presença: online, ausente, não perturbe, invisível.
- Só amigos podem iniciar DM e ligação.

## 2.4 Servidor: cargos, banner/ícone, barra de membros ✅ concluído
- Ícone e banner do servidor (PNG/JPG/GIF/WebP animado, máx 8MB).
- Cargos: roles (name, color, icon_url, position, permissions bitfield, hoist, mentionable),
  member_roles, @everyone implícito; hierarquia; dono ignora tudo.
- Permissões: ADMINISTRATOR, MANAGE_SERVER, MANAGE_ROLES, MANAGE_CHANNELS, KICK_MEMBERS,
  BAN_MEMBERS, CREATE_INVITE, CHANGE_NICKNAME, MANAGE_NICKNAMES, VIEW_CHANNEL,
  SEND_MESSAGES, ATTACH_FILES, ADD_REACTIONS, MENTION_EVERYONE, MANAGE_MESSAGES,
  READ_HISTORY, CONNECT, SPEAK, VIDEO, STREAM, MUTE_MEMBERS, DEAFEN_MEMBERS,
  MOVE_MEMBERS, MANAGE_ADDONS.
- Overrides por canal: channel_permission_overrides (allow/deny bitfields).
  (Correção da tela de permissões do canal: ver Polimentos.)
- Rotas e eventos do WebSocket checam permissão no servidor.

## 2.R Ajustes dos testes com a galera ✅ concluído
- Chat da call privada como painel lateral recolhível, participantes sempre visíveis.
- Supressão de ruído com RNNoise (WASM), sem recursos pagos; echoCancellation e
  autoGainControl ligados.
- Volume individual por participante (0–200%) e mutar localmente.
- Painel da call no pé da barra lateral sempre visível durante a call.
- Participantes listados embaixo de cada sala de voz na barra lateral.
- Colunas redimensionáveis; aba "Visão geral" sempre a primeira e fixa.
- Abas com ícone do servidor e prévia com banner ao passar o mouse.
- Visão geral: bloco único "Membros" + "Novidades" por canal.
- Menus de contexto (botão direito) em usuários, canais e servidores, respeitando permissões.

## 2.5 Perfil turbinado ✅ concluído
- custom_status (texto + expiração), profile_color, avatar_frame, favorite_song, links (máx 5,
  só https), activity; cartão de perfil completo; Configurações > Perfil com prévia ao vivo.
- Balão de status junto do avatar.
- "Jogando X" automático: lista de processos do Windows comparada com uma lista PRÓPRIA
  de jogos (JSON local) + jogos adicionados pelo usuário; opção de desligar e esconder jogos.
  Não usar a lista de jogos do Discord.

## 2.6 Sons ✅ concluído
- Sons gerados por síntese (scripts/generate-sounds.mjs, ffmpeg como requisito de dev),
  família tonal em Mi maior, timbre de sino leve. Licença: © Aureum, todos os direitos
  reservados (não CC0). Registro em docs/sounds/LICENSES.md.
- Eventos: call-join, call-leave, user-join, user-leave, mute, unmute, deafen, undeafen,
  message, call-ringing (loop), call-outgoing, call-ended, screen-share.
- Durante call, som de mensagem com volume reduzido; não toca se for do canal/DM da call.
- Não perturbe: silencia sons gerados por outras pessoas e o popup de chamada (vira
  "chamada perdida" + badge no Início); sons de ação do próprio usuário continuam.
- Configurações > Sons: volume geral e liga/desliga por evento.

## 2.7 Overlay em jogo ✅ concluído
- BrowserWindow separada: transparente, sem moldura, alwaysOnTop nível 'screen-saver',
  skipTaskbar, setIgnoreMouseEvents(true, { forward: true }) (clique passa pro jogo).
- Mostra: participantes da call atual (avatar, nome, anel de quem fala, ícone de mudo)
  e, opcionalmente, câmeras ligadas em miniatura (incluindo a própria).
- Atalho global para ligar/desligar o overlay e para entrar em "modo edição"
  (aí recebe clique, dá pra arrastar e redimensionar; posição salva). Atalhos que não
  conflitem com jogos comuns; configuráveis.
- Configurações > Overlay: ligar/desligar, posição, tamanho, opacidade, mostrar câmeras.
- Limitação documentada: funciona em jogos no modo janela/sem borda; tela cheia
  exclusiva não é suportada. Sem injeção em processo de jogo (anti-cheat).

## 2.8 Addons
Em 3 partes: 1) framework + addon de exemplo "notes" ✅ concluída (ver
docs/decisions/0013-addon-framework.md); 2) Kanban ✅ concluída, com linhas de sistema no
chat e o "notes" removido (ver docs/decisions/0014-kanban-addon.md); 3) Assistir junto
(Cinema): ADIADO, ver abaixo.
Framework:
- Novo tipo de canal: addon (channels.type = 'addon', addon_key, config jsonb).
- Registro de addons no backend (addon_key, nome, ícone, rotas, permissões);
  cada addon é um módulo isolado em apps/api/app/addons/<key>/ com router, models
  (tabelas com prefixo addon_<key>_) e migrações próprias, e no desktop em
  apps/desktop/src/addons/<key>/. Permissão MANAGE_ADDONS para criar/configurar.
- Substituir os placeholders "EM BREVE" da barra lateral e da Visão geral pelos addons reais.
Addon 1 — Kanban (quadro): pensado para virar produto separado no futuro, então
  nenhuma dependência direta de servidor/canal dentro do módulo além de uma
  "workspace_id" genérica. Colunas, cards (título, descrição, responsável, etiquetas,
  prazo), arrastar entre colunas, tempo real via WebSocket, histórico de alterações.
  Card resumo na Visão geral com progresso a fazer/fazendo/feito.
Addon 2 — Cinema (salas de cinema com YouTube): ADIADO para depois do beta.
  Ideia guardada: canal fixo de cinema, host com fila, quem entra cai no vídeo/tempo atual,
  voz embutida, arquitetura de "player" por provedor (YouTube, depois Twitch/Vimeo/link direto).
  Sem bloquear anúncio, sem baixar vídeo, sem fontes piratas.
Depois (não agora): mapa Minecraft (BlueMap), status do servidor de Mine, dados/fichas
  de RPG, ouvir junto no Spotify.

## Polimentos ✅ concluído
Ver docs/decisions/0015 (anexos e segundo plano), 0016 (interface e testes) e 0017 (media tiers).
- Barra de título customizada: titleBarStyle 'hidden' + titleBarOverlay (cores dos tokens);
  abas do Aureum ocupam o topo; área arrastável nas partes vazias da barra.
- Banner padrão do servidor: padrão geométrico com a cor accent (sem degradê);
  com banner enviado, mostrar a imagem.
- Campo de pronomes no perfil (aparece no cartão "@user · pronomes"; conferir se existe
  no modelo e na tela de Configurações > Perfil; se não, adicionar).
- Qualidade de transmissão (base para o futuro plano Aureum+):
  - Limite padrão para todos: compartilhamento de tela até 720p; câmera até 720p.
  - Dois modos no seletor de tela: "Texto nítido" (720p, 15 fps, contentHint 'detail',
    prioriza resolução) e "Movimento" (720p, 30 fps, contentHint 'motion', prioriza fps).
  - O limite vem do servidor: a API devolve, junto com o token de voz, o "media tier" do
    usuário (ex: { maxScreen: '720p', maxFps: 30 }) e o app aplica nas opções de publicação.
    Guardar o tier no usuário (users.plan = 'free' por padrão), pronto para planos futuros.
  - Simulcast mantido: quem assiste em janela pequena recebe camada menor.
- Permissões por canal (corrigir o 2.4):
  - Criar canal (texto e voz): toggle "Canal privado" + seleção de cargos e/ou membros
    que podem ver/entrar. Ao ativar: @everyone recebe deny VIEW_CHANNEL (e CONNECT em voz)
    no canal, e os cargos/membros escolhidos recebem allow.
  - A tela "Permissões" das configurações do CANAL deve editar só os overrides daquele
    canal (channel_permission_overrides), nunca as permissões globais do cargo.
    Layout: lista de cargos/membros com override no canal + botão "Adicionar cargo ou
    membro"; para cada um, cada permissão em 3 estados: Permitir / Herdar (neutro) /
    Negar. Texto de ajuda: "Herdar = usa a permissão do cargo no servidor".
  - Canal privado mostra cadeado na barra lateral; quem não tem VIEW_CHANNEL não vê o
    canal em lugar nenhum (barra, Visão geral, busca, Novidades, notificações).
  - Testes: membro sem o cargo não lista, não lê, não envia e não entra na call do canal
    privado (inclusive via API direta e WebSocket).
- Visão geral do servidor: esconder o botão "Membros" (👥) do cabeçalho e não exibir o
  painel lateral de membros nessa aba, porque a Visão geral já tem o bloco "Membros".
  Ao voltar para #canal/call/addon, o painel volta ao estado salvo (aberto/fechado)
  daquela aba. O estado do painel de membros é salvo por aba, não global.
- Menu de contexto do usuário em TODO lugar onde aparece uma pessoa (um único componente
  UserContextMenu reutilizado, com as mesmas regras de permissão do 2.R):
  barra lateral do Início (lista de Mensagens diretas e grupos), cabeçalho da DM,
  membros de grupo DM, nome e avatar do autor no chat, menções (@usuario), tiles e lista
  de participantes da call, participantes embaixo das salas na barra lateral, bloco
  Membros da Visão geral, painel lateral de Membros, "Ativo agora" e cartão de perfil.
- Itens extras no botão direito de uma conversa na lista de Mensagens diretas:
  Marcar como lida, Silenciar conversa, Fechar DM (some da lista até nova mensagem);
  em grupo DM também: Renomear grupo, Alterar ícone, Sair do grupo.
- Teste: clicar com o botão direito em cada um desses lugares abre o menu, com os itens
  corretos para a permissão do usuário.
  - Chat: as mensagens do próprio usuário também mostram o avatar dele (do lado direito,
  espelhando as dos outros), com o mesmo UserContextMenu.
- Anexos no chat (canais, DMs e grupos), com permissão ATTACH_FILES nos servidores:
  - Botão "+" no campo de mensagem, arrastar e soltar arquivos na conversa e colar
    imagem com Ctrl+V; vários arquivos por mensagem; barra de progresso de envio.
  - Limite de 25 MB por arquivo (configurável no .env); armazenados no MinIO e servidos
    pela API em /api/media com checagem de permissão (quem não vê o canal não baixa).
  - Imagens e GIFs: miniatura no chat, clique abre em tela cheia (visualizador com
    zoom e "baixar"). Vídeos curtos: player embutido. Outros arquivos: card com ícone,
    nome, tamanho e botão baixar.
  - Base para a mensagem de voz do 2.9 (que usa o mesmo sistema de anexos).
- Segundo plano (como todo app de comunicação):
  - Fechar no X esconde a janela em vez de sair; o app continua conectado (call, mensagens,
    chamadas e notificações seguem funcionando).
  - Ícone na bandeja do Windows: clique abre o app; menu com Abrir Aureum, Silenciar
    microfone, Ensurdecer, status (Online / Ausente / Não perturbe / Invisível) e
    Sair do Aureum (fecha de verdade, saindo da call).
  - Uma única instância do app (abrir de novo só traz a janela existente para frente).
  - Configurações > Windows: "Ao fechar: minimizar para a bandeja / sair",
    "Iniciar com o Windows" (padrão: ligado, iniciando minimizado na bandeja).
  - Na primeira vez que fechar no X, aviso: "O Aureum continua rodando na bandeja".

## 2.9 Pré-beta (fazer por último, antes de chamar os testers) ✅ concluído
Ver docs/decisions/0018-pre-beta.md. Pendente só o lançamento (zerar os dados e criar as
contas), que fica para depois do 2.10.
Essenciais:
- Atualização automática: electron-updater com releases no GitHub (privado ou público);
  checa ao abrir e a cada 6h, baixa em segundo plano, aviso "Reiniciar para atualizar".
  Instalador e updates com o mesmo appId; canal "beta". Token do GitHub (se necessário)
  só no .env, nunca no código.
- Botão "Reportar problema" (menu do perfil e atalho Ctrl+Shift+R): descrição, print
  opcional da janela, versão, SO e últimos logs anexados automaticamente; vai para a
  API (tabela bug_reports) e aparece numa tela simples só para o dono.

Insígnias (sistema "família"):
- Tabelas badges (id, key, nome, descrição, ícone SVG full + small,
  raridade: comum|rara|lendaria|mitica, numbered: bool, exclusive_beta: bool) e
  user_badges (user_id, badge_id, number nullable, granted_at, granted_by).
  Concedidas pelo sistema ou pelo dono do app, nunca pelo próprio usuário.
- Ordem de raridade: comum < rara < lendária < mítica.
- Visual: moldura hexagonal; o metal indica a raridade:
  - comum = bronze #C08A5A
  - rara = prata #C9D1DA
  - lendária = ouro #E8B531 com moldura dupla, sem animação
  - mítica = ouro #E8B531 com moldura dupla + glow suave ao redor + efeito "brilho
    passando" (faixa de luz diagonal semitransparente que atravessa a insígnia a cada ~4s,
    recortada no formato da insígnia)
  Ícone interno em SVG próprio, nunca emoji.
- Animação feita no componente (CSS), não dentro dos arquivos SVG. No cartão de perfil
  e no tooltip o brilho roda sozinho; em listas (membros, chat, call) só roda ao passar
  o mouse. Respeitar prefers-reduced-motion (sem animação).
- SVG "full" no tooltip e em telas grandes; SVG "small" ao lado do nome em tamanhos até 32px.
- Exibição: ao lado do avatar no cartão de perfil (até 5 visíveis + "+N"), ordenadas da
  mais rara para a mais comum, com tooltip: nome, raridade, descrição, número (se
  numerada) e data de recebimento.
- Insígnias míticas são exclusivas dos primeiros: nunca mais concedidas depois do beta.
- Insígnias do beta (ambas MÍTICAS):
  - "Fundador": concedida automaticamente à conta cujo username está em
    AUREUM_OWNER_USERNAME no .env. Se a conta ainda não existir, conceder assim que for criada.
  - Insígnia do beta (NUMERADA por ordem de cadastro, ex: "Pioneiro #7"): concedida a quem
    criar conta enquanto AUREUM_BETA=true no .env. Nome e ícone em votação; usar o
    placeholder "Pioneiro" com a bússola. Trocar nome/SVG depois sem mexer nos números
    já concedidos.
- Deixar fácil adicionar novas insígnias depois (seed/migração), já prevendo:
  Caçador de bugs (rara, ao marcar um bug_report como resolvido), Veterano (rara, por ano
  de conta), Construtor (comum, servidor com 5+ membros), Aureum+ (lendária, futuro).

Comunicação:
- Mensagem de voz: segurar o botão de microfone no campo de mensagem para gravar
  (ou clicar para começar/parar), máx 5 min, Opus/WebM, enviada como anexo de áudio
  (sistema de anexos dos Polimentos); player com forma de onda, duração e velocidade
  1x/1.5x/2x. Arrastar para cancelar.
- Push-to-talk: modo de entrada "Detecção de voz" ou "Pressionar para falar" em
  Configurações > Voz; atalho global configurável (funciona com o app em segundo plano
  e em jogos), reaproveitando a leitura de teclas do 2.7 com as mesmas regras de
  privacidade (só a tecla configurada, só enquanto o PTT estiver ativo); som curto ao
  apertar/soltar (opcional).

Contas e lançamento do beta:
- Usernames reservados (ninguém registra; comparação sem maiúsc./minúsc.): aureum, admin,
  administrador, suporte, support, staff, equipe, sistema, system, oficial, official,
  moderador, mod. Mensagem amigável no cadastro ("Esse nome é reservado").
- Comando de admin (script rodado no terminal, não pela interface) para criar contas com
  nomes reservados. Contas criadas por ele não recebem a insígnia do beta.
- Conta oficial @aureum (futura: avisos, mensagens do sistema, suporte), separada da conta
  pessoal do dono (@edu, com a insígnia Fundador).
- Antes do beta: zerar todos os dados (banco + MinIO), SÓ com confirmação explícita do
  Eduardo. Ordem: zerar → criar @edu primeiro (Fundador + Pioneiro #1) → criar @aureum
  pelo comando de admin → gerar o instalador do beta.

## 2.10 — E-mails da conta, convites e página web de convite ✅ concluído
Ver docs/decisions/0019-account-emails-and-invites.md. Pendente só o lançamento (abaixo), que é
um passo separado.

### E-mail
- Provedor trocável via .env (EMAIL_PROVIDER=smtp agora, com Gmail do Aureum; Resend/Brevo depois).
- Fila em background com retry. Templates pt-BR em HTML + texto puro. Remetente: "Aureum".
- Base visual: docs/design/emails/boas-vindas.html e codigo.html (placeholders {{nome}},
  {{numero}}, {{convites}}, {{codigo}}, {{email}}, {{app_url}}, {{badge_url}}, {{logo_url}}).
  E-mails de esqueci a senha e aviso de segurança no mesmo estilo.
- Gmail não mostra SVG: gerar PNGs (2x) da insígnia Pioneiro com brilho e do logo, servidos
  pela API em /static/email/..., com URL base no .env (PUBLIC_BASE_URL = URL do Funnel).
- Código de confirmação: 6 dígitos, 15 min, 5 tentativas, reenvio após 60s. Conta não
  confirmada pode logar mas não cria servidor.
- Boas-vindas: enviado após a confirmação, com o número do Pioneiro e a quantidade de convites.
- Esqueci a senha por código: mesma resposta com ou sem conta; ao trocar, encerra as outras sessões.
- Aviso de segurança na troca de senha e de e-mail (o de e-mail vai pro e-mail ANTIGO).
- Troca de e-mail em Configurações › Conta (confirma o novo por código).

### Pioneiro numerado
- Concedido na confirmação do e-mail, enquanto AUREUM_BETA=true.
- Número vem de uma sequence do Postgres: único, nunca reaproveitado (nem se a conta for apagada),
  seguro contra confirmações simultâneas.
- Números podem ser reservados (--pioneiro N); a sequence pula reservados.
- Contas --oficial nunca recebem.

### Convites (cadastro só com convite enquanto AUREUM_INVITE_ONLY=true)
- Individuais: uso único. Cada usuário confirmado ganha 3, em Configurações › Convites
  (copiar link, status livre/usado). Contas oficiais não ganham.
- De grupo: várias vagas e validade (ex.: 15 usos, 7 dias). Mensagem clara quando esgota ou vence.
- Registro de quem convidou quem, para os dois tipos.
- O link copiado é a URL da página web: {PUBLIC_BASE_URL}/convite/{codigo}.
- Com AUREUM_INVITE_ONLY=false o campo de convite some do cadastro.

### Página web de convite (/convite/{codigo})
- Referência visual: docs/design/emails/Invite.dc.html. Mobile-first, HTML/CSS próprios,
  sem framework, mesmo visual dos e-mails.
- Passo 1: cadastro, com "@fulano te chamou" no topo (ou "Convite do grupo · X vagas
  restantes"), código já preenchido, @ checado na hora.
- Passo 2: código do e-mail (reenvio, dica de spam, trocar e-mail).
- Passo 3: Pioneiro nº X + botão de download do último release no GitHub. Se o acesso for
  de celular, avisa e envia o link de download por e-mail.
- Rate limit por IP no cadastro e na verificação. Só cadastro: sem login web.

### Servidor oficial
- CLI marca um servidor como oficial. Todo usuário entra automaticamente ao confirmar o
  e-mail e pode sair quando quiser.

### CLI
- python -m app.cli invites create --count N            (uso único)
- python -m app.cli invites create --usos 15 --dias 7   (grupo)
- python -m app.cli invites create --pioneiro N         (convite que reserva o número N)
- python -m app.cli users create --username X --email Y [--pioneiro N] [--confirmado] [--oficial]
  - Sem --password: gera senha temporária forte, mostra uma vez no terminal (nunca em log),
    obriga troca no primeiro login (tela obrigatória no app).
  - --confirmado: e-mail já confirmado, Pioneiro concedido e boas-vindas enviado na hora.
  - --oficial: conta da empresa, sem Pioneiro e sem convites, com selo "Oficial" no perfil.
  - Contas da CLI SEM --oficial seguem as regras normais.
- python -m app.cli servers set-official --server-id X

### Testes
- API: código (expiração, tentativas, reenvio), esqueci a senha, troca de e-mail, convite
  inválido/usado/esgotado/vencido, numeração concorrente do Pioneiro, número reservado,
  conta CLI --confirmado RECEBE Pioneiro, conta --oficial NÃO recebe, auto-join no servidor
  oficial, troca obrigatória de senha temporária, rate limit.
- Componentes: telas novas do app (confirmação, convites, troca de e-mail, troca obrigatória
  de senha).

### Lançamento (passo SEPARADO, só com OK do Eduardo e comando mostrado antes)
1. Zerar os dados.
2. @edu: Fundador + Pioneiro nº 1 (e-mail real, --confirmado).
3. Conta da namorada: --pioneiro 2 --confirmado.
4. @aureum: --oficial.
5. Criar o servidor do beta e marcar como oficial.
6. Gerar o convite de grupo pro WhatsApp.
7. Gerar o instalador e publicar o release.

## 2.11 — Ajustes antes do lançamento ✅ concluído
- Configurações (do usuário, do servidor e do canal) funcionam em qualquer tamanho de janela:
  o modal nunca passa da altura da janela, o corpo rola, as abas nunca quebram linha (rolam de
  lado quando não cabem) e as Configurações do usuário têm altura estável entre abas.
- Sai o selo "Oficial". Entram dois sinais ao lado do nome, em todo lugar onde ele aparece
  (chat, lista de membros, call, perfil e menções):
  - Verificado (users.is_verified): check dourado num hexágono, no estilo das insígnias.
    Tooltip "Conta verificada".
  - BOT (users.is_bot): etiqueta pequena "BOT". Tooltip "Conta automatizada do Aureum".
  - CLI: --oficial marca is_official + is_verified + is_bot; --verificado e --bot separados;
    `users update` liga essas marcas numa conta que já existe (--oficial só se ela não tiver
    Pioneiro nem convites).
  - Só visual neste bloco: nada de token de bot, API de bot ou automação.
- Ao lado do nome, as 2 insígnias mais raras (no cartão de perfil continuam todas). Ordem:
  raridade (mítica > lendária > rara > comum), depois a prioridade fixa da insígnia
  (badges.priority: Fundador antes de Pioneiro), depois a mais antiga. Ordem visual: nome →
  verificado → BOT → insígnias; sem espaço, o nome é cortado com reticências e os ícones
  nunca encolhem nem se sobrepõem.

### Futuro
- Bot do Aureum: automação com regras fixas, sem IA, autenticação por token.

## Pronto quando (Fase 2 completa)
- Tema claro/escuro e accent personalizável em todas as telas.
- Duas pessoas que são amigas se ligam sem servidor; dá pra adicionar uma terceira.
- Um servidor com cargos personalizados restringe um canal só para um cargo.
- Call com 2 telas ao vivo + câmeras, com foco por clique.
- Overlay mostra quem fala por cima de um jogo em janela sem borda.
- Kanban funcionando em canal de addon.
- App se atualiza sozinho; testers conseguem reportar bugs de dentro do app.
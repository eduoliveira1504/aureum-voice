# Aureum Voice — Fase 3

Base: Fase 2 concluída. Beta fechado no ar desde 19/10/2026, plano B (LiveKit Cloud +
Tailscale Funnel), com usuários reais.
Regras do CLAUDE.md continuam valendo (custo R$0, segredos só no .env, commits em inglês,
sem IA no produto, nada copiado do Discord, regras de privacidade do teclado/overlay).
Executar UM bloco por vez, na ordem. Dentro do bloco: um item por vez, commit por item,
sem push (push só quando o Eduardo pedir). Plano curto antes de começar. Migrações
Alembic, testes da API, README e docs/decisions quando houver escolha de arquitetura.
O Eduardo decide quando gerar release; uma release pode juntar um ou mais blocos.
Ao terminar um bloco, marcar ✅ neste arquivo e atualizar a linha de Status (no mesmo commit
de docs do bloco).

Status: blocos com ✅ estão prontos; NÃO refazer. 3.0 a 3.3 publicados na 0.2.0-beta.3 e
o bot @aureum ligado em produção; 3.4 na 0.2.0-beta.4 (API e migração news_dismissed em produção
desde 21/10, backup backups/aureum-2026-10-21.dump) e o ajuste de "Seus servidores" na
0.2.0-beta.5. 3.5 na 0.2.0-beta.5.5 (API em produção desde 21/10, sem migração; backup
backups/aureum-2026-10-21b.dump). 3.6 e 3.7 prontos em 25/10 (só app, sem API nem migração),
ainda não publicados. 3.8 pronto em 25/10 (só API, sem migração), ainda não em produção: falta
reiniciar a API e rodar o badges grant-all com OK do Eduardo. Testes manuais pendentes listados no
3.1, no 3.2, no 3.4, no 3.5, no 3.6 e no 3.7. Reorganização em 24/10/2026: blocos a partir do 3.6
renumerados.
Próximo: 3.9 (Leva de addons), parte A (Quadro branco).

## Regras de produção (valem para todos os blocos)
- Os dados agora são de gente de verdade. Antes de qualquer migração em produção:
  pg_dump com data no nome, mostrar o comando de restauração e só aplicar depois que o
  Eduardo confirmar que o backup existe.
- Comandos que mexem em produção (CLI, migração, broadcast) são mostrados antes e só
  rodam com OK do Eduardo.
- Mudanças de API que sobem antes do release não podem quebrar o app da versão anterior.

## Ritual de release (vale para todas as releases)
- `npm run release` gera um RASCUNHO no GitHub, no mesmo canal do beta.2 (latest.yml
  padrão; NÃO criar canal "beta" separado). O Eduardo publica com o label "None", não
  "Pre-release".
- Versão segue 0.2.0-beta.N com N inteiro (próxima: 0.2.0-beta.6; nada de .5.5).
  Antes do release: confirmar que um app da versão anterior instalado vai encontrar a nova.
- CHANGELOG em linguagem simples (vai pra galera do beta).
- Depois de publicar: passos para o Eduardo testar no PC dele, com a versão anterior
  instalada, que o app baixa e instala a nova sozinho.

## 3.0 Processo de release ✅ concluído
scripts/release-desktop.mjs cria (ou reaproveita) o rascunho da tag antes do upload e
confere no fim que existe um rascunho só, com .exe, .blockmap e latest.yml.

## 3.1 Correções do primeiro dia ✅ concluído (teste manual pendente)
- Logo oficial em docs/design/brand/logo.svg + logo-small.svg; npm run build:icons gera
  .ico, ícone da janela, barra de tarefas e bandeja; logo na barra de título.
- Insígnia Fundador com o "A" do logo.
- Conta-gotas fluido (CSS direto no :root durante o arraste, salva ao soltar).
- Overlay fora das exceções (navegadores etc.); será substituído pela regra "só em jogos" (3.6).
- Transmissão em tela cheia: botão de sair, controles e cursor somem parados, duplo clique.
Teste manual pendente: bandeja em 100/125/150% e barra clara/escura.

## 3.2 Microfone ✅ concluído (teste manual pendente)
Ver docs/decisions/0020-mic-pipeline.md. Microfone pedido com 1 canal a 48 kHz, RNNoise
sempre em 48 kHz, canal único escolhido pelo nível, getSettings nos logs; Configurações ›
Voz com teste de mic, "Ouvir minha voz", liga/desliga dos processamentos, sensibilidade e
aviso de Bluetooth.
Teste manual pendente: headset Havit do prado e mic forçado em 44.1 kHz, 16 kHz e 2 canais.

## 3.3 Bot oficial @aureum ✅ concluído (ligado em produção)
Ver docs/decisions/0021-official-bot.md. Módulo na API com textos em app/bot/mensagens.toml;
boas-vindas e bug resolvido no servidor oficial; DM oficial só leitura com categorias
e Configurações › Notificações; CLI bot status/enable/disable/set-channel/say/broadcast;
"Fechar (não é bug)" e "Confirmar bug"; @aureum sempre online, aviso automático de versão
nova no #avisos; nomes parecidos com "Aureum" recusados.

## 3.4 Início: hub ✅ concluído (teste manual pendente)
Ver docs/decisions/0022-home-hub.md. Hub com saudação e ações rápidas, Ao vivo agora,
Seus servidores em grade (abre/reabre a aba, "+", "Ver todos" em modal), Pra você ver,
Minhas tarefas (hook "assigned" do framework de addons), Amigos ativos e Novidades.
Rotas /users/me/home, /users/me/tasks e mark-all-read; dados ao vivo vêm dos stores.

## 3.5 Reordenar canais ✅ concluído (teste manual pendente)
Arrastar canais dentro de cada seção ou "Mover para cima/baixo"; rota de reordenação em
lote por seção; evento channels.reordered em tempo real. (O 3.12 estende para categorias.)

## 3.6 Correções do beta: overlay e transmissão ✅ concluído (teste manual pendente)
Ver docs/decisions/0024-overlay-games-and-watching.md. Regra em src/shared/overlayRule.ts; prévia
do card e contador "N assistindo" por mensagens de dados do LiveKit (sem mudança na API).
Teste manual pendente: os testes listados abaixo nas duas partes.
### Overlay só em jogos (qualquer jogo, nunca em apps)
- Problema: hoje o overlay aparece em qualquer programa fora das exceções, então surge em
  clients/launchers (ex: client do LoL) e em apps que não são jogo.
- Regra nova, para TODOS os jogos: o overlay só aparece quando o executável em primeiro
  plano é um jogo: está na lista de jogos do 2.5 (games.json, sempre o executável da
  PARTIDA, nunca launcher/client) ou nos jogos adicionados pelo usuário. Qualquer outro
  programa (navegador, Spotify, WhatsApp, Discord, editores, launchers, clients) = overlay
  escondido. Vale com o jogo em janela, sem borda ou tela cheia (onde der).
  Mesma regra de privacidade: só o nome do executável, só local.
- A lista de exceções continua como segurança extra: nada nela mostra overlay, nem se o
  usuário adicionar por engano.
- Jogo fora da lista: se, durante uma call com overlay ligado, um programa desconhecido e
  fora das exceções ocupar a tela inteira do monitor (tamanho da janela = monitor; ler só
  o retângulo da janela, nunca título nem conteúdo), mostrar UMA vez um aviso discreto:
  "Isso é um jogo? Mostrar o overlay em <nome>" (Mostrar / Não é jogo). A resposta fica
  salva e nunca se pergunta de novo pro mesmo programa. Nunca liga sozinho.
- Configurações › Overlay: lista "Jogos com overlay" (conhecidos + "Adicionar jogo"
  escolhendo entre os programas abertos, e remover); "Ocultar overlay neste jogo" continua.
- Revisar e ampliar o games.json: tirar qualquer launcher/client (Riot Client,
  LeagueClientUx, Steam, Epic, Battle.net, EA app, Ubisoft Connect, Xbox app) e incluir os
  jogos mais comuns que faltarem.
- Testes: client do LoL e launcher da Steam (sem overlay); partida do LoL e outro jogo da
  lista em janela sem borda (com overlay); Vivaldi, Spotify e WhatsApp, inclusive em tela
  cheia (sem overlay); jogo fora da lista em tela cheia pergunta uma vez e respeita a resposta.

### Transmissão de tela: assistir só quando clicar
- Problema: a call conecta com autoSubscribe ligado, então todo mundo recebe na hora a tela
  e o áudio da tela de quem começa a transmitir.
- Conectar com autoSubscribe: false e inscrever automaticamente só microfone e câmera.
  ScreenShare e ScreenShareAudio só quando a pessoa clica em "Assistir".
- Quando alguém começa a transmitir: card "fulano está transmitindo" com prévia EMBAÇADA de
  baixa resolução (1 quadro a cada ~5s, sem áudio, mesma miniatura da Visão geral), selo
  AO VIVO e botão "Assistir" no meio. O som "tela compartilhada iniciada" continua.
- "Assistir" inscreve vídeo e áudio da tela e abre o tile (Foco/Grade como hoje); "Parar
  de assistir" no tile cancela a inscrição e volta ao card. Contador "N assistindo" no
  tile pra quem transmite.
- Quem transmite não se vê duplicado; várias telas ao vivo: cada uma com seu "Assistir".
- Teste: 3 pessoas na call; uma transmite; as outras NÃO recebem vídeo nem áudio da tela
  até clicar em Assistir (conferir as inscrições no LiveKit); parar de assistir corta tudo.

## 3.7 Áudio e controles dentro da call ✅ concluído (teste manual pendente)
Ver docs/decisions/0025-call-controls-and-devices.md. Popovers em components/CallDeviceMenus.tsx;
volumes do microfone e da chamada (0–200%); store/devices.ts acompanha devicechange.
Teste manual pendente: os testes listados abaixo.
- Barra de controles DENTRO da tela da call (embaixo, centralizada; em tela cheia some
  quando o mouse fica parado): microfone, fone, câmera, compartilhar tela, painel de sons
  (quando existir) e sair.
- Setinha ao lado de microfone, fone e câmera abre um popover: microfone (entrada, volume,
  modo Detecção de voz / Pressionar para falar, sensibilidade), fone (saída, volume),
  câmera (qual câmera, prévia pequena). Link para Configurações › Voz e vídeo.
- Troca sem sair da call (LiveKit switchActiveDevice), mantendo o pipeline de 1 canal a
  48 kHz do 3.2. Escolha salva como preferência.
- devicechange: headset conectado aparece na hora; se o dispositivo em uso sumir, cai pro
  padrão do Windows com aviso discreto.
- A mesma barra aparece compacta na janelinha flutuante.
- Testes: trocar entrada, saída e câmera em call; dispositivo removido no meio da call.

## 3.8 Insígnias ✅ concluído (falta subir em produção)
Ver docs/decisions/0026-beta-badges.md. Sem migração (catálogo sincronizado no startup).
Produção: reiniciar a API e rodar `python -m app.cli badges grant-all beta_tester` (mostra quantas
contas e pergunta), com OK do Eduardo.
- Pioneiro limitado aos 20 primeiros: AUREUM_PIONEER_LIMIT=20 no .env (números
  reservados contam). Atingido o limite, não concede mais, mesmo com AUREUM_BETA=true.
  Números já concedidos não mudam.
- Nova insígnia "Beta Tester" (LENDÁRIA, não numerada, exclusive_beta): concedida na
  confirmação do e-mail enquanto AUREUM_BETA=true. Pioneiros também recebem. Retroativa
  para todas as contas não oficiais já existentes (comando mostrado antes). Nunca mais
  concedida depois do beta. Ícone: SVG próprio, placeholder de frasco de laboratório.
- A concessão manda a DM da categoria insignias do bot (com deduplicação).
- Descrições (tooltip e cartão):
  - Fundador: "Criou o Aureum. Tudo começou aqui."
  - Pioneiro: "Um dos 20 primeiros a chegar no Aureum."
  - Beta Tester: "Testou o Aureum no beta e ajudou a moldar o app."
  - Caçador de bugs: "Encontrou um bug de verdade e ajudou a corrigir."
  - Veterano: "Faz parte do Aureum há mais de um ano."
  - Construtor: "Criou um servidor com 5 ou mais membros."
  - Aureum+: "Apoia o Aureum com o plano Aureum+."
- Testes: limite do Pioneiro (inclusive concorrência no nº 20), Beta Tester na
  confirmação e retroativa, conta oficial não recebe nenhuma das duas.

## 3.9 Leva de addons: Quadro, Enquetes, Eventos e Calendário
Todos no framework do 2.8 (módulo isolado, tabelas addon_<key>_, workspace_id genérico,
sem dependência direta de servidor dentro do módulo). Fazer na ordem A → D; cada parte
pode virar release sozinha.

### Hook novo no framework (fazer antes da parte D, pode ser já na A)
- AddonManifest ganha o hook opcional dated_items(session, workspace_ids, inicio, fim):
  itens genéricos com data (id, workspace_id, título, início, fim opcional, dia inteiro,
  tipo, cor, link para abrir no addon). Mesmo padrão do hook "assigned" do 3.4.
- Kanban implementa: cards com prazo (não concluídos e concluídos, marcados diferente).

### A. Quadro branco (addon_key whiteboard)
- Base: Excalidraw (MIT) embutido; perguntar antes. Desligar qualquer recurso de IA da
  biblioteca (princípio do produto). Fontes e arquivos empacotados no app, nada de CDN.
- Ferramentas: caneta livre, formas, setas, texto, nota adesiva, imagem, borracha,
  seleção, cores, desfazer/refazer, zoom e mover; fundo liso ou quadriculado.
- Vários quadros por canal: lista com nome, miniatura e "editado por X há Y"; criar,
  renomear, duplicar e arquivar.
- Tempo real via WebSocket (sincronização por elemento com versão), cursores com nome e cor
  de quem está no quadro, e "seguir" alguém.
- Salvamento: cena (JSON do Excalidraw) em jsonb na tabela addon_whiteboard_boards,
  salvamento automático (debounce ~1s e ao sair); imagens no MinIO, a cena guarda só a
  referência (nunca base64). Histórico: snapshot a cada ~10 min de edição, com
  "Restaurar esta versão" (manter os últimos 50 por quadro).
- Permissões: ver com VIEW_CHANNEL; editar com a permissão do addon "Editar quadro"
  (padrão: permitido ao @everyone, ajustável por cargo e canal).
- Exportar PNG/SVG e "Copiar como imagem" pra colar no chat.
- Linha de sistema no chat: "@fulano criou o quadro X". Card na Visão geral com a
  miniatura do último quadro editado.
- Limites: cena até ~5 MB; imagens até 10 MB cada.
- Testes: duas pessoas desenhando ao mesmo tempo sem perder traço; salvamento e reabertura;
  restaurar versão; sem permissão não edita (inclusive via API); exportar.

### B. Enquetes (addon_key polls)
- Criada pelo "+" do campo de mensagem em qualquer canal de texto, DM ou grupo
  ("Criar enquete"); aparece como mensagem própria no chat.
- Pergunta, 2 a 10 opções (texto + emoji opcional), escolha única ou múltipla, prazo
  opcional (1h, 8h, 24h, 3 dias, 1 semana ou sem prazo), votos anônimos ou visíveis.
- Barras com porcentagem e total; ver quem votou (se não anônima); mudar o voto até
  encerrar. Quem criou (ou MANAGE_MESSAGES) encerra antes. Encerrada: resultado final
  e linha de sistema "Enquete encerrada: X venceu".
- Permissão: SEND_MESSAGES para criar; ver para votar. Tempo real via WebSocket.
- Testes: voto único/múltiplo, mudar voto, prazo encerra sozinho, anônima não revela
  votos (inclusive via API), permissões.

### C. Eventos (addon_key events)
- Canal de addon "Eventos" no servidor + atalho "Criar evento" no menu do servidor.
- Evento: título, descrição, data/hora de início e fim (fuso do usuário), local (uma
  sala de voz do servidor ou texto livre), capa opcional, repetição simples (nenhuma,
  semanal) e quem criou.
- Presença: Vou / Talvez / Não vou, com lista de quem vai. Contador no card.
- Lembretes pela @aureum (categoria nova "eventos" na DM oficial, desligável): 1 dia
  antes e 15 min antes, só pra quem marcou Vou/Talvez. Na hora: "O evento começou" com
  botão Entrar na sala.
- Aparece na Visão geral ("Próximos eventos") e no hub do Início (dentro de Pra você ver:
  eventos de hoje que a pessoa marcou).
- Permissão nova do addon "Gerenciar eventos" (padrão: quem tem MANAGE_ADDONS); todos que
  veem o canal podem responder presença.
- Implementa o hook dated_items.
- Testes: criar/editar/cancelar (avisa quem marcou), presença, lembretes na hora certa
  (inclusive fuso), repetição semanal, permissões.

### D. Calendário (addon_key calendar)
- Canal de addon "Calendário" no servidor, com visões Mês, Semana e Lista (próximos 30 dias).
- NÃO guarda eventos próprios: junta, pelo hook dated_items, tudo que tem data nos
  addons do mesmo servidor que a pessoa pode ver: eventos (3.9C), prazos dos cards do
  Kanban e, no futuro, outros addons. Ex: card do Kanban com prazo dia 27 aparece no dia
  27; evento marcado aparece no seu dia e horário.
- Filtros por fonte (Eventos, Kanban, cada quadro de Kanban) e "Só meus" (cards em que sou
  responsável e eventos que marquei Vou/Talvez). Cores por fonte; atrasados destacados.
- Clicar num item abre ele no addon de origem (card no Kanban, evento no Eventos).
- Botão "Criar evento" num dia vazio já abre o Eventos com a data preenchida.
- Permissões: cada item respeita a permissão do canal de origem (quem não vê o canal do
  Kanban não vê os prazos dele no calendário).
- Testes: agrega Kanban e Eventos; item de canal sem acesso não aparece (inclusive via
  API); filtros; abrir na origem; mudança de prazo no Kanban aparece em tempo real.

## 3.10 Perfil: edição fora das Configurações e recorte de imagens
### Edição de perfil
- Avatar no topo → "Ver perfil" abre o cartão de perfil (resumo); no próprio perfil,
  botão "Editar perfil".
- "Editar perfil" abre um modal dedicado: avatar, banner, cor do cartão, moldura,
  pronomes, status, Sobre mim, música, links, com prévia ao vivo do cartão ao lado.
  Botão Salvar e aviso de alterações não salvas.
- Configurações › Perfil abre o mesmo componente (um só, sem duplicar código).

### Recortar e posicionar imagens
- Ao escolher avatar, banner do perfil, ou ícone/banner do servidor (PNG, JPG, WebP, GIF
  animado), abre um editor de recorte antes de salvar: arrastar pra posicionar, zoom
  (controle deslizante e roda do mouse, 1x–4x) e girar 90°.
- Máscara redonda pro avatar e na proporção do banner pro banner; prévia ao vivo de como
  fica no cartão de perfil e pequeno ao lado do nome.
- O recorte é aplicado na API: ela recebe o original + o retângulo e gera o arquivo final.
  GIF/WebP animado MANTÉM a animação (recorte quadro a quadro, mesmo tempo e loop).
  Biblioteca de imagem nova: perguntar antes, licença permissiva.
- Guardar o original pra "Ajustar posição" depois sem reenviar. Limites de tamanho iguais.
- Testes: recorte estático e animado (animação preservada), zoom/posição salvos, reajuste
  a partir do original.

## 3.11 Chat: emojis, reações, figurinhas, visto e preview de links
### Emojis
- Botão de carinha no campo de mensagem abre o seletor: busca em português, categorias,
  recentes/frequentes e tom de pele (lembrado por usuário).
- Autocompletar ao digitar ":" + 2 letras (ex: ":fogo" sugere 🔥); Enter/Tab insere.
- Visual igual em todo lugar: propor conjunto open source (ex: Twemoji, com atribuição em
  Sobre) ou emoji nativo do Windows e perguntar ao Eduardo antes; nomes em pt-BR (ex: emojibase).
- Mensagem só com 1 a 3 emojis aparece grande.
- A regra do 2.1 continua: emoji nunca como ícone da interface, só no conteúdo.

### Reações
- Passar o mouse numa mensagem mostra uma barra com 6 reações rápidas (👍 ❤️ 😂 😮 😢 🔥)
  e "+" para o seletor completo. Também pelo botão direito › Reagir.
- Chips embaixo da mensagem com emoji e contagem; clicar adiciona/remove a minha (a minha
  fica destacada na cor accent); passar o mouse mostra quem reagiu.
- Vale em canais, DMs e grupos (a DM oficial da @aureum também aceita reação). Em
  servidor: sem ADD_REACTIONS não cria reação nova, mas pode somar nas que já existem.
  MANAGE_MESSAGES remove reações de outros.
- Máx 20 emojis diferentes por mensagem. Tabela message_reactions (message_id, user_id,
  emoji), única por trio. Tempo real via WebSocket. Reação não gera notificação.

### Figurinhas do servidor (depois de emojis e reações)
- Cada servidor tem figurinhas próprias: PNG, WebP, APNG ou GIF animado, máx 512 KB e
  320×320, até 30 por servidor; nome + emoji relacionado (pra busca).
- Permissões novas: MANAGE_EXPRESSIONS (gerenciar figurinhas) e USE_STICKERS (padrão:
  permitido ao @everyone).
- Aba "Figurinhas" no seletor, agrupadas por servidor. Exclusivas: só podem ser enviadas
  no servidor delas (nem em DM nem em outro servidor).
- Enviada como mensagem própria, exibida em 160px; animadas respeitam
  prefers-reduced-motion. No MinIO, servidas com checagem de permissão.
- Configurações do servidor › Figurinhas: enviar, renomear e remover.

### Visto nas mensagens privadas (só DM 1:1)
- Não vale em servidor nem em grupo (por enquanto).
- Minhas mensagens mostram ✓ Enviada e ✓✓ Vista (na cor accent), só na última mensagem
  vista e na última enviada, pra não poluir.
- "Vista" vem do read-state que já existe (channel_reads.last_read_message_id do outro);
  read.updated atualiza na hora.
- Configurações › Privacidade › "Confirmação de leitura" (padrão ligado). Desligada: o
  outro não vê se eu li e eu também não vejo se ele leu (igual WhatsApp).
- A DM oficial da @aureum não mostra visto.

### Preview de links
- Mensagem com link mostra um card: site, título, descrição e imagem (OpenGraph).
  YouTube: miniatura grande, título, canal e play que abre no navegador (sem tocar dentro
  do app por enquanto). Até 3 previews por mensagem.
- Quem busca o preview é a API, nunca o app (o IP de quem recebe não vaza pro site).
  Segurança: só http/https, bloquear IPs internos (localhost, 192.168.x, 10.x, 172.16–31.x,
  100.64–127.x do Tailscale etc., inclusive depois de resolver o DNS e em cada redirect),
  tempo limite 5s, máx 1 MB lido, até 3 redirects, cache de 24h por URL. Imagem do
  preview passa pelo /api/media (proxy com cache).
- Quem enviou pode remover o preview da própria mensagem (X no card). Link entre < > não
  gera preview.

### Testes
Seletor e autocompletar; reagir/desfazer em tempo real; permissões de reação; limite de 20;
figurinha só no próprio servidor (inclusive via API); limites de arquivo; visto em tempo
real e respeitando a opção desligada nos dois sentidos (inclusive via API); preview
OpenGraph e YouTube; link para IP interno recusado; timeout; cache.

## 3.12 Categorias de canais
- Quem tem MANAGE_CHANNELS cria categorias livres (ex: "Administração", "Jogos",
  "Trabalho"). Dentro de cada uma: canais de voz, texto e addon misturados.
- Tabela channel_categories (server_id, name, position) + channels.category_id
  (opcional; sem categoria = no topo).
- Migração sem susto: cada servidor existente ganha as categorias "Salas", "Conversas" e
  "Addons" com os canais de hoje, na mesma ordem, então nada muda visualmente até alguém
  mexer. Servidor novo nasce com essas três.
- Permissões na categoria (mesmo editor Permitir/Herdar/Negar do canal); canais dentro
  sincronizam com a categoria por padrão, com opção de permissões próprias. Categoria em
  que a pessoa não vê nenhum canal some inteira (ex: "Administração" só pra admins).
- Criar canal: escolher a categoria. "+" no cabeçalho de cada categoria cria canal ali.
  Categoria recolhível (estado por usuário).
- Reordenar (estende o 3.5): arrastar categorias, e canais dentro e entre categorias.
- Menu de contexto da categoria: renomear, permissões, criar canal, excluir (os canais
  vão para "sem categoria", nunca são apagados juntos).
- A ordem por categoria vale na Visão geral, na busca e no hub.
- Testes: migração preserva a ordem; categoria privada some pra quem não tem acesso
  (inclusive canais dentro, via API/WS); mover canal entre categorias; excluir categoria
  não apaga canais; sincronizar/dessincronizar permissões.

## 3.13 Painéis: até 4 por servidor
Base: painéis do 2.L (hoje até 2, abertos arrastando). Ampliar para até 4, por servidor
(só canais do próprio servidor; nada do Início ou de outros servidores).

### Formatos
- 1 painel; 2 (lado a lado ou empilhados); 3 (um grande + dois empilhados, ou três
  colunas); 4 (grade 2×2). O usuário monta o que quiser, de 1 a 4.
- Layout guardado como árvore de divisões (horizontal/vertical), no máximo 4 painéis.

### Abrir e fechar
- Arrastar (jeito principal): arrastar um canal da barra lateral ou uma aba para a borda
  esquerda, direita, de cima ou de baixo de um painel. Área destacada mostra onde ele vai
  cair. Soltar no meio abre como aba naquele painel.
- Botão "Dividir" no cabeçalho do painel (para o lado ou para baixo).
- Botão direito num canal: "Abrir em novo painel".
- Tentou abrir o 5º: aviso "Máximo de 4 painéis" e abre como aba no painel atual.
- X no cabeçalho fecha o painel; o espaço vai para os vizinhos.
- Cada painel continua com suas próprias abas.

### Detalhes
- Divisores arrastáveis na horizontal e na vertical; duplo clique no divisor iguala os tamanhos.
- Maximizar temporário: duplo clique no cabeçalho deixa o painel em tela cheia; duplo
  clique de novo ou Esc volta ao layout.
- Call: se ela estiver visível em algum painel, a janelinha flutuante some; volta quando o
  painel da call fecha ou fica escondido.
- Tamanho mínimo por painel (~320×240). Se a janela diminuir e não couber, os painéis que
  sobram viram abas no painel vizinho, sem fechar nada, e voltam ao lugar quando a janela
  aumenta. Continua valendo: abaixo de ~1100px, só 1 painel.
- Vídeo: tiles em painéis pequenos recebem a camada menor (adaptiveStream); painel
  escondido ou virado aba não recebe vídeo.
- Layout salvo por servidor e por usuário. Layouts de 2 painéis já salvos continuam iguais.

### Testes
Montar 1, 2, 3 e 4 painéis por arrastar, por "Dividir" e pelo menu; 5º vira aba; fechar
redistribui; maximizar e voltar; janela pequena vira abas e volta; call em painel esconde a
janelinha; layout salvo e restaurado por servidor; layout antigo de 2 painéis preservado.

## 3.14 Overlay novo: widgets separados
- O overlay vira até 3 widgets independentes, cada um com posição, tamanho e opacidade
  próprios (modo edição: arrastar e redimensionar cada um; posições salvas por monitor):
  1. Voz: quem está na call, anel em quem fala, mudo/ensurdecido. Opção "só quem está
     falando".
  2. Câmeras: só aparece quando alguém tem câmera ligada; quem tem câmera sai da lista de
     voz e vai pra cá. Layout HORIZONTAL ou VERTICAL (configurável) e tamanho dos tiles.
  3. Notificações: DMs, menções, chamada recebendo, alguém entrou/saiu da call; somem em
     ~5s. Opção de esconder o conteúdo da mensagem (só "@fulano te mandou mensagem").
- Cada widget liga/desliga separado em Configurações › Overlay, com prévia.
- Continua: só em jogos (3.6), clique passa pro jogo, atalhos e privacidade do 2.7.
- Testes: câmera liga e a pessoa muda de widget; horizontal/vertical; posições salvas;
  notificação some sozinha; widget desligado não aparece.

## 3.15 Painel de sons
Nome na interface: "Painel de sons" (não usar "Soundboard" nem "Soundpad").
- Sons por servidor e exclusivos dele (não usáveis em outros servidores nem em DMs):
  nome, emoji opcional (do seletor de emojis) e áudio de até 5s, máx 1 MB, mp3/ogg/wav,
  até 24 por servidor; volume padrão. Duração validada no servidor (dependência nova:
  perguntar antes, licença permissiva). Armazenados no MinIO.
- Permissões novas: USE_SOUNDBOARD (padrão: permitido ao @everyone) e MANAGE_SOUNDBOARD.
- Botão na barra da call (3.7) abre a grade de sons (emoji + nome). Toca como TRACK DE
  ÁUDIO SEPARADA no LiveKit, nunca misturada no microfone (não passa pela supressão de
  ruído). Precisa de SPEAK; não toca se o usuário estiver mutado pelo servidor.
- Anti-spam: 1 som por vez por usuário, cooldown de 3s.
- Cada pessoa: volume do painel de sons (0–100%) e "Silenciar sons dos outros".
- Testes: limites de arquivo e duração, permissões, exclusividade do servidor, cooldown,
  silenciar.

## 3.16 Tour e dicas
Objetivo: quem chega do Discord entender o layout próprio do Aureum sem se perder.
Guia do tour: espaço reservado para o mascote (3.17); até lá, usar o logo oficial.
Fazer depois de todos os blocos de interface acima, pra não refazer a cada mudança de layout.

### Motor
- Componente próprio de tour: escurece a tela, destaca o elemento (spotlight) e mostra um
  balão com o guia, título, texto curto, "Próximo", "Voltar", "Pular" e progresso (ex: 3/8).
  Dependência nova (ex: driver.js): perguntar antes, licença MIT ou parecida.
- Âncoras fixas nos elementos (data-tour="abas", data-tour="sidebar" etc.), nunca
  seletores de classe. Teste que falha se alguma âncora usada no tour sumir.
- Sempre pulável (botão e Esc). Respeitar prefers-reduced-motion.
- Progresso salvo no servidor (user_settings.onboarding: tour_version_done, tips_seen[]),
  pra não repetir ao trocar de PC ou reinstalar.
- Tours com versão: ao subir a versão do tour com passos novos, quem já fez vê só os
  passos novos, com selo "Novidade".
- Menu do perfil › "Rever tour" e Configurações › Dicas: "Mostrar dicas de novo".

### Tour inicial (primeira vez que abre o app)
Contas novas: começa sozinho depois do primeiro login. Contas que já existem: convite
único "Quer fazer um tour rápido pelo Aureum?" (Sim / Agora não).
1. Boas-vindas: "Bem-vindo ao Aureum! Bora dar uma volta rápida?" (Começar / Pular)
2. Abas no topo: Início sempre primeiro, uma aba por servidor, "+" pra criar ou entrar.
3. Início: seu hub (quem está ao vivo, seus servidores, o que você perdeu e suas tarefas);
   amigos e DMs na barra lateral.
4. Barra lateral do servidor: categorias com salas, conversas e addons; dá pra recolher.
5. Visão geral do servidor: salas ao vivo, quem tá falando e transmitindo, próximos eventos.
6. Painéis: abra até 4 coisas ao mesmo tempo (chat, call, Kanban...). Arraste um canal
   pra borda de um painel ou use "Dividir".
7. Addons: Kanban, Quadro, Eventos e Calendário (o calendário junta prazos e eventos).
8. Perfil (avatar no topo): ver e editar perfil, status, configurações e "Reportar problema"
   (Ctrl+Shift+R).
Fim: "Pronto! Quando você usar algo pela primeira vez, a gente mostra uma dica."
Passos 4 a 7 abrem o servidor oficial; se a pessoa não estiver em nenhum servidor, pular.

### Dicas de primeira vez (balão único, "Entendi" fecha pra sempre)
- Primeira call: barra de controles, setinha de áudio (trocar mic, saída e câmera),
  Foco/Grade, janelinha flutuante.
- Primeira transmissão de alguém: "Assistir" pra entrar na live.
- Primeira vez assistindo uma tela: tela cheia, botão de sair e volume da transmissão.
- Primeiro compartilhamento: modos "Texto nítido" e "Movimento".
- Primeira call com overlay: só aparece em jogos, widgets separados, editar posição.
- Primeiro servidor criado: categorias, cargos, canal privado, convites e reordenar.
- Primeiro addon de cada tipo (Kanban, Quadro, Eventos, Calendário): o que é e o básico.
- Primeira enquete: como criar pelo "+".
- Primeira reação: passar o mouse na mensagem.
- Primeira DM: o que é o ✓✓ e onde desligar a confirmação de leitura.
- Painel de sons: como tocar e silenciar os sons dos outros.
- Primeira mensagem da DM oficial: "Esta é a conversa oficial do Aureum: avisos, segurança
  e novidades. A gente nunca pede sua senha."
- Primeiro clique com botão direito em alguém: menu de contexto.
- Push-to-talk ao ativar: onde configurar o atalho.

### Testes
Tour começa sozinho só em conta nova; convite único em conta antiga; pular e Esc salvam
como visto; "Rever tour" funciona; progresso segue entre PCs; versão nova mostra só os
passos novos; cada dica aparece uma vez só; passos de servidor pulados sem servidor.

## 3.17 Identidade visual (prazo: fim de 2026)
NÃO começar sem spec detalhada do Eduardo. Escopo previsto:
- Logo final (o atual é o oficial até lá; trocar tudo via npm run build:icons).
- Revisão de cores e tokens do 2.1.
- Mascote da marca (ideias em aberto: abelha "Zum", "Pepita", vaga-lume "Lume"),
  original de verdade, legível de 24px a ilustração grande. Usos: guia do tour (3.16),
  estados vazios, carregamento, erro de conexão, e-mails, figurinhas.

## 3.18 Migração para a Oracle (quando a VM estiver pronta)
NÃO começar sem spec detalhada. Escopo previsto: VM A1 Always Free (PAYG com tudo grátis
e alerta de gasto), API + Postgres + Redis + MinIO + LiveKit na VM, HTTPS, migração dos
dados com backup e janela de manutenção avisada pela @aureum, troca de URLs no app sem
quebrar instalações existentes (inclusive a landing no GitHub Pages), fim do Tailscale
Funnel e do LiveKit Cloud.

## Backlog (não fazer agora)
- Convite de grupo do WhatsApp (invites create --usos 15 --dias 7); a landing já está no
  ar, só falta gerar com OK do Eduardo.
- Visto em grupos ("Visto por N").
- Calendário pessoal no Início (todos os servidores juntos).
- "Área de trabalho": painéis misturando canais de servidores diferentes.
- Emojis próprios por servidor (além das figurinhas).
- Addon "Jogos Riot": status rico de LoL e TFT pela API local do cliente, "chamar pro duo";
  depois elo, resumo pós-partida opt-in e ranking do grupo pela API web (chave no portal
  da Riot, sempre pela nossa API); VALORANT só com chave de produção + RSO. Nunca ler
  memória do jogo nem dar vantagem dentro da partida.
- Mapa do Minecraft (BlueMap) e status de servidor de Mine.
- Cinema (assistir junto), fichas de RPG, ouvir junto no Spotify, Notas/Wiki do servidor.
- Distribuição na Microsoft Store (MSIX) para tirar o aviso do SmartScreen no lançamento
  público; reservar o nome "Aureum" no Partner Center.
- Login com Google e Discord; importar servidores do Discord.
- Bot: comandos /ajuda, /convites e /status, tirar a @aureum dos servidores depois do beta,
  bots externos com token.
- Painel de sons: sons padrão próprios (gerados pelo script de síntese).
- Aureum+ (qualidade de transmissão maior); Kanban como produto separado.

## Pronto quando (Fase 3)
- ✅ Release sai com um rascunho só e o app se atualiza sozinho.
- ✅ Ícone novo em exe, instalador, janela, barra de tarefas, bandeja e insígnia Fundador.
- ✅ Conta-gotas fluido; tela cheia com botão de sair.
- ✅ (teste pendente) Voz limpa com o headset Havit do beta; teste de microfone em Configurações.
- ✅ @aureum dá boas-vindas, avisa bug resolvido e manda DMs oficiais.
- ✅ Início abre no hub: ao vivo, servidores, pendências, minhas tarefas, amigos e novidades.
- ✅ Dono reordena canais arrastando e todo mundo vê a nova ordem na hora.
- ✅ (teste pendente) Overlay só em jogos; transmissão só abre pra quem clicar em Assistir.
- ✅ (teste pendente) Trocar microfone, saída e câmera dentro da call, pela barra de controles.
- ✅ (falta produção) 20 Pioneiros no máximo; todos os testers com Beta Tester.
- Quadro branco, Enquetes, Eventos e Calendário (juntando Kanban e Eventos) funcionando.
- Perfil editado direto do cartão, com recorte de avatar e banner (inclusive GIF).
- Reações, emojis, figurinhas, visto nas DMs e preview de links no chat.
- Categorias livres com permissões, inclusive categoria só pra admins.
- Até 4 painéis por servidor.
- Overlay com widgets separados de voz, câmeras (horizontal/vertical) e notificações.
- Painel de sons funcionando na call, exclusivo de cada servidor.
- Conta nova faz o tour inicial; dicas aparecem uma vez em cada recurso.
- App rodando na VM da Oracle, sem depender do PC do Eduardo.
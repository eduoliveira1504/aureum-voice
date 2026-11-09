# Aureum Voice — Fase 3

Base: Fase 2 concluída. Beta fechado no ar desde 19/10/2026, com usuários reais. Desde 27/10 tudo
roda na VPS da Hostinger (3.18); o PC do Eduardo não é mais servidor.
Regras do CLAUDE.md continuam valendo (custo R$0 fora das exceções autorizadas, segredos só no .env,
commits em inglês, sem IA no produto, nada copiado do Discord, regras de privacidade do teclado/overlay).
Executar UM bloco por vez, na ordem. Dentro do bloco: um item por vez, commit por item,
sem push (push só quando o Eduardo pedir). Plano curto antes de começar. Migrações
Alembic, testes da API, README e docs/decisions quando houver escolha de arquitetura.
O Eduardo decide quando gerar release; uma release pode juntar um ou mais blocos.
Ao terminar um bloco, marcar ✅ neste arquivo e atualizar a linha de Status (no mesmo commit
de docs do bloco).

Status: blocos com ✅ estão prontos; NÃO refazer. 3.0 a 3.11 e 3.15 publicados (até a
0.2.0-beta.7.b) e em produção. Testes manuais pendentes listados no 3.1, 3.2, 3.4 a 3.7, 3.9 a 3.11
e 3.15. 3.18: virada para a VPS feita em 27/10 com a 0.2.0-beta.8; faltam o item 8 (monitoramento,
backup diário e teste de carga) e o item 10 (desligar Funnel e LiveKit Cloud, com OK do Eduardo).
Escolhas de deploy em 0036-vps-deploy.md.
Em 01/11 entrou o 3.19 (ajustes do beta), na frente do 3.12; a ordem das abas entrou no 3.13.
3.19: partes A, B, D e E prontas, teste manual pendente (vão na beta.9). Parte C2 (correções por
aparelho) fica para quando chegarem os relatórios dos testers.
3.12, 3.13 e 3.14 prontos (escolhas em 0037 a 0040); 0.2.0-beta.9 gerada.
Em 05/11 entraram o 3.20 (arraste de imagens e janela destacada da call) e o 3.21 (macOS).
Em 06/11: Painel de sons confirmado funcionando em produção (3.15 e 3.19 B); entrou o 3.22
(câmeras do overlay personalizáveis e GIF no avatar/banner); ideias futuras (identidade visual,
mascote e backlog) saíram deste arquivo e foram para docs/decisions/FUTURO.md. Objetivo: fechar a
Fase 3 com tudo funcionando.
Em 07/11 entrou também o 3.24 (correções: overlay na transmissão, copiar imagem, volume das
transmissões salvo, chat sem rolagem lateral).
Em 08/11: 3.20 parte A pronta (teste manual pendente); 3.23 pronto (teste manual pendente; escolhas
em 0041-loading-screen.md); 3.22 parte A pronta (teste manual pendente; escolhas em
0042-overlay-cameras.md); 3.20 parte B pronta (teste manual pendente; escolhas em
0043-detached-call-window.md), então o 3.20 está concluído.
3.24 pronto (A a D; teste manual pendente; a parte C tem migração).
3.22 parte B pronta (teste manual pendente; sem migração; escolhas em 0044-profile-gifs.md), então o
3.22 está concluído.
Próximo, nesta ordem: 3.21
(só depois das decisões do Eduardo) e 3.16 por último.
Em 09/11: Mac decidido (sem assinatura, testado por um amigo do Eduardo que só tem Mac).
Próximo, nesta ordem: 3.21 (macOS), 3.16 (tour) e release 0.2.0-beta.10 (Windows + Mac).

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
- Windows e Mac saem juntos (desde o 3.21): o script gera o Windows no PC, dispara o workflow
  release-mac.yml (runner macOS do GitHub Actions) e espera ele subir o Mac no mesmo rascunho.
  Por isso, ANTES do `npm run release`: tudo commitado e o push do main feito (o Mac é gerado do
  commit que está no GitHub; o script recusa se o HEAD local não estiver no origin/main). O GH_TOKEN
  precisa de "Contents" e "Actions" com leitura e escrita. Se só o Mac falhar:
  `npm run release -- --mac-only`.
- O rascunho tem que ter: .exe, .exe.blockmap e latest.yml (Windows); .dmg e .zip de arm64 e x64,
  com seus .blockmap, e latest-mac.yml (Mac). O script confere tudo no fim.
- Versão segue 0.2.0-beta.N com N inteiro (próxima: 0.2.0-beta.10).
  Antes do release: confirmar que um app da versão anterior instalado vai encontrar a nova.
- CHANGELOG em linguagem simples (vai pra galera do beta).
- Depois de publicar: passos para o Eduardo testar no PC dele, com a versão anterior
  instalada, que o app baixa e instala a nova sozinho; e, no Mac (amigo do Eduardo), que a versão
  anterior mostra o aviso "Baixar a versão X" (o Mac não se atualiza sozinho).

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

## 3.8 Insígnias ✅ concluído (em produção desde 25/10)
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

## 3.9 Leva de addons: Quadro, Enquetes, Eventos e Calendário ✅ concluído (em produção na 0.2.0-beta.6; teste manual pendente)
Todos no framework do 2.8 (módulo isolado, tabelas addon_<key>_, workspace_id genérico,
sem dependência direta de servidor dentro do módulo). Fazer na ordem A → D; cada parte
pode virar release sozinha.

### Produção do 3.9 (acumulado; ✅ feito em 25/10, fica como referência dos passos)
O Eduardo vai publicar o 3.6 ao 3.9 de uma vez. A API roda `alembic upgrade heads` sozinha ao
subir (Dockerfile), então reconstruir a API aplica as migrações: o backup vem ANTES.
1. Backup do banco (sem ele, nada segue). O dump é feito dentro do contêiner e copiado com
   `docker compose cp`: redirecionar com `>` no PowerShell 5.1 grava em UTF-16 e estraga o arquivo.
   `docker compose --env-file .env -f infra/docker-compose.yml exec -T postgres sh -c 'pg_dump -U "$POSTGRES_USER" -Fc -f /tmp/aureum-AAAA-MM-DD.dump "$POSTGRES_DB"'`
   `docker compose --env-file .env -f infra/docker-compose.yml cp postgres:/tmp/aureum-AAAA-MM-DD.dump backups/aureum-AAAA-MM-DD.dump`
   Conferir: `docker compose --env-file .env -f infra/docker-compose.yml exec -T postgres pg_restore -l /tmp/aureum-AAAA-MM-DD.dump` lista as tabelas.
   Restauração, se precisar:
   `docker compose --env-file .env -f infra/docker-compose.yml cp backups/aureum-AAAA-MM-DD.dump postgres:/tmp/restore.dump`
   `docker compose --env-file .env -f infra/docker-compose.yml exec -T postgres sh -c 'pg_restore -U "$POSTGRES_USER" -d "$POSTGRES_DB" --clean --if-exists /tmp/restore.dump'`
2. Reconstruir e reiniciar a API (aplica as migrações):
   `docker compose --env-file .env -f infra/docker-compose.yml up -d --build --no-deps --wait api`
   Migrações que entram: core a7c3e1f5b902 (EDIT_WHITEBOARD ao @everyone, 3.9A) e core
   b8d4f2a6c731 (messages.embed, 3.9B); branches whiteboard (c2d8f4a6e310), polls
   (d5a9e3c7f164) e events (e9b3d7f1a428). A permissão nova MANAGE_EVENTS (3.9C) e o
   Calendário (3.9D, sem tabelas) não precisam de migração. Conferir: `docker compose --env-file .env -f infra/docker-compose.yml exec api alembic current` mostra uma linha por branch.
3. Do 3.8: `docker compose --env-file .env -f infra/docker-compose.yml exec api python -m app.cli badges grant-all beta_tester`
   (mostra quantas contas e pergunta).
4. Do 3.9C: ligar os lembretes de eventos da @aureum:
   `docker compose --env-file .env -f infra/docker-compose.yml exec api python -m app.cli bot enable --acao dm-eventos`
   (os workers de prazo das enquetes e de lembretes dos eventos sobem sozinhos com a API).
5. Conferir a API no ar: `curl -s https://<endereço do Funnel>/api/health` e o app atual
   (beta.5.5) abrindo normalmente.
6. Release do app (`npm run release`, 0.2.0-beta.6, seguindo o Ritual de release) só depois da
   API no ar: apps antigos continuam funcionando com a API nova (enquete aparece como texto
   "📊 Enquete: …"; os addons novos aparecem com o aviso de atualizar o app).

### Hook novo no framework (fazer antes da parte D; vai no começo da C) ✅ concluído
- AddonManifest ganha o hook opcional dated_items(session, workspace_ids, inicio, fim):
  itens genéricos com data (id, workspace_id, título, início, fim opcional, dia inteiro,
  tipo, cor, link para abrir no addon). Mesmo padrão do hook "assigned" do 3.4.
- Kanban implementa: cards com prazo (não concluídos e concluídos, marcados diferente).

### A. Quadro branco (addon_key whiteboard) ✅ concluída (teste manual pendente)
Ver docs/decisions/0027-whiteboard-addon.md. Kanban passou a se chamar "Kanban" no app.
Produção: backup, depois `alembic upgrade heads` (core a7c3e1f5b902 dá EDIT_WHITEBOARD ao
@everyone; branch whiteboard cria as tabelas) e reiniciar a API, com OK do Eduardo.
Teste manual: dois PCs no mesmo quadro (traço ao vivo, cursores, seguir), imagem colada,
exportar PNG/SVG, Copiar como imagem e colar no chat, restaurar versão, tema claro/escuro e
cor de destaque, alguém sem "Editar quadro branco" só vendo, Sobre › licenças.
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

### B. Enquetes (addon_key polls) ✅ concluída (teste manual pendente)
Ver docs/decisions/0028-polls-and-chat-addons.md. Produção: ver a lista acumulada acima
(migrações core b8d4f2a6c731 e branch polls; o worker de prazo sobe junto com a API).
Teste manual: criar pelo "+" num canal de texto, numa DM e num grupo; votar em dois PCs e ver
as barras mudarem ao vivo; mudar e tirar o voto; múltipla escolha; "Ver votos"; anônima não
mostra quem votou; prazo de 1h (ou mudar closes_at no banco de teste) encerra sozinho com a
linha "Enquete … encerrada: X venceu" e o "Ver" leva à enquete; encerrar antes (quem criou e um
moderador; outro membro não vê o botão); apagar a mensagem some com a enquete; app antigo vê o
texto "📊 Enquete: …".
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

### C. Eventos (addon_key events) ✅ concluída (teste manual pendente)
Ver docs/decisions/0029-events-and-dated-items.md. Produção: ver a lista acumulada acima
(branch events e `bot enable --acao dm-eventos`).
Teste manual: adicionar o addon Eventos; criar pelo botão e pelo menu do servidor ("Criar
evento"); sala de voz e lugar em texto; capa; repetir toda semana; Vou/Talvez/Não vou em dois PCs
(lista e contador ao vivo); card "Próximos eventos" na Visão geral; evento de hoje marcado aparece
no "Pra você ver" do Início; cargo com "Gerenciar eventos" cria e um membro comum só responde;
lembretes na DM da @aureum (criar um evento pra daqui a ~20 min e marcar Vou: chega o de 15 min e
o "começou" com Entrar na sala; hora mostrada no fuso do PC); mudar o horário e cancelar avisam
quem marcou; desligar "Eventos" em Notificações para de chegar.
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

### D. Calendário (addon_key calendar) ✅ concluída (teste manual pendente)
Ver docs/decisions/0030-calendar-addon.md. Produção: nada além da lista acumulada (sem migração).
Teste manual: adicionar o addon Calendário num servidor com Eventos e Kanban; Mês, Semana e Lista;
card com prazo aparece no dia certo e em vermelho quando atrasado; evento no dia e horário certos
(fuso do PC); filtros por fonte (dois quadros Kanban separados) e "Só meus"; clicar abre o card no
Kanban e o evento no Eventos; "Criar evento" num dia vazio abre o Eventos com a data; mudar o prazo
de um card noutro PC e ver o calendário atualizar sozinho; um membro sem acesso a um quadro privado
não vê os prazos dele; card "Calendário" na Visão geral.
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

## 3.10 Perfil: edição fora das Configurações e recorte de imagens ✅ concluído (falta produção e teste manual)
Ver docs/decisions/0031-profile-editor-crop-and-featured-badges.md. A página "Insígnias" das
Configurações saiu: o inventário e o destaque ficam no Editar perfil e na aba Insígnias do cartão.
Produção (tudo com OK do Eduardo, na ordem; a API nova não quebra o app beta.6: upload sem recorte
continua igual e o destaque é ignorado por ele):
1. Backup do banco com os mesmos comandos do item 1 da produção do 3.9 (sem ele, nada segue).
2. Reconstruir e reiniciar a API (instala o Pillow e aplica as migrações core c6e1a9d4f357, com as
   colunas `*_source` de users/servers, e d7f2b4e8a913, com `user_badges.featured_position` e
   `badges.how_to_get`; também sobe a exclusão de quadros feita depois da beta.6):
   `docker compose --env-file .env -f infra/docker-compose.yml up -d --build --no-deps --wait api`
   Conferir: `docker compose --env-file .env -f infra/docker-compose.yml exec api alembic current`.
3. Conferir `curl -s https://<endereço do Funnel>/api/health` e o app beta.6 abrindo normalmente.
4. Release do app (0.2.0-beta.7, seguindo o Ritual de release) só depois da API no ar.
Teste manual: no seu cartão (Ver perfil), "Editar perfil" abre o modal; mudar algo e fechar (Esc,
fora ou trocar de aba nas Configurações) pergunta antes; "Desfazer". Avatar PNG e GIF animado:
arrastar, zoom pela roda e pelo controle, girar, prévias; depois de salvar, o GIF continua animado
no cartão e na lista de membros; "Ajustar posição" abre o original e muda o recorte. Banner do
perfil, ícone e banner do servidor do mesmo jeito. Esc no editor de recorte fecha só ele. Aba
Insígnias no cartão de outra pessoa: todas as dela, as que faltam com cadeado e como ganhar, beta
encerrado como "Não disponível mais". Destacar 3 e reordenar arrastando no Editar perfil, salvar e
ver a ordem ao lado do nome noutro PC (chat, membros, call); "Voltar ao automático"; "Destacar" ao
passar o mouse no próprio cartão; "Destacar no perfil" na DM da @aureum de uma insígnia nova
(`cli badges grant`).
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

### Insígnias: destaque e inventário
- Inventário: todas as insígnias da pessoa ficam SEMPRE visíveis pra quem abrir o perfil
  dela (nada é oculto). No cartão/perfil, aba ou seção "Insígnias" com a grade completa:
  - As que ela tem: coloridas, com nome, raridade, descrição, número (se numerada) e data.
  - As que ela ainda não tem: em cinza com cadeado e como conseguir (ex: "Construtor:
    crie um servidor com 5+ membros"). Insígnias exclusivas do beta que não dá mais pra
    ganhar aparecem como "Não disponível mais", sem incentivar o impossível.
  - Ordenadas: as que tem primeiro (mais rara → mais comum), depois as que não tem.
- Destaque: a pessoa escolhe até 3 insígnias do inventário pra aparecer ao lado do nome
  (chat, lista de membros, call, servidores, menções) e no topo do cartão de perfil, na
  ordem que quiser (arrastar). As outras continuam no inventário, só não ficam em destaque.
- Onde escolher: no modal "Editar perfil" (3.10), seção "Insígnias": grade do inventário
  com "Destacar" em cada uma e a fileira de destaque reordenável, com prévia ao vivo do
  nome. Também pelo próprio inventário: botão "Destacar" ao passar o mouse (só no seu).
- Padrão: sem escolha, o destaque é automático (as 2 mais raras, regra do 2.11).
  Insígnia nova concedida não entra no destaque sozinha; a DM da @aureum avisa e oferece
  "Destacar no perfil".
- Salvo no servidor (user_badges.featured_position nullable), vale pra todo mundo que vê
  o perfil. Só a própria pessoa altera.
- Com 3 ao lado do nome, mantém a regra do 2.11: o nome encolhe com reticências, os
  ícones nunca.
- Testes: escolher e reordenar o destaque; outro usuário vê o destaque escolhido e o
  inventário completo; conta sem escolha usa o automático; insígnia nova não entra no
  destaque sozinha; não dá pra destacar insígnia que não tem (inclusive via API).

## 3.11 Chat: ações da mensagem, emojis, reações, GIFs, figurinhas, visto e preview de links ✅ concluído (falta produção e teste manual)
Bloco grande: fazer em 3 partes, cada uma numa conversa (A → B → C). Todas as partes valem
em canais de servidor, DMs e grupos, salvo onde dito.
Parte A ✅ (com as correções antes dela) e parte B ✅ em 26/10; parte C ✅ em 27/10. Decisões em
docs/decisions/0032-message-actions-replies-forwards-emojis-reactions.md (A),
docs/decisions/0033-read-receipts-and-link-previews.md (B) e docs/decisions/0034-stickers-and-gifs.md (C).

### Produção do 3.11 (acumulado; nada feito ainda)
A produção do 3.10 também está pendente: dá pra fazer as duas juntas, com um backup só. Tudo com
OK do Eduardo, na ordem. A API nova não quebra o app beta.6 (só campos, rotas e eventos novos; o
beta.6 ignora reações, respostas, encaminhadas, visto e previews, e mostra o texto normalmente;
figurinha e GIF aparecem pra ele como "[Figurinha: nome]" e "[GIF: título]").
1. Backup do banco com os mesmos comandos do item 1 da produção do 3.9 (sem ele, nada segue).
2. Reconstruir e reiniciar a API. Sem dependência Python nova na parte A (o Pillow veio no 3.10).
   Aplica as migrações core da parte A, depois das do 3.10: e3a9c5b1d742 (messages.reply_to_id),
   f4b8d6c2e953 (messages.forwarded_from), a5c1e7f3b864 (user_settings.emoji_tone e
   recent_emojis) e b6d2f8a4c975 (tabela message_reactions), e as da parte B: c7e3a9f5d186
   (user_settings.read_receipts) e d8f4b0a6e297 (messages.link_previews e previews_removed), e as
   da parte C: a9c5e1f7b308 (figurinhas, permissões MANAGE_EXPRESSIONS e USE_STICKERS, que entra
   no @everyone dos servidores que já existem, e user_settings.recent_stickers) e b0d6f2a8c419
   (messages.gif e tabela gif_favorites). Sem dependência Python nova nas partes B e C:
   `docker compose --env-file .env -f infra/docker-compose.yml up -d --build --no-deps --wait api`
   Conferir: `docker compose --env-file .env -f infra/docker-compose.yml exec api alembic current`
   mostra b0d6f2a8c419 (head).
3. Conferir `curl -s https://<endereço do Funnel>/api/health` e o app beta.6 abrindo, mandando
   mensagem, imagem e enquete normalmente. A partir da parte B a API faz requisições pra fora (só
   pros previews, só pra endereços públicos): cada site linkado no chat vê o IP da sua conexão.
4. Pacote "Aureum básico" (os PNGs já vêm na imagem da API; uma vez só):
   `docker compose --env-file .env -f infra/docker-compose.yml exec api python -m app.cli stickers pack-add --nome "Aureum básico" --pasta app/static/stickers/aureum-basico`
   Conferir com `... python -m app.cli stickers list` (16 figurinhas).
5. GIFs (feito pelo Eduardo, no navegador, grátis): criar a conta no Klipy (partner.klipy.com),
   criar o app e copiar a chave pro `.env` como `KLIPY_APP_KEY=` (sem ela o botão GIF não aparece).
   Pedir a chave de produção no Partner Panel (formulário); até sair, a de teste aguenta 100
   chamadas por hora pra todo mundo junto. Anúncios ficam desligados. Depois de pôr a chave,
   reiniciar a API (o comando do item 2, sem `--build`).
6. Release do app (0.2.0-beta.7, seguindo o Ritual de release) só depois da API no ar. O
   instalador cresce uns MB com os desenhos do Twemoji. No CHANGELOG: responder, encaminhar,
   reagir, emojis, imagem sem faixa cinza, enquete criando de novo, visto nas DMs (e a opção em
   Privacidade), prévia de links, figurinhas (do Aureum e do servidor) e GIFs.

### Parte A: ações da mensagem, responder, encaminhar, emojis e reações ✅ concluída (teste manual pendente)
Teste manual da parte A (dois PCs, ou duas contas, num servidor e numa DM):
- Imagem PNG larga e foto do celular em pé: a caixa tem o tamanho da imagem, sem faixa cinza, e
  não pula quando a imagem carrega; uma imagem antiga (enviada antes) também fica sem faixa;
  vídeo em pé sem faixas pretas dos lados.
- Criar enquete digitando só nas opções (cria); emoji da opção pelo botão quadrado (abre o seletor;
  clique direito tira); Esc no seletor fecha só ele.
- Passar o mouse numa mensagem: barra com Reagir, Responder, Encaminhar e "…"; o mesmo menu no
  botão direito; sem permissão de enviar, sem Responder; Editar/Apagar só onde pode. Clicar na
  mensagem e usar R, E e Del (pergunta antes).
- Copiar texto; Copiar link da mensagem e colar noutra conversa: vira "#canal › mensagem" e abre
  lá; Marcar como não lida: o canal volta a ter não lidas (some ao sair e voltar).
- Responder com e sem "@ Mencionar" (a outra pessoa recebe a menção só com ele ligado); Esc e X
  cancelam; clicar na citação rola até a original e destaca (também numa mensagem antiga, que
  precisa carregar o histórico); apagar a original: "Mensagem original apagada" na hora.
- Encaminhar para 2 conversas com comentário (busca, limite de 5); com imagem, a pessoa de
  destino que não está no servidor de origem abre a imagem; apagar a original não apaga a
  encaminhada nem a imagem dela; de uma DM aparece "de uma conversa privada".
- Emojis: seletor (busca "fogo", "joia", categorias, recentes, tom de pele lembrado noutro PC);
  ":fog" sugere 🔥 e Enter/Tab insere; mensagem só com 1 a 3 emojis aparece grande; os emojis
  têm o mesmo desenho no Windows 10 e 11.
- Reações: 6 rápidas e "+" pela barra e pelo botão direito; chips com contagem, a minha em
  destaque, passar o mouse mostra quem; clicar soma/tira; o outro PC vê na hora; sem "Adicionar
  reações" (cargo) não cria nova mas soma nas existentes; moderador tira a de outro pelo botão
  direito no chip; reagir na DM da @aureum.

### Correções antes da parte A (entram na mesma release) ✅ concluídas
- Imagem no chat com faixa cinza do lado: em components/Attachments.tsx (ImageThumb), o
  <button> que envolve a imagem é "block" e ocupa a largura toda da mensagem, mostrando o
  bg-elevated ao lado da imagem (máx 360px). A caixa deve ter o tamanho da imagem
  (inline-block / w-fit). Usar largura e altura salvas do anexo (se existirem) pra
  reservar o espaço certo enquanto carrega, sem pulo de layout. Conferir também vídeo,
  GIF e figurinha com o mesmo problema.
- Enquete não cria ("Coloque pelo menos 2 opções" com opções preenchidas): no
  CreatePollModal, o inputClass tem w-full e anula o w-14 do campo de emoji; o campo de
  EMOJI fica largo e o de TEXTO vira um quadradinho, então a pessoa digita no campo errado.
  Corrigir: campo de texto primeiro e largo (flex-1); emoji vira um botão quadrado pequeno
  à direita que abre o seletor de emojis da parte A (até lá, campo de 1 emoji com
  largura fixa garantida, sem conflito de classes). Ajustar o inputClass/composição pra
  classes de largura não brigarem (ex: tailwind-merge ou largura fora do inputClass) e
  revisar outros lugares que usam inputClass com largura própria.
  Teste de componente: preencher 2 opções pelo campo de texto cria a enquete; o campo
  de emoji não aceita texto comum.

#### Barra de ações da mensagem
- Ao passar o mouse numa mensagem, aparece uma barrinha flutuante no canto direito:
  Reagir (carinha), Responder, Encaminhar e "…" (mais opções).
- "…" abre o menu: Editar e Apagar (só nas minhas; Apagar também pra quem tem
  MANAGE_MESSAGES), Copiar texto, Copiar link da mensagem, Marcar como não lida.
  Mesmas opções no botão direito da mensagem.
- Atalhos com a mensagem em foco: R responde, E edita (minha), Del apaga (com confirmação).
- Tudo respeita permissões; o que a pessoa não pode fazer não aparece.

#### Responder
- "Responder" mostra acima do campo de mensagem uma faixa "Respondendo a @fulano" com o
  começo da mensagem original e X pra cancelar; Esc também cancela.
- A resposta aparece com uma citação compacta em cima (avatar pequeno, nome e começo do
  texto, ou "imagem"/"GIF"/"figurinha"/"mensagem de voz"). Clicar na citação rola até a
  original e destaca ela por 2s (carrega o histórico se precisar).
- Na faixa, botão "@ Mencionar" (ligado por padrão): notifica o autor da original.
  Desligado: responde sem notificar.
- Original apagada: a citação vira "Mensagem original apagada". Responder em mensagem de
  outro canal não existe (só no mesmo canal/DM).
- messages.reply_to_id (nullable, mesmo canal). A API devolve o resumo da original junto,
  respeitando permissões.

#### Encaminhar
- "Encaminhar" abre um seletor de destino com busca: DMs, grupos e canais de texto em que
  a pessoa pode enviar mensagens (SEND_MESSAGES; com anexo, ATTACH_FILES). Pode escolher
  até 5 destinos de uma vez e escrever um comentário opcional.
- No destino, a mensagem aparece como "Encaminhada" (ícone de seta), com o conteúdo
  original (texto, anexos, GIF, figurinha) e "de #canal · servidor" ou "de uma conversa
  privada", sem link pra origem se o destinatário não tiver acesso a ela.
- Anexos encaminhados ganham referência própria na mensagem nova (mesmo arquivo no MinIO,
  checagem de permissão pelo canal de DESTINO), pra quem recebe conseguir abrir.
- Figurinha exclusiva de servidor não pode ser encaminhada pra fora dele (opção desabilitada
  com aviso). Mensagens da DM oficial da @aureum podem ser encaminhadas.
- messages.forwarded_from (snapshot do conteúdo + origem), não referência viva: se a
  original for apagada depois, a encaminhada continua.
- Rate limit pra não virar spam (ex: no máx 5 destinos por vez, 20 encaminhamentos por minuto).

#### Emojis
- Botão de carinha no campo de mensagem abre o seletor: busca em português, categorias,
  recentes/frequentes e tom de pele (lembrado por usuário).
- Autocompletar ao digitar ":" + 2 letras (ex: ":fogo" sugere 🔥); Enter/Tab insere.
- Visual igual em todo lugar: propor conjunto open source (ex: Twemoji, com atribuição em
  Sobre) ou emoji nativo do Windows e perguntar ao Eduardo antes; nomes em pt-BR (ex: emojibase).
- Mensagem só com 1 a 3 emojis aparece grande.
- A regra do 2.1 continua: emoji nunca como ícone da interface, só no conteúdo.

#### Reações
- Na barra de ações, "Reagir" mostra 6 reações rápidas (👍 ❤️ 😂 😮 😢 🔥) e "+" para o
  seletor completo. Também pelo botão direito › Reagir.
- Chips embaixo da mensagem com emoji e contagem; clicar adiciona/remove a minha (a minha
  fica destacada na cor accent); passar o mouse mostra quem reagiu.
- Vale em canais, DMs e grupos (a DM oficial da @aureum também aceita reação). Em
  servidor: sem ADD_REACTIONS não cria reação nova, mas pode somar nas que já existem.
  MANAGE_MESSAGES remove reações de outros.
- Máx 20 emojis diferentes por mensagem. Tabela message_reactions (message_id, user_id,
  emoji), única por trio. Tempo real via WebSocket. Reação não gera notificação.

#### Testes da parte A
Responder (com e sem menção; original apagada; pular até a original); encaminhar pra vários
destinos, só onde pode enviar (inclusive via API), anexo abre no destino, figurinha de
servidor bloqueada fora dele, rate limit; barra de ações respeita permissões; seletor e
autocompletar de emojis; reagir/desfazer em tempo real; permissões de reação; limite de 20.

### Parte B: visto nas DMs e preview de links ✅ concluída (teste manual pendente)
Teste manual da parte B (dois PCs, ou duas contas, numa DM a dois):
- Mandar 3 mensagens: a última mostra "✓ Enviada"; a outra pessoa abre a conversa e na hora vira
  "✓✓ Vista" (cor accent) só na última; mandar outra: "Vista" fica na anterior e "Enviada" na nova.
- Configurações › Privacidade › "Confirmação de leitura" desligada num dos lados: as marcas somem
  na hora nos dois PCs e não voltam ao ler; religar: voltam. Grupo, canal de servidor e DM da
  @aureum nunca mostram visto.
- Link de notícia/blog: card com site, título, descrição e imagem um instante depois de enviar
  (a mensagem sai na hora). Link do YouTube: miniatura grande, título, canal e play que abre o
  navegador. Até 3 cards por mensagem; `<https://...>` não gera card.
- X no card (só nas minhas): some pra todo mundo e não volta ao editar. Editar trocando o link
  troca o card. Encaminhar mensagem com card: o card vai junto.
- `http://localhost:8000/api/health` ou `http://192.168.0.1` no chat: sem card (e nada no log de
  acesso da API além da própria mensagem).
#### Visto nas mensagens privadas (só DM 1:1)
- Não vale em servidor nem em grupo (por enquanto).
- Minhas mensagens mostram ✓ Enviada e ✓✓ Vista (na cor accent), só na última mensagem
  vista e na última enviada, pra não poluir.
- "Vista" vem do read-state que já existe (channel_reads.last_read_message_id do outro);
  read.updated atualiza na hora.
- Configurações › Privacidade › "Confirmação de leitura" (padrão ligado). Desligada: o
  outro não vê se eu li e eu também não vejo se ele leu (igual WhatsApp).
- A DM oficial da @aureum não mostra visto.

#### Preview de links
- Mensagem com link mostra um card: site, título, descrição e imagem (OpenGraph).
  YouTube: miniatura grande, título, canal e play que abre no navegador (sem tocar dentro
  do app por enquanto). Até 3 previews por mensagem.
- Quem busca o preview é a API, nunca o app (o IP de quem recebe não vaza pro site).
  Segurança: só http/https, bloquear IPs internos (localhost, 192.168.x, 10.x, 172.16–31.x,
  100.64–127.x do Tailscale etc., inclusive depois de resolver o DNS e em cada redirect),
  tempo limite 5s, máx 1 MB lido, até 3 redirects, cache de 24h por URL. Imagem do
  preview passa pelo /api/media (proxy com cache).
- Quem enviou pode remover o preview da própria mensagem (X no card). Link entre < > não
  gera preview. Mensagem encaminhada mantém o preview.

#### Testes da parte B
Visto em tempo real e respeitando a opção desligada nos dois sentidos (inclusive via API);
preview OpenGraph e YouTube; link para IP interno recusado (inclusive via redirect e DNS);
timeout; cache; remover preview.

### Parte C: figurinhas e GIFs ✅ concluída (teste manual pendente)
Teste manual da parte C (dois PCs, ou duas contas; com o pacote e a chave do Klipy da produção):
- Carinha no campo de mensagem: abas Emojis, Figurinhas e GIFs. Figurinhas: "Aureum básico"
  primeiro, depois as deste servidor; as de outro servidor aparecem com cadeado ("Só no
  servidor X"); busca por "parab" e por 😂; enviar uma: aparece em 160px e vai pros Recentes
  (também no outro PC). Na DM e no grupo só as do Aureum.
- Configurações do servidor › Figurinhas (dono, ou cargo com "Gerenciar figurinhas"): enviar PNG
  e WebP, recusar GIF/animado e arquivo de mais de 512 KB, renomear, trocar o emoji, remover (as
  mensagens antigas mostram "Figurinha removida"). Cargo sem "Usar figurinhas": não envia.
- Encaminhar uma figurinha do servidor: os outros servidores e as DMs aparecem bloqueados.
- Botão GIF: abre na aba GIFs com "Search KLIPY", Em alta e Favoritos; buscar "bom dia"; enviar:
  toca sem som em loop, no tamanho certo, e para ao rolar pra longe; estrela no seletor e na
  mensagem (aparece em Favoritos no outro PC). Windows com "Mostrar animações" desligado: o GIF
  fica parado e toca ao passar o mouse. Canal sem "Enviar arquivos": sem botão GIF.
- Sem internet (ou chave errada): a aba GIFs diz que estão fora do ar e o chat segue normal.

#### Figurinhas do Aureum e do servidor
- Por enquanto só figurinhas ESTÁTICAS (PNG/WebP), sem animação.
- Figurinhas do Aureum (genéricas): pacotes do próprio app que todo mundo pode usar em
  qualquer lugar (DMs, grupos e qualquer servidor).
  - Pacote inicial "Aureum básico" com ~16 figurinhas desenhadas em SVG próprio no visual
    da marca (reações comuns: "bom dia", "kkkk", "gg", "bora?", "valeu", "triste",
    "brabo", "dormindo" etc., em pt-BR), exportadas em PNG 320×320. Mostrar ao Eduardo
    antes de fechar. Pacote do mascote: ideia futura (ver FUTURO.md).
  - Pacotes novos entram por CLI de admin (stickers pack-add / sticker-add), sem release.
    Tabelas sticker_packs (id, nome, global bool, server_id nullable) e stickers.
- Figurinhas do servidor: cada servidor tem as próprias, PNG ou WebP estáticos, máx
  512 KB e 320×320, até 30 por servidor; nome + emoji relacionado (pra busca). Exclusivas:
  só podem ser enviadas no servidor delas (nem em DM nem em outro servidor).
- Permissões novas: MANAGE_EXPRESSIONS (gerenciar figurinhas do servidor) e USE_STICKERS
  (padrão: permitido ao @everyone; vale pras do Aureum e pras do servidor).
- Aba "Figurinhas" no seletor: "Aureum" primeiro, depois as do servidor atual (as de outros
  servidores aparecem bloqueadas com "só no servidor X"); recentes no topo; busca por
  nome/emoji.
- Enviada como mensagem própria, exibida em 160px. No MinIO, servidas com checagem de
  permissão. Configurações do servidor › Figurinhas: enviar, renomear e remover.

#### GIFs
- Botão "GIF" no campo de mensagem (ao lado da carinha) abre um seletor com busca em
  português, em alta (trending) e favoritos do usuário. Clicar envia como mensagem.
- Provedor: a Tenor API foi encerrada em 30/06/2026; o Eduardo escolheu o Klipy (27/10).
- MUDOU na implementação (ADR 0034): os termos do Klipy exigem que busca e trending saiam do app
  da pessoa e proíbem proxy, cache e reordenação nossos sem aprovação por escrito. Por decisão do
  Eduardo, integração padrão: o app chama o Klipy direto com a chave que a nossa API entrega
  (GET /api/gifs/config; a chave fica no .env e troca sem release) e um customer_id anônimo;
  sem cache nem rate limit nossos (o limite é do Klipy). Plano original, que não vale mais:
  "busca e trending passam pela nossa API, com cache de 10 min / 1h".
- Classificação de conteúdo no filtro mais seguro do provedor (equivalente a "pg-13"),
  idioma pt-BR. Atribuição exigida pelo provedor no seletor.
- O GIF não é baixado pro MinIO: a mensagem guarda provedor, id, URL do arquivo (MP4/WebP
  preferido, menor que GIF) e dimensões. Exibe em loop sem som, pausa quando sai da tela,
  respeita prefers-reduced-motion (só toca ao passar o mouse).
- Favoritos: estrela no GIF (no seletor ou na mensagem), salvo no servidor por usuário.
- Em servidor precisa de SEND_MESSAGES e ATTACH_FILES.

#### Testes da parte C
Figurinha do Aureum em DM, grupo e qualquer servidor; figurinha de servidor só nele
(inclusive via API); limites de arquivo; permissões novas; CLI de pacotes; busca de GIF
direto no Klipy com chave, customer_id, filtro e idioma (ver ADR 0034; sem cache nem rate limit
nossos); só URLs do Klipy aceitas na mensagem; provedor fora do ar mostra erro amigável sem
quebrar o chat; favoritos.

## 3.19 Ajustes do beta (01/11) — antes do 3.12
Em partes, na ordem (A a E). Uma conversa do Claude Code por parte; um item por vez, commit por
item, sem push. Diagnóstico antes de corrigir onde está indicado. Release 0.2.0-beta.9 no fim do
bloco (ou antes, com as partes prontas, se o Eduardo pedir).

### Parte A: tiles da call e cartão de perfil ✅ concluída (teste manual pendente)
Tiles cortados (falando, foco, transmissão):
- Causa provável (conferir): o anel de "falando" e o de foco são ring (box-shadow) por FORA do tile,
  cortados pelos contêineres com overflow (faixa do modo Foco com overflow-y-auto, palco, janelinha
  flutuante, painéis). E câmeras na grade e na faixa usam object-cover, então a imagem perde as bordas.
- Anel desenhado por DENTRO do tile (camada absoluta por cima do vídeo, pointer-events none), em
  todo lugar que mostra tile: call, faixa do Foco, janelinha flutuante, overlay e Visão geral. Mesma
  espessura e cor de hoje; hover e foco do teclado também por dentro.
- Vídeo inteiro: câmera e tela com object-contain em qualquer tamanho; a sobra fica no fundo escuro do
  tile (scrim). Tela compartilhada nunca corta.
- Faixa do Foco e grade com folga para nada encostar na borda de um contêiner que rola.
- Testes (Vitest): anel interno presente em grid, strip e focus; fit contain nos três tamanhos.
Inventário de insígnias no cartão de perfil (o seu e o dos outros, aberto do chat, da lista de
membros, da call etc.):
- O cartão nunca passa da tela: altura máxima = espaço visível. Ao trocar de aba (Perfil/Insígnias)
  ou a altura mudar, ele se reposiciona para caber (sobe se abriu perto do fim da tela).
- A lista de insígnias rola dentro do cartão, com barra de rolagem no tema e roda do mouse; banner,
  avatar, nome e abas ficam fixos.
- Teste: cartão aberto no rodapé da janela com 8+ insígnias chega até a última.

### Parte B: Painel de sons ✅ concluída (funcionando em produção, confirmado pelo Eduardo em 06/11)
Os sons não tocam. Diagnóstico PRIMEIRO, sem corrigir no chute; me explicar a causa antes:
1. VPS: os arquivos dos sons existem no MinIO (vieram na migração?); GET /api/media/sounds/{id}
   responde 200 com o content-type certo; logs da API no POST /sounds/{id}/play.
2. App: a prévia em Configurações do servidor › Painel de sons toca? Erro no console ao tocar na
   call (fetch, decode ou publishTrack)?
3. LiveKit self-hosted: a segunda track de origem microfone ("soundboard") é aceita? Conferir o
   canPublishSources do token, os logs do livekit-server e se o outro lado recebe a track.
Se faltarem arquivos da migração, mostrar como recuperar do backup do PC (com OK do Eduardo).
Recortar áudio maior:
- Ao adicionar um som, aceitar arquivo de até 10 MB e 10 min (mp3, ogg, wav; m4a se o Chromium
  decodificar).
- Editor de recorte: forma de onda, janela de seleção arrastável pelas duas pontas, máximo 5 s
  (padrão: os primeiros 5 s), "Ouvir trecho", zoom em áudio longo, início e fim em texto editável.
  Fade de ~10 ms nas pontas pra não estalar.
- O app corta e envia só o trecho em WAV mono 48 kHz 16 bits (5 s ≈ 480 KB). A API continua
  validando ≤ 5 s e ≤ 1 MB como hoje. O arquivo original não sobe nem fica guardado.
- Arquivo de até 5 s pode ir direto, sem editor (o editor abre se a pessoa quiser ajustar).
- Testes: o recorte gera WAV com a duração escolhida; a seleção nunca passa de 5 s; arquivo grande
  demais ou que não decodifica dá aviso legível.

### Parte C2: correções por aparelho (quando chegarem os relatórios dos testers)
- Com os relatórios novos, achar a causa de cada caso: supressão de
  ruído sem efeito, headset Havit, AB13X USB Audio e o que mais aparecer.
- Me explicar a causa de cada um antes de corrigir; ajustes por aparelho só se não houver correção
  geral.

### Parte D: Perfil e Configurações ✅ concluída (teste manual pendente)
- Configurações perde as abas "Meu perfil" e "Conta" (repetidas). Perfil fica só no Editar perfil
  (Ver perfil › Editar perfil, e o cartão).
- O Editar perfil ganha o botão "Conta", que abre tudo o que hoje está em Configurações › Conta
  (e-mail, senha, sessões, excluir conta etc.), sem perder nada. Alteração de perfil não salva
  pergunta antes de trocar.
- Todo link ou atalho que levava a Configurações › Meu perfil ou › Conta (menu do perfil, avisos,
  bot, e-mails, dicas) passa a abrir o Editar perfil no lugar certo.
- Testes: as abas sumiram; Conta abre e salva; os links antigos caem no lugar novo.

### Parte E: Início — calendário e novidades no sino ✅ concluída (teste manual pendente)
Novidades saem do Início:
- O card "Novidades do Aureum" sai do hub. Cada versão nova vira uma notificação no sino (ao lado
  do avatar): "Aureum 0.2.0-beta.N: veja as novidades", não lida até abrir, e conta no número do
  sino. Abrir mostra o mesmo modal do CHANGELOG de hoje. Reaproveitar news_dismissed como "visto"
  (sem migração, se der).
Calendário no lugar:
- Calendário pessoal com os eventos e prazos de TODOS os servidores da pessoa juntos, com a mesma
  cara e os mesmos componentes do addon Calendário (3.9 D).
- No hub: mini mês com pontinhos nos dias com itens + lista dos próximos 7 dias. "Abrir calendário"
  expande para a vista completa (mês, semana, lista) dentro do Início.
- Filtros: por servidor e "Só meus" (cards em que sou responsável e eventos em que respondi
  Vou/Talvez). Ícone/cor do servidor em cada item.
- Clicar abre o item onde ele está (aba do servidor + canal do Kanban/Eventos).
- API: rota nova que junta o hook dated_items de todos os servidores e canais que a pessoa enxerga,
  por intervalo de datas, com as mesmas permissões do addon (canal privado sem acesso nunca
  aparece). Sem migração, se der.
- Tempo real: item criado, mudado ou apagado em qualquer servidor atualiza o calendário do Início.
- Testes: junta 2+ servidores; canal sem permissão não vaza (API e WS); "Só meus"; clicar abre no
  lugar certo; a notificação da versão aparece uma vez e some ao abrir.

### Release do 3.19
- 0.2.0-beta.9 pelo ritual. Produção na VPS: backup antes de qualquer migração (se houver);
  comandos com OK do Eduardo.
- Teste manual: call com 3 pessoas em grade, Foco e janelinha (anel inteiro); câmera e tela sem
  corte; som recortado tocando pros dois; ligar a câmera sem trocar o mic; cartão de perfil no
  rodapé rolando até a última insígnia; Conta dentro do Editar perfil; calendário do Início com 2
  servidores; notificação da beta.9 no sino.

## 3.12 Categorias de canais ✅ concluído (falta produção e teste manual)
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

## 3.13 Painéis: até 4 por servidor ✅ concluído (falta produção e teste manual)
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

### Ordem das abas
- Arrastar uma aba no cabeçalho do painel muda a ordem (uma linha mostra onde ela cai). Arrastar pra
  outro painel continua movendo, na posição onde soltar. Visão geral continua fixa em primeiro.
- Botão direito na aba: "Mover para a esquerda", "Mover para a direita" e "Fechar outras".
- Ordem salva junto com o layout (por servidor e por usuário).
- Testes: reordenar no mesmo painel; mover entre painéis na posição solta; ordem restaurada ao reabrir.

### Barra de membros única (fazer ANTES de ampliar para 4 painéis) ✅ concluída (teste manual pendente)
Atalho: Ctrl+Shift+U. O botão ficou na direita da barra superior. Escolhas em 0038-single-member-bar.md.
- Problema: hoje o "Membros" fica no cabeçalho de cada painel e o aberto/fechado é guardado por aba
  (panel_layouts[...].members), então com 2+ painéis a lista aparece repetida.
- Passa a existir UMA barra de membros por servidor, na direita da área do servidor, fora dos
  painéis (nunca dentro de um painel). O botão "Membros" sai do cabeçalho dos painéis e vai para um
  lugar fixo no cabeçalho do servidor (à direita); atalho de teclado próprio para abrir/fechar
  (propor um que não brigue com os atalhos que já existem).
- Acompanha o painel em foco: canal aberto a todos mostra os membros do servidor; canal privado
  mostra só quem tem acesso a ele, com o nome do canal no título ("Membros · #canal"). Visão geral e
  addons sem restrição mostram o servidor inteiro. Trocar o foco de painel atualiza a lista na hora.
- Aberta/fechada e largura salvas por servidor e por usuário; largura ajustável arrastando a borda
  (mínimo e máximo razoáveis).
- Janela estreita (mesmo limite de ~1100px do layout): a barra abre por cima do conteúdo (gaveta),
  fecha com Esc, clicando fora ou no botão, e não espreme os painéis.
- Migração do estado salvo: se alguma aba do servidor tinha membros aberto, a barra nova começa
  aberta; o campo antigo por aba deixa de ser usado (sem quebrar layouts salvos).
- DMs em grupo continuam com a lista própria delas (fora do escopo).
- Testes: com 2, 3 e 4 painéis existe uma lista só; botão e atalho abrem/fecham; troca de foco para
  canal privado filtra a lista (e quem não tem acesso não aparece, inclusive via API/WS); estado e
  largura restaurados ao reabrir; gaveta em janela estreita; layout antigo com membros por aba vira
  barra aberta.

### Detalhes
- Divisores arrastáveis na horizontal e na vertical; duplo clique no divisor iguala os tamanhos.
- Maximizar temporário: duplo clique no cabeçalho deixa o painel em tela cheia; duplo
  clique de novo ou Esc volta ao layout. A barra de membros continua disponível pelo botão.
- Call: se ela estiver visível em algum painel, a janelinha flutuante some; volta quando o
  painel da call fecha ou fica escondido.
- Tamanho mínimo por painel (~320×240), contando a barra de membros aberta. Se a janela diminuir e
  não couber, os painéis que sobram viram abas no painel vizinho, sem fechar nada, e voltam ao
  lugar quando a janela aumenta. Continua valendo: abaixo de ~1100px, só 1 painel.
- Vídeo: tiles em painéis pequenos recebem a camada menor (adaptiveStream); painel
  escondido ou virado aba não recebe vídeo.
- Layout salvo por servidor e por usuário. Layouts de 2 painéis já salvos continuam iguais.

### Testes
Montar 1, 2, 3 e 4 painéis por arrastar, por "Dividir" e pelo menu; 5º vira aba; fechar
redistribui; maximizar e voltar; janela pequena vira abas e volta; call em painel esconde a
janelinha; layout salvo e restaurado por servidor; layout antigo de 2 painéis preservado;
reordenar abas; uma barra de membros só, em qualquer número de painéis.

## 3.14 Overlay novo: widgets separados ✅ concluído (falta teste manual)
Escolhas em [ADR 0040](0040-overlay-widgets.md). Sem mudança na API e sem migração: o overlay.json
antigo vira o widget de voz sozinho. Decidido durante o bloco: uma janela por widget; o overlay vai
para o monitor do jogo; notificações também aparecem fora de call (sobre jogos), e por isso o programa
em primeiro plano também é conferido enquanto uma notificação está na tela.

### Teste manual do 3.14 (dois PCs ou duas contas; jogo em janela sem borda)
1. Quem já usava o overlay: depois de atualizar, a lista de voz continua no mesmo lugar e com o mesmo
   tamanho e opacidade; quem tinha "Mostrar câmeras" desligado continua sem o widget de câmeras.
2. Câmera: a outra conta liga a câmera e sai da lista de voz para o widget de câmeras; desliga e
   volta. Sem ninguém com câmera, o widget não aparece.
3. Horizontal/vertical e tamanho dos tiles, em Configurações e no widget.
4. Ctrl+Shift+F10: os 3 widgets aparecem com moldura; arrastar e redimensionar cada um; Esc termina.
   Reabrir o app: as posições continuam.
5. Dois monitores: o jogo no outro monitor leva os widgets junto; posicionar lá; voltar para o primeiro
   monitor: cada um guarda a sua posição.
6. Em jogo, numa call: DM, menção e entrar/sair da call aparecem e somem em ~5 s. Fora de call: DM,
   menção e chamada recebendo aparecem por cima do jogo. Nada aparece sobre navegador ou launcher, com
   o app em primeiro plano ou em Não perturbe.
7. "Esconder o conteúdo": só "@fulano te mandou mensagem".
8. Desligar cada widget: ele não aparece, nem no modo edição. Todos desligados: nada aparece e o
   "Editar posição e tamanho" fica desabilitado.
9. Sem mudança do que já existia: clique passa pro jogo, Ctrl+Shift+F9 esconde tudo, "Isso é um jogo?"
   aparece e responde (inclusive com o widget de voz desligado), e nada aparece ao transmitir a tela.
10. Abrir o app pelo login do Windows (minimizado na bandeja), ir para um jogo e receber uma DM: a
    notificação aparece.

### Spec original
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

## 3.15 Painel de sons ✅ concluído (em produção e funcionando, confirmado pelo Eduardo em 06/11)
Feito antes do 3.12–3.14, a pedido do Eduardo. Decisões em
[ADR 0035](0035-soundboard.md): som como segunda track de áudio de origem microfone com o nome
"soundboard" (o token não permite outra origem), duração medida com tinytag (MIT), trava no Redis
para "1 por vez" e cooldown, e o anel de fala medindo só o microfone de quem está com um som tocando.
Ajustes do Eduardo antes de começar: o indicador de fala (call, overlay e listas) nunca acende por
causa de um som; com o próprio mic mutado o painel funciona, ensurdecido fica desligado.

### Produção do 3.15 (✅ feita; fica como referência dos passos)
Pode ir junto com a do 3.10/3.11, num backup só. Tudo com OK do Eduardo, na ordem. A API nova não
quebra o app beta.6: só rotas, colunas e um evento novos. Um app beta.6 numa sala ouve os sons de
quem tem o app novo, no volume daquela pessoa, e o anel dela acende enquanto o som toca. Ele não
tem o botão.
1. Backup do banco com os mesmos comandos do item 1 da produção do 3.9 (sem ele, nada segue).
2. Reconstruir e reiniciar a API. **Dependência Python nova: tinytag** (o `--build` instala).
   Aplica a migração core c1e7a3b9d520 (tabela soundboard_sounds, user_settings.soundboard_volume
   e soundboard_muted, e a permissão USE_SOUNDBOARD, que entra no @everyone dos servidores que já
   existem):
   `docker compose --env-file .env -f infra/docker-compose.yml up -d --build --no-deps --wait api`
   Conferir: `docker compose --env-file .env -f infra/docker-compose.yml exec api alembic current`
   mostra c1e7a3b9d520 (head).
3. Conferir `curl -s https://<endereço do Funnel>/api/health` e o app beta.6 entrando numa sala
   normalmente.
4. Release do app só depois da API no ar. No CHANGELOG: "Painel de sons nas salas dos servidores:
   quem gerencia o servidor adiciona sons curtos e todo mundo toca na call; cada um escolhe o volume
   ou silencia os sons dos outros."

### Teste manual do 3.15 (dois PCs ou duas contas, na mesma sala de um servidor)
1. Configurações do servidor › Painel de sons: adicionar um mp3, um ogg e um wav (ouvir antes),
   com nome, emoji e volume; um arquivo de mais de 5 s e um de mais de 1 MB são recusados com aviso.
   Renomear, trocar o emoji, mudar o volume e remover; a outra conta vê a lista mudar sozinha.
2. Na call, botão do painel de sons: a grade mostra emoji e nome; clicar toca para os dois, inclusive
   com o próprio microfone mutado. A grade fica cinza enquanto toca e por 3 s.
3. O anel de quem toca o som NÃO acende só por causa dele (call, overlay, Sidebar e Visão geral);
   falando por cima, acende. Com o mic mutado e um som tocando, o tile continua com o mic cortado.
4. Ensurdecer: o botão desliga e um som que estava tocando para. Silenciado pelo servidor: o botão
   desliga. Sem "Usar o painel de sons" ou sem "Falar" no cargo: o botão fica sem permissão.
5. Configurações › Sons › Painel de sons (ou embaixo da grade): o volume muda o som dos outros na
   hora; "Silenciar sons dos outros" para de tocar os deles, e os seus continuam saindo.
6. Microfone depois de um som: entrar mutado, tocar um som, desmutar; a outra conta ouve a voz.
   Repetir trocando o microfone em Configurações durante um som.
7. Outro servidor: os sons de um não aparecem na call do outro; DMs não têm o botão.

### Spec original
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

## 3.20 Arraste de imagens e janela destacada da call ✅ concluído (teste manual pendente)
### Parte A: arrastar a janelinha arrasta a foto ✅ concluída (teste manual pendente)
- Bug (vídeo do Eduardo, 04/11): ao arrastar a janelinha flutuante da call segurando na foto de
  perfil, o Chromium começa o arraste NATIVO da <img> em vez de mover a janela; a foto pode cair no
  chat como anexo ("Solte para enviar").
- CallPip: preventDefault no pointerdown (fora dos botões), user-select none durante o arraste.
- No app todo: imagens de interface (avatar, ícone e banner de servidor, insígnias, emojis,
  figurinhas, miniaturas) com draggable={false} (ou -webkit-user-drag: none no componente). Só fica
  arrastável o que tem arraste próprio (canais, abas, cards do Kanban, anexos se fizer sentido).
- A área de "Solte para enviar" do chat só aceita arquivos vindos de FORA do app; arraste interno
  (imagem, aba, canal) nunca vira anexo.
- Testes: pointerdown na foto da janelinha move a janela e não inicia drag nativo; soltar uma
  imagem do próprio app no chat não cria anexo; arquivo do Explorer continua anexando.
- Feito: CallPip cancela pointerdown e dragstart, sem seleção de texto durante o arraste; regra
  global img:not([draggable='true']) { -webkit-user-drag: none } no main.css; lib/internalDrag.ts
  marca arrastes que começam dentro da janela e o chat ignora esses. Teste manual: arrastar a
  janelinha pela foto até o chat (não anexa); arrastar avatar/emoji/figurinha pro chat (não anexa);
  arquivo do Explorer continua anexando; abas, canais e cards do Kanban continuam arrastáveis.

### Parte B: destacar a chamada (janela própria, sempre por cima) ✅ concluída (teste manual pendente)
- Botão "Destacar chamada" na barra da call e na janelinha flutuante. Abre a call numa janela
  própria do sistema, sem moldura, SEMPRE POR CIMA (dá pra desligar o "fixar por cima" no próprio
  cabeçalho), que continua visível com o Aureum minimizado ou atrás de outros programas.
- Conteúdo: o mesmo da janelinha (quem fala ou a tela em foco, com troca Foco/Grade) e a barra de
  controles compacta (mic, fone, câmera, tela, painel de sons, sair) e "Voltar ao app".
- Redimensionável (mínimo ~240×135, proporção livre), arrastável por qualquer parte que não seja
  botão (mesma regra da parte A). Posição, tamanho e monitor salvos; se o monitor sumir, volta
  pro principal.
- A mídia NÃO é duplicada: a janela destacada mostra as tracks da mesma sala (sem segunda conexão
  no LiveKit). Sugestão a avaliar: window.open do próprio renderer (setWindowOpenHandler com
  alwaysOnTop, frame false) e React portal, para compartilhar estado e tracks; propor no plano.
- Enquanto destacada: a janelinha flutuante de dentro do app some; a call num painel continua
  normal. Fechar a janela destacada (X ou "Voltar ao app") volta pra janelinha, sem sair da call.
  Sair da call fecha a janela destacada.
- Tile com o anel interno do 3.19 e vídeo em contain; janela pequena recebe a camada menor de vídeo.
- Não é o overlay: não aparece por cima de jogo em tela cheia exclusiva e não lê nada do jogo.
- Testes: abrir/fechar destacada sem cair da call; app minimizado e a janela continua; controles
  funcionam; posição e tamanho restaurados; sair da call fecha; sem segunda conexão na sala.
- Feito (escolhas em 0043-detached-call-window.md): window.open('about:blank', 'aureum-call-<n>') do
  próprio renderer + React portal, como o overlay; mesmo processo e mesmos stores, então a janela toca
  as tracks da sala que já existe (nada chama join/connect; teste confere). main/callWindow.ts libera só
  esse nome, sem moldura, mínimo 240×135, "fixar por cima" no nível 'floating'; posição, tamanho e pin
  em call-window.json, e fora de qualquer monitor volta pro canto do principal. Cabeçalho e barra
  compacta aparecem com o mouse por cima; Painel de sons abre dentro da janela; o seletor de tela abre
  no app (trazido pra frente), e as setinhas de aparelho ficam só no app. Não tem proteção contra
  captura (é uma janela normal, como a do app).
- Teste manual: destacar pela barra da call e pela janelinha (a janelinha some); minimizar o Aureum e
  pôr outro programa na frente (a janela continua por cima); desligar o pin e conferir que outra janela
  passa por cima; mic, fone, câmera, tela (abre o seletor no app), painel de sons e sair; Foco/Grade com
  3+ pessoas e com alguém transmitindo; arrastar pela foto; redimensionar até o mínimo; fechar e
  reabrir (volta no mesmo lugar e tamanho); mover pro segundo monitor, desligar o monitor e reabrir
  (volta pro principal); X, Alt+F4 e "Voltar ao app" não tiram da call; sair da call fecha a janela.

## 3.24 Correções do beta (07/11): overlay na transmissão, imagens, volume e chat ✅ concluído (teste manual pendente)
### Parte A: quadrados pretos do overlay na transmissão ✅ concluída (teste manual pendente)
- Causa encontrada (08/11; quem transmitiu está no Windows 10 2004+/11): no Electron 44 a proteção
  vira WDA_EXCLUDEFROMCAPTURE, mas o DWM desenha como retângulo preto na captura uma janela
  protegida que foi escondida e mostrada de novo; o Electron tinha um contorno pra isso (PR #31340,
  WS_EX_LAYERED) que sumiu quando passou a usar a proteção do Chromium, e o overlay esconde e mostra
  os widgets o tempo todo. Antes do 2004 o Chromium usa WDA_MONITOR, que é preto sempre.
- Feito: widgets escondidos (hide) desde antes do primeiro quadro enquanto a tela inteira ou a
  janela de um jogo é transmitida (o nome do programa da janela é lido como no resto do overlay);
  proteção ligada num ponto só (appWindows.ts) em todas as janelas flutuantes, incluindo a janela
  destacada, que não tinha; aviso em Configurações › Overlay em Windows antigo e quando o overlay
  está escondido pela transmissão.
- Bug: quem assiste a tela de alguém vê quadrados pretos onde está o overlay de quem transmite.
- Causa provável (conferir): as janelas do overlay usam setContentProtection(true). No Windows 10
  2004+ isso exclui a janela da captura (fica invisível); em Windows mais antigo ou em janela sem a
  proteção, vira retângulo preto. Me explicar a causa antes de corrigir; perguntar ao Eduardo a
  versão do Windows (winver) de quem transmitiu.
- Correção: enquanto a pessoa transmite a TELA INTEIRA ou a janela de um jogo, as janelas do
  overlay ficam ESCONDIDAS de verdade (hide, não só sem conteúdo) e voltam ao parar; conferir que
  TODAS as janelas transparentes do app (voz, câmeras, notificações, avisos, janela destacada do
  3.20 B) têm a proteção ligada antes de aparecer.
- Se o Windows da pessoa não suporta excluir da captura: avisar uma vez em Configurações › Overlay
  ("Seu Windows mostra o overlay como quadrado preto em transmissões; ele será escondido enquanto
  você transmite").
- Testes: transmitir com o overlay visível e conferir no outro PC que não aparece nada (tela
  inteira e janela); parar de transmitir e o overlay volta; todas as janelas transparentes com
  proteção (teste automático).

### Parte B: copiar e salvar imagem pelo botão direito ✅ concluída (teste manual pendente)
- Feito: menu da imagem (ImageMenu.tsx) em anexos, figurinhas e prévias de link, acima das opções
  da mensagem; GIF do Klipy só copia o link. O visualizador virou um só (ImageViewer.tsx), aberto
  de qualquer imagem, com o mesmo menu. Copiar decodifica pra PNG no app (GIF vira o primeiro
  quadro) e o processo principal grava com clipboard.write + ClipboardItem image/png (o Electron 44
  tirou o clipboard.writeImage). Salvar usa o "Salvar como" com o nome original e a extensão do
  tipo real do arquivo. Os bytes são os que o app já carregou (cache e token), sem rota nova.
- Teste manual: colar no próprio chat, no WhatsApp e no Paint.
- Botão direito numa imagem do chat (anexo, prévia de link, figurinha) abre o menu: "Copiar
  imagem", "Salvar imagem como…" e "Abrir imagem" (visualizador do app). GIF do Klipy: "Copiar
  link do GIF" (sem baixar, regra do ADR 0034). As opções de mensagem continuam no mesmo menu,
  abaixo.
- Copiar põe a imagem na área de transferência como imagem (clipboard.writeImage pelo processo
  principal, com os bytes que o app já carregou; GIF animado vira o primeiro quadro, como no
  navegador). Funciona colando no próprio chat, no WhatsApp e no Paint.
- Salvar abre o "Salvar como" do Windows com o nome original e a extensão certa.
- Mesmo menu no visualizador de imagem em tela cheia.
- Testes: copiar e colar de volta no chat; salvar com nome e extensão certos; imagem de canal sem
  permissão não é baixada por outra rota; GIF só copia o link.

### Parte C: volume das transmissões salvo por pessoa ✅ concluída (teste manual pendente)
- Feito: user_settings.screen_audio (volume 0-100 e mudo, por id de usuário, mesclado como o
  user_audio) e screen_volume_default (50%), migração a7c3e9f1b264. O tile lê e salva na conta
  (com o debounce do store de configurações); mudo separado do volume, então desmutar volta ao
  salvo. O volume de voz por pessoa já era salvo (user_audio, Fase 2): nada a mudar.
- Produção: precisa da migração na VPS antes (ou junto) da release; app antigo continua igual.
- Hoje o volume da tela de cada pessoa (screenVolume) fica só na memória e volta pra 100% toda vez
  que alguém entra na call ou começa a assistir: a galera estoura o ouvido.
- Passa a ser salvo POR PESSOA que transmite (pelo id do usuário, não pela identidade da sala), na
  conta (user_settings), então vale em qualquer PC: assistir a tela do fulano sempre começa no
  volume que eu deixei pra ele.
- Configurações › Voz: "Volume padrão das transmissões" (padrão 50%), usado pra quem eu nunca
  ajustei. Mudar o controle de volume no tile salva na hora (com debounce).
- Aproveitar e salvar do mesmo jeito o volume de voz por pessoa, se hoje também não for salvo.
- Testes: ajustar o volume do fulano, sair e entrar: volta no mesmo; outro PC: mesmo volume;
  pessoa nova usa o padrão; mudar o padrão não muda quem já foi ajustado; mutar e desmutar volta
  ao volume salvo.

### Parte D: chat sem barra de rolagem lateral ✅ concluída (teste manual pendente)
- Causa: a bolha da mensagem fica com a largura do conteúdo, e break-words quebra a linha mas não
  deixa a caixa encolher (a palavra inteira vira a largura mínima); medido no Chromium: URL de 500
  caracteres numa coluna de 320 px rolava 3630 px pro lado, com overflow-wrap: anywhere, nada.
- Feito: wrap-anywhere no texto da mensagem (vale pra links, menções e código inline), nos cards de
  link, nas enquetes e no campo de digitar; cards, vídeos e imagens sem tamanho com no máximo 100%
  da coluna; GIF mantém a proporção quando encolhe; a lista esconde overflow lateral como última
  proteção. DMs e painéis usam o mesmo ChatView; a janela destacada não tem chat; o chat não tem
  bloco de código (só código inline).
- Bug: link ou palavra muito longa (e alguns cards e blocos) estica a mensagem e o chat ganha barra
  de rolagem pro lado em janela menor.
- O chat NUNCA rola pro lado, em nenhum tamanho de janela ou painel: links e palavras longas quebram
  a linha (overflow-wrap: anywhere) em vez de esticar; contêineres flex com min-w-0; imagens,
  vídeos, GIFs, cards de link, enquetes e citações com largura máxima de 100% da coluna; bloco de
  código rola só por dentro dele.
- Não cortar nem limitar o texto de ninguém (nada de limite de caracteres): tudo aparece, só quebra
  a linha.
- Mesma regra no campo de digitar, nas DMs, nos painéis estreitos (3.13) e na janela destacada.
- Testes: URL de 500 caracteres, palavra sem espaço, card de link, imagem larga e bloco de código
  numa janela de 900 px e num painel de 320 px: sem rolagem lateral no chat.

## 3.21 Versão para macOS
Decidido pelo Eduardo (09/11): SEM assinatura da Apple por enquanto (grátis, sem atualização
automática no Mac); quem testa é um amigo do Eduardo que só tem Mac. Assinatura paga fica pro
lançamento público (FUTURO.md).
- Build sem assinatura paga, mas com assinatura ad-hoc (a do próprio electron-builder), pra o
  Mac com chip Apple aceitar abrir. Passo a passo na landing e no README: abrir pelo "Abrir mesmo
  assim" em Ajustes › Privacidade e Segurança; se aparecer "está danificado", rodar no Terminal
  `xattr -cr /Applications/Aureum.app` e abrir de novo.
- A release do Mac sai junto com a do Windows (mesma versão, mesmo rascunho no GitHub): .dmg e
  .zip pros dois chips.
- Build: electron-builder com alvo mac (dmg + zip, Apple Silicon e Intel), gerado num runner macOS
  do GitHub Actions (grátis em repositório público), disparado pelo ritual de release junto com o
  Windows. Ícone .icns gerado pelo npm run build:icons a partir do logo oficial.
- Sem assinatura (padrão do beta): o app abre por "Abrir mesmo assim" (passo a passo na landing e
  no README) e NÃO se atualiza sozinho; ao abrir, se houver versão nova, aviso "Baixar a versão X"
  que leva pra página de download. Com assinatura (se o Eduardo decidir pagar): assinar, notarizar e
  ligar a atualização automática; certificados só em secrets do GitHub, nunca no repositório.
- Permissões do macOS com textos em pt-BR: microfone, câmera e gravação de tela (transmissão);
  fluxo que explica e abre os Ajustes quando a permissão foi negada.
- Recursos só de Windows ficam desligados e escondidos no Mac, sem erro: overlay, detecção de jogo
  e push-to-talk (decidido em 09/11: no Mac o "Pressionar para falar" sai das opções, nem com a
  janela em foco; nada de pedir permissão de Acessibilidade).
- Transmissão de tela com som do sistema: testar no Mac (exige permissão de gravação de tela);
  se não der som do sistema, transmitir sem som com aviso claro.
- Atalhos com Cmd no lugar de Ctrl no Mac (inclusive os textos de ajuda e do tour); menu do app
  padrão do macOS; ícone na barra de menus no lugar da bandeja.
- Landing e README: botão de download para Mac ao lado do Windows.
- Testes automáticos: o que é só Windows não roda no Mac; atalhos trocam Ctrl/Cmd. Teste manual
  num Mac: instalar, login, voz, câmera, tela, notificações, aviso de versão nova.

## 3.22 Câmeras do overlay e GIF no perfil ✅ concluído (teste manual pendente)
### Parte A: câmeras do overlay personalizáveis ✅ concluída (teste manual pendente)
Escolhas em [ADR 0042](0042-overlay-cameras.md). Sem mudança na API e sem migração.
Por que só a quantidade na vertical parecia funcionar (código da beta.9): a caixa tinha tamanho fixo
e cortava o que sobrava; a coluna nunca quebrava, então esticar a caixa só mostrava ou cortava
câmeras; cada câmera ficava limitada à largura da caixa (Grande ≈ Médio na caixa padrão); e o modo
edição mostrava uma câmera de exemplo só, então horizontal e vertical ficavam iguais.
Feito: Vertical, Horizontal e Grade (com câmeras por linha); largura contínua de 96 a 360 px com
Pequeno/Médio/Grande como atalhos (as larguras de antes); máximo de 1 a 8 com "+N" na última câmera e
quem fala sempre visível; espaço entre as câmeras e cantos arredondados. A caixa é calculada a partir
das câmeras e fica presa no canto da tela mais próximo de onde foi deixada. Se não couber no monitor,
as câmeras encolhem. No modo edição: câmeras de exemplo até o máximo, barra com formato e quantidade,
e a alça muda o tamanho das câmeras.

#### Teste manual da parte A (duas contas, câmera ligada nas duas; jogo em janela sem borda)
1. Quem já usava: depois de atualizar, o widget de câmeras continua no mesmo lugar, com o mesmo
   formato e tamanho (Pequeno/Médio/Grande); opacidade e ligado/desligado iguais.
2. Configurações › Overlay › Câmeras: cada formato com 1, 3 e 8 câmeras na prévia (máximo 1, 3, 8);
   largura no mínimo e no máximo; espaço 0 e 16; cantos retos. A prévia acompanha na hora.
3. Na call, sobre o jogo: a caixa cresce e encolhe quando alguém liga ou desliga a câmera, a partir do
   canto onde está (testar presa em cima à esquerda e embaixo à direita). Nada cortado.
4. Máximo 1 com duas câmeras: aparece uma com "+1"; a outra pessoa fala e passa a aparecer (as duas,
   se as duas falarem); para de falar e, ~1,5 s depois, volta a ficar só uma.
5. Ctrl+Shift+F10: com ninguém de câmera aparecem câmeras de exemplo até o máximo; a barra troca o
   formato e a quantidade (e por linha, na grade); puxar a alça muda o tamanho das câmeras e a caixa
   acompanha; arrastar move. Esc termina. Reabrir o app: tudo continua.
6. Câmeras grandes na horizontal com 8: as câmeras encolhem pra caber no monitor.
7. Dois monitores: cada um guarda a sua posição; o canto de cada um vale lá.
8. O destaque de quem fala nas câmeras continua igual.

- Hoje (relato do Eduardo, 06/11): na prática só dá pra mudar quantas câmeras aparecem na vertical.
  Primeiro conferir no app instalado (beta.9) se as opções "horizontal/vertical" e "tamanho" do 3.14
  estão chegando no widget; se não, me explicar o porquê antes de mexer.
- NÃO mudar o destaque de quem está falando no widget de câmeras: está certo como está.
- Configurações › Overlay › Câmeras (com prévia ao vivo) e também no modo edição (Ctrl+Shift+F10):
  - Formato: Vertical (coluna), Horizontal (linha) ou Grade.
  - Tamanho de cada câmera: controle deslizante contínuo (ex: de ~96 a ~360 px de largura,
    proporção 16:9), além dos atalhos Pequeno/Médio/Grande.
  - Quantidade: máximo de câmeras visíveis (1 a 8) e, na Grade, quantas por linha. Passou do
    máximo: "+N" no fim, e quem está falando sempre entra na lista visível.
  - Espaço entre as câmeras e cantos arredondados (opcional, se for simples).
- O tamanho da caixa do widget acompanha o formato, o tamanho e a quantidade (cresce e encolhe
  sozinho, a partir do canto onde ele está preso); no modo edição, arrastar a borda muda o tamanho
  das câmeras em vez de esticar a caixa vazia.
- Salvo por monitor junto com as posições do 3.14; preferências antigas migram sem perder nada.
- Testes: cada formato com 1, 3 e 8 câmeras; tamanho mínimo e máximo; "+N" quando passa do
  máximo; quem fala entra mesmo além do limite; caixa acompanha; preferências antigas preservadas.

### Parte B: GIF no avatar e no banner do perfil ✅ concluída (teste manual pendente)
Feito (08/11; ADR 0044): os termos atuais do Klipy (integration-requirements) proíbem guardar,
espelhar ou re-hospedar a mídia sem aprovação por escrito, então valeu o caminho da REFERÊNCIA: a API
guarda só o GIF (URLs como o Klipy deu) e o recorte, sem MinIO nem migração; cada app carrega do
Klipy e aplica o recorte na exibição. Apps antigos veem o GIF (ou a still, se for MP4) sem recorte.
Overlay e cursores do Quadro mostram o GIF sem recorte (só recebem a URL).
- No Editar perfil, clicar em "Trocar avatar" ou "Trocar banner" abre um menu com duas opções:
  "Enviar imagem" (abre o seletor de arquivos do computador, como hoje) e "Escolher um GIF" (abre o
  seletor de GIFs do chat, do Klipy, com busca, Em alta e Favoritos).
- Depois de escolher o GIF, segue o mesmo fluxo do 3.10: editor de recorte (posição e zoom), prévia
  no cartão e Salvar.
- Termos do Klipy (ADR 0034): eles proíbem proxy e cache nossos sem aprovação por escrito. ANTES de
  implementar, reler os termos atuais do Klipy sobre usar um GIF como imagem de perfil e me explicar
  o que pode:
  - Se puder guardar uma cópia: o GIF é baixado pela API e passa pelo mesmo recorte do 3.10
    (animação mantida), igual a um upload.
  - Se NÃO puder: guardar só a referência do Klipy (id e URL) mais o recorte, e cada app carrega o
    GIF direto do Klipy, com o recorte aplicado na exibição (sem cópia no MinIO). Se o GIF sumir do
    Klipy, mostra as iniciais/banner padrão.
  - Nunca baixar e guardar GIF do Klipy sem a confirmação de que os termos permitem.
- Mesma checagem de conteúdo dos GIFs do chat (filtro mais seguro do provedor).
- Testes: menu com as duas opções no avatar e no banner; GIF escolhido passa pelo recorte e fica
  animado no cartão, no chat e na lista de membros; upload do computador continua igual; GIF que
  sumiu do provedor cai no padrão.

## 3.23 Tela de carregamento ao abrir (moeda girando) ✅ (teste manual pendente)
- Ao abrir o app (pelo atalho ou junto com o Windows), aparece primeiro uma janelinha de
  carregamento própria: sem moldura, fundo escuro do tema, cantos arredondados, centralizada
  (~300×360), com o logo do Aureum girando no eixo vertical como uma MOEDA (rotateY em 3D, com
  frente e verso, brilho dourado sutil) e um texto curto embaixo.
- Textos, na ordem em que acontecem: "Procurando atualizações…", "Baixando atualização (N%)…",
  "Conectando…", "Abrindo o Aureum…". Sem internet: "Sem conexão, abrindo mesmo assim…".
- Enquanto a tela gira, a janela principal carrega escondida; quando ela fica pronta (login
  restaurado e primeira conexão com a API, ou falha), a tela some com fade e a janela principal
  aparece no mesmo lugar e tamanho de sempre.
- Tempo: mínimo de ~1,2 s (pra não piscar) e máximo de ~10 s; passou disso, abre de qualquer jeito
  (o app já sabe lidar com API fora do ar).
- Atualização (mesmo canal do ritual de release): a tela procura versão nova com limite de ~5 s.
  Se tiver, baixa com a porcentagem e reinicia já na versão nova antes de abrir. Se a verificação
  ou o download falhar, segue abrindo normal e tenta de novo depois, como hoje. Nunca trava a
  pessoa na tela de carregamento. Em dev, não procura atualização.
- Inicialização com o Windows: hoje o app abre escondido na bandeja (--hidden). Passa a ser uma
  escolha em Configurações › Windows (ou onde está o "Abrir com o Windows"): "Ao ligar o PC: abrir a
  janela" (padrão, com a tela de carregamento) ou "Iniciar na bandeja" (sem tela, como hoje).
  Quem já tem o "Abrir com o Windows" ligado passa pro padrão novo.
- Uma instância só: abrir o app de novo com ele aberto só traz a janela pra frente (sem outra tela).
- prefers-reduced-motion: no lugar do giro, o logo só pulsa de leve.
- Logo: o oficial (docs/design/brand), em SVG; a tela é um HTML local leve, sem React pesado, pra
  aparecer na hora. No Mac (3.21), a mesma tela.
- Testes: a tela aparece e some sozinha; tempo mínimo e máximo; falha de rede segue abrindo; com
  atualização falsa (servidor de update de teste) mostra a porcentagem e reinicia; verificação que
  passa do limite segue abrindo; "Iniciar na bandeja" não mostra a tela; segunda instância só foca;
  reduced-motion troca o giro.

## 3.16 Tour e dicas
Objetivo: quem chega do Discord entender o layout próprio do Aureum sem se perder.
Guia do tour: o logo oficial (o mascote é ideia futura, em FUTURO.md).
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
3. Início: seu hub (quem está ao vivo, seus servidores, o que você perdeu, suas tarefas e o
   calendário de todos os servidores); amigos e DMs na barra lateral.
4. Barra lateral do servidor: categorias com salas, conversas e addons; dá pra recolher.
5. Visão geral do servidor: salas ao vivo, quem tá falando e transmitindo, próximos eventos.
6. Painéis: abra até 4 coisas ao mesmo tempo (chat, call, Kanban...). Arraste um canal
   pra borda de um painel ou use "Dividir".
7. Addons: Kanban, Quadro, Eventos e Calendário (o calendário junta prazos e eventos).
8. Perfil (avatar no topo): ver e editar perfil (com Conta), status, configurações e "Reportar
   problema" (Ctrl+Shift+R). O sino ao lado mostra notificações e as novidades de cada versão.
   Na call, "Destacar" leva a chamada pra uma janela própria, por cima de tudo.
Fim: "Pronto! Quando você usar algo pela primeira vez, a gente mostra uma dica."
Passos 4 a 7 abrem o servidor oficial; se a pessoa não estiver em nenhum servidor, pular.

### Dicas de primeira vez (balão único, "Entendi" fecha pra sempre)
- Primeira call: barra de controles, setinha de áudio (trocar mic, saída e câmera),
  Foco/Grade, janelinha flutuante.
- Primeira transmissão de alguém: "Assistir" pra entrar na live.
- Primeira vez assistindo uma tela: tela cheia, botão de sair e volume da transmissão.
- Primeiro compartilhamento: modos "Texto nítido" e "Movimento".
- Primeira call com overlay: só aparece em jogos, widgets separados, editar posição e o
  formato das câmeras.
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

## 3.18 Migração para a VPS da Hostinger ✅ virada feita em 27/10 (faltam os itens 8 e 10)
Contexto: em 26/10 a voz parou (o plano grátis do LiveKit Cloud estourou os 5.000 min do mês)
e a VM da Oracle não saiu. Decisão do Eduardo: VPS paga Hostinger KVM 4 (4 vCPU, 16 GB, datacenter
Brasil), custo dividido com os sócios, e abrir o beta a mais gente depois. A Oracle fica como
possibilidade futura de reduzir custo. Endereço técnico provisório: aureum-voice.duckdns.org (grátis).
A marca e o domínio próprio são decisão à parte e NÃO bloqueiam este bloco.

Regras deste bloco:
- Nenhum bloco a partir do 3.12 e nenhuma release antes disto, exceto a 0.2.0-beta.8 daqui.
- Valem as regras de produção do cabeçalho: backup com data no nome, mostrar o comando de
  restauração, e comandos que mexem no PC de produção só rodam com OK do Eduardo. Na VPS nova (ainda
  sem usuários) a preparação pode rodar direto. Nunca apagar nada do PC antes de o Eduardo mandar.
- Segredos só no .env (da VPS), nunca no repositório, nunca impressos nem colados no chat.

### 0. Docs e regras (um commit)
- CLAUDE.md: exceção de custo para o servidor pago (VPS Hostinger, dividida) e para o DuckDNS grátis;
  o resto da regra de R$0 continua. Marcar Tailscale Funnel e LiveKit Cloud como "a desligar".
- docs/decisions/0036-vps-deploy.md: escolhas de deploy (Caddy, LiveKit self-hosted, firewall).
- Status do PHASE3: "Próximo: 3.18, depois 3.12".

### 1. VPS pronta (Eduardo contrata; o resto via SSH)
- Eduardo: contratar KVM 4, Brasil, Ubuntu limpo, chave SSH cadastrada. Me passar só o IP.
- Usuário comum com sudo, login de root e senha por SSH desligados, chave só.
- Firewall (ufw e o da Hostinger): só 22, 80, 443, 7881/tcp e a porta UDP do LiveKit.
- Atualizações automáticas de segurança, fail2ban, Docker e compose, fuso de São Paulo, rotação
  de logs do Docker.

### 2. Endereço e HTTPS
- Eduardo aponta o DuckDNS aureum-voice para o IP da VPS.
- Testar se subníveis funcionam (api. e live.). Se não, criar um segundo nome no DuckDNS só para o
  LiveKit e dizer qual foi usado.
- Caddy com HTTPS automático na frente da API (e do LiveKit, se o subnível servir).

### 3. Compose de produção
- infra/docker-compose.prod.yml (ou override) com Caddy, API, Postgres, Redis, MinIO e LiveKit.
- Só Caddy e LiveKit publicam portas; Postgres, Redis e MinIO nunca saem do localhost.
- restart: unless-stopped e healthchecks. O compose de dev não muda.

### 4. LiveKit self-hosted
- livekit.yaml de produção: sem --dev, chaves novas, use_external_ip ligado, porta UDP única ou faixa
  larga (propor e justificar).
- Avaliar o TURN embutido (para quem está atrás de firewall rígido) e perguntar antes de ligar.
- API com LIVEKIT_URL=wss://... e LIVEKIT_API_URL interno. O app não precisa de update para isso,
  porque a URL da mídia vem da API junto com o token.
- Teste: call de 2 pessoas em redes diferentes (uma delas no 4G), com câmera e tela com som.

### 5. Backup e ensaio
- pg_dump com data no nome + cópia dos arquivos do MinIO (avatares, anexos, sons, figurinhas).
- Conferir se algo durável mora no Redis (ex: tokens, convites); se sim, migrar também.
- Restaurar uma CÓPIA na VPS, rodar `alembic upgrade head` e testar o app apontando para o endereço
  novo (a tela de login deixa trocar a URL). Mesmo segredo JWT do PC, para ninguém ser deslogado.

### 6. Modo "mudamos de servidor" na API do PC
- Variável nova (ex: SERVER_MOVED_TO). Ligada, a API responde 503 com mensagem legível ("O Aureum
  mudou de servidor. Atualize o app.") em tudo menos no health, e o WebSocket fecha com o mesmo aviso.
- /convite/{codigo} redireciona (301) para o endereço novo, para os links já enviados não quebrarem.
- Não pode quebrar o app da versão anterior (erro legível, não genérico).
- Testes.

### 7. Release 0.2.0-beta.8 (só o necessário; rascunho, NÃO publicar ainda)
- Endereço padrão novo. Se o endereço salvo no app for o antigo (*.ts.net do Funnel), troca sozinho
  pelo novo; endereços personalizados ficam como estão.
- CSP da landing (site/index.html) com o endereço novo.
- CHANGELOG em linguagem simples ("o Aureum mudou de servidor, atualiza e segue normal").
- Confirmar que um app beta.7.b instalado encontra a beta.8.

### 8. Monitoramento e carga
- Script simples que mostra CPU, RAM, disco, tráfego do mês e containers.
- Backup diário automático (7 dias de retenção na VPS) e comando para copiar para o PC do Eduardo.
- Teste de carga com `lk load-test`, rodando de OUTRA máquina e em escala pequena, para saber a folga.

### 9. Virada (janela curta, o Eduardo avisa os testers antes)
1. Parar a API no PC (Postgres continua ligado).
2. Dump final + espelho do MinIO, copiar para a VPS, restaurar e `alembic upgrade head`.
3. Subir tudo na VPS e validar: login, mensagem, anexo, voz em 2 redes, tela com som.
4. Se der certo: publicar a beta.8 e ligar o modo "mudamos" no PC (Funnel continua no ar).
5. Se falhar: religar a API no PC (nada foi apagado), investigar e tentar de novo.

### 10. Depois
- PC e Funnel ficam alguns dias só para quem não atualizou. Depois, com OK do Eduardo, desligar o
  Funnel e o LiveKit Cloud. Backups do PC ficam guardados por 30 dias.

## Pronto quando (3.18)
- App rodando na VPS, voz com 2 redes diferentes funcionando, sem depender do PC do Eduardo.
- beta.8 publicada e um app antigo atualiza sozinho para o endereço novo.
- Backup diário rodando e restauração testada. PC e Funnel só como ponte.

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
- ✅ 20 Pioneiros no máximo; todos os testers com Beta Tester.
- ✅ (teste pendente) Quadro branco, Enquetes, Eventos e Calendário (juntando
  Kanban e Eventos) funcionando.
- ✅ (falta produção e teste manual) Perfil editado direto do cartão, com recorte de avatar e banner
  (inclusive GIF).
- Reações, emojis, figurinhas, visto nas DMs e preview de links no chat.
- Categorias livres com permissões, inclusive categoria só pra admins.
- Até 4 painéis por servidor.
- Overlay com widgets separados de voz, câmeras (horizontal/vertical) e notificações.
- ✅ Painel de sons funcionando na call, exclusivo de cada servidor.
- Conta nova faz o tour inicial; dicas aparecem uma vez em cada recurso.
- App rodando na VPS da Hostinger, sem depender do PC do Eduardo.
- Tiles da call com anel inteiro e vídeo sem corte; inventário de insígnias rola no cartão.
- ✅ Painel de sons tocando na VPS, com recorte de áudio maior.
- Ligar a câmera não troca o microfone; modo compatível pra quem não capta.
- Perfil e Conta só no Editar perfil.
- Início com calendário de todos os servidores; novidades no sino.
- Abas dos painéis reordenáveis.
- Arrastar a janelinha nunca arrasta a foto; imagem interna nunca vira anexo.
- Call destacada numa janela própria, sempre por cima, sem segunda conexão.
- Diagnóstico de áudio no Reportar problema; câmera não troca o microfone; estado real da
  supressão de ruído em Configurações › Voz.
- Instalador para macOS (com ou sem assinatura, conforme decisão do Eduardo).
- Câmeras do overlay: horizontal, vertical ou grade, tamanho e quantidade configuráveis.
- Avatar e banner do perfil: enviar imagem ou escolher um GIF, no mesmo menu.
- Ao abrir, tela de carregamento com o logo girando como moeda; procura atualização e abre sozinha.
- Overlay nunca aparece (nem como quadrado preto) na transmissão de quem está com ele.
- Botão direito na imagem: copiar e salvar.
- Volume de cada transmissão salvo por pessoa, com padrão configurável.
- Chat nunca rola pro lado: textos e links longos quebram a linha.

Ideias futuras (identidade visual, mascote, backlog): docs/decisions/FUTURO.md. Não fazer na Fase 3.
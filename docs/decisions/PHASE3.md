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
0.2.0-beta.5. 3.5 pronto no código, ainda sem release (a API sobe sem migração). Testes manuais
pendentes listados no 3.1, no 3.2, no 3.4 e no 3.5.
Próximo: 3.5 (Reordenar canais).

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
- Antes do release: confirmar que um app da versão anterior instalado vai encontrar a nova.
- Versão segue 0.2.0-beta.N. CHANGELOG em linguagem simples (vai pra galera do beta).
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
- Overlay só em jogo: nome do executável em primeiro plano via koffi, lista de exceções e
  "Ocultar overlay neste app".
- Transmissão em tela cheia: botão de sair, controles e cursor somem parados, duplo clique.
Teste manual pendente: bandeja em 100/125/150% e barra clara/escura; Vivaldi maximizado e
em tela cheia sem overlay; LoL sem borda com overlay.

## 3.2 Microfone ✅ concluído (teste manual pendente)
Ver docs/decisions/0020-mic-pipeline.md. Microfone pedido com 1 canal a 48 kHz, RNNoise
sempre em 48 kHz, canal único escolhido pelo nível, getSettings nos logs; Configurações ›
Voz com teste de mic, "Ouvir minha voz", liga/desliga dos processamentos, sensibilidade e
aviso de Bluetooth.
Teste manual pendente: headset Havit do prado (voz sem efeito de túnel) e mic forçado em
44.1 kHz, 16 kHz e 2 canais.

## 3.3 Bot oficial @aureum ✅ concluído (ligado em produção)
Ver docs/decisions/0021-official-bot.md. Módulo na API com textos em app/bot/mensagens.toml;
boas-vindas e bug resolvido no servidor oficial; DM oficial só leitura com categorias
(segurança, insígnias, bugs, convites, novidades, avisos) e Configurações › Notificações;
CLI bot status/enable/disable/set-channel/say/broadcast (fila, ritmo, retomada);
"Fechar (não é bug)"; @aureum sem amizade, bloqueio ou convite; nomes parecidos com
"Aureum" recusados.
Canais do servidor oficial configurados e ações ligadas pela CLI.

## 3.4 Início: hub ✅ concluído (teste manual pendente)
Ver docs/decisions/0022-home-hub.md. Ao vivo, Amigos ativos e Seus servidores vêm dos stores já
carregados; GET /users/me/home traz menções, DMs não lidas, tarefas e a última atividade dos
servidores. Tarefas pelo hook AddonManifest.assigned; home.watch (até 6 servidores) para as
miniaturas; VoiceState.joined_at; user_settings.news_dismissed; CHANGELOG embutido no app.
Teste manual pendente: hub com o beta de verdade (salas, transmissão com miniatura, menção,
DM com mensagem de voz, chamada perdida, pedido de amizade, tarefa com prazo) e janela abaixo
de 1000px.
Ajuste depois da 0.2.0-beta.4: "Seus servidores" saiu da coluna lateral e virou uma grade compacta
ao lado do "Ao vivo agora" (item 6 abaixo); a coluna lateral ficou com Amigos ativos e Novidades.

Referência visual: docs/design/home/inicio-hub.png (mockup aprovado). Seguir o layout,
os tokens do 2.1 e as fontes; os nomes no mockup são exemplos.
Objetivo: o Início deixa de abrir na lista de amigos e vira um hub com o que importa agora.

### Barra lateral do Início
- Itens: "Início" (o hub, selecionado ao abrir) e "Amigos" (a tela de amigos atual, com
  contador de pedidos pendentes).
- Mensagens diretas e grupos continuam embaixo, como hoje (a DM oficial "Aureum" fixa no topo).

### Seções do hub (de cima pra baixo)
1. Saudação: "Bom dia / Boa tarde / Boa noite, {nome}" pelo horário local. Subtítulo
   dinâmico: "N amigos em call agora e N coisas esperando por você"; sem nada: "Tudo em
   dia por aqui." Ações rápidas: Iniciar chamada (botão accent; abre seletor de amigo ou
   grupo), Adicionar amigo, Criar servidor, Entrar com convite.
2. Ao vivo agora: cards das salas de voz com gente nos servidores do usuário (só as que
   ele pode ver e entrar: VIEW_CHANNEL e CONNECT) e das calls de grupo em andamento das
   quais ele faz parte.
   - Card: miniatura da tela em baixa resolução com selo "AO VIVO" quando alguém
     transmite (mesma miniatura do 2.L); senão, avatares grandes. Nome da sala,
     servidor · "fulano transmitindo" ou "N pessoas · tempo", avatares com anel em quem
     fala, botão Entrar.
   - Ordem: onde tem amigos primeiro, depois mais gente. Até 6 cards + "Ver mais".
   - Último card tracejado: "Chamar alguém". Ninguém em call: só esse card e o texto
     "Ninguém em call agora."
3. Pra você ver: menções (servidores e grupos), DMs não lidas (agrupadas por pessoa, com
   contagem e prévia; mensagem de voz aparece como "Mensagem de voz · 0:42"), chamadas
   perdidas (botão Ligar) e pedidos de amizade (Aceitar / Recusar). Ordem por tempo, até
   8 itens + "Ver tudo". "Marcar tudo como lido". Clicar abre a conversa no ponto da
   mensagem. Vazio: "Nada pendente por aqui."
4. Minhas tarefas: cards do Kanban com o usuário como responsável, ainda não concluídos,
   de TODOS os servidores que ele vê. Ordem: atrasados, prazo mais próximo, sem prazo.
   Card com etiquetas, coluna atual, prazo (atrasado em danger; até 2 dias em idle) e o
   caminho "servidor › quadro". Até 6 + "Ver todas" (lista completa). Clique abre o card
   no addon. Vazio: "Nenhuma tarefa com você."
   - O módulo Kanban continua sem depender de servidor: a agregação é uma rota que lista
     as workspaces que o usuário pode ver e pede ao addon os cards dele, respeitando
     permissões.
5. Amigos ativos (coluna lateral): amigos online/ausentes, em call primeiro, depois
   jogando, depois disponíveis; atividade do 2.5 ("Jogando X"). Botão conforme o caso:
   Entrar (em call numa sala que o usuário vê), Ligar ou Mensagem. Até 6 + "Ver todos"
   (abre Amigos). Invisível e offline não aparecem.
6. Seus servidores (ao lado do "Ao vivo agora", na mesma linha e na largura da coluna lateral;
   abaixo de ~1000px desce para baixo dele): grade compacta com ícone +
   nome, bolinha vermelha quando alguém transmite, contador de pessoas em call e badge de
   menções, ordenada por atividade. Clicar abre a aba do servidor e a reabre se estava fechada
   (é por aqui que a pessoa recupera abas fechadas). Último item "+": o mesmo fluxo de
   criar/entrar em servidor do topo. Até 6 + "Ver todos" (lista completa num modal). Em janela estreita a grade quebra
   em mais linhas, sem rolagem lateral.
7. Novidades do Aureum (coluna lateral, borda accent sutil): versão instalada e 3 itens do
   CHANGELOG local do app; "Ver tudo que mudou" abre o CHANGELOG num modal. Dá pra
   dispensar; volta na próxima versão.

### Técnica
- Carga inicial por uma rota única (ex: GET /me/home) e atualizações pelos eventos de
  WebSocket que já existem (sem polling).
- Miniaturas só nos cards visíveis; o hub não pode pesar mais que a Visão geral de um servidor.
- Responsivo: abaixo de ~1000px a coluna lateral (Amigos ativos e Novidades) vai pra baixo da
  principal.
- Estados de carregamento (esqueleto) e vazio em todas as seções.

### Testes
Rota /me/home respeita permissões (sala privada não aparece, card de Kanban de canal sem
acesso não aparece); ordenações; estados vazios; "Marcar tudo como lido"; aceitar/recusar
pedido pelo hub; Entrar numa sala pelo card; atualização em tempo real ao alguém entrar
numa call.

## 3.5 Reordenar canais ✅ concluído (teste manual pendente)
Ver docs/decisions/0023-channel-order.md. PUT /servers/{id}/channels/order por seção, canais
ocultos mantêm o lugar, evento channels.reordered só com o que cada um vê; arrastar na barra
lateral com indicador e "Mover para cima/baixo" no menu do canal.
Teste manual pendente: arrastar nas três seções com duas pessoas online (a outra vê na hora),
canal privado entre os arrastados e arrastar um canal para o painel continua funcionando.

- channels.position já existe (e a rota de edição do canal aceita position); falta a
  reordenação em lote e a interface.
- Quem tem MANAGE_CHANNELS arrasta e solta canais na barra lateral para mudar a ordem,
  dentro de cada seção (SALAS, CONVERSAS, ADDONS). Indicador visual de onde o canal vai cair.
- Alternativa sem arrastar (acessibilidade e precisão): menu de contexto do canal com
  "Mover para cima" e "Mover para baixo".
- A ordem é do servidor (igual para todos). Rota única que recebe a lista ordenada de ids
  da seção e salva tudo numa transação.
- Atualização em tempo real via WebSocket (evento channels.reordered) para todos os membros.
- A mesma ordem vale em todo lugar: barra lateral, Visão geral (cards de salas e
  Novidades), busca e o hub do Início.
- Quem não tem MANAGE_CHANNELS não consegue arrastar (nem pela API).
- Canais privados que a pessoa não vê não aparecem, mas mantêm a posição para quem vê.
- Testes: reordenar salva e chega em tempo real; sem permissão a API recusa; lista com
  id de outro servidor ou faltando canal é recusada.

## 3.6 Áudio dentro da call
- Setinha ao lado dos botões de microfone e fone na barra da call abre um popover:
  entrada, saída, volume de entrada e de saída, modo (Detecção de voz / Pressionar para
  falar), sensibilidade e link para Configurações › Voz (reaproveitar o que o 3.2 criou).
- Troca de dispositivo sem sair da call (LiveKit switchActiveDevice para audioinput e
  audiooutput), mantendo o pipeline de 1 canal a 48 kHz do 3.2. Escolha salva como
  preferência.
- Ouvir devicechange: headset conectado aparece na hora; se o dispositivo em uso sumir,
  cai pro padrão do Windows com aviso discreto.
- Testes: trocar entrada e saída em call, dispositivo removido no meio da call.

## 3.7 Insígnias
- Pioneiro limitado aos 15 primeiros: AUREUM_PIONEER_LIMIT=15 no .env (números
  reservados contam). Atingido o limite, não concede mais, mesmo com AUREUM_BETA=true.
  Números já concedidos não mudam.
- Nova insígnia "Beta Tester" (LENDÁRIA, não numerada, exclusive_beta): concedida na
  confirmação do e-mail enquanto AUREUM_BETA=true. Pioneiros também recebem. Retroativa
  para todas as contas não oficiais já existentes (comando mostrado antes). Nunca mais
  concedida depois do beta. Ícone: SVG próprio, placeholder de frasco de laboratório.
- A concessão manda a DM da categoria insignias do bot (com deduplicação).
- Descrições (tooltip e cartão):
  - Fundador: "Criou o Aureum. Tudo começou aqui."
  - Pioneiro: "Um dos 15 primeiros a chegar no Aureum."
  - Beta Tester: "Testou o Aureum no beta e ajudou a moldar o app."
  - Caçador de bugs: "Encontrou um bug de verdade e ajudou a corrigir."
  - Veterano: "Faz parte do Aureum há mais de um ano."
  - Construtor: "Criou um servidor com 5 ou mais membros."
  - Aureum+: "Apoia o Aureum com o plano Aureum+."
- Testes: limite do Pioneiro (inclusive concorrência no nº 15), Beta Tester na
  confirmação e retroativa, conta oficial não recebe nenhuma das duas.

## 3.8 Perfil: edição fora das Configurações e recorte de imagens
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

## 3.9 Chat: emojis, reações e figurinhas
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

### Testes
Seletor e autocompletar; reagir/desfazer em tempo real; permissões de reação; limite de 20;
figurinha só no próprio servidor (inclusive via API); limites de arquivo; permissões novas.

## 3.10 Addon Quadro branco
- Addon "Quadro" (addon_key whiteboard) no framework do 2.8. Como o Kanban, sem
  dependência direta de servidor além de workspace_id (pode virar produto junto dele).
- Base: Excalidraw (MIT) embutido; perguntar antes. Desligar qualquer recurso de IA da
  biblioteca (princípio do produto). Fontes e arquivos empacotados no app, nada de CDN.
- Ferramentas: caneta livre, formas, setas, texto, nota adesiva, imagem, borracha,
  seleção, cores, desfazer/refazer, zoom e mover; fundo liso ou quadriculado.
- Vários quadros por canal: lista com nome, miniatura e "editado por X há Y"; criar,
  renomear, duplicar e arquivar.
- Tempo real via WebSocket (sincronização por elemento com versão), cursores com nome e cor
  de quem está no quadro, e "seguir" alguém.
- Salvamento automático (debounce ~1s e ao sair): cena em jsonb na tabela
  addon_whiteboard_boards; imagens no MinIO, nunca base64 na cena. Histórico: snapshot a
  cada ~10 min de edição, com "Restaurar esta versão".
- Permissões: ver com VIEW_CHANNEL; editar com a permissão do addon "Editar quadro"
  (padrão: permitido ao @everyone, ajustável por cargo e canal).
- Exportar PNG/SVG e "Copiar como imagem" pra colar no chat.
- Linha de sistema no chat: "@fulano criou o quadro X". Card na Visão geral com a
  miniatura do último quadro editado. No hub do Início, "Seus servidores" pode mostrar
  "Quadro editado há X".
- Limites: cena até ~5 MB; imagens até 10 MB cada.
- Testes: duas pessoas desenhando ao mesmo tempo sem perder traço; salvamento e reabertura;
  restaurar versão; sem permissão não edita (inclusive via API); exportar.

## 3.11 Painel de sons
Nome na interface: "Painel de sons" (não usar "Soundboard" nem "Soundpad").
- Sons por servidor: máx 5s, máx 1 MB, mp3/ogg/wav, até 24 por servidor; nome e volume
  padrão. Duração validada no servidor (dependência nova: perguntar antes, licença
  permissiva). Armazenados no MinIO.
- Permissões novas: USE_SOUNDBOARD (padrão: permitido ao @everyone) e MANAGE_SOUNDBOARD.
- Botão na barra da call abre a grade de sons. Toca como TRACK DE ÁUDIO SEPARADA no
  LiveKit, nunca misturada no microfone (não passa pela supressão de ruído). Precisa de
  SPEAK; não toca se o usuário estiver mutado pelo servidor.
- Anti-spam: 1 som por vez por usuário, cooldown de 3s.
- Cada pessoa: volume do painel de sons (0–100%) e "Silenciar sons dos outros".
- Testes: limites de arquivo e duração, permissões, cooldown, silenciar.

## 3.12 Painéis: até 4 por servidor
Base: painéis do 2.L (hoje até 2, abertos arrastando). Ampliar para até 4, por servidor.

### Formatos
- 1 painel; 2 (lado a lado ou empilhados); 3 (um grande + dois empilhados, ou três
  colunas); 4 (grade 2×2). O usuário monta o que quiser, de 1 a 4.
- Layout guardado como árvore de divisões (horizontal/vertical), no máximo 4 painéis.

### Abrir e fechar
- Arrastar (jeito principal, estendendo o que já existe): arrastar um canal da barra lateral
  ou uma aba para a borda esquerda, direita, de cima ou de baixo de um painel. Área
  destacada mostra onde ele vai cair. Soltar no meio abre como aba naquele painel.
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

## 3.13 Tour e dicas
Objetivo: quem chega do Discord entender o layout próprio do Aureum sem se perder.
Guia do tour: espaço reservado para o mascote (3.14); até lá, usar o logo oficial.
Fazer por último na fase (depois do 3.12), pra não ter que refazer a cada mudança de layout.

### Motor
- Componente próprio de tour: escurece a tela, destaca o elemento (spotlight) e mostra um
  balão com o guia, título, texto curto, "Próximo", "Voltar", "Pular" e progresso (ex: 3/7).
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
3. Início: seu hub (quem está ao vivo, o que você perdeu e suas tarefas); amigos e DMs
   na barra lateral.
4. Barra lateral: salas, conversas e addons do servidor; dá pra recolher.
5. Visão geral do servidor: salas ao vivo, quem tá falando e transmitindo; clique pra entrar.
6. Painéis: abra até 4 coisas ao mesmo tempo (chat, call, Kanban...). Arraste um canal
   pra borda de um painel ou use "Dividir".
7. Perfil (avatar no topo): ver e editar perfil, status, configurações e "Reportar problema"
   (Ctrl+Shift+R).
Fim: "Pronto! Quando você usar algo pela primeira vez, a gente mostra uma dica."
Passos 4 a 6 abrem o servidor oficial; se a pessoa não estiver em nenhum servidor, pular.

### Dicas de primeira vez (balão único, "Entendi" fecha pra sempre)
- Primeira call: Foco/Grade, setinha de áudio (trocar mic e saída), janelinha flutuante.
- Primeira vez assistindo uma tela: tela cheia, botão de sair e volume da transmissão.
- Primeiro compartilhamento: modos "Texto nítido" e "Movimento".
- Primeira call com overlay disponível: atalho, editar posição, funciona em janela sem borda.
- Primeiro servidor criado: cargos, canal privado, convites e reordenar canais arrastando.
- Primeiro addon aberto (Kanban): o que é e como criar cards.
- Primeiro quadro: ferramentas, cursores dos outros e exportar.
- Primeira reação: passar o mouse na mensagem.
- Painel de sons: como tocar e silenciar os sons dos outros.
- Primeira mensagem da DM oficial: "Esta é a conversa oficial do Aureum: avisos, segurança
  e novidades. A gente nunca pede sua senha."
- Primeiro clique com botão direito em alguém: menu de contexto.
- Push-to-talk ao ativar: onde configurar o atalho.

### Testes
Tour começa sozinho só em conta nova; convite único em conta antiga; pular e Esc salvam
como visto; "Rever tour" funciona; progresso segue entre PCs; versão nova mostra só os
passos novos; cada dica aparece uma vez só; passos de servidor pulados sem servidor.

## 3.14 Identidade visual (prazo: fim de 2026)
NÃO começar sem spec detalhada do Eduardo. Escopo previsto:
- Logo final (o atual é o oficial até lá; trocar tudo via npm run build:icons).
- Revisão de cores e tokens do 2.1.
- Mascote da marca (ideias em aberto: abelha "Zum", "Pepita", vaga-lume "Lume"),
  original de verdade, legível de 24px a ilustração grande. Usos: guia do tour (3.13),
  estados vazios, carregamento, erro de conexão, e-mails, figurinhas.

## 3.15 Migração para a Oracle (quando a VM estiver pronta)
NÃO começar sem spec detalhada. Escopo previsto: VM A1 Always Free (PAYG com tudo grátis
e alerta de gasto), API + Postgres + Redis + MinIO + LiveKit na VM, HTTPS, migração dos
dados com backup e janela de manutenção avisada pela @aureum, troca de URLs no app sem
quebrar instalações existentes (inclusive a landing no GitHub Pages), fim do Tailscale
Funnel e do LiveKit Cloud.

## Backlog (não fazer agora)
- Convite de grupo do WhatsApp (invites create --usos 15 --dias 7), passo 6 pendente do
  lançamento; a landing page já está no ar, então só falta gerar com OK do Eduardo.
- Categorias de canais criadas livremente pelo dono do servidor.
- "Área de trabalho": painéis misturando canais de servidores diferentes.
- Emojis próprios por servidor (além das figurinhas).
- Addon "Jogos Riot": status rico de LoL e TFT pela API local do cliente (lobby, fila,
  seleção, em partida), "chamar pro duo"; depois elo, resumo pós-partida opt-in e ranking
  do grupo pela API web (chave registrada no portal da Riot, sempre pela nossa API, nunca
  no app); VALORANT só com chave de produção + login Riot (RSO). Nunca ler memória do
  jogo nem dar vantagem dentro da partida.
- Distribuição na Microsoft Store (MSIX) para tirar o aviso do SmartScreen no lançamento
  público; reservar o nome "Aureum" no Partner Center.
- Login com Google e Discord; importar servidores do Discord.
- Bot: anúncio automático de release, marcos de pioneiros, comandos /ajuda, /convites e
  /status, tirar a @aureum dos servidores depois do beta, bots externos com token.
- Painel de sons: sons padrão próprios (gerados pelo script de síntese).
- Cinema (assistir junto), mapa Minecraft (BlueMap), status de servidor de Mine, fichas
  de RPG, ouvir junto no Spotify.
- Aureum+ (qualidade de transmissão maior); Kanban como produto separado.

## Pronto quando (Fase 3)
- ✅ Release sai com um rascunho só e o app se atualiza sozinho.
- ✅ Ícone novo em exe, instalador, janela, barra de tarefas, bandeja e insígnia Fundador.
- ✅ Conta-gotas fluido; overlay só em jogo; tela cheia com botão de sair.
- ✅ (teste pendente) Voz limpa com o headset Havit do beta; teste de microfone em Configurações.
- ✅ @aureum dá boas-vindas, avisa bug resolvido e manda DMs oficiais.
- ✅ Início abre no hub: ao vivo, pendências, minhas tarefas, amigos ativos e servidores.
- ✅ Dono reordena canais arrastando e todo mundo vê a nova ordem na hora.
- Trocar microfone e saída dentro da call.
- 15 Pioneiros no máximo; todos os testers com Beta Tester.
- Perfil editado direto do cartão, com recorte de avatar e banner (inclusive GIF).
- Reações, seletor de emojis e figurinhas do servidor no chat.
- Quadro branco colaborativo salvo por canal.
- Painel de sons funcionando na call.
- Até 4 painéis por servidor (chat, call, Kanban e outro addon ao mesmo tempo).
- Conta nova faz o tour inicial; dicas aparecem uma vez em cada recurso.
- App rodando na VM da Oracle, sem depender do PC do Eduardo.
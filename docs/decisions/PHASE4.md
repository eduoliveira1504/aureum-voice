# Aureum Voice — Fase 4

Base: Fase 3 concluída (0.2.0-beta.10, Windows + Mac). Beta aberto, sem convite, com usuários reais.
A Fase 4 é enxuta e vem em duas partes: 4.1 (correções, prioridade 1) e 4.2 (idioma, tipo de
servidor, conta 18+ e moderação). O resto está em "A conversar" e só vira bloco depois que o Eduardo
decidir como resolver. Aberta em 12/11/2026.
Regras do CLAUDE.md continuam valendo (custo R$0 fora das exceções autorizadas, segredos só no .env,
commits em inglês, SEM IA NO PRODUTO, nada copiado do Discord, regras de privacidade do teclado/overlay).
Executar UM bloco por vez, na ordem. Dentro do bloco: um item por vez, commit por item,
sem push (push só quando o Eduardo pedir). Plano curto antes de começar. Migrações
Alembic, testes da API, README e docs/decisions quando houver escolha de arquitetura.
O Eduardo decide quando gerar release. Ao terminar um bloco, marcar ✅ neste arquivo e atualizar a
linha de Status (no mesmo commit de docs do bloco).
Antes de corrigir qualquer bug: explicar a causa ao Eduardo.

Status: 4.1.1, 4.1.2 e 4.1.3 prontos em 12/11 (4.1.2 testado pelo Eduardo; 4.1.1 e 4.1.3 com teste manual
pendente; escolhas do 4.1.2 em 0047-voice-devices.md). Próximo: 4.1.4; depois a release 0.2.0-beta.11 (só
com a 4.1) e a 4.2.

## Regras de produção (valem para todos os blocos)
- Os dados são de gente de verdade. Antes de qualquer migração em produção: pg_dump com data no nome,
  mostrar o comando de restauração e só aplicar depois que o Eduardo confirmar que o backup existe.
- Comandos que mexem em produção (CLI, migração, broadcast, leitura do Redis/banco de produção) são
  mostrados antes e só rodam com OK do Eduardo. Leitura de dados de usuário em produção: só o
  necessário, sem copiar para fora da VPS.
- Mudanças de API que sobem antes do release não podem quebrar o app da versão anterior.
- Na 4.1, texto novo de interface fica em português como hoje. A partir do bloco 4.2.1, texto novo
  entra já pela estrutura de idiomas (nada de texto fixo novo).

## Ritual de release
Igual ao da Fase 3 (ver o fim do PHASE3.md): `npm run release` gera RASCUNHO; Windows e Mac saem
juntos; push do main antes; o Eduardo publica com o label "None". Versão segue 0.2.0-beta.N
(próxima: 0.2.0-beta.11, só com a 4.1). CHANGELOG em linguagem simples. Antes do release, confirmar
que um app da versão anterior instalado encontra a nova.

# FASE 4.1 — Correções da beta.10 (prioridade 1)

## 4.1.1 Menu "Enviar imagem / Escolher um GIF" aparece atrás da tela de perfil ✅ concluído (teste manual pendente)
Feito: a causa não era mudança de ordem nem o tour. O menu nasceu na beta.10 (3.22B; antes, "Alterar
avatar" abria direto o arquivo) já com o problema: menu e modal no mesmo z-50, e o host do menu vem
antes do Editar perfil no AppShell, então o modal cobria o menu e engolia o clique. Escala única em
main.css (`--z-index-*`, classes `z-<nome>`): conteúdo (raised, drawer, float) < shell < visualizador de
imagem < modal < diálogo < menu/popover < tooltip < dica < toast < tour. Diferença da ordem proposta:
o diálogo fica ABAIXO do menu, porque os diálogos abertos por menu (Criar enquete, Encaminhar, cartão
de perfil) também abrem menus e o seletor de emoji. Os diálogos do `showDialog` agora ficam na camada
deles, acima do modal que abriu o menu. Esc com menu aberto fecha só o menu (antes fechava o modal
junto). Teste (layers.test.ts) barra z-index fora da escala.
Teste manual: Editar perfil › Alterar avatar e Alterar banner › menu na frente › "Escolher um GIF"
abre o seletor por cima › Esc fecha só o seletor › Esc de novo fecha o perfil. Conferir também um
menu de botão direito dentro de Configurações do servidor e o diálogo que ele abre.
Sintoma (Eduardo): em Editar perfil, ao clicar em "Alterar avatar" ou "Alterar banner" o menu abre
por baixo da janela do perfil; "Escolher GIF" não faz nada. Antes funcionava.
Pista no código: `OpenMenu` (ContextMenu.tsx) e `Modal` (Modal.tsx) usam os dois `z-50`; o menu é
montado no AppShell (`ContextMenuHost`), então o modal, que vem depois, fica por cima. O "Escolher
um GIF" é outro `Modal` (z-50), aberto de dentro do perfil.
- Descobrir por que parou de funcionar (o que mudou de ordem/camada desde a beta.9; o tour pode ter
  mexido) e explicar ao Eduardo.
- Criar uma escala de camadas única (constantes ou tokens): conteúdo < painéis < modal <
  menu/popover < diálogo de confirmação < toast < tour. Menu de contexto SEMPRE acima de modal.
- Trocar os `z-` soltos pela escala. Conferir TODOS os menus abertos de dentro de modais
  (`openMenuAt` etc.) e o modal de GIF sobre o de perfil.
- Teste: Editar perfil, abrir o menu e conferir que fica acima do modal; "Escolher um GIF" abre o
  seletor acima do perfil; Esc fecha só o de cima.

## 4.1.2 Call mostra no máximo 4 pessoas ✅ concluído (testado pelo Eduardo em 12/11)
Feito: o Eduardo viu só 4 na lista da sala na barra lateral. Não havia limite: a lista é o estado
de voz que cada app informa à API, e dois jeitos tiravam quem ainda estava falando (reproduzidos nos
testes da API): a mesma conta com o app aberto em outro aparelho (o app parado avisa "não estou em
call" ao conectar; era o caso da amiga que sumiu) e a conexão que fica muda (a API tirava na hora, e o
app nem percebia que a conexão tinha morrido). Agora o aparelho que entrou é o dono da vaga; entrar
por outro aparelho passa a chamada para ele, e o aparelho parado mostra "Você está nesta chamada pelo
outro dispositivo" com "Entrar por aqui"; quem cai tem 20 s para voltar (60 s depois de reiniciar a
API); o app reconecta quando a conexão fica muda e reenvia o estado a cada minuto; recarregar o
servidor não apaga quem entrou nesse meio-tempo. Compatível com o app da beta.10. Ver
0047-voice-devices.md. Sem migração.
Teste manual: duas instâncias com a mesma conta (perfis dev e dev2): entrar numa sala por uma, a
outra mostra o aviso e a sala continua listando a pessoa; "Entrar por aqui" passa a chamada, e a
primeira sai com "A chamada continuou no seu outro dispositivo"; com 5 pessoas, as 5 aparecem.
Sintoma (Eduardo): com 5 amigos na call, só 4 apareciam.
Pista no código: o layout da call (`columns()` em VoiceView.tsx) NÃO limita a 4. Só o cartão do
Início (HomeHub.tsx) mostra 4 avatares + "+N". A causa está em outro lugar.
- PERGUNTAR ao Eduardo onde viu só 4: grade da call, barra lateral, overlay, janela destacada, mini
  call (CallPip) ou cartão do Início.
- Investigar: `roomIdentities()` (store/voice.ts), Overlay (máximo de câmeras), CallPip, DetachedCall,
  lista de quem está na sala na barra lateral, e limites do LiveKit na VPS (infra/livekit.prod.yaml,
  recursos da VPS, portas). Reproduzir com 5+ clientes (script com participantes simulados do
  LiveKit) antes de corrigir.
- Corrigir na causa. Teste: 5, 9 e 12 pessoas aparecem na grade; "+N" só onde há espaço limitado.
- Se for limite de recurso da VPS, explicar ao Eduardo e medir (teste de carga do 3.18 item 8).

## 4.1.3 Perfil mostra "jogando Valorant há 374 horas" ✅ concluído (teste manual pendente)
Feito: a atividade fica no Redis por conexão e só saía quando a conexão se despedia; um processo da
API que morre antes de limpar (deploy, travamento, reinício) deixava a entrada órfã, sem prazo, e a
API mostrava entradas de conexões que já não existiam (reproduzido no teste: entrada de 27/10 aparecia
para os amigos). A leitura em produção não foi necessária. Agora só conta atividade de conexão viva
(as órfãs são apagadas na leitura); o app reconfirma a cada 2 min o que está rodando e, sem
reconfirmação, a atividade some em 5 min (só para o app novo; o da beta.10 continua valendo enquanto a
conexão viver); uma varredura a cada 30 s tira as vencidas e avisa os amigos; ao subir, a API apaga
todas as atividades guardadas. Decisão do Eduardo: nada de esconder só o tempo ("acima de 24 h");
se a pessoa não está jogando, não aparece nada. Sem migração.
Teste manual: abrir um jogo (ou atividade manual) e ver "Jogando X" no perfil para outra conta; fechar
o app sem fechar o jogo: some para os outros em até 5 min; reiniciar a API: ninguém fica com
atividade velha.
Pista no código (apps/api/app/presence.py): a atividade fica num hash do Redis por conexão, sem prazo.
Só sai quando o app manda "nada" ou quando a conexão é esquecida (`forget_connection`).
`set_activity` mantém o started_at enquanto o nome for o mesmo. 374 h ≈ 15,6 dias ≈ desde a virada
para a VPS (27/10): provavelmente uma entrada que nunca foi limpa. A detecção do jogo usa
VALORANT-Win64-Shipping.exe (games.json), então a detecção em si parece certa.
- Mostrar ao Eduardo o comando de leitura (só leitura) da chave de atividade desse usuário no Redis
  de produção e comparar os connection_ids com as conexões vivas; rodar só com OK.
- Descobrir como a entrada ficou (conexão que nunca foi esquecida? reinício da API? app do amigo
  que nunca mandou "parou de jogar"?).
- Corrigir a causa e blindar: a atividade expira sozinha (o cliente reenvia a cada poucos minutos
  e a entrada tem prazo; sem reenvio, some); limpar atividades antigas ao subir a API; o cliente
  não mostra tempo absurdo (acima de 24 h some o "há X horas", ou limpa a atividade).
- Teste da API: entrada sem reenvio expira; reenvio mantém o started_at; desconectar limpa.

## 4.1.4 Botão de atualização não aparece para todo mundo
Sintoma: depois da beta.10, para alguns que já tinham o app o botão de atualização não aparece.
Pistas no código: o atualizador (main/updater.ts) escreve o log só no console, então nos PCs dos
testers não dá pra saber por que falhou; o aviso depende do evento `updates:ready` enviado uma vez ao
renderer (o estado também fica em `updates:get-state`); o Mac não se atualiza sozinho (mostra
"Baixar a versão X", por decisão do 3.21).
- PERGUNTAR ao Eduardo: quais pessoas, Windows ou Mac, e qual versão instalada.
- Gravar o log do atualizador num arquivo (pasta de dados do app) e incluí-lo no diagnóstico do
  "Reportar problema". Sem dados pessoais.
- Conferir que o renderer lê `updates:get-state` ao montar (não só ouve `updates:ready`), e o
  que acontece quando a verificação falha, demora ou dá erro na tela de carregamento.
- Rede de segurança para TODOS: a API informa a última versão publicada (endpoint simples, sem
  login) e o app compara com a versão instalada; se estiver desatualizado e o atualizador não
  entregou o botão, mostra "Baixar a versão X" (abre a página de download). O botão aparece sempre.
- Teste: com o atualizador falhando, o aviso aparece pelo endpoint da API; sem atualização, nada aparece.
- Conferir também (sem refazer): o rascunho da beta.10 tem latest.yml e latest-mac.yml certos.

# FASE 4.2 — Idioma, tipo de servidor, conta 18+ e moderação
Só começa depois da 4.1 publicada. Ordem: 4.2.1, 4.2.2, 4.2.3, 4.2.4.

## 4.2.1 Idioma (Português e Inglês)
Decisão (Eduardo): só PT e EN por enquanto, e novos idiomas devem ser fáceis de acrescentar depois.
- O que o usuário cria (nomes de servidor, canais, mensagens, cargos, tarefas) fica EXATAMENTE como foi
  criado. O que é do Aureum troca: interface inteira (Início, servidores, tarefas, configurações,
  tour e dicas, diálogos, toasts), canais e textos padrão, mensagens e DMs oficiais do bot,
  e-mails de conta, datas e números via Intl.
- Canais padrão criados com o servidor (ex: "Geral", sala de voz) saem no idioma de quem criou e,
  depois de criados, passam a ser do usuário (não mudam).
- Configurações › Idioma: Automático (idioma do sistema), Português, English. Padrão: Automático.
- Explicar ao Eduardo as opções (biblioteca tipo i18next ou motor próprio, como no tour) e a
  que for mais leve, sem custo e sem dependência pesada, antes de implementar. Registrar em ADR.
- Extrair o texto fixo dos componentes em etapas (por tela), mantendo os testes passando em PT.
  Teste/regra que impeça texto fixo novo em componente.
- Textos que vêm da API (bot, e-mails, erros): API responde por códigos de erro e o app traduz;
  e-mails e mensagens do bot usam o idioma da conta.
- Teste: trocar o idioma e ver Início, servidor, tarefas, configurações e tour trocarem na hora.

## 4.2.2 Tipo de servidor
- Ao criar servidor: escolher entre Jogos, Trabalho ou Misto (3 cartões, com uma linha explicando).
- Trocar o exemplo apagado do campo de nome ("Os Brabos", que incomoda) por exemplos que mudam
  com o tipo, por exemplo: Jogos "Noite de sábado", Trabalho "Equipe de design", Misto "Meu espaço".
  Os textos vão pela estrutura de idiomas (4.2.1).
- Migração: `servers.kind` (jogos | trabalho | misto). Servidores que já existem ficam Misto.
  O dono muda o tipo depois em Configurações do servidor.
- O tipo decide quais addons aparecem para instalar e o padrão da Proteção (4.2.4).
- Tabela addon × tipo (PROPOSTA; o Eduardo decide), com os addons que já existem:
  Kanban, Quadro branco: Trabalho, Misto. Calendário, Enquetes: todos. Painel de sons: Jogos, Misto.
  O tipo só filtra a lista; "Ver todos os addons" continua existindo, com um aviso. Addons de jogos
  futuros (Riot, Minecraft) entram só em Jogos e Misto.
- Guardar a tabela num arquivo de configuração simples (fácil de mudar), nunca espalhada no código.

## 4.2.3 Conta: idade mínima, desativar e excluir
### Idade mínima: 18+
- Cadastro pede data de nascimento, bloqueia menores de 18 e aceita os termos de uso. Quem não
  passa não consegue refazer com outra data na mesma sessão/dispositivo.
- Contas que já existem: uma confirmação única ao abrir o app (maior de 18 anos + termos); sem
  confirmar, não usa. Explicar ao Eduardo o texto antes.
- Decisão em aberto: guardar a data de nascimento ou só a confirmação de maioridade e a data em
  que foi dada (mínimo de dados). Recomendar o mínimo e registrar em ADR. Vale revisão de um
  advogado (LGPD e ECA Digital); o código não substitui isso.

### Desativar e excluir (Configurações › Conta)
- Desativar: pausa a conta. Some das listas e do chat como "indisponível" até a pessoa entrar de
  novo, que reativa sozinho.
- Excluir: a pessoa confirma com a senha. Prazo de arrependimento (PROPOR 14 dias, Eduardo decide):
  nesse prazo a conta fica desativada e entrar cancela a exclusão; depois, apagada de vez.
- Quem é dono de servidor: precisa passar a posse ou excluir o servidor antes.
- Ao excluir de vez: apagar e-mail, senha, sessões, perfil, avatar e banner (também no MinIO),
  amizades, configurações, insígnias do perfil e tokens. As mensagens ficam e passam a aparecer com
  autor "Usuário desconhecido", sem avatar, sem nome, sem marca de "apagado", para não expor a
  pessoa. Menções antigas à pessoa viram "Usuário desconhecido". Conferir DMs, grupos, reações,
  eventos, tarefas e votos. Migração (autor anônimo, ex: author_id nulo + marcador).
- E-mail de confirmação (a estrutura já existe, 0019). Teste da API para cada regra acima.
- Migração em produção: seguir a regra de backup.

## 4.2.4 Moderação e Proteção do servidor
Princípio (Eduardo): o app não é ditadura; as pessoas são livres, mas o servidor pode escolher ser
mais rígido. Conversas privadas NÃO têm filtro nem moderação automática (privacidade); só valem
bloqueio e denúncia feitos pela própria pessoa.
- **Bloquear usuário:** esconde as mensagens dele, impede DM e chamada com você. Lista de bloqueados
  em Configurações; desbloquear. Teste: bloqueado não consegue ligar nem mandar DM.
- **Denunciar mensagem ou pessoa:** motivo + a mensagem denunciada (e só o que for necessário).
  Em servidor, vai para a fila de moderação dos admins; também pode ir para o Eduardo (como o
  "Reportar problema"). Quem denuncia recebe um aviso de recebido.
- **Configurações do servidor › Proteção** (só quem tem a permissão, via cargos do ADR 0007):
  - Filtro de palavras: lista padrão do Aureum + lista do próprio servidor. Ao pegar: apaga a
    mensagem e posta um aviso curto no próprio chat ("mensagem removida pela Proteção do servidor"),
    sem banir ninguém. Rodar na API, ANTES de entregar a mensagem.
  - Anti-spam e anti-link (limites configuráveis; quem tem permissão é isento).
  - Log de moderação: só ADM vê (quem apagou o quê, filtro disparado, denúncias resolvidas).
  - Padrão por tipo de servidor (4.2.2): Jogos e Misto desligado; Trabalho ligado. Cada ADM muda.
- Silenciar, expulsar e banir continuam com PESSOAS (cargos e permissões já existentes, 0007/0009).
  Nenhum bot faz isso. Conferir o que já existe e preencher só o que faltar.
- Fica para depois: automod avançado, log de auditoria completo, painel de admin geral.
- Teste da API: filtro apaga e avisa; ADM isento; log não vaza para membros; DMs nunca filtradas.

# A conversar (NÃO fazer; sem bloco até o Eduardo decidir como resolver)
Decisões já tomadas, para quando voltar:
- **Bot oficial modular (@aureum):** vira bot de verdade usando uma API interna (token, eventos,
  comandos, escopos, liga/desliga por servidor), sem documentação pública e sem bots de terceiros por
  enquanto. O dono escolhe na criação do servidor se o bot entra. Módulos: boas-vindas (já existe),
  cargo automático, avisos e anúncios programados, lembretes (incluindo reunião), enquetes e
  sorteios. O bot não bane, não expulsa nem silencia. Sem canais de voz temporários. Sem música.
- **Busca (Ctrl+K):** por servidor (mensagens, canais, membros), só o que a pessoa pode ver,
  Postgres full-text; sem busca global. A barra atual não pode continuar enganando. Ctrl+K fora de
  servidor: a decidir.
- **Atividade ao vivo no status:** personagem, foto e KDA (opt-in; LoL/TFT por API local; VALORANT só
  com chave de produção e RSO) e "ouvindo agora" do Spotify com link, só informação, nunca áudio.
- **Addons de jogos:** Jogos Riot (chave de produto no portal da Riot: pedir cedo, demora), Minecraft
  e Hytale (status e mapa; Hytale só se existir API). Só em servidores Jogos e Misto.
- **Correções por aparelho (era 3.19 C2):** supressão de ruído, Havit, AB13X etc., quando houver
  relatórios dos testers (FUTURO.md).
- **Música em chamada:** pesquisa separada antes de qualquer código (origem do áudio, política do
  Spotify e do YouTube, SoundCloud, músicas livres, licença, advogado).
- **Para o FUTURO.md:** API pública de bots e marketplace de addons; moderação avançada; app de
  celular (2027); importar servidores do Discord e Aureum Plus; login Google/Discord; domínio;
  identidade visual e mascote (2027); tema por servidor; "assistir junto" do YouTube.

## Perguntas para o Eduardo antes de começar a 4.1 e a 4.2
1. Onde você viu só 4 pessoas (4.1.2)? Grade, barra lateral, overlay?
2. Quem não recebeu a atualização (4.1.4): Windows ou Mac, e qual versão?
3. Prazo de arrependimento para excluir conta: 14 dias está bom?
4. Guardar a data de nascimento ou só a confirmação de maioridade?
5. A tabela addon × tipo de servidor do 4.2.2 está certa?
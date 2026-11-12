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

Ordem: 4.2.1 a 4.2.6. A revisão de usabilidade (4.2.7) roda junto, o tempo todo.

## 4.2.1 Tipo de servidor ✅ concluído (teste manual pendente)

Ver docs/decisions/0048-server-types.md.
Produção: backup, depois `alembic upgrade heads` (core c9e5a1b3d486 cria servers.type, todos os
servidores existentes viram Misto) e reiniciar a API, com OK do Eduardo. API antes do app: apps
antigos continuam criando servidor (vira Misto). Teste manual: criar um servidor de cada tipo e
conferir a lista de addons e o painel de sons na call.

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

Enquetes em DM e grupo não mudam: não dependem de tipo de servidor.

### Técnica
- Coluna servers.type (enum: game, work, mixed), NOT NULL, migração Alembic com default mixed para os existentes.
- A lista de addons por tipo mora num lugar só (constante/config no backend) e o app lê da API. Nada de lista duplicada no cliente.
- Tela de criação: três cartões com título e uma linha explicando o que vem em cada tipo. Mostrar o aviso "O tipo não pode ser alterado depois".

### Testes
Criar servidor de cada tipo; addon fora da lista recusado pela API e escondido na interface; tentativa de trocar o tipo recusada; servidores antigos viram Misto; placeholder correto.

## 4.2.2 Desativar e excluir conta

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
- E-mail e nome de usuário: Claude Code propõe como liberar (e por quanto tempo) e me mostra antes.
- Job diário que conclui as exclusões vencidas (sem custo extra, no mesmo processo/cron que já existe).
- E-mail de aviso ao agendar e ao concluir.

### Comando de admin
- accounts purge (CLI), com --dry-run obrigatório antes: lista contas candidatas (ex: nunca confirmadas, sem servidor, sem mensagens, criadas há mais de X dias) e só apaga com confirmação. Serve para limpar contas fake.

### Tela
- Configurações › Conta › "Desativar ou excluir conta", com texto claro do que acontece em cada opção.

### Testes
Desativar e reativar; excluir com e sem a caixinha; dono bloqueado até passar a posse; cancelar dentro dos 30 dias; job conclui só as vencidas; autor vira "Usuário excluído"; arquivos apagados do MinIO; purge em dry-run não apaga nada.

## 4.2.3 Addon TFT (único addon de jogo da fase)

Mockup aprovado (quatro telas): https://claude.ai/artifact/5jymvkv7859u7QsNNtsXsD
Seguir o visual do mockup e os tokens do ADR 0003. Dados de exemplo sempre com o selo "Dados de exemplo" enquanto não houver dado real.

### Limites da Riot (obrigatórios, valem para tudo aqui)
- Overlay só com informação estática, escolhida pelo usuário. Nada que leia o estado da partida nem dê dica em tempo real (posição de itens, o que comprar, etc.).
- Sem win rate de augment.
- Mostrar o Riot ID sempre que aparecer um jogador.
- Aviso visível: "O Aureum não é endossado pela Riot Games."
- Uma chave por produto. Beta fechado por convite: chave pessoal serve. Chave de produção e login pela Riot (RSO) ficam para quando o app abrir.
- Chave de desenvolvimento (24h) só para teste local, nunca distribuída.
- Limites da chave pessoal: 20 requisições/s e 100 a cada 2 min. Respeitar com fila e cache.

### Camada 1: casca e UI (dados de exemplo)
- Addon novo no framework do ADR 0013, só nos tipos Jogo e Misto.
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
- Coleta e cálculo SEMPRE no servidor, chave só em .env. O app desktop nunca vê a chave.
- Estatísticas por patch (posição média, top 4, comps, itens) a partir de partidas ranqueadas amostradas. Respeitar os limites de taxa, com fila, cache e retry.
- Histórico do jogador: precisa do Riot ID. Sem RSO não dá para provar que a conta é da pessoa, então o vínculo é digitar Riot ID + região e aparece como "não verificado". Verificação real só com a chave de produção. Mostrar só o que a chave liberar; se não liberar PDL/elo, mostrar posição média e top 4.
- Esta camada só começa depois do aval da Riot para a chave. Até lá, a UI roda nos fixtures.

### Testes
Addon só aparece em Jogo e Misto; fixar plano persiste e aparece no overlay; atalho e posição do overlay salvos; overlay some fora do jogo; troca de provider não altera a UI; chave nunca aparece em log nem no cliente; limite de taxa respeitado (teste com mock).

## 4.2.4 Busca dentro do servidor
- Campo de busca no servidor: procura mensagens nos canais que a pessoa pode ver (VIEW_CHANNEL), respeitando canais privados.
- Filtros: canal, autor, data. Resultado leva ao ponto da mensagem no canal.
- Busca de texto do próprio Postgres (config portuguesa). Sem serviço novo, custo zero.
- Paginação e limite de resultados; campo vazio e "nada encontrado" tratados.
- Testes: não retorna mensagem de canal privado sem acesso; filtros; permissão checada na API.

## 4.2.5 Atividade ao vivo
- Mostrar "Jogando X" com o tempo (ex: "há 2 h") no cartão de perfil, na lista de amigos e no hub do Início.
- Usa o que o 2.5 já detecta (lista própria de jogos). Depende do fix da 4.1.3 (atividade expira sem sinal).
- Respeitar a opção de privacidade de atividade que já existe; se não existir, criar "Mostrar o que estou jogando".
- Só o nome do jogo e o tempo. NADA de dados da partida (KDA, placar) nesta fase.
- Atualização por WebSocket, sem polling.
- Testes: atividade some quando o app fecha ou fica sem sinal; opção de privacidade esconde; tempo atualiza.

## 4.2.6 Idioma (português e inglês)
- Configurações › Idioma, com Português (Brasil) e English. Padrão: idioma do sistema; sem tradução disponível, português.
- Extrair todos os textos do app para arquivos de tradução. Biblioteca de i18n nova: perguntar antes, licença permissiva.
- Datas, horas e números no formato do idioma.
- Fora do escopo agora: textos que vêm da API e e-mails continuam em português.
- Por último na fase: só começa com 4.2.1 a 4.2.5 prontos, para não traduzir texto que ainda vai mudar.
- Testes: trocar o idioma atualiza na hora, sem reiniciar; nenhum texto fixo restante nas telas principais.

## 4.2.7 Revisão de usabilidade (transversal)
- Durante a fase, Claude Code anota atritos que encontrar em docs/decisions/USABILIDADE.md (tela, problema, sugestão).
- Eduardo escolhe o que entra. Coisa pequena entra no commit do bloco; o resto vira item novo.
- Ao fim da 4.2, uma passada ponto a ponto de teste em todas as telas principais.

## Depois do advogado (início de 2027)
- Idade mínima 18+, termos de uso, política de privacidade, LGPD (a exclusão de conta já ajuda no direito de apagar).
- Moderação entre usuários: bloquear e reportar.

## Backlog (não fazer agora)
- Bot modular do Aureum: avisos programados, lembretes, enquete, sorteio, filtro de palavras e spam, logs só para admin, conta de bot de verdade, entra só se escolhido na criação do servidor. Música no bot só depois de pesquisar licenciamento. API pública de bots no futuro.
- Addons de LoL e Valorant (planejador/histórico). Chave de produção e RSO da Riot.
- Barra de pesquisa global e atalho Ctrl+K.
- Celular (2027), importar servidores do Discord, login com Google e Discord.
- Domínio e identidade visual final.

## Perguntas em aberto
- Nome de usuário e e-mail de conta excluída: liberar quando e por quanto tempo?
- Barra de pesquisa global / Ctrl+K: fica fora da 4.2, certo?

## Pronto quando (Fase 4.2)
- Criar servidor pede o tipo e a lista de addons segue o tipo, travada.
- Dá para desativar e excluir a conta com 30 dias de carência, dono bloqueado até passar a posse, e limpar contas fake pelo comando de admin.
- Addon TFT com as cinco abas e o overlay "Meu plano" funcionando em dados de exemplo; estatísticas reais só quando a Riot liberar a chave.
- Busca dentro do servidor, atividade ao vivo e idioma português/inglês funcionando.
- USABILIDADE.md revisado e a passada final de teste feita.
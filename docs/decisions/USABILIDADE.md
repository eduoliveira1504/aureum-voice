# Revisão de usabilidade (Fase 4.2, item 4.2.7)

Atritos anotados durante a fase. O Eduardo escolhe o que entra: coisa pequena vai no commit do
bloco; o resto vira item novo. Formato: tela, problema, sugestão.

## Abertos

### Criar servidor (4.2.1)
- **Tela:** Criar um servidor.
- **Problema:** nenhum tipo vem marcado; quem clica em Criar direto recebe "Escolha o tipo do
  servidor." É de propósito (a escolha é definitiva), mas é um clique a mais e a janela ficou mais
  alta (nome + três cartões + aviso).
- **Sugestão:** manter assim. Se incomodar no beta, pré-marcar "Misto", que não tira nada.

### Tipo do servidor invisível depois de criado (4.2.1)
- **Tela:** Configurações do servidor › Visão geral.
- **Problema:** o tipo não aparece em lugar nenhum depois da criação. Quem não lembra que escolheu
  "Trabalho" não entende por que o painel de sons sumiu.
- **Sugestão:** uma linha em Visão geral: "Tipo: Trabalho. O tipo não pode ser alterado." Pequeno.

### Menu "Configurações do servidor" vazio (4.2.1)
- **Tela:** menu do servidor (aba e cabeçalho da barra lateral).
- **Problema:** em servidor de Trabalho, alguém cujo único poder é "Gerenciar painel de sons" ainda
  vê "Configurações do servidor", e a janela abre sem nenhuma aba.
- **Sugestão:** esconder o item quando nenhuma aba sobra. Caso raro, pequeno.

### Conta escondida dentro de Editar perfil (4.2.2)
- **Tela:** Editar perfil › Conta (e-mail, senha, desativar ou excluir conta).
- **Problema:** para achar "Excluir conta" é preciso abrir o próprio cartão de perfil, ir em
  Editar perfil e depois no botão Conta. Quem procura em Configurações não encontra.
- **Sugestão:** em Configurações, um atalho "Conta e segurança" que abre esse mesmo painel.
  Pequeno.

### "Senha atual incorreta" fora da troca de senha (4.2.2)
- **Tela:** desativar conta, excluir conta e trocar e-mail.
- **Problema:** senha errada mostra "Senha atual incorreta.", texto pensado para a troca de senha.
- **Sugestão:** "Senha incorreta." em todas as telas. Pequeno.

### Textos do servidor em português no app em inglês (4.2.6)
- **Tela:** perfil (insígnias e como ganhar), conversa oficial da @aureum, Novidades.
- **Problema:** com o app em English, os nomes e descrições das insígnias, as mensagens da @aureum
  e o texto das Novidades continuam em português (vêm da API ou do CHANGELOG, fora do escopo).
- **Sugestão:** quando abrir o app para fora, a API mandar chaves (ou os dois idiomas) para
  insígnias e avisos. Médio; vira item novo.

### Revisão do inglês (4.2.6)
- **Tela:** todas.
- **Problema:** o inglês foi escrito junto com a extração, sem revisão de quem fala a língua.
- **Sugestão:** uma passada de alguém fluente antes de divulgar o app em inglês. Pequeno.

### Emojis buscados pelo nome no outro idioma (4.2.6)
- **Tela:** seletor de emojis e o autocompletar `:nome`.
- **Problema:** a busca segue o idioma do app; quem usa o app em inglês e digita `:fogo` não acha.
- **Sugestão:** procurar nos dois catálogos e mostrar o do idioma atual primeiro. Pequeno, se o
  beta pedir.

### Arrastar para o lugar errado não explica nada (4.2.8)
- **Tela:** barra lateral do servidor (arrastar canal ou addon).
- **Problema:** arrastar um canal de texto para Addons (ou um addon para Conversas) simplesmente não
  mostra onde soltar. É o certo, mas quem tenta não sabe por quê.
- **Sugestão:** enquanto arrasta um addon, deixar as outras categorias apagadinhas (e o contrário).
  Pequeno.

### Apps antigos mostram Renomear e Excluir na Addons (4.2.8)
- **Tela:** menu da categoria Addons, em apps até a 0.2.0-beta.11.
- **Problema:** as opções continuam lá; a API recusa e o app antigo mostra só "Não foi possível
  salvar a categoria." (ou nada, ao excluir).
- **Sugestão:** nenhuma; some quando a pessoa atualizar. Só para saber, se alguém reclamar.

### Não há como desafixar (4.2.9)
- **Tela:** chamada (tela cheia, PiP e janela destacada).
- **Problema:** clicar em alguém fixa a pessoa, mas nada desfaz a fixação: ela só cai quando a
  pessoa sai da chamada. Num grupo, quem fixou sem querer perde o "quem fala" automático.
- **Sugestão:** clicar de novo em quem está grande desafixa (ou um alfinete no tile). Pequeno.

### A tela de chamada e o PiP escolhem diferente sem fixação (4.2.9)
- **Tela:** chamada em grupo, modo foco, sem ninguém fixado.
- **Problema:** o PiP mostra quem fala; a tela de chamada mostra sempre a primeira pessoa.
- **Sugestão:** a tela de chamada usar a mesma escolha do PiP (lib/callFocus.ts). Pequeno.

### Tela cheia saiu do PiP (4.2.9)
- **Tela:** janelinha da chamada.
- **Problema:** com os controles mínimos, o botão de tela cheia saiu; agora são dois cliques
  (voltar à chamada, depois tela cheia).
- **Sugestão:** manter assim, a não ser que o beta sinta falta.

### Busca não ignora acento (4.2.4)
- **Tela:** Buscar no servidor.
- **Problema:** "reuniao" não acha "reunião" (a busca do Postgres em português não tira acento).
  Muita gente digita sem acento.
- **Sugestão:** usar a extensão `unaccent` do próprio Postgres (grátis) numa configuração de busca
  e num índice novo. Médio (migração + índice).

### Resultado não destaca a palavra (4.2.4)
- **Tela:** Buscar no servidor.
- **Problema:** a lista mostra o começo da mensagem; numa mensagem longa a palavra procurada pode
  ficar fora das 3 linhas.
- **Sugestão:** mostrar o trecho em volta da palavra, com ela em negrito. Pequeno a médio.

### Resultado muito antigo não chega na mensagem (4.2.4)
- **Tela:** Buscar no servidor › clicar num resultado.
- **Problema:** se a mensagem está a mais de ~2000 mensagens do fim do canal, o canal abre mas não
  rola até ela.
- **Sugestão:** a API carregar a página em volta de uma mensagem (`around=`). Médio; só se o beta
  esbarrar nisso.

### Editar mensagem com cargo mostra o código (4.2.12)
- **Tela:** chat › editar uma mensagem que marcou um cargo.
- **Problema:** a caixa de edição mostra `<@&…>` no lugar de `@Nome`.
- **Sugestão:** a edição trocar o código pelo nome e de volta ao salvar, como o campo de mensagem
  já faz. Pequeno.

### Marcar sem permissão não avisa (4.2.12)
- **Tela:** chat, alguém sem "Mencionar @all, @here e cargos" digita `@all` à mão.
- **Problema:** a mensagem sai e não notifica ninguém, sem aviso nenhum. A lista já não oferece
  `@all`/`@here` para quem não pode, então só acontece digitando.
- **Sugestão:** uma linha discreta embaixo do campo: "Você não pode marcar todos neste canal".
  Pequeno.

### "Mostrar o jogo" não esconde a atividade manual (4.2.5)
- **Tela:** Configurações › Atividade.
- **Problema:** desligar "Mostrar o jogo que estou jogando" para a detecção, mas uma atividade
  manual preenchida continua aparecendo. Quem quer sumir pode achar que a opção não funcionou.
- **Sugestão:** com a opção desligada, a atividade manual também não ir (ou um aviso ao lado dela).
  Pequeno.

### O teste de "nenhum texto fixo" não olha template strings (4.2.5)
- **Tela:** nenhuma (qualidade).
- **Problema:** o teste do 4.2.6 só encontra texto dentro do JSX; textos montados com `${}` passaram
  ("pessoas", "transmitindo", "membros", "Mensagem de voz", corrigidos agora). Pode haver outros.
- **Sugestão:** o teste procurar também palavras em português dentro de template strings. Pequeno.

### Sudoku sem anotações (4.2.10)
- **Tela:** Jogos do dia › Sudoku.
- **Problema:** não dá para marcar candidatos pequenos numa casa; quem joga sério sente falta.
- **Sugestão:** um modo "lápis" que põe números pequenos na casa. Pequeno a médio.

### Segundo desafio no mesmo canal (4.2.10)
- **Tela:** Desafiar no servidor.
- **Problema:** se alguém já desafiou o canal hoje naquele jogo, o próximo vê "já tinha o desafio de
  hoje". Está certo (o cartão já mostra o ranking de todos), mas a pessoa pode querer "aparecer".
- **Sugestão:** nessa resposta, um botão "Ir para o desafio" que abre a mensagem. Pequeno.

### Caça-palavras em português no app em inglês (4.2.10)
- **Tela:** Jogos do dia › Caça-palavras, com o app em English.
- **Problema:** tema e palavras ficam em português (a lista é nossa e em português).
- **Sugestão:** manter; se o app abrir para fora, uma lista em inglês. Médio.

## Resolvidos

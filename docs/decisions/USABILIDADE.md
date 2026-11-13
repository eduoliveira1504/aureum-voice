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

## Resolvidos

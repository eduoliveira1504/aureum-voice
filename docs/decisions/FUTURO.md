# Aureum Voice — Ideias futuras (fora da Fase 3)

Nada daqui entra na Fase 3. Cada item vira bloco de uma fase futura só com spec do Eduardo.

## Identidade visual (prazo: fim de 2026)
NÃO começar sem spec detalhada do Eduardo. Escopo previsto:
- Logo final (o atual é o oficial até lá; trocar tudo via npm run build:icons).
- Revisão de cores e tokens do 2.1.
- Mascote da marca (ideias em aberto: abelha "Zum", "Pepita", vaga-lume "Lume"),
  original de verdade, legível de 24px a ilustração grande. Usos: guia do tour,
  estados vazios, carregamento, erro de conexão, e-mails, figurinhas (pacote do mascote).

## Fase 4
### Correções por aparelho (era a parte C2 do 3.19; saiu da Fase 3 em 09/11)
Esperando os relatórios dos testers.
- Com os relatórios novos, achar a causa de cada caso: supressão de ruído sem efeito, headset
  Havit, AB13X USB Audio e o que mais aparecer.
- Explicar a causa de cada um ao Eduardo antes de corrigir; ajustes por aparelho só se não houver
  correção geral.

## Backlog
- Convite de grupo do WhatsApp (invites create --usos 15 --dias 7); a landing já está no
  ar, só falta gerar com OK do Eduardo.
- Visto em grupos ("Visto por N").
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
"""Our own word list for Caça-palavras (block 4.2.10): everyday Portuguese words by theme, written
for the Aureum (no third-party list). Words are shown as written here; the grid uses them without
accents and with Ç as C. One word each, nothing that could offend; the ones longer than the grid
are simply never picked.
"""

THEMES: dict[str, list[str]] = {
    "Comida": [
        "arroz", "feijão", "farofa", "pastel", "coxinha", "pudim", "brigadeiro", "lasanha", "pizza", "salada",
        "omelete", "panqueca", "biscoito", "torrada", "macarrão", "risoto", "tapioca", "cuscuz", "pamonha", "canjica",
        "quindim", "paçoca", "polenta", "moqueca", "empada", "esfiha", "sorvete", "chocolate", "mingau", "bolinho",
    ],
    "Bichos": [
        "cachorro", "gato", "cavalo", "coelho", "tartaruga", "girafa", "elefante", "macaco", "tucano", "arara",
        "jacaré", "capivara", "onça", "lobo", "raposa", "golfinho", "baleia", "pinguim", "coruja", "pato",
        "galinha", "abelha", "formiga", "borboleta", "tatu", "esquilo", "camelo", "zebra", "leão", "tigre",
    ],
    "Frutas": [
        "banana", "maçã", "laranja", "manga", "goiaba", "abacaxi", "melancia", "melão", "morango", "uva",
        "caju", "acerola", "pitanga", "jabuticaba", "maracujá", "limão", "abacate", "mamão", "kiwi", "pera",
        "ameixa", "cereja", "framboesa", "graviola", "cupuaçu", "açaí", "tangerina", "carambola", "pêssego", "figo",
    ],
    "Esportes": [
        "futebol", "vôlei", "basquete", "tênis", "natação", "corrida", "ciclismo", "judô", "karatê", "boxe",
        "surfe", "skate", "remo", "vela", "xadrez", "handebol", "golfe", "rúgbi", "esgrima", "atletismo",
        "ginástica", "canoagem", "escalada", "patinação", "hipismo", "badminton", "beisebol", "maratona", "salto", "arco",
    ],
    "Música": [
        "violão", "guitarra", "bateria", "piano", "flauta", "pandeiro", "cavaco", "sanfona", "trompete", "saxofone",
        "violino", "teclado", "baixo", "samba", "forró", "frevo", "pagode", "choro", "bossa", "rock",
        "melodia", "ritmo", "refrão", "acorde", "canção", "palco", "coral", "maestro", "batuque", "tambor",
    ],
    "Natureza": [
        "floresta", "montanha", "cachoeira", "praia", "oceano", "deserto", "vulcão", "geleira", "lagoa", "pântano",
        "savana", "caverna", "colina", "vale", "ilha", "recife", "duna", "planalto", "cerrado", "caatinga",
        "chuva", "vento", "trovão", "neblina", "arco", "orvalho", "semente", "raiz", "folha", "flor",
    ],
    "Casa": [
        "sofá", "cadeira", "mesa", "cama", "armário", "gaveta", "janela", "porta", "escada", "tapete",
        "cortina", "espelho", "lâmpada", "geladeira", "fogão", "panela", "talher", "prato", "copo", "toalha",
        "travesseiro", "cobertor", "estante", "varanda", "quintal", "telhado", "chuveiro", "torneira", "vassoura", "balde",
    ],
    "Viagem": [
        "mala", "mochila", "passaporte", "avião", "ônibus", "trem", "navio", "estrada", "mapa", "bússola",
        "hotel", "pousada", "barraca", "roteiro", "bilhete", "aeroporto", "câmera", "lembrança", "praia", "trilha",
        "fronteira", "cidade", "museu", "turista", "guia", "passeio", "viagem", "destino", "férias", "carona",
    ],
    "Jogos": [
        "dado", "baralho", "tabuleiro", "peão", "rainha", "torre", "bispo", "dominó", "dama", "bingo",
        "quebra", "enigma", "charada", "desafio", "partida", "rodada", "placar", "vitória", "empate", "jogada",
        "fase", "chefe", "missão", "equipe", "pontos", "recorde", "ranking", "nível", "vida", "moeda",
    ],
    "Escola": [
        "caderno", "lápis", "caneta", "borracha", "régua", "mochila", "estojo", "lousa", "giz", "livro",
        "aula", "prova", "recreio", "colega", "turma", "diretor", "biblioteca", "ciência", "história", "geografia",
        "redação", "tarefa", "nota", "boletim", "uniforme", "lanche", "quadra", "mapa", "dicionário", "atlas",
    ],
    "Profissões": [
        "médico", "dentista", "professor", "pedreiro", "padeiro", "bombeiro", "piloto", "motorista", "advogado", "artista",
        "cantor", "pintor", "escritor", "jardineiro", "cozinheiro", "garçom", "carteiro", "barbeiro", "costureira", "fotógrafo",
        "arquiteto", "engenheiro", "cientista", "atleta", "músico", "ator", "juiz", "pescador", "agricultor", "veterinário",
    ],
    "Cores e formas": [
        "vermelho", "azul", "amarelo", "verde", "roxo", "laranja", "rosa", "marrom", "cinza", "branco",
        "preto", "dourado", "prateado", "lilás", "bege", "círculo", "quadrado", "triângulo", "losango", "estrela",
        "espiral", "cubo", "esfera", "cilindro", "cone", "pirâmide", "hexágono", "oval", "linha", "ponto",
    ],
}

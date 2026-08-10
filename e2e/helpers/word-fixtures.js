// La lettre de manche est tirée au hasard (poids égaux) : les mots ne peuvent
// plus être construits à la volée (`${letter}at`) maintenant que wordExists()
// vérifie un vrai dictionnaire côté backend (cf.
// backend/src/domain/game/dictionary.js). Quatre vrais mots français
// distincts par lettre, choisis à l'avance (même table que
// backend/tests/helpers/word-fixtures.js, dupliquée ici car e2e/ ne dépend
// pas du code du submodule backend).
const WORDS_BY_LETTER = {
  A: ['abandon', 'avion', 'arbre', 'ananas'], B: ['bateau', 'bonbon', 'biscuit', 'banane'],
  C: ['chat', 'cabane', 'citron', 'camion'], D: ['dauphin', 'dague', 'danse', 'dahlia'],
  E: ['ecole', 'etoile', 'elephant', 'epee'], F: ['fable', 'farine', 'fromage', 'fantome'],
  G: ['gateau', 'gant', 'girafe', 'genou'], H: ['hibou', 'habile', 'horloge', 'harpe'],
  I: ['image', 'iceberg', 'ile', 'insecte'], J: ['jardin', 'jacasser', 'jaune', 'jungle'],
  K: ['kilo', 'kanak', 'kiosque', 'kafka'], L: ['lion', 'lampe', 'livre', 'loup'],
  M: ['maison', 'melon', 'montagne', 'musique'], N: ['nuage', 'nabot', 'noix', 'navire'],
  O: ['oiseau', 'oasis', 'orange', 'olive'], P: ['pomme', 'piano', 'papillon', 'pyramide'],
  Q: ['quatre', 'quai', 'question', 'quinze'], R: ['raisin', 'radis', 'renard', 'requin'],
  S: ['soleil', 'sable', 'singe', 'sirene'], T: ['table', 'tigre', 'tortue', 'tomate'],
  U: ['usine', 'ukase', 'univers', 'uniforme'], V: ['valise', 'village', 'vent', 'voiture'],
  W: ['wagon', 'wallon', 'warning', 'wagons'], X: ['xenophobie', 'xavier', 'xiloidine', 'xenakis'],
  Y: ['yacht', 'yack', 'yoga', 'yak'], Z: ['zaire', 'zebre', 'zone', 'zairois'],
};

function wordForLetter(letter, variant = 0) {
  return WORDS_BY_LETTER[letter.toUpperCase()][variant];
}

module.exports = { wordForLetter };

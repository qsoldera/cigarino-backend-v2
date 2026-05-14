/**
 * Calcule l'empreinte alphanumérique d'un nom de cigare ou de marque.
 * Deux noms "équivalents" doivent produire la même empreinte.
 *
 * Transformations appliquées dans l'ordre :
 *  1. Minuscules
 *  2. Suppression des accents (NFD decomposition)
 *  3. Normalisation des indicateurs de numéro :
 *       no. / n° / no / num. / # / n suivi d'un chiffre → "no"
 *  4. Suppression de tout caractère non alphanumérique (ponctuation, espaces)
 *
 * Exemples :
 *   "Quai d'Orsay No. 50"  → "quaidorsayno50"
 *   "quai d'orsay n 50"    → "quaidorsayno50"
 *   "Quai dorsay no50"     → "quaidorsayno50"
 *   "Romeo y Julieta"      → "romeoyulieta"
 *   "Cohiba Robustos"      → "cohibarobustos"
 *   "H. Upmann No.2"       → "hupmannno2"
 */
function fingerprint(str) {
  if (!str || typeof str !== 'string') return '';

  return str
    // 1. Minuscules
    .toLowerCase()
    // 2. Suppression des accents
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    // 3. Normalisation numérique :
    //    "no.", "no ", "n°", "num.", "num ", "#", "n " + chiffre → "no"
    .replace(/(?:n[o°]?\.?\s*|num\.?\s*|#\s*)(?=\d)/g, 'no')
    // "n" isolé suivi d'espace puis d'un chiffre ("n 50") → "no"
    .replace(/\bn\s+(?=\d)/g, 'no')
    // 4. Tout ce qui n'est pas alphanumérique (espaces inclus)
    .replace(/[^a-z0-9]/g, '');
}

/**
 * Normalisation douce pour l'affichage / le debug.
 * Conserve les espaces, supprime juste les accents et met en minuscules.
 */
function softNormalize(str) {
  if (!str) return '';
  return str
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

module.exports = { fingerprint, softNormalize };

// Petits outils partagés par les autres fichiers
const $ = id => document.getElementById(id);
const nombre = n => (n ?? 0).toLocaleString("fr-FR");
const nomCourt = t => t.replace(/\s*\(.*\)$/, "");
function el(tag, props = {}, ...enfants) {
  const e = document.createElement(tag);
  Object.assign(e, props);
  enfants.forEach(c => e.append(c));
  return e;
}


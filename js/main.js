// Onglets : Boosters, Toutes les cartes, Collection, Échanges
const SECTIONS = {
  boosters: "onglet-boosters",
  cartes: "onglet-cartes",
  collection: "onglet-cartes",      // « Toutes les cartes » et « Collection » partagent la même page
  echanges: "onglet-echanges",
};

function allerA(nom) {
  document.querySelectorAll(".onglet-btn").forEach(x =>
    x.setAttribute("aria-selected", String(x.dataset.onglet === nom)));
  document.querySelectorAll(".onglet").forEach(s => { s.hidden = s.id !== SECTIONS[nom]; });
  const listeCartes = nom === "cartes" || nom === "collection";
  document.body.classList.toggle("page-boosters", nom === "boosters");
  document.body.classList.toggle("plein-ecran", listeCartes);

  if (listeCartes) {
    vue = nom;
    page = 0;
    if (cartes.length) afficher();
  }
  Echanges.afficher(nom === "echanges");
}
document.querySelectorAll(".onglet-btn").forEach(b => { b.onclick = () => allerA(b.dataset.onglet); });

// Recalcule la grille quand la fenêtre change de taille ou quand l'onglet s'affiche
new ResizeObserver(() => { if (cartes.length) afficher(); }).observe($("grille-zone"));

charger();
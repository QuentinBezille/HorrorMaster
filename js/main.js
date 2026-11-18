// Onglets
document.querySelectorAll(".onglet-btn").forEach(b => {
  b.onclick = () => {
    const o = b.dataset.onglet;
    const grille = o === "cartes" || o === "collection";   // les deux onglets partagent la même grille
    document.querySelectorAll(".onglet-btn").forEach(x =>
      x.setAttribute("aria-selected", String(x === b)));
    $("onglet-boosters").hidden = grille;
    $("onglet-cartes").hidden = !grille;
    document.body.classList.toggle("plein-ecran", grille);
    document.body.classList.toggle("page-boosters", !grille);
    if (grille) { vue = o; page = 0; afficher(); }
  };
});

// Recalcule la grille quand la fenêtre change de taille ou quand l'onglet s'affiche
new ResizeObserver(() => { if (cartes.length) afficher(); }).observe($("grille-zone"));

charger();
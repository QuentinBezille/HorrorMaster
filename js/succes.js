// ====== Succès : 50 objectifs avec récompenses en âmes ======
// Les objectifs, les récompenses et la vérification sont dans la base (sql/06_succes.sql) :
// ici on affiche seulement la progression et les notifications.
const Succes = (() => {
  // d(code, catégorie, icône, nom, description ({but} = objectif donné par la base), unité facultative)
  const d = (id, cat, ico, nom, desc, unite) => ({ id, cat, ico, nom, desc, unite: unite || "" });
  const DEFS = [
    // --- Collection ---
    d("col50",   "Collection", "🕯️", "Apprenti",                  "Possède {but} cartes différentes."),
    d("col150",  "Collection", "🎬", "Cinéphile",                 "Possède {but} cartes différentes."),
    d("col300",  "Collection", "📼", "Vidéo-club",                "Possède {but} cartes différentes."),
    d("col600",  "Collection", "🏚️", "Cinémathèque",              "Possède {but} cartes différentes."),
    d("col1000", "Collection", "📚", "Bibliothèque maudite",      "Possède {but} cartes différentes."),
    d("comp50",  "Collection", "🌓", "À mi-chemin de l'enfer",    "Complète {but} % de la collection.", "%"),
    d("comp75",  "Collection", "🌘", "Presque maître",            "Complète {but} % de la collection.", "%"),
    d("comp100", "Collection", "👑", "Horror Master",             "Complète {but} % de la collection.", "%"),
    d("tot150",  "Collection", "📦", "Pioche généreuse",          "Obtiens {but} cartes au total, doubles compris."),
    d("tot600",  "Collection", "🎁", "Boosters à la pelle",       "Obtiens {but} cartes au total, doubles compris."),

    // --- Raretés ---
    d("pc25",  "Raretés", "🍀", "Ça se complique",       "Possède {but} cartes Peu communes différentes."),
    d("r25",   "Raretés", "💧", "Chasseur de raretés",   "Possède {but} cartes Rares différentes."),
    d("sr15",  "Raretés", "🔮", "Frisson violet",        "Possède {but} cartes Super rares différentes."),
    d("ur5",   "Raretés", "🔥", "Feu orange",            "Possède {but} cartes Ultra rares différentes."),
    d("l1",    "Raretés", "⭐", "Légende vivante",       "Obtiens une carte Légendaire."),
    d("r100",  "Raretés", "🌊", "Océan bleu",            "Possède {but} cartes Rares différentes."),
    d("sr50",  "Raretés", "🍇", "Collectionneur violet", "Possède {but} cartes Super rares différentes."),
    d("ur20",  "Raretés", "🌋", "Seigneur de l'orange",  "Possède {but} cartes Ultra rares différentes."),
    d("arc",   "Raretés", "🌈", "Arc-en-ciel sanglant",  "Possède au moins une carte de chaque rareté."),

    // --- Shiny ---
    d("sh1",   "Shiny", "✨", "Ça brille dans le noir", "Obtiens une carte shiny."),
    d("sh5",   "Shiny", "💫", "Chasseur d'éclats",      "Possède {but} cartes shiny."),
    d("sh15",  "Shiny", "🌠", "Pluie d'étoiles",        "Possède {but} cartes shiny."),
    d("sh30",  "Shiny", "🪩", "Constellation",          "Possède {but} cartes shiny."),
    d("shsr",  "Shiny", "💎", "Éclat précieux",         "Obtiens une carte shiny Super rare ou mieux."),
    d("genre", "Shiny", "🎭", "Le genre en personne",   "Obtiens la carte « Film d'horreur »."),

    // --- Doubles et favoris ---
    d("dbl25",  "Doubles et favoris", "👯", "Double peine",       "Possède {but} cartes en double."),
    d("dbl100", "Doubles et favoris", "🃏", "Cartes en double",   "Possède {but} cartes en double."),
    d("q8",     "Doubles et favoris", "🖐️", "Le même, encore",    "Possède {but} exemplaires de la même carte."),
    d("fav10",  "Doubles et favoris", "❤️", "Coups de cœur",      "Mets {but} cartes en favoris."),
    d("fav50",  "Doubles et favoris", "🖤", "Cœur noir",          "Mets {but} cartes en favoris."),
    d("fav150", "Doubles et favoris", "💘", "Passionné",          "Mets {but} cartes en favoris."),

    // --- Époques ---
    d("muet",   "Époques", "🎞️", "Film muet",             "Possède {but} films d'avant 1930."),
    d("av50",   "Époques", "🕰️", "Classiques",            "Possède {but} films d'avant 1950."),
    d("an80",   "Époques", "📺", "Années 80",             "Possède {but} films sortis dans les années 80."),
    d("dec7",   "Époques", "⏳", "Voyageur du temps",     "Possède des films de {but} décennies différentes."),
    d("dec11",  "Époques", "🌀", "Remonter le temps",     "Possède des films de {but} décennies différentes."),
    d("recent", "Époques", "🆕", "À la page",             "Possède {but} films sortis l'an dernier ou cette année."),

    // --- Records des cartes ---
    d("vues", "Records", "📈", "Star du moment", "Possède une carte avec {but} vues ou plus sur 30 jours."),
    d("lang", "Records", "🌍", "Polyglotte",     "Possède une carte dont l'article existe en {but} langues ou plus."),
    d("atq",  "Records", "🪓", "Force brute",    "Possède une carte avec {but} en attaque."),
    d("def",  "Records", "🛡️", "Forteresse",     "Possède une carte avec {but} en défense."),

    // --- Monstres ---
    d("zomb",  "Monstres", "🧟", "Fan de zombies",       "Possède {but} films de zombies."),
    d("vamp",  "Monstres", "🧛", "Chasseur de vampires", "Possède {but} films de vampires."),
    d("fant",  "Monstres", "👻", "Maison hantée",        "Possède {but} films de fantômes ou de hantise."),
    d("slash", "Monstres", "🔪", "Tueur en série",       "Possède {but} films de tueur (Massacre, Halloween, Scream, Saw...)."),

    // --- Social ---
    d("ami1",  "Social", "🤝", "Pas seul dans le noir", "Aie {but} ami dans le jeu."),
    d("ami5",  "Social", "🕸️", "Cercle de sang",        "Aie {but} amis dans le jeu."),
    d("ech1",  "Social", "🔄", "Premier marché noir",   "Réalise {but} échange de cartes."),
    d("ech10", "Social", "🏪", "Négociant",             "Réalise {but} échanges de cartes."),
    d("don1",  "Social", "🎀", "Généreux",              "Offre une carte à un autre joueur."),
  ];
  const CATS = [...new Set(DEFS.map(x => x.cat))];

  let serveur = {};          // code -> { valeur, but, recompense, debloque }
  let manque = false;        // la base n'a pas encore sql/06_succes.sql
  let visible = false;
  let enCours = false;
  let minuteur = null;
  const nombre = n => Number(n).toLocaleString("fr-FR");

  function annoncer(liste, gain) {
    const zone = document.getElementById("succes-toasts") ||
      document.body.appendChild(el("div", { id: "succes-toasts", "aria-live": "polite" }));
    liste.slice(0, 3).forEach((x, i) => {
      const prime = serveur[x.id] ? serveur[x.id].recompense : 0;
      const t = el("div", { className: "succes-toast" },
        el("span", { className: "succes-toast-ico", textContent: x.ico }),
        el("div", {},
          el("b", { textContent: "Succès débloqué" }),
          el("div", { textContent: x.nom }),
          prime ? el("small", { textContent: `+${nombre(prime)} âmes` }) : ""));
      zone.appendChild(t);
      setTimeout(() => t.classList.add("sortie"), 4500 + i * 300);
      setTimeout(() => t.remove(), 5200 + i * 300);
    });
    if (liste.length > 3) {
      const t = el("div", { className: "succes-toast" },
        el("div", {}, el("b", { textContent: `+ ${liste.length - 3} autres succès` }),
          el("small", { textContent: `Total : +${nombre(gain)} âmes` })));
      zone.appendChild(t);
      setTimeout(() => t.remove(), 5200);
    }
    try { Sons.jouer("clic"); } catch (e) { /* son indisponible */ }
  }

  // Demande à la base de vérifier, débloquer et payer ; met à jour l'affichage
  async function verifier() {
    if (!connecte || enCours) return;
    enCours = true;
    try {
      const { data, error } = await sb.rpc("verifier_succes");
      if (error) {
        manque = error.code === "PGRST202" || error.status === 404;
        if (visible) dessiner();
        return;
      }
      manque = false;
      serveur = Object.fromEntries((data.succes || []).map(x => [x.code, x]));
      const nouveaux = (data.nouveaux || []).map(c => DEFS.find(x => x.id === c)).filter(Boolean);
      if (typeof data.ames === "number" && data.ames !== ames) { ames = data.ames; dessinerJoueur(); }
      if (nouveaux.length) annoncer(nouveaux, data.gain);
      if (visible) dessiner();
    } finally {
      enCours = false;
    }
  }

  function dessiner() {
    const z = document.getElementById("succes-contenu");
    if (!z) return;
    if (!connecte) return z.replaceChildren(el("p", { className: "ech-aide", textContent: "Connecte-toi pour débloquer des succès." }));
    if (manque) return z.replaceChildren(el("p", { className: "ech-aide",
      textContent: "Les succès ne sont pas encore installés : exécute sql/06_succes.sql dans Supabase." }));
    if (!Object.keys(serveur).length) return z.replaceChildren(el("p", { className: "ech-aide", textContent: "Chargement…" }));

    const fait = DEFS.filter(x => serveur[x.id] && serveur[x.id].debloque).length;
    const aGagner = DEFS.reduce((t, x) => t + (serveur[x.id] && !serveur[x.id].debloque ? serveur[x.id].recompense : 0), 0);
    const entete = el("div", { className: "succes-entete" },
      el("h2", { textContent: `${fait} / ${DEFS.length} succès débloqués` }),
      el("div", { className: "succes-barre" }, el("i", { style: `width:${Math.round(100 * fait / DEFS.length)}%` })),
      el("p", { className: "succes-sous", textContent: `Encore ${nombre(aGagner)} âmes à gagner.` }));
    const blocs = CATS.map(cat => {
      const liste = DEFS.filter(x => x.cat === cat);
      const ok = liste.filter(x => serveur[x.id] && serveur[x.id].debloque).length;
      return el("section", { className: "succes-cat" },
        el("h3", {}, cat, el("span", { textContent: ` ${ok}/${liste.length}` })),
        el("div", { className: "succes-grille" }, ...liste.map(carte)));
    });
    z.replaceChildren(entete, ...blocs);
  }

  function carte(x) {
    const s = serveur[x.id];
    if (!s) return el("div");
    const ok = !!s.debloque;
    const desc = x.desc.replace("{but}", nombre(s.but));
    const gradue = s.but > 1;
    return el("div", { className: "succes" + (ok ? " ok" : "") },
      el("div", { className: "succes-ico", textContent: ok ? x.ico : "🔒" }),
      el("div", { className: "succes-txt" },
        el("b", { textContent: x.nom }),
        el("p", { textContent: desc }),
        ...(ok
          ? [el("small", { textContent: "Débloqué le " + new Date(s.debloque).toLocaleDateString("fr-FR") })]
          : gradue
            ? [el("div", { className: "succes-barre petite" }, el("i", { style: `width:${Math.round(100 * s.valeur / s.but)}%` })),
               el("small", { textContent: `${nombre(s.valeur)}${x.unite} / ${nombre(s.but)}${x.unite}` })]
            : [])),
      el("div", { className: "succes-prime" + (ok ? " recue" : ""), textContent: (ok ? "✓ " : "+") + nombre(s.recompense) + " 👻" }));
  }

  async function session() {
    clearInterval(minuteur);
    serveur = {};
    if (!connecte) { if (visible) dessiner(); return; }
    await verifier();
    // Surveille les changements (favoris, échanges reçus...) toutes les 30 secondes
    minuteur = setInterval(() => { if (!document.hidden) verifier(); }, 30000);
  }

  async function afficher(v) {
    visible = v;
    if (!v) return;
    dessiner();
    await verifier();
  }

  return { session, verifier, afficher, total: DEFS.length };
})();
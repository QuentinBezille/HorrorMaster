// ====== Échanges de cartes entre joueurs ======
// Tout se passe côté base (sql/03_echanges.sql) : ici on affiche et on envoie les demandes.
const Echanges = (() => {
  let pseudo = null;
  let liste = [];            // échanges envoyés et reçus (venant du serveur)
  let autre = null;          // { pseudo, cartes: Map(id -> quantité) } : le joueur dont on regarde les cartes
  let donne = null;          // id de la carte que je donne
  let veut = null;           // id de la carte que je veux recevoir
  let visible = false;       // l'onglet est-il ouvert ?
  let charge = false;        // premier chargement terminé ?
  let manque = false;        // fonctions SQL pas encore installées ?
  let mode = null;           // ce qui est dessiné : deco, attente, manque, pseudo ou main
  let generation = 0;        // pour ignorer les réponses d'une ancienne session
  let minuteur = null;
  let selDonne = null;
  let selVeut = null;
  let index = null;
  let indexN = -1;

  const STATUTS = { accepte: "Accepté", refuse: "Refusé", annule: "Annulé" };

  function carteDe(id) {
    if (indexN !== cartes.length) {
      index = new Map(cartes.map(c => [c.id, c]));
      indexN = cartes.length;
    }
    return index.get(id);
  }

  function info(t) {
    const z = $("ech-statut");
    if (z) z.textContent = t || "";
  }

  // Pastille « Échanges (2) » sur l'onglet quand des propositions attendent une réponse
  function majBadge() {
    const n = liste.filter(e => e.sens === "recu" && e.statut === "en_attente").length;
    const b = document.querySelector('.onglet-btn[data-onglet="echanges"]');
    if (!b) return;
    b.textContent = n ? `Échanges (${n})` : "Échanges";
    b.classList.toggle("alerte", n > 0);
  }

  // ---------- Chargement ----------
  async function rafraichir() {
    if (!connecte) return;
    const jeton = generation;
    const [p, e] = await Promise.all([
      sb.from("players").select("pseudo").maybeSingle(),
      sb.rpc("mes_echanges"),
    ]);
    if (jeton !== generation || !connecte) return;   // déconnecté ou changé de compte pendant la requête
    manque = !!e.error && (e.error.code === "PGRST202" || e.status === 404);
    if (!p.error && p.data) pseudo = p.data.pseudo || null;
    if (!e.error) liste = e.data || [];
    else if (!manque && visible) info("Impossible de lire les échanges : " + e.error.message);
    charge = true;
    majBadge();
    if (visible) majAffichage();
  }

  // Appelé à chaque connexion / déconnexion
  function session() {
    generation++;
    pseudo = null; liste = []; autre = null; donne = null; veut = null;
    charge = false; manque = false; mode = null;
    clearInterval(minuteur);
    majBadge();
    if (connecte) {
      minuteur = setInterval(() => { if (!document.hidden) rafraichir(); }, 45000);
      rafraichir();
    }
    if (visible) majAffichage();
  }

  // Appelé quand on arrive sur l'onglet ou qu'on le quitte
  function afficherOnglet(v) {
    visible = v;
    if (!v) return;
    info("");
    majAffichage();
    if (mode === "main" && selDonne) selDonne.donner(possedees);   // la collection a pu changer
    rafraichir();
  }

  // ---------- Affichage ----------
  function majAffichage() {
    const z = $("ech-contenu");
    if (!z) return;
    const voulu = !connecte ? "deco" : !charge ? "attente" : manque ? "manque" : !pseudo ? "pseudo" : "main";
    if (voulu === mode) {
      if (mode === "main") dessinerListes();   // simple mise à jour : on ne touche pas au formulaire
      return;
    }
    mode = voulu;
    if (voulu === "deco") {
      z.replaceChildren(el("p", { className: "vide" },
        "Connecte-toi depuis l'onglet Boosters pour échanger des cartes avec les autres joueurs."));
    } else if (voulu === "attente") {
      z.replaceChildren(el("p", { className: "vide" }, "Chargement…"));
    } else if (voulu === "manque") {
      z.replaceChildren(el("p", { className: "erreur" },
        "Les échanges ne sont pas encore installés : exécute sql/03_echanges.sql dans le SQL Editor de Supabase, puis recharge la page."));
    } else if (voulu === "pseudo") {
      dessinerPseudo(z);
    } else {
      dessinerPrincipal(z);
    }
  }

  function dessinerPseudo(z) {
    const champ = el("input", { type: "text", name: "pseudo-choisi", placeholder: "Ton pseudo",
      autocomplete: "off", maxLength: 20 });
    champ.setAttribute("aria-label", "Ton pseudo");
    const ok = el("button", { className: "bouton principal", type: "button", textContent: "Valider" });
    async function valider() {
      ok.disabled = true;
      const { data, error } = await sb.rpc("definir_pseudo", { p_pseudo: champ.value });
      ok.disabled = false;
      if (error) return info(error.message);
      info("");
      pseudo = data;
      majAffichage();
    }
    ok.onclick = valider;
    champ.addEventListener("keydown", ev => { if (ev.key === "Enter") valider(); });
    z.replaceChildren(el("section", { className: "ech-bloc" },
      el("h2", { textContent: "Choisis ton pseudo" }),
      el("p", { className: "ech-aide" },
        "Les autres joueurs te trouveront avec ce pseudo pour te proposer des échanges. 3 à 20 caractères : lettres, chiffres, _ ou -."),
      el("div", { className: "ech-ligne" }, champ, ok)));
  }

  // Un sélecteur de cartes : recherche + petite grille où l'on clique pour choisir
  function creerSelecteur(titre, onChoix) {
    const s = { source: new Map(), choisi: null, q: "" };
    const recherche = el("input", { type: "search", name: "ech-recherche", placeholder: "Chercher un film",
      autocomplete: "off" });
    recherche.setAttribute("aria-label", titre + " : chercher un film");
    const grille = el("div", { className: "ech-grille" });
    const note = el("p", { className: "ech-note" });
    const boite = el("div", { className: "ech-selecteur" }, el("h3", { textContent: titre }), recherche, grille, note);
    const MAX = 60;

    function dessiner() {
      const q = s.q.trim().toLowerCase();
      const items = [];
      s.source.forEach((qte, id) => {
        const c = carteDe(id);
        if (c && (!q || c.titre.toLowerCase().includes(q))) items.push([c, qte]);
      });
      items.sort((a, b) => ORDRE[b[0].rarete] - ORDRE[a[0].rarete] || a[0].titre.localeCompare(b[0].titre, "fr"));
      grille.replaceChildren(...items.slice(0, MAX).map(([c, qte]) => {
        const b = carte(c);
        const k = b.querySelector(".quantite");
        if (k) k.remove();                    // la pastille de carte() compte MES exemplaires : on met la bonne
        if (qte > 1) b.append(el("span", { className: "quantite", textContent: String(qte), title: qte + " exemplaires" }));
        b.classList.toggle("choisie", s.choisi === c.id);
        b.setAttribute("aria-pressed", String(s.choisi === c.id));
        b.onclick = () => {
          s.choisi = s.choisi === c.id ? null : c.id;
          onChoix(s.choisi);
          dessiner();
        };
        return el("div", { className: "carte-cell" }, b);
      }));
      note.textContent = !s.source.size ? "Aucune carte disponible."
        : !items.length ? "Aucune carte ne correspond."
        : items.length > MAX ? `${MAX} cartes affichées sur ${items.length} : affine ta recherche.` : "";
    }

    recherche.addEventListener("input", () => { s.q = recherche.value; dessiner(); });
    return {
      boite,
      donner(source) {
        s.source = source;
        if (s.choisi !== null && !source.has(s.choisi)) { s.choisi = null; onChoix(null); }
        dessiner();
      },
    };
  }

  function dessinerPrincipal(z) {
    const champ = el("input", { type: "text", id: "ech-pseudo", name: "pseudo-autre-joueur",
      placeholder: "Pseudo de l'autre joueur", autocomplete: "off", maxLength: 20 });
    champ.setAttribute("aria-label", "Pseudo de l'autre joueur");
    const voir = el("button", { className: "bouton", type: "button", textContent: "Voir ses cartes" });
    const resume = el("p", { className: "ech-resume" });
    const envoyer = el("button", { className: "bouton principal", type: "button", textContent: "Proposer l'échange" });
    const fleche = el("div", { className: "ech-fleche", textContent: "⇄" });
    fleche.setAttribute("aria-hidden", "true");

    function majResume() {
      const a = donne && carteDe(donne), b = veut && carteDe(veut);
      const ok = !!(autre && a && b);
      envoyer.disabled = !ok;
      resume.textContent = ok
        ? `Tu donnes « ${nomCourt(a.titre)} » à ${autre.pseudo} contre « ${nomCourt(b.titre)} ».`
        : "Choisis un joueur, une carte à donner et une carte à recevoir.";
    }

    selDonne = creerSelecteur("Tu donnes", id => { donne = id; majResume(); });
    selVeut = creerSelecteur("Tu reçois", id => { veut = id; majResume(); });
    selDonne.donner(possedees);
    selVeut.donner(autre ? autre.cartes : new Map());

    function oublierAutre() {
      autre = null; veut = null;
      selVeut.donner(new Map());
      majResume();
    }

    async function chargerAutre() {
      const nom = champ.value.trim();
      if (!nom) return info("Écris le pseudo de l'autre joueur.");
      info("");
      voir.disabled = true;
      const { data, error } = await sb.rpc("voir_collection", { p_pseudo: nom });
      voir.disabled = false;
      if (error) { oublierAutre(); return info(error.message); }
      autre = { pseudo: nom, cartes: new Map(data.map(l => [l.card_id, l.quantite])) };
      veut = null;
      selVeut.donner(autre.cartes);
      if (!autre.cartes.size) info(nom + " n'a encore aucune carte.");
      majResume();
    }
    voir.onclick = chargerAutre;
    champ.addEventListener("keydown", ev => { if (ev.key === "Enter") chargerAutre(); });
    champ.addEventListener("input", () => {
      if (autre && champ.value.trim().toLowerCase() !== autre.pseudo.toLowerCase()) oublierAutre();
    });
    if (autre) champ.value = autre.pseudo;

    envoyer.onclick = async () => {
      if (!autre || !donne || !veut) return;
      envoyer.disabled = true;
      const { error } = await sb.rpc("proposer_echange",
        { p_pseudo: autre.pseudo, p_donnee: donne, p_voulue: veut });
      if (error) {
        Sons.jouer("erreur");
        info(error.message);
        majResume();
        return;
      }
      Sons.jouer("clic");
      info("Proposition envoyée à " + autre.pseudo + ".");
      donne = null; veut = null;
      selDonne.donner(possedees);
      selVeut.donner(autre.cartes);
      majResume();
      await rafraichir();
    };

    z.replaceChildren(
      el("p", { className: "ech-pseudo" }, "Ton pseudo : ", el("b", { textContent: pseudo }),
        " — donne-le à tes amis pour qu'ils te proposent des échanges."),
      el("section", { className: "ech-bloc" },
        el("h2", { textContent: "Proposer un échange" }),
        el("div", { className: "ech-ligne" }, champ, voir),
        el("div", { className: "ech-duo" }, selDonne.boite, fleche, selVeut.boite),
        el("div", { className: "ech-ligne" }, envoyer, resume)),
      el("div", { id: "ech-listes" }));
    dessinerListes();
    majResume();
  }

  // Petite carte cliquable (ouvre la fiche) sans pastille d'exemplaires
  function vignette(c) {
    if (!c) return el("div", { className: "ech-mini ech-inconnue", textContent: "?" });
    const b = carte(c);
    const k = b.querySelector(".quantite");
    if (k) k.remove();
    return el("div", { className: "carte-cell ech-mini" }, b);
  }

  function ligne(e) {
    const recu = e.sens === "recu";
    // du point de vue du joueur : ce qu'il donne et ce qu'il reçoit
    const mienne = carteDe(recu ? e.carte_voulue : e.carte_donnee);
    const leur = carteDe(recu ? e.carte_donnee : e.carte_voulue);
    const attente = e.statut === "en_attente";
    const actions = el("div", { className: "ech-actions" });
    if (attente && recu) {
      const oui = el("button", { className: "bouton principal", type: "button", textContent: "Accepter" });
      const non = el("button", { className: "bouton", type: "button", textContent: "Refuser" });
      oui.onclick = () => repondre(e, "accepter", [oui, non]);
      non.onclick = () => repondre(e, "refuser", [oui, non]);
      actions.append(oui, non);
    } else if (attente) {
      const ann = el("button", { className: "bouton", type: "button", textContent: "Annuler" });
      ann.onclick = () => repondre(e, "annuler", [ann]);
      actions.append(ann);
    } else {
      actions.append(el("span", { className: "ech-statut-fin", textContent: STATUTS[e.statut] || e.statut }));
    }
    const fleche = el("span", { className: "ech-fleche", textContent: "⇄" });
    fleche.setAttribute("aria-hidden", "true");
    const row = el("div", { className: "ech-ligne-echange" },
      el("div", { className: "ech-qui", textContent: recu ? `${e.autre} te propose` : `Proposé à ${e.autre}` }),
      el("div", { className: "ech-cartes" },
        el("div", { className: "ech-cote" }, el("span", { textContent: "Tu donnes" }), vignette(mienne)),
        fleche,
        el("div", { className: "ech-cote" }, el("span", { textContent: "Tu reçois" }), vignette(leur))),
      actions);
    row.dataset.statut = e.statut;
    return row;
  }

  function bloc(titre, items, vide) {
    return el("section", { className: "ech-bloc" },
      el("h2", { textContent: titre }),
      items.length
        ? el("div", { className: "ech-liste" }, ...items.map(ligne))
        : el("p", { className: "vide", textContent: vide }));
  }

  function dessinerListes() {
    const z = $("ech-listes");
    if (!z) return;
    const recus = liste.filter(e => e.sens === "recu" && e.statut === "en_attente");
    const envoyes = liste.filter(e => e.sens === "envoye" && e.statut === "en_attente");
    const histo = liste.filter(e => e.statut !== "en_attente").slice(0, 15);
    z.replaceChildren(
      bloc(`Propositions reçues (${recus.length})`, recus, "Aucune proposition reçue."),
      bloc(`Propositions envoyées (${envoyes.length})`, envoyes, "Aucune proposition en attente."),
      bloc("Historique", histo, "Aucun échange terminé pour l'instant."));
  }

  async function repondre(e, action, boutons) {
    boutons.forEach(b => { b.disabled = true; });
    const { data, error } = await sb.rpc("repondre_echange", { p_id: e.id, p_action: action });
    if (error) {
      Sons.jouer("erreur");
      info(error.message);
      boutons.forEach(b => { b.disabled = false; });
      return;
    }
    const refuse = data && data.ok === false;
    if (refuse) info(data.message || "Échange impossible.");
    else if (action === "accepter") { Sons.jouer("echange"); info("Échange effectué !"); }
    else info(action === "refuser" ? "Échange refusé." : "Échange annulé.");
    if (action === "accepter" || refuse) {
      await rafraichirJoueur();       // les cartes ont changé : on relit la collection
      dessinerJoueur();
      afficher();
      if (selDonne) selDonne.donner(possedees);
    }
    await rafraichir();
  }

  return { session, afficher: afficherOnglet };
})();

// ====== Échanges, dons et contre-offres entre joueurs ======
// Tout se passe côté base (sql/04_amis_dons_shiny.sql) : ici on affiche et on envoie les demandes.
const Echanges = (() => {
  let pseudo = null;
  let liste = [];            // échanges envoyés et reçus (venant du serveur)
  let autre = null;          // { pseudo, cartes: Map(id -> quantité) } : le joueur dont on regarde les cartes
  let donne = null;          // id de la carte que je donne
  let veut = null;           // id de la carte que je veux recevoir
  let genre = "echange";     // "echange" ou "don" (envoyer une carte)
  let contre = null;         // l'échange reçu auquel je réponds par une contre-offre
  let demande = null;        // { pseudo, genre } : demandé depuis l'onglet Amis
  let connus = null;         // statut de chaque échange la dernière fois : sert à repérer ce qui vient de changer
  let visible = false;       // l'onglet est-il ouvert ?
  let charge = false;        // premier chargement terminé ?
  let manque = false;        // fonctions SQL pas encore installées ?
  let mode = null;           // ce qui est dessiné : deco, attente, manque, pseudo ou main
  let generation = 0;        // pour ignorer les réponses d'une ancienne session
  let minuteur = null;
  let selDonne = null;
  let selVeut = null;
  let pilote = null;         // petites commandes du formulaire (préparer un envoi, une contre-offre...)
  let dernierAppel = 0;      // pour ne pas interroger le serveur trop souvent

  const STATUTS = { accepte: "Accepté", refuse: "Refusé", annule: "Annulé", contre_offre: "Contre-proposé" };
  const carteDe = id => parId.get(id);

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

  // Les cartes ont-elles changé de main depuis la dernière fois ? (échange accepté par l'autre, cadeau reçu...)
  // Si oui, il faut relire MA collection : sinon l'écran montre encore l'ancienne situation.
  async function relireSiChange(avant) {
    if (!avant) return;
    let message = null;
    for (const e of liste) {
      const vu = avant.get(e.id);
      if (e.statut === "accepte" && vu !== "accepte" && !(vu === undefined && e.sens === "envoye")) {
        const c = carteDe(e.carte_donnee);
        message = e.type === "don"
          ? `${e.autre} t'a envoyé « ${c ? nomCourt(c.titre) : "une carte"} ».`
          : `${e.autre} a accepté ton échange : tes cartes ont changé !`;
      } else if (e.statut === "en_attente" && e.sens === "recu" && vu === undefined && e.parent_id) {
        message = message || `${e.autre} te propose une contre-offre.`;
      }
    }
    if (!message) return;
    Sons.jouer("echange");
    await rafraichirJoueur();
    dessinerJoueur();
    afficher();
    if (selDonne) selDonne.donner(possedees);
    info(message);
  }

  // ---------- Chargement ----------
  async function rafraichir() {
    if (!connecte) return;
    dernierAppel = Date.now();
    const jeton = generation;
    const uid = await monId();
    const [p, e] = await Promise.all([
      sb.from("players").select("pseudo").eq("id", uid).maybeSingle(),
      sb.rpc("mes_echanges"),
    ]);
    if (jeton !== generation || !connecte) return;   // déconnecté ou changé de compte pendant la requête
    manque = !!e.error && (e.error.code === "PGRST202" || e.status === 404);
    if (!p.error && p.data) pseudo = p.data.pseudo || null;
    if (!pseudo && monPseudo) pseudo = monPseudo;   // déjà connu depuis la connexion
    if (!e.error) {
      const nouvelle = e.data || [];
      await assurerCartes(nouvelle.flatMap(x => [x.carte_donnee, x.carte_voulue]).filter(Boolean));
      if (jeton !== generation || !connecte) return;
      const avant = connus;
      liste = nouvelle;
      connus = new Map(liste.map(x => [x.id, x.statut]));
      await relireSiChange(avant);
    } else if (!manque && visible) {
      info("Impossible de lire les échanges : " + e.error.message);
    }
    charge = true;
    majBadge();
    if (visible) majAffichage();
  }

  // Appelé à chaque connexion / déconnexion
  function session() {
    generation++;
    pseudo = null; liste = []; autre = null; donne = null; veut = null; contre = null; genre = "echange";
    charge = false; manque = false; mode = null; connus = null;
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
    if (mode === "main" && pilote) pilote.amis();
    appliquerDemande();
    rafraichir();
  }

  // Depuis l'onglet Amis : « Échanger » ou « Envoyer une carte » avec ce joueur
  function avec(nom, g) {
    demande = { pseudo: nom, genre: g };
    appliquerDemande();
  }
  function appliquerDemande() {
    if (!demande || mode !== "main" || !pilote) return;
    const d = demande;
    demande = null;
    pilote.preparer(d.pseudo, d.genre, null);
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
        "Les échanges ne sont pas encore installés : exécute sql/04_amis_dons_shiny.sql dans le SQL Editor de Supabase, puis recharge la page."));
    } else if (voulu === "pseudo") {
      dessinerPseudo(z);
    } else {
      dessinerPrincipal(z);
    }
  }

  // Compte sans pseudo : le pseudo se renseigne uniquement dans la fenêtre de connexion, pas ici
  function dessinerPseudo(z) {
    z.replaceChildren(el("section", { className: "ech-bloc" },
      el("h2", { textContent: "Pseudo manquant" }),
      el("p", { className: "ech-aide" },
        "Ton pseudo n'est pas encore enregistré. Recharge la page ou reconnecte-toi : il se renseigne dans la fenêtre de connexion.")));
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
      choisir(id) {
        s.choisi = id !== null && s.source.has(id) ? id : null;
        onChoix(s.choisi);
        dessiner();
      },
    };
  }

  function dessinerPrincipal(z) {
    const champ = el("input", { type: "text", id: "ech-pseudo", name: "pseudo-autre-joueur",
      placeholder: "Pseudo de l'autre joueur", autocomplete: "off", maxLength: 20 });
    champ.setAttribute("aria-label", "Pseudo de l'autre joueur");
    champ.setAttribute("list", "ech-amis");
    const amisListe = el("datalist", { id: "ech-amis" });
    const voir = el("button", { className: "bouton", type: "button", textContent: "Voir ses cartes" });
    const resume = el("p", { className: "ech-resume" });
    const envoyer = el("button", { className: "bouton principal", type: "button", textContent: "Proposer l'échange" });
    const fleche = el("div", { className: "ech-fleche", textContent: "⇄" });
    fleche.setAttribute("aria-hidden", "true");
    const bEchange = el("button", { className: "bouton petit", type: "button", textContent: "Échanger" });
    const bDon = el("button", { className: "bouton petit", type: "button", textContent: "Envoyer une carte" });
    const modes = el("div", { className: "ech-modes", role: "group" }, bEchange, bDon);
    modes.setAttribute("aria-label", "Type d'envoi");
    const banniere = el("div", { className: "ech-contre", hidden: true });
    let confirmerDon = false;
    let minuteurDon = null;

    const nomAutre = () => (autre ? autre.pseudo : champ.value.trim());
    function resetConfirmation() {
      confirmerDon = false;
      clearTimeout(minuteurDon);
    }

    function majResume() {
      const a = donne && carteDe(donne), b = veut && carteDe(veut);
      const don = genre === "don";
      const nom = nomAutre();
      let ok, texte;
      if (don) {
        ok = !!(nom && a);
        texte = ok
          ? `Tu envoies « ${nomCourt(a.titre)} » à ${nom}. Elle arrive tout de suite chez lui et tu ne pourras pas la reprendre.`
          : "Écris le pseudo du joueur, puis choisis la carte à lui envoyer.";
      } else {
        ok = !!(autre && a && b);
        texte = ok
          ? `Tu donnes « ${nomCourt(a.titre)} » à ${autre.pseudo} contre « ${nomCourt(b.titre)} ».`
          : "Choisis un joueur, une carte à donner et une carte à recevoir.";
      }
      envoyer.disabled = !ok;
      envoyer.textContent = don ? (confirmerDon ? "Confirmer l'envoi" : "Envoyer la carte")
        : contre ? "Envoyer la contre-offre" : "Proposer l'échange";
      resume.textContent = texte;
    }

    function majMode() {
      const don = genre === "don";
      bEchange.setAttribute("aria-pressed", String(!don));
      bDon.setAttribute("aria-pressed", String(don));
      modes.hidden = !!contre;
      selVeut.boite.hidden = don;
      fleche.hidden = don;
      voir.hidden = don;
      banniere.hidden = !contre;
      if (contre) {
        banniere.replaceChildren(
          el("span", { textContent: `Contre-offre à ${contre.autre} : elle remplace sa proposition.` }),
          el("button", { className: "bouton petit", type: "button", textContent: "Annuler la contre-offre",
            onclick: () => { contre = null; donne = null; veut = null; selDonne.choisir(null); selVeut.choisir(null); majMode(); majResume(); } }));
      }
      resetConfirmation();
      majResume();
    }

    selDonne = creerSelecteur("Tu donnes", id => { donne = id; resetConfirmation(); majResume(); });
    selVeut = creerSelecteur("Tu reçois", id => { veut = id; majResume(); });
    selDonne.donner(possedees);
    selVeut.donner(autre ? autre.cartes : new Map());

    function oublierAutre() {
      autre = null; veut = null;
      selVeut.donner(new Map());
      majResume();
    }

    async function chargerAutre(nom) {
      nom = (nom || champ.value).trim();
      if (!nom) { info("Écris le pseudo de l'autre joueur."); return false; }
      info("");
      voir.disabled = true;
      const { data, error } = await sb.rpc("voir_collection", { p_pseudo: nom });
      voir.disabled = false;
      if (error) { oublierAutre(); info(error.message); return false; }
      const cartesAutre = new Map(data.map(l => [l.card_id, l.quantite]));
      await assurerCartes([...cartesAutre.keys()]);
      autre = { pseudo: nom, cartes: cartesAutre };
      veut = null;
      selVeut.donner(autre.cartes);
      if (!autre.cartes.size) info(nom + " n'a encore aucune carte.");
      majResume();
      return true;
    }
    voir.onclick = () => chargerAutre();
    champ.addEventListener("keydown", ev => { if (ev.key === "Enter") chargerAutre(); });
    champ.addEventListener("input", () => {
      if (autre && champ.value.trim().toLowerCase() !== autre.pseudo.toLowerCase()) oublierAutre();
      else majResume();
    });
    if (autre) champ.value = autre.pseudo;

    bEchange.onclick = () => { genre = "echange"; majMode(); };
    bDon.onclick = () => { genre = "don"; majMode(); };

    function remplirAmis() {
      const noms = typeof Amis !== "undefined" ? Amis.pseudos() : [];
      amisListe.replaceChildren(...noms.map(n => el("option", { value: n })));
    }

    // Prépare le formulaire depuis l'extérieur : un ami, ou une contre-offre
    async function preparer(nom, g, e) {
      genre = g || "echange";
      contre = e || null;
      donne = null; veut = null;
      champ.value = nom;
      selDonne.donner(possedees);
      if (contre) {
        const ok = await chargerAutre(nom);
        if (ok) {
          selDonne.choisir(contre.carte_voulue);     // mes cartes : celle qu'il voulait de moi
          selVeut.choisir(contre.carte_donnee);      // les siennes : celle qu'il m'offrait
        }
      } else if (genre === "echange") {
        await chargerAutre(nom);
      } else {
        oublierAutre();
      }
      majMode();
      champ.scrollIntoView({ behavior: "smooth", block: "center" });
    }
    pilote = { preparer, amis: remplirAmis };

    envoyer.onclick = async () => {
      const don = genre === "don";
      if (don) {
        if (!donne || !nomAutre()) return;
        if (!confirmerDon) {         // 1er clic : on demande confirmation, car un envoi est définitif
          confirmerDon = true;
          minuteurDon = setTimeout(() => { confirmerDon = false; majResume(); }, 6000);
          majResume();
          return;
        }
        resetConfirmation();
        envoyer.disabled = true;
        const a = carteDe(donne);
        const { error } = await sb.rpc("envoyer_carte", { p_pseudo: nomAutre(), p_carte: donne });
        if (error) { Sons.jouer("erreur"); info(error.message); majResume(); return; }
        Sons.jouer("echange");
        info(`« ${a ? nomCourt(a.titre) : "La carte"} » a été envoyée à ${nomAutre()}.`);
        donne = null;
        await rafraichirJoueur();       // la carte a quitté ma collection : on relit tout de suite
        dessinerJoueur();
        afficher();
        selDonne.donner(possedees);
        majResume();
        await rafraichir();
        return;
      }

      if (!autre || !donne || !veut) return;
      if (contre && donne === contre.carte_voulue && veut === contre.carte_donnee) {
        info("Une contre-offre doit changer au moins une des deux cartes.");
        return;
      }
      envoyer.disabled = true;
      const { error } = contre
        ? await sb.rpc("contre_offre", { p_id: contre.id, p_donnee: donne, p_voulue: veut })
        : await sb.rpc("proposer_echange", { p_pseudo: autre.pseudo, p_donnee: donne, p_voulue: veut });
      if (error) {
        Sons.jouer("erreur");
        info(error.message);
        majResume();
        return;
      }
      Sons.jouer("clic");
      info(contre ? "Contre-offre envoyée à " + autre.pseudo + "." : "Proposition envoyée à " + autre.pseudo + ".");
      contre = null;
      donne = null; veut = null;
      selDonne.choisir(null);
      selVeut.donner(autre.cartes);
      majMode();
      await rafraichir();
    };

    z.replaceChildren(
      el("p", { className: "ech-pseudo" }, "Ton pseudo : ", el("b", { textContent: pseudo }),
        " — tes amis te trouvent avec ce pseudo."),
      el("section", { className: "ech-bloc", id: "ech-formulaire" },
        el("h2", { textContent: "Échanger ou envoyer une carte" }),
        modes,
        banniere,
        el("div", { className: "ech-ligne" }, champ, amisListe, voir),
        el("div", { className: "ech-duo" }, selDonne.boite, fleche, selVeut.boite),
        el("div", { className: "ech-ligne" }, envoyer, resume)),
      el("div", { id: "ech-listes" }));
    remplirAmis();
    dessinerListes();
    majMode();
    appliquerDemande();
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
    const attente = e.statut === "en_attente";
    const actions = el("div", { className: "ech-actions" });
    const fleche = el("span", { className: "ech-fleche", textContent: "⇄" });
    fleche.setAttribute("aria-hidden", "true");
    let qui, cartesEl;

    if (e.type === "don") {
      qui = recu ? `${e.autre} t'a envoyé une carte` : `Envoyée à ${e.autre}`;
      cartesEl = el("div", { className: "ech-cartes" },
        el("div", { className: "ech-cote" }, el("span", { textContent: recu ? "Tu reçois" : "Tu donnes" }),
          vignette(carteDe(e.carte_donnee))));
      actions.append(el("span", { className: "ech-statut-fin", textContent: recu ? "Reçue" : "Envoyée" }));
    } else {
      // du point de vue du joueur : ce qu'il donne et ce qu'il reçoit
      const mienne = carteDe(recu ? e.carte_voulue : e.carte_donnee);
      const leur = carteDe(recu ? e.carte_donnee : e.carte_voulue);
      qui = recu
        ? (e.parent_id ? `${e.autre} te propose une contre-offre` : `${e.autre} te propose`)
        : (e.parent_id ? `Contre-offre envoyée à ${e.autre}` : `Proposé à ${e.autre}`);
      cartesEl = el("div", { className: "ech-cartes" },
        el("div", { className: "ech-cote" }, el("span", { textContent: "Tu donnes" }), vignette(mienne)),
        fleche,
        el("div", { className: "ech-cote" }, el("span", { textContent: "Tu reçois" }), vignette(leur)));
      if (attente && recu) {
        const oui = el("button", { className: "bouton principal", type: "button", textContent: "Accepter" });
        const cont = el("button", { className: "bouton", type: "button", textContent: "Contre-offre" });
        const non = el("button", { className: "bouton", type: "button", textContent: "Refuser" });
        oui.onclick = () => repondre(e, "accepter", [oui, cont, non]);
        non.onclick = () => repondre(e, "refuser", [oui, cont, non]);
        cont.onclick = () => { if (pilote) pilote.preparer(e.autre, "echange", e); };
        actions.append(oui, cont, non);
      } else if (attente) {
        const ann = el("button", { className: "bouton", type: "button", textContent: "Annuler" });
        ann.onclick = () => repondre(e, "annuler", [ann]);
        actions.append(ann);
      } else {
        actions.append(el("span", { className: "ech-statut-fin", textContent: STATUTS[e.statut] || e.statut }));
      }
    }
    const row = el("div", { className: "ech-ligne-echange" },
      el("div", { className: "ech-qui", textContent: qui }), cartesEl, actions);
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
    if (connus && data && data.statut) connus.set(e.id, data.statut);   // déjà géré ici : pas de doublon de notification
    if (action === "accepter" || refuse) {
      await rafraichirJoueur();       // les cartes ont changé : on relit la collection
      dessinerJoueur();
      afficher();
      if (selDonne) selDonne.donner(possedees);
    }
    await rafraichir();
  }

  // Appelé quand on ouvre un onglet qui montre ma collection : on vérifie vite si des cartes ont changé de main
  function actualiser() {
    if (connecte && charge && Date.now() - dernierAppel > 8000) rafraichir();
  }

  return { session, afficher: afficherOnglet, avec, actualiser };
})();
// ====== Échanges (plusieurs cartes), cadeaux et contre-offres entre joueurs ======
// Tout se passe côté base (sql/04 puis sql/07_echanges_multiples.sql) : ici on affiche et on envoie les demandes.
const Echanges = (() => {
  let pseudo = null;
  let liste = [];            // échanges envoyés et reçus (venant du serveur)
  let autre = null;          // { pseudo, cartes: Map(id -> quantité) } : le joueur dont on regarde les cartes
  let donne = new Set();     // ids des cartes que je donne
  let veut = new Set();      // ids des cartes que je veux recevoir (vide = cadeau)
  let contre = null;         // l'échange reçu auquel je réponds par une contre-offre
  let demande = null;        // { pseudo } : demandé depuis l'onglet Amis
  let connus = null;         // statut de chaque échange la dernière fois : sert à repérer ce qui vient de changer
  let visible = false;       // l'onglet est-il ouvert ?
  let charge = false;        // premier chargement terminé ?
  let manque = false;        // fonctions SQL pas encore installées ?
  let mode = null;           // ce qui est dessiné : deco, attente, manque, pseudo ou main
  let sous = null;           // sous-onglet ouvert : "recu", "envoyer" ou "histo" (null = pas encore choisi)
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
        const ids = e.cartes_donnees || [];
        const c = carteDe(ids[0]);
        message = e.type === "don"
          ? (ids.length > 1 ? `${e.autre} t'a envoyé ${ids.length} cartes.`
                            : `${e.autre} t'a envoyé « ${c ? nomCourt(c.titre) : "une carte"} ».`)
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
      await assurerCartes(nouvelle.flatMap(x => [...(x.cartes_donnees || []), ...(x.cartes_voulues || [])]));
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
    pseudo = null; liste = []; autre = null; donne = new Set(); veut = new Set(); contre = null;
    charge = false; manque = false; mode = null; connus = null; sous = null;
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

  // Depuis l'onglet Amis : « Échanger / offrir » avec ce joueur
  function avec(nom) {
    demande = { pseudo: nom };
    appliquerDemande();
  }
  function appliquerDemande() {
    if (!demande || mode !== "main" || !pilote) return;
    const d = demande;
    demande = null;
    pilote.preparer(d.pseudo, null);
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
        "Les échanges ne sont pas encore installés : exécute sql/04_amis_dons_shiny.sql puis sql/07_echanges_multiples.sql dans le SQL Editor de Supabase, puis recharge la page."));
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

  const MAX_CARTES = 10;
  const pluriel = n => n + " carte" + (n > 1 ? "s" : "");

  // Un sélecteur de cartes : recherche + petite grille où l'on clique pour (dé)cocher plusieurs cartes
  function creerSelecteur(titre, onChoix, texteVide) {
    const s = { source: new Map(), choisi: new Set(), q: "" };
    const recherche = el("input", { type: "search", name: "ech-recherche", placeholder: "Chercher un film",
      autocomplete: "off" });
    recherche.setAttribute("aria-label", titre + " : chercher un film");
    const grille = el("div", { className: "ech-grille" });
    const note = el("p", { className: "ech-note" });
    const vider = el("button", { className: "bouton petit ech-vider", type: "button", textContent: "Tout décocher", hidden: true });
    const entete = el("h3", { textContent: titre });
    const boite = el("div", { className: "ech-selecteur" }, entete, recherche, grille, note, vider);
    const MAX = 60;
    let alerteMax = false;

    function prevenir() { onChoix(new Set(s.choisi)); }

    function dessiner() {
      const q = s.q.trim().toLowerCase();
      const items = [];
      s.source.forEach((qte, id) => {
        const c = carteDe(id);
        if (c && (!q || c.titre.toLowerCase().includes(q))) items.push([c, qte]);
      });
      // les cartes déjà cochées d'abord, pour ne jamais les perdre de vue
      items.sort((a, b) => (s.choisi.has(b[0].id) - s.choisi.has(a[0].id)) ||
        ORDRE[b[0].rarete] - ORDRE[a[0].rarete] || a[0].titre.localeCompare(b[0].titre, "fr"));
      grille.replaceChildren(...items.slice(0, MAX).map(([c, qte]) => {
        const b = carte(c);
        const k = b.querySelector(".quantite");
        if (k) k.remove();                    // la pastille de carte() compte MES exemplaires : on met la bonne
        if (qte > 1) b.append(el("span", { className: "quantite", textContent: String(qte), title: qte + " exemplaires" }));
        const coche = s.choisi.has(c.id);
        b.classList.toggle("choisie", coche);
        b.setAttribute("aria-pressed", String(coche));
        b.onclick = () => {
          if (s.choisi.has(c.id)) { s.choisi.delete(c.id); alerteMax = false; }
          else if (s.choisi.size >= MAX_CARTES) { alerteMax = true; dessiner(); return; }
          else s.choisi.add(c.id);
          prevenir();
          dessiner();
        };
        return el("div", { className: "carte-cell" }, b);
      }));
      entete.textContent = titre + (s.choisi.size ? ` (${s.choisi.size})` : "");
      vider.hidden = !s.choisi.size;
      note.textContent = alerteMax ? `Maximum ${MAX_CARTES} cartes de chaque côté.`
        : !s.source.size ? (texteVide || "Aucune carte disponible.")
        : !items.length ? "Aucune carte ne correspond."
        : items.length > MAX ? `${MAX} cartes affichées sur ${items.length} : affine ta recherche.` : "";
    }

    vider.onclick = () => { s.choisi.clear(); alerteMax = false; prevenir(); dessiner(); };
    recherche.addEventListener("input", () => { s.q = recherche.value; dessiner(); });
    return {
      boite,
      donner(source) {
        s.source = source;
        let perdu = false;
        for (const id of [...s.choisi]) if (!source.has(id)) { s.choisi.delete(id); perdu = true; }
        if (perdu) prevenir();
        dessiner();
      },
      choisir(ids) {
        s.choisi = new Set([...(ids || [])].filter(id => s.source.has(id)).slice(0, MAX_CARTES));
        alerteMax = false;
        prevenir();
        dessiner();
      },
    };
  }

  const memesCartes = (a, b) => a.size === b.size && [...a].every(x => b.has(x));

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
    const banniere = el("div", { className: "ech-contre", hidden: true });
    let confirmerDon = false;
    let minuteurDon = null;

    const nomAutre = () => (autre ? autre.pseudo : champ.value.trim());
    function resetConfirmation() {
      confirmerDon = false;
      clearTimeout(minuteurDon);
    }

    // Rien demandé en retour = cadeau ; sinon = échange (ou contre-offre)
    function majResume() {
      const nd = donne.size, nv = veut.size;
      const nom = nomAutre();
      const cadeau = nv === 0;
      let ok, texte;
      if (contre && cadeau) {
        ok = false;
        texte = "Une contre-offre doit demander au moins une carte en retour.";
      } else if (cadeau) {
        ok = !!(nom && nd);
        texte = ok
          ? `Tu offres ${pluriel(nd)} à ${nom}, sans rien demander en retour. ${nd > 1 ? "Elles arrivent" : "Elle arrive"} tout de suite chez lui et tu ne pourras pas ${nd > 1 ? "les" : "la"} reprendre.`
          : "Écris le pseudo du joueur et choisis les cartes à donner. Choisis aussi des cartes à recevoir pour proposer un échange ; sinon c'est un cadeau.";
      } else {
        ok = !!(autre && nd);
        texte = ok
          ? `Tu donnes ${pluriel(nd)} à ${autre.pseudo} contre ${pluriel(nv)}.`
          : "Choisis un joueur, les cartes que tu donnes et celles que tu reçois.";
      }
      envoyer.disabled = !ok;
      envoyer.textContent = cadeau ? (confirmerDon ? "Confirmer l'envoi" : "Offrir les cartes")
        : contre ? "Envoyer la contre-offre" : "Proposer l'échange";
      resume.textContent = texte;
    }

    function majMode() {
      banniere.hidden = !contre;
      if (contre) {
        banniere.replaceChildren(
          el("span", { textContent: `Contre-offre à ${contre.autre} : elle remplace sa proposition.` }),
          el("button", { className: "bouton petit", type: "button", textContent: "Annuler la contre-offre",
            onclick: () => { contre = null; selDonne.choisir([]); selVeut.choisir([]); majMode(); majResume(); } }));
      }
      resetConfirmation();
      majResume();
    }

    selDonne = creerSelecteur("Tu donnes", set => { donne = set; resetConfirmation(); majResume(); });
    selVeut = creerSelecteur("Tu reçois (facultatif)", set => { veut = set; resetConfirmation(); majResume(); },
      "Clique sur « Voir ses cartes » pour choisir ce que tu veux recevoir. Si tu ne choisis rien, c'est un cadeau.");
    selDonne.donner(possedees);
    selVeut.donner(autre ? autre.cartes : new Map());

    function oublierAutre() {
      autre = null;
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

    function remplirAmis() {
      const noms = typeof Amis !== "undefined" ? Amis.pseudos() : [];
      amisListe.replaceChildren(...noms.map(n => el("option", { value: n })));
    }

    // Prépare le formulaire depuis l'extérieur : un ami (e = null) ou une contre-offre (e = l'échange reçu)
    async function preparer(nom, e) {
      if (pilote && pilote.sous) pilote.sous("envoyer");
      contre = e || null;
      champ.value = nom;
      selDonne.donner(possedees);
      selDonne.choisir([]);
      selVeut.choisir([]);
      const ok = await chargerAutre(nom);
      if (contre && ok) {
        selDonne.choisir(contre.cartes_voulues);     // mes cartes : celles qu'il voulait de moi
        selVeut.choisir(contre.cartes_donnees);      // les siennes : celles qu'il m'offrait
      }
      majMode();
      champ.scrollIntoView({ behavior: "smooth", block: "center" });
    }
    pilote = { preparer, amis: remplirAmis };

    envoyer.onclick = async () => {
      const nom = nomAutre();
      const donnees = [...donne], voulues = [...veut];
      if (!donnees.length || !nom) return;
      const cadeau = voulues.length === 0;
      if (cadeau) {
        if (contre) return;
        if (!confirmerDon) {         // 1er clic : on demande confirmation, car un cadeau est définitif
          confirmerDon = true;
          minuteurDon = setTimeout(() => { confirmerDon = false; majResume(); }, 6000);
          majResume();
          return;
        }
        resetConfirmation();
      } else if (contre && memesCartes(donne, new Set(contre.cartes_voulues)) && memesCartes(veut, new Set(contre.cartes_donnees))) {
        info("Une contre-offre doit changer au moins une carte.");
        return;
      }
      envoyer.disabled = true;
      const { data, error } = contre
        ? await sb.rpc("contre_offre", { p_id: contre.id, p_donnees: donnees, p_voulues: voulues })
        : await sb.rpc("proposer_echange", { p_pseudo: nom, p_donnees: donnees, p_voulues: voulues });
      if (error) {
        Sons.jouer("erreur");
        info(error.message);
        majResume();
        return;
      }
      if (!contre && data && data.type === "don") {
        Sons.jouer("echange");
        info(`${pluriel(donnees.length)} ${donnees.length > 1 ? "ont été envoyées" : "a été envoyée"} à ${nom}.`);
        selDonne.choisir([]);
        await rafraichirJoueur();       // les cartes ont quitté ma collection : on relit tout de suite
        dessinerJoueur();
        afficher();
        selDonne.donner(possedees);
        if (autre) await chargerAutre(autre.pseudo);
        majResume();
        await rafraichir();
        return;
      }
      Sons.jouer("clic");
      info(contre ? "Contre-offre envoyée à " + nom + "." : "Proposition envoyée à " + nom + ".");
      contre = null;
      selDonne.choisir([]);
      selVeut.choisir([]);
      majMode();
      await rafraichir();
    };

    const formulaire = el("section", { className: "ech-bloc", id: "ech-formulaire" },
      el("h2", { textContent: "Échanger ou offrir des cartes" }),
      el("p", { className: "ech-aide" },
        "Coche les cartes que tu donnes (jusqu'à 10). Coche aussi celles que tu veux en retour pour proposer un échange, ou n'en coche aucune pour faire un cadeau."),
      banniere,
      el("div", { className: "ech-ligne" }, champ, amisListe, voir),
      el("div", { className: "ech-duo" }, selDonne.boite, fleche, selVeut.boite),
      el("div", { className: "ech-ligne" }, envoyer, resume));

    // Sous-onglets : Reçu / Envoyer / Historique (le formulaire reste en place quand on change d'onglet)
    const SOUS = [["recu", "Reçu"], ["envoyer", "Envoyer"], ["histo", "Historique"]];
    const panneaux = {
      recu: el("div", { id: "ech-p-recu", className: "ech-panneau" }),
      envoyer: el("div", { id: "ech-p-envoyer", className: "ech-panneau" }, formulaire, el("div", { id: "ech-l-envoyes" })),
      histo: el("div", { id: "ech-p-histo", className: "ech-panneau" }),
    };
    const barreSous = el("div", { className: "ech-sous-onglets", role: "tablist" });
    const boutonsSous = {};
    function ouvrirSous(nom) {
      sous = nom;
      for (const [cle] of SOUS) {
        panneaux[cle].hidden = cle !== nom;
        boutonsSous[cle].setAttribute("aria-selected", String(cle === nom));
      }
    }
    for (const [cle, titre] of SOUS) {
      const b = el("button", { className: "sous-btn", type: "button", id: "ech-st-" + cle, textContent: titre });
      b.setAttribute("role", "tab");
      b.onclick = () => ouvrirSous(cle);
      boutonsSous[cle] = b;
      barreSous.append(b);
    }
    pilote.sous = ouvrirSous;
    const recusAttente = liste.filter(e => e.sens === "recu" && e.statut === "en_attente").length;
    ouvrirSous(sous || (recusAttente ? "recu" : "envoyer"));   // des propositions t'attendent : on les montre d'abord

    z.replaceChildren(
      el("p", { className: "ech-pseudo" }, "Ton pseudo : ", el("b", { textContent: pseudo }),
        " — tes amis te trouvent avec ce pseudo."),
      barreSous,
      panneaux.recu, panneaux.envoyer, panneaux.histo);
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

  function cote(titre, ids) {
    return el("div", { className: "ech-cote" },
      el("span", { textContent: titre + (ids.length > 1 ? ` (${ids.length})` : "") }),
      el("div", { className: "ech-vignettes" }, ...ids.map(id => vignette(carteDe(id)))));
  }

  function ligne(e) {
    const recu = e.sens === "recu";
    const attente = e.statut === "en_attente";
    const donnees = e.cartes_donnees || [], voulues = e.cartes_voulues || [];
    const actions = el("div", { className: "ech-actions" });
    const fleche = el("span", { className: "ech-fleche", textContent: "⇄" });
    fleche.setAttribute("aria-hidden", "true");
    let qui, cartesEl;

    if (e.type === "don") {
      const n = donnees.length;
      qui = recu ? `${e.autre} t'a offert ${n > 1 ? n + " cartes" : "une carte"}` : `Offert à ${e.autre}`;
      cartesEl = el("div", { className: "ech-cartes" }, cote(recu ? "Tu reçois" : "Tu donnes", donnees));
      actions.append(el("span", { className: "ech-statut-fin", textContent: recu ? "Reçu" : "Envoyé" }));
    } else {
      // du point de vue du joueur : ce qu'il donne et ce qu'il reçoit
      const miennes = recu ? voulues : donnees;
      const leurs = recu ? donnees : voulues;
      qui = recu
        ? (e.parent_id ? `${e.autre} te propose une contre-offre` : `${e.autre} te propose`)
        : (e.parent_id ? `Contre-offre envoyée à ${e.autre}` : `Proposé à ${e.autre}`);
      cartesEl = el("div", { className: "ech-cartes" }, cote("Tu donnes", miennes), fleche, cote("Tu reçois", leurs));
      if (attente && recu) {
        const oui = el("button", { className: "bouton principal", type: "button", textContent: "Accepter" });
        const cont = el("button", { className: "bouton", type: "button", textContent: "Contre-offre" });
        const non = el("button", { className: "bouton", type: "button", textContent: "Refuser" });
        oui.onclick = () => repondre(e, "accepter", [oui, cont, non]);
        non.onclick = () => repondre(e, "refuser", [oui, cont, non]);
        cont.onclick = () => { if (pilote) pilote.preparer(e.autre, e); };
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
    const zr = $("ech-p-recu"), ze = $("ech-l-envoyes"), zh = $("ech-p-histo");
    if (!zr || !ze || !zh) return;
    const recus = liste.filter(e => e.sens === "recu" && e.statut === "en_attente");
    const envoyes = liste.filter(e => e.sens === "envoye" && e.statut === "en_attente");
    const histo = liste.filter(e => e.statut !== "en_attente").slice(0, 30);
    zr.replaceChildren(bloc(`Propositions reçues (${recus.length})`, recus, "Aucune proposition reçue."));
    ze.replaceChildren(bloc(`Propositions envoyées (${envoyes.length})`, envoyes, "Aucune proposition en attente."));
    zh.replaceChildren(bloc("Historique", histo, "Aucun échange terminé pour l'instant."));
    const bRecu = $("ech-st-recu");                    // pastille sur le sous-onglet « Reçu »
    if (bRecu) {
      bRecu.textContent = recus.length ? `Reçu (${recus.length})` : "Reçu";
      bRecu.classList.toggle("alerte", recus.length > 0);
    }
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
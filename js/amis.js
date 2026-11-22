// ====== Amis : demandes, liste, raccourcis vers les échanges ======
// Tout se passe côté base (sql/04_amis_dons_shiny.sql) : ici on affiche et on envoie les demandes.
const Amis = (() => {
  let liste = [];            // [{ id, pseudo, sens: "ami" | "recu" | "envoye" }]
  let visible = false;
  let charge = false;
  let manque = false;
  let generation = 0;
  let minuteur = null;

  function info(t) {
    const z = $("ami-statut");
    if (z) z.textContent = t || "";
  }

  // Les pseudos de mes amis (pour proposer la liste dans l'onglet Échanges)
  function pseudos() {
    return liste.filter(a => a.sens === "ami").map(a => a.pseudo);
  }

  // Pastille « Amis (1) » sur l'onglet quand une demande attend une réponse
  function majBadge() {
    const n = liste.filter(a => a.sens === "recu").length;
    const b = document.querySelector('.onglet-btn[data-onglet="amis"]');
    if (!b) return;
    b.textContent = n ? `Amis (${n})` : "Amis";
    b.classList.toggle("alerte", n > 0);
  }

  async function rafraichir() {
    if (!connecte) return;
    const jeton = generation;
    const { data, error } = await sb.rpc("mes_amis");
    if (jeton !== generation || !connecte) return;
    manque = !!error && (error.code === "PGRST202" || error.status === 404);
    if (!error) liste = data || [];
    else if (!manque && visible) info("Impossible de lire tes amis : " + error.message);
    charge = true;
    majBadge();
    if (visible) dessiner();
  }

  // Appelé à chaque connexion / déconnexion
  function session() {
    generation++;
    liste = []; charge = false; manque = false;
    clearInterval(minuteur);
    majBadge();
    if (connecte) {
      minuteur = setInterval(() => { if (!document.hidden) rafraichir(); }, 60000);
      rafraichir();
    }
    if (visible) dessiner();
  }

  function afficherOnglet(v) {
    visible = v;
    if (!v) return;
    info("");
    dessiner();
    rafraichir();
  }

  // Bouton à double clic : le 1er clic demande confirmation, le 2e agit
  function confirmable(texte, texteConfirm, action) {
    const b = el("button", { className: "bouton petit", type: "button", textContent: texte });
    let attente = null;
    b.onclick = () => {
      if (attente) { clearTimeout(attente); attente = null; action(b); return; }
      b.textContent = texteConfirm;
      attente = setTimeout(() => { attente = null; b.textContent = texte; }, 5000);
    };
    return b;
  }

  async function appeler(fonction, args, succes, boutons) {
    (boutons || []).forEach(b => { b.disabled = true; });
    const { error } = await sb.rpc(fonction, args);
    if (error) {
      Sons.jouer("erreur");
      info(error.message);
      (boutons || []).forEach(b => { b.disabled = false; });
      return false;
    }
    info(succes || "");
    await rafraichir();
    return true;
  }

  function ligne(a) {
    const actions = el("div", { className: "ami-actions" });
    if (a.sens === "recu") {
      const oui = el("button", { className: "bouton principal petit", type: "button", textContent: "Accepter" });
      const non = el("button", { className: "bouton petit", type: "button", textContent: "Refuser" });
      oui.onclick = async () => { if (await appeler("repondre_ami", { p_id: a.id, p_accepter: true }, a.pseudo + " est maintenant ton ami.", [oui, non])) Sons.jouer("echange"); };
      non.onclick = () => appeler("repondre_ami", { p_id: a.id, p_accepter: false }, "Demande refusée.", [oui, non]);
      actions.append(oui, non);
    } else if (a.sens === "envoye") {
      const ann = el("button", { className: "bouton petit", type: "button", textContent: "Annuler la demande" });
      ann.onclick = () => appeler("retirer_ami", { p_id: a.id }, "Demande annulée.", [ann]);
      actions.append(ann);
    } else {
      const ech = el("button", { className: "bouton petit", type: "button", textContent: "Échanger / offrir" });
      ech.onclick = () => { Echanges.avec(a.pseudo); allerA("echanges"); };
      const ret = confirmable("Retirer", "Confirmer ?", b =>
        appeler("retirer_ami", { p_id: a.id }, a.pseudo + " n'est plus dans tes amis.", [b]));
      actions.append(ech, ret);
    }
    return el("div", { className: "ami-ligne" }, el("span", { className: "ami-nom", textContent: a.pseudo }), actions);
  }

  function bloc(titre, items, vide) {
    return el("section", { className: "ech-bloc" },
      el("h2", { textContent: titre }),
      items.length
        ? el("div", { className: "ami-liste" }, ...items.map(ligne))
        : el("p", { className: "vide", textContent: vide }));
  }

  function dessiner() {
    const z = $("amis-contenu");
    if (!z) return;
    if (!connecte) {
      z.replaceChildren(el("p", { className: "vide" }, "Connecte-toi depuis l'onglet Boosters pour te faire des amis."));
      return;
    }
    if (!charge) {
      z.replaceChildren(el("p", { className: "vide" }, "Chargement…"));
      return;
    }
    if (manque) {
      z.replaceChildren(el("p", { className: "erreur" },
        "Les amis ne sont pas encore installés : exécute sql/04_amis_dons_shiny.sql dans le SQL Editor de Supabase, puis recharge la page."));
      return;
    }

    // Le champ n'est recréé que si besoin, pour ne pas effacer ce qu'on est en train de taper
    let ajout = $("ami-ajout");
    if (!ajout) {
      const champ = el("input", { type: "text", id: "ami-pseudo", name: "pseudo-ami", placeholder: "Pseudo du joueur",
        autocomplete: "off", maxLength: 20 });
      champ.setAttribute("aria-label", "Pseudo du joueur à ajouter");
      const ok = el("button", { className: "bouton principal", type: "button", textContent: "Demander en ami" });
      async function envoyer() {
        const nom = champ.value.trim();
        if (!nom) return info("Écris le pseudo du joueur.");
        ok.disabled = true;
        const { data, error } = await sb.rpc("demander_ami", { p_pseudo: nom });
        ok.disabled = false;
        if (error) { Sons.jouer("erreur"); return info(error.message); }
        Sons.jouer("clic");
        champ.value = "";
        info(data && data.statut === "accepte"
          ? `${nom} t'avait déjà demandé : vous êtes maintenant amis !`
          : `Demande envoyée à ${nom}.`);
        await rafraichir();
      }
      ok.onclick = envoyer;
      champ.addEventListener("keydown", ev => { if (ev.key === "Enter") envoyer(); });
      ajout = el("section", { className: "ech-bloc", id: "ami-ajout" },
        el("h2", { textContent: "Ajouter un ami" }),
        el("p", { className: "ech-aide" }, "Écris son pseudo : il recevra ta demande dans son onglet Amis."),
        el("div", { className: "ech-ligne" }, champ, ok));
    }
    const recues = liste.filter(a => a.sens === "recu");
    const envoyees = liste.filter(a => a.sens === "envoye");
    const amis = liste.filter(a => a.sens === "ami");
    z.replaceChildren(
      ajout,
      ...(recues.length ? [bloc(`Demandes reçues (${recues.length})`, recues, "")] : []),
      ...(envoyees.length ? [bloc(`Demandes envoyées (${envoyees.length})`, envoyees, "")] : []),
      bloc(`Mes amis (${amis.length})`, amis, "Pas encore d'amis : envoie une demande avec un pseudo."));
  }

  return { session, afficher: afficherOnglet, pseudos };
})();
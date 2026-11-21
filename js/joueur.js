// ====== Joueur, connexion et boosters ======
let sb;
let connecte = false;
let possedees = new Map();   // id de carte -> quantité
let favoris = new Set();     // ids des cartes favorites
let obtenues = new Map();    // id de carte -> date de dernière obtention (ms)
let ames = 0;                // monnaie du joueur (voir sql/05_monnaie.sql)
let TARIFS = null;           // tarifs de la monnaie, lus dans la base ; null = monnaie pas installée
let monPseudo = null;        // mon pseudo (enregistré dans le compte : le site s'en souvient)
let etat = null;             // { boosters, prochain }
let minuteur = null;
let dernierRafraichi = 0;

function statut(t) { $("statut").textContent = t || ""; }

let compteCharge = null;       // id du compte dont les données sont déjà chargées
let comptePropose = null;      // compte pour lequel la fenêtre « pseudo » a déjà été proposée
let fileSession = Promise.resolve();

function initJoueur() {
  sb.auth.onAuthStateChange((evt, session) => {
    if (evt === "TOKEN_REFRESHED") return;
    // Supabase renvoie souvent plusieurs évènements d'affilée (connexion, retour sur l'onglet...) :
    // on les traite l'un après l'autre pour qu'ils ne se marchent pas dessus
    setTimeout(() => {
      fileSession = fileSession.then(() => appliquerSession(session)).catch(e => console.error(e));
    }, 0);
  });
}

async function appliquerSession(session) {
  const id = session && session.user ? session.user.id : null;
  if (id && id === compteCharge && monPseudo) return;   // même compte déjà prêt : rien à refaire
  compteCharge = null;
  connecte = !!session;
  possedees = new Map();
  favoris = new Set();
  obtenues = new Map();
  ames = 0;
  monPseudo = null;
  etat = null;
  statut("");
  $("recherche").value = "";
  let refus = null;
  if (connecte) {
    await rafraichirJoueur();
    refus = await chargerPseudo(session);      // le pseudo est enregistré dans le compte : le site s'en souvient
    compteCharge = id;
  } else {
    comptePropose = null;
  }
  dessinerJoueur();
  afficher();
  Echanges.session();
  Amis.session();
  Succes.session();
  // Fenêtre « pseudo » seulement si le serveur a refusé celui tapé (ou si le compte n'en a vraiment aucun),
  // jamais en cas d'erreur de lecture, et une seule fois par compte
  if (connecte && !monPseudo && !(refus && refus.lecture) && !$("connexion").open && comptePropose !== id) {
    comptePropose = id;
    ouvrirDialoguePseudo(refus);
  }
}

// Id du joueur connecté : sert à ne lire QUE ses propres lignes (players, collection)
async function monId() {
  const { data } = await sb.auth.getSession();
  return data && data.session ? data.session.user.id : null;
}

async function rafraichirJoueur() {
  dernierRafraichi = Date.now();
  const uid = await monId();
  const [e, col, pl] = await Promise.all([
    sb.rpc("etat_joueur"),
    toutLire("collection", "card_id, quantite, favori, derniere_obtention", "card_id", ["player_id", uid]),
    sb.from("players").select("ames").eq("id", uid).maybeSingle(),
  ]);
  if (!e.error) etat = e.data;
  if (!pl.error && pl.data) {
    ames = pl.data.ames || 0;
    if (!TARIFS) { const t = await sb.rpc("tarifs_ames"); if (!t.error) TARIFS = t.data; }
  }
  if (!col.error) {
    possedees = new Map(col.data.map(l => [l.card_id, l.quantite]));
    favoris = new Set(col.data.filter(l => l.favori).map(l => l.card_id));
    obtenues = new Map(col.data.map(l => [l.card_id, l.derniere_obtention ? Date.parse(l.derniere_obtention) : 0]));
    await assurerCartes([...possedees.keys()]);
  }
}

const SANG = '<svg viewBox="0 0 240 100" aria-hidden="true">' +
  '<path d="M0 0h240v16H0z"/><path d="M20 10h12v46a6 6 0 0 1-12 0z"/>' +
  '<path d="M70 10h9v26a4.5 4.5 0 0 1-9 0z"/><path d="M118 10h14v66a7 7 0 0 1-14 0z"/>' +
  '<path d="M170 10h10v34a5 5 0 0 1-10 0z"/><path d="M212 10h8v22a4 4 0 0 1-8 0z"/></svg>';

const CRANE = '<svg viewBox="0 0 64 64" aria-hidden="true">' +
  '<path d="M32 4C17 4 8 14 8 27c0 8 4 13 9 16v8c0 2 2 4 4 4h3v-5h3v5h10v-5h3v5h3c2 0 4-2 4-4v-8c5-3 9-8 9-16C56 14 47 4 32 4z"/>' +
  '<circle class="oeil" cx="22" cy="28" r="6.5"/><circle class="oeil" cx="42" cy="28" r="6.5"/>' +
  '<circle class="pupille" cx="22" cy="28" r="2"/><circle class="pupille" cx="42" cy="28" r="2"/>' +
  '<path class="nez" d="M32 34l-4 8h8z"/></svg>';

function dessinerJoueur() {
  const z = $("joueur");
  clearInterval(minuteur);
  const paquet = el("button", { className: "paquet", type: "button" },
    el("span", { className: "paquet-sang", innerHTML: SANG }),
    el("span", { className: "paquet-crane", innerHTML: CRANE }),
    el("span", { className: "paquet-logo" }, "Horror", el("br"),
      el("span", { className: "rouge", textContent: "Master" })),
    el("span", { className: "paquet-sous", textContent: "Booster · 5 cartes" }));
  const info = el("p", { className: "info" });

  if (!connecte) {
    paquet.onclick = () => $("connexion").showModal();
    info.textContent = "Connecte-toi pour ouvrir des boosters.";
    z.replaceChildren(paquet, info);
    return;
  }

  paquet.onclick = ouvrirBooster;
  const sortir = el("button", { className: "bouton", type: "button", textContent: "Se déconnecter" });
  sortir.onclick = () => sb.auth.signOut();
  const qui = monPseudo
    ? el("p", { className: "info" }, "Connecté en tant que ", el("b", { textContent: monPseudo }))
    : el("button", { className: "bouton petit", type: "button", textContent: "Choisir mon pseudo", onclick: ouvrirDialoguePseudo });
  z.replaceChildren(paquet, qui, info, ...blocMonnaie(), sortir);

  const maj = () => {
    const n = etat ? etat.boosters : 0;
    paquet.disabled = n < 1;
    let t = `${n} booster${n > 1 ? "s" : ""} sur 5.`;
    if (etat && n < 5) {
      const reste = Math.max(0, Math.ceil((new Date(etat.prochain) - Date.now()) / 1000));
      t += ` Le prochain arrive dans ${Math.floor(reste / 60)}:${String(reste % 60).padStart(2, "0")}.`;
      if (reste === 0 && Date.now() - dernierRafraichi > 15000) {
        rafraichirJoueur().then(dessinerJoueur);
      }
    }
    const nbShiny = [...possedees.keys()].filter(id => parId.get(id)?.shiny).length;
    const totalBase = cartes.filter(c => !c.shiny).length;
    t += ` Collection : ${possedees.size - nbShiny} cartes sur ${totalBase}` + (nbShiny ? ` et ${nbShiny} shiny.` : ".");
    info.textContent = t;
  };
  maj();
  minuteur = setInterval(maj, 1000);
}

// --- Monnaie : les âmes (gagnées en sacrifiant des doubles, dépensées en boosters) ---
function valeurAmes(c) {
  if (!TARIFS) return 0;
  return (TARIFS.valeurs[c.rarete] || 0) * (c.shiny ? TARIFS.shiny : 1);
}

function blocMonnaie() {
  if (!TARIFS) return [];
  const solde = el("p", { className: "ames" }, "👻 ", el("b", { textContent: ames.toLocaleString("fr-FR") }), " âmes");
  const acheter = el("button", { className: "bouton petit", type: "button",
    textContent: `Acheter un booster (${TARIFS.booster} âmes)`, disabled: ames < TARIFS.booster });
  acheter.onclick = async () => {
    acheter.disabled = true;
    const { data, error } = await sb.rpc("acheter_booster");
    if (error) { Sons.jouer("erreur"); statut(error.message); return dessinerJoueur(); }
    ames = data.ames;
    etat = { boosters: data.boosters, prochain: etat ? etat.prochain : new Date().toISOString() };
    Sons.jouer("clic");
    statut("Booster acheté.");
    dessinerJoueur();
  };
  const sacrifier = el("button", { className: "bouton petit", type: "button", textContent: "Sacrifier mes doubles" });
  sacrifier.onclick = sacrifierDoubles;
  return [el("div", { className: "monnaie" }, solde, el("div", { className: "monnaie-actions" }, acheter, sacrifier))];
}

async function sacrifierDoubles() {
  const ordre = ["C", "PC", "R", "SR", "UR", "L"];
  const max = ordre.indexOf(TARIFS.max_doubles);
  let nb = 0, gain = 0;
  for (const [id, q] of possedees) {
    const c = parId.get(id);
    if (!c || q < 2 || c.shiny || favoris.has(id) || ordre.indexOf(c.rarete) > max) continue;
    nb += q - 1;
    gain += (q - 1) * valeurAmes(c);
  }
  if (!nb) return statut("Aucun double à sacrifier (les favoris et les shiny sont toujours gardés).");
  const jusqua = NOMS[TARIFS.max_doubles];
  if (!confirm(`Sacrifier ${nb} carte${nb > 1 ? "s" : ""} en double (Communes à ${jusqua}s) contre ${gain} âmes ?\n` +
               "Tu gardes toujours un exemplaire de chaque carte, et tes favoris et shiny sont épargnés.")) return;
  const { data, error } = await sb.rpc("sacrifier_doubles", { p_max: TARIFS.max_doubles });
  if (error) { Sons.jouer("erreur"); return statut(error.message); }
  Sons.jouer("clic");
  statut(`${data.cartes} carte${data.cartes > 1 ? "s" : ""} sacrifiée${data.cartes > 1 ? "s" : ""} : +${data.gain} âmes.`);
  await rafraichirJoueur();
  dessinerJoueur();
  afficher();
}

// --- Connexion, inscription et pseudo : une seule fenêtre ---
const PSEUDO_OK = /^[A-Za-z0-9_-]{3,20}$/;
const PSEUDO_REGLE = "Pseudo invalide : 3 à 20 caractères (lettres, chiffres, _ ou -).";
let modeFenetre = "connexion";   // "connexion", ou "pseudo" quand on est connecté mais sans pseudo
let pseudoSaisi = "";            // pseudo tapé dans la fenêtre, en attendant la fin de la connexion

function msgConnexion(t) { $("msg-connexion").textContent = t; }

function majFenetre() {
  const pseudo = modeFenetre === "pseudo";
  $("titre-connexion").textContent = pseudo ? "Choisis ton pseudo" : "Connexion";
  $("champ-email").hidden = pseudo;
  $("champ-mdp").hidden = pseudo;
  $("btn-connexion").hidden = pseudo;
  $("btn-inscription").hidden = pseudo;
  $("btn-valider-pseudo").hidden = !pseudo;
  $("btn-annuler").textContent = pseudo ? "Plus tard" : "Annuler";
}
// Quelle que soit la façon dont la fenêtre se ferme, elle revient en mode « Connexion »
$("connexion").addEventListener("close", () => {
  if ($("connexion").open) return;      // déjà rouverte entre-temps
  modeFenetre = "connexion";
  majFenetre();
  msgConnexion("");
});
$("btn-annuler").onclick = () => $("connexion").close();

$("btn-connexion").onclick = async () => {
  const pseudo = $("pseudo-inscription").value.trim();
  if (!pseudo) return msgConnexion("Renseigne ton pseudo, ton email et ton mot de passe.");
  if (!PSEUDO_OK.test(pseudo)) return msgConnexion(PSEUDO_REGLE);
  $("btn-connexion").disabled = true;
  try {
    const { data: ouverture, error } = await sb.auth.signInWithPassword({
      email: $("email").value.trim(), password: $("mdp").value });
    if (error) return msgConnexion("Connexion impossible : " + error.message);
    // Le pseudo tapé ici est enregistré tout de suite, dans cette fenêtre : on ne le redemande jamais
    const { data: p } = await sb.from("players").select("pseudo").eq("id", ouverture.user.id).maybeSingle();
    if (p && p.pseudo) {
      if (p.pseudo.toLowerCase() !== pseudo.toLowerCase()) {
        await sb.auth.signOut();
        return msgConnexion("Ce pseudo ne correspond pas à ce compte.");
      }
      monPseudo = p.pseudo;
    } else {
      const r = await sb.rpc("definir_pseudo", { p_pseudo: pseudo });
      if (r.error) return msgConnexion(r.error.message);     // par exemple : pseudo déjà pris
      monPseudo = r.data || pseudo;
    }
    $("connexion").close();
    dessinerJoueur();
    Echanges.session();
    Amis.session();
  } finally {
    $("btn-connexion").disabled = false;
  }
};

$("btn-inscription").onclick = async () => {
  const pseudo = $("pseudo-inscription").value.trim();
  if (!pseudo) return msgConnexion("Pour créer un compte, renseigne aussi ton pseudo.");
  if (!PSEUDO_OK.test(pseudo)) return msgConnexion(PSEUDO_REGLE);
  $("btn-inscription").disabled = true;
  const dispo = await sb.rpc("pseudo_disponible", { p_pseudo: pseudo });
  if (!dispo.error && dispo.data === false) {
    $("btn-inscription").disabled = false;
    return msgConnexion("Ce pseudo est déjà pris : choisis-en un autre.");
  }
  const { data, error } = await sb.auth.signUp({
    email: $("email").value.trim(), password: $("mdp").value, options: { data: { pseudo } } });
  $("btn-inscription").disabled = false;
  if (error) return msgConnexion("Inscription impossible : " + error.message);
  if (!data.session) {
    return msgConnexion("Compte créé. Confirme ton adresse par email, puis connecte-toi : ton pseudo « " + pseudo + " » sera enregistré à ta première connexion.");
  }
  $("connexion").close();
};

// ----- Mon pseudo : saisi une seule fois dans cette fenêtre, puis mémorisé dans le compte -----

// Lit le pseudo du compte. S'il n'est pas encore enregistré, on prend celui tapé dans la fenêtre de connexion
// ou, à défaut, celui de l'inscription (le compte le garde). Renvoie { voulu, message } si le serveur le refuse.
async function chargerPseudo(session) {
  const saisi = pseudoSaisi;
  pseudoSaisi = "";
  const { data, error } = await sb.from("players").select("pseudo").eq("id", session.user.id).maybeSingle();
  if (error) return { lecture: true };                  // lecture impossible : on ne dérange pas le joueur
  if (data && data.pseudo) { monPseudo = data.pseudo; return null; }
  const meta = session && session.user && session.user.user_metadata && session.user.user_metadata.pseudo;
  const voulu = saisi || meta;
  if (!voulu) return null;
  const r = await sb.rpc("definir_pseudo", { p_pseudo: voulu });
  if (!r.error) { monPseudo = r.data || voulu; return null; }
  return { voulu, message: r.error.message };          // par exemple : pseudo pris entre-temps
}

// La même fenêtre, en mode « Choisis ton pseudo » : à la connexion si le compte n'en a pas, ou depuis l'onglet Échanges
function ouvrirDialoguePseudo(refus) {
  modeFenetre = "pseudo";
  majFenetre();
  msgConnexion(refus && refus.message ? refus.message : "");
  if (refus && refus.voulu) $("pseudo-inscription").value = refus.voulu;
  if (!$("connexion").open) $("connexion").showModal();
  $("pseudo-inscription").focus();
}
async function validerPseudo() {
  const pseudo = $("pseudo-inscription").value.trim();
  if (!PSEUDO_OK.test(pseudo)) return msgConnexion(PSEUDO_REGLE);
  $("btn-valider-pseudo").disabled = true;
  const { data, error } = await sb.rpc("definir_pseudo", { p_pseudo: pseudo });
  $("btn-valider-pseudo").disabled = false;
  if (error) return msgConnexion(error.message);
  monPseudo = data || pseudo;
  $("connexion").close();
  dessinerJoueur();
  Echanges.session();
  Amis.session();
}
$("btn-valider-pseudo").onclick = validerPseudo;
$("connexion").addEventListener("keydown", ev => {
  if (ev.key === "Enter" && ev.target.tagName === "INPUT" && modeFenetre === "pseudo") {
    ev.preventDefault();
    validerPseudo();
  }
});

// --- Booster ---
// --- Booster : une carte à la fois ---
let bCartes = [];
let bIndex = 0;

function afficherBooster(ouvert) {
  $("booster").hidden = !ouvert;
  $("joueur").hidden = ouvert;
  $("statut").hidden = ouvert;
  document.body.classList.toggle("booster-ouvert", ouvert);
}

let boosterEnCours = false;

async function ouvrirBooster() {
  if (boosterEnCours) return;
  boosterEnCours = true;
  try {
    statut("");
    const { data, error } = await sb.rpc("open_booster");
    if (error) {
      Sons.jouer("erreur");
      statut(error.message);
      return;
    }
    Sons.jouer("ouverture");
    etat = { boosters: data.boosters, prochain: data.prochain };
    data.cartes.forEach(c => possedees.set(c.id, (possedees.get(c.id) || 0) + 1));
    data.cartes.forEach(c => {          // une carte shiny toute neuve n'est pas encore dans la liste chargée
      if (!parId.has(c.id)) { const { nouvelle, ...carteSeule } = c; parId.set(c.id, carteSeule); cartes.push(carteSeule); }
    });
    bCartes = data.cartes;
    bIndex = 0;
    dessinerPile();
    afficherBooster(true);
    $("booster").scrollIntoView({ behavior: "smooth", block: "start" });
    $("suivante").focus({ preventScroll: true });
  } finally {
    boosterEnCours = false;
  }
}

function dessinerPile() {
  $("rangee").hidden = true;
  $("pile").hidden = false;
  $("suivante").hidden = false;
  $("fin-booster").hidden = true;
  $("pile").replaceChildren(...bCartes.map((c, i) => {
    const wrap = el("div", { className: "flip" });
    wrap.dataset.r = c.rarete;
    const dos = el("div", { className: "dos" },
      el("span", { className: "paquet-sang dos-sang", innerHTML: SANG }),
      el("span", { className: "dos-cadre" }),
      el("span", { className: "paquet-crane", innerHTML: CRANE }),
      el("span", { className: "dos-titre" }, "Horror", el("br"),
        el("span", { className: "rouge", textContent: "Master" })),
      el("span", { className: "dos-orn" }));
    const face = carte(c);
    face.onclick = null;      // pas de fiche détaillée pendant l'ouverture
    face.tabIndex = -1;
    wrap.append(dos, face);
    wrap.onclick = () => { if (i === bIndex) avancer(); };
    return wrap;
  }));
  majPile();
}

function majPile() {
  [...$("pile").children].forEach((w, i) => {
    const d = i - bIndex;
    w.classList.toggle("partie", d < 0);
    w.style.zIndex = d >= 0 ? String(100 - d) : "0";
    w.style.setProperty("--d", Math.min(Math.max(d, 0), 4));
  });
  majBoutonBooster();
}

function majBoutonBooster() {
  const w = $("pile").children[bIndex];
  const retournee = !!w && w.classList.contains("retournee");
  const dernier = bIndex === bCartes.length - 1;
  $("suivante").textContent = !retournee ? "Retourner la carte"
    : dernier ? "Voir le récapitulatif" : "Carte suivante";
  $("booster-compteur").textContent = `Carte ${bIndex + 1} sur ${bCartes.length}`;
  majFavBooster();
}

function avancer() {
  const w = $("pile").children[bIndex];
  if (!w) return;
  if (!w.classList.contains("retournee")) {
    w.classList.add("retournee");
    Sons.jouer("retourner");
    Sons.rarete(bCartes[bIndex].rarete);
    if (bCartes[bIndex].shiny) Sons.jouer("shiny");
    majBoutonBooster();
    return;
  }
  Sons.jouer("suivante");
  bIndex++;
  if (bIndex >= bCartes.length) return recap();
  majPile();
}

function recap() {
  Sons.jouer("recap");
  $("pile").hidden = true;
  $("suivante").hidden = true;
  $("fav-booster").hidden = true;
  $("fin-booster").hidden = false;
  $("booster-compteur").textContent = "Ton butin";
  $("rangee").hidden = false;
  $("rangee").replaceChildren(...bCartes.map(c => cellule(c)));
  $("fin-booster").focus();
}
$("suivante").onclick = avancer;

$("fin-booster").onclick = async () => {
  afficherBooster(false);
  await rafraichirJoueur();
  dessinerJoueur();
  afficher();
  Succes.verifier(true);
};

// --- Favori pendant l'ouverture ---
function majFavBooster() {
  const b = $("fav-booster");
  const w = $("pile").children[bIndex];
  const visible = connecte && !$("pile").hidden && !!w && w.classList.contains("retournee");
  b.hidden = !visible;
  if (!visible) return;
  const fav = favoris.has(bCartes[bIndex].id);
  b.setAttribute("aria-pressed", String(fav));
  b.textContent = fav ? "★ Dans mes favoris" : "☆ Ajouter aux favoris";
}

$("fav-booster").onclick = async () => {
  const c = bCartes[bIndex];
  if (!c) return;
  const p = basculerFavori(c.id, $("fav-booster"));   // met à jour tout de suite, annule si le serveur refuse
  majFavBooster();
  await p;
  majFavBooster();
};
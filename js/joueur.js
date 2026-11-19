// ====== Joueur, connexion et boosters ======
let sb;
let connecte = false;
let possedees = new Map();   // id de carte -> quantité
let favoris = new Set();     // ids des cartes favorites
let obtenues = new Map();    // id de carte -> date de dernière obtention (ms)
let etat = null;             // { boosters, prochain }
let minuteur = null;
let dernierRafraichi = 0;

function statut(t) { $("statut").textContent = t || ""; }

function initJoueur() {
  sb.auth.onAuthStateChange((evt, session) => {
    if (evt === "TOKEN_REFRESHED") return;
    setTimeout(() => appliquerSession(session), 0);
  });
}

async function appliquerSession(session) {
  connecte = !!session;
  possedees = new Map();
  favoris = new Set();
  obtenues = new Map();
  etat = null;
  statut("");
  $("recherche").value = "";          // <-- ajouter cette ligne
  if (connecte) await rafraichirJoueur();
  dessinerJoueur();
  afficher();
  Echanges.session();
}

async function rafraichirJoueur() {
  dernierRafraichi = Date.now();
  const [e, col] = await Promise.all([
    sb.rpc("etat_joueur"),
    toutLire("collection", "card_id, quantite, favori, derniere_obtention", "card_id"),
  ]);
  if (!e.error) etat = e.data;
  if (!col.error) {
    possedees = new Map(col.data.map(l => [l.card_id, l.quantite]));
    favoris = new Set(col.data.filter(l => l.favori).map(l => l.card_id));
    obtenues = new Map(col.data.map(l => [l.card_id, l.derniere_obtention ? Date.parse(l.derniere_obtention) : 0]));
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
  z.replaceChildren(paquet, info, sortir);

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
    t += ` Collection : ${possedees.size} cartes sur ${cartes.length}.`;
    info.textContent = t;
  };
  maj();
  minuteur = setInterval(maj, 1000);
}

// --- Connexion ---
function msgConnexion(t) { $("msg-connexion").textContent = t; }
$("btn-annuler").onclick = () => $("connexion").close();
$("btn-connexion").onclick = async () => {
  const { error } = await sb.auth.signInWithPassword({
    email: $("email").value.trim(), password: $("mdp").value });
  if (error) return msgConnexion("Connexion impossible : " + error.message);
  msgConnexion("");
  $("connexion").close();
};
$("btn-inscription").onclick = async () => {
  const { data, error } = await sb.auth.signUp({
    email: $("email").value.trim(), password: $("mdp").value });
  if (error) return msgConnexion("Inscription impossible : " + error.message);
  if (!data.session) return msgConnexion("Compte créé. Confirme ton adresse par email, puis connecte-toi.");
  msgConnexion("");
  $("connexion").close();
};

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
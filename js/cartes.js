// Affichage des cartes : filtres, tri, grille, fiche détaillée
const RARETES = [
  { code: "L",  nom: "Légendaire" },
  { code: "UR", nom: "Ultra rare" },
  { code: "SR", nom: "Super rare" },
  { code: "R",  nom: "Rare" },
  { code: "PC", nom: "Peu commune" },
  { code: "C",  nom: "Commune" },
];
const ORDRE = Object.fromEntries(RARETES.map((r, i) => [r.code, RARETES.length - i]));
const NOMS = Object.fromEntries(RARETES.map(r => [r.code, r.nom]));

let cartes = [];
let filtreRarete = null;
let filtreFavoris = false;
let filtreShiny = false;
const parId = new Map();   // id -> carte (pour retrouver une carte à partir de son id)
let vue = "cartes";   // "cartes" = toutes les cartes, "collection" = seulement les miennes

// filtre = [colonne, valeur] : ne garde que les lignes de ce joueur, quelles que soient les règles de lecture de la base
async function toutLire(table, colonnes, tri, filtre) {
  const tout = [];
  for (let i = 0; ; i += 1000) {
    let req = sb.from(table).select(colonnes);
    if (filtre) req = req.eq(filtre[0], filtre[1]);
    const { data, error } = await req.order(tri).range(i, i + 999);
    if (error) return { data: null, error };
    tout.push(...data);
    if (data.length < 1000) return { data: tout, error: null };
  }
}

async function charger() {
  if (SUPABASE_URL.startsWith("COLLE")) {
    return erreur("Ajoute l'URL et la clé publique de ton projet Supabase en haut du script de cette page.");
  }
  sb = supabase.createClient(SUPABASE_URL, SUPABASE_KEY);
  const { data, error } = await toutLire("cards", "*", "id");
  if (error) {
    return erreur("Impossible de lire les cartes : " + error.message);
  }
  if (!data.length) {
    return erreur("La table cards est vide, ou la lecture publique n'est pas autorisée. Vérifie que la règle de lecture (policy) est créée dans Supabase.");
  }
  cartes = data;
  data.forEach(c => parId.set(c.id, c));
  construireFiltres();
  afficher();
  initJoueur();
}

// Charge les cartes qu'on ne connaît pas encore (ex. un jumeau shiny créé après l'ouverture de la page)
async function assurerCartes(ids) {
  const manquantes = [...new Set(ids)].filter(id => !parId.has(id));
  if (!manquantes.length) return;
  const { data, error } = await sb.from("cards").select("*").in("id", manquantes);
  if (error || !data) return;
  data.forEach(c => { if (!parId.has(c.id)) { parId.set(c.id, c); cartes.push(c); } });
}

function erreur(texte) {
  const m = $("message");
  m.replaceChildren(el("p", { className: "erreur" }, texte));
}

function construireFiltres() {
  const zone = $("filtres");
  const tous = el("button", { className: "filtre", type: "button", textContent: "Toutes" });
  tous.setAttribute("aria-pressed", "true");
  const boutons = [[null, tous]];
  tous.onclick = () => choisir(null);
  zone.append(tous);
  RARETES.forEach(r => {
    const b = el("button", { className: "filtre", type: "button", textContent: r.nom });
    b.setAttribute("aria-pressed", "false");
    b.onclick = () => choisir(r.code);
    b.dataset.code = r.code;
    zone.append(b);
  });
  // Filtre « Favoris » : visible seulement dans l'onglet Collection
  const fav = el("button", { id: "filtre-favoris", className: "filtre", type: "button", textContent: "★ Favoris" });
  fav.setAttribute("aria-pressed", "false");
  fav.hidden = true;
  fav.onclick = () => {
    filtreFavoris = !filtreFavoris;
    fav.setAttribute("aria-pressed", String(filtreFavoris));
    page = 0;
    afficher();
  };
  zone.append(fav);
  // Filtre « Shiny » : montre toutes les cartes shiny (celles qu'on n'a pas encore sont grisées)
  const shiny = el("button", { id: "filtre-shiny", className: "filtre", type: "button", textContent: "✦ Shiny" });
  shiny.setAttribute("aria-pressed", "false");
  shiny.onclick = () => {
    filtreShiny = !filtreShiny;
    shiny.setAttribute("aria-pressed", String(filtreShiny));
    page = 0;
    afficher();
  };
  zone.append(shiny);
}
function choisir(code) {
  filtreRarete = code;
  page = 0;
  document.querySelectorAll(".filtre:not(#filtre-favoris):not(#filtre-shiny)").forEach(b => {
    b.setAttribute("aria-pressed", String((b.dataset.code ?? null) === code));
  });
  afficher();
}

const OPTION_RECENT = $("tri").querySelector('option[value="recent"]');

// Ce qui dépend de l'onglet et de la connexion : filtre Favoris, tri « dernière obtenue »
function majBarre() {
  const fav = $("filtre-favoris");
  if (fav) {
    fav.hidden = !connecte;
    if (!connecte && filtreFavoris) {
      filtreFavoris = false;
      fav.setAttribute("aria-pressed", "false");
    }
  }
  if (!OPTION_RECENT) return;
  const tri = $("tri");
  if (vue === "collection") {
    if (!OPTION_RECENT.isConnected) tri.insertBefore(OPTION_RECENT, tri.options[1] || null);
  } else {
    if (OPTION_RECENT.isConnected) OPTION_RECENT.remove();
    if (tri.value === "recent") tri.value = "rarete";
  }
}

let page = 0;
const GAP = 12;
const LARGEUR_CIBLE = 108;   // largeur visée d'une carte en px : plus petit = plus de cartes par page

function mesure(W, H) {
  const cols = Math.max(1, Math.round((W + GAP) / (LARGEUR_CIBLE + GAP)));
  let cw = (W - (cols - 1) * GAP) / cols;
  const rows = Math.max(1, Math.floor((H + GAP) / (cw * 1.4 + GAP)));
  cw = Math.min(cw, ((H - (rows - 1) * GAP) / rows) / 1.4);   // les lignes remplissent la hauteur
  return { cols, rows, cw: Math.floor(cw) };
}

function afficher() {
  majBarre();
  const q = $("recherche").value.trim().toLowerCase();
  const tri = $("tri").value || "rarete";
  let liste = cartes.filter(c =>
    (!filtreRarete || c.rarete === filtreRarete) &&
    (vue !== "collection" || possedees.has(c.id)) &&
    (!c.shiny || possedees.has(c.id) || filtreShiny) &&   // un shiny non possédé n'apparaît que via le filtre Shiny
    (!filtreShiny || c.shiny) &&
    (!filtreFavoris || favoris.has(c.id)) &&
    (!q || c.titre.toLowerCase().includes(q))
  );
  const cle = {
    rarete: c => ORDRE[c.rarete] * 1e9 + (c.vues_30j || 0),
    vues:   c => c.vues_30j || 0,
    atq:    c => c.atq || 0,
    def:    c => c.def || 0,
    annee:  c => c.annee || 0,
    recent: c => obtenues.get(c.id) || 0,
  }[tri];
  liste.sort(tri === "titre"
    ? (a, b) => a.titre.localeCompare(b.titre, "fr")
    : (a, b) => cle(b) - cle(a));

  $("compte").textContent = liste.length + " carte" + (liste.length > 1 ? "s" : "");
  let videTexte = "Aucune carte ne correspond. Essaie un autre mot ou une autre rareté.";
  if (vue === "collection" && !connecte) videTexte = "Connecte-toi depuis l'onglet Boosters pour voir ta collection.";
  else if (vue === "collection" && !possedees.size) videTexte = "Ta collection est vide. Ouvre un booster pour commencer.";
  else if (filtreFavoris && !favoris.size) videTexte = "Aucun favori pour l'instant. Clique sur l'étoile d'une carte que tu possèdes pour en ajouter.";
  $("message").replaceChildren(liste.length ? "" : el("p", { className: "vide" }, videTexte));

  const zone = $("grille-zone");
  const cs = getComputedStyle(zone);
  const W = zone.clientWidth - parseFloat(cs.paddingLeft) - parseFloat(cs.paddingRight);
  const H = zone.clientHeight - parseFloat(cs.paddingTop) - parseFloat(cs.paddingBottom);
  if (W < 100 || H < 100) return;   // onglet masqué : le ResizeObserver relancera afficher()

  const { cols, rows, cw } = mesure(W, H);
  const parPage = cols * rows;
  const pages = Math.max(1, Math.ceil(liste.length / parPage));
  page = Math.min(Math.max(page, 0), pages - 1);

  const g = $("grille");
  g.style.gridTemplateColumns = `repeat(${cols}, ${cw}px)`;
  g.style.gap = GAP + "px";
  g.replaceChildren(...liste.slice(page * parPage, (page + 1) * parPage).map(c => cellule(c)));

  $("page-info").textContent = `Page ${page + 1} / ${pages}`;
  $("prec").disabled = page === 0;
  $("suiv").disabled = page >= pages - 1;
}

function changerPage(d) { page += d; afficher(); }

function carte(c) {
  const b = el("button", { className: "carte", type: "button" });
  b.dataset.r = c.rarete;
  if (c.shiny) b.classList.add("shiny");
  const visuel = el("div", { className: "visuel" });
  if (c.image_url) {
    const img = el("img", { src: c.image_url, alt: "", loading: "lazy" });
    // Les images très larges (logos, bannières) sont affichées entières au lieu d'être rognées
    const marquer = () => { if (img.naturalWidth > img.naturalHeight * 1.2) img.classList.add("large"); };
    img.addEventListener("load", marquer);
    if (img.complete) marquer();
    visuel.append(img);
  } else {
    visuel.append(el("div", { className: "sans-image", innerHTML: CRANE }));
  }
  visuel.append(el("div", { className: "nom", textContent: nomCourt(c.titre) }));
  b.title = c.titre;
  b.append(
    visuel,
    el("div", { className: "stats" },
      el("span", { className: "atq" }, "Att. ", el("b", { textContent: c.atq })),
      el("span", { className: "def" }, "Déf. ", el("b", { textContent: c.def })),
      el("span", { className: "badge", textContent: c.rarete + (c.shiny ? " ✦" : "") })
    )
  );
  b.onclick = () => ouvrir(c);
  const q = possedees.get(c.id) || 0;
  if (q > 1) b.append(el("span", { className: "quantite", textContent: String(q), title: q + " exemplaires" }));
  if (c.nouvelle) b.append(el("span", { className: "nouvelle", textContent: "Nouvelle" }));
  return b;
}

const ETOILE = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01L12 2z"/></svg>';

function majEtoile(b, fav) {
  b.setAttribute("aria-pressed", String(fav));
  b.setAttribute("aria-label", fav ? "Retirer des favoris" : "Ajouter aux favoris");
  b.title = fav ? "Retirer des favoris" : "Ajouter aux favoris";
}

// Une carte de la grille + son étoile (l'étoile est à côté de la carte, pas dedans)
function cellule(c) {
  const cell = el("div", { className: "carte-cell" }, carte(c));
  if (connecte && possedees.has(c.id)) {
    const b = el("button", { className: "etoile", type: "button", innerHTML: ETOILE });
    majEtoile(b, favoris.has(c.id));
    b.onclick = () => basculerFavori(c.id, b);
    cell.append(b);
  }
  return cell;
}

async function basculerFavori(id, b) {
  const voulu = !favoris.has(id);
  const appliquer = v => {
    if (v) favoris.add(id); else favoris.delete(id);
    majEtoile(b, v);
  };
  appliquer(voulu);   // l'étoile change tout de suite, sans attendre le serveur
  if (filtreFavoris) afficher();
  const { error } = await sb.rpc("basculer_favori", { p_card: id, p_favori: voulu });
  if (error) {
    appliquer(!voulu);
    afficher();
    erreur("Impossible de modifier le favori : " + error.message);
  }
}

function ouvrir(c) {
  const d = $("detail");
  d.style.setProperty("--rar", `var(--c-${c.rarete})`);
  d.classList.toggle("shiny", !!c.shiny);
  const lien = "https://fr.wikipedia.org/wiki/" + encodeURIComponent(c.titre.replace(/ /g, "_"));
  const fermer = el("button", { className: "fermer", type: "button", textContent: "Fermer" });
  fermer.onclick = () => d.close();
  const chiffres = el("dl", { className: "chiffres" });
  const q = possedees.get(c.id) || 0;
  [["Rareté", NOMS[c.rarete] + (c.shiny ? " — Shiny ✦" : "")], ["Attaque", c.atq], ["Défense", c.def],
   ["Vues sur 30 jours", nombre(c.vues_30j)], ["Année", c.annee ?? "inconnue"],
   ["Langues de l'article", c.nb_langues],
   ...(q ? [["Exemplaires", q]] : [])].forEach(([t, v]) =>
    chiffres.append(el("div", {}, el("dt", { textContent: t }), el("dd", { textContent: v }))));
  const droite = el("div", {},
    el("h2", { textContent: nomCourt(c.titre) }),
    nomCourt(c.titre) !== c.titre ? el("p", { className: "complet", textContent: c.titre }) : "",
    chiffres,
    el("p", { className: "resume", textContent: c.resume || "Pas de résumé disponible." }),
    el("a", { href: lien, target: "_blank", rel: "noopener", textContent: "Lire l'article sur Wikipédia" })
  );
  const gauche = c.image_url ? el("img", { src: c.image_url, alt: "" }) : el("div");
  d.replaceChildren(fermer, el("div", { className: "fiche" }, gauche, droite));
  d.showModal();
}
$("detail").addEventListener("click", e => { if (e.target === e.currentTarget) e.currentTarget.close(); });

$("recherche").addEventListener("input", () => { page = 0; afficher(); });
$("tri").addEventListener("change", () => { page = 0; afficher(); });

$("prec").onclick = () => changerPage(-1);
$("suiv").onclick = () => changerPage(1);
document.addEventListener("keydown", e => {
  if ($("onglet-cartes").hidden || document.querySelector("dialog[open]")) return;
  if (["INPUT", "SELECT", "TEXTAREA"].includes(document.activeElement.tagName)) return;
  if (e.key === "ArrowRight") changerPage(1);
  if (e.key === "ArrowLeft") changerPage(-1);
});
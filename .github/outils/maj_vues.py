"""Mise à jour quotidienne des vues sur 30 jours et de la rareté de toutes les cartes.

Lancé chaque nuit par GitHub Actions (.github/workflows/maj-vues.yml).
On peut aussi le lancer à la main :
    SUPABASE_URL=... SUPABASE_KEY=<clé secrète> python .github/outils/maj_vues.py

- Les vues sont celles des 30 derniers jours complets de l'article Wikipédia.
- La rareté est recalculée en percentiles (les 50 % les moins lus = Commune, etc.).
- Une carte dont la colonne rarete_fixe est renseignée (ex. « Film d'horreur ») garde sa rareté.
- Les cartes shiny n'ont rien à faire ici : la base copie toute seule les valeurs de la carte d'origine.
"""
import os
import sys
import time
from concurrent.futures import ThreadPoolExecutor
from datetime import date, timedelta
from urllib.parse import quote

import numpy as np
import requests

LANGUE = "fr"
PERCENTILES = [50, 80, 95, 99, 99.9]          # mêmes seuils que le script de création des cartes
CODES = ["C", "PC", "R", "SR", "UR", "L"]
TRAVAILLEURS = 8
SEUIL_ECHECS = 0.25                            # au-delà de 25 % d'échecs, on signale l'erreur à GitHub

depot = os.environ.get("GITHUB_REPOSITORY", "HorrorMaster")
HEADERS = {"User-Agent": f"HorrorMaster-maj-quotidienne/1.0 (https://github.com/{depot})"}


def get_retry(url, essais=5):
    """GET avec nouvelles tentatives (limites de débit, erreurs serveur passagères)."""
    for n in range(essais):
        try:
            r = requests.get(url, headers=HEADERS, timeout=20)
            if r.status_code in (200, 404):
                return r
            if r.status_code in (429, 500, 502, 503, 504):
                try:
                    attente = float(r.headers.get("Retry-After", 2 ** n))
                except ValueError:
                    attente = 2 ** n
                time.sleep(attente)
                continue
            return r
        except requests.RequestException:
            time.sleep(2 ** n)
    return None


def titre_wiki(titre):
    return quote(titre.replace(" ", "_"), safe="")


def vues_30j(titre):
    fin = date.today() - timedelta(days=1)
    debut = fin - timedelta(days=29)
    r = get_retry("https://wikimedia.org/api/rest_v1/metrics/pageviews/per-article/"
                  f"{LANGUE}.wikipedia/all-access/user/{titre_wiki(titre)}/daily/{debut:%Y%m%d}/{fin:%Y%m%d}")
    if r is None:
        raise RuntimeError("Pageviews injoignable")
    if r.status_code == 404:      # aucune vue enregistrée : 0 est légitime
        return 0
    if r.status_code != 200:
        raise RuntimeError(f"Pageviews HTTP {r.status_code}")
    return int(sum(j["views"] for j in r.json()["items"]))


def resume_et_image(titre):
    r = get_retry(f"https://{LANGUE}.wikipedia.org/api/rest_v1/page/summary/{titre_wiki(titre)}")
    if r is None or r.status_code != 200:
        return None, None
    d = r.json()
    return d.get("extract"), d.get("thumbnail", {}).get("source")


def lire_cartes(sb):
    """Toutes les cartes « de base » (les jumeaux shiny sont mis à jour par la base)."""
    cartes, debut = [], 0
    while True:
        lot = (sb.table("cards")
                 .select("wikidata_id, titre, rarete, rarete_fixe, image_url")
                 .eq("shiny", False).order("id").range(debut, debut + 999).execute().data)
        cartes += lot
        if len(lot) < 1000:
            return cartes
        debut += 1000


def raretes(cartes):
    """Associe une rareté à chaque carte : percentiles sur les vues, sauf les raretés verrouillées."""
    libres = [c["vues"] for c in cartes if not c.get("rarete_fixe")]
    if not libres:
        return {}
    seuils = np.percentile(libres, PERCENTILES)
    res = {}
    for c in cartes:
        if c.get("rarete_fixe"):
            res[c["wikidata_id"]] = c["rarete_fixe"]
        else:
            res[c["wikidata_id"]] = CODES[int(np.searchsorted(seuils, c["vues"], side="right"))]
    return res


def traiter(c):
    try:
        c["vues"] = vues_30j(c["titre"])
        if c.get("rarete_fixe") and not c.get("image_url"):
            c["nouveau_resume"], c["nouvelle_image"] = resume_et_image(c["titre"])
    except Exception as e:                    # noqa: BLE001 - on garde la carte telle quelle et on continue
        c["erreur"] = str(e)
    return c


def main(sb=None):
    if sb is None:
        from supabase import create_client
        sb = create_client(os.environ["SUPABASE_URL"], os.environ["SUPABASE_KEY"])

    cartes = lire_cartes(sb)
    print(f"{len(cartes)} cartes à mettre à jour", flush=True)
    with ThreadPoolExecutor(max_workers=TRAVAILLEURS) as ex:
        cartes = list(ex.map(traiter, cartes))

    # un 2e passage, un par un, pour les échecs
    for c in [c for c in cartes if c.get("erreur")]:
        time.sleep(1)
        c.pop("erreur", None)
        traiter(c)

    echecs = [c for c in cartes if c.get("erreur")]
    bonnes = [c for c in cartes if not c.get("erreur")]
    if echecs:
        print(f"{len(echecs)} cartes ignorées cette nuit (ancienne valeur conservée) :",
              [c["titre"] for c in echecs[:10]], flush=True)
    if not bonnes:
        sys.exit("Aucune carte mise à jour : Wikimedia ne répond pas ?")

    nouvelles = raretes(bonnes)
    lignes, changees = [], 0
    for c in bonnes:
        r = nouvelles[c["wikidata_id"]]
        if r != c.get("rarete"):
            changees += 1
        ligne = {"wikidata_id": c["wikidata_id"], "titre": c["titre"], "vues_30j": c["vues"], "rarete": r}
        if c.get("nouveau_resume"):
            ligne["resume"] = c["nouveau_resume"]
        if c.get("nouvelle_image"):
            ligne["image_url"] = c["nouvelle_image"]
        lignes.append(ligne)

    for i in range(0, len(lignes), 500):
        sb.table("cards").upsert(lignes[i:i + 500], on_conflict="wikidata_id").execute()
    print(f"Terminé : {len(lignes)} cartes mises à jour, {changees} ont changé de rareté.", flush=True)

    if len(echecs) > SEUIL_ECHECS * len(cartes):
        sys.exit(f"Trop d'échecs ({len(echecs)}/{len(cartes)}) : voir les journaux.")


if __name__ == "__main__":
    main()

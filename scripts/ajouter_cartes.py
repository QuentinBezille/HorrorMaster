# Ajoute UNIQUEMENT les nouvelles cartes (films pas encore dans la base), sans toucher aux existantes.
#   python ajouter_cartes.py
# Pour avoir plus de cartes : décommente des lignes dans NATURES ci-dessous, puis relance.
import os, re, time
import numpy as np
from urllib.parse import unquote
from concurrent.futures import ThreadPoolExecutor
from supabase import create_client
import requests

from horror_master import HEADERS, EXCLUS, details, rang, caracteristiques
import maj_film_horreur

# type de carte -> code Wikidata de la nature de l'œuvre. Chaque ligne décommentée ajoute des cartes.
NATURES = {
    "film":  ["Q11424", "Q24869"],      # film, long métrage (déjà dans ta base)
    "film2": ["Q24862", "Q202866", "Q506240"],   # court métrage, film d'animation, téléfilm
    "serie": ["Q5398426"],              # série télévisée d'horreur
    "jeu": ["Q7889"],                 # jeux vidéo d'horreur (Resident Evil, Silent Hill...)
}
GENRE = "Q200092"                       # film d'horreur et tous ses sous-genres
PAGE = 1500
SEUILS_PCT = [50, 80, 95, 99, 99.9]
RARETES = ["C", "PC", "R", "SR", "UR", "L"]


def ids_existants(sb):
    ids, i = set(), 0
    while True:
        r = sb.table("cards").select("wikidata_id").order("id").range(i, i + 999).execute()
        ids |= {l["wikidata_id"] for l in r.data if l["wikidata_id"]}
        if len(r.data) < 1000:
            return ids
        i += 1000


def requete(natures, offset):
    valeurs = " ".join(f"wd:{n}" for n in natures)
    return f"""
SELECT ?film ?article ?nb_langues ?date WHERE {{
  VALUES ?nature {{ {valeurs} }}
  ?film wdt:P31 ?nature; wdt:P136/wdt:P279* wd:{GENRE}; wikibase:sitelinks ?nb_langues.
  ?article schema:about ?film; schema:isPartOf <https://fr.wikipedia.org/>.
  OPTIONAL {{ ?film wdt:P577 ?date. }}
}}
ORDER BY ?film ?date
LIMIT {PAGE} OFFSET {offset}
"""


def candidats(types):
    trouves = {}
    for type_ in types:
        offset = 0
        while True:
            for essai in range(1, 5):
                try:
                    r = requests.get("https://query.wikidata.org/sparql",
                                     params={"query": requete(NATURES[type_], offset), "format": "json"},
                                     headers=HEADERS, timeout=150)
                    r.raise_for_status()
                    lignes = r.json()["results"]["bindings"]
                    break
                except Exception as e:
                    print(f"{type_} page {offset} essai {essai}/4 échoué : {type(e).__name__}", flush=True)
                    time.sleep(10 * essai)
            else:
                raise SystemExit("Wikidata ne répond pas. Réessaie dans quelques minutes.")
            for b in lignes:
                qid = b["film"]["value"].split("/")[-1]
                annee = int(b["date"]["value"][:4]) if "date" in b else None
                if qid not in trouves:
                    brut = b["article"]["value"].split("/wiki/")[1]
                    trouves[qid] = {"wikidata_id": qid, "titre": unquote(brut).replace("_", " "), "wiki_titre": brut,
                                    "nb_langues": int(b["nb_langues"]["value"]), "annee": annee,
                                    "type": "serie" if type_ == "serie" else "film"}
                elif annee and (trouves[qid]["annee"] is None or annee < trouves[qid]["annee"]):
                    trouves[qid]["annee"] = annee
            if len(lignes) < PAGE:
                break
            offset += PAGE
            time.sleep(2)
        print(f"{type_} : {len(trouves)} œuvres trouvées au total", flush=True)
    return list(trouves.values())


def main():
    if "SUPABASE_URL" not in os.environ:
        maj_film_horreur.charger_env()
    sb = create_client(os.environ["SUPABASE_URL"], os.environ["SUPABASE_KEY"])

    deja = ids_existants(sb)
    nouvelles = [c for c in candidats(list(NATURES)) if c["wikidata_id"] not in deja and not EXCLUS.search(c["titre"])]
    print(f"{len(deja)} cartes déjà en base, {len(nouvelles)} nouvelles à ajouter", flush=True)
    if not nouvelles:
        return

    with ThreadPoolExecutor(max_workers=6) as ex:
        list(ex.map(details, nouvelles))                       # résumé, image, vues
    nouvelles = [c for c in nouvelles if not c.get("erreur")]  # les échecs seront repris au prochain lancement

    # Raretés : seuils calculés sur TOUTES les cartes de la base, pour rester cohérent avec les anciennes
    r = sb.table("cards").select("vues_30j").eq("shiny", False).is_("rarete_fixe", "null").range(0, 9999).execute()
    seuils = np.percentile([l["vues_30j"] or 0 for l in r.data] + [c["vues_30j"] for c in nouvelles], SEUILS_PCT)
    carac = caracteristiques([c["wikidata_id"] for c in nouvelles])
    for c in nouvelles:
        c.update(carac.get(c["wikidata_id"], {}))
    ra = rang([c.get("recette") for c in nouvelles]); rp = rang([c.get("prix") for c in nouvelles])
    rg = rang([2026 - c["annee"] if c["annee"] else None for c in nouvelles]); rd = rang([c.get("duree") for c in nouvelles])
    for i, c in enumerate(nouvelles):
        c["rarete"] = next((RARETES[k] for k, s in enumerate(seuils) if c["vues_30j"] < s), "L")
        c["atq"] = 1 + round(9 * (ra[i] + rp[i]) / 2)          # stats comparées entre nouvelles cartes
        c["def"] = 1 + round(9 * (rg[i] + rd[i]) / 2)

    lignes = [{k: v for k, v in c.items() if k not in ("wiki_titre", "duree", "recette", "prix", "erreur")} for c in nouvelles]
    for i in range(0, len(lignes), 100):
        sb.table("cards").upsert(lignes[i:i + 100], on_conflict="wikidata_id").execute()
    print(f"{len(lignes)} cartes ajoutées.", flush=True)


if __name__ == "__main__":
    main()

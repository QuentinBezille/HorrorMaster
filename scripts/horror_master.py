import json, re
import os, time, requests, numpy as np
from datetime import date, timedelta
from supabase import create_client
from urllib.parse import unquote
from concurrent.futures import ThreadPoolExecutor, as_completed

HEADERS = {"User-Agent": "HorrorCards/1.0 (quentinbezille45@gmail.com)"}
LANGUE = "fr"

# Films qu'on ne considère pas comme de l'horreur (kaijū / monstres géants).
# Ajoute d'autres mots séparés par | si besoin (ex. kong|pacific rim).
EXCLUS = re.compile(r"godzilla|gamera|gappa|mothra|rodan|ghidorah|daimajin", re.I)

def sans_exclus(films):
    gardes = [f for f in films if not EXCLUS.search(f["titre"])]
    if len(gardes) < len(films):
        print(f"{len(films) - len(gardes)} films exclus (kaijū / monstres géants)", flush=True)
    return gardes


PAGE = 2000

QUERY = """
SELECT ?film ?article ?nb_langues ?date WHERE {
  VALUES ?nature { wd:Q11424 wd:Q24869 }
  ?film wdt:P31 ?nature; wdt:P136/wdt:P279* wd:Q200092; wikibase:sitelinks ?nb_langues.
  ?article schema:about ?film; schema:isPartOf <https://fr.wikipedia.org/>.
  OPTIONAL { ?film wdt:P577 ?date. }
}
ORDER BY ?film ?date
LIMIT %d OFFSET %d
"""

def page_wikidata(offset):
    for essai in range(1, 5):
        try:
            r = requests.get("https://query.wikidata.org/sparql",
                             params={"query": QUERY % (PAGE, offset), "format": "json"},
                             headers=HEADERS, timeout=150)
            r.raise_for_status()
            return r.json()["results"]["bindings"]
        except Exception as e:
            print(f"Page {offset} essai {essai}/4 échoué : {type(e).__name__}", flush=True)
            time.sleep(10 * essai)
    raise SystemExit("Wikidata ne répond pas. Réessaie dans quelques minutes.")

def films_wikidata():
    cache = "films_cache.json"
    if os.path.exists(cache):
        print("Films lus depuis films_cache.json")
        with open(cache, encoding="utf-8") as f:
            return sans_exclus(json.load(f))

    films, offset = {}, 0
    while True:
        lignes = page_wikidata(offset)
        for b in lignes:
            qid = b["film"]["value"].split("/")[-1]
            annee = int(b["date"]["value"][:4]) if "date" in b else None
            if qid not in films:
                films[qid] = {
                    "wikidata_id": qid,
                    "titre": unquote(b["article"]["value"].split("/wiki/")[1]).replace("_", " "),
                    "wiki_titre": b["article"]["value"].split("/wiki/")[1],
                    "nb_langues": int(b["nb_langues"]["value"]),
                    "annee": annee, "type": "film",
                }
            elif annee and (films[qid]["annee"] is None or annee < films[qid]["annee"]):
                films[qid]["annee"] = annee
        print(f"{len(films)} films après {offset + len(lignes)} lignes", flush=True)
        if len(lignes) < PAGE:
            break
        offset += PAGE
        time.sleep(2)

    liste = list(films.values())
    with open(cache, "w", encoding="utf-8") as f:
        json.dump(liste, f, ensure_ascii=False)
    return sans_exclus(liste)

def get_retry(url, essais=5):
    for n in range(essais):
        try:
            r = requests.get(url, headers=HEADERS, timeout=15)
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

# 2. Wikipédia : résumé + image
def infos_wikipedia(titre):
    r = get_retry(f"https://{LANGUE}.wikipedia.org/api/rest_v1/page/summary/{titre}")
    if r is None:
        raise RuntimeError("Wikipédia injoignable")
    if r.status_code != 200:
        return "", None
    d = r.json()
    return d.get("extract", ""), d.get("thumbnail", {}).get("source")

def vues_30j(titre):
    fin = date.today() - timedelta(days=1)
    debut = fin - timedelta(days=29)
    r = get_retry(f"https://wikimedia.org/api/rest_v1/metrics/pageviews/per-article/"
                  f"{LANGUE}.wikipedia/all-access/user/{titre}/daily/{debut:%Y%m%d}/{fin:%Y%m%d}")
    if r is None:
        raise RuntimeError("Pageviews injoignable")
    if r.status_code == 404:      # aucune vue enregistrée : 0 est légitime
        return 0
    if r.status_code != 200:
        raise RuntimeError(f"Pageviews HTTP {r.status_code}")
    return sum(j["views"] for j in r.json()["items"])

# 3b. Wikidata : caractéristiques des films (durée, recette, prix)
def caracteristiques(qids):
    res = {}
    for i in range(0, len(qids), 50):
        valeurs = " ".join(f"wd:{q}" for q in qids[i:i+50])
        query = f"""
SELECT ?film (MAX(?duree) AS ?d) (MAX(?recette) AS ?r) (COUNT(DISTINCT ?prix) AS ?p) WHERE {{
  VALUES ?film {{ {valeurs} }}
  OPTIONAL {{ ?film wdt:P2047 ?duree. }}
  OPTIONAL {{ ?film wdt:P2142 ?recette. }}
  OPTIONAL {{ ?film wdt:P166|wdt:P1411 ?prix. }}
}} GROUP BY ?film
"""
        try:
            r = requests.get("https://query.wikidata.org/sparql",
                             params={"query": query, "format": "json"},
                             headers=HEADERS, timeout=60)
            r.raise_for_status()
            for b in r.json()["results"]["bindings"]:
                qid = b["film"]["value"].split("/")[-1]
                res[qid] = {
                    "duree": float(b["d"]["value"]) if "d" in b else None,
                    "recette": float(b["r"]["value"]) if "r" in b else None,
                    "prix": int(b["p"]["value"]) if "p" in b else 0,
                }
        except Exception as e:
            print("Erreur caractéristiques :", e)
        time.sleep(1)
    return res

# 4. Calcul des stats
def rang(valeurs):  # note de 0 à 1 ; valeur manquante (None) = 0.5
    connus = sorted(v for v in valeurs if v is not None)
    if len(connus) < 2:
        return [0.5] * len(valeurs)
    n = len(connus) - 1
    return [0.5 if v is None else connus.index(v) / n for v in valeurs]

    print("Caractéristiques Wikidata...", flush=True)
    carac = caracteristiques([c["wikidata_id"] for c in cartes])
    for c in cartes:
        c.update(carac.get(c["wikidata_id"], {}))

    calculer(cartes)

def calculer(cartes):
    vues = [c["vues_30j"] for c in cartes]
    seuils = np.percentile(vues, [50, 80, 95, 99, 99.9])
    r_recette = rang([c.get("recette") for c in cartes])
    r_prix    = rang([c.get("prix") for c in cartes])
    r_age     = rang([2026 - c["annee"] if c["annee"] else None for c in cartes])
    r_duree   = rang([c.get("duree") for c in cartes])
    for i, c in enumerate(cartes):
        v = c["vues_30j"]
        c["rarete"] = ("C" if v < seuils[0] else "PC" if v < seuils[1] else
                       "R" if v < seuils[2] else "SR" if v < seuils[3] else
                       "UR" if v < seuils[4] else "L")
        c["atq"] = 1 + round(9 * (r_recette[i] + r_prix[i]) / 2)
        c["def"] = 1 + round(9 * (r_age[i] + r_duree[i]) / 2)

def details(c):
    c.pop("erreur", None)
    try:
        c["resume"], c["image_url"] = infos_wikipedia(c["wiki_titre"])
        c["vues_30j"] = vues_30j(c["wiki_titre"])
    except Exception as e:
        c["erreur"] = str(e)
    return c

if __name__ == "__main__":
    cartes = films_wikidata()
    print(len(cartes), "films trouvés")
    with ThreadPoolExecutor(max_workers=6) as ex:
        futures = [ex.submit(details, c) for c in cartes]
        for i, f in enumerate(as_completed(futures), 1):
            c = f.result()
            print(f"{i}/{len(cartes)} {c['titre']} ({c.get('vues_30j', '?')} vues)", flush=True)

    # 2e passage, un par un, pour les films en échec
    rates = [c for c in cartes if c.get("erreur")]
    if rates:
        print(f"{len(rates)} films à réessayer...", flush=True)
        for c in rates:
            time.sleep(1)
            details(c)

    # Les films toujours sans vues fiables sont ignorés : leur carte existante reste intacte
    ignores = [c["titre"] for c in cartes if c.get("erreur")]
    if ignores:
        print("Ignorés cette fois :", ignores, flush=True)
    cartes = [c for c in cartes if not c.get("erreur")]


    calculer(cartes)

    print("Envoi vers Supabase...", flush=True)
    
    sb = create_client(os.environ["SUPABASE_URL"], os.environ["SUPABASE_KEY"])
    lignes = [{k: v for k, v in c.items()
            if k not in ("wiki_titre", "duree", "recette", "prix")} for c in cartes]
    for i in range(0, len(lignes), 100):
        sb.table("cards").upsert(lignes[i:i+100], on_conflict="wikidata_id").execute()
    import maj_film_horreur
    maj_film_horreur.maj(sb)       # la carte « Film d'horreur » prend aussi ses infos sur Wikipédia
    print("Terminé")
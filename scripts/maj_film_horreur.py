# Met à jour la carte « Film d'horreur » depuis sa page Wikipédia :
# résumé, image, vues sur 30 jours, nombre de langues. Sa rareté reste Légendaire (verrouillée dans la base).
# Lancer seul :  python maj_film_horreur.py      (il est aussi appelé à la fin de horror_master.py)
import os
import requests
from horror_master import HEADERS, infos_wikipedia, vues_30j

QID = "Q200092"
WIKI_TITRE = "Film_d'horreur"


def charger_env():
    """Lit SUPABASE_URL / SUPABASE_KEY dans scripts/.env si elles ne sont pas déjà définies."""
    chemin = os.path.join(os.path.dirname(os.path.abspath(__file__)), ".env")
    if not os.path.exists(chemin):
        return
    with open(chemin, encoding="utf-8") as f:
        for ligne in f:
            if "=" in ligne and not ligne.lstrip().startswith("#"):
                k, v = ligne.split("=", 1)
                os.environ.setdefault(k.strip(), v.strip().strip('"').strip("'"))


def nb_langues():
    r = requests.get("https://query.wikidata.org/sparql",
                     params={"query": f"SELECT ?n WHERE {{ wd:{QID} wikibase:sitelinks ?n }}", "format": "json"},
                     headers=HEADERS, timeout=60)
    r.raise_for_status()
    lignes = r.json()["results"]["bindings"]
    return int(lignes[0]["n"]["value"]) if lignes else 0


def maj(sb):
    resume, image = infos_wikipedia(WIKI_TITRE)
    champs = {"resume": resume, "image_url": image, "vues_30j": vues_30j(WIKI_TITRE), "nb_langues": nb_langues()}
    sb.table("cards").update(champs).eq("wikidata_id", QID).execute()   # la rareté n'est pas touchée
    print(f"Film d'horreur mis à jour : {champs['vues_30j']} vues, {champs['nb_langues']} langues, "
          f"image {'oui' if image else 'non'}", flush=True)


if __name__ == "__main__":
    charger_env()
    from supabase import create_client
    maj(create_client(os.environ["SUPABASE_URL"], os.environ["SUPABASE_KEY"]))

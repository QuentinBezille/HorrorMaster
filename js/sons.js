// Sons du jeu, fabriqués en direct avec la Web Audio API :
// aucun fichier audio à héberger et aucun droit d'auteur à gérer.
const Sons = (() => {
  let ac = null, master = null, bruit = null, ambiance = null;
  let actif = lire("hm_son", "1") === "1";
  let ambianceVoulue = lire("hm_ambiance", "1") === "1";

  function lire(cle, defaut) {
    try { return localStorage.getItem(cle) ?? defaut; } catch { return defaut; }
  }
  function ecrire(cle, valeur) {
    try { localStorage.setItem(cle, valeur); } catch { /* stockage indisponible : tant pis */ }
  }

  // Les navigateurs interdisent le son avant un premier geste de l'utilisateur :
  // on crée donc le moteur audio au premier clic ou à la première touche.
  function init() {
    if (ac) {
      if (ac.state === "suspended") ac.resume();
      return ac;
    }
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return null;
    ac = new AC();
    const compresseur = ac.createDynamicsCompressor();   // évite la saturation quand plusieurs sons se superposent
    master = ac.createGain();
    master.gain.value = 0.55;
    master.connect(compresseur);
    compresseur.connect(ac.destination);
    // 2 secondes de bruit blanc, réutilisées par tous les effets
    bruit = ac.createBuffer(1, ac.sampleRate * 2, ac.sampleRate);
    const d = bruit.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
    if (actif && ambianceVoulue) demarrerAmbiance();
    return ac;
  }

  // ---------- Briques de base ----------
  function enveloppe(g, t, vol, attaque, duree) {
    g.gain.setValueAtTime(0.0001, t);
    g.gain.linearRampToValueAtTime(vol, t + attaque);
    g.gain.exponentialRampToValueAtTime(0.0001, t + duree);
  }

  // Une note (éventuellement qui glisse de f vers f2)
  function note({ f, f2, type = "sine", t = 0, duree = 0.3, vol = 0.3, attaque = 0.005 }) {
    const t0 = ac.currentTime + t;
    const o = ac.createOscillator();
    const g = ac.createGain();
    o.type = type;
    o.frequency.setValueAtTime(f, t0);
    if (f2) o.frequency.exponentialRampToValueAtTime(f2, t0 + duree);
    enveloppe(g, t0, vol, attaque, duree);
    o.connect(g);
    g.connect(master);
    o.start(t0);
    o.stop(t0 + duree + 0.05);
  }

  // Un souffle de bruit filtré (papier qui se déchire, vent, craquement...)
  function souffle({ t = 0, duree = 0.3, vol = 0.3, filtre = "bandpass", f = 1000, f2, q = 1, attaque = 0.01 }) {
    const t0 = ac.currentTime + t;
    const s = ac.createBufferSource();
    s.buffer = bruit;
    const fl = ac.createBiquadFilter();
    fl.type = filtre;
    fl.Q.value = q;
    fl.frequency.setValueAtTime(f, t0);
    if (f2) fl.frequency.exponentialRampToValueAtTime(f2, t0 + duree);
    const g = ac.createGain();
    enveloppe(g, t0, vol, attaque, duree);
    s.connect(fl);
    fl.connect(g);
    g.connect(master);
    s.start(t0, Math.random() * Math.max(0, 1.9 - duree), duree + 0.05);
  }

  // Battement de coeur : deux coups sourds
  function battement(t = 0, vol = 0.5) {
    note({ f: 70, f2: 38, t, duree: 0.16, vol, attaque: 0.004 });
    note({ f: 62, f2: 34, t: t + 0.2, duree: 0.2, vol: vol * 0.75, attaque: 0.004 });
  }

  // Cloche grave (partiels non harmoniques = son métallique inquiétant)
  function cloche(f, t = 0, vol = 0.18, duree = 2.5) {
    [1, 2.76, 5.4, 8.93].forEach((m, i) =>
      note({ f: f * m, t, duree: duree / (1 + i * 0.6), vol: vol / (1 + i * 0.8), attaque: 0.003 }));
  }

  // Nappe sourde qui monte puis s'éteint
  function nappe({ freqs, t = 0, duree = 1.5, vol = 0.12, type = "sawtooth", coupure = 400 }) {
    const t0 = ac.currentTime + t;
    const fl = ac.createBiquadFilter();
    fl.type = "lowpass";
    fl.frequency.setValueAtTime(coupure * 0.4, t0);
    fl.frequency.linearRampToValueAtTime(coupure, t0 + duree * 0.6);
    const g = ac.createGain();
    g.gain.setValueAtTime(0.0001, t0);
    g.gain.linearRampToValueAtTime(vol, t0 + duree * 0.5);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + duree);
    fl.connect(g);
    g.connect(master);
    freqs.forEach(f => {
      const o = ac.createOscillator();
      o.type = type;
      o.frequency.value = f;
      o.detune.value = (Math.random() - 0.5) * 14;   // léger désaccord : plus glauque
      o.connect(fl);
      o.start(t0);
      o.stop(t0 + duree + 0.05);
    });
  }

  // ---------- Les effets ----------
  const effets = {
    clic() {
      note({ f: 220, f2: 90, duree: 0.07, vol: 0.18 });
      souffle({ duree: 0.04, vol: 0.06, filtre: "highpass", f: 3000 });
    },
    // Le paquet qu'on déchire
    ouverture() {
      souffle({ duree: 0.55, vol: 0.35, f: 900, f2: 7000, q: 0.8, attaque: 0.05 });
      souffle({ t: 0.05, duree: 0.45, vol: 0.2, filtre: "highpass", f: 2500, f2: 9000 });
      note({ f: 90, f2: 40, t: 0.02, duree: 0.5, vol: 0.4 });
      note({ f: 50, t: 0.1, duree: 1.0, vol: 0.12, type: "triangle" });
    },
    retourner() {
      souffle({ duree: 0.22, vol: 0.22, f: 600, f2: 4500, q: 0.9, attaque: 0.02 });
      note({ f: 140, f2: 70, t: 0.18, duree: 0.1, vol: 0.18 });
    },
    suivante() {
      souffle({ duree: 0.12, vol: 0.12, filtre: "highpass", f: 2000, f2: 5000 });
    },
    recap() {
      nappe({ freqs: [55, 82.4, 110], duree: 1.6, vol: 0.1, coupure: 500 });
      cloche(392, 0.1, 0.08, 1.8);
    },
    erreur() {
      note({ f: 110, f2: 55, duree: 0.35, vol: 0.3, type: "sawtooth" });
      note({ f: 117, f2: 58, duree: 0.35, vol: 0.2, type: "sawtooth" });
    },
        // Un échange est conclu
    echange() {
      souffle({ duree: 0.3, vol: 0.18, f: 800, f2: 3500, q: 0.9, attaque: 0.03 });
      note({ f: 196, t: 0.1, duree: 0.5, vol: 0.14, type: "triangle" });
      cloche(294, 0.25, 0.06, 1.4);
    },
  };

  // Plus la carte est rare, plus l'ambiance est lourde
  const raretes = {
    PC() { note({ f: 130.8, duree: 0.7, vol: 0.18, type: "triangle" }); },
    R() {   // le triton, l'intervalle « diabolique »
      nappe({ freqs: [110, 155.6], duree: 1.1, vol: 0.12, type: "triangle", coupure: 900 });
    },
    SR() {
      battement(0, 0.45);
      nappe({ freqs: [110, 155.6, 220], duree: 1.4, vol: 0.12, coupure: 1200 });
      cloche(659, 0.35, 0.07, 1.6);
    },
    UR() {
      battement(0, 0.55);
      battement(0.55, 0.45);
      nappe({ freqs: [55, 82.4, 116.5], duree: 2.0, vol: 0.16, coupure: 1500 });
      cloche(440, 0.3, 0.14, 2.6);
    },
    L() {
      battement(0, 0.6);
      battement(0.5, 0.55);
      nappe({ freqs: [41.2, 61.7, 87.3, 123.5], duree: 3.2, vol: 0.2, coupure: 2200 });
      note({ f: 120, f2: 900, t: 0.2, duree: 1.3, vol: 0.09, type: "sawtooth" });   // la montée
      cloche(196, 1.4, 0.22, 4);                                                    // le glas
      souffle({ t: 1.4, duree: 1.2, vol: 0.3, filtre: "lowpass", f: 300, f2: 60 });
      note({ f: 45, t: 1.4, duree: 1.4, vol: 0.5 });
    },
  };

  const vibrations = { SR: [60], UR: [70, 50, 70], L: [90, 60, 90, 60, 220] };

  // ---------- Ambiance : un vent lointain et lent ----------
    function demarrerAmbiance() {
    if (ambiance || !ac) return;
    const t0 = ac.currentTime;

    // 1. Le vent, qui monte et descend très lentement
    const s = ac.createBufferSource();
    s.buffer = bruit;
    s.loop = true;
    const fl = ac.createBiquadFilter();
    fl.type = "bandpass";
    fl.frequency.value = 350;
    fl.Q.value = 0.7;
    const lfo = ac.createOscillator();
    lfo.frequency.value = 0.07;
    const lfoGain = ac.createGain();
    lfoGain.gain.value = 180;
    lfo.connect(lfoGain);
    lfoGain.connect(fl.frequency);
    const g = ac.createGain();
    g.gain.setValueAtTime(0.0001, t0);
    g.gain.linearRampToValueAtTime(0.07, t0 + 3);
    s.connect(fl);
    fl.connect(g);
    g.connect(master);
    s.start();
    lfo.start();

    // 2. Un bourdonnement très grave, à peine audible
    const dr = ac.createGain();
    dr.gain.setValueAtTime(0.0001, t0);
    dr.gain.linearRampToValueAtTime(0.035, t0 + 5);
    dr.connect(master);
    const oscs = [55, 55.7, 82.4].map(f => {
      const o = ac.createOscillator();
      o.type = "sine";
      o.frequency.value = f;
      o.connect(dr);
      o.start();
      return o;
    });

    ambiance = { g, dr, s, lfo, oscs, timer: null };

    // 3. De temps en temps, un bruit lointain : cloche, craquement ou gémissement
    const evenement = () => {
      if (!ambiance) return;
      if (ac.state === "running") {
        const r = Math.random();
        if (r < 0.35) cloche(110 + Math.random() * 70, 0, 0.03, 5);
        else if (r < 0.7) souffle({ duree: 0.18, vol: 0.05, f: 1500 + Math.random() * 1500, q: 4 });
        else note({ f: 180 + Math.random() * 80, f2: 120, duree: 2.4, vol: 0.025, attaque: 0.8 });
      }
      ambiance.timer = setTimeout(evenement, 9000 + Math.random() * 16000);
    };
    ambiance.timer = setTimeout(evenement, 6000);
  }

  function arreterAmbiance() {
    if (!ambiance) return;
    const { g, dr, s, lfo, oscs, timer } = ambiance;
    ambiance = null;
    clearTimeout(timer);
    const t = ac.currentTime;
    [g, dr].forEach(x => {
      x.gain.cancelScheduledValues(t);
      x.gain.setValueAtTime(Math.max(x.gain.value, 0.0001), t);
      x.gain.linearRampToValueAtTime(0.0001, t + 1);
    });
    setTimeout(() => {
      try { s.stop(); lfo.stop(); oscs.forEach(o => o.stop()); } catch { /* déjà arrêtés */ }
    }, 1100);
  }

  // ---------- Ce que les autres fichiers utilisent ----------
  function jouer(nom) {
    if (!actif || !init() || !effets[nom]) return;
    effets[nom]();
  }

  // Joué quand une carte est retournée ; le délai le cale sur la fin de l'animation
  function rarete(code, delai = 0.35) {
    if (!actif || !init()) return;
    if (raretes[code]) setTimeout(() => { if (actif) raretes[code](); }, delai * 1000);
    if (vibrations[code] && navigator.vibrate) navigator.vibrate(vibrations[code]);
  }

  // ---------- Boutons Son / Ambiance ----------
  function majBoutons() {
    const b = document.getElementById("btn-son");
    const a = document.getElementById("btn-ambiance");
    if (b) {
      b.setAttribute("aria-pressed", String(actif));
      b.textContent = actif ? "Son : oui" : "Son : non";
    }
    if (a) {
      a.setAttribute("aria-pressed", String(actif && ambianceVoulue));
      a.textContent = ambianceVoulue ? "Ambiance : oui" : "Ambiance : non";
      a.disabled = !actif;
    }
  }

  function basculerSon() {
    actif = !actif;
    ecrire("hm_son", actif ? "1" : "0");
    if (!actif) {
      arreterAmbiance();
    } else if (init()) {
      if (ambianceVoulue) demarrerAmbiance();
      effets.clic();
    }
    majBoutons();
  }

  function basculerAmbiance() {
    ambianceVoulue = !ambianceVoulue;
    ecrire("hm_ambiance", ambianceVoulue ? "1" : "0");
    if (ambianceVoulue && actif && init()) demarrerAmbiance();
    else arreterAmbiance();
    majBoutons();
  }

  document.getElementById("btn-son")?.addEventListener("click", basculerSon);
  document.getElementById("btn-ambiance")?.addEventListener("click", basculerAmbiance);
  addEventListener("pointerdown", init, { once: true });
  addEventListener("keydown", init, { once: true });
  // Onglet caché = on coupe tout pour ne pas vider la batterie
  document.addEventListener("visibilitychange", () => {
    if (!ac) return;
    if (document.hidden) ac.suspend(); else ac.resume();
  });
  majBoutons();

  return { jouer, rarete };
})();

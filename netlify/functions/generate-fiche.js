const SYSTEM_PROMPTS = {
  eveil: `Tu es un conseiller pédagogique expert du système éducatif sénégalais (Curriculum de l'Éducation de Base CEB).
Discipline: HISTOIRE, GEOGRAPHIE, IST, VIVRE ENSEMBLE (Éveil).
Démarche OFFICIELLE Le Miroir adapté au CEB:
1. Révision / Rappel des acquis
2. Imprégnation / Observation libre
3. Analyse / Observation dirigée et exploitation
4. Synthèse / Élaboration du résumé
5. Évaluation / Application des acquis`,

  mathematiques: `Tu es un conseiller pédagogique expert du CEB sénégalais.
Discipline: MATHEMATIQUES.
Démarche OFFICIELLE Mathématiques:
1. Révision / Calcul mental
2. Motivation / Présentation de la situation problème
3. Recherche / Analyse et mise en commun
4. Synthèse / Institutionnalisation de la règle
5. Évaluation / Exercices d'application`,

  lecture: `Tu es un conseiller pédagogique expert du CEB sénégalais.
Discipline: FRANCAIS LECTURE.
Démarche OFFICIELLE Lecture:
1. Révision / Rappel des acquis
2. Imprégnation / Situation de départ et observation libre du texte
3. Analyse / Lecture silencieuse et compréhension
4. Synthèse / Lecture expressive et élaboration du résumé
5. Évaluation / Application et lecture à haute voix`,

  grammaire: `Tu es un conseiller pédagogique expert du CEB sénégalais.
Discipline: FRANCAIS Grammaire/Conjugaison/Orthographe/Vocabulaire.
Démarche OFFICIELLE Langue:
1. Révision / Rappel des acquis
2. Imprégnation / Présentation du texte support
3. Analyse / Observation dirigée, manipulation et exploitation
4. Synthèse / Élaboration de la règle
5. Évaluation / Application`
};

const BASE_JSON = `
Produis UNIQUEMENT un objet JSON valide (sans markdown) respectant EXACTEMENT:
{
  "informations": { "classe": "", "sous_domaine": "", "duree": "", "discipline": "", "cb": "", "palier": "", "oa": "", "os": "", "contenus": "", "moyens_materiels": "", "documentation": "" },
  "deroulement": [ { "etape": "INTITULE EXACT", "duree": "", "part_du_maitre": ["..."], "part_des_eleves": ["..."] } ]
}
Règles: Exactement 5 étapes avec les intitulés EXACTS de la démarche ci-dessus. part_du_maitre et part_des_eleves = phrases courtes concrètes. Contexte sénégalais. Résumé étape 4 en toutes lettres. Français correct.
`;

function detectDiscipline(titre) {
  const t = titre.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "");
  if (/math|calcul|numeration|geometrie|mesure|probleme|addition|soustraction|multiplication|division|fraction|resolution/.test(t)) return "mathematiques";
  if (/lecture|texte|comprehension|alphabet/.test(t)) return "lecture";
  if (/grammaire|conjugaison|orthographe|vocabulaire|accord|verbe|phrase|nom|adjectif|pluriel|expression ecrite|dictee/.test(t)) return "grammaire";
  return "eveil";
}

// --- OPTIMISATIONS POUR 200 ENSEIGNANTS ---
const CACHE = new Map(); // fiche déjà générée
const RATE_LIMIT = new Map(); // ip -> {count, time}

function getCacheKey(classe, titre) {
  return `${classe.toLowerCase().trim()}-${titre.toLowerCase().trim()}`;
}

function isRateLimited(ip) {
  const now = Date.now();
  const entry = RATE_LIMIT.get(ip) || { count: 0, time: now };
  if (now - entry.time > 60 * 60 * 1000) { // reset chaque heure
    entry.count = 0;
    entry.time = now;
  }
  entry.count++;
  RATE_LIMIT.set(ip, entry);
  return entry.count > 25; // 25 fiches / heure / IP = large pour un enseignant
}

const headers = { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" };

exports.handler = async (event) => {
  if (event.httpMethod !== "POST") {
    return { statusCode: 405, headers, body: JSON.stringify({ error: "Méthode non autorisée" }) };
  }

  const ip = event.headers['x-nf-client-connection-ip'] || event.headers['x-forwarded-for']?.split(',')[0] || 'unknown';
  if (isRateLimited(ip)) {
    return { statusCode: 429, headers, body: JSON.stringify({ error: "Trop de requêtes, patiente 1h. Limite: 25 fiches/heure." }) };
  }

  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    return { statusCode: 500, headers, body: JSON.stringify({ error: "Clé API non configurée" }) };
  }

  let classe, titre;
  try {
    ({ classe, titre } = JSON.parse(event.body || "{}"));
  } catch {
    return { statusCode: 400, headers, body: JSON.stringify({ error: "Requête invalide" }) };
  }

  classe = String(classe || "").trim().slice(0, 50);
  titre = String(titre || "").trim().slice(0, 200);
  if (!classe || !titre) {
    return { statusCode: 400, headers, body: JSON.stringify({ error: "Classe et titre requis" }) };
  }

  // 1. CACHE CHECK
  const cacheKey = getCacheKey(classe, titre);
  if (CACHE.has(cacheKey)) {
    console.log(`CACHE HIT | IP: ${ip} | ${classe} - ${titre}`);
    return { statusCode: 200, headers, body: JSON.stringify(CACHE.get(cacheKey)) };
  }

  const disciplineType = detectDiscipline(titre);
  const systemText = SYSTEM_PROMPTS[disciplineType] + "\n" + BASE_JSON;
  const model = process.env.GEMINI_MODEL || "gemini-2.5-flash";
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`;

  try {
    console.log(`GENERATE | IP: ${ip} | ${classe} - ${titre} | Discipline: ${disciplineType}`);
    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-goog-api-key": apiKey },
      body: JSON.stringify({
        systemInstruction: { parts: [{ text: systemText }] },
        contents: [{ role: "user", parts: [{ text: `Classe: ${classe}\nTitre: ${titre}\nDiscipline détectée: ${disciplineType}` }] }],
        generationConfig: { temperature: 0.5, responseMimeType: "application/json" },
      }),
    });

    const data = await res.json();
    if (!res.ok) {
      console.error(`GEMINI ERROR: ${data?.error?.message}`);
      return { statusCode: 502, headers, body: JSON.stringify({ error: data?.error?.message || "Erreur API Gemini - quota peut-être atteint" }) };
    }

    let text = data?.candidates?.[0]?.content?.parts?.map(p => p.text || "").join("") || "";
    text = text.replace(/^```json\s*|```$/g, "").trim();
    const fiche = JSON.parse(text);

    // Sauvegarde en cache
    CACHE.set(cacheKey, fiche);
    // Limite la taille du cache à 200 fiches max pour ne pas saturer la mémoire
    if (CACHE.size > 200) {
      const firstKey = CACHE.keys().next().value;
      CACHE.delete(firstKey);
    }

    return { statusCode: 200, headers, body: JSON.stringify(fiche) };
  } catch (e) {
    console.error(e);
    return { statusCode: 500, headers, body: JSON.stringify({ error: "Échec de la génération, réessayez." }) };
  }
};

const SYSTEM_PROMPTS = {
  eveil: `Tu es un conseiller pédagogique expert du CEB sénégalais. Discipline: HISTOIRE, GEOGRAPHIE, IST, VIVRE ENSEMBLE. Démarche: 1. Révision / Rappel des acquis 2. Imprégnation / Observation libre 3. Analyse / Observation dirigée et exploitation 4. Synthèse / Élaboration du résumé 5. Évaluation / Application`,
  mathematiques: `Tu es un conseiller pédagogique expert du CEB sénégalais. Discipline: MATHEMATIQUES. Démarche: 1. Révision / Calcul mental 2. Motivation / Présentation de la situation problème 3. Recherche / Analyse et mise en commun 4. Synthèse / Institutionnalisation 5. Évaluation`,
  lecture: `Tu es un conseiller pédagogique expert du CEB sénégalais. Discipline: FRANCAIS LECTURE. Démarche: 1. Révision 2. Imprégnation / Situation de départ 3. Analyse / Lecture silencieuse 4. Synthèse / Lecture expressive 5. Évaluation`,
  grammaire: `Tu es un conseiller pédagogique expert du CEB sénégalais. Discipline: FRANCAIS Grammaire/Conjugaison. Démarche: 1. Révision 2. Imprégnation / Texte support 3. Analyse / Observation dirigée, manipulation 4. Synthèse / Règle 5. Évaluation`
};
const BASE_JSON = `Produis UNIQUEMENT JSON valide: {"informations": {"classe": "", "sous_domaine": "", "duree": "", "discipline": "", "cb": "", "palier": "", "oa": "", "os": "", "contenus": "", "moyens_materiels": "", "documentation": ""}, "deroulement": [{"etape": "INTITULE EXACT", "duree": "", "part_du_maitre": ["..."], "part_des_eleves": ["..."]}] } Règles: 5 étapes exactes de la démarche. Contexte sénégalais. Résumé étape 4 en toutes lettres.`;

function detectDiscipline(titre) {
  const t = titre.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "");
  if (/math|calcul|numeration|geometrie|mesure|probleme|addition|soustraction|multiplication|division|fraction|resolution/.test(t)) return "mathematiques";
  if (/lecture|texte|comprehension|alphabet/.test(t)) return "lecture";
  if (/grammaire|conjugaison|orthographe|vocabulaire|accord|verbe|phrase|nom|adjectif|pluriel|expression ecrite|dictee/.test(t)) return "grammaire";
  return "eveil";
}

const CACHE = new Map();
const RATE_LIMIT = new Map();
function getCacheKey(c,t){ return `${c.toLowerCase().trim()}-${t.toLowerCase().trim()}`; }
function isRateLimited(ip){
  const now=Date.now(); const e=RATE_LIMIT.get(ip)||{count:0,time:now};
  if(now-e.time>3600000){e.count=0;e.time=now;} e.count++; RATE_LIMIT.set(ip,e); return e.count>25;
}
const headers = { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" };

// MODELES AVEC QUOTA GRATUIT ELEVE (20/jour c'est fini pour 2.5-flash)
const MODELS_FALLBACK = [
  "gemini-2.0-flash",           // 1500/jour - ACTUELLEMENT LE MEILLEUR GRATUIT
  "gemini-2.0-flash-lite",      // 1500/jour
  "gemini-2.5-flash-lite",      // 1000/jour environ
  "gemini-flash-latest",        // alias qui suit le meilleur
  "gemini-2.5-flash"            // dernier recours 20/jour
];

exports.handler = async (event) => {
  if (event.httpMethod !== "POST") return { statusCode: 405, headers, body: JSON.stringify({ error: "Méthode non autorisée" }) };
  const ip = event.headers['x-nf-client-connection-ip'] || event.headers['x-forwarded-for']?.split(',')[0] || 'unknown';
  if (isRateLimited(ip)) return { statusCode: 429, headers, body: JSON.stringify({ error: "Trop de requêtes, patiente 1h." }) };

  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) return { statusCode: 500, headers, body: JSON.stringify({ error: "Clé API non configurée" }) };

  let classe, titre;
  try { ({ classe, titre } = JSON.parse(event.body || "{}")); } catch { return { statusCode: 400, headers, body: JSON.stringify({ error: "Requête invalide" }) }; }
  classe = String(classe||"").trim().slice(0,50); titre = String(titre||"").trim().slice(0,200);
  if (!classe || !titre) return { statusCode: 400, headers, body: JSON.stringify({ error: "Classe et titre requis" }) };

  const cacheKey = getCacheKey(classe, titre);
  if (CACHE.has(cacheKey)) {
    console.log(`CACHE HIT | ${classe} - ${titre}`);
    return { statusCode: 200, headers, body: JSON.stringify(CACHE.get(cacheKey)) };
  }

  const disciplineType = detectDiscipline(titre);
  const systemText = SYSTEM_PROMPTS[disciplineType] + "\n" + BASE_JSON;
  const preferredModel = "gemini-2.0-flash"; // FIX 2026: 1.5-flash n'existe plus en v1beta, 2.0-flash = 1500/jour
  
  // On essaie d'abord le modèle préféré, puis les fallbacks
  const modelsToTry = [preferredModel, ...MODELS_FALLBACK.filter(m=>m!==preferredModel)];

  let lastError = null;
  for (const model of modelsToTry) {
    try {
      console.log(`TRY MODEL ${model} | ${classe} - ${titre}`);
      const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`;
      const res = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-goog-api-key": apiKey },
        body: JSON.stringify({
          systemInstruction: { parts: [{ text: systemText }] },
          contents: [{ role: "user", parts: [{ text: `Classe: ${classe}\nTitre: ${titre}\nDiscipline: ${disciplineType}` }] }],
          generationConfig: { temperature: 0.5, responseMimeType: "application/json" },
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        lastError = data?.error?.message || "Erreur";
        console.error(`MODEL ${model} FAILED: ${lastError}`);
        if (lastError.includes("Quota exceeded") || lastError.includes("429") || lastError.includes("not found") || lastError.includes("not supported") || lastError.includes("404")) continue; // essaie modèle suivant
        else return { statusCode: 502, headers, body: JSON.stringify({ error: lastError }) };
      }
      let text = data?.candidates?.[0]?.content?.parts?.map(p=>p.text||"").join("")||"";
      text = text.replace(/^```json\s*|```$/g,"").trim();
      const fiche = JSON.parse(text);
      CACHE.set(cacheKey, fiche);
      if (CACHE.size > 300) CACHE.delete(CACHE.keys().next().value);
      return { statusCode: 200, headers, body: JSON.stringify(fiche) };
    } catch (e) {
      lastError = e.message;
      console.error(`MODEL ${model} EXCEPTION: ${e}`);
      continue;
    }
  }

  return { statusCode: 429, headers, body: JSON.stringify({ error: `Quota dépassé sur tous les modèles. Dernier: ${lastError}. Réessaie demain ou ajoute une 2e clé API. Voir https://ai.dev/rate-limit` }) };
};

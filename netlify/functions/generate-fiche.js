const SYSTEM_PROMPTS = {
  eveil: `Tu es un conseiller pédagogique expert du CEB sénégalais. HISTOIRE, GEOGRAPHIE, IST, VIVRE ENSEMBLE. Démarche: 1. Révision / Rappel des acquis 2. Imprégnation / Observation libre 3. Analyse / Observation dirigée et exploitation 4. Synthèse / Élaboration du résumé 5. Évaluation / Application`,
  mathematiques: `Tu es un conseiller pédagogique expert du CEB sénégalais. MATHEMATIQUES. Démarche: 1. Révision / Calcul mental 2. Motivation / Présentation de la situation problème 3. Recherche / Analyse et mise en commun 4. Synthèse / Institutionnalisation 5. Évaluation`,
  lecture: `Tu es un conseiller pédagogique expert du CEB sénégalais. FRANCAIS LECTURE. Démarche: 1. Révision 2. Imprégnation / Situation de départ 3. Analyse / Lecture silencieuse 4. Synthèse / Lecture expressive 5. Évaluation`,
  grammaire: `Tu es un conseiller pédagogique expert du CEB sénégalais. FRANCAIS Grammaire/Conjugaison. Démarche: 1. Révision 2. Imprégnation / Texte support 3. Analyse / Observation dirigée, manipulation 4. Synthèse / Règle 5. Évaluation`
};
const BASE_JSON = `Produis UNIQUEMENT JSON valide: {"informations": {"classe": "", "sous_domaine": "", "duree": "", "discipline": "", "cb": "", "palier": "", "oa": "", "os": "", "contenus": "", "moyens_materiels": "", "documentation": ""}, "deroulement": [{"etape": "INTITULE EXACT", "duree": "", "part_du_maitre": ["..."], "part_des_eleves": ["..."]}] } Règles: 5 étapes exactes. Contexte sénégalais. Résumé étape 4 en toutes lettres.`;

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

// AUTO-DETECTION du modèle disponible - plus besoin de mettre en dur
async function getAvailableModel(apiKey) {
  try {
    const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models?key=${apiKey}`);
    const data = await res.json();
    if (!data.models) return null;
    // On cherche le meilleur modèle flash qui supporte generateContent
    const candidates = data.models
      .filter(m => m.supportedGenerationMethods?.includes("generateContent"))
      .map(m => m.name.replace("models/",""))
      .filter(name => name.includes("flash"));

    // Ordre de préférence 2026: 3.8-flash, 3-flash, 2.5-flash-lite, 2.5-flash, 2.0-flash-lite
    const order = ["3.8-flash", "3-flash", "2.5-flash-lite", "2.5-flash", "2.0-flash-lite", "2.0-flash", "flash-latest"];
    for (const pref of order) {
      const found = candidates.find(c => c.includes(pref));
      if (found) return found;
    }
    return candidates[0] || "gemini-2.5-flash-lite";
  } catch {
    return "gemini-2.5-flash-lite"; // fallback sûr
  }
}

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
    return { statusCode: 200, headers, body: JSON.stringify(CACHE.get(cacheKey)) };
  }

  const disciplineType = detectDiscipline(titre);
  const systemText = SYSTEM_PROMPTS[disciplineType] + "\n" + BASE_JSON;
  
  // Détection auto du modèle - NE PLUS METTRE EN DUR
  let model = await getAvailableModel(apiKey);
  console.log(`MODEL AUTO-DETECTED: ${model} | ${classe} - ${titre}`);

  const modelsToTry = [model, "gemini-3.8-flash", "gemini-2.5-flash-lite", "gemini-2.5-flash", "gemini-flash-latest", "gemini-2.0-flash"];

  let lastError = null;
  for (let i=0; i<[...new Set(modelsToTry)].length; i++) {
    const m = [...new Set(modelsToTry)][i];
    if (i>0) await new Promise(r=>setTimeout(r, 800)); // petite pause entre modèles
    try {
      const url = `https://generativelanguage.googleapis.com/v1beta/models/${m}:generateContent`;
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
        console.error(`MODEL ${m} FAILED: ${lastError}`);
        if (lastError.includes("Quota") || lastError.includes("429") || lastError.includes("not found") || lastError.includes("no longer available") || lastError.includes("404") || lastError.includes("high demand") || lastError.includes("overloaded") || lastError.includes("503") || lastError.includes("500") || lastError.includes("UNAVAILABLE") || lastError.includes("temporarily")) continue;
        return { statusCode: 502, headers, body: JSON.stringify({ error: lastError }) };
      }
      let text = data?.candidates?.[0]?.content?.parts?.map(p=>p.text||"").join("")||"";
      text = text.replace(/^```json\s*|```$/g,"").trim();
      const fiche = JSON.parse(text);
      CACHE.set(cacheKey, fiche);
      if (CACHE.size > 300) CACHE.delete(CACHE.keys().next().value);
      return { statusCode: 200, headers, body: JSON.stringify(fiche) };
    } catch (e) {
      lastError = e.message;
      continue;
    }
  }
  return { statusCode: 429, headers, body: JSON.stringify({ error: `Tous les modèles échoués. Dernier: ${lastError}` }) };
};

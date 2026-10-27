const SYSTEM_PROMPTS = {
  eveil: `Tu es un conseiller pédagogique expert du CEB sénégalais. HISTOIRE, GEOGRAPHIE, IST, VIVRE ENSEMBLE. Démarche: 1. Révision 2. Imprégnation / Observation libre 3. Analyse / Observation dirigée 4. Synthèse / Résumé 5. Évaluation`,
  mathematiques: `Tu es un conseiller pédagogique expert du CEB sénégalais. MATHEMATIQUES. Démarche: 1. Révision / Calcul mental 2. Motivation / Situation problème 3. Recherche / Analyse 4. Synthèse 5. Évaluation`,
  lecture: `Tu es un conseiller pédagogique expert du CEB sénégalais. FRANCAIS LECTURE. Démarche: 1. Révision 2. Imprégnation 3. Analyse / Lecture silencieuse 4. Synthèse 5. Évaluation`,
  grammaire: `Tu es un conseiller pédagogique expert du CEB sénégalais. FRANCAIS Grammaire/Conjugaison. Démarche: 1. Révision 2. Imprégnation / Texte support 3. Analyse / Manipulation 4. Synthèse / Règle 5. Évaluation`
};
const BASE_JSON = `Produis UNIQUEMENT JSON valide: {"informations": {"classe": "", "sous_domaine": "", "duree": "", "discipline": "", "cb": "", "palier": "", "oa": "", "os": "", "contenus": "", "moyens_materiels": "", "documentation": ""}, "deroulement": [{"etape": "INTITULE EXACT", "duree": "", "part_du_maitre": ["..."], "part_des_eleves": ["..."]}] }`;

function detectDiscipline(titre) {
  const t = titre.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "");
  if (/math|calcul|numeration|geometrie|mesure|probleme|addition|soustraction|multiplication|division|fraction|resolution/.test(t)) return "mathematiques";
  if (/lecture|texte|comprehension|alphabet/.test(t)) return "lecture";
  if (/grammaire|conjugaison|orthographe|vocabulaire|accord|verbe|phrase|nom|adjectif|pluriel|expression ecrite|dictee/.test(t)) return "grammaire";
  return "eveil";
}

const CACHE = new Map();
const headers = { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" };

exports.handler = async (event) => {
  if (event.httpMethod !== "POST") return { statusCode: 405, headers, body: JSON.stringify({ error: "Méthode non autorisée" }) };
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) return { statusCode: 500, headers, body: JSON.stringify({ error: "Clé API non configurée" }) };

  let classe, titre;
  try { ({ classe, titre } = JSON.parse(event.body || "{}")); } catch { return { statusCode: 400, headers, body: JSON.stringify({ error: "Requête invalide" }) }; }
  classe = String(classe||"").trim().slice(0,50); titre = String(titre||"").trim().slice(0,200);
  if (!classe || !titre) return { statusCode: 400, headers, body: JSON.stringify({ error: "Classe et titre requis" }) };

  const cacheKey = `${classe.toLowerCase()}-${titre.toLowerCase()}`;
  if (CACHE.has(cacheKey)) return { statusCode: 200, headers, body: JSON.stringify(CACHE.get(cacheKey)) };

  const disciplineType = detectDiscipline(titre);
  const systemText = SYSTEM_PROMPTS[disciplineType] + "\n" + BASE_JSON;

  // LISTE 2026 - On met 3.8-flash en PREMIER comme Google le demande
  const models = [
    "gemini-3.8-flash",
    "gemini-2.5-flash-lite",
    "gemini-2.5-flash",
    "gemini-flash-latest"
  ];

  const apiVersions = ["v1beta", "v1"];

  let lastError = null;
  for (const apiVer of apiVersions) {
    for (const m of models) {
      try {
        const url = `https://generativelanguage.googleapis.com/${apiVer}/models/${m}:generateContent`;
        console.log(`TRY ${apiVer}/${m}`);
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
          lastError = data?.error?.message || JSON.stringify(data);
          console.error(`FAIL ${apiVer}/${m}: ${lastError}`);
          // Si quota, high demand, not found, on continue
          if (lastError.includes("Quota") || lastError.includes("high demand") || lastError.includes("overloaded") || lastError.includes("not found") || lastError.includes("no longer available") || lastError.includes("404") || lastError.includes("503")) {
            continue;
          }
          // Autre erreur fatale
          return { statusCode: 502, headers, body: JSON.stringify({ error: lastError }) };
        }
        let text = data?.candidates?.[0]?.content?.parts?.map(p=>p.text||"").join("")||"";
        text = text.replace(/^```json\s*|```$/g,"").trim();
        if (!text) { lastError="Vide"; continue; }
        const fiche = JSON.parse(text);
        CACHE.set(cacheKey, fiche);
        return { statusCode: 200, headers, body: JSON.stringify(fiche) };
      } catch (e) {
        lastError = e.message;
        console.error(`EXCEPTION ${apiVer}/${m}: ${e}`);
        continue;
      }
    }
  }
  return { statusCode: 502, headers, body: JSON.stringify({ error: `Tous les modèles échoués. Dernier: ${lastError}. Essaie dans 2 min ou change de clé.` }) };
};

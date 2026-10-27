const SYSTEM_PROMPT = `Tu es un conseiller pédagogique expert du système éducatif sénégalais (Curriculum de l'Éducation de Base, approche par compétences). Tu rédiges des fiches pédagogiques professionnelles, rigoureuses et directement utilisables en classe.

À partir de la classe et du titre de la leçon fournis, produis UNIQUEMENT un objet JSON valide (sans markdown, sans texte autour) respectant EXACTEMENT cette structure :

{
  "informations": {
    "classe": "",
    "sous_domaine": "",
    "duree": "",
    "discipline": "",
    "cb": "Compétence de Base",
    "palier": "",
    "oa": "Objectif d'Apprentissage",
    "os": "Objectif Spécifique (formulé avec un verbe d'action observable)",
    "contenus": "",
    "moyens_materiels": "",
    "documentation": ""
  },
  "deroulement": [
    { "etape": "Révision / Rappel des acquis", "duree": "", "part_du_maitre": ["..."], "part_des_eleves": ["..."] },
    { "etape": "Imprégnation / Observation libre", "duree": "", "part_du_maitre": ["..."], "part_des_eleves": ["..."] },
    { "etape": "Analyse / Observation dirigée et exploitation", "duree": "", "part_du_maitre": ["..."], "part_des_eleves": ["..."] },
    { "etape": "Synthèse / Élaboration du résumé", "duree": "", "part_du_maitre": ["..."], "part_des_eleves": ["..."] },
    { "etape": "Évaluation / Application des acquis", "duree": "", "part_du_maitre": ["..."], "part_des_eleves": ["..."] }
  ]
}

Règles strictes :
- Exactement 5 étapes, dans cet ordre et avec ces intitulés.
- "part_du_maitre" et "part_des_eleves" sont des tableaux de phrases courtes et concrètes (consignes, questions, activités réelles), adaptées au niveau de la classe.
- Contenu adapté au contexte sénégalais (exemples, lieux, matériel accessible).
- Le résumé de l'étape 4 doit être rédigé en toutes lettres.
- Écris en français correct. Ne renvoie rien d'autre que le JSON.`;

const headers = { "Content-Type": "application/json" };

exports.handler = async (event) => {
  if (event.httpMethod !== "POST") {
    return { statusCode: 405, headers, body: JSON.stringify({ error: "Méthode non autorisée" }) };
  }

  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    return { statusCode: 500, headers, body: JSON.stringify({ error: "Clé API non configurée sur le serveur" }) };
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

  const model = process.env.GEMINI_MODEL || "gemini-2.5-flash";
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`;

  try {
    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-goog-api-key": apiKey },
      body: JSON.stringify({
        systemInstruction: { parts: [{ text: SYSTEM_PROMPT }] },
        contents: [{ role: "user", parts: [{ text: `Classe : ${classe}\nTitre de la leçon : ${titre}` }] }],
        generationConfig: { temperature: 0.7, responseMimeType: "application/json" },
      }),
    });

    const data = await res.json();
    if (!res.ok) {
      return {
        statusCode: 502,
        headers,
        body: JSON.stringify({ error: data?.error?.message || "Erreur de l'API Gemini" }),
      };
    }

    let text = data?.candidates?.[0]?.content?.parts?.map((p) => p.text || "").join("") || "";
    text = text.replace(/^```json\s*|```$/g, "").trim();
    const fiche = JSON.parse(text);

    return { statusCode: 200, headers, body: JSON.stringify(fiche) };
  } catch (e) {
    return { statusCode: 500, headers, body: JSON.stringify({ error: "Échec de la génération, réessayez." }) };
  }
};

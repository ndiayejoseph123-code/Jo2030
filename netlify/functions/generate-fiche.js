const SYSTEM_PROMPTS = {
  eveil: `Tu es un conseiller pédagogique expert du système éducatif sénégalais (Curriculum de l'Éducation de Base CEB, approche par compétences).
Discipline: HISTOIRE, GEOGRAPHIE, IST, VIVRE ENSEMBLE (Éveil).
Démarche OFFICIELLE à respecter OBLIGATOIREMENT (document Le Miroir adapté au CEB):
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
Discipline: FRANCAIS Grammaire / Conjugaison / Orthographe / Vocabulaire / Expression.
Démarche OFFICIELLE Langue:
1. Révision / Rappel des acquis
2. Imprégnation / Présentation du texte support
3. Analyse / Observation dirigée, manipulation et exploitation
4. Synthèse / Élaboration de la règle
5. Évaluation / Application`
};

const BASE_JSON_STRUCTURE = `
À partir de la classe et du titre de la leçon fournis, produis UNIQUEMENT un objet JSON valide (sans markdown, sans texte autour) respectant EXACTEMENT cette structure :

{
  "informations": {
    "classe": "",
    "sous_domaine": "",
    "duree": "45 min ou 60 min selon la discipline",
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
    { "etape": "INTITULE EXACT DE LA DEMARCHE", "duree": "", "part_du_maitre": ["..."], "part_des_eleves": ["..."] },
    { "etape": "INTITULE EXACT DE LA DEMARCHE", "duree": "", "part_du_maitre": ["..."], "part_des_eleves": ["..."] },
    { "etape": "INTITULE EXACT DE LA DEMARCHE", "duree": "", "part_du_maitre": ["..."], "part_des_eleves": ["..."] },
    { "etape": "INTITULE EXACT DE LA DEMARCHE", "duree": "", "part_du_maitre": ["..."], "part_des_eleves": ["..."] },
    { "etape": "INTITULE EXACT DE LA DEMARCHE", "duree": "", "part_du_maitre": ["..."], "part_des_eleves": ["..."] }
  ]
}

Règles strictes :
- Exactement 5 étapes, dans cet ordre et avec les intitulés EXACTS de la démarche officielle indiquée ci-dessus. Ne pas inventer d'autres intitulés.
- "part_du_maitre" et "part_des_eleves" sont des tableaux de phrases courtes et concrètes (consignes, questions, activités réelles), adaptées au niveau de la classe.
- Contenu adapté au contexte sénégalais (exemples, lieux, matériel accessible).
- Le résumé de l'étape 4 doit être rédigé en toutes lettres.
- Écris en français correct. Ne renvoie rien d'autre que le JSON.
`;

function detectDiscipline(titre) {
  const t = titre.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "");
  
  if (/math|calcul|numeration|geometrie|mesure|probleme|addition|soustraction|multiplication|division|fraction/.test(t)) return "mathematiques";
  if (/lecture|texte|comprehension|alphabet/.test(t)) return "lecture";
  if (/grammaire|conjugaison|orthographe|vocabulaire|accord|verbe|phrase|nom|adjectif|pluriel|expression ecrite|dictée|dictee/.test(t)) return "grammaire";
  // Par défaut, tout le reste est de l'éveil (Histoire, Géo, IST, Vivre ensemble, EPS...)
  return "eveil";
}

const headers = { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" };

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

  const disciplineType = detectDiscipline(titre);
  const systemInstructionText = SYSTEM_PROMPTS[disciplineType] + "\n" + BASE_JSON_STRUCTURE;

  const model = process.env.GEMINI_MODEL || "gemini-2.5-flash";
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`;

  try {
    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-goog-api-key": apiKey },
      body: JSON.stringify({
        systemInstruction: { parts: [{ text: systemInstructionText }] },
        contents: [{ role: "user", parts: [{ text: `Classe : ${classe}\nTitre de la leçon : ${titre}\nDiscipline détectée : ${disciplineType}` }] }],
        generationConfig: { temperature: 0.5, responseMimeType: "application/json" },
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

    // Sécurité: on force la discipline détectée dans le JSON si l'IA l'a oubliée
    if (fiche.informations) {
      fiche.informations.discipline = fiche.informations.discipline || titre;
    }

    return { statusCode: 200, headers, body: JSON.stringify(fiche) };
  } catch (e) {
    console.error(e);
    return { statusCode: 500, headers, body: JSON.stringify({ error: "Échec de la génération, réessayez." }) };
  }
};

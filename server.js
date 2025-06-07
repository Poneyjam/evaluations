const express = require('express');
const fs = require('fs');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3000;

// autoriser la visualisation de l'IP des ordinateurs
app.set('trust proxy', true);

// Middleware pour analyser le corps des requêtes JSON
app.use(express.urlencoded({ extended: true }));
app.use(express.json());


// Middleware pour servir des fichiers statiques
app.use(express.static(path.join(__dirname))); // Cela sert tous les fichiers dans le répertoire courant


// Route pour afficher index.html
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

function getRequestInfo(req) {
  const ip = req.ip || req.connection.remoteAddress;
  const now = new Date();
  const formattedDate = now.toLocaleString('fr-FR', {
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit'
  });
  return { formattedDate, ip };
}


/////////////////////////////////////////////////////////////////////////////////////////////////////
// EVALUATIONS --------------------------------------------------------------------------------------
/////////////////////////////////////////////////////////////////////////////////////////////////////

app.use('/evaluations', express.static(path.join(__dirname, 'evaluations')));

// Route pour obtenir la liste des éval et leur état ("en cours" ou "terminée")
app.get('/liste-domaines', (req, res) => {
    const dir = path.join(__dirname, 'evaluations');
    if (!fs.existsSync(dir)) return res.json([]);
  
    const fichiers = fs.readdirSync(dir).filter(file => file.endsWith('.json'));
  
    const domaines = fichiers.map(file => {
      try {
        const data = JSON.parse(fs.readFileSync(path.join(dir, file), 'utf-8'));
        const eleves = data.eleves || [];
        const prof = eleves.length > 0 && eleves[0].prof ? eleves[0].prof : '—';
  
        return {
          domaine: path.basename(file, '.json'),
          etat: data.etat || 'inconnu',
          annee: data.annee || '—',
          periode: data.periode || '—',
          prof,
          eleves
        };
      } catch (err) {
        console.error(`❌ Erreur dans le fichier ${file} :`, err.message);
        return null; // on ignore les fichiers corrompus
      }
    }).filter(Boolean); // on enlève les null
  
    res.json(domaines);
  });
  
  

// Route pour changer l'état de l'évaluation ("en cours" ou "terminée")
app.post('/update-etat/:domaine', (req, res) => {
    const { domaine } = req.params;
    const { etat } = req.body;
    const filePath = path.join(__dirname, 'evaluations', `${domaine}.json`);
    const { formattedDate, ip } = getRequestInfo(req);
  
    if (!fs.existsSync(filePath)) {
      return res.status(404).json({ error: "Évaluation non trouvée." });
    }
  
    try {
      const data = JSON.parse(fs.readFileSync(filePath, 'utf-8'));
      data.etat = etat || "en cours";
      fs.writeFileSync(filePath, JSON.stringify(data, null, 2));
  
      console.log(`EVAL -> La fiche "${domaine}" est "${etat}" en date du ${formattedDate} par ${ip}`);
  
      res.json({ message: `État mis à jour à "${etat}".` });
  
    } catch (err) {
      console.error(err);
      res.status(500).json({ error: "Erreur lors de la mise à jour." });
    }
  });
  
  
  app.delete('/supprimer-evaluation/:nom', (req, res) => {
    const { formattedDate, ip } = getRequestInfo(req);

    const nom = req.params.nom;
    const fichier = path.join(__dirname, 'evaluations', `${nom}.json`);
  
    if (!fs.existsSync(fichier)) {
      return res.status(404).json({ message: "Fichier introuvable." });
    }
  
    try {
      fs.unlinkSync(fichier);
      res.json({ message: "Évaluation supprimée." });
      console.log(`EVAL -> fiche "${nom}" supprimée le ${formattedDate} par ${ip}`);
    } catch (err) {
      console.error(err);
      res.status(500).json({ message: "Erreur lors de la suppression." });
    }
  });
  
  
// Route pour créer une page d'évaluation par domaine
app.post('/setup-evaluation', (req, res) => {
    const { formattedDate, ip } = getRequestInfo(req);

    const { annee, periode, domaine, prof, eleves, competences } = req.body;
    const etat = "en cours";
    
    // Nettoyer le domaine en enlevant les mentions de périodes existantes
    const domaineNettoye = domaine.replace(/\s*-\s*P[1-5]\s*/gi, '').trim();
    
    // Vérifier si l'année est déjà incluse dans le domaine
    let domaineNomComplet = `${annee} - ${domaineNettoye} - ${periode}`;
    
    // Si le domaine commence déjà par l'année, on évite de la concaténer à nouveau
    if (domaineNomComplet.startsWith(annee)) {
        domaineNomComplet = `${domaineNettoye} - ${periode}`;
    }

    // Chemin du fichier à créer
    const filePath = path.join(__dirname, 'evaluations', `${domaineNomComplet}.json`);

    const evaluationData = {
        annee,
        periode,
        domaine: domaineNomComplet,
        prof,
        eleves,
        competences,
        etat,
        scores: eleves.reduce((acc, eleveObj) => {
            acc[eleveObj.nom] = competences.reduce((compAcc, comp) => {
              compAcc[comp] = null;
              return compAcc;
            }, {});
            return acc;
          }, {})          
    };

    // Créer le dossier si nécessaire
    const dirPath = path.join(__dirname, 'evaluations');
    if (!fs.existsSync(dirPath)) {
        fs.mkdirSync(dirPath);
    }

    // Sauvegarder l'évaluation dans un fichier JSON
    fs.writeFileSync(filePath, JSON.stringify(evaluationData, null, 2));
    res.status(200).json({ message: 'Évaluation enregistrée avec succès.' });
    console.log(`EVAL -> fiche d'évaluation "${domaineNomComplet}" créée le ${formattedDate} par ${ip}`);
});


  
// Route pour afficher l'évaluation :
app.get('/evaluation/:domaine', (req, res) => {
    const { domaine } = req.params;
    const filePath = path.join(__dirname, 'evaluations', `${domaine}.json`);

    if (!fs.existsSync(filePath)) {
        return res.status(404).json({ error: `Évaluation pour le domaine ${domaine} non trouvée.` });
    }

    const data = JSON.parse(fs.readFileSync(filePath, 'utf8'));
    res.json(data);
});

// Route pour mettre à jour un score
app.post('/update-score/:domaine/:eleve/:competence', (req, res) => {
    const { domaine, eleve, competence } = req.params;
    const { valeur } = req.body;
    const filePath = path.join(__dirname, 'evaluations', `${domaine}.json`);
  
    if (!fs.existsSync(filePath)) return res.status(404).json({ error: 'Fichier non trouvé.' });
  
    const data = JSON.parse(fs.readFileSync(filePath, 'utf8'));
    if (!data.scores[eleve]) return res.status(404).json({ error: 'Élève inconnu.' });
  
    data.scores[eleve][competence] = valeur;
  
    // Recalcul des compétences validées
    const valides = Object.entries(data.scores[eleve])
      .filter(([cle, val]) => cle !== "commentaire" && val === "oui")
      .map(([cle]) => cle);
  
    const commentaireActuel = data.scores[eleve]["commentaire"]?.split("**")[0].trim() || "";
    data.scores[eleve]["commentaire"] = `${commentaireActuel} ** ${valides.join(", ")}**`;
  
    fs.writeFileSync(filePath, JSON.stringify(data, null, 2));
    res.json({ message: "Score mis à jour." });
  });

// Route mise à jour du commentaire
app.post('/update-commentaire/:domaine/:eleve', (req, res) => {
    const { domaine, eleve } = req.params;
    const { commentaire } = req.body;
    const filePath = path.join(__dirname, 'evaluations', `${domaine}.json`);
  
    if (!fs.existsSync(filePath)) return res.status(404).json({ error: 'Fichier non trouvé.' });
  
    const data = JSON.parse(fs.readFileSync(filePath, 'utf8'));
    if (!data.scores[eleve]) return res.status(404).json({ error: 'Élève inconnu.' });
  
    const valides = Object.entries(data.scores[eleve])
      .filter(([cle, val]) => cle !== "commentaire" && val === "oui")
      .map(([cle]) => cle);
  
    data.scores[eleve]["commentaire"] = `${commentaire.trim()} ** ${valides.join(", ")}**`;
  
    fs.writeFileSync(filePath, JSON.stringify(data, null, 2));
    res.json({ message: "Commentaire mis à jour.", commentaire: data.scores[eleve]["commentaire"] });
  });
  
// Route pour servir competences.json
app.get('/competences', (req, res) => {
    const filePath = path.join(__dirname, 'competences.json'); 
  
    fs.readFile(filePath, 'utf8', (err, data) => {
      if (err) {
        console.error("Erreur lors de la lecture du fichier competences.json :", err);
        return res.status(500).json({ error: 'Erreur serveur' });
      }
  
      try {
        const json = JSON.parse(data);
        res.json(json);
      } catch (parseError) {
        console.error("Erreur de parsing JSON :", parseError);
        res.status(500).json({ error: 'Format JSON invalide' });
      }
    });
  });

// Route pour charger les élèves qui ont des compétences dans la liste déroulante
app.get('/liste-eleves', (req, res) => {
    const dir = path.join(__dirname, 'evaluations');
    const fichiers = fs.existsSync(dir)
      ? fs.readdirSync(dir).filter(f => f.endsWith('.json'))
      : [];
  
    const profs = {};
  
    fichiers.forEach(fichier => {
      const data = JSON.parse(fs.readFileSync(path.join(dir, fichier), 'utf-8'));
      const eleves = data.eleves || [];
  
      eleves.forEach(({ nom, prof }) => {
        if (!prof || !nom) return;
  
        if (!profs[prof]) {
          profs[prof] = new Set();
        }
        profs[prof].add(nom);
      });
    });
  
    // Convertir les sets en tableaux
    const result = {};
    for (const [prof, elevesSet] of Object.entries(profs)) {
      result[prof] = Array.from(elevesSet).sort();
    }
  
    res.json(result);
  });
  
// Route pour obtenir les compétences d'un élève avec l'année et la période
app.get('/competences-eleve/:nom', (req, res) => {
    const { nom } = req.params;  // nom de l'élève
    const { annee, periode } = req.query;  // paramètres pour l'année et la période
    const dir = path.join(__dirname, 'evaluations');
  
    if (!fs.existsSync(dir)) {
      return res.status(404).json({ competences: [] });
    }
  
    const fichiers = fs.readdirSync(dir).filter(f => f.endsWith('.json'));
    const competencesOui = new Set();
  
    fichiers.forEach(fichier => {
      const chemin = path.join(dir, fichier);
      const data = JSON.parse(fs.readFileSync(chemin, 'utf-8'));
  
      const scores = data.scores || {};
      const competences = data.competences || [];
  
      // On vérifie si l'élève correspond et si l'année et la période matchent
      if (data.annee === annee && data.periode === periode) {
        Object.keys(scores).forEach(nomEleve => {
          if (nomEleve.toLowerCase() === nom.toLowerCase()) {
            competences.forEach(comp => {
              if (comp !== 'commentaire' && scores[nomEleve][comp] === "oui") {
                competencesOui.add(comp);
              }
            });
          }
        });
      }
    });
  
    res.json({ competences: Array.from(competencesOui) });
  });

  // Route pour récupérer tous les commentaires d'un élève sur une année et une période
app.get('/commentaires-eleve', (req, res) => {
    const { eleve, annee, periode } = req.query;
    const dir = path.join(__dirname, 'evaluations');

    if (!fs.existsSync(dir)) return res.status(404).send("Aucun dossier d'évaluations.");

    const fichiers = fs.readdirSync(dir).filter(f => f.endsWith('.json'));
    let commentaires = [];

    fichiers.forEach(fichier => {
        const data = JSON.parse(fs.readFileSync(path.join(dir, fichier), 'utf-8'));

        if (data.annee === annee && data.periode === periode && data.scores && data.scores[eleve]) {
            const commentaire = data.scores[eleve].commentaire?.trim();
            if (commentaire) {
                commentaires.push(`${data.domaine}\n${commentaire}`);
            }
        }
    });

    if (commentaires.length === 0) {
        return res.status(404).send("Aucun commentaire trouvé.");
    }

    res.send(commentaires.join("\n\n"));
});

// Vérifie si un élève a déjà validé une compétence dans une période antérieure
app.get('/deja-valide/:eleve/:competence', (req, res) => {
    const { eleve, competence } = req.params;
    const periodeActuelle = req.query.periode;
    const dir = path.join(__dirname, 'evaluations');

    const fichiers = fs.existsSync(dir)
        ? fs.readdirSync(dir).filter(f => f.endsWith('.json'))
        : [];

    const periodesOrdre = ["P1", "P2", "P3", "P4", "P5"];
    const indexActuel = periodesOrdre.indexOf(periodeActuelle);

    for (const fichier of fichiers) {
        const data = JSON.parse(fs.readFileSync(path.join(dir, fichier), 'utf-8'));

        if (
            data.periode &&
            periodesOrdre.indexOf(data.periode) < indexActuel &&
            data.scores &&
            data.scores[eleve] &&
            data.scores[eleve][competence] === "oui"
        ) {
            return res.json({ deja: true });
        }
    }

    res.json({ deja: false });
});

// Route pour ajouter un élève en cours d'année
app.post('/ajouter-eleve/:domaine', (req, res) => {
    const { domaine } = req.params;
    const { nom, prof } = req.body;
  
    const filePath = path.join(__dirname, 'evaluations', `${domaine}.json`);
    if (!fs.existsSync(filePath)) {
      return res.status(404).json({ message: "Fiche introuvable." });
    }
  
    const data = JSON.parse(fs.readFileSync(filePath, 'utf-8'));
  
    // Vérifie que l'élève n'existe pas déjà
    if (data.eleves.some(e => e.nom === nom)) {
      return res.status(400).json({ message: "L'élève existe déjà." });
    }
  
    // Ajouter l'élève
    data.eleves.push({ nom, prof });
  
    // Initialiser ses scores
    data.scores[nom] = {};
    for (const comp of data.competences) {
      data.scores[nom][comp] = null;
    }
  
    fs.writeFileSync(filePath, JSON.stringify(data, null, 2));
    res.status(200).json({ message: `Élève ${nom} ajouté.` });
  });
  
// Route pour supprimer un élève d'une fiche en cours d'année
app.post('/supprimer-eleve/:domaine', (req, res) => {
  const { domaine } = req.params;
  const { nom } = req.body;
  const filePath = path.join(__dirname, 'evaluations', `${domaine}.json`);

  if (!fs.existsSync(filePath)) {
    return res.status(404).json({ message: "Fiche introuvable." });
  }

  const data = JSON.parse(fs.readFileSync(filePath, 'utf-8'));

  const index = data.eleves.findIndex(e => e.nom === nom);
  if (index === -1) {
    return res.status(400).json({ message: "Élève non trouvé." });
  }

  data.eleves.splice(index, 1);
  delete data.scores[nom];

  fs.writeFileSync(filePath, JSON.stringify(data, null, 2));
  res.status(200).json({ message: `${nom} supprimé avec succès.` });
});

// Route pour ajouter une compétence supplémentaire dans la fiche d'évaluation déjà créée
app.post('/ajouter-competence/:domaine', (req, res) => {
    const { domaine } = req.params;
    const { competence } = req.body;
  
    const filePath = path.join(__dirname, 'evaluations', `${domaine}.json`);
  
    if (!fs.existsSync(filePath)) {
      return res.status(404).json({ message: "Fiche introuvable." });
    }
  
    const data = JSON.parse(fs.readFileSync(filePath, 'utf-8'));
  
    if (data.competences.includes(competence)) {
      return res.status(400).json({ message: "La compétence existe déjà." });
    }
  
    // Ajouter la compétence
    data.competences.push(competence);
  
    // Trier toutes les compétences sauf "commentaire" à la fin
    data.competences = data.competences
      .filter(c => c !== "commentaire")
      .sort((a, b) => a.localeCompare(b, 'fr', { numeric: true }))
      .concat(data.competences.includes("commentaire") ? ["commentaire"] : []);
  
    // Initialiser les scores pour tous les élèves
    for (const eleve of data.eleves) {
      if (!data.scores[eleve.nom]) {
        data.scores[eleve.nom] = {};
      }
      data.scores[eleve.nom][competence] = null;
    }
  
    fs.writeFileSync(filePath, JSON.stringify(data, null, 2));
    res.status(200).json({ message: `Compétence "${competence}" ajoutée avec succès.` });
  });
  

// Route pour supprimer une compétence d'une fiche d'évaluation déjà existante
app.post('/supprimer-competence/:domaine', (req, res) => {
    const { domaine } = req.params;
    const { competence } = req.body;  // La compétence à supprimer

    const filePath = path.join(__dirname, 'evaluations', `${domaine}.json`);
    if (!fs.existsSync(filePath)) {
        return res.status(404).json({ message: "Fiche introuvable." });
    }

    const data = JSON.parse(fs.readFileSync(filePath, 'utf-8'));

    // Vérifier si la compétence existe dans la liste
    const competenceIndex = data.competences.indexOf(competence);
    if (competenceIndex === -1) {
        return res.status(400).json({ message: "La compétence n'existe pas." });
    }

    // Supprimer la compétence de la liste
    data.competences.splice(competenceIndex, 1);

    // Supprimer la compétence des scores de tous les élèves
    for (const eleve of data.eleves) {
        if (data.scores[eleve.nom]) {
            delete data.scores[eleve.nom][competence];
        }
    }

    // Sauvegarder les modifications
    fs.writeFileSync(filePath, JSON.stringify(data, null, 2));

    res.status(200).json({ message: `Compétence "${competence}" supprimée avec succès.` });
});




/////////////////////////////////////////////////////////////////////////////////////////////////////
app.listen(PORT, () => {
    console.log(`Server is running on http://localhost:${PORT}`);
});


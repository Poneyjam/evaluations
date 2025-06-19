require('dotenv').config();
const express = require('express');
const fs = require('fs');
const session = require('express-session');
const bcrypt = require('bcrypt');
const { Pool } = require('pg');
const rateLimit = require('express-rate-limit');
const path = require('path');

const app = express();
app.set('trust proxy', 1);
const PORT = process.env.PORT || 3000;

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false },
});

app.use(express.urlencoded({ extended: true }));
app.use(express.json());

// Sessions
app.use(session({
  secret: process.env.SESSION_SECRET,
  resave: false,
  saveUninitialized: false,
}));

// Rate limiter pour login
const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 5,
  message: 'Trop de tentatives, veuillez réessayer plus tard.'
});

// Routes statiques publiques (login)
app.use(express.static(path.join(__dirname, 'public')));

app.get('/', (req, res) => {
  res.redirect('/login');
});

app.get('/login', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'login.html'));
});

app.post('/login', loginLimiter, async (req, res) => {
  const { password } = req.body;
  const hash = process.env.PASSWORD_HASH;

  try {
    const match = await bcrypt.compare(password, hash);
    if (match) {
      req.session.isAdmin = true;
      res.redirect('/admin');
    } else {
      res.status(401).send('<h1>Mot de passe incorrect</h1><a href="/login">Retour</a>');
    }
  } catch (err) {
    console.error(err);
    res.status(500).send('Erreur serveur');
  }
});

function requireAuth(req, res, next) {
  if (req.session.isAdmin) {
    next();
  } else {
    res.status(401).redirect('/login');
  }
}

// Routes protégées (admin)
app.get('/admin', requireAuth, (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'evaluations.html'));
});

// Pages protégées
app.get('/eval.html', requireAuth, (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'eval.html'));
});

app.get('/eleve.html', requireAuth, (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'eleve.html'));
});

app.get('/eval-setup.html', requireAuth, (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'eval-setup.html'));
});

app.get('/logout', (req, res) => {
  req.session.destroy(() => {
    res.redirect('/login');
  });
});

app.get('/api/check-session', (req, res) => {
  if (req.session.isAdmin) res.sendStatus(200);
  else res.sendStatus(401);
});

// --- API pour gérer évaluations, élèves, scores, commentaires ---

app.post('/api/competences-descriptions', (req, res) => {
  console.log('Requête reçue avec body:', req.body);

  const { competences } = req.body;
  console.log(competences);
  
  if (!Array.isArray(competences) || competences.length === 0) {
    return res.status(400).json({ error: 'competences doit être un tableau non vide' });
  }

  pool.query(
    'SELECT code, description FROM competences_globales WHERE code = ANY($1)',
    [competences]
  )
  .then(result => {
    const descriptions = {};
    for (const row of result.rows) {
      descriptions[row.code] = row.description;
    }
    res.json(descriptions);
  })
  .catch(err => {
    console.error('Erreur serveur:', err);
    res.status(500).json({ error: 'Erreur serveur' });
  });
});


// Liste des évaluations
app.get('/liste-domaines', requireAuth, async (req, res) => {
  try {
    const result = await pool.query(`
      SELECT id, domaine, annee, periode, prof, etat
      FROM evaluations
      ORDER BY id DESC
    `);
    res.json(result.rows);
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Erreur serveur lors de la récupération des évaluations' });
  }
});

// Détail d'une évaluation
app.get('/evaluation/:id', requireAuth, async (req, res) => {
  const evalId = req.params.id;
  try {
    const evalResult = await pool.query('SELECT * FROM evaluations WHERE id = $1', [evalId]);
    if (evalResult.rows.length === 0) return res.status(404).json({ error: 'Évaluation introuvable' });
    const evaluation = evalResult.rows[0];

    const elevesResult = await pool.query('SELECT * FROM eleves WHERE evaluation_id = $1 ORDER BY nom', [evalId]);
    const eleves = elevesResult.rows;

    const compResult = await pool.query('SELECT * FROM competences WHERE evaluation_id = $1 ORDER BY id', [evalId]);
    const competences = compResult.rows;

    const scoresResult = await pool.query('SELECT * FROM scores WHERE evaluation_id = $1', [evalId]);
    const scores = scoresResult.rows;

    const commentsResult = await pool.query('SELECT * FROM commentaires WHERE evaluation_id = $1', [evalId]);
    const commentaires = commentsResult.rows;

    res.json({ evaluation, eleves, competences, scores, commentaires });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

// Créer une nouvelle évaluation
app.post('/setup-evaluation', requireAuth, async (req, res) => {
  const { domaine, annee, periode, eleves, competences } = req.body;

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    // Ici on peut stocker les compétences sous forme JSON ou créer des entrées séparées suivant ta structure DB
    const evalInsert = await client.query(
      `INSERT INTO evaluations (domaine, annee, periode, etat, competences)
       VALUES ($1, $2, $3, 'en cours', $4) RETURNING id`,
      [domaine, annee, periode, JSON.stringify(competences)]
    );
    const evalId = evalInsert.rows[0].id;

    // Insertion des élèves
    for (const { nom, prof } of eleves) {
      await client.query(
        `INSERT INTO eleves (nom, prof, evaluation_id) VALUES ($1, $2, $3)`,
        [nom, prof, evalId]
      );
    }

    await client.query('COMMIT');
    res.json({ message: 'Évaluation créée avec succès', evaluation_id: evalId });
  } catch (error) {
    await client.query('ROLLBACK');
    console.error(error);
    res.status(500).json({ error: 'Erreur lors de la création de l\'évaluation' });
  } finally {
    client.release();
  }
});

// Mise à jour état d'une évaluation
app.post('/update-etat/:id', requireAuth, async (req, res) => {
  const { id } = req.params;
  const { etat } = req.body;

  try {
    await pool.query('UPDATE evaluations SET etat = $1 WHERE id = $2', [etat, id]);
    res.json({ message: `État mis à jour à ${etat}` });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Erreur lors de la mise à jour de l\'état' });
  }
});

// Suppression d'une évaluation
app.delete('/supprimer-evaluation/:id', requireAuth, async (req, res) => {
  const { id } = req.params;

  try {
    await pool.query('DELETE FROM evaluations WHERE id = $1', [id]);
    res.json({ message: 'Évaluation supprimée' });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Erreur lors de la suppression' });
  }
});

// Mise à jour des scores
app.post('/update-score', requireAuth, async (req, res) => {
  const { evaluation_id, eleve_id, competence_id, valeur } = req.body;

  try {
    const existing = await pool.query(
      `SELECT id FROM scores WHERE evaluation_id=$1 AND eleve_id=$2 AND competence_id=$3`,
      [evaluation_id, eleve_id, competence_id]
    );

    if (existing.rows.length > 0) {
      await pool.query(
        `UPDATE scores SET valeur=$1 WHERE id=$2`,
        [valeur, existing.rows[0].id]
      );
    } else {
      await pool.query(
        `INSERT INTO scores (evaluation_id, eleve_id, competence_id, valeur) VALUES ($1,$2,$3,$4)`,
        [evaluation_id, eleve_id, competence_id, valeur]
      );
    }

    res.json({ message: 'Score mis à jour' });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Erreur lors de la mise à jour du score' });
  }
});

app.post('/update-score-id/:domaine/:eleveId/:competence', async (req, res) => {
  const { domaine, eleveId, competence } = req.params;
  const { note } = req.body;

  try {
    const evalResult = await db.query(
      'SELECT id FROM evaluations WHERE domaine = $1',
      [domaine]
    );

    const evaluationId = evalResult.rows[0]?.id;
    if (!evaluationId) return res.status(404).json({ error: "Évaluation non trouvée." });

    const existing = await db.query(
      'SELECT id FROM scores WHERE evaluation_id = $1 AND eleve_id = $2 AND competence = $3',
      [evaluationId, eleveId, competence]
    );

    if (existing.rows.length > 0) {
      // Mise à jour
      await db.query(
        'UPDATE scores SET note = $1 WHERE evaluation_id = $2 AND eleve_id = $3 AND competence = $4',
        [note, evaluationId, eleveId, competence]
      );
    } else {
      // Insertion
      await db.query(
        'INSERT INTO scores (evaluation_id, eleve_id, competence, note) VALUES ($1, $2, $3, $4)',
        [evaluationId, eleveId, competence, note]
      );
    }

    res.json({ message: '✅ Score mis à jour' });
  } catch (err) {
    console.error('Erreur update-score-id :', err);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

// Mise à jour commentaire
app.post('/update-commentaire', requireAuth, async (req, res) => {
  const { evaluation_id, eleve_id, commentaire } = req.body;

  try {
    const existing = await pool.query(
      `SELECT id FROM commentaires WHERE evaluation_id=$1 AND eleve_id=$2`,
      [evaluation_id, eleve_id]
    );

    if (existing.rows.length > 0) {
      await pool.query(
        `UPDATE commentaires SET commentaire=$1 WHERE id=$2`,
        [commentaire, existing.rows[0].id]
      );
    } else {
      await pool.query(
        `INSERT INTO commentaires (evaluation_id, eleve_id, commentaire) VALUES ($1,$2,$3)`,
        [evaluation_id, eleve_id, commentaire]
      );
    }

    res.json({ message: 'Commentaire mis à jour' });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Erreur lors de la mise à jour du commentaire' });
  }
});

app.post('/update-commentaire-id/:domaine/:eleveId', async (req, res) => {
  const { domaine, eleveId } = req.params;
  const { commentaire } = req.body;

  try {
    const evalResult = await db.query(
      'SELECT id FROM evaluations WHERE domaine = $1',
      [domaine]
    );

    const evaluationId = evalResult.rows[0]?.id;
    if (!evaluationId) return res.status(404).json({ error: "Évaluation non trouvée." });

    const existing = await db.query(
      'SELECT id FROM scores WHERE evaluation_id = $1 AND eleve_id = $2 AND competence = $3',
      [evaluationId, eleveId, 'commentaire']
    );

    if (existing.rows.length > 0) {
      await db.query(
        'UPDATE scores SET note = $1 WHERE evaluation_id = $2 AND eleve_id = $3 AND competence = $4',
        [commentaire, evaluationId, eleveId, 'commentaire']
      );
    } else {
      await db.query(
        'INSERT INTO scores (evaluation_id, eleve_id, competence, note) VALUES ($1, $2, $3, $4)',
        [evaluationId, eleveId, 'commentaire', commentaire]
      );
    }

    res.json({ commentaire });
  } catch (err) {
    console.error('Erreur update-commentaire-id :', err);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

// Liste des élèves par prof
app.get('/liste-eleves', requireAuth, async (req, res) => {
  try {
    const result = await pool.query(`
      SELECT prof, json_agg(nom) AS eleves
      FROM eleves
      GROUP BY prof
    `);
    res.json(result.rows);
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

// Route pour servir competences.json pour eval-setup
app.get('/competences-setup', (req, res) => {
    const filePath = path.join(__dirname, 'public', 'competences','competences.json'); 
  
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

  app.get('/competences', async (req, res) => {
  try {
    const result = await pool.query(`SELECT code, description FROM competences_globales`);
    const competences = {};
    result.rows.forEach(row => {
      competences[row.code] = row.description;
    });
    res.json({ competences });
  } catch (err) {
    console.error("Erreur récupération compétences globales :", err);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});


app.listen(PORT, () => {
  console.log(`🚀 Serveur démarré sur http://localhost:${PORT}`);
});

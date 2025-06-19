// server.js
require('dotenv').config();
const express = require('express');
const session = require('express-session');
const bcrypt = require('bcrypt');
const rateLimit = require('express-rate-limit');
const path = require('path');
const db = require('./db');

const app = express();
const PORT = process.env.PORT || 3000;
const PASSWORD_HASH = process.env.PASSWORD_HASH;
const SESSION_SECRET = process.env.SESSION_SECRET;

app.set('trust proxy', 1);
app.use(express.urlencoded({ extended: true }));
app.use(express.json());
app.use(session({
  secret: SESSION_SECRET,
  resave: false,
  saveUninitialized: false,
}));
app.use(express.static(path.join(__dirname, 'public')));

// Auth
app.get('/', (req, res) => res.redirect('/login'));
app.get('/login', (req, res) => res.sendFile(path.join(__dirname, 'public', 'login.html')));

const loginLimiter = rateLimit({ windowMs: 15*60*1000, max: 5, message: 'Trop de tentatives, veuillez réessayer plus tard.' });
app.post('/login', loginLimiter, async (req, res) => {
  const match = await bcrypt.compare(req.body.password, PASSWORD_HASH);
  if (match) { req.session.isAdmin = true; res.redirect('/admin'); }
  else { res.send('<h1>Mot de passe incorrect</h1><a href="/login">Retour</a>'); }
});

app.get('/admin', (req, res) => req.session.isAdmin ? res.sendFile(path.join(__dirname, 'public', 'evaluations.html')) : res.redirect('/login'));
app.get('/logout', (req, res) => req.session.destroy(() => res.redirect('/login')));
app.get('/api/check-session', (req, res) => req.session.isAdmin ? res.sendStatus(200) : res.sendStatus(401));

// Utilities
async function getEvalId(domaine) {
  const r = await db.query('SELECT id FROM evaluations WHERE domaine = $1', [domaine]);
  return r.rows[0]?.id;
}
async function getEleveId(nom, prof = null) {
  const r = await db.query('SELECT id FROM eleves WHERE nom = $1', [nom]);
  if (r.rows.length) return r.rows[0].id;
  const ins = await db.query('INSERT INTO eleves (nom, prof) VALUES ($1, $2) RETURNING id', [nom, prof]);
  return ins.rows[0].id;
}

// Routes SQL
app.post('/setup-evaluation', async (req, res) => {
  const { annee, periode, domaine, prof, eleves, competences } = req.body;
  try {
    const r = await db.query(
      `INSERT INTO evaluations (domaine, annee, periode, prof) VALUES ($1,$2,$3,$4) RETURNING id`,
      [domaine, annee, periode, prof]
    );
    const evalId = r.rows[0].id;
    for (const comp of competences)
      await db.query(`INSERT INTO competences (evaluation_id, nom) VALUES ($1,$2)`, [evalId, comp]);
    for (const e of eleves) {
      const eleveId = await getEleveId(e.nom, e.prof);
      await db.query(`INSERT INTO evaluation_eleves (evaluation_id, eleve_id) VALUES ($1,$2)`, [evalId, eleveId]);
    }
    res.json({ message: "Évaluation créée" });
  } catch (err) { console.error(err); res.status(500).json({ error: "Erreur création" }); }
});

app.get('/liste-domaines', async (_, res) => {
  try {
    const r = await db.query('SELECT * FROM evaluations ORDER BY id DESC');
    res.json(r.rows);
  } catch (err) { console.error(err); res.status(500).json({ error: "Erreur lecture" }); }
});

app.get('/evaluation/:domaine', async (req, res) => {
  try {
    const evalId = await getEvalId(req.params.domaine);
    if (!evalId) return res.status(404).json({ error: 'Non trouvée' });

    const ev = (await db.query('SELECT domaine, annee, periode, prof, etat FROM evaluations WHERE id = $1', [evalId])).rows[0];
    const eleves = (await db.query(`
      SELECT e.nom, e.prof FROM eleves e
      JOIN evaluation_eleves ee ON e.id = ee.eleve_id
      WHERE ee.evaluation_id = $1
    `,[evalId])).rows;
    const comps = (await db.query('SELECT id, nom FROM competences WHERE evaluation_id = $1',[evalId])).rows;

    const scores = {};
    for (const el of eleves) {
      scores[el.nom] = {};
      for (const c of comps) {
        const r = await db.query(`
          SELECT valeur FROM scores
          WHERE evaluation_id=$1 AND eleve_id=(SELECT id FROM eleves WHERE nom=$2) AND competence_id=$3
        `, [evalId, el.nom, c.id]);
        scores[el.nom][c.nom] = r.rows[0]?.valeur || null;
      }
      const rc = await db.query(`
        SELECT texte FROM commentaires
        WHERE evaluation_id=$1 AND eleve_id=(SELECT id FROM eleves WHERE nom=$2)
      `, [evalId, el.nom]);
      scores[el.nom]['commentaire'] = rc.rows[0]?.texte || '';
    }
    res.json({ ...ev, eleves, competences: comps.map(c=>c.nom), scores });
  } catch (err) { console.error(err); res.status(500).json({ error: "Erreur" }); }
});

app.post('/update-score/:domaine/:eleve/:competence', async (req, res) => {
  try {
    const evalId = await getEvalId(req.params.domaine);
    const eleveId = await getEleveId(req.params.eleve);
    const comp = await db.query(`
      SELECT id FROM competences WHERE evaluation_id=$1 AND nom=$2
    `, [evalId, req.params.competence]);
    if (!comp.rows[0]) return res.status(404).json({ error: 'Compétence introuvable' });
    const compId = comp.rows[0].id;

    await db.query(`
      INSERT INTO scores (evaluation_id, eleve_id, competence_id, valeur)
      VALUES ($1,$2,$3,$4)
      ON CONFLICT (evaluation_id, eleve_id, competence_id)
      DO UPDATE SET valeur = EXCLUDED.valeur
    `, [evalId, eleveId, compId, req.body.valeur]);

    res.json({ message: "Score mis à jour" });
  } catch (err) { console.error(err); res.status(500).json({ error: "Erreur score" }); }
});

app.post('/update-commentaire/:domaine/:eleve', async (req, res) => {
  try {
    const evalId = await getEvalId(req.params.domaine);
    const eleveId = await getEleveId(req.params.eleve);
    await db.query(`
      INSERT INTO commentaires (evaluation_id, eleve_id, texte)
      VALUES ($1,$2,$3)
      ON CONFLICT (evaluation_id, eleve_id)
      DO UPDATE SET texte = EXCLUDED.texte
    `, [evalId, eleveId, req.body.commentaire]);
    res.json({ message: "Commentaire à jour" });
  } catch (err) { console.error(err); res.status(500).json({ error: "Erreur commentaire" }); }
});

app.post('/ajouter-eleve/:domaine', async (req, res) => {
  try {
    const evalId = await getEvalId(req.params.domaine);
    const eleveId = await getEleveId(req.body.nom, req.body.prof);
    await db.query('INSERT INTO evaluation_eleves (evaluation_id, eleve_id) VALUES ($1,$2)', [evalId, eleveId]);
    res.json({ message: `Élève ${req.body.nom} ajouté.` });
  } catch (err) { console.error(err); res.status(500).json({ error: "Erreur ajout" }); }
});

app.post('/supprimer-evaluation/:nom', async (req, res) => {
  try {
    await db.query('DELETE FROM evaluations WHERE domaine=$1', [req.params.nom]);
    res.json({ message: "Évaluation supprimée." });
  } catch (err) { console.error(err); res.status(500).json({ error: "Erreur suppression" }); }
});

app.post('/ajouter-competence/:domaine', async (req, res) => {
  try {
    const evalId = await getEvalId(req.params.domaine);
    await db.query('INSERT INTO competences (evaluation_id, nom) VALUES ($1,$2)', [evalId, req.body.competence]);
    res.json({ message: `Compétence "${req.body.competence}" ajoutée.` });
  } catch (err) { console.error(err); res.status(500).json({ error: "Erreur compétence" }); }
});

app.post('/supprimer-competence/:domaine', async (req, res) => {
  try {
    const evalId = await getEvalId(req.params.domaine);
    const comp = await db.query('SELECT id FROM competences WHERE evaluation_id=$1 AND nom=$2', [evalId, req.body.competence]);
    if (!comp.rows.length) return res.status(400).json({ message: "Compétence inexistante." });
    const compId = comp.rows[0].id;
    await db.query('DELETE FROM scores WHERE evaluation_id=$1 AND competence_id=$2', [evalId, compId]);
    await db.query('DELETE FROM competences WHERE id=$1', [compId]);
    res.json({ message: `Compétence supprimée.` });
  } catch (err) { console.error(err); res.status(500).json({ error: "Erreur suppression comp" }); }
});

// Bonus : listes élèves/compétences/commentaires déjà validées
app.get('/liste-eleves', async (_, res) => {
  try {
    const r = await db.query(`
      SELECT e.nom, e.prof, ev.domaine FROM eleves e
      JOIN evaluation_eleves ee ON e.id = ee.eleve_id
      JOIN evaluations ev ON ee.evaluation_id = ev.id
    `);
    const map = {};
    r.rows.forEach(r=> {
      map[r.prof] = map[r.prof]||new Set();
      map[r.prof].add(r.nom);
    });
    const result = {};
    for (const [prof, s] of Object.entries(map))
      result[prof] = Array.from(s).sort();
    res.json(result);
  } catch (err) { console.error(err); res.status(500).json({ error: "Erreur liste élèves" }); }
});

app.get('/competences-eleve/:nom', async (req, res) => {
  try {
    const { annee, periode } = req.query;
    const r = await db.query(`
      SELECT c.nom FROM scores s
      JOIN evaluations ev ON s.evaluation_id=ev.id
      JOIN competences c ON s.competence_id=c.id
      JOIN eleves e ON s.eleve_id=e.id
      WHERE LOWER(e.nom)=LOWER($1) AND ev.annee=$2 AND ev.periode=$3 AND s.valeur='oui'
    `, [req.params.nom, annee, periode]);
    res.json({ competences: r.rows.map(r=>r.nom) });
  } catch (err) { console.error(err); res.status(500).json({ error: "Erreur compétences élève" }); }
});

app.get('/commentaires-eleve', async (req, res) => {
  try {
    const { eleve, annee, periode } = req.query;
    const r = await db.query(`
      SELECT ev.domaine, co.texte FROM commentaires co
      JOIN evaluations ev ON co.evaluation_id=ev.id
      JOIN eleves e ON co.eleve_id=e.id
      WHERE LOWER(e.nom)=LOWER($1) AND ev.annee=$2 AND ev.periode=$3
    `, [eleve, annee, periode]);
    if (!r.rows.length) return res.status(404).send("Aucun commentaire trouvé.");
    const out = r.rows.map(r=>`${r.domaine}\n${r.texte}`);
    res.send(out.join('\n\n'));
  } catch (err) { console.error(err); res.status(500).send("Erreur commentaires"); }
});

app.get('/deja-valide/:eleve/:competence', async (req, res) => {
  try {
    const { periode } = req.query;
    const periodes = ["P1","P2","P3","P4","P5"];
    const idx = periodes.indexOf(periode);
    if (idx < 0) return res.json({ deja: false });

    const r = await db.query(`
      SELECT COUNT(*) FROM scores s
      JOIN evaluations ev ON s.evaluation_id=ev.id
      JOIN eleves e ON s.eleve_id=e.id
      JOIN competences c ON s.competence_id=c.id
      WHERE LOWER(e.nom)=LOWER($1) AND c.nom=$2 AND s.valeur='oui' AND ev.periode IN (${periodes.slice(0, idx).map((_,i)=>`'${periodes[i]}'`).join(',')})
    `, [req.params.eleve, req.params.competence]);
    res.json({ deja: parseInt(r.rows[0].count, 10) > 0 });
  } catch (err) { console.error(err); res.status(500).json({ deja: false }); }
});

// Lancement
app.listen(PORT, () => console.log(`Server running on port ${PORT}`));

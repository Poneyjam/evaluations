// migrate.js
require('dotenv').config();
const db = require('./db');

async function migrate() {
  try {
    await db.query(`
      CREATE TABLE IF NOT EXISTS evaluations (
        id SERIAL PRIMARY KEY,
        domaine TEXT NOT NULL,
        annee TEXT,
        periode TEXT,
        prof TEXT,
        etat TEXT DEFAULT 'en cours'
      );
    `);

    await db.query(`
      CREATE TABLE IF NOT EXISTS eleves (
        id SERIAL PRIMARY KEY,
        nom TEXT NOT NULL,
        prof TEXT
      );
    `);

    await db.query(`
      CREATE TABLE IF NOT EXISTS evaluation_eleves (
        id SERIAL PRIMARY KEY,
        evaluation_id INTEGER REFERENCES evaluations(id) ON DELETE CASCADE,
        eleve_id INTEGER REFERENCES eleves(id) ON DELETE CASCADE
      );
    `);

    await db.query(`
      CREATE TABLE IF NOT EXISTS competences (
        id SERIAL PRIMARY KEY,
        evaluation_id INTEGER REFERENCES evaluations(id) ON DELETE CASCADE,
        nom TEXT
      );
    `);

    await db.query(`
      CREATE TABLE IF NOT EXISTS scores (
        id SERIAL PRIMARY KEY,
        evaluation_id INTEGER REFERENCES evaluations(id) ON DELETE CASCADE,
        eleve_id INTEGER REFERENCES eleves(id) ON DELETE CASCADE,
        competence_id INTEGER REFERENCES competences(id) ON DELETE CASCADE,
        valeur TEXT
      );
    `);

    await db.query(`
      CREATE TABLE IF NOT EXISTS commentaires (
        id SERIAL PRIMARY KEY,
        evaluation_id INTEGER REFERENCES evaluations(id) ON DELETE CASCADE,
        eleve_id INTEGER REFERENCES eleves(id) ON DELETE CASCADE,
        texte TEXT
      );
    `);

    console.log("✅ Migration terminée avec succès.");
    process.exit();
  } catch (err) {
    console.error("❌ Erreur lors de la migration :", err);
    process.exit(1);
  }
}

migrate();

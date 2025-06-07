const bcrypt = require('bcrypt');

const password = 'dirvaulx'; // Change ici pour ton mot de passe

bcrypt.hash(password, 10, (err, hash) => {
  if (err) {
    console.error(err);
    process.exit(1);
  }
  console.log('Hash généré :', hash);
});

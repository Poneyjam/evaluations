async function chargerDomaines() {
  const res = await fetch('/liste-domaines');
  const domaines = await res.json();

  const container = document.getElementById('resultats');
  container.innerHTML = '';

  if (domaines.length === 0) {
    container.innerHTML = '<p>Aucune évaluation trouvée.</p>';
    return;
  }

  domaines.forEach(d => {
    const div = document.createElement('div');
    div.innerHTML = `
      <strong>${d.domaine}</strong> - ${d.etat} (${d.annee}, ${d.periode}) - Prof : ${d.prof}
    `;
    container.appendChild(div);
  });
}

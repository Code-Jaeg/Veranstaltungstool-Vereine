// Kleine Helfer: Links kopieren/teilen, Sicherheitsabfragen.
document.addEventListener('click', async (ev) => {
  const copyBtn = ev.target.closest('[data-copy]');
  if (copyBtn) {
    const input = document.getElementById(copyBtn.dataset.copy);
    const text = input.value;
    if (navigator.share && copyBtn.dataset.share !== undefined && matchMedia('(pointer: coarse)').matches) {
      try { await navigator.share({ title: document.title, url: text }); return; } catch { /* abgebrochen */ }
    }
    try { await navigator.clipboard.writeText(text); } catch { input.select(); document.execCommand('copy'); }
    const old = copyBtn.textContent;
    copyBtn.textContent = 'Kopiert ✓';
    setTimeout(() => { copyBtn.textContent = old; }, 1600);
  }
});

document.addEventListener('submit', (ev) => {
  const msg = ev.target.dataset.confirm;
  if (msg && !confirm(msg)) ev.preventDefault();
});

// Beim Ende-Feld automatisch das Datum des Beginns übernehmen.
document.querySelectorAll('input[name="starts_at"]').forEach((start) => {
  start.addEventListener('change', () => {
    const end = start.form.querySelector('input[name="ends_at"]');
    if (end && (!end.value || end.value <= start.value)) {
      const d = new Date(start.value);
      d.setHours(d.getHours() + 2);
      const p = (n) => String(n).padStart(2, '0');
      end.value = `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`;
    }
  });
});

// Geöffneten Dienst sichtbar machen (z. B. nach Validierungsfehler).
const opened = document.querySelector('details[open][data-scroll]');
if (opened) opened.scrollIntoView({ block: 'center' });

// Kleine Helfer: Links kopieren/teilen, Sicherheitsabfragen, Mehrfachauswahl.
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
  if (msg && !confirm(msg)) { ev.preventDefault(); return; }
  // Doppeltes Absenden verhindern (z. B. bei langsamer Verbindung)
  const btn = ev.target.querySelector('button[type="submit"]');
  if (btn) setTimeout(() => { btn.disabled = true; }, 0);
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

// Mehrfachauswahl: Zähler im „Eintragen“-Knopf und Notizfeld bei Mitbringposten.
document.querySelectorAll('form#anmelden').forEach((form) => {
  const btn = form.querySelector('[data-count-label]');
  const update = () => {
    let n = 0; let w = 0;
    form.querySelectorAll('input[data-pick]:checked').forEach((c) => { if (c.name === 'wait') w++; else n++; });
    form.querySelectorAll('select[data-pick]').forEach((s) => {
      if (Number(s.value) > 0) n++;
      const note = s.closest('.pick').querySelector('.item-note');
      if (note) note.hidden = Number(s.value) === 0;
    });
    const parts = [];
    if (n) parts.push(n === 1 ? '1 Eintrag' : `${n} Einträge`);
    if (w) parts.push(`${w}× Warteliste`);
    btn.textContent = parts.length ? `${parts.join(' + ')} eintragen` : btn.dataset.countLabel;
    btn.classList.toggle('secondary', !parts.length);
  };
  form.addEventListener('change', update);
  update();
});

// Ausgewählten oder geöffneten Dienst sichtbar machen (z. B. aus „Ersatz gesucht“-Mail).
const target = location.hash && document.querySelector(location.hash);
if (target && target.classList.contains('pick')) target.scrollIntoView({ block: 'center' });

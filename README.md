# Vereinsdienste – Helferplanung für Vereinsveranstaltungen

Schlanke **Webanwendung** (keine App) im iOS-Stil, mit der Vereine – z. B. der Förderverein des Klosterhofs – Dienste für Veranstaltungen planen. Angelehnt an bekannte Tools wie SignUpGenius, Doodle oder „Helferliste“: Veranstaltung anlegen, Dienste festlegen, **Link teilen**, Helferinnen und Helfer tragen sich selbst ein. Ein Konto brauchen sie nicht.

## Funktionen

| Für Helferinnen & Helfer | Für die Veranstaltungsleitung |
|---|---|
| Dienste nach Tag gruppiert, Belegung mit Fortschrittsbalken | Veranstaltung anlegen, persönlicher Verwaltungslink per Mail |
| Selbst eintragen mit Name, E-Mail, Telefon, Bemerkung | Dienste anlegen, bearbeiten und löschen, auch als Schichtfolge („4 × 2 Std.“) |
| **Bestätigungsmail mit `.ics`-Kalendereintrag und PDF-Dienstbestätigung** | Alle Kontaktdaten einsehen, Personen manuell ein- und austragen |
| **Erinnerungsmails** (z. B. 48 Std. und 3 Std. vorher), ebenfalls mit `.ics` und PDF | **Sofortige Mail bei Ausfall** mit Grund und Kontakt sowie Anzahl freier Plätze |
| Eigene Anmeldung ansehen, `.ics`/PDF herunterladen, **absagen** | Pinnwand-Beitrag, optional als **Rundmail** an alle Eingetragenen |
| Pinnwand zur Kommunikation (Fragen, Fahrgemeinschaften …) | Export: Dienstplan als PDF (mit Kontakten oder zum Aushang), CSV für Excel, `.ics` für alle Dienste |
| Hell- und Dunkelmodus, optimiert fürs Smartphone, zum Homescreen hinzufügbar | Optionaler n8n-Webhook bei Anmeldung und Absage |

Bei einer Absage bekommt die Person eine `.ics`-Datei mit `METHOD:CANCEL`. Damit verschwindet der Termin wieder aus ihrem Kalender.

### Datenschutz (DSGVO)
- Wer sich einträgt, muss der Verarbeitung der Daten zustimmen. Öffentlich erscheint nur „Vorname N.“, die Kontaktdaten sieht nur die Veranstaltungsleitung.
- Alle Daten werden **automatisch gelöscht**, `DATA_RETENTION_DAYS` Tage nach der Veranstaltung (Standard: 30). Manuell löschen geht jederzeit.
- Der Zugang läuft über nicht erratbare Links (Tokens): einen öffentlichen Link, einen Verwaltungslink und einen persönlichen Link je Anmeldung. Gesetzt sind außerdem `noindex`, `Referrer-Policy: no-referrer`, eine Content-Security-Policy, eine Prüfung der Anfrage-Herkunft (Origin-Check), ein Rate-Limit und ein Honeypot gegen Spam.
- Mit `CREATE_PASSWORD` können nur Vereinsmitglieder, die das Passwort kennen, neue Veranstaltungen anlegen.

## Betrieb mit Docker (auf jaeger-sauer.de)

```bash
cp .env.example .env    # Werte anpassen (BASE_URL, SMTP, CREATE_PASSWORD)
docker compose up -d --build
```

Die Anwendung lauscht auf `127.0.0.1:3000`. Öffentlich erreichbar wird sie über den vorhandenen Reverse Proxy, z. B. unter `https://dienste.jaeger-sauer.de`. In `docker-compose.yml` steht ein Beispiel mit Traefik-Labels. Mit Caddy reicht:

```
dienste.jaeger-sauer.de {
    reverse_proxy 127.0.0.1:3000
}
```

Die Daten (SQLite) liegen im Volume `vereinsdienste-data`. Für ein Backup genügt es, `/data/vereinsdienste.sqlite` zu sichern.

### Konfiguration (`.env`)

| Variable | Bedeutung |
|---|---|
| `BASE_URL` | Öffentliche Adresse; wird für Links in Mails, PDF und ICS verwendet |
| `CREATE_PASSWORD` | Passwort zum Anlegen von Veranstaltungen (leer = offen) |
| `SMTP_HOST`, `SMTP_PORT`, `SMTP_SECURE`, `SMTP_USER`, `SMTP_PASS`, `MAIL_FROM` | Mailversand. Ohne `SMTP_HOST` werden Mails als `.eml` in `/data/outbox` abgelegt (zum Testen). |
| `REMINDER_HOURS` | Wann vor Dienstbeginn erinnert wird, z. B. `48,3` |
| `DATA_RETENTION_DAYS` | Automatisches Löschen nach X Tagen (0 = nie) |
| `N8N_WEBHOOK_URL` | Optionaler Webhook (siehe unten) |
| `MAIL_WEBHOOK_URL` | Mails an n8n übergeben statt SMTP |
| `WEBHOOK_SECRET` | Wird als Header `X-Vereinsdienste-Secret` an beide Webhooks geschickt |
| `OPERATOR_NAME`, `OPERATOR_ADDRESS`, `OPERATOR_EMAIL`, `OPERATOR_REPRESENTATIVE`, `OPERATOR_REGISTER` | Angaben für die eingebauten Seiten `/impressum` und `/datenschutz` |
| `IMPRINT_URL`, `PRIVACY_URL` | Stattdessen auf externe Impressums-/Datenschutzseiten verlinken |

### Produktivbetrieb Förderverein KHS (NAS + Dockhand + n8n)

| Baustein | Stand |
|---|---|
| Docker-Image | `ghcr.io/code-jaeg/veranstaltungstool-vereine:latest`, gebaut von GitHub Actions bei jedem Push |
| Stack | Dockhand-Stack `vereinsdienste` (siehe [`deploy/dockhand-compose.yaml`](deploy/dockhand-compose.yaml)), Port `8230`, Daten in `/volume2/docker/vereinsdienste/data` |
| Mailversand | `MAIL_WEBHOOK_URL` → n8n-Workflow **Vereinsdienste · Mailversand** → Mailcow |
| Ausfall-Meldung | `N8N_WEBHOOK_URL` → n8n-Workflow **Vereinsdienste · Ausfall-Meldung** → *System · Melden* (Telegram, Push, wenn der Dienst in < 48 Std. beginnt) |
| Öffentlich | `https://veranstaltungen.foerderverein-khs.de` → Nginx Proxy Manager → `http://192.168.178.91:8230` |

Jede Variable kann alternativ als Datei übergeben werden: `NAME_FILE=/secrets/datei` (z. B. `CREATE_PASSWORD_FILE`, `WEBHOOK_SECRET_FILE`). So stehen keine Geheimnisse im Klartext in der Compose-Datei; die Dateien legst du selbst im Dockhand-Dateibrowser an. `WEBHOOK_SECRET` muss mit dem Wert in den beiden n8n-Workflows (Knoten „Geheimnis korrekt?“) übereinstimmen.

Update auf eine neue Version: in Dockhand den Stack `vereinsdienste` mit „Pull“ neu deployen.

Statt SMTP kann die Anwendung Mails auch an einen Webhook übergeben (`MAIL_WEBHOOK_URL`). Der POST enthält `from`, `to`, `replyTo`, `subject`, `html`, `text` und `attachments[]` (`filename`, `contentType`, `content` als base64) sowie den Header `X-Vereinsdienste-Secret`.

### n8n-Anbindung
Ist `N8N_WEBHOOK_URL` gesetzt, sendet die Anwendung bei `signup.created` und `signup.cancelled` einen POST mit folgendem JSON:

```json
{
  "type": "signup.cancelled",
  "at": "2027-06-10T08:12:00.000Z",
  "event":  { "title": "Hoffest 2027", "date": "2027-06-12", "url": "…/e/…", "adminUrl": "…/admin/…" },
  "shift":  { "title": "Kuchenstand", "starts_at": "2027-06-12T10:00", "ends_at": "2027-06-12T12:00", "capacity": 2 },
  "signup": { "name": "Maria Muster", "email": "maria@example.org", "phone": "", "reason": "krank" }
}
```

In n8n lässt sich daraus z. B. eine Push-, Signal- oder Telegram-Nachricht an das Orga-Team machen.

## Entwicklung

Benötigt wird Node.js ≥ 22.13 (nutzt das eingebaute `node:sqlite`, kein nativer Build nötig).

```bash
npm install
npm start        # http://localhost:3000, Mails landen in data/outbox
npm test
```

Aufbau: `src/server.js` (Routen), `src/repo.js` + `src/db.js` (SQLite), `src/notify.js` + `src/mail.js` (Mails), `src/ics.js`, `src/pdf.js`, `src/jobs.js` (Erinnerungen und Löschfristen, alle 10 Minuten), `views/` (EJS-Templates), `public/` (CSS/JS).

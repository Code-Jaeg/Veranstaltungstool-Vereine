# Nextcloud im iOS-Design

Serverweites Theme im Stil der Apple-iOS-Designsprache. Es gilt für **alle Nutzer**, weil es
über die Admin-App **Custom CSS** und die zentralen **Theming**-Einstellungen eingespielt wird.
Am Nextcloud-Core wird nichts verändert, deshalb überlebt das Theme Updates.

## Was sich ändert

Vorbild ist Apples eigene Weboberfläche (iCloud.com / apple.com): zurückhaltend statt verspielt.

- Systemschrift (auf iPhone/Mac San Francisco), Farbpalette von apple.com (`#1D1D1F`, `#6E6E73`, `#F5F5F7`, Akzent `#0071E3`)
- Kopfzeile als helle Glasleiste mit dunklen Icons, aktive App als kleiner Punkt wie im Dock
- Hellgraue Seitenleiste wie in iCloud Drive, Auswahl grau hinterlegt mit blauem Icon
- Feine Trennlinien, dezente Schatten, moderate Rundungen (8/12/16 px)
- Hauptaktionen als Pillen-Buttons wie auf apple.com, Eingabefelder mit Fokusring
- Hell- und Dunkelmodus, reduzierte Bewegung wird respektiert

## Installation (Docker)

Ordner auf den Docker-Host kopieren und ausführen (Containername anpassen):

```bash
chmod +x apply-theme.sh
```

```bash
./apply-theme.sh nextcloud
```

Bei **Nextcloud AIO** heißt der Container `nextcloud-aio-nextcloud`:

```bash
./apply-theme.sh nextcloud-aio-nextcloud
```

## Manuell über die Weboberfläche

1. *Apps → Anpassung* → **Custom CSS** aktivieren
2. *Verwaltungseinstellungen → Design*: Primärfarbe `#0071E3`, Hintergrundfarbe `#F5F5F7`,
   „Nutzer-Design deaktivieren“ anhaken
3. Inhalt von `ios-theme.css` in das Feld **Custom CSS** einfügen und speichern

## Rückgängig machen

```bash
docker exec -u www-data nextcloud php occ config:app:delete theming_customcss customcss
```

```bash
docker exec -u www-data nextcloud php occ theming:config --reset primary_color
```

```bash
docker exec -u www-data nextcloud php occ config:app:set theming disable-user-theming --value="no"
```

## Hinweise

- Ausgelegt für Nextcloud 28–31. Bei größeren Updates können sich CSS-Klassen ändern.
  Dann kann einzelnes Styling ausfallen, die Grundfarben und Schrift bleiben aber erhalten.
- Apple-Schriften werden nicht mitgeliefert (Lizenz). Genutzt wird die Schrift des Geräts.
- Die Nextcloud-Apps für iOS/Android sind nativ und werden durch CSS nicht verändert,
  nur die Weboberfläche und die Primärfarbe (diese übernehmen die Apps teilweise).

# Nextcloud im iOS-Design

Serverweites Theme im Stil der Apple-iOS-Designsprache. Es gilt für **alle Nutzer**, weil es
über die Admin-App **Custom CSS** und die zentralen **Theming**-Einstellungen eingespielt wird.
Am Nextcloud-Core wird nichts verändert, deshalb überlebt das Theme Updates.

## Was sich ändert

- Systemschrift (auf iPhone/Mac San Francisco), engere Laufweite, fette Überschriften
- iOS-Systemfarben: Akzent `#007AFF`, gruppierter Hintergrund `#F2F2F7`, Dunkelmodus `#1C1C1E`/`#000`
- „Glas“-Effekt (Blur) für Kopfzeile, Seitenleisten, Menüs und Login-Box
- Abgerundete Ecken wie in iOS (10/14/22 px), Buttons als Pillen mit Antippen-Animation
- Eingabefelder im iOS-Stil mit blauem Fokusring, aktivierte Schalter in iOS-Grün
- Hell- und Dunkelmodus werden beide unterstützt, reduzierte Bewegung wird respektiert

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
2. *Verwaltungseinstellungen → Design*: Primärfarbe `#007AFF`, Hintergrundfarbe `#F2F2F7`,
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

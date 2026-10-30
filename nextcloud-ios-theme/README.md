# Nextcloud-Themes: Catppuccin Latte & Apple

Zwei serverweite Themes für Nextcloud. Sie gelten für **alle Nutzer**, weil sie über die
Admin-App **Custom CSS** und die zentralen **Theming**-Einstellungen eingespielt werden.
Am Nextcloud-Core wird nichts verändert, deshalb überleben die Themes Updates.

| Theme | Datei | Look |
|---|---|---|
| **Catppuccin Latte** (Standard) | `catppuccin-latte.css` | Helle Pastellpalette von [Catppuccin](https://catppuccin.com/palette), Akzent Mauve `#8839EF` |
| Apple | `ios-theme.css` | Nach Vorbild iCloud.com / apple.com, Akzent `#0071E3` |

## Catppuccin Latte

- Offizielle Latte-Palette: Hintergrund Base `#EFF1F5`, Seitenleiste/Kopfzeile Mantle `#E6E9EF`,
  Text `#4C4F69`, Akzent Mauve `#8839EF`
- Kopfzeile und Seitenleiste in Mantle mit Icons in Catppuccin-Textfarbe
- Aktive Einträge zart lila hinterlegt, Fokusring und Buttons in Mauve
- Login-Seite mit sanftem Pastell-Verlauf
- Hellmodus wird für alle erzwungen (`enforce_theme = light`), damit niemand die dunkle
  Nextcloud-Variante mit dem hellen CSS mischt

## Installation (Docker)

Ordner auf den Docker-Host kopieren und ausführen (Containername anpassen):

```bash
chmod +x apply-theme.sh
```

```bash
./apply-theme.sh nextcloud catppuccin
```

Bei **Nextcloud AIO** heißt der Container `nextcloud-aio-nextcloud`:

```bash
./apply-theme.sh nextcloud-aio-nextcloud catppuccin
```

Zurück zum Apple-Theme:

```bash
./apply-theme.sh nextcloud apple
```

## Manuell über die Weboberfläche (Catppuccin)

1. *Apps → Anpassung* → **Custom CSS** aktivieren
2. *Verwaltungseinstellungen → Design*: Primärfarbe `#8839EF`, Hintergrundfarbe `#DCE0E8`,
   „Nutzer-Design deaktivieren“ anhaken
3. Inhalt von `catppuccin-latte.css` in das Feld **Custom CSS** einfügen und speichern
4. Hellmodus erzwingen geht nur per Befehl:
   `docker exec -u www-data nextcloud php occ config:system:set enforce_theme --value=light`

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

```bash
docker exec -u www-data nextcloud php occ config:system:delete enforce_theme
```

## Hinweise

- Ausgelegt für Nextcloud 28–32. Bei größeren Updates können sich CSS-Klassen ändern.
  Dann kann einzelnes Styling ausfallen, die Grundfarben bleiben aber erhalten.
- Die nativen Nextcloud-Apps für iOS/Android werden durch CSS nicht verändert,
  nur die Weboberfläche und die Primärfarbe.

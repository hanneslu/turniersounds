# Turniersounds

Web-App zum Abspielen von Jingles bei Sportturnieren (Tore, Ecken, Siegerehrung).
Songs werden auf dem Gerät gespeichert, auf einen Ausschnitt zugeschnitten und auf Boards
mit beschrifteten Knöpfen gelegt. Kein App Store, kein Konto, kein Server.

- **Bedienung und Installation:** siehe [ANLEITUNG.html](ANLEITUNG.html) (auch in der App unter Einstellungen → Hilfe).
- **Musik ist nicht Teil dieses Repositorys.** Jeder Nutzer importiert seine eigenen, DRM-freien Dateien.

## Technik

Reines HTML, CSS und JavaScript (ES-Module) ohne Build-Schritt und ohne Fremdbibliotheken.
Zum Veröffentlichen genügt es, den Ordner auf einen statischen Webserver zu legen (z. B. GitHub Pages).

| Datei | Aufgabe |
|---|---|
| `index.html`, `styles.css` | Seite und Gestaltung |
| `js/app.js` | Oberfläche: Boards, Knöpfe, Einstellungen, Import/Export |
| `js/editor.js` | Dialog „Jingle bearbeiten“ mit Wellenform |
| `js/audio.js` | Wiedergabe über die Web Audio API, Vorladen der Ausschnitte |
| `js/model.js` | Datenmodell, Import (ZIP, `soundboard.json`, Audiodateien), Export |
| `js/store.js` | Speicherung im Browser (IndexedDB) |
| `js/zip.js` | ZIP lesen und schreiben |
| `js/theme.js`, `js/util.js` | Farbschema und Helfer |
| `sw.js`, `manifest.webmanifest` | Offline-Betrieb und Installation auf dem Home-Bildschirm |

Das Datenformat für Boards und Jingles entspricht der `soundboard.json` der iOS-App
„Soundboard Studio“ (Felder `title`, `file`, `trimInPoint`, `trimOutPoint`, `fadesIn`, …),
sodass bestehende Sammlungen direkt importiert werden können.

## Änderungen veröffentlichen

1. Dateien ändern.
2. In `sw.js` die Konstante `VERSION` erhöhen (z. B. `turniersounds-v2`), damit installierte Geräte die neue Fassung laden.
3. Committen und pushen; GitHub Pages aktualisiert die Seite automatisch.

## Lokal testen

Die App muss über `http://localhost` oder HTTPS laufen (nicht per Doppelklick auf `index.html`).
Mit installiertem Python z. B.: `python -m http.server 8000` im Projektordner, dann `http://localhost:8000` öffnen.

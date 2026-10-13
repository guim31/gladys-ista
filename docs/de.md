# ista Web'conso (Frankreich)

Bringt die Ablesungen, die **ista** in deinem Gebäude aus der Ferne macht, in
Gladys: die **Heizkostenverteiler** deiner Heizkörper und, wenn das Portal sie
liefert, deine **Wasserzähler**. Die Daten stammen aus dem ista-Bewohnerportal
[ista-webconso.fr](https://www.ista-webconso.fr) („Mon espace résident“).

> **Nicht mit ista verbunden.** ista und Web'conso sind Marken ihrer
> Inhaber. Diese Integration ist ein unabhängiges Projekt.
>
> **Ohne Konto entwickelt: Rückmeldungen willkommen.** Niemand hat sie bisher
> mit einem echten Web'conso-Konto ausprobiert. Es ist die empfindlichste Art
> von Integration: Es gibt keine öffentliche API, also liest sie das Portal so
> wie dein Browser und kann an dem Tag ausfallen, an dem ista seine Website
> ändert.

## Was du bekommst

Ein Gerät, **ista-Wohnung**, mit:

| Funktion                                          | Gladys-Typ | Einheit | Was es ist                                                                                                   |
| ------------------------------------------------- | ---------- | ------- | ------------------------------------------------------------------------------------------------------------ |
| Heizeinheiten des Tages                           | Zähler     | keine   | Die Einheiten aller deiner Heizkörper für den Tag, gewichtet mit dem Faktor jedes Heizkörpers (abgerechnet). |
| Heizkörper _Raum_ — Nr. _Seriennummer_ (je einer) | Zähler     | keine   | Der Stand, den der Verteiler dieses Heizkörpers anzeigt.                                                     |
| Kaltwasser / Warmwasser _Raum_ (je einer)         | Volumen    | m³      | Der kumulierte Stand dieses Zählers. **Nicht geprüft**, siehe Grenzen.                                       |
| Kaltwasser — gesamt / Warmwasser — gesamt         | Volumen    | m³      | Die Summe der Stände, wenn die Wohnung mehrere Zähler dieses Mediums hat.                                    |

Die Heizeinheiten **haben keine physikalische Einheit**: Ein Verteiler misst
keine Energie, er dient nur dazu, die Heizkosten des Gebäudes auf die
Wohnungen aufzuteilen. Deshalb werden sie als einfache Zähler angezeigt, ohne
kWh.

Jede Ablesung ist **auf ihren eigenen Tag datiert**, auch wenn das Portal sie
mehrere Tage verspätet veröffentlicht: Die Diagramme von Gladys zeigen den
Verbrauch an dem Tag, an dem er angefallen ist, nicht an dem Tag, an dem er
gelesen wurde. Beim Anlegen des Geräts werden ihm die letzten 7 bereits
gelesenen Tage geschickt.

Ein **Dashboard-Widget**, „ista-Verbrauch“, zeigt die Heizeinheiten des
letzten Tages, die Wasserstände, ein Balkendiagramm der Heizeinheiten pro Tag
und das Datum der letzten Ablesung.

## Konfiguration

1. Installiere die Integration und öffne ihren Reiter **Konfiguration**.
2. Lass **Anmeldemethode** auf **E-Mail und Passwort** und gib die E-Mail und
   das Passwort deines Bewohnerbereichs ein.
3. Wähle die **Sprache der Funktionsnamen** (Gladys teilt einer Integration
   deine Sprache nicht mit; die Namen werden beim Anlegen des Geräts
   festgelegt).
4. Speichere und klicke dann auf **Verbindung testen und jetzt ablesen**. Die
   Meldung unter der Schaltfläche zeigt, wie viele Verteiler und Zähler
   gefunden wurden, und das Datum der letzten Ablesung.
5. Öffne den Reiter **Entdecken** und füge das Gerät **ista-Wohnung** hinzu.

### Wenn E-Mail und Passwort nicht funktionieren: das Sitzungs-Cookie

Wenn der Status meldet, dass das Portal ein Captcha oder einen zweiten Faktor
verlangt oder dass die Anmeldeseite nicht erkannt wird, kannst du der
Integration die Sitzung deines eigenen Browsers überlassen. Das ist eine
Notlösung: Die Sitzung **läuft ab** (wenn du dich abmeldest oder nach einer
Zeit ohne Aktivität), und dann musst du eine neue einfügen.

1. Melde dich an einem Computer bei
   [ista-webconso.fr](https://www.ista-webconso.fr) an und öffne die
   Verbrauchsseite deiner Wohnung.
2. Öffne die Entwicklertools (**F12**), Reiter **Netzwerk**, und lade die
   Seite neu.
3. Klicke auf eine Anfrage an `ista-webconso.fr`. Kopiere unter
   **Anfrage-Header** den ganzen Wert der Zeile **Cookie**. (Oder kopiere
   unter **Anwendung** / **Speicher** → **Cookies** den Wert von
   `JSESSIONID`.)
4. Klicke danach im Portal **nicht** auf „Se déconnecter“ (Abmelden): Das
   würde die Sitzung beenden. Schließ einfach den Tab.
5. In Gladys: **Anmeldemethode** → **Sitzungs-Cookie (Notlösung)**, füge den
   Text in **Sitzungs-Cookie** ein, speichere und klicke auf **Verbindung
   testen und jetzt ablesen**.

Da jede Ablesung die letzten 7 Tage nachholt, reicht es, einmal pro Woche ein
frisches Cookie einzufügen, um den Verlauf vollständig zu halten.

## Wie oft das Portal gelesen wird

Das Portal wird standardmäßig alle **12 Stunden** gelesen, einstellbar von
**3 bis 24 Stunden** (**Ableseintervall**). ista aktualisiert die Ablesungen
**höchstens einmal am Tag**, und viele Gebäude werden **nur einmal pro Woche**
abgelesen: Häufigeres Lesen bringt nichts und belastet nur das Portal. Jede
Ablesung fragt nur die noch nicht gelesenen Tage ab, eine kleine Anfrage pro
Tag und Medium, mit einer Pause dazwischen.

## Grenzen

- **Anmeldung nur teilweise geprüft.** Das Portal schickt den Browser zur
  Anmeldeseite von ista (`login.ista.com`). Die Integration folgt denselben
  Schritten, und das wurde am echten Portal bis zur Ablehnung eines
  erfundenen Kontos geprüft (kein Captcha). Eine erfolgreiche Anmeldung mit
  einem echten Konto wurde noch nicht gesehen.
- **Wasser nicht geprüft.** Die Heizungsseite ist durch ein öffentliches
  Projekt bekannt, das sie 2025 gelesen hat. Die Wasserseiten sind eine
  Vermutung: Wenn das Portal sie ablehnt, erscheint keine Wasserfunktion, und
  der Verbindungstest zählt 0 Wasserzähler. Wenn dein Wasser nicht erscheint,
  melde es bitte.
- **Eine Wohnung pro Konto.** Ein Konto mit mehreren Wohnungen zeigt deren
  Zähler in einem einzigen Gerät.
- **Zurücksetzen der Stände.** Die Verteiler beginnen meist bei der
  Jahresablesung wieder bei null: Das Diagramm des Stands fällt dann ab, das
  der Tageseinheiten nicht.
- **Die Namen sind festgelegt**, sobald das Gerät angelegt ist (eine Regel von
  Gladys): Eine Umbenennung im Portal benennt die Funktionen nicht um.

## Fehlerbehebung

Der Bildschirm **Konfiguration** zeigt den Status der Verbindung:

| Meldung                                               | Was tun                                                                                        |
| ----------------------------------------------------- | ---------------------------------------------------------------------------------------------- |
| Das Portal hat die E-Mail oder das Passwort abgelehnt | Prüfe sie, indem du dich bei ista-webconso.fr anmeldest.                                       |
| Captcha / zweiter Faktor                              | Nutze den Modus Sitzungs-Cookie (siehe oben).                                                  |
| Melde dich einmal im Browser an                       | Das Portal verlangt etwas (neues Passwort, Nutzungsbedingungen): Erledige es und teste erneut. |
| Anmeldeseite nicht erkannt                            | Das Portal hat sich geändert: Nutze den Modus Sitzungs-Cookie und melde es.                    |
| Das Sitzungs-Cookie ist abgelaufen                    | Füge ein neues ein.                                                                            |
| Unbekanntes Format                                    | Das Portal hat sich geändert: Melde es mit den Protokollen.                                    |
| Das ista-Portal ist nicht erreichbar                  | Neuer Versuch innerhalb einer Stunde, nichts zu tun.                                           |

Um ein Problem zu melden, eröffne ein Ticket auf
[GitHub](https://github.com/guim31/gladys-ista/issues) mit den Protokollen der
Integration (Gladys → Integration → **Protokolle**). Die Protokolle enthalten
nie deine E-Mail, dein Passwort oder dein Cookie; wenn das Portal in einem
unbekannten Format antwortet, zeigen sie dessen **Struktur** (Feldnamen, ohne
Werte), und genau das braucht es, um die Integration anzupassen.

## Datenschutz

Deine E-Mail, dein Passwort oder dein Cookie bleiben in der Konfiguration von
Gladys. Die Integration speichert die Sitzung des Portals und die letzten
Ablesungen in ihrem eigenen Volume (`/data`) und spricht nur mit dem Portal
und der Anmeldeseite von ista.

# ista Web'conso (Frankreich)

Bringt die Ablesungen, die **ista** in deinem Gebäude aus der Ferne macht, in
Gladys: deine **Wasserzähler** und, wenn das Portal sie anbietet, die
**Heizkostenverteiler** deiner Heizkörper. Die Daten stammen aus dem
ista-Bewohnerportal [ista-webconso.fr](https://www.ista-webconso.fr) („Mon
espace résident“).

> **Nicht mit ista verbunden.** ista und Web'conso sind Marken ihrer
> Inhaber. Diese Integration ist ein unabhängiges Projekt.
>
> **Wasser an einem echten Konto geprüft, Heizung noch nicht.** Die
> Wasserablesungen folgen Seiten, die ein Bewohner im November 2026 geteilt
> hat; die Heizungsablesungen wurden noch nicht funktionieren gesehen. Es ist
> die empfindlichste Art von Integration: Es gibt keine öffentliche API, also
> liest sie das Portal so wie dein Browser und kann an dem Tag ausfallen, an
> dem ista seine Website ändert.

## Was du bekommst

Ein Gerät, **ista-Wohnung**, mit:

| Funktion                                                 | Gladys-Typ | Einheit | Was es ist                                                                                          |
| -------------------------------------------------------- | ---------- | ------- | --------------------------------------------------------------------------------------------------- |
| Heizeinheiten des Tages                                  | Zähler     | keine   | Die Einheiten aller deiner Heizkörper am letzten abgelesenen Tag. **Nicht geprüft**, siehe Grenzen. |
| Heizkörper _Raum_ — Nr. _Seriennummer_ (je einer)        | Zähler     | keine   | Der Stand, den der Verteiler dieses Heizkörpers anzeigt. **Nicht geprüft**, siehe Grenzen.          |
| Kaltwasser / Warmwasser _Raum_ — Nr. _Nummer_ (je einer) | Volumen    | m³      | Der kumulierte Stand dieses Zählers, wie das Portal ihn abliest (echt oder geschätzt).              |
| Kaltwasser — gesamt / Warmwasser — gesamt                | Volumen    | m³      | Die Summe der Stände, wenn die Wohnung mehrere Zähler dieses Mediums hat.                           |

Die Heizeinheiten **haben keine physikalische Einheit**: Ein Verteiler misst
keine Energie, er dient nur dazu, die Heizkosten des Gebäudes auf die
Wohnungen aufzuteilen. Deshalb werden sie als einfache Zähler angezeigt, ohne
kWh.

Jede Ablesung ist **auf ihr Ablesedatum datiert**, das meist einige Tage
zurückliegt: Die Diagramme von Gladys zeigen den Stand an dem Tag, an dem er
abgelesen wurde, nicht an dem Tag, an dem er geholt wurde. Beim Anlegen des
Geräts werden ihm die bereits geholten letzten Ablesungen geschickt.

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

Die Stände sind kumuliert: Nach einem abgelaufenen Cookie holt die nächste
Ablesung den Verbrauch nach; nur die Tage dazwischen haben keinen Punkt in den
Diagrammen.

## Wie oft das Portal gelesen wird

Das Portal wird standardmäßig alle **12 Stunden** gelesen, einstellbar von
**3 bis 24 Stunden** (**Ableseintervall**). ista aktualisiert die Ablesungen
**höchstens einmal am Tag**, meist mit einigen Tagen Verzögerung: Häufigeres
Lesen bringt nichts und belastet nur das Portal. Jede Ablesung öffnet die
Seite **index à la demande** (Stand auf Abruf) des Portals und fragt, wenn sie
ein neueres Ablesedatum anbietet, die Stände dieses Datums ab: zwei kleine
Anfragen (drei mit Heizung), nur eine, wenn nichts neu ist.

## Grenzen

- **Anmeldung geprüft.** Das Portal schickt den Browser zur Anmeldeseite von
  ista (`login.ista.com`); die Integration folgt denselben Schritten. Ein
  Bewohner hat sich im November 2026 damit angemeldet, mit Passwort und mit
  Cookie.
- **Heizung nicht geprüft.** Die Heizungsablesungen nutzen den Heizungsreiter
  derselben Seite, der nur aus dem Skript des Portals bekannt ist: Niemand hat
  ihn bisher antworten sehen. Wenn für deine Wohnung Heizung angegeben ist,
  sie aber nicht erscheint, steht es in den Logs: Bitte melde es.
- **Geschätzte Stände.** Das Portal kennzeichnet manche Stände als geschätzt
  (ein Zähler, der auf die Funkablesung nicht geantwortet hat): Die Integration veröffentlicht sie so, wie das Portal sie zeigt, und die nächste echte Ablesung löst sie ab.
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

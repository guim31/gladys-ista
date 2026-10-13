// -----------------------------------------------------------------------------
// Texts sent from the container to Gladys: feature names, connection status
// messages, action results, widget content. Every text exists in English,
// French, German (informal "du") and Spanish (formal "usted");
// test/i18n.test.js checks it.
// -----------------------------------------------------------------------------

export const TEXTS = {
  device_name: {
    en: 'ista dwelling',
    fr: 'Logement ista',
    de: 'ista-Wohnung',
    es: 'Vivienda ista',
  },
  radiator: { en: 'Radiator', fr: 'Radiateur', de: 'Heizkörper', es: 'Radiador' },
  serial_short: { en: 'no.', fr: 'n°', de: 'Nr.', es: 'n.º' },
  heating: { en: 'Heating', fr: 'Chauffage', de: 'Heizung', es: 'Calefacción' },
  heating_daily: {
    en: 'Heating units of the day',
    fr: 'Unités de chauffage du jour',
    de: 'Heizeinheiten des Tages',
    es: 'Unidades de calefacción del día',
  },
  cold_water: { en: 'Cold water', fr: 'Eau froide', de: 'Kaltwasser', es: 'Agua fría' },
  hot_water: { en: 'Hot water', fr: 'Eau chaude', de: 'Warmwasser', es: 'Agua caliente' },
  total: { en: 'total', fr: 'total', de: 'gesamt', es: 'total' },
  units: { en: 'units', fr: 'unités', de: 'Einh.', es: 'uds.' },

  // Connection status (Configuration screen).
  status_not_configured: {
    en: 'Enter your Web’conso e-mail and password, or a session cookie.',
    fr: 'Saisissez l’e-mail et le mot de passe Web’conso, ou un cookie de session.',
    de: 'Gib deine Web’conso-E-Mail und dein Passwort ein, oder ein Sitzungs-Cookie.',
    es: 'Introduzca su correo y su contraseña de Web’conso, o una cookie de sesión.',
  },
  status_invalid_credentials: {
    en: 'The portal refused the e-mail or the password.',
    fr: 'Le portail a refusé l’e-mail ou le mot de passe.',
    de: 'Das Portal hat die E-Mail oder das Passwort abgelehnt.',
    es: 'El portal ha rechazado el correo o la contraseña.',
  },
  status_captcha: {
    en: 'The portal asks for a captcha: use the session cookie mode.',
    fr: 'Le portail demande un captcha : utilisez le mode cookie de session.',
    de: 'Das Portal verlangt ein Captcha: nutze den Modus Sitzungs-Cookie.',
    es: 'El portal pide un captcha: utilice el modo cookie de sesión.',
  },
  status_two_factor: {
    en: 'The account asks for a second factor: use the session cookie mode.',
    fr: 'Le compte demande un second facteur : utilisez le mode cookie de session.',
    de: 'Das Konto verlangt einen zweiten Faktor: nutze den Modus Sitzungs-Cookie.',
    es: 'La cuenta pide un segundo factor: utilice el modo cookie de sesión.',
  },
  status_action_required: {
    en: 'Sign in once in a browser: the portal asks for an action there.',
    fr: 'Connectez-vous une fois dans un navigateur : le portail y demande une action.',
    de: 'Melde dich einmal im Browser an: Das Portal verlangt dort eine Aktion.',
    es: 'Inicie sesión una vez en un navegador: el portal le pide allí una acción.',
  },
  status_login_form_not_found: {
    en: 'Login page not recognized: the portal changed, see the documentation.',
    fr: 'Page de connexion non reconnue : le portail a changé, voir la documentation.',
    de: 'Anmeldeseite nicht erkannt: Das Portal hat sich geändert, siehe Doku.',
    es: 'Página de inicio de sesión no reconocida: el portal ha cambiado, vea la documentación.',
  },
  status_session_expired: {
    en: 'The session cookie has expired: paste a new one.',
    fr: 'Le cookie de session a expiré : collez-en un nouveau.',
    de: 'Das Sitzungs-Cookie ist abgelaufen: Füge ein neues ein.',
    es: 'La cookie de sesión ha caducado: pegue una nueva.',
  },
  status_unexpected_answer: {
    en: 'The portal answered in an unknown format: see the logs.',
    fr: 'Le portail a répondu dans un format inconnu : voir les journaux.',
    de: 'Das Portal hat in einem unbekannten Format geantwortet: siehe Logs.',
    es: 'El portal ha respondido en un formato desconocido: vea los registros.',
  },
  status_unreachable: {
    en: 'The ista portal cannot be reached, next try in one hour.',
    fr: 'Le portail ista est injoignable, nouvel essai dans une heure.',
    de: 'Das ista-Portal ist nicht erreichbar, neuer Versuch in einer Stunde.',
    es: 'No se puede acceder al portal de ista, nuevo intento en una hora.',
  },

  // Result of the "Test the connection" action.
  test_success: {
    en: 'Connected. Heat cost allocators: {heating}, water meters: {water}. Latest reading: {day}.',
    fr: 'Connecté. Répartiteurs : {heating}, compteurs d’eau : {water}. Dernier relevé : {day}.',
    de: 'Verbunden. Heizkostenverteiler: {heating}, Wasserzähler: {water}. Letzte Ablesung: {day}.',
    es: 'Conectado. Repartidores: {heating}, contadores de agua: {water}. Última lectura: {day}.',
  },
  no_reading_yet: {
    en: 'none yet',
    fr: 'aucun pour l’instant',
    de: 'noch keine',
    es: 'ninguna por ahora',
  },

  // Widget.
  widget_latest_reading: {
    en: 'Latest reading',
    fr: 'Dernier relevé',
    de: 'Letzte Ablesung',
    es: 'Última lectura',
  },
  widget_heating_day: {
    en: 'Heating, latest day',
    fr: 'Chauffage, dernier jour',
    de: 'Heizung, letzter Tag',
    es: 'Calefacción, último día',
  },
  widget_cold_water_index: {
    en: 'Cold water, index',
    fr: 'Eau froide, index',
    de: 'Kaltwasser, Stand',
    es: 'Agua fría, índice',
  },
  widget_hot_water_index: {
    en: 'Hot water, index',
    fr: 'Eau chaude, index',
    de: 'Warmwasser, Stand',
    es: 'Agua caliente, índice',
  },
  widget_next_check: {
    en: 'Next check',
    fr: 'Prochaine vérification',
    de: 'Nächste Prüfung',
    es: 'Próxima comprobación',
  },
  widget_connection: { en: 'Portal', fr: 'Portail', de: 'Portal', es: 'Portal' },
  widget_connected: { en: 'Connected', fr: 'Connecté', de: 'Verbunden', es: 'Conectado' },
  widget_disconnected: {
    en: 'Not connected',
    fr: 'Non connecté',
    de: 'Nicht verbunden',
    es: 'No conectado',
  },
  widget_heating_chart: {
    en: 'Heating units per day',
    fr: 'Unités de chauffage par jour',
    de: 'Heizeinheiten pro Tag',
    es: 'Unidades de calefacción por día',
  },
  widget_empty: {
    en: 'No reading yet. Check the connection in the integration settings.',
    fr: 'Aucun relevé pour l’instant. Vérifiez la connexion dans la configuration.',
    de: 'Noch keine Ablesung. Prüfe die Verbindung in den Einstellungen.',
    es: 'Aún no hay lecturas. Compruebe la conexión en la configuración.',
  },
};

/** A text in one language, with `{name}` placeholders filled from `values`. */
export function t(key, language, values = {}) {
  const entry = TEXTS[key];
  if (!entry) {
    throw new Error(`Unknown text "${key}"`);
  }
  const template = entry[language] ?? entry.en;
  return template.replace(/\{(\w+)\}/g, (match, name) =>
    values[name] === undefined ? match : String(values[name]),
  );
}

/** A text in every language, as the multi-language object Gladys expects. */
export function allLanguages(key, values = {}) {
  return Object.fromEntries(
    Object.keys(TEXTS[key]).map((language) => [language, t(key, language, values)]),
  );
}

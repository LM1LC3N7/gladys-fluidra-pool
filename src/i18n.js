// -----------------------------------------------------------------------------
// Texts shown in Gladys (connection status, button, command refusals, device
// and feature names, modes), in English and French.
// -----------------------------------------------------------------------------

/** The text of `texts` in `language`, English otherwise. */
export const word = (texts, language) => texts?.[language] ?? texts?.en;

const both = (en, fr) => ({ en, fr });

/** Two messages one after the other, in each language. */
export const join = (...messages) =>
  both(messages.map((m) => m.en).join(' '), messages.map((m) => m.fr).join(' '));

/** "25 min" / "3 h", for the pauses. */
export function age(ms) {
  const seconds = Math.max(1, Math.round(ms / 1000));
  if (seconds < 120) {
    return both(`${seconds} s`, `${seconds} s`);
  }
  const minutes = Math.round(seconds / 60);
  if (minutes < 120) {
    return both(`${minutes} min`, `${minutes} min`);
  }
  const hours = Math.round(minutes / 60);
  return both(`${hours} h`, `${hours} h`);
}

/** The device name when the cloud gives none. */
export const DEVICE_NAMES = {
  heat_pump: both('Pool heat pump', 'Pompe à chaleur piscine'),
  chlorinator: both('Pool water treatment', 'Traitement de l’eau'),
  pump: both('Pool pump', 'Pompe de filtration'),
  light: both('Pool light', 'Éclairage piscine'),
};

/** Feature names, in the language chosen in the configuration. */
export const FEATURE_NAMES = {
  running: both('Running', 'En marche'),
  'auto-mode': both('Automatic mode (schedule)', 'Mode automatique (programmation)'),
  speed: both('Speed', 'Vitesse'),
  'speed-percent': both('Speed (%)', 'Vitesse (%)'),
  power: both('Power', 'Puissance'),
  'water-temperature': both('Water temperature', 'Température de l’eau'),
  'air-temperature': both('Air temperature', 'Température de l’air'),
  setpoint: both('Setpoint', 'Consigne'),
  mode: both('Mode', 'Mode'),
  ph: both('pH', 'pH'),
  orp: both('ORP (redox)', 'Redox (ORP)'),
  'free-chlorine': both('Free chlorine (mg/L)', 'Chlore libre (mg/L)'),
  salinity: both('Salinity (g/L)', 'Salinité (g/L)'),
  level: both('Chlorination setpoint (%)', 'Consigne de production (%)'),
  production: both('Chlorine production (%)', 'Production de chlore (%)'),
  light: both('Light', 'Éclairage'),
};

/** The options of the pump speed select. */
export const SPEED_LABELS = {
  off: both('Off', 'Arrêt'),
  low: both('Low', 'Lente'),
  medium: both('Medium', 'Moyenne'),
  high: both('High', 'Rapide'),
  auto: both('Automatic (schedule)', 'Automatique (programmation)'),
};

/** Heat pump modes (src/fluidra.js). */
export const MODE_LABELS = {
  'smart-heating': both('Smart heating', 'Chauffage Smart'),
  'smart-cooling': both('Smart cooling', 'Refroidissement Smart'),
  'smart-heat-cool': both('Smart heating and cooling', 'Chauffage et refroidissement Smart'),
  'boost-heating': both('Boost heating', 'Chauffage Boost'),
  'silence-heating': both('Silence heating', 'Chauffage Silence'),
  'boost-cooling': both('Boost cooling', 'Refroidissement Boost'),
  'silence-cooling': both('Silence cooling', 'Refroidissement Silence'),
  'smart-plus': both('Smart+', 'Smart+'),
  boost: both('Boost', 'Boost'),
  smart: both('Smart', 'Smart'),
  ecosilence: both('Ecosilence', 'Ecosilence'),
  silence: both('Silence', 'Silence'),
  heating: both('Heating', 'Chauffage'),
  cooling: both('Cooling', 'Refroidissement'),
  auto: both('Automatic', 'Automatique'),
};

const plural = (n, en, fr) => (n > 1 ? both(`${en}s`, `${fr}s`) : both(en, fr));

export const T = {
  noCredentials: both(
    'Enter the e-mail and the password of your Fluidra account (the ones of the Fluidra Pool app).',
    "Saisissez l'e-mail et le mot de passe de votre compte Fluidra (ceux de l'application Fluidra Pool).",
  ),
  connecting: both('Signing in to Fluidra…', 'Connexion à Fluidra…'),
  connected: (read, total, unsupported) => {
    const d = plural(read, 'device', 'appareil');
    const extra =
      unsupported > 0
        ? both(
            ` ${unsupported} other device${unsupported > 1 ? 's are' : ' is'} not supported yet (see the documentation).`,
            ` ${unsupported} autre${unsupported > 1 ? 's' : ''} appareil${unsupported > 1 ? 's ne sont' : " n'est"} pas encore pris en charge (voir la documentation).`,
          )
        : both('', '');
    const lost =
      total > read
        ? both(
            ` ${total - read} could not be read (see ${total - read > 1 ? 'their' : 'its'} badge).`,
            ` ${total - read} n'${total - read > 1 ? 'ont' : 'a'} pas pu être lu${total - read > 1 ? 's' : ''} (voir ${total - read > 1 ? 'leur' : 'son'} badge).`,
          )
        : both('', '');
    return both(
      `Connected to Fluidra: ${read} ${d.en} read. Open Discovery to add ${read > 1 ? 'them' : 'it'}.${lost.en}${extra.en}`,
      `Connecté à Fluidra : ${read} ${d.fr} lu${read > 1 ? 's' : ''}. Ouvrez Découverte pour ${read > 1 ? 'les ' : "l'"}ajouter.${lost.fr}${extra.fr}`,
    );
  },
  noDevice: (unsupported) =>
    unsupported > 0
      ? both(
          `Connected to Fluidra, but none of the ${unsupported} device${unsupported > 1 ? 's' : ''} of the account is supported yet (see the documentation).`,
          `Connecté à Fluidra, mais aucun des ${unsupported} appareil${unsupported > 1 ? 's' : ''} du compte n'est encore pris en charge (voir la documentation).`,
        )
      : both(
          'Connected to Fluidra, but the account has no pool equipment.',
          "Connecté à Fluidra, mais le compte n'a aucun équipement de piscine.",
        ),
  refused: (wait) =>
    both(
      `Fluidra refused the e-mail or the password (or the account). Check them in the configuration: saving, or the test button, tries again at once; otherwise one new try in ${wait.en}.`,
      `Fluidra a refusé l'e-mail ou le mot de passe (ou le compte). Vérifiez-les dans la configuration : enregistrer, ou le bouton de test, réessaie aussitôt ; sinon un nouvel essai dans ${wait.fr}.`,
    ),
  twoFactor: both(
    'Fluidra asks for a verification code (two-step sign-in), which this integration does not handle. It never signs in again by itself (each sign-in would send a code): turn the two-step sign-in off in the Fluidra Pool app, then click "Test the connection".',
    "Fluidra demande un code de vérification (connexion en deux étapes), que cette intégration ne gère pas. Elle ne se reconnecte jamais d'elle-même (chaque connexion enverrait un code) : désactivez la connexion en deux étapes dans l'application Fluidra Pool, puis cliquez sur « Tester la connexion ».",
  ),
  newPassword: both(
    'Fluidra asks for a new password: choose it in the Fluidra Pool app, then enter it here.',
    "Fluidra demande un nouveau mot de passe : choisissez-le dans l'application Fluidra Pool, puis saisissez-le ici.",
  ),
  unsupportedChallenge: (name) =>
    both(
      `Fluidra asks for a sign-in step this integration does not handle (${name ?? 'unknown'}). It never tries again by itself: click "Test the connection", or change the e-mail or the password.`,
      `Fluidra demande une étape de connexion que cette intégration ne gère pas (${name ?? 'inconnue'}). Elle ne réessaie jamais d'elle-même : cliquez sur « Tester la connexion », ou changez l'e-mail ou le mot de passe.`,
    ),
  sessionRefused: (wait) =>
    both(
      `Fluidra refused the session again right after a new sign-in. New try in ${wait.en}, or click "Test the connection".`,
      `Fluidra a de nouveau refusé la session juste après une nouvelle connexion. Nouvel essai dans ${wait.fr}, ou cliquez sur « Tester la connexion ».`,
    ),
  unreachable: (reason, wait) =>
    both(
      `Fluidra cannot be reached (${reason.en}). Next try in ${wait.en}.`,
      `Fluidra est injoignable (${reason.fr}). Nouvel essai dans ${wait.fr}.`,
    ),
  rateLimited: (wait) =>
    both(
      `Fluidra asks to slow down: pausing for ${wait.en}.`,
      `Fluidra demande de ralentir : pause de ${wait.fr}.`,
    ),
  forbidden: (wait) =>
    both(
      `Fluidra refuses the requests (HTTP 403): pausing for ${wait.en}.`,
      `Fluidra refuse les requêtes (HTTP 403) : pause de ${wait.fr}.`,
    ),
  deviceNoAnswer: both(
    'Fluidra did not answer for this device at the last read (an error or a timeout of the cloud).',
    "Fluidra n'a pas répondu pour cet appareil à la dernière lecture (erreur ou délai dépassé du cloud).",
  ),
  deviceUnreadable: both(
    'This device could not be read (refused, gone from the account, or a bad answer).',
    "Cet appareil n'a pas pu être lu (refusé, absent du compte, ou réponse invalide).",
  ),
  deviceOffline: both(
    'Fluidra says this device is not connected: its values may be old.',
    "Fluidra indique que cet appareil n'est pas connecté : ses valeurs peuvent être anciennes.",
  ),
  busy: both(
    'A read of Fluidra is in progress: try again in a minute.',
    'Une lecture de Fluidra est en cours : réessayez dans une minute.',
  ),
  test: {
    cooldown: both(
      'Already read less than 30 seconds ago.',
      'Déjà lu il y a moins de 30 secondes.',
    ),
  },
  denied: {
    noConfig: both(
      'The Fluidra account is not configured.',
      "Le compte Fluidra n'est pas configuré.",
    ),
    commands: both(
      'Commands from Gladys are turned off: allow them in the configuration of the integration.',
      "Les commandes depuis Gladys sont désactivées : autorisez-les dans la configuration de l'intégration.",
    ),
    stopped: both(
      'The Fluidra account is not connected (see the status of the integration): command refused.',
      "Le compte Fluidra n'est pas connecté (voir l'état de l'intégration) : commande refusée.",
    ),
    paused: both(
      'Fluidra asked to slow down: command refused during the pause.',
      'Fluidra a demandé de ralentir : commande refusée pendant la pause.',
    ),
    forbidden: both(
      'Fluidra refuses the requests (HTTP 403): command refused during the pause.',
      'Fluidra refuse les requêtes (HTTP 403) : commande refusée pendant la pause.',
    ),
    session: both(
      'The Fluidra session is being renewed: try again in a few seconds.',
      'La session Fluidra est en cours de renouvellement : réessayez dans quelques secondes.',
    ),
    unknownDevice: both(
      'This device is not (or no longer) in the Fluidra account, or not supported.',
      "Cet appareil n'est pas (ou plus) dans le compte Fluidra, ou n'est pas pris en charge.",
    ),
    badSpeed: both(
      'Unexpected speed: off, low, medium or high.',
      'Vitesse inattendue : arrêt, lente, moyenne ou rapide.',
    ),
    autoSpeed: both(
      'The automatic mode is set in the Fluidra Pool app (its schedule), not from Gladys.',
      "Le mode automatique se règle dans l'application Fluidra Pool (sa programmation), pas depuis Gladys.",
    ),
    pumpAuto: both(
      'The pump runs on its schedule (automatic mode): turn the automatic mode off in the Fluidra Pool app first. Command refused.',
      "La pompe suit sa programmation (mode automatique) : désactivez d'abord le mode automatique dans l'application Fluidra Pool. Commande refusée.",
    ),
    badSetpoint: (min, max, step) =>
      both(
        `Unexpected setpoint: a temperature from ${min} to ${max} °C, by steps of ${step} °C.`,
        `Consigne inattendue : une température de ${min} à ${max} °C, par pas de ${String(step).replace('.', ',')} °C.`,
      ),
    badLight: both(
      'Unexpected value: 0 (off) or 1 (on).',
      'Valeur inattendue : 0 (éteint) ou 1 (allumé).',
    ),
    unreadable: both(
      'The state of the device could not be read again just before acting: command refused.',
      "L'état de l'appareil n'a pas pu être relu juste avant d'agir : commande refusée.",
    ),
    unknown: both(
      'The device did not report the value this command depends on: command refused.',
      "L'appareil n'a pas donné la valeur dont dépend cette commande : commande refusée.",
    ),
    late: both(
      'Fluidra answered too late: command refused before acting (nothing was sent).',
      "Fluidra a répondu trop tard : commande refusée avant d'agir (rien n'a été envoyé).",
    ),
  },
  /** The pump was started, but its speed was not sent (deadline, session, option). */
  speedNotSent: both(
    'The pump was started, but its speed was not sent: choose it again.',
    "La pompe a été démarrée, mais sa vitesse n'a pas été envoyée : choisissez-la à nouveau.",
  ),
  speedStarted: both('The pump was started; its speed:', 'La pompe a été démarrée ; sa vitesse :'),
  maybeSent: (reason) =>
    both(
      `The command was sent, without a confirmation from Fluidra (${reason.en}). Check the state of the device.`,
      `Commande envoyée, sans confirmation de Fluidra (${reason.fr}). Vérifiez l'état de l'appareil.`,
    ),
  commandFailed: (reason) =>
    both(
      `Fluidra refused the command (${reason.en}).`,
      `Fluidra a refusé la commande (${reason.fr}).`,
    ),
};

/** The reason of an error, by kind, in both languages (never an English text in French). */
const REASONS = {
  network: both('network error', 'erreur réseau'),
  timeout: both('no answer in time', 'pas de réponse à temps'),
  unavailable: both('Fluidra unavailable', 'Fluidra indisponible'),
  bad_response: both('unexpected answer', 'réponse inattendue'),
  size: both('answer too large', 'réponse trop grande'),
  not_found: both('not found', 'introuvable'),
  forbidden: both('refused', 'refusé'),
  rate_limited: both('too many requests', 'trop de requêtes'),
  unauthorized: both('session refused', 'session refusée'),
  session_refused: both('session refused', 'session refusée'),
  http: both('request failed', 'requête en échec'),
};

/** `{ en, fr }`: the reason of an error, with its HTTP status when there is one. */
export function reasonOf(err) {
  const reason = REASONS[err?.kind] ?? both('error', 'erreur');
  const status = Number.isInteger(err?.status) ? `, HTTP ${err.status}` : '';
  return both(`${reason.en}${status}`, `${reason.fr}${status}`);
}

// -----------------------------------------------------------------------------
// Constants of the Fluidra cloud and of the integration.
//
// The cloud values are those of foXaCe/Fluidra-pool (MIT, see
// THIRD_PARTY_NOTICES.md), read from the official Fluidra Pool app: the AWS
// Cognito app client of the app (a public client, without a secret) and the
// base URL of the Fluidra EMEA API. They are the app's own public constants,
// not secrets of the user.
// -----------------------------------------------------------------------------

/** The manifest action keys. */
export const ACTIONS = {
  TEST_CONNECTION: 'test_connection',
};

/** AWS Cognito of the Fluidra Pool app (USER_PASSWORD_AUTH; the access token is the bearer). */
export const COGNITO = {
  clientId: 'g3njunelkcbtefosqm9bdhhq1',
  url: 'https://cognito-idp.eu-west-1.amazonaws.com/',
};

/**
 * The Fluidra EMEA API of the app. The User-Agent says who we are: the
 * reference sends the app's own User-Agent, this integration does not
 * pretend to be the app (TODO.md "Decisions").
 */
export const API = {
  url: 'https://api.fluidra-emea.com',
  userAgent: 'gladys-fluidra-pool/0.1',
};

/** Gladys values (server/utils/constants.js of the core). */
export const GLADYS = {
  ON: 1,
  OFF: 0,
};

/** The options of the pump speed select; `auto` is shown, never sent. */
export const PUMP_SPEEDS = ['off', 'low', 'medium', 'high', 'auto'];

/** E30iQ speed levels on component 11 (foXaCe const.py PUMP_SPEED_PERCENTAGES). */
export const PUMP_LEVELS = { low: 0, medium: 1, high: 2 };

/**
 * Heat pump setpoints never above 35 °C from Gladys, whatever the family
 * allows (40 °C on some): a pool, not a hot tub (TODO.md "Decisions").
 */
export const SETPOINT_CEILING = 35;

/** The poll interval of the configuration, in seconds. */
export const POLL_INTERVAL = { default: 60, min: 60, max: 900 };

export const SECOND = 1_000;
export const MINUTE = 60_000;
export const HOUR = 60 * MINUTE;

export const TIMINGS = {
  /** One request of a read, a sign-in step. */
  requestTimeout: 15_000,
  /** The test button and the Discovery scan wait for Gladys; their requests are shorter. */
  quickTimeout: 10_000,
  /**
   * Gladys gives up on a set_value after 5 s and shows a failure: a command
   * not sent 3.5 s after it arrived is refused, never sent after the failure.
   */
  commandDeadline: 3_500,
  /** Every request of a command is sent 3.4 s after the arrival at the latest… */
  commandStartBy: 3_400,
  /** …and answered by 4.6 s after the arrival. */
  commandAnswerBy: 4_600,
  /** The read just before a command: 2.5 s at most (a pump start sends two requests). */
  commandReadTimeout: 2_500,
  /** A command uses the current token when it is valid for 60 s more (else refused, renewed). */
  commandTokenValidity: MINUTE,
  /** The shortest timeout worth a request, inside the command deadline. */
  minRequestTimeout: 300,
  /** The re-reads after a command, to show its effect. */
  followUps: [5_000, 20_000, 60_000],
  /** The renewal timer tries again this long after a failed renewal. */
  renewRetry: MINUTE,
  /** Renew the token this long before it expires. */
  tokenMargin: 5 * MINUTE,
  /** Lifetime assumed when Cognito gives none (its default: 1 h). */
  tokenLifetime: HOUR,
  /** Pauses after failures, never shorter than the poll interval. */
  backoff: [MINUTE, 2 * MINUTE, 5 * MINUTE, 10 * MINUTE, 15 * MINUTE],
  /** After refused credentials: one new sign-in after 1 h, 6 h, then every 24 h. */
  refusedRetry: [HOUR, 6 * HOUR, 24 * HOUR],
  /** 429 (or Cognito TooManyRequests): a pause between 60 s and 6 h, Retry-After when given. */
  rateLimitMin: MINUTE,
  rateLimitMax: 6 * HOUR,
  rateLimitDefault: 5 * MINUTE,
  /** The account endpoint refused a fresh token with 403 (a WAF or CDN block): 30 minutes. */
  forbiddenPause: 30 * MINUTE,
  /** The test button and the Discovery scan read the cloud at most every 30 s. */
  testCooldown: 30_000,
  /** States flushed to Gladys every second; unchanged ones again every 30 min. */
  flushInterval: 1_000,
  stateHeartbeat: 30 * MINUTE,
};

export const LIMITS = {
  /** Gladys accepts 300 states per minute. */
  statesPerMinute: 280,
  statesPerRequest: 100,
  /** The biggest answer read (a device tree or its components: tens of KB). */
  responseBytes: 1024 * 1024,
  /** Pools and devices kept from one answer (a home has a few). */
  pools: 10,
  devices: 50,
  /** Components kept from one bulk answer. */
  components: 600,
  /** Strings kept from the cloud (names, modes). */
  textLength: 120,
  /** Nesting kept in a parsed answer. */
  depth: 12,
};

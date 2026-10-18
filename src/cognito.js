// -----------------------------------------------------------------------------
// The sign-in to the Fluidra account through AWS Cognito, as foXaCe/Fluidra-pool
// does (fluidra_api/_auth.py): USER_PASSWORD_AUTH on the public app client of
// the Fluidra Pool app, then REFRESH_TOKEN_AUTH to renew the tokens without
// the password. The bearer of the Fluidra API is the **access token**. Plain
// JSON calls to the public Cognito endpoint over HTTPS: no AWS signature, and
// the app client has no secret.
// -----------------------------------------------------------------------------

import { COGNITO, TIMINGS } from './constants.js';
import { FluidraError, httpRequest, parseJson, parseRetryAfter } from './http.js';

/** Cognito errors meaning the e-mail, the password or the account itself. */
const REFUSED = new Set([
  'NotAuthorizedException',
  'InvalidPasswordException',
  'PasswordResetRequiredException',
  'UserNotFoundException',
  'UserNotConfirmedException',
]);
const RATE = new Set(['TooManyRequestsException', 'LimitExceededException']);

/** Verification code challenges: never answered here (each sign-in would send a code). */
export const CODE_CHALLENGES = ['SMS_MFA', 'SOFTWARE_TOKEN_MFA', 'EMAIL_OTP', 'SELECT_MFA_TYPE'];

/** The `__type` of a Cognito error answer, without its namespace: a short identifier only. */
export function cognitoCode(json) {
  const raw = json && typeof json === 'object' ? (json.__type ?? json.code) : undefined;
  const code = typeof raw === 'string' ? raw.split('#').pop() : undefined;
  return code && /^[A-Za-z]{1,64}$/.test(code) ? code : undefined;
}

export class CognitoClient {
  constructor({ transport = httpRequest, now = Date.now, url = COGNITO.url } = {}) {
    this.transport = transport;
    this.now = now;
    this.url = url;
    /** Per-request timeout; undefined = TIMINGS.requestTimeout. */
    this.timeout = undefined;
  }

  /**
   * One Cognito call; rejects a FluidraError of the `kind` the caller chose
   * for refusals, marked `source: 'cognito'` (a 429 of Cognito pauses the
   * renewals, one of the Fluidra API does not).
   */
  async call(target, payload, options = {}) {
    try {
      return await this.request(target, payload, options);
    } catch (err) {
      if (err instanceof FluidraError) {
        err.source = 'cognito';
      }
      throw err;
    }
  }

  async request(target, payload, { refusal = 'refused', timeout } = {}) {
    const body = JSON.stringify(payload);
    const answer = await this.transport(this.url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-amz-json-1.1',
        'X-Amz-Target': `AWSCognitoIdentityProviderService.${target}`,
        'Content-Length': Buffer.byteLength(body),
      },
      body,
      timeout: timeout ?? this.timeout ?? TIMINGS.requestTimeout,
    });
    let json;
    try {
      json = parseJson(answer.body);
    } catch (err) {
      if (answer.status >= 200 && answer.status < 300) {
        throw err;
      }
    }
    if (answer.status >= 200 && answer.status < 300) {
      if (!json || typeof json !== 'object' || Array.isArray(json)) {
        throw new FluidraError('bad_response', 'Cognito sent no answer');
      }
      return json;
    }
    const code = cognitoCode(json);
    const status = answer.status;
    if (RATE.has(code) || status === 429) {
      throw new FluidraError('rate_limited', 'too many sign-in requests', {
        status,
        code,
        retryAfter: parseRetryAfter(answer.headers?.['retry-after'], this.now()),
      });
    }
    if (code === 'TooManyFailedAttemptsException') {
      throw new FluidraError('rate_limited', 'too many failed attempts', {
        status,
        code,
        retryAfter: TIMINGS.refusedRetry[0],
      });
    }
    if (REFUSED.has(code)) {
      throw new FluidraError(refusal, 'refused by Cognito', { status, code });
    }
    if (status >= 500 || code === 'InternalErrorException') {
      throw new FluidraError('unavailable', 'Cognito is unavailable', { status, code });
    }
    throw new FluidraError('http', 'Cognito request failed', { status, code });
  }

  /** The tokens of an AuthenticationResult; `previousRefresh`: kept on a refresh. */
  tokensOf(result, previousRefresh) {
    const accessToken = result?.AccessToken;
    if (typeof accessToken !== 'string' || accessToken === '') {
      throw new FluidraError('bad_response', 'Cognito sent no access token');
    }
    const refreshToken =
      typeof result.RefreshToken === 'string' && result.RefreshToken !== ''
        ? result.RefreshToken
        : previousRefresh;
    const seconds = Number(result.ExpiresIn);
    // ExpiresIn counts from now on our own clock (a host clock ahead or behind
    // does not matter); one hour when Cognito gives none.
    const expiresAt =
      Number.isFinite(seconds) && seconds > 0
        ? this.now() + Math.min(seconds, 24 * 3600) * 1000
        : this.now() + TIMINGS.tokenLifetime;
    return { accessToken, refreshToken, expiresAt };
  }

  /** A full sign-in with the password (USER_PASSWORD_AUTH, as the app); resolves the tokens. */
  async signIn(username, password) {
    const answer = await this.call('InitiateAuth', {
      AuthFlow: 'USER_PASSWORD_AUTH',
      ClientId: COGNITO.clientId,
      AuthParameters: { USERNAME: username, PASSWORD: password },
    });
    if (answer.AuthenticationResult) {
      return this.tokensOf(answer.AuthenticationResult);
    }
    return this.unexpectedChallenge(answer.ChallengeName);
  }

  /**
   * Any challenge: a code (`two_factor`), a new password, or another step
   * (`unsupported_challenge`). The app stops on all of them; only
   * `new_password` is tried again by itself (spaced).
   */
  unexpectedChallenge(challengeName) {
    const name = String(challengeName ?? '');
    if (CODE_CHALLENGES.includes(name)) {
      throw new FluidraError('two_factor', 'Cognito asks for a verification code', {
        challenge: name,
      });
    }
    if (name === 'NEW_PASSWORD_REQUIRED') {
      throw new FluidraError('new_password', 'Cognito asks for a new password', {
        challenge: name,
      });
    }
    throw new FluidraError('unsupported_challenge', 'unsupported Cognito challenge', {
      challenge: /^[A-Z_]{1,40}$/.test(name) ? name : undefined,
    });
  }

  /** New tokens from the refresh token, without the password. */
  async refresh(tokens, { timeout } = {}) {
    const answer = await this.call(
      'InitiateAuth',
      {
        AuthFlow: 'REFRESH_TOKEN_AUTH',
        ClientId: COGNITO.clientId,
        AuthParameters: { REFRESH_TOKEN: tokens.refreshToken },
      },
      { refusal: 'refresh_refused', timeout },
    );
    return this.tokensOf(answer.AuthenticationResult, tokens.refreshToken);
  }
}

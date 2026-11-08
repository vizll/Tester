/* Tester — public configuration. Nothing here is secret.
   googleClientId: the OAuth 2.0 *client ID* of a "Web application" client from Google Cloud Console,
   e.g. "1234567890-abcdefg.apps.googleusercontent.com". It enables the optional, read-only Google Calendar
   connection. Leave it empty to keep event sync disabled. The calendar-link option needs no client ID. Never put a
   client secret in this file — the browser-only sign-in Tester uses doesn't need one. See README.md. */
window.TESTER_CONFIG = {
  googleClientId: ''
};

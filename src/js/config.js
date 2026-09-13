/* Austin Area Firewise Alliance — runtime configuration.

   Loaded before site.js. Kept separate so the two things most likely to
   change are one-line edits in a file with nothing else in it. */


/* Contact and sign-up.

   The sign-up form posts to the members API (see docs/07-…); there is no
   longer a mailto fallback. A public contact address for the site's footer
   can be set here once a monitored mailbox exists. */
window.AAFA_CONTACT_EMAIL = null;


/* Board content editing (the /admin/ page and the public news rendering).

   None of these values is a secret. The client id and API address are public
   by nature — the API refuses anything without a valid signed-in token, and
   the token is what is protected. Values come from the aafa-cms stack's
   outputs; see docs/06-cms-design.md. */
window.AAFA_CMS = {
    authDomain: "austinareafirewise-admin.auth.us-east-2.amazoncognito.com",
    clientId: "6hm3jsg16bia9r18fu6utv3o7n",
    apiUrl: "https://dpnvwt7kp5.execute-api.us-east-2.amazonaws.com",
    /* Where the public projection and pictures are served from, relative to
       the site. An Amplify rewrite proxies this prefix to the content bucket. */
    contentBase: "/content"
};

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


/* Text messages are not going out yet.

   The API reports texting as switched on -- the sending side is configured --
   but the number is still in carrier registration, so nothing arrives. That
   gap is why this is a switch of its own rather than a reading of the API:
   the API is describing the software, and this is describing what a person
   will actually receive.

   Set it to false on the day texts start working. Three places follow it:
   the note under "Contact me by" on the sign-up form, the message somebody
   reads after signing up, and the confirmation page. */
window.AAFA_TEXT_COMING_SOON = true;
window.AAFA_TEXT_COMING_SOON_TEXT =
    "At this time only email is available, text will be provided in the near future.";

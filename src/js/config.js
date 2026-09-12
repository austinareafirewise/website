/* Austin Area Firewise Alliance — runtime configuration.

   Loaded before site.js. Kept separate so the two things most likely to
   change are one-line edits in a file with nothing else in it. */


/* The Alliance's public contact address.

   Leave this null until a real mailbox exists. While it is null, the site
   renders no mailto: links at all and the contact form says plainly that
   nothing was stored — better than a published address that bounces on
   somebody trying to ask a wildfire question.

   Set it to a string (e.g. "info@example.org") to turn on the mailto
   fallback and the footer contact line. */
window.AAFA_CONTACT_EMAIL = null;


/* Where the signup / question form posts.

   There is no collection backend yet. When one exists — the planned shape is
   API Gateway -> Lambda -> DynamoDB in the same AWS account as this site, see
   infra/README.md — set this to its HTTPS invoke URL and the form starts
   posting JSON instead of falling back. */

// window.AAFA_SIGNUP_ENDPOINT = "https://xxxxxxxxxx.execute-api.us-east-2.amazonaws.com/prod/signup";


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

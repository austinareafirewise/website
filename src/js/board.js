/* The board roster on board.html.
 *
 * Reads the public board route, which answers with names and offices and
 * nothing else — the email and phone on each record are how the Alliance
 * reaches its own officers and are never published.
 *
 * The page carries its own standing answer in the markup: if the roster
 * cannot be read, the visitor is told where to ask rather than shown an error
 * or, worse, an empty page that reads as "nobody runs this".
 */

(function () {
    "use strict";

    var cfg = window.AAFA_CMS;
    var root = document.getElementById("board-root");
    if (!root || !cfg || !cfg.apiUrl) return;

    /* The order the offices are usually read in. Anything not named here —
       "Event coordinator", "Member at large" — follows, alphabetically by the
       person's name, rather than being dropped or floated to the top. */
    var OFFICES = [
        "president", "chair", "chairman", "chairwoman",
        "vice president", "vice-president", "vice chair", "vice-chair",
        "secretary", "treasurer"
    ];

    function rank(role) {
        var r = String(role || "").trim().toLowerCase();
        for (var i = 0; i < OFFICES.length; i++) if (r === OFFICES[i]) return i;
        return OFFICES.length;
    }

    function el(tag, attrs, kids) {
        var n = document.createElement(tag);
        if (attrs) Object.keys(attrs).forEach(function (k) {
            if (k === "text") n.textContent = attrs[k];
            else n.setAttribute(k, attrs[k]);
        });
        (kids || []).forEach(function (k) { if (k) n.appendChild(k); });
        return n;
    }

    function card(p) {
        return el("li", { class: "board-card" }, [
            el("p", { class: "board-name", text: p.name }),
            p.role ? el("p", { class: "board-role", text: p.role }) : null
        ]);
    }

    function render(board) {
        // Nothing to show is not the same as nothing to say. Leave the
        // standing wording in place rather than replacing it with a blank.
        if (!board.length) return;

        board.sort(function (a, b) {
            var d = rank(a.role) - rank(b.role);
            return d !== 0 ? d : String(a.name).localeCompare(String(b.name));
        });

        root.textContent = "";
        root.appendChild(el("ul", { class: "board-list" }, board.map(card)));
    }

    fetch(cfg.apiUrl.replace(/\/$/, "") + "/board/public", { credentials: "omit" })
        .then(function (r) { return r.ok ? r.json() : null; })
        .then(function (j) { render((j && j.board) || []); })
        .catch(function () { /* the standing wording stays; no error in front of a visitor */ });
})();

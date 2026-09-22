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

    function el(tag, attrs, kids) {
        var n = document.createElement(tag);
        if (attrs) Object.keys(attrs).forEach(function (k) {
            if (k === "text") n.textContent = attrs[k];
            else n.setAttribute(k, attrs[k]);
        });
        (kids || []).forEach(function (k) { if (k) n.appendChild(k); });
        return n;
    }

    /* The stored name is one string. The first word of it is the given name
       for the purpose of this sort; a name that does not work that way sorts
       on the whole string instead, which is at least stable. */
    function firstName(p) {
        return String(p.name || "").trim().split(/\s+/)[0] || "";
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

        // By first name. A roster of volunteers is a list of neighbors rather
        // than a table of organization, and ordering it by office would put
        // the same two people at the top of it every year.
        board.sort(function (a, b) {
            var first = firstName(a).localeCompare(firstName(b), undefined, { sensitivity: "base" });
            return first !== 0 ? first : String(a.name).localeCompare(String(b.name));
        });

        root.textContent = "";
        root.appendChild(el("ul", { class: "board-list" }, board.map(card)));
    }

    fetch(cfg.apiUrl.replace(/\/$/, "") + "/board/public", { credentials: "omit" })
        .then(function (r) { return r.ok ? r.json() : null; })
        .then(function (j) { render((j && j.board) || []); })
        .catch(function () { /* the standing wording stays; no error in front of a visitor */ });
})();

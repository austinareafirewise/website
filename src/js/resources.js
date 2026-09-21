/* Austin Area Firewise Alliance — the Resources page.
 *
 * Reads the board-published file and draws the list. Two kinds of entry, drawn
 * the same way: a link out to another organization, and a file of ours to
 * download. The only visible difference is what the line under the title says
 * — where it goes, or what it is and how big.
 *
 * Nothing on this page waits on anything. If the file cannot be read the page
 * is simply the heading and the sentence under it, with no spinner and no
 * error: a page of links is worth nothing to somebody in a hurry, and an error
 * message in front of a visitor is worse than a short page.
 */

(function () {
    "use strict";

    var cfg = window.AAFA_CMS || {};
    var root = document.getElementById("resources-root");
    if (!root) return;

    var base = String(cfg.contentBase || "/content").replace(/\/$/, "");

    function el(tag, attrs, kids) {
        var n = document.createElement(tag);
        if (attrs) Object.keys(attrs).forEach(function (k) {
            if (attrs[k] == null) return;
            if (k === "text") n.textContent = attrs[k];
            else if (k === "class") n.className = attrs[k];
            else n.setAttribute(k, attrs[k]);
        });
        (kids || []).forEach(function (c) {
            if (c != null) n.appendChild(typeof c === "string" ? document.createTextNode(c) : c);
        });
        return n;
    }

    /* Bytes as a person would say them. Rounded hard on purpose: "2.4 MB" is
       the useful part of 2,517,283, and the digits after it are noise to
       somebody deciding whether to tap it on a phone. */
    function fileSize(bytes) {
        var b = Number(bytes);
        if (!b || b < 0) return "";
        if (b < 1024) return b + " bytes";
        if (b < 1024 * 1024) return Math.round(b / 1024) + " KB";
        var mb = b / (1024 * 1024);
        return (mb < 10 ? mb.toFixed(1) : Math.round(mb)) + " MB";
    }

    /* What to call the file in front of a reader. The media type is how the
       computer names it; this is how a person does. */
    var KINDS = {
        "application/pdf": "PDF",
        "application/msword": "Word document",
        "application/vnd.openxmlformats-officedocument.wordprocessingml.document": "Word document",
        "application/vnd.ms-excel": "Spreadsheet",
        "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet": "Spreadsheet",
        "text/plain": "Text file",
        "text/csv": "Spreadsheet",
        "video/mp4": "Video"
    };

    function fileKind(type, name) {
        if (KINDS[type]) return KINDS[type];
        var ext = String(name || "").split(".").pop().toLowerCase();
        if (ext === "pdf") return "PDF";
        if (ext === "doc" || ext === "docx") return "Word document";
        if (ext === "xls" || ext === "xlsx" || ext === "csv") return "Spreadsheet";
        if (ext === "txt") return "Text file";
        if (ext === "mp4" || ext === "m4v" || ext === "mov") return "Video";
        return "File";
    }

    function hostOf(url) {
        try { return new URL(url).hostname.replace(/^www\./, ""); } catch (e) { return ""; }
    }

    function item(r) {
        var isFile = r.kind === "file";
        var href = isFile ? (base + "/" + String(r.file || "").replace(/^\//, "")) : r.url;
        if (!href) return null;

        // The whole row is the link, so the tap target is the card rather than
        // three words inside it. That matters most on a phone, which is where
        // most of this is read.
        var a = el("a", {
            class: "resource" + (isFile ? " is-file" : " is-link"),
            href: href
        });

        if (isFile) {
            // download tells the browser to save rather than try to display,
            // and names the file the way the board named it.
            if (r.fileName) a.setAttribute("download", r.fileName);
        } else {
            a.setAttribute("target", "_blank");
            a.setAttribute("rel", "noopener");
        }

        a.appendChild(el("h3", { class: "resource-title" }, [
            r.title,
            isFile ? null : el("span", { class: "ext-mark", "aria-hidden": "true" }, [" ↗"])
        ]));

        if (r.description) a.appendChild(el("p", { class: "resource-desc", text: r.description }));

        var meta = [];
        if (isFile) {
            var k = fileKind(r.fileType, r.fileName);
            var s = fileSize(r.fileSize);
            meta.push(s ? k + ", " + s : k);
        } else {
            var h = hostOf(r.url);
            if (h) meta.push(h);
        }
        if (r.dateLabel) meta.push(r.dateLabel);

        if (meta.length) {
            a.appendChild(el("p", { class: "resource-meta" }, [
                el("span", { class: "sr-only", text: isFile ? "Downloads a " : "Opens on another site: " }),
                meta.join(" · ")
            ]));
        }
        return a;
    }

    function render(doc) {
        var cats = (doc && doc.categories) || [];
        var all = (doc && doc.resources) || [];
        if (!all.length) return;

        root.textContent = "";

        cats.forEach(function (c) {
            var mine = all.filter(function (r) { return r.category === c.id; });
            if (!mine.length) return;

            var list = el("div", { class: "resource-list" });
            mine.forEach(function (r) {
                var node = item(r);
                if (node) list.appendChild(node);
            });
            if (!list.childNodes.length) return;

            root.appendChild(el("section", { class: "resource-group" }, [
                el("h2", { text: c.name }),
                c.blurb ? el("p", { class: "resource-group-blurb", text: c.blurb }) : null,
                list
            ]));
        });
    }

    fetch(base + "/resources.json", { credentials: "omit" })
        .then(function (r) { return r.ok ? r.json() : null; })
        .then(render)
        .catch(function () { /* no list, and no error in front of a visitor */ });
})();

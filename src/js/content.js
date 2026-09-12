/* Austin Area Firewise Alliance — board-published content on the public site.
 *
 * Renders three things from one JSON file that board members publish through
 * /admin/: the meeting-notice strip on the home page, the home "News" section
 * of flagged article titles, and the News page (list, or one article).
 *
 * Everything here is built with createElement and textContent. Nothing that
 * came from the database is ever assigned to innerHTML — including Markdown,
 * which goes through the small renderer below that constructs elements
 * directly and shows raw HTML as the literal characters typed. That is the
 * guarantee that a compromised editor account cannot put script on this site.
 *
 * If the content file cannot be loaded, every slot stays hidden and the page
 * is otherwise untouched. There is never an error message in front of a
 * visitor for this.
 *
 * Preview: when the URL carries ?preview=<id> and a board member's token is
 * in sessionStorage (the admin page opens previews in a same-origin iframe,
 * which shares it), the item is fetched from the API and rendered in place,
 * regardless of its status or dates, under a "not live" banner. Visitors have
 * no token, so for them the parameter does nothing.
 */

(function () {
    "use strict";

    var cfg = window.AAFA_CMS;
    if (!cfg || !cfg.contentBase) {
        return;
    }

    var page = document.body.getAttribute("data-page") || "";
    var params = new URLSearchParams(window.location.search);
    var previewId = params.get("preview");
    var articleId = params.get("id");

    /* ------------------------------------------------------------ */
    /* DOM helpers                                                   */
    /* ------------------------------------------------------------ */

    function el(tag, attrs, children) {
        var node = document.createElement(tag);
        if (attrs) {
            Object.keys(attrs).forEach(function (k) {
                if (attrs[k] == null) return;
                if (k === "text") node.textContent = attrs[k];
                else if (k === "class") node.className = attrs[k];
                else node.setAttribute(k, attrs[k]);
            });
        }
        (children || []).forEach(function (c) {
            if (c == null) return;
            node.appendChild(typeof c === "string" ? document.createTextNode(c) : c);
        });
        return node;
    }

    function imageUrl(key) {
        return cfg.contentBase.replace(/\/$/, "") + "/" + key;
    }

    function fmtDate(iso, withTime) {
        var d = new Date(iso);
        if (isNaN(d.getTime())) return "";
        var opts = withTime
            ? { dateStyle: "medium", timeStyle: "short", timeZone: "America/Chicago" }
            : { dateStyle: "medium", timeZone: "America/Chicago" };
        try { return new Intl.DateTimeFormat("en-US", opts).format(d); } catch (e) { return d.toLocaleString(); }
    }

    function isLive(item, now) {
        var s = Date.parse(item.startsAt), e = Date.parse(item.endsAt);
        return !isNaN(s) && !isNaN(e) && s <= now && now < e;
    }

    /* ------------------------------------------------------------ */
    /* Body rendering: plain text, or the restricted Markdown subset */
    /* ------------------------------------------------------------ */

    function renderPlain(text) {
        var frag = document.createDocumentFragment();
        String(text || "").split(/\n\s*\n/).forEach(function (para) {
            var p = para.trim();
            if (p) frag.appendChild(el("p", { text: p }));
        });
        return frag;
    }

    /* Inline: **bold**, *italic*, [label](https://…). Anything else is text.
       Works by scanning for the next marker and emitting a text node for the
       run before it, so an unmatched marker is simply literal. */
    function renderInline(text) {
        var frag = document.createDocumentFragment();
        var re = /\*\*([^*]+)\*\*|\*([^*]+)\*|\[([^\]]+)\]\((https:\/\/[^\s)]+)\)/g;
        var last = 0, m;
        while ((m = re.exec(text)) !== null) {
            if (m.index > last) frag.appendChild(document.createTextNode(text.slice(last, m.index)));
            if (m[1] != null) frag.appendChild(el("strong", { text: m[1] }));
            else if (m[2] != null) frag.appendChild(el("em", { text: m[2] }));
            else frag.appendChild(el("a", { href: m[4], rel: "noopener", class: "ext", text: m[3] }));
            last = re.lastIndex;
        }
        if (last < text.length) frag.appendChild(document.createTextNode(text.slice(last)));
        return frag;
    }

    /* Blocks: ## / ### headings, - or * bullets, 1. numbered, > quotes,
       blank-line paragraphs. Headings are demoted so an article never
       contains an h1 — the page already has one. */
    function renderMarkdown(text) {
        var frag = document.createDocumentFragment();
        var lines = String(text || "").replace(/\r\n?/g, "\n").split("\n");
        var i = 0;

        function flushPara(buf) {
            var joined = buf.join(" ").trim();
            if (joined) { var p = el("p"); p.appendChild(renderInline(joined)); frag.appendChild(p); }
        }

        while (i < lines.length) {
            var line = lines[i];
            var h = /^(#{2,3})\s+(.*)$/.exec(line);
            if (h) {
                var tag = h[1].length === 2 ? "h2" : "h3";
                var hn = el(tag); hn.appendChild(renderInline(h[2].trim())); frag.appendChild(hn);
                i++; continue;
            }
            if (/^\s*[-*]\s+/.test(line)) {
                var ul = el("ul");
                while (i < lines.length && /^\s*[-*]\s+/.test(lines[i])) {
                    var li = el("li"); li.appendChild(renderInline(lines[i].replace(/^\s*[-*]\s+/, ""))); ul.appendChild(li); i++;
                }
                frag.appendChild(ul); continue;
            }
            if (/^\s*\d+[.)]\s+/.test(line)) {
                var ol = el("ol");
                while (i < lines.length && /^\s*\d+[.)]\s+/.test(lines[i])) {
                    var oli = el("li"); oli.appendChild(renderInline(lines[i].replace(/^\s*\d+[.)]\s+/, ""))); ol.appendChild(oli); i++;
                }
                frag.appendChild(ol); continue;
            }
            if (/^\s*>\s?/.test(line)) {
                var q = el("blockquote"), qbuf = [];
                while (i < lines.length && /^\s*>\s?/.test(lines[i])) { qbuf.push(lines[i].replace(/^\s*>\s?/, "")); i++; }
                var qp = el("p"); qp.appendChild(renderInline(qbuf.join(" ").trim())); q.appendChild(qp);
                frag.appendChild(q); continue;
            }
            if (line.trim() === "") { i++; continue; }
            var buf = [];
            while (i < lines.length && lines[i].trim() !== "" &&
                   !/^(#{2,3})\s+/.test(lines[i]) && !/^\s*[-*]\s+/.test(lines[i]) &&
                   !/^\s*\d+[.)]\s+/.test(lines[i]) && !/^\s*>\s?/.test(lines[i])) {
                buf.push(lines[i]); i++;
            }
            flushPara(buf);
        }
        return frag;
    }

    function renderBody(item) {
        return item.bodyFormat === "markdown" ? renderMarkdown(item.body) : renderPlain(item.body);
    }

    /* First paragraph as plain text, for list excerpts. Strips the handful of
       Markdown markers so the excerpt does not show asterisks. */
    function excerpt(item) {
        var first = String(item.body || "").split(/\n\s*\n/)[0] || "";
        first = first.replace(/^#{2,3}\s+/, "").replace(/\*\*([^*]+)\*\*/g, "$1").replace(/\*([^*]+)\*/g, "$1")
                     .replace(/\[([^\]]+)\]\(https:\/\/[^\s)]+\)/g, "$1").replace(/^\s*[-*>]\s?/gm, "").replace(/\s+/g, " ").trim();
        return first.length > 220 ? first.slice(0, 217).replace(/\s+\S*$/, "") + "…" : first;
    }

    function linkButton(item) {
        if (!item.link) return null;
        return el("p", { class: "content-link" }, [
            el("a", { class: "btn btn-outline ext", href: item.link, rel: "noopener", text: item.linkText || "More information" })
        ]);
    }

    function figure(pic, thumb) {
        var img = el("img", {
            src: imageUrl(thumb ? pic.thumbKey : pic.key),
            alt: pic.alt || "",
            loading: "lazy",
            width: thumb ? 480 : pic.width,
            height: thumb ? Math.round(480 * (pic.height / pic.width)) : pic.height
        });
        var fig = el("figure", { class: thumb ? "news-thumb" : "news-figure" }, [img]);
        if (!thumb && pic.credit) fig.appendChild(el("figcaption", { text: pic.credit }));
        return fig;
    }

    /* ------------------------------------------------------------ */
    /* Slots                                                         */
    /* ------------------------------------------------------------ */

    function renderNotices(notices) {
        var slot = document.getElementById("notice-slot");
        if (!slot) return;
        slot.textContent = "";
        if (!notices.length) { slot.hidden = true; return; }
        notices.forEach(function (n) {
            var art = el("article", { class: "notice" }, [
                el("p", { class: "notice-kicker", text: "Meeting notice" }),
                el("h2", { text: n.title }),
                el("p", { class: "notice-when", text: fmtDate(n.startsAt, true) })
            ]);
            art.appendChild(renderBody(n));
            var lb = linkButton(n); if (lb) art.appendChild(lb);
            slot.appendChild(el("div", { class: "wrap" }, [art]));
        });
        slot.hidden = false;
    }

    function renderHomeNews(news) {
        var slot = document.getElementById("home-news");
        if (!slot) return;
        var list = slot.querySelector("ul");
        if (!list) return;
        list.textContent = "";
        var flagged = news.filter(function (n) { return n.showOnHome; });
        if (!flagged.length) { slot.hidden = true; return; }
        flagged.forEach(function (n) {
            list.appendChild(el("li", null, [
                el("a", { href: "news.html?id=" + encodeURIComponent(n.id), text: n.title })
            ]));
        });
        slot.hidden = false;
    }

    function renderNewsPage(news) {
        var root = document.getElementById("news-root");
        if (!root) return;
        root.textContent = "";

        if (articleId || previewId) {
            var id = articleId || previewId;
            var item = news.filter(function (n) { return n.id === id; })[0];
            if (!item) {
                root.appendChild(el("p", { class: "news-empty", text: "That article is no longer available." }));
                root.appendChild(el("p", null, [el("a", { href: "news.html", text: "All news" })]));
                return;
            }
            var art = el("article", { class: "news-article" }, [
                el("p", { class: "kicker", text: fmtDate(item.startsAt) }),
                el("h1", { text: item.title })
            ]);
            (item.pictures || []).forEach(function (p) { art.appendChild(figure(p, false)); });
            var body = el("div", { class: "news-body" }); body.appendChild(renderBody(item)); art.appendChild(body);
            var lb = linkButton(item); if (lb) art.appendChild(lb);
            root.appendChild(art);
            root.appendChild(el("p", { class: "news-back" }, [el("a", { href: "news.html", text: "← All news" })]));
            return;
        }

        if (!news.length) {
            root.appendChild(el("p", { class: "news-empty", text: "No news at the moment. Check back soon." }));
            return;
        }
        var list = el("div", { class: "news-list" });
        news.forEach(function (n) {
            var href = "news.html?id=" + encodeURIComponent(n.id);
            var card = el("article", { class: "news-card" });
            if (n.pictures && n.pictures.length) {
                card.appendChild(el("a", { href: href, class: "news-thumb-link", "aria-hidden": "true", tabindex: "-1" }, [figure(n.pictures[0], true)]));
            }
            var text = el("div", { class: "news-card-text" }, [
                el("p", { class: "kicker", text: fmtDate(n.startsAt) }),
                el("h2", null, [el("a", { href: href, text: n.title })]),
                el("p", { text: excerpt(n) })
            ]);
            card.appendChild(text);
            list.appendChild(card);
        });
        root.appendChild(list);
    }

    function previewBanner(item) {
        var b = el("div", { class: "preview-banner", role: "status" }, [
            el("strong", { text: "PREVIEW — not live. " }),
            item.status === "published"
                ? "This is how the published item looks. Visitors see it only between its start and stop dates."
                : "This is a draft. Visitors cannot see it until it is published."
        ]);
        document.body.insertBefore(b, document.body.firstChild);
    }

    /* ------------------------------------------------------------ */
    /* Load                                                          */
    /* ------------------------------------------------------------ */

    function fetchPublished() {
        return fetch(cfg.contentBase.replace(/\/$/, "") + "/content.json", { credentials: "omit" })
            .then(function (r) { return r.ok ? r.json() : null; })
            .catch(function () { return null; });
    }

    function fetchPreview(id) {
        var token = null;
        try { token = sessionStorage.getItem("aafa.idToken"); } catch (e) { token = null; }
        if (!token || !cfg.apiUrl) return Promise.resolve(null);
        return fetch(cfg.apiUrl.replace(/\/$/, "") + "/items/" + encodeURIComponent(id), {
            headers: { Authorization: "Bearer " + token }
        }).then(function (r) { return r.ok ? r.json() : null; })
          .then(function (j) { return j && j.item ? j.item : null; })
          .catch(function () { return null; });
    }

    Promise.all([fetchPublished(), previewId ? fetchPreview(previewId) : null]).then(function (res) {
        var doc = res[0] || { notices: [], news: [] };
        var preview = res[1];
        var now = Date.now();

        var notices = (doc.notices || []).filter(function (n) { return isLive(n, now); });
        var news = (doc.news || []).filter(function (n) { return isLive(n, now); });

        if (preview) {
            // Show the previewed item regardless of status or dates, replacing
            // any published copy of itself so it appears exactly once.
            var bucket = preview.kind === "notice" ? notices : news;
            for (var i = bucket.length - 1; i >= 0; i--) if (bucket[i].id === preview.id) bucket.splice(i, 1);
            bucket.unshift(preview);
            previewBanner(preview);
        }

        // Newest first: ids are time-prefixed.
        var byNewest = function (a, b) { return a.id < b.id ? 1 : -1; };
        notices.sort(byNewest); news.sort(byNewest);

        if (page === "home") {
            renderNotices(notices);
            renderHomeNews(news);
        } else if (page === "news") {
            renderNewsPage(news);
        }
    });
})();

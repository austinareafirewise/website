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
            else frag.appendChild(el("a", { href: m[4], target: "_blank", rel: "noopener", class: "ext", text: m[3] }));
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

    /* Board-published outbound links open in a new tab, so a visitor who
       follows one to a registration page or an agency notice still has the
       site behind them. rel="noopener" is not optional with target="_blank":
       without it the opened page gets a handle on this window and can
       navigate it somewhere else.

       Opening a new tab unannounced is a WCAG 3.2.2 concern, so the link
       says so — visually through the .ext arrow, and to a screen reader
       through the appended hidden text. */
    function linkButton(item) {
        if (!item.link) return null;
        var a = el("a", {
            class: "btn btn-outline ext", href: item.link,
            target: "_blank", rel: "noopener",
            text: item.linkText || "More information"
        });
        /* The "(opens in a new tab)" note is added by site.js, which does it
           for every target="_blank" link on the page including these. */
        return el("p", { class: "content-link" }, [a]);
    }

    function figure(pic, thumb, override) {
        var img = el("img", {
            src: imageUrl(thumb ? pic.thumbKey : pic.key),
            alt: pic.alt || "",
            loading: "lazy",
            width: thumb ? 480 : pic.width,
            height: thumb ? Math.round(480 * (pic.height / pic.width)) : pic.height
        });
        var layout = pic.layout === "right" || pic.layout === "left" ? pic.layout : "full";
        var cls = override || (thumb ? "news-thumb" : "news-figure news-figure-" + layout);
        var fig = el("figure", { class: cls }, [img]);
        if (!thumb && pic.credit) fig.appendChild(el("figcaption", { text: pic.credit }));
        return fig;
    }

    /* Pictures go into the text, not on top of it.
     *
     * One rule, so an editor can predict the result without learning a layout
     * tool: pictures are placed in the order they were added, the first above
     * the first paragraph and each next one two paragraphs further down. A
     * "full" picture is a band across the column; a "right" or "left" one is
     * about a third of the width with the paragraphs flowing round it, which
     * is why it has to sit immediately before the text it wraps into.
     *
     * An article with more pictures than paragraphs puts the leftovers at the
     * end rather than stacking them all at the top. */
    function placePictures(body, pics) {
        var blocks = [];
        for (var n = body.firstChild; n; n = n.nextSibling) if (n.nodeType === 1) blocks.push(n);
        (pics || []).forEach(function (pic, i) {
            var fig = figure(pic, false);
            var before = blocks[i * 2];
            if (before) body.insertBefore(fig, before);
            else body.appendChild(fig);
        });
    }

    /* ------------------------------------------------------------ */
    /* Slots                                                         */
    /* ------------------------------------------------------------ */

    /* What a notice is about. The board picks the kind; the site picks the
       color. The label is always shown, so the color is never the only
       thing carrying the meaning. */
    var TONES = {
        meeting: "Meeting notice",
        event: "Event",
        urgent: "Please read",
        recognition: "Good news"
    };

    /* When the thing itself happens. eventStart is the real answer; startsAt is
       only when the notice began appearing, and it is used here just so a
       notice written before there were separate fields still shows something
       rather than nothing. A same-day end time is shown as a range. */
    function whenText(n) {
        var start = n.eventStart || n.startsAt;
        if (!start) return "";
        var text = fmtDate(start, true);
        if (!text) return "";
        if (n.eventStart && n.eventEnd) {
            var a = new Date(n.eventStart), b = new Date(n.eventEnd);
            if (!isNaN(b.getTime())) {
                var sameDay = a.toDateString() === b.toDateString();
                var opts = { timeStyle: "short", timeZone: "America/Chicago" };
                try {
                    text += sameDay
                        ? " – " + new Intl.DateTimeFormat("en-US", opts).format(b)
                        : " – " + fmtDate(n.eventEnd, true);
                } catch (e) { /* leave the start alone */ }
            }
        }
        return text;
    }

    /* The hero's own words, and a picture beside them if the board has added
       one. Everything here is optional: a home page with nothing published
       keeps exactly what is written into index.html, so the page never depends
       on this file having loaded. */
    function renderHome(home) {
        if (!home) return;

        // The small line above the headline. An editor who clears it means
        // the line to go, not to be left standing empty.
        var kicker = document.querySelector(".hero .kicker");
        if (kicker && typeof home.kicker === "string") {
            kicker.textContent = home.kicker;
            kicker.hidden = !home.kicker;
        }

        var h1 = document.querySelector(".hero h1");
        if (h1 && home.headline) {
            h1.textContent = "";
            String(home.headline).split(/\n/).forEach(function (line, i) {
                if (i) h1.appendChild(el("br"));
                h1.appendChild(document.createTextNode(line));
            });
        }

        var lede = document.querySelector(".hero .lede");
        if (lede && home.lede) lede.textContent = home.lede;

        var wrap = document.querySelector(".hero .wrap");
        if (!wrap) return;

        var pic = (home.pictures || [])[0];
        if (pic) {
            wrap.classList.add("hero-with-picture");
            wrap.insertBefore(figure(pic, false, "hero-figure"), wrap.firstChild);
            return;
        }
        // No picture: today's fire danger goes there instead, unless the
        // board has turned it off. A picture the board chose always wins --
        // it is the one thing in the banner somebody decided on purpose.
        if (home.showFireDanger !== false) loadFireDanger(wrap);
    }

    /* ------------------------------------------------------------ */
    /* Today's fire danger, in the banner                            */
    /* ------------------------------------------------------------ */

    /* A day and a half. The rating is for a named day, and one that old is
       yesterday's danger -- which is worse than no sign at all, because a
       sign is read as today. Longer than the burn ban's six hours because
       this is published once a day, not continuously. */
    var FIRE_DANGER_MAX_AGE_MS = 36 * 60 * 60 * 1000;

    var FIRE_DANGER_STATES = {
        "low": 1, "moderate": 1, "high": 1, "very-high": 1, "extreme": 1
    };

    function loadFireDanger(wrap) {
        fetch(cfg.contentBase.replace(/\/$/, "") + "/firedanger.json", { credentials: "omit" })
            .then(function (r) { return r.ok ? r.json() : null; })
            .then(function (status) { renderFireDanger(wrap, status); })
            .catch(function () { /* no sign, and no error in front of a visitor */ });
    }

    function renderFireDanger(wrap, status) {
        if (!status || !FIRE_DANGER_STATES[status.state]) return;
        var checked = Date.parse(status.checkedAt);
        if (isNaN(checked) || Date.now() - checked > FIRE_DANGER_MAX_AGE_MS) return;
        // The banner may have gained a picture between the page loading and
        // this answering. The picture wins.
        if (wrap.querySelector(".hero-figure")) return;

        var img = el("img", {
            src: "img/fire-danger-" + status.state + ".svg",
            // The credit lives here rather than under the sign: it belongs to
            // the rating, and a line of small print under a road sign is the
            // first thing a reader's eye throws away.
            alt: "Today's fire danger: " + (status.label || status.state) +
                 ". Rating from " + (status.credit || "Texas A&M Forest Service") + ".",
            width: "900", height: "800"
        });
        var link = el("a", {
            class: "fire-danger-link",
            href: status.source || "https://twc.tamu.edu/tfd",
            target: "_blank",
            rel: "noopener"
        });
        link.appendChild(img);

        var fig = el("figure", { class: "hero-figure fire-danger" });
        fig.appendChild(link);
        wrap.classList.add("hero-with-picture");
        wrap.insertBefore(fig, wrap.firstChild);
    }

    function renderNotices(notices) {
        var slot = document.getElementById("notice-slot");
        if (!slot) return;
        slot.textContent = "";
        if (!notices.length) { slot.hidden = true; return; }
        notices.forEach(function (n) {
            var tone = TONES[n.tone] ? n.tone : "meeting";
            var art = el("article", { class: "notice notice-" + tone }, [
                el("p", { class: "notice-kicker", text: TONES[tone] }),
                el("h2", { text: n.title }),
                el("p", { class: "notice-when", text: whenText(n) })
            ]);
            // One picture, small and to the side. A notice sits above the
            // headline and the burn ban; a big image here pushes the page down.
            var pic = (n.pictures || [])[0];
            if (pic) art.appendChild(figure(pic, true, "notice-figure"));
            art.appendChild(renderBody(n));
            var lb = linkButton(n); if (lb) art.appendChild(lb);
            slot.appendChild(el("div", { class: "wrap" }, [art]));
        });
        slot.hidden = false;
    }

    /* A stable accent color per article, derived from its id rather than
       drawn at random: an article people recognize by its green stripe should
       not be blue after a refresh. Borders only, so there is no contrast
       floor to clear and nothing for an editor to get wrong. */
    var ACCENTS = 5;
    function accentOf(id) {
        var h = 0, str = String(id || "");
        for (var i = 0; i < str.length; i++) h = (h * 31 + str.charCodeAt(i)) % 100000;
        return h % ACCENTS;
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
            list.appendChild(el("li", { class: "accent-" + accentOf(n.id) }, [
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
            var flow = renderBody(item);
            placePictures(flow, item.pictures);
            var body = el("div", { class: "news-body" }); body.appendChild(flow); art.appendChild(body);
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
            var hasThumb = !!(n.pictures && n.pictures.length);
            // The card is two columns only when there is a picture to put in
            // the first one. Said in the markup rather than left to CSS to
            // work out, so the layout does not depend on :has().
            var card = el("article", {
                class: "news-card accent-" + accentOf(n.id) + (hasThumb ? " has-thumb" : "")
            });
            if (hasThumb) {
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
    /* Travis County burn ban                                        */
    /*                                                               */
    /* A scheduled function reads the county's page and writes        */
    /* burnban.json beside the published content, so this page never  */
    /* waits on -- or even talks to -- traviscountytx.gov. The fetch  */
    /* below is on its own: if the file is missing, stale or          */
    /* unreadable the slot stays hidden and nothing else on the page  */
    /* is affected.                                                   */
    /*                                                               */
    /* Stale is treated as unknown. "No burn ban" left up after the   */
    /* checker stopped running is the one wrong answer that could get */
    /* somebody to light a fire, so six hours without a fresh reading */
    /* and the notice comes down.                                     */
    /* ------------------------------------------------------------ */

    var BURN_BAN_MAX_AGE_MS = 6 * 60 * 60 * 1000;

    /* Rewrites the conditions bar with what the county actually says. The bar
       already carries standing guidance that is true whatever the county has
       done, so there is nothing to reveal and nothing to hide: either this
       replaces the words with something more specific, or they stay as they
       were. A stale or unreadable reading leaves the fallback in place, which
       is the whole reason that wording exists. */
    function renderBurnBan(status) {
        var bar = document.getElementById("conditions");
        var label = document.getElementById("conditions-label");
        var text = document.getElementById("conditions-text");
        if (!bar || !label || !text || !status) return;
        if (status.state !== "ban" && status.state !== "none") return;

        var checked = Date.parse(status.checkedAt);
        if (isNaN(checked) || Date.now() - checked > BURN_BAN_MAX_AGE_MS) return;

        var ban = status.state === "ban";
        bar.className = "conditions " + (ban ? "is-ban" : "is-clear");
        label.textContent = ban ? "Burn ban in effect" : "No burn ban";

        // One line. This bar sits above everything on every page, so it says
        // the one thing that has to be read from across the room and keeps
        // the county's own wording and the reading time within reach.
        var detail = [status.detail || "", "Checked " + fmtDate(status.checkedAt, true) + "."]
            .filter(Boolean).join(" ");

        text.textContent = "";
        var link = el("a", {
            href: status.source, class: "ext", target: "_blank", rel: "noopener",
            text: "Travis County's burn ban page"
        });
        text.appendChild(link);

        // The detail hangs off the bar as a tooltip, and is also read out --
        // a title attribute alone is a mouse-only fact, and somebody on a
        // phone or a screen reader would simply never get it.
        bar.title = detail;
        text.appendChild(el("span", { class: "sr-only", text: " " + detail }));
    }

    function loadBurnBan() {
        fetch(cfg.contentBase.replace(/\/$/, "") + "/burnban.json", { credentials: "omit" })
            .then(function (r) { return r.ok ? r.json() : null; })
            .then(renderBurnBan)
            .catch(function () { /* no notice, no error in front of a visitor */ });
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
            renderHome(doc.home);
            renderNotices(notices);
            renderHomeNews(news);
        } else if (page === "news") {
            renderNewsPage(news);
        }
    });

    // Deliberately not part of the Promise.all above: the burn ban notice
    // appears when it appears, and never holds up the board's content.
    if (page === "home") loadBurnBan();
})();

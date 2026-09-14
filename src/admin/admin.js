/* Austin Area Firewise Alliance — the board's editing page.
 *
 * Plain JavaScript, no libraries. Four parts:
 *
 *   1. Sign-in. Cognito's hosted page does the password; this code only does
 *      the authorization-code + PKCE dance around it and keeps the tokens in
 *      sessionStorage, which the browser clears when the tab closes.
 *   2. The list and the form. One item at a time, big buttons, plain words.
 *   3. Pictures. Cropped here in the browser to a fixed 3:2 frame and encoded
 *      as JPEG at two sizes, then PUT straight to S3 with a signed URL the API
 *      hands out. Re-encoding through a canvas also strips camera metadata,
 *      including GPS.
 *   4. Preview. The real home or News page in an iframe with ?preview=<id>;
 *      the iframe shares this tab's sessionStorage, so js/content.js there can
 *      fetch the draft with the same token.
 *
 * Every message shown to the editor is written for someone who does not use
 * computers much. Every failure says what to do next.
 */

(function () {
    "use strict";

    var cfg = window.AAFA_CMS;
    var $ = function (id) { return document.getElementById(id); };

    var KEYS = { id: "aafa.idToken", refresh: "aafa.refreshToken", exp: "aafa.tokenExp", email: "aafa.email", verifier: "aafa.pkce", state: "aafa.state" };
    var LIMITS = { title: 120, body: 6000, linkText: 60, credit: 120, alt: 200, pictures: 3, fileBytes: 10 * 1024 * 1024 };
    var CROP_RATIO = 3 / 2;

    var items = [];
    var current = null;   // the item being edited, as last saved
    var dirty = false;

    /* ============================================================ */
    /* 1. Sign-in                                                    */
    /* ============================================================ */

    function ss(key, val) {
        try {
            if (val === undefined) return sessionStorage.getItem(key);
            if (val === null) sessionStorage.removeItem(key); else sessionStorage.setItem(key, val);
        } catch (e) { return null; }
    }

    function b64url(bytes) {
        var s = "";
        for (var i = 0; i < bytes.length; i++) s += String.fromCharCode(bytes[i]);
        return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
    }

    function randomString(len) {
        var a = new Uint8Array(len); crypto.getRandomValues(a);
        return b64url(a);
    }

    function redirectUri() {
        return window.location.origin + window.location.pathname.replace(/index\.html$/, "");
    }

    function signIn() {
        var verifier = randomString(48), state = randomString(16);
        ss(KEYS.verifier, verifier); ss(KEYS.state, state);
        crypto.subtle.digest("SHA-256", new TextEncoder().encode(verifier)).then(function (buf) {
            var challenge = b64url(new Uint8Array(buf));
            var url = "https://" + cfg.authDomain + "/oauth2/authorize?" + new URLSearchParams({
                client_id: cfg.clientId, response_type: "code", scope: "openid email profile",
                redirect_uri: redirectUri(), code_challenge_method: "S256", code_challenge: challenge, state: state
            }).toString();
            window.location.assign(url);
        });
    }

    function signOut() {
        [KEYS.id, KEYS.refresh, KEYS.exp, KEYS.email].forEach(function (k) { ss(k, null); });
        window.location.assign("https://" + cfg.authDomain + "/logout?" + new URLSearchParams({
            client_id: cfg.clientId, logout_uri: redirectUri()
        }).toString());
    }

    function tokenRequest(params) {
        return fetch("https://" + cfg.authDomain + "/oauth2/token", {
            method: "POST",
            headers: { "Content-Type": "application/x-www-form-urlencoded" },
            body: new URLSearchParams(Object.assign({ client_id: cfg.clientId }, params)).toString()
        }).then(function (r) { return r.json().then(function (j) { if (!r.ok) throw new Error(j.error || "token"); return j; }); });
    }

    function storeTokens(j) {
        ss(KEYS.id, j.id_token);
        if (j.refresh_token) ss(KEYS.refresh, j.refresh_token);
        ss(KEYS.exp, String(Date.now() + (j.expires_in || 3600) * 1000 - 60000));
        try {
            var claims = JSON.parse(atob(j.id_token.split(".")[1].replace(/-/g, "+").replace(/_/g, "/")));
            ss(KEYS.email, claims.email || "");
        } catch (e) { /* no email claim; the API still works */ }
    }

    /* On load: finish a sign-in if we were sent back with a code, otherwise
       use what is stored, refreshing if it has expired. */
    function establishSession() {
        var q = new URLSearchParams(window.location.search);
        if (q.get("code")) {
            var okState = q.get("state") === ss(KEYS.state);
            var verifier = ss(KEYS.verifier);
            history.replaceState(null, "", window.location.pathname);
            if (!okState || !verifier) return Promise.resolve(false);
            return tokenRequest({ grant_type: "authorization_code", code: q.get("code"), redirect_uri: redirectUri(), code_verifier: verifier })
                .then(function (j) { storeTokens(j); return true; })
                .catch(function () { return false; });
        }
        if (q.get("error")) { history.replaceState(null, "", window.location.pathname); return Promise.resolve(false); }

        var id = ss(KEYS.id), exp = Number(ss(KEYS.exp) || 0);
        if (id && Date.now() < exp) return Promise.resolve(true);
        var refresh = ss(KEYS.refresh);
        if (!refresh) return Promise.resolve(false);
        return tokenRequest({ grant_type: "refresh_token", refresh_token: refresh })
            .then(function (j) { storeTokens(j); return true; })
            .catch(function () { return false; });
    }

    /* ============================================================ */
    /* API                                                           */
    /* ============================================================ */

    function api(method, path, body) {
        return fetch(cfg.apiUrl.replace(/\/$/, "") + path, {
            method: method,
            headers: Object.assign({ Authorization: "Bearer " + ss(KEYS.id) }, body ? { "Content-Type": "application/json" } : {}),
            body: body ? JSON.stringify(body) : undefined
        }).then(function (r) {
            if (r.status === 401) { throw new ApiError("Your sign-in has expired. Sign in again and try once more.", 401); }
            return r.json().catch(function () { return {}; }).then(function (j) {
                if (!r.ok) throw new ApiError(j.error || "Something went wrong. Nothing was changed.", r.status);
                return j;
            });
        });
    }
    function ApiError(message, status) { this.message = message; this.status = status; }

    /* ============================================================ */
    /* Screens                                                       */
    /* ============================================================ */

    var screens = ["screen-signin", "screen-denied", "screen-list", "screen-edit"];
    function show(id) {
        screens.forEach(function (s) { $(s).hidden = s !== id; });
        // The signed-out and denied screens live outside the section wrapper,
        // so the wrapper follows whichever of them is showing.
        var inContent = id === "screen-list" || id === "screen-edit";
        if ($("section-content")) $("section-content").hidden = !inContent;
        window.scrollTo(0, 0);
    }
    window.AAFA_ADMIN = window.AAFA_ADMIN || {};
    window.AAFA_ADMIN.showContent = function () { show("screen-list"); };

    /* Confirmation that something has already happened.
       Focus moves to OK so a keyboard user can dismiss it without hunting,
       and returns to wherever it came from afterwards. Escape closes it,
       because a dialog reporting success should never be able to trap
       anyone. */
    var noticeReturn = null;
    function notify(title, text) {
        noticeReturn = document.activeElement;
        $("notice-title").textContent = title;
        $("notice-text").textContent = text;
        $("notice-modal").hidden = false;
        $("notice-ok").focus();
    }
    function closeNotice() {
        $("notice-modal").hidden = true;
        if (noticeReturn && noticeReturn.focus) { try { noticeReturn.focus(); } catch (e) { /* gone from the DOM */ } }
        noticeReturn = null;
    }
    window.AAFA_ADMIN.notify = notify;
    document.addEventListener("keydown", function (e) {
        if (e.key === "Escape" && !$("notice-modal").hidden) closeNotice();
    });

    /* ============================================================ */
    /* Help                                                          */
    /*                                                               */
    /* One dialog, and a small popover for the Markdown pill. Both    */
    /* copy their text out of #help-source, so the help is markup an  */
    /* editor can read and change rather than strings in here.        */
    /* ============================================================ */

    function helpBlock(topic) {
        return document.querySelector('#help-source [data-help="' + topic + '"]');
    }

    /* The topic buttons, built from whatever is in #help-source. Adding a
       topic to the markup is enough; nothing here needs to know about it. */
    function renderHelpTopics(current) {
        var row = $("help-topics");
        row.textContent = "";
        Array.prototype.forEach.call(document.querySelectorAll("#help-source [data-help]"), function (sec) {
            var topic = sec.getAttribute("data-help");
            var b = node("button", {
                type: "button",
                class: "help-topic" + (topic === current ? " on" : ""),
                text: sec.getAttribute("data-title") || topic
            });
            if (topic === current) b.setAttribute("aria-current", "true");
            b.addEventListener("click", function () { showHelp(topic); });
            row.appendChild(b);
        });
    }

    function showHelp(topic) {
        var src = helpBlock(topic);
        if (!src) return;
        $("help-title").textContent = src.getAttribute("data-title") || "Help";
        renderHelpTopics(topic);
        var body = $("help-body");
        body.textContent = "";
        body.appendChild(src.cloneNode(true));
        body.scrollTop = 0;
    }

    var helpReturn = null;
    function openHelp(topic) {
        if (!helpBlock(topic)) return;
        helpReturn = document.activeElement;
        showHelp(topic);
        $("help-modal").hidden = false;
        $("help-close").focus();
    }

    function closeHelp() {
        $("help-modal").hidden = true;
        $("help-body").textContent = "";
        $("help-topics").textContent = "";
        if (helpReturn && helpReturn.focus) { try { helpReturn.focus(); } catch (e) { /* gone */ } }
        helpReturn = null;
    }

    /* Which section the "?" is about: whichever tab is current. Asking the
       DOM rather than tracking it here keeps this working no matter which
       file changed the section last. */
    function currentSection() {
        var tab = document.querySelector('.admin-nav .tab[aria-current="page"]');
        return tab ? tab.getAttribute("data-section") : "content";
    }

    $("help-open").addEventListener("click", function () { openHelp(currentSection()); });
    $("help-close").addEventListener("click", closeHelp);
    $("help-modal").addEventListener("click", function (e) {
        // The backdrop, not the box.
        if (e.target === $("help-modal")) closeHelp();
    });

    /* The Markdown pill. Hovering opens it, moving away closes it again —
       unless it was opened with a click or the keyboard, in which case it
       stays until it is dismissed. Somebody reading an example should not
       lose it because the mouse drifted. */
    /* Two timers, not one: opening is delayed so a mouse crossing the pill on
       its way somewhere else does not flash the panel, and closing is delayed
       so the mouse can travel from the pill to the panel without it vanishing
       on the way. One shared timer meant the pill's own handlers cancelled
       each other. */
    var mdPinned = false, mdOpenTimer = null, mdCloseTimer = null;

    function mdFill() {
        var pop = $("md-popover");
        if (pop.firstChild) return;
        var src = helpBlock("markdown");
        if (src) pop.appendChild(src.cloneNode(true));
    }
    function mdOpen(pin) {
        mdFill();
        if (pin) mdPinned = true;
        $("md-popover").hidden = false;
        $("md-help").setAttribute("aria-expanded", "true");
    }
    function mdClose() {
        mdPinned = false;
        clearTimeout(mdOpenTimer); clearTimeout(mdCloseTimer);
        $("md-popover").hidden = true;
        $("md-help").setAttribute("aria-expanded", "false");
    }

    (function wireMarkdownHelp() {
        var pill = $("md-help"), pop = $("md-popover");

        pill.addEventListener("click", function () {
            if (mdPinned) mdClose(); else mdOpen(true);
        });
        // Focus opens it too, so the keyboard gets what the mouse gets.
        pill.addEventListener("focus", function () { mdOpen(false); });

        [pill, pop].forEach(function (n) {
            n.addEventListener("mouseenter", function () {
                clearTimeout(mdCloseTimer);
                if ($("md-popover").hidden) mdOpenTimer = setTimeout(function () { mdOpen(false); }, 250);
            });
            n.addEventListener("mouseleave", function () {
                clearTimeout(mdOpenTimer);
                if (mdPinned) return;
                mdCloseTimer = setTimeout(function () {
                    if (!mdPinned && !pop.contains(document.activeElement) && document.activeElement !== pill) mdClose();
                }, 250);
            });
        });
    })();

    document.addEventListener("keydown", function (e) {
        if (e.key !== "Escape") return;
        if (!$("help-modal").hidden) { closeHelp(); return; }
        if (!$("md-popover").hidden) { mdClose(); $("md-help").focus(); }
    });

    /* ============================================================ */
    /* Training                                                      */
    /*                                                               */
    /* The guide runs in its own window so it can sit beside the      */
    /* screen it describes. This side does two things: offer the      */
    /* button when a lesson covers the current tab, and let that      */
    /* window point at things over here.                             */
    /* ============================================================ */

    /* The course the Training button opens on each tab. Pressing it starts
       that lesson rather than offering a list: somebody who wanted a list can
       reach one from inside the guide, and somebody who pressed Training on
       the Members screen wanted to be taught the Members screen.

       Kept here rather than fetched so the button can appear without waiting
       on a download. training/check.mjs proves every tab has exactly one
       course and that the file says the same thing. */
    var TRAINING = {
        content: "post-a-meeting-notice",
        members: "add-someone-to-the-list",
        comms: "send-a-message",
        groups: "firewise-groups-and-board",
        board: "firewise-groups-and-board"
    };

    var trainingWindow = null;

    function updateTrainingButton() {
        var tab = document.querySelector('.admin-nav .tab[aria-current="page"]');
        var name = tab ? tab.getAttribute("data-section") : "content";
        $("train-open").hidden = !TRAINING[name];
    }

    function openTraining() {
        var tab = document.querySelector('.admin-nav .tab[aria-current="page"]');
        var name = tab ? tab.getAttribute("data-section") : "content";
        var url = "training.html?section=" + encodeURIComponent(name) +
                  "&lesson=" + encodeURIComponent(TRAINING[name] || "");
        // Reuse the window if it is already open, so pressing the button twice
        // does not leave two guides disagreeing about where you are.
        if (trainingWindow && !trainingWindow.closed) {
            trainingWindow.location.replace(url);
            trainingWindow.focus();
            return;
        }
        trainingWindow = window.open(url, "aafa-training", "width=460,height=720,menubar=no,toolbar=no,location=no");
        if (!trainingWindow) {
            notify("Training", "Your browser blocked the training window. Allow pop-ups for this site and press Training again.");
        }
    }

    /* Called from the training window. Switches to the tab the step happens on
       and outlines what it points at. Returns whether the target was actually
       found, so the guide can say so rather than leaving somebody hunting. */
    var trainingMark = null;
    function trainingFocus(section, selector) {
        if (trainingMark) { trainingMark.classList.remove("training-target"); trainingMark = null; }
        if (section) {
            var tab = document.querySelector('.admin-nav .tab[data-section="' + section + '"]');
            var currentTab = document.querySelector('.admin-nav .tab[aria-current="page"]');
            if (tab && tab !== currentTab) tab.click();
        }
        if (!selector) return true;
        var node;
        try { node = document.querySelector(selector); } catch (e) { return false; }
        if (!node || node.hidden || !node.getClientRects().length) return false;
        node.classList.add("training-target");
        trainingMark = node;
        node.scrollIntoView({ block: "center", behavior: "smooth" });
        return true;
    }

    window.AAFA_ADMIN.trainingFocus = trainingFocus;
    $("train-open").addEventListener("click", openTraining);
    // Wired here rather than with the help button: this has to run after
    // TRAINING is assigned, and the help block sits above it.
    Array.prototype.forEach.call(document.querySelectorAll(".admin-nav .tab[data-section]"), function (t) {
        t.addEventListener("click", updateTrainingButton);
    });
    updateTrainingButton();

    function msg(kind, text, el) {
        var box = el || $("msg");
        box.className = "form-status show " + kind;
        box.textContent = text;
    }
    function clearMsg(el) { (el || $("msg")).className = "form-status"; }

    /* ============================================================ */
    /* 2a. List                                                      */
    /* ============================================================ */

    function stateOf(item) {
        if (item.status !== "published") return "draft";
        var now = Date.now();
        if (now < Date.parse(item.startsAt)) return "scheduled";
        if (now >= Date.parse(item.endsAt)) return "ended";
        return "live";
    }

    var STATE_LABEL = { live: "Live now", scheduled: "Scheduled", draft: "Draft — not on the site", ended: "Ended" };

    function fmt(iso) {
        try { return new Intl.DateTimeFormat("en-US", { dateStyle: "medium", timeStyle: "short", timeZone: "America/Chicago" }).format(new Date(iso)); }
        catch (e) { return iso; }
    }

    function loadList() {
        return api("GET", "/items").then(function (j) {
            items = j.items || [];
            renderList();
            show("screen-list");
        });
    }

    function renderList() {
        var root = $("list");
        root.textContent = "";
        if (!items.length) {
            root.appendChild(node("p", { class: "hint", text: "Nothing yet. Use the buttons above to add a meeting notice or a news article." }));
            return;
        }
        var groups = [
            ["live", "On the site now", false], ["scheduled", "Scheduled — will appear on their own", false],
            ["draft", "Drafts — visitors cannot see these", true], ["ended", "Ended", true]
        ];
        groups.forEach(function (g) {
            var list = items.filter(function (i) { return stateOf(i) === g[0]; });
            if (!list.length) return;
            var sec = node("div", { class: "list-group" + (g[2] ? " dim" : "") }, [node("h2", { text: g[1] })]);
            list.forEach(function (i) {
                var when = g[0] === "scheduled" ? "Appears " + fmt(i.startsAt) : g[0] === "live" ? "Until " + fmt(i.endsAt) : g[0] === "ended" ? "Ended " + fmt(i.endsAt) : "Last saved " + fmt(i.updatedAt);
                var row = node("div", { class: "item " + g[0] }, [
                    node("div", null, [
                        node("h3", null, [node("span", { class: "badge", text: i.kind === "notice" ? "Meeting notice" : "News" }), i.title || "(untitled)"]),
                        node("p", { class: "meta", text: STATE_LABEL[g[0]] + " · " + when + " · by " + (i.updatedBy || "") })
                    ]),
                    node("div", { class: "item-actions" })
                ]);
                var actions = row.querySelector(".item-actions");
                var open = node("button", { type: "button", class: "btn btn-outline btn-small", text: "Open" });
                open.addEventListener("click", function () { openItem(i); });
                actions.appendChild(open);

                /* Ended items get a delete button here as well as in the form.
                   They are the ones that accumulate: past their stop date,
                   invisible to visitors, and nothing on the site refers to
                   them. Being able to clear one out without opening it keeps
                   the list from becoming a graveyard nobody tidies. */
                if (g[0] === "ended") {
                    var del = node("button", { type: "button", class: "btn btn-danger btn-small", text: "Delete" });
                    del.addEventListener("click", function () { removeFromList(i, del); });
                    actions.appendChild(del);
                }
                sec.appendChild(row);
            });
            root.appendChild(sec);
        });
    }

    function node(tag, attrs, children) {
        var n = document.createElement(tag);
        if (attrs) Object.keys(attrs).forEach(function (k) {
            if (k === "text") n.textContent = attrs[k]; else if (k === "class") n.className = attrs[k]; else n.setAttribute(k, attrs[k]);
        });
        (children || []).forEach(function (c) { if (c != null) n.appendChild(typeof c === "string" ? document.createTextNode(c) : c); });
        return n;
    }

    /* ============================================================ */
    /* 2b. Form                                                      */
    /* ============================================================ */

    function newId() {
        var a = new Uint8Array(7); crypto.getRandomValues(a);
        var tail = ""; for (var i = 0; i < a.length; i++) tail += a[i].toString(16).padStart(2, "0");
        return Date.now().toString(36).padStart(9, "0") + tail;
    }

    function localInput(iso) {
        if (!iso) return "";
        var d = new Date(iso);
        var p = function (n) { return String(n).padStart(2, "0"); };
        return d.getFullYear() + "-" + p(d.getMonth() + 1) + "-" + p(d.getDate()) + "T" + p(d.getHours()) + ":" + p(d.getMinutes());
    }
    function toIso(local) {
        var d = new Date(local);
        return isNaN(d.getTime()) ? "" : d.toISOString();
    }

    function newItem(kind) {
        var start = new Date(); start.setMinutes(0, 0, 0); start.setHours(start.getHours() + 1);
        var end = new Date(start); end.setDate(end.getDate() + (kind === "notice" ? 14 : 60));
        openItem({ id: newId(), kind: kind, status: "draft", title: "", body: "", startsAt: start.toISOString(), endsAt: end.toISOString(), pictures: [], showOnHome: false, bodyFormat: "plain", _new: true });
    }

    /* Copy an existing item into a fresh draft. The quarterly meeting notice
       is the same words every time and only the dates change, so retyping it
       — or editing last quarter's, which destroys the record of it — is the
       wrong shape of work.

       Pictures are deliberately not copied. They live under the original
       item's own prefix in S3, and the cleanup that removes an item's
       pictures when it is deleted assumes exactly one item owns them.
       Sharing a key between two items would mean deleting one silently
       breaks the other. */
    function duplicateItem() {
        if (dirty && !window.confirm("You have unsaved changes, which will not be copied. Continue?")) return;
        var start = new Date(); start.setMinutes(0, 0, 0); start.setHours(start.getHours() + 1);
        var end = new Date(start); end.setDate(end.getDate() + (current.kind === "notice" ? 14 : 60));
        var copy = {
            id: newId(), kind: current.kind, status: "draft",
            title: current.title, body: current.body,
            bodyFormat: current.bodyFormat || "plain",
            showOnHome: !!current.showOnHome,
            startsAt: start.toISOString(), endsAt: end.toISOString(),
            pictures: [], _new: true
        };
        if (current.link) { copy.link = current.link; copy.linkText = current.linkText; }
        var hadPictures = (current.pictures || []).length > 0;
        openItem(copy);
        dirty = true;
        updateStatusLine();
        msg("info", "Copied into a new draft with new dates" +
            (hadPictures ? ", without the pictures — add them again if you want them" : "") +
            ". The original is untouched. Nothing is saved until you press Save or Publish.");
    }

    function openItem(item) {
        current = JSON.parse(JSON.stringify(item));
        dirty = false;
        var isNews = item.kind === "news";
        $("form-title").textContent = (item._new ? "New " : "Edit ") + (isNews ? "news article" : "meeting notice");
        $("f-title").value = item.title || "";
        $("f-body").value = item.body || "";
        $("f-markdown").checked = item.bodyFormat === "markdown";
        $("f-starts").value = localInput(item.startsAt);
        $("f-ends").value = localInput(item.endsAt);
        $("f-link").value = item.link || "";
        $("f-linktext").value = item.linkText || "";
        $("f-home").checked = !!item.showOnHome;
        $("f-tone").value = item.tone || "meeting";
        $("wrap-tone").hidden = isNews;
        $("wrap-markdown").hidden = !isNews;
        $("wrap-home").hidden = !isNews;
        // A notice carries one picture, an article three. Both use the same
        // cropper; only the cap differs.
        $("wrap-pictures").hidden = false;
        $("pictures-cap").textContent = isNews ? "(up to 3)" : "(one, shown small beside the text)";
        $("unpublish").hidden = item.status !== "published";
        $("publish").textContent = item.status === "published" ? "Save and keep published" : "Publish";
        $("delete").hidden = !!item._new;
        $("duplicate").hidden = !!item._new;
        renderPictures();
        updateStatusLine();
        clearMsg();
        show("screen-edit");
        $("f-title").focus();
    }

    function updateStatusLine() {
        var s = current._new ? "Not saved yet" : STATE_LABEL[stateOf(current)];
        $("form-status").textContent = s + (dirty ? " · unsaved changes" : "");
    }

    /* Read the form into an item, checking what the API will check so the
       editor hears it in plain words before anything is sent. */
    function readForm(status) {
        var it = {
            kind: current.kind, status: status,
            title: $("f-title").value.trim(), body: $("f-body").value.replace(/\r\n?/g, "\n").trim(),
            startsAt: toIso($("f-starts").value), endsAt: toIso($("f-ends").value),
            pictures: current.pictures || []
        };
        var link = $("f-link").value.trim();
        if (link) { it.link = link; it.linkText = $("f-linktext").value.trim() || "More information"; }
        if (current.kind === "news") { it.showOnHome = $("f-home").checked; it.bodyFormat = $("f-markdown").checked ? "markdown" : "plain"; }
        else { it.tone = $("f-tone").value; }

        // A draft can be missing anything: the point of saving one is to keep
        // work that is not finished, including an article that is so far
        // nothing but a picture. Publishing is what has to be complete, and
        // publishing is the only thing a visitor ever sees.
        if (status !== "draft") {
            if (!it.title) return fail("Give it a title.", "f-title");
            if (!it.body) return fail("Add some text.", "f-body");
            if (!it.startsAt) return fail("Choose when it should start showing.", "f-starts");
            if (!it.endsAt) return fail("Choose when it should stop showing.", "f-ends");
        }
        if (it.title.length > LIMITS.title) return fail("The title is too long — " + LIMITS.title + " characters at most.", "f-title");
        if (it.body.length > LIMITS.body) return fail("The text is too long — " + LIMITS.body + " characters at most.", "f-body");
        if (it.startsAt && it.endsAt && Date.parse(it.endsAt) <= Date.parse(it.startsAt)) return fail("The stop time must be after the start time.", "f-ends");
        if (it.link && !/^https:\/\/\S+$/.test(it.link)) return fail("The link must start with https://", "f-link");
        if (it.link && it.linkText.length > LIMITS.linkText) return fail("The link button words are too long.", "f-linktext");
        return it;
    }
    /* Why readForm last refused, so a caller that is standing in front of the
       form -- the crop dialog, which saves a draft before it can attach a
       picture to it -- can repeat the reason instead of the code word. */
    var lastInvalid = "";

    function fail(text, focusId) {
        lastInvalid = text;
        msg("err", text);
        // Not while a dialog is open: the field is behind it, and moving focus
        // out of a modal strands anyone using the keyboard.
        if (focusId && $("crop-modal").hidden && $("preview-modal").hidden) $(focusId).focus();
        return null;
    }

    function save(status, quiet) {
        var it = readForm(status);
        if (!it) {
            var stop = new Error("invalid");
            stop.reason = lastInvalid;
            return Promise.reject(stop);
        }
        clearMsg();
        setBusy(true);
        return api("PUT", "/items/" + current.id, it).then(function (j) {
            var wasNew = current._new;
            current = j.item; dirty = false;
            var idx = items.findIndex(function (x) { return x.id === current.id; });
            if (idx >= 0) items[idx] = current; else items.unshift(current);
            $("unpublish").hidden = current.status !== "published";
            $("publish").textContent = current.status === "published" ? "Save and keep published" : "Publish";
            $("delete").hidden = false;
            $("form-title").textContent = "Edit " + (current.kind === "news" ? "news article" : "meeting notice");
            updateStatusLine();
            if (!quiet) {
                var st = stateOf(current);
                notify(wasNew ? "Added" : "Saved", status === "draft"
                    ? "Saved as a draft. Visitors cannot see it. Use Preview to check it, then Publish when it is ready."
                    : st === "live" ? "Published. It is on the site now — allow up to a minute to appear."
                    : st === "scheduled" ? "Published. It will appear on the site on " + fmt(current.startsAt) + " on its own."
                    : "Saved. Its stop date has passed, so it is not showing. Change the dates to bring it back.");
                msg("ok", status === "draft"
                    ? "Saved as a draft. Visitors cannot see it. Use Preview to check it, then Publish when it is ready."
                    : st === "live" ? "Published. It is on the site now — allow up to a minute to appear."
                    : st === "scheduled" ? "Published. It will appear on the site on " + fmt(current.startsAt) + " on its own."
                    : "Saved. Its stop date has passed, so it is not showing. Change the dates to bring it back.");
            }
            return current;
        }).catch(function (e) {
            if (e.message !== "invalid") msg("err", e.message);
            throw e;
        }).finally(function () { setBusy(false); });
    }

    function setBusy(b) {
        ["save-draft", "preview", "publish", "unpublish", "delete", "duplicate"].forEach(function (id) { $(id).disabled = b; });
    }

    function confirmDelete(item) {
        return window.confirm("Delete \"" + (item.title || "this item") + "\"?\n\nIt will be taken off the site and cannot be brought back.");
    }

    function removeItem() {
        if (!confirmDelete(current)) return;
        setBusy(true);
        var deletedTitle = current.title || "That item";
        api("DELETE", "/items/" + current.id).then(function () {
            items = items.filter(function (x) { return x.id !== current.id; });
            current = null; dirty = false;
            renderList(); show("screen-list");
            notify("Deleted", "\u201c" + deletedTitle + "\u201d has been removed from the site.");
        }).catch(function (e) { msg("err", e.message); }).finally(function () { setBusy(false); });
    }

    /* Delete from the list rather than from the form. The button disables
       itself while the request is in flight so a second click cannot fire a
       second delete against an id that is already gone. */
    function removeFromList(item, button) {
        if (!confirmDelete(item)) return;
        button.disabled = true;
        button.textContent = "Deleting…";
        api("DELETE", "/items/" + item.id).then(function () {
            items = items.filter(function (x) { return x.id !== item.id; });
            renderList();
            notify("Deleted", "\u201c" + (item.title || "That item") + "\u201d has been removed.");
        }).catch(function (e) {
            button.disabled = false;
            button.textContent = "Delete";
            window.alert(e.message);
        });
    }

    /* ============================================================ */
    /* 3. Pictures                                                   */
    /* ============================================================ */

    var PIC_LAYOUTS = [
        ["full", "Across the whole width"],
        ["right", "Beside the text, on the right"],
        ["left", "Beside the text, on the left"]
    ];

    /* Changing where a picture sits does not need the picture uploaded again,
       so it is on the card rather than back in the cropper. */
    function layoutPicker(pic, i) {
        var id = "pic-layout-" + i;
        var sel = node("select", { id: id, class: "pic-layout" });
        PIC_LAYOUTS.forEach(function (o) {
            var opt = node("option", { value: o[0], text: o[1] });
            if ((pic.layout || "full") === o[0]) opt.selected = true;
            sel.appendChild(opt);
        });
        sel.addEventListener("change", function () {
            current.pictures[i].layout = sel.value;
            dirty = true;
            updateStatusLine();
            msg("warn", "Layout changed. Save or Publish to make that stick.");
        });
        return node("label", { class: "pic-layout-label", for: id }, ["Where it sits ", sel]);
    }

    function renderPictures() {
        var root = $("pictures");
        root.textContent = "";
        var pics = current.pictures || [];
        pics.forEach(function (p, i) {
            var card = node("div", { class: "pic" }, [
                node("img", { src: cfg.contentBase + "/" + p.thumbKey, alt: p.alt || "" }),
                node("div", { class: "pic-text" }, [
                    node("strong", { text: p.alt || "" }),
                    p.credit || "No credit line",
                    current.kind === "notice" ? null : layoutPicker(p, i)
                ]),
                node("div", { class: "pic-actions" }, [
                    node("button", { type: "button", class: "btn btn-outline btn-small", "data-act": "rotate", text: "Rotate / re-crop" }),
                    node("button", { type: "button", class: "btn btn-outline btn-small", "data-act": "remove", text: "Remove" })
                ])
            ]);
            card.querySelector('[data-act="rotate"]').addEventListener("click", function () { recrop(i); });
            card.querySelector('[data-act="remove"]').addEventListener("click", function () {
                current.pictures.splice(i, 1); dirty = true; renderPictures(); updateStatusLine();
                msg("warn", "Picture removed from this article. Save or Publish to make that stick.");
            });
            root.appendChild(card);
        });
        $("dropzone").hidden = pics.length >= (current.kind === "notice" ? 1 : LIMITS.pictures);
    }

    /* Rotate or re-crop a picture that is already on the article: load it back
       out of the content bucket and hand it to the same cropper. The bucket
       allows this page's origin to read it, so the canvas stays clean and can
       still produce a file. */
    function recrop(i) {
        var p = (current.pictures || [])[i];
        if (!p) return;
        msg("info", "Opening the picture…");
        var img = new Image();
        img.crossOrigin = "anonymous";
        img.onload = function () { clearMsg(); openCropper(img, i); };
        img.onerror = function () { msg("err", "That picture could not be opened for editing. Remove it and add it again."); };
        img.src = cfg.contentBase.replace(/\/$/, "") + "/" + p.key;
    }

    function pickFile(file) {
        if (!file) return;
        if (!/^image\/(jpeg|png|webp)$/.test(file.type)) return msg("err", "That is not a JPEG, PNG or WebP picture.");
        if (file.size > LIMITS.fileBytes) return msg("err", "That picture is larger than 10 MB. Choose a smaller one.");
        var cap = current.kind === "notice" ? 1 : LIMITS.pictures;
        if ((current.pictures || []).length >= cap) {
            return msg("err", cap === 1 ? "A notice carries one picture. Remove it to choose a different one." : "This article already has three pictures.");
        }
        var url = URL.createObjectURL(file);
        var img = new Image();
        img.onload = function () { URL.revokeObjectURL(url); openCropper(img); };
        img.onerror = function () { URL.revokeObjectURL(url); msg("err", "That picture could not be opened."); };
        img.src = url;
    }

    /* ---- Cropper: a fixed-ratio frame over a canvas ---- */

    var crop = null;

    /* replaceIndex: the picture being re-cropped or rotated, or null for a new
       one. Rotation works on a copy of the source rather than on the crop
       maths, so everything downstream -- the frame, the preview, the encoder
       -- carries on as if the photo had arrived the right way up. */
    function openCropper(img, replaceIndex) {
        var existing = replaceIndex == null ? null : current.pictures[replaceIndex];
        crop = { src: img, img: img, rotation: 0, replace: replaceIndex == null ? null : replaceIndex,
                 scale: 1, x: 0, y: 0, w: 0, h: 0, drag: null };
        layoutCropper();

        $("crop-title").textContent = existing ? "Rotate or re-crop" : "Choose what shows";
        $("crop-ok").textContent = existing ? "Save this picture" : "Add this picture";
        $("p-alt").value = existing ? existing.alt || "" : "";
        $("p-credit").value = existing ? existing.credit || "" : "";
        // Second and third pictures default to beside the text: an article
        // with three full-width bands in it is mostly bands.
        $("p-layout").value = existing ? existing.layout || "full"
            : (current.pictures || []).length === 0 ? "full" : "right";
        // A notice always draws its picture small and to the side, so there is
        // nothing to choose.
        $("wrap-p-layout").hidden = current.kind === "notice";
        clearMsg($("crop-msg"));
        $("crop-modal").hidden = false;
        $("p-alt").focus();
    }

    /* Size the canvas to whatever crop.img currently is, and put the largest
       3:2 frame in the middle of it. Called on open and after every turn. */
    function layoutCropper() {
        var canvas = $("crop-canvas"), stage = canvas.parentNode;
        var iw = crop.img.naturalWidth || crop.img.width;
        var ih = crop.img.naturalHeight || crop.img.height;
        var maxW = Math.min(720, stage.clientWidth || 720);
        var scale = Math.min(1, maxW / iw, 480 / ih);
        canvas.width = Math.round(iw * scale);
        canvas.height = Math.round(ih * scale);

        var w = canvas.width, h = w / CROP_RATIO;
        if (h > canvas.height) { h = canvas.height; w = h * CROP_RATIO; }
        crop.scale = scale;
        crop.x = (canvas.width - w) / 2;
        crop.y = (canvas.height - h) / 2;
        crop.w = w; crop.h = h; crop.drag = null;
        drawCrop();
    }

    /* A quarter turn. The frame is reset rather than turned with the picture:
       after a 90-degree turn the old frame is over a different part of it, and
       moving it back would be more confusing than starting from the middle. */
    function rotateCrop(degrees) {
        if (!crop) return;
        crop.rotation = (crop.rotation + degrees + 360) % 360;
        crop.img = crop.rotation === 0 ? crop.src : turned(crop.src, crop.rotation);
        layoutCropper();
        msg("info", "Turned a quarter turn. The frame has gone back to the middle.", $("crop-msg"));
    }

    function turned(img, degrees) {
        var w = img.naturalWidth || img.width, h = img.naturalHeight || img.height;
        var sideways = degrees === 90 || degrees === 270;
        var c = document.createElement("canvas");
        c.width = sideways ? h : w;
        c.height = sideways ? w : h;
        var ctx = c.getContext("2d");
        ctx.translate(c.width / 2, c.height / 2);
        ctx.rotate(degrees * Math.PI / 180);
        ctx.drawImage(img, -w / 2, -h / 2);
        return c;
    }

    function drawCrop() {
        var c = $("crop-canvas"), ctx = c.getContext("2d");
        ctx.clearRect(0, 0, c.width, c.height);
        ctx.drawImage(crop.img, 0, 0, c.width, c.height);
        ctx.fillStyle = "rgba(0,0,0,.55)";
        ctx.fillRect(0, 0, c.width, crop.y);
        ctx.fillRect(0, crop.y + crop.h, c.width, c.height - crop.y - crop.h);
        ctx.fillRect(0, crop.y, crop.x, crop.h);
        ctx.fillRect(crop.x + crop.w, crop.y, c.width - crop.x - crop.w, crop.h);
        ctx.strokeStyle = "#fff"; ctx.lineWidth = 2;
        ctx.strokeRect(crop.x + 1, crop.y + 1, crop.w - 2, crop.h - 2);
        // Corner handle
        ctx.fillStyle = "#da7b37";
        ctx.fillRect(crop.x + crop.w - 16, crop.y + crop.h - 16, 16, 16);
    }

    function cropPointer(ev) {
        var c = $("crop-canvas"), r = c.getBoundingClientRect();
        return { x: (ev.clientX - r.left) * (c.width / r.width), y: (ev.clientY - r.top) * (c.height / r.height) };
    }

    function cropDown(ev) {
        if (!crop) return;
        var p = cropPointer(ev);
        var onHandle = p.x >= crop.x + crop.w - 24 && p.x <= crop.x + crop.w && p.y >= crop.y + crop.h - 24 && p.y <= crop.y + crop.h;
        var inside = p.x >= crop.x && p.x <= crop.x + crop.w && p.y >= crop.y && p.y <= crop.y + crop.h;
        if (!inside) return;
        crop.drag = { mode: onHandle ? "resize" : "move", sx: p.x, sy: p.y, ox: crop.x, oy: crop.y, ow: crop.w, oh: crop.h };
        ev.target.setPointerCapture(ev.pointerId);
        ev.preventDefault();
    }

    function cropMove(ev) {
        if (!crop || !crop.drag) return;
        var c = $("crop-canvas"), p = cropPointer(ev), d = crop.drag;
        if (d.mode === "move") {
            crop.x = Math.min(Math.max(0, d.ox + p.x - d.sx), c.width - crop.w);
            crop.y = Math.min(Math.max(0, d.oy + p.y - d.sy), c.height - crop.h);
        } else {
            var w = Math.max(90, d.ow + p.x - d.sx);
            w = Math.min(w, c.width - crop.x, (c.height - crop.y) * CROP_RATIO);
            crop.w = w; crop.h = w / CROP_RATIO;
        }
        drawCrop();
    }

    function cropUp() { if (crop) crop.drag = null; }

    function encodeCrop(outW) {
        var s = crop.scale, sx = crop.x / s, sy = crop.y / s, sw = crop.w / s, sh = crop.h / s;
        var outH = Math.round(outW / CROP_RATIO);
        var c = document.createElement("canvas"); c.width = outW; c.height = outH;
        c.getContext("2d").drawImage(crop.img, sx, sy, sw, sh, 0, 0, outW, outH);
        return new Promise(function (resolve) { c.toBlob(resolve, "image/jpeg", 0.85); }).then(function (b) { return { blob: b, w: outW, h: outH }; });
    }

    function confirmCrop() {
        var alt = $("p-alt").value.trim(), credit = $("p-credit").value.trim();
        var layout = $("p-layout").value;
        if (!alt) { msg("err", "Say what is in the picture — a short sentence. People using screen readers hear this instead of seeing it.", $("crop-msg")); $("p-alt").focus(); return; }
        if (alt.length > LIMITS.alt || credit.length > LIMITS.credit) { msg("err", "That description or credit is too long.", $("crop-msg")); return; }

        $("crop-ok").disabled = true;
        msg("info", "Adding the picture…", $("crop-msg"));

        var outW = Math.min(1600, Math.round(crop.w / crop.scale));
        var ensureSaved = current._new ? save("draft", true) : Promise.resolve(current);

        ensureSaved.then(function () {
            return Promise.all([encodeCrop(outW), encodeCrop(480), api("POST", "/items/" + current.id + "/pictures", {})]);
        }).then(function (r) {
            var full = r[0], thumb = r[1], grant = r[2];
            var put = function (url, blob) {
                return fetch(url, { method: "PUT", headers: grant.headers, body: blob }).then(function (res) {
                    if (!res.ok) throw new Error("The picture could not be uploaded. Try again.");
                });
            };
            return Promise.all([put(grant.uploadUrl, full.blob), put(grant.thumbUploadUrl, thumb.blob)]).then(function () {
                current.pictures = current.pictures || [];
                var pic = { key: grant.key, thumbKey: grant.thumbKey, width: full.w, height: full.h, alt: alt, credit: credit, layout: layout };
                // Re-cropping replaces the picture where it stood, so the
                // order of the article does not change under the editor. The
                // old files are cleaned up by the API on save.
                if (crop.replace != null) current.pictures.splice(crop.replace, 1, pic);
                else current.pictures.push(pic);
                return save(current.status === "published" ? "published" : "draft", true);
            });
        }).then(function () {
            var replaced = crop.replace != null;
            $("crop-modal").hidden = true; crop = null;
            renderPictures(); updateStatusLine();
            msg("ok", replaced ? "Picture replaced and saved." : "Picture added and saved.");
        }).catch(function (e) {
            // A picture belongs to an article, so the article is saved as a
            // draft first. A draft accepts an empty form, so that save rarely
            // fails -- but when it does, the reason is on the form behind this
            // dialog, where it cannot be read from here. Repeat it.
            var text = e.message === "invalid"
                ? (e.reason || "The article could not be saved, so the picture was not added.")
                : e.message || "The picture could not be added. Try again.";
            msg("err", text, $("crop-msg"));
        }).finally(function () { $("crop-ok").disabled = false; });
    }

    /* ============================================================ */
    /* 4. Preview                                                    */
    /* ============================================================ */

    function preview() {
        var ensure = dirty || current._new ? save(current.status === "published" ? "published" : "draft", true) : Promise.resolve(current);
        ensure.then(function () {
            var page = current.kind === "notice" || (current.kind === "news" && current.showOnHome && !window.confirm("Preview the article page? (Cancel to preview the home page instead.)"))
                ? "../index.html" : "../news.html";
            $("preview-frame").src = page + "?preview=" + encodeURIComponent(current.id);
            $("preview-modal").hidden = false;
        }).catch(function () { /* save() already showed the message */ });
    }

    /* ============================================================ */
    /* Wiring                                                        */
    /* ============================================================ */

    function wire() {
        $("sign-in").addEventListener("click", signIn);
        $("sign-out").addEventListener("click", signOut);
        $("new-notice").addEventListener("click", function () { newItem("notice"); });
        $("new-news").addEventListener("click", function () { newItem("news"); });
        $("back").addEventListener("click", function () {
            if (dirty && !window.confirm("You have unsaved changes. Leave without saving?")) return;
            current = null; dirty = false; renderList(); show("screen-list");
        });
        $("save-draft").addEventListener("click", function () { save("draft").catch(function () {}); });
        $("publish").addEventListener("click", function () { save("published").catch(function () {}); });
        $("unpublish").addEventListener("click", function () {
            if (!window.confirm("Take this off the site? It stays saved as a draft.")) return;
            save("draft").catch(function () {});
        });
        $("delete").addEventListener("click", removeItem);
        $("duplicate").addEventListener("click", duplicateItem);
        $("preview").addEventListener("click", preview);
        $("preview-close").addEventListener("click", function () { $("preview-modal").hidden = true; $("preview-frame").src = "about:blank"; });

        ["f-title", "f-body", "f-markdown", "f-starts", "f-ends", "f-link", "f-linktext", "f-home", "f-tone"].forEach(function (id) {
            $(id).addEventListener("input", function () { dirty = true; updateStatusLine(); });
            $(id).addEventListener("change", function () { dirty = true; updateStatusLine(); });
        });
        window.addEventListener("beforeunload", function (e) { if (dirty) { e.preventDefault(); e.returnValue = ""; } });

        var dz = $("dropzone"), fi = $("file");
        dz.addEventListener("click", function () { fi.click(); });
        dz.addEventListener("keydown", function (e) { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); fi.click(); } });
        fi.addEventListener("change", function () { pickFile(fi.files[0]); fi.value = ""; });
        ["dragenter", "dragover"].forEach(function (t) { dz.addEventListener(t, function (e) { e.preventDefault(); dz.classList.add("over"); }); });
        ["dragleave", "drop"].forEach(function (t) { dz.addEventListener(t, function (e) { e.preventDefault(); dz.classList.remove("over"); }); });
        dz.addEventListener("drop", function (e) { pickFile(e.dataTransfer.files && e.dataTransfer.files[0]); });

        var cc = $("crop-canvas");
        cc.addEventListener("pointerdown", cropDown);
        cc.addEventListener("pointermove", cropMove);
        cc.addEventListener("pointerup", cropUp);
        cc.addEventListener("pointercancel", cropUp);
        $("crop-cancel").addEventListener("click", function () { $("crop-modal").hidden = true; crop = null; });
        $("crop-left").addEventListener("click", function () { rotateCrop(-90); });
        $("crop-right").addEventListener("click", function () { rotateCrop(90); });
        $("crop-ok").addEventListener("click", confirmCrop);
        $("notice-ok").addEventListener("click", closeNotice);
    }

    /* ============================================================ */
    /* Start                                                         */
    /* ============================================================ */

    if (!cfg || !cfg.apiUrl || !cfg.authDomain || !cfg.clientId) {
        document.body.textContent = "This page is not configured yet. See docs/06-cms-design.md.";
        return;
    }
    wire();
    establishSession().then(function (ok) {
        if (!ok) { show("screen-signin"); return; }
        $("who-email").textContent = ss(KEYS.email) || "";
        $("who").hidden = false;
        $("admin-nav").hidden = false;
        window.AAFA_ADMIN.token = function () { return ss(KEYS.id); };
        window.AAFA_ADMIN.email = ss(KEYS.email) || "";
        return loadList().catch(function (e) {
            if (e.status === 403) show("screen-denied");
            else if (e.status === 401) show("screen-signin");
            else { show("screen-list"); msg("err", e.message, $("list")); }
        });
    });
})();

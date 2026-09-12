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
        window.scrollTo(0, 0);
    }

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
                        node("h3", null, [node("span", { class: "badge", text: i.kind === "notice" ? "Meeting notice" : "News" }), i.title]),
                        node("p", { class: "meta", text: STATE_LABEL[g[0]] + " · " + when + " · by " + (i.updatedBy || "") })
                    ]),
                    node("button", { type: "button", class: "btn btn-outline btn-small", text: "Open" })
                ]);
                row.querySelector("button").addEventListener("click", function () { openItem(i); });
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
        $("wrap-markdown").hidden = !isNews;
        $("wrap-home").hidden = !isNews;
        $("wrap-pictures").hidden = !isNews;
        $("unpublish").hidden = item.status !== "published";
        $("publish").textContent = item.status === "published" ? "Save and keep published" : "Publish";
        $("delete").hidden = !!item._new;
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
            pictures: current.kind === "news" ? current.pictures || [] : []
        };
        var link = $("f-link").value.trim();
        if (link) { it.link = link; it.linkText = $("f-linktext").value.trim() || "More information"; }
        if (current.kind === "news") { it.showOnHome = $("f-home").checked; it.bodyFormat = $("f-markdown").checked ? "markdown" : "plain"; }

        if (!it.title) return fail("Give it a title.", "f-title");
        if (it.title.length > LIMITS.title) return fail("The title is too long — " + LIMITS.title + " characters at most.", "f-title");
        if (!it.body) return fail("Add some text.", "f-body");
        if (it.body.length > LIMITS.body) return fail("The text is too long — " + LIMITS.body + " characters at most.", "f-body");
        if (!it.startsAt) return fail("Choose when it should start showing.", "f-starts");
        if (!it.endsAt) return fail("Choose when it should stop showing.", "f-ends");
        if (Date.parse(it.endsAt) <= Date.parse(it.startsAt)) return fail("The stop time must be after the start time.", "f-ends");
        if (it.link && !/^https:\/\/\S+$/.test(it.link)) return fail("The link must start with https://", "f-link");
        if (it.link && it.linkText.length > LIMITS.linkText) return fail("The link button words are too long.", "f-linktext");
        return it;
    }
    function fail(text, focusId) { msg("err", text); if (focusId) $(focusId).focus(); return null; }

    function save(status, quiet) {
        var it = readForm(status);
        if (!it) return Promise.reject(new Error("invalid"));
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
        ["save-draft", "preview", "publish", "unpublish", "delete"].forEach(function (id) { $(id).disabled = b; });
    }

    function removeItem() {
        if (!window.confirm("Delete \"" + (current.title || "this item") + "\"?\n\nIt will be taken off the site and cannot be brought back.")) return;
        setBusy(true);
        api("DELETE", "/items/" + current.id).then(function () {
            items = items.filter(function (x) { return x.id !== current.id; });
            current = null; dirty = false;
            renderList(); show("screen-list");
        }).catch(function (e) { msg("err", e.message); }).finally(function () { setBusy(false); });
    }

    /* ============================================================ */
    /* 3. Pictures                                                   */
    /* ============================================================ */

    function renderPictures() {
        var root = $("pictures");
        root.textContent = "";
        var pics = current.pictures || [];
        pics.forEach(function (p, i) {
            var card = node("div", { class: "pic" }, [
                node("img", { src: cfg.contentBase + "/" + p.thumbKey, alt: p.alt || "" }),
                node("div", { class: "pic-text" }, [node("strong", { text: p.alt || "" }), p.credit || "No credit line"]),
                node("div", { class: "pic-actions" }, [node("button", { type: "button", class: "btn btn-outline btn-small", text: "Remove" })])
            ]);
            card.querySelector("button").addEventListener("click", function () {
                current.pictures.splice(i, 1); dirty = true; renderPictures(); updateStatusLine();
                msg("warn", "Picture removed from this article. Save or Publish to make that stick.");
            });
            root.appendChild(card);
        });
        $("dropzone").hidden = pics.length >= LIMITS.pictures;
    }

    function pickFile(file) {
        if (!file) return;
        if (!/^image\/(jpeg|png|webp)$/.test(file.type)) return msg("err", "That is not a JPEG, PNG or WebP picture.");
        if (file.size > LIMITS.fileBytes) return msg("err", "That picture is larger than 10 MB. Choose a smaller one.");
        if ((current.pictures || []).length >= LIMITS.pictures) return msg("err", "This article already has three pictures.");
        var url = URL.createObjectURL(file);
        var img = new Image();
        img.onload = function () { URL.revokeObjectURL(url); openCropper(img); };
        img.onerror = function () { URL.revokeObjectURL(url); msg("err", "That picture could not be opened."); };
        img.src = url;
    }

    /* ---- Cropper: a fixed-ratio frame over a canvas ---- */

    var crop = null;

    function openCropper(img) {
        var canvas = $("crop-canvas"), stage = canvas.parentNode;
        var maxW = Math.min(720, stage.clientWidth || 720);
        var scale = Math.min(1, maxW / img.naturalWidth, 480 / img.naturalHeight);
        canvas.width = Math.round(img.naturalWidth * scale);
        canvas.height = Math.round(img.naturalHeight * scale);

        // Largest 3:2 frame that fits, centred.
        var w = canvas.width, h = w / CROP_RATIO;
        if (h > canvas.height) { h = canvas.height; w = h * CROP_RATIO; }
        crop = { img: img, scale: scale, x: (canvas.width - w) / 2, y: (canvas.height - h) / 2, w: w, h: h, drag: null };

        $("p-alt").value = ""; $("p-credit").value = "";
        clearMsg($("crop-msg"));
        $("crop-modal").hidden = false;
        drawCrop();
        $("p-alt").focus();
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
                current.pictures.push({ key: grant.key, thumbKey: grant.thumbKey, width: full.w, height: full.h, alt: alt, credit: credit });
                return save(current.status === "published" ? "published" : "draft", true);
            });
        }).then(function () {
            $("crop-modal").hidden = true; crop = null;
            renderPictures(); updateStatusLine();
            msg("ok", "Picture added and saved.");
        }).catch(function (e) {
            msg("err", e.message || "The picture could not be added. Try again.", $("crop-msg"));
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
        $("preview").addEventListener("click", preview);
        $("preview-close").addEventListener("click", function () { $("preview-modal").hidden = true; $("preview-frame").src = "about:blank"; });

        ["f-title", "f-body", "f-markdown", "f-starts", "f-ends", "f-link", "f-linktext", "f-home"].forEach(function (id) {
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
        $("crop-ok").addEventListener("click", confirmCrop);
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
        return loadList().catch(function (e) {
            if (e.status === 403) show("screen-denied");
            else if (e.status === 401) show("screen-signin");
            else { show("screen-list"); msg("err", e.message, $("list")); }
        });
    });
})();

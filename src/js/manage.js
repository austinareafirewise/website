/* The manage-my-subscription page.
 *
 * Reached four ways, each carrying something different in the URL:
 *   ?c=TOKEN        — the confirmation link from a sign-up email
 *   ?u=TOKEN        — the unsubscribe link at the bottom of any email
 *   ?t=TOKEN        — a manage link, from an email or a text
 *   ?t=TOKEN&code=  — a board-added member confirming their number
 *   nothing         — typed the address; offer to send a link
 *
 * Every action goes to the API with the token; the page holds nothing
 * itself. Tokens are signed and short-lived, so a copied link is useless
 * after it expires and can only ever act on the record it was issued for.
 */

(function () {
    "use strict";

    var cfg = window.AAFA_CMS;
    var $ = function (id) { return document.getElementById(id); };
    var q = new URLSearchParams(window.location.search);
    var api = cfg && cfg.apiUrl ? cfg.apiUrl.replace(/\/$/, "") : null;

    function notice(kind, text) {
        var n = $("notice");
        n.className = "form-status show " + kind;
        n.textContent = text;
    }

    function call(method, path, body) {
        return fetch(api + path, {
            method: method,
            headers: body ? { "Content-Type": "application/json" } : {},
            body: body ? JSON.stringify(body) : undefined
        }).then(function (r) {
            return r.json().catch(function () { return {}; }).then(function (j) {
                if (!r.ok) throw new Error(j.error || "Something went wrong. Please try again.");
                return j;
            });
        });
    }

    function showRequest() { $("request-box").hidden = false; }

    function showOptions(token, m) {
        $("options").hidden = false;
        var parts = [];
        if (m.email) parts.push("email " + m.email + (m.emailStatus === "confirmed" ? "" : " (" + (m.emailStatus || "not set") + ")"));
        if (m.phone) parts.push("mobile " + m.phone + (m.smsStatus === "confirmed" ? "" : " (" + (m.smsStatus || "not set") + ")"));
        // Without a name the sentence used to open with a lower-case "we".
        $("summary").textContent = (m.name ? m.name + " — we have your " : "We have your ")
            + parts.join(" and ") + ". Status: " + m.status + ".";
        $("choice-sms").hidden = !m.smsAvailable;
        $("choice-both").hidden = !m.smsAvailable;
        var method = m.emailStatus === "confirmed" && m.smsStatus === "confirmed" ? "both" : m.smsStatus === "confirmed" ? "sms" : "email";
        var r = document.querySelector('input[name="method"][value="' + method + '"]');
        if (r) r.checked = true;
        var paused = m.status === "unsubscribed";
        $("pause-go").hidden = paused;
        $("resume-go").hidden = !paused;

        function act(action, extra, confirmText) {
            if (confirmText && !window.confirm(confirmText)) return;
            call("POST", "/manage", Object.assign({ t: token, action: action }, extra || {}))
                .then(function (j) {
                    notice("ok", j.message);
                    if (action === "remove") { $("options").hidden = true; return; }
                    return call("GET", "/manage?t=" + encodeURIComponent(token)).then(function (j2) { showOptions(token, j2.member); });
                })
                .catch(function (e) { notice("err", e.message); });
        }
        $("switch-go").onclick = function () {
            var v = (document.querySelector('input[name="method"]:checked') || {}).value;
            if (!v) return notice("err", "Choose how you would like to be contacted.");
            act("switch", { method: v });
        };
        $("pause-go").onclick = function () { act("pause"); };
        $("resume-go").onclick = function () { act("resume"); };
        $("remove-go").onclick = function () { act("remove", null, "Remove your details entirely? We will hold nothing about you, and you would need to sign up again to get messages."); };
    }

    function loadManage(token) {
        call("GET", "/manage?t=" + encodeURIComponent(token))
            .then(function (j) { showOptions(token, j.member); })
            .catch(function (e) { notice("err", e.message); showRequest(); });
    }

    if (!api) {
        notice("err", "This page is not set up yet.");
        return;
    }

    // --- Confirmation link from a sign-up email ---
    if (q.get("c")) {
        history.replaceState(null, "", "manage.html");
        call("POST", "/confirm", { t: q.get("c") })
            .then(function (j) { notice("ok", j.message); if (j.manageToken) loadManage(j.manageToken); })
            .catch(function (e) { notice("err", e.message); showRequest(); });
        return;
    }

    // --- Unsubscribe link from an email footer ---
    if (q.get("u")) {
        history.replaceState(null, "", "manage.html");
        call("POST", "/unsubscribe", { t: q.get("u") })
            .then(function (j) { notice("ok", j.message + " Changed your mind? Use Resume below."); if (j.manageToken) loadManage(j.manageToken); })
            .catch(function (e) { notice("err", e.message); showRequest(); });
        return;
    }

    // --- Already handled by the API's GET /unsubscribe, which redirects here ---
    if (q.get("unsubscribed") && q.get("t")) {
        notice("ok", "You are unsubscribed. You will not receive further messages. Changed your mind? Use Resume below.");
        loadManage(q.get("t"));
        return;
    }
    if (q.get("expired")) {
        notice("err", "That link has expired. Request a new one below.");
        showRequest();
        return;
    }

    // --- Manage link, possibly with a text code to confirm first ---
    if (q.get("t")) {
        var token = q.get("t");
        history.replaceState(null, "", "manage.html");
        if (q.get("code")) {
            // Board-added member confirming their number. The API needs the
            // member id, which the manage token carries; the code came by text.
            $("code-box").hidden = false;
            $("code").value = q.get("code");
            $("code-go").onclick = function () {
                call("GET", "/manage?t=" + encodeURIComponent(token)).then(function (j) {
                    return call("POST", "/confirm-code", { memberId: j.member.memberId, code: $("code").value.trim() });
                }).then(function (j) { notice("ok", j.message); $("code-box").hidden = true; loadManage(token); })
                  .catch(function (e) { notice("err", e.message); });
            };
            return;
        }
        loadManage(token);
        return;
    }

    // --- Nothing in the URL: offer to send a link ---
    showRequest();
    fetch(api + "/signup/options").then(function (r) { return r.json(); }).then(function (o) {
        $("req-phone-wrap").hidden = !o.sms;
    }).catch(function () { $("req-phone-wrap").hidden = true; });
    $("req-go").onclick = function () {
        var e = $("req-email").value.trim(), p = $("req-phone").value.trim();
        if (!e && !p) return notice("err", "Enter the email address or mobile number you signed up with.");
        $("req-go").disabled = true;
        call("POST", "/manage/request", e ? { email: e } : { phone: p })
            .then(function (j) { notice("info", j.message); })
            .catch(function (err) { notice("err", err.message); })
            .finally(function () { $("req-go").disabled = false; });
    };
})();

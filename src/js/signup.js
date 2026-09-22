/* The sign-up form on the home page.
 *
 * Posts to the public /signup route. The API stores the person as pending
 * and sends a confirmation — a link by email, a six-digit code by text — and
 * this script asks for the code when one was sent. The person is on no list
 * until they confirm; the form says so.
 *
 * The text option only appears once the API reports texting is switched on,
 * which is not until the toll-free number is approved by the carriers.
 */

(function () {
    "use strict";

    var cfg = window.AAFA_CMS;
    var form = document.getElementById("signup-form");
    var statusEl = document.getElementById("signup-status");
    if (!form || !statusEl || !cfg || !cfg.apiUrl) return;

    var api = cfg.apiUrl.replace(/\/$/, "");
    var codeBox = document.getElementById("signup-code");
    var pendingMemberId = null;

    /* Until texts actually arrive, the messages a person reads say so: the
       form said it before they signed up, and being told "you are on the
       list" is the moment they would otherwise wonder which list. */
    var comingSoon = window.AAFA_TEXT_COMING_SOON !== false;
    var EMAIL_ONLY = window.AAFA_TEXT_COMING_SOON_TEXT || "";

    function setStatus(kind, text) {
        statusEl.className = "form-status show " + kind;
        statusEl.textContent = text;
    }

    function post(path, body) {
        return fetch(api + path, {
            method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body)
        }).then(function (r) {
            return r.json().catch(function () { return {}; }).then(function (j) {
                if (!r.ok) throw new Error(j.error || "Something went wrong. Please try again in a moment.");
                return j;
            });
        });
    }

    /* Show or hide the text choices depending on what the API says. */
    fetch(api + "/signup/options").then(function (r) { return r.json(); }).then(function (o) {
        // Sign-ups are always accepted. When email sending is still being
        // approved the record is held and the confirmation follows, and the
        // API's own reply says so — no second copy of that wording here to
        // drift out of step with it.
        var smsOn = !!o.sms;
        // All three choices are in the markup and visible without JavaScript;
        // this only swaps the hint underneath, because what happens to a
        // mobile number differs before and after the number is approved.
        // The note goes when texts work, not when the API says the sending
        // side is configured -- those are different days.
        var note = document.getElementById("sms-soon");
        if (note) note.hidden = !comingSoon;
        syncFields();
    }).catch(function () { /* leave the email-only default */ });

    /* The Firewise groups the board has defined. The whole field stays
       hidden until at least one exists, rather than offering an empty
       dropdown that makes the site look unfinished. */
    fetch(api + "/groups/public").then(function (r) { return r.json(); }).then(function (j) {
        var groups = (j && j.groups) || [];
        if (!groups.length) return;
        var sel = document.getElementById("su-group");
        groups.forEach(function (g) {
            var o = document.createElement("option");
            o.value = g.groupId;
            // City first, then the area, so two groups with similar names are
            // told apart by the town they are in. Most groups have a city and
            // no area, so this is usually the only thing distinguishing them.
            var where = [g.city, g.area].filter(Boolean).join(", ");
            o.textContent = g.name + (where ? " — " + where : "");
            sel.appendChild(o);
        });
        document.getElementById("wrap-group").hidden = false;
    }).catch(function () { /* no dropdown; the free-text neighborhood still works */ });

    function method() {
        var r = form.querySelector('input[name="method"]:checked');
        return r ? r.value : "email";
    }

    /* Both fields stay on screen; what changes is which is required and how
       the optional one is labelled. Hiding a field the moment someone picks a
       method makes the form jump about under them. */
    function syncFields() {
        var m = method();
        var e = form.elements.email, p = form.elements.phone;
        if (e) e.required = m !== "sms";
        if (p) p.required = m !== "email";
        var eo = document.getElementById("email-opt"), po = document.getElementById("phone-opt");
        if (eo) eo.hidden = m !== "sms";
        if (po) po.hidden = m !== "email";
    }
    Array.prototype.forEach.call(form.querySelectorAll('input[name="method"]'), function (r) { r.addEventListener("change", syncFields); });
    syncFields();

    form.addEventListener("submit", function (event) {
        event.preventDefault();
        if (form.elements.company && form.elements.company.value) { setStatus("ok", "Thanks — check your inbox."); return; }

        var m = method();
        var body = {
            method: m,
            email: m !== "sms" ? form.elements.email.value.trim() : "",
            phone: m !== "email" ? form.elements.phone.value.trim() : "",
            firstName: form.elements.firstName.value.trim(),
            lastName: form.elements.lastName.value.trim(),
            area: form.elements.area ? form.elements.area.value.trim() : "",
            zip: form.elements.zip ? form.elements.zip.value.trim() : "",
            groupId: form.elements.groupId ? form.elements.groupId.value : "",
            interest: form.elements.interest.value,
            consent: !!(form.elements.consent && form.elements.consent.checked)
        };
        if (!body.consent) { setStatus("err", "Please tick the box to agree to receive messages."); form.elements.consent.focus(); return; }
        if (m !== "sms" && !body.email) { setStatus("err", "Enter your email address."); form.elements.email.focus(); return; }
        if (m !== "email" && !body.phone) { setStatus("err", "Enter your mobile number."); form.elements.phone.focus(); return; }

        var button = form.querySelector("button[type=submit]");
        button.disabled = true;
        setStatus("info", "Sending…");

        post("/signup", body).then(function (j) {
            if (j.codeSent && j.memberId) {
                pendingMemberId = j.memberId;
                setStatus("info", (m === "both" ? "Check your email for a confirmation link. " : "") +
                    "We've texted you a six-digit code — enter it below to confirm your mobile number.");
                if (codeBox) { codeBox.hidden = false; document.getElementById("signup-code-input").focus(); }
            } else {
                setStatus("ok", j.message + " Check your email for the confirmation link — it can take a minute, and sometimes lands in spam." +
                    (comingSoon && EMAIL_ONLY ? " " + EMAIL_ONLY : ""));
                form.reset(); syncFields();
            }
        }).catch(function (e) {
            setStatus("err", e.message);
        }).finally(function () { button.disabled = false; });
    });

    if (codeBox) {
        document.getElementById("signup-code-go").addEventListener("click", function () {
            var code = document.getElementById("signup-code-input").value.trim();
            if (!/^\d{6}$/.test(code)) { setStatus("err", "The code is six digits."); return; }
            post("/confirm-code", { memberId: pendingMemberId, code: code }).then(function (j) {
                setStatus("ok", j.message);
                codeBox.hidden = true; pendingMemberId = null;
                form.reset(); syncFields();
            }).catch(function (e) { setStatus("err", e.message); });
        });
    }
})();

/* Austin Area Firewise Alliance — austinareafirewise.org
   Plain browser JS, no build step, no dependencies. */

(function () {
    "use strict";

    var yearEl = document.getElementById("year");
    if (yearEl) {
        yearEl.textContent = String(new Date().getFullYear());
    }

    /* ---------------------------------------------------------------
       External links open in a new tab.

       The target attribute is in the markup, so it works without this
       script. What this adds is the announcement: opening a new tab
       without warning is a WCAG 3.2.2 failure, and sighted visitors get
       the arrow from the .ext class while screen-reader users get nothing
       from a CSS ::after.

       Done here rather than in each of the fifty-odd links, so a link
       added later inherits it without anyone remembering to. The guard
       matters: content.js already appends this text to the link button it
       builds, and running twice would announce it twice.
       --------------------------------------------------------------- */

    function announceNewTab(root) {
        var links = (root || document).querySelectorAll('a[target="_blank"]');
        for (var i = 0; i < links.length; i++) {
            var a = links[i];
            if (a.getAttribute("data-newtab-noted")) continue;
            if (a.querySelector(".sr-only")) { a.setAttribute("data-newtab-noted", "1"); continue; }
            var note = document.createElement("span");
            note.className = "sr-only";
            note.textContent = " (opens in a new tab)";
            a.appendChild(note);
            a.setAttribute("data-newtab-noted", "1");
        }
    }

    announceNewTab(document);

    /* Board-published content arrives after this script runs, so re-run
       when the slots it fills change. */
    if (window.MutationObserver) {
        ["notice-slot", "home-news", "news-root"].forEach(function (id) {
            var slot = document.getElementById(id);
            if (slot) {
                new MutationObserver(function () { announceNewTab(slot); })
                    .observe(slot, { childList: true, subtree: true });
            }
        });
    }

    /* ---------------------------------------------------------------
       Text size control.

       Sets --text-scale on <html>; the stylesheet multiplies the root
       font size by it, and everything sized in rem follows. The chosen
       value is re-applied from localStorage by a small inline script in
       each page's <head>, so a page paints at the reader's size instead
       of flashing at 100% and jumping when this file runs.

       localStorage throws outright in some privacy configurations rather
       than just returning null, so every access is wrapped. A reader who
       cannot persist the setting still gets a working control for the
       current page — the feature degrades, it does not break.
       --------------------------------------------------------------- */

    var STORAGE_KEY = "aafa-text-scale";

    function applyScale(value, buttons) {
        document.documentElement.style.setProperty("--text-scale", value);
        for (var i = 0; i < buttons.length; i++) {
            buttons[i].setAttribute(
                "aria-pressed",
                buttons[i].getAttribute("data-scale") === value ? "true" : "false"
            );
        }
    }

    var sizer = document.querySelector(".text-size");
    if (sizer) {
        var sizeButtons = sizer.querySelectorAll("button[data-scale]");
        var saved = null;
        try {
            saved = localStorage.getItem(STORAGE_KEY);
        } catch (e) {
            saved = null;
        }

        // Only honour a value the markup actually offers, so a stale or
        // hand-edited entry cannot set an arbitrary scale.
        var known = false;
        for (var j = 0; j < sizeButtons.length; j++) {
            if (sizeButtons[j].getAttribute("data-scale") === saved) {
                known = true;
            }
        }
        applyScale(known ? saved : "1", sizeButtons);

        sizer.addEventListener("click", function (event) {
            var button = event.target.closest("button[data-scale]");
            if (!button) {
                return;
            }
            var value = button.getAttribute("data-scale");
            applyScale(value, sizeButtons);
            try {
                localStorage.setItem(STORAGE_KEY, value);
            } catch (e) {
                /* Setting applies to this page; it just will not persist. */
            }
        });
    }

    /* ---------------------------------------------------------------
       Signup / question form.

       Three states, in order of preference:

       1. AAFA_SIGNUP_ENDPOINT set  -> POST JSON to it.
       2. Only AAFA_CONTACT_EMAIL set -> open a prefilled mailto and say
          plainly that nothing was stored.
       3. Neither set (today) -> say the form is not connected yet and
          point at the official agency channels, which are always live.

       State 3 exists because this is a wildfire site. Someone with an
       urgent question must never be left believing a message was sent when
       nothing received it. That is also why the form never claims to be a
       way to report a fire — the markup says so above the fields.

       None of this substitutes for the consent and unsubscribe handling a
       real mailing list needs; that belongs with the backend when it
       exists. See infra/README.md.
       --------------------------------------------------------------- */

    var form = document.getElementById("signup-form");
    var statusEl = document.getElementById("signup-status");
    if (!form || !statusEl) {
        return;
    }

    function setStatus(kind, html) {
        statusEl.className = "form-status show " + kind;
        statusEl.innerHTML = html;
    }

    function mailtoLink(email, data) {
        var subject = "Austin Area Firewise Alliance — " + data.interest;
        var body =
            "Email: " + data.email + "\n" +
            "Name: " + (data.name || "(not given)") + "\n" +
            "Area: " + (data.area || "(not given)") + "\n" +
            "About: " + data.interest + "\n\n" +
            (data.note || "");
        return (
            "mailto:" + email +
            "?subject=" + encodeURIComponent(subject) +
            "&body=" + encodeURIComponent(body)
        );
    }

    form.addEventListener("submit", function (event) {
        event.preventDefault();

        // Honeypot: a filled hidden field means a bot. Say nothing useful.
        if (form.elements.company && form.elements.company.value) {
            setStatus("ok", "Thanks — we'll be in touch.");
            return;
        }

        var email = form.elements.email.value.trim();
        if (!email || email.indexOf("@") < 1 || email.indexOf(".") < 0) {
            setStatus("err", "That email address doesn't look right. Check it and try again.");
            form.elements.email.focus();
            return;
        }

        var data = {
            email: email,
            name: form.elements.name.value.trim(),
            area: form.elements.area ? form.elements.area.value.trim() : "",
            interest: form.elements.interest.value,
            note: form.elements.note.value.trim(),
            source: "austinareafirewise.org"
        };

        var endpoint = window.AAFA_SIGNUP_ENDPOINT;
        var contact = window.AAFA_CONTACT_EMAIL;

        if (!endpoint) {
            if (contact) {
                setStatus(
                    "info",
                    "The signup list isn't running yet, so nothing was stored here. Your mail app " +
                    "should have opened with the message ready to send — if it didn't, write to " +
                    "<a href=\"mailto:" + contact + "\">" + contact + "</a>."
                );
                window.location.href = mailtoLink(contact, data);
            } else {
                setStatus(
                    "info",
                    "This form isn't connected yet — nothing was stored and nothing was sent. " +
                    "For anything time-sensitive, use the official channels: call 911 for a fire, " +
                    "register at <a class=\"ext\" href=\"https://warncentraltexas.org/\" " +
                    "rel=\"noopener\">Warn Central Texas</a> for alerts, or contact your local fire " +
                    "department or Emergency Services District."
                );
            }
            return;
        }

        var button = form.querySelector("button[type=submit]");
        if (button) {
            button.disabled = true;
        }
        setStatus("info", "Sending…");

        fetch(endpoint, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(data)
        })
            .then(function (response) {
                if (!response.ok) {
                    throw new Error("HTTP " + response.status);
                }
                form.reset();
                setStatus("ok", "Got it. Watch for a confirmation email — the list only adds you once you click the link in it.");
            })
            .catch(function () {
                setStatus(
                    "err",
                    "That didn't go through. Try again in a moment." +
                    (contact ? " Or write to <a href=\"mailto:" + contact + "\">" + contact + "</a>." : "")
                );
            })
            .then(function () {
                if (button) {
                    button.disabled = false;
                }
            });
    });
})();

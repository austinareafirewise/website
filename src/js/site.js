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

})();

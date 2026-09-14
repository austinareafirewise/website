/* The training guide that runs in its own window.
 *
 * It reads the same lesson files the narration is recorded from, so what is on
 * screen and what is spoken cannot drift apart: there is one source, checked by
 * training/check.mjs.
 *
 * It drives the admin page it was opened from -- switching to the right tab and
 * outlining whatever the step points at -- through window.opener, which works
 * because both are the same origin. If the admin window is closed or navigated
 * away, every one of those calls is skipped and the lesson still reads fine.
 * The guide is never the thing that breaks.
 */

(function () {
    "use strict";

    var $ = function (id) { return document.getElementById(id); };

    /* Lessons are listed here rather than discovered: a static site has no
       directory listing, and a hard-coded list is one line to change and
       impossible to get half-right at runtime. check.mjs proves the files
       named here exist. */
    var FILES = [
        "first-time.md",
        "post-a-meeting-notice.md",
        "write-a-news-article.md",
        "add-someone-to-the-list.md",
        "send-a-message.md",
        "firewise-groups-and-board.md"
    ];

    var lessons = [];
    var current = null;
    var at = 0;

    /* ------------------------------------------------------------ */
    /* Reading a lesson                                              */
    /* ------------------------------------------------------------ */

    function parse(text, file) {
        var meta = {};
        text.replace(/<!--\s*([a-z-]+):\s*([^>]*?)\s*-->/g, function (_, k, v) { meta[k] = v; return ""; });

        var chunks = text.split(/^## /m).slice(1);
        var steps = chunks.map(function (chunk) {
            var lines = chunk.split("\n");
            var step = { title: lines[0].trim(), fields: {}, words: [] };
            lines.slice(1).forEach(function (line) {
                var f = /^- ([a-z-]+):\s*(.*)$/.exec(line);
                if (f) { step.fields[f[1]] = f[2].trim(); return; }
                step.words.push(line);
            });
            step.words = step.words.join("\n").trim().split(/\n\s*\n/).filter(Boolean);
            return step;
        });

        return {
            file: file,
            id: meta["lesson-id"] || file.replace(/\.md$/, ""),
            title: (/^#\s+(.*)$/m.exec(text) || [, file])[1].trim(),
            description: meta.description || "",
            minutes: meta.minutes || "",
            order: parseInt(meta.order || "999", 10),
            sections: (meta.sections || "").split(",").map(function (s) { return s.trim(); }).filter(Boolean),
            steps: steps
        };
    }

    function load() {
        return Promise.all(FILES.map(function (f) {
            return fetch("training/" + f, { credentials: "omit" })
                .then(function (r) { return r.ok ? r.text() : null; })
                .then(function (t) { return t ? parse(t, f) : null; })
                .catch(function () { return null; });
        })).then(function (all) {
            lessons = all.filter(Boolean).sort(function (a, b) { return a.order - b.order; });
        });
    }

    /* ------------------------------------------------------------ */
    /* Talking to the admin window                                   */
    /* ------------------------------------------------------------ */

    function admin() {
        try {
            var w = window.opener;
            if (!w || w.closed || !w.AAFA_ADMIN || !w.AAFA_ADMIN.trainingFocus) return null;
            return w;
        } catch (e) { return null; }   // navigated somewhere else
    }

    function point(step) {
        var w = admin();
        $("tr-pointing").hidden = true;
        if (!w) return;
        var found = w.AAFA_ADMIN.trainingFocus(step.fields.section || null, step.fields.target || null);
        if (step.fields.target && !found) {
            // Say so rather than leaving somebody hunting for a highlight that
            // is not there.
            $("tr-pointing").textContent = "The thing this step points at is not on the screen right now — it may only appear once you have opened an item.";
            $("tr-pointing").hidden = false;
        }
    }

    function clearPointing() {
        var w = admin();
        if (w) w.AAFA_ADMIN.trainingFocus(null, null);
    }

    /* ------------------------------------------------------------ */
    /* Screens                                                       */
    /* ------------------------------------------------------------ */

    function showMenu(sectionHint) {
        current = null;
        cancelAdvance();
        try { $("tr-player").pause(); } catch (e) { /* nothing loaded */ }
        clearPointing();
        $("tr-step").hidden = true;
        $("tr-menu").hidden = false;
        $("tr-title").textContent = "Choose a lesson";
        $("tr-kicker").textContent = "Training";

        var here = lessons.filter(function (l) { return sectionHint && l.sections.indexOf(sectionHint) >= 0; });
        var rest = lessons.filter(function (l) { return here.indexOf(l) < 0; });

        $("tr-menu-note").textContent = here.length
            ? "For the screen you are on:"
            : "Every lesson:";

        var list = $("tr-list");
        list.textContent = "";
        here.concat(rest).forEach(function (l, i) {
            if (here.length && i === here.length) {
                var hr = document.createElement("p");
                hr.className = "hint tr-divider";
                hr.textContent = "Everything else:";
                list.appendChild(hr);
            }
            var b = document.createElement("button");
            b.type = "button";
            b.className = "tr-card";
            var h = document.createElement("strong");
            h.textContent = l.title;
            var meta = document.createElement("span");
            meta.className = "tr-meta";
            meta.textContent = l.steps.length + " steps · about " + l.minutes + " min";
            var d = document.createElement("span");
            d.className = "tr-desc";
            d.textContent = l.description;
            b.appendChild(h); b.appendChild(meta); b.appendChild(d);
            b.addEventListener("click", function () { start(l); });
            list.appendChild(b);
        });
    }

    function start(lesson) {
        current = lesson;
        at = 0;
        $("tr-menu").hidden = true;
        $("tr-step").hidden = false;
        $("tr-kicker").textContent = "Training";
        $("tr-title").textContent = lesson.title;
        render();
    }

    function render() {
        var step = current.steps[at];
        $("tr-progress").textContent = "Step " + (at + 1) + " of " + current.steps.length;
        $("tr-step-title").textContent = step.title;

        var words = $("tr-words");
        words.textContent = "";
        step.words.forEach(function (para) {
            var p = document.createElement("p");
            p.textContent = para.replace(/\s*\n\s*/g, " ");
            words.appendChild(p);
        });

        var player = $("tr-player");
        $("tr-blocked").hidden = true;
        if (step.fields.audio) {
            player.src = "training/audio/" + step.fields.audio;
            $("tr-audio").hidden = false;
            $("tr-noaudio").hidden = true;
            if (autoOn()) playThisStep();
        } else {
            player.pause();
            player.removeAttribute("src");
            $("tr-audio").hidden = true;
            $("tr-noaudio").hidden = false;
            // No clip to wait for. Give somebody time to read it, then move on.
            if (autoOn()) waitThenAdvance(Math.max(6000, step.words.join(" ").split(/\s+/).length * 320));
        }

        $("tr-prev").disabled = at === 0;
        $("tr-next").textContent = at === current.steps.length - 1 ? "Finish" : "Next →";
        point(step);
    }

    /* ------------------------------------------------------------ */
    /* Playing, and moving on by itself                              */
    /*                                                               */
    /* A browser will not play sound until somebody has asked this    */
    /* document for it. Opening the guide is a click and starting a   */
    /* lesson is another, so usually it simply plays -- but when it   */
    /* does not, the promise rejects and the guide says so rather     */
    /* than sitting silent looking broken.                            */
    /* ------------------------------------------------------------ */

    var advanceTimer = null;

    function autoOn() { return $("tr-auto").checked; }

    function cancelAdvance() { clearTimeout(advanceTimer); advanceTimer = null; }

    function waitThenAdvance(ms) {
        cancelAdvance();
        advanceTimer = setTimeout(function () {
            if (autoOn() && current && at < current.steps.length - 1) step(1);
        }, ms);
    }

    function playThisStep() {
        var player = $("tr-player");
        cancelAdvance();
        try { player.currentTime = 0; } catch (e) { /* not loaded yet */ }
        var p = player.play();
        if (p && p.catch) {
            p.catch(function () {
                // Blocked, or the file is missing. Either way, say so and stop
                // pretending the lesson is running.
                $("tr-blocked").hidden = false;
            });
        }
    }

    function step(by) {
        cancelAdvance();
        if (!current) return;
        var next = at + by;
        if (next < 0) return;
        if (next >= current.steps.length) { showMenu(sectionOfAdmin()); return; }
        at = next;
        render();
    }

    /* Which tab the admin window is showing, so the menu can put the relevant
       lessons first. */
    function sectionOfAdmin() {
        var w = admin();
        if (!w) return null;
        try {
            var tab = w.document.querySelector('.admin-nav .tab[aria-current="page"]');
            return tab ? tab.getAttribute("data-section") : null;
        } catch (e) { return null; }
    }

    /* ------------------------------------------------------------ */
    /* Wiring                                                        */
    /* ------------------------------------------------------------ */

    /* When a clip finishes, wait a beat -- landing on the next screen the
       instant the voice stops is disorienting -- then move on. The last step
       stops rather than looping back to the menu on its own. */
    $("tr-player").addEventListener("ended", function () {
        if (!autoOn() || !current) return;
        if (at >= current.steps.length - 1) return;
        waitThenAdvance(900);
    });

    /* Pausing means "wait for me". Nothing should move while it is paused. */
    $("tr-player").addEventListener("pause", cancelAdvance);
    $("tr-player").addEventListener("play", function () { $("tr-blocked").hidden = true; });

    $("tr-auto").addEventListener("change", function () {
        if (autoOn()) playThisStep();
        else { cancelAdvance(); $("tr-player").pause(); }
    });

    $("tr-prev").addEventListener("click", function () { step(-1); });
    $("tr-next").addEventListener("click", function () { step(1); });
    $("tr-menu-back").addEventListener("click", function () { showMenu(sectionOfAdmin()); });
    $("tr-close").addEventListener("click", function () { clearPointing(); window.close(); });
    window.addEventListener("beforeunload", clearPointing);

    document.addEventListener("keydown", function (e) {
        if (!current) return;
        if (e.key === "ArrowRight") step(1);
        else if (e.key === "ArrowLeft") step(-1);
    });

    load().then(function () {
        if (!lessons.length) {
            $("tr-msg").className = "form-status show err";
            $("tr-msg").textContent = "The lessons could not be loaded.";
            return;
        }
        var params = new URLSearchParams(window.location.search);
        var wanted = params.get("lesson");
        var picked = wanted && lessons.filter(function (l) { return l.id === wanted; })[0];
        if (picked) start(picked);
        else showMenu(params.get("section") || sectionOfAdmin());
    });
})();

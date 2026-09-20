/* The four data sections of the admin area: Members, Messages, Firewise
 * groups, and Board.
 *
 * All four follow one pattern — a list of cards, and a dialog that edits one
 * record — because a board member who learns one has then learned all four.
 * The field definitions below are the only thing that differs between them,
 * which is also why adding a field later is a one-line change rather than a
 * new screen.
 *
 * Sign-in, the token, and the News/Notices section belong to admin.js; this
 * file borrows the token through window.AAFA_ADMIN and never touches
 * sessionStorage itself.
 */

(function () {
    "use strict";

    var cfg = window.AAFA_CMS;
    var $ = function (id) { return document.getElementById(id); };
    if (!cfg || !cfg.apiUrl) return;
    var API = cfg.apiUrl.replace(/\/$/, "");

    var state = { members: [], comms: [], groups: [], board: [], logins: [], loaded: {} };
    var current = null;          // { kind, record }

    /* ------------------------------------------------------------ */
    /* API                                                           */
    /* ------------------------------------------------------------ */

    function api(method, path, body) {
        var token = window.AAFA_ADMIN && window.AAFA_ADMIN.token && window.AAFA_ADMIN.token();
        return fetch(API + path, {
            method: method,
            headers: Object.assign({ Authorization: "Bearer " + token }, body ? { "Content-Type": "application/json" } : {}),
            body: body ? JSON.stringify(body) : undefined
        }).then(function (r) {
            if (r.status === 401) throw new Error("Your sign-in has expired. Reload the page and sign in again.");
            return r.json().catch(function () { return {}; }).then(function (j) {
                if (!r.ok) throw new Error(j.error || "Something went wrong. Nothing was changed.");
                return j;
            });
        });
    }

    function el(tag, attrs, kids) {
        var n = document.createElement(tag);
        if (attrs) Object.keys(attrs).forEach(function (k) {
            if (attrs[k] == null) return;
            if (k === "text") n.textContent = attrs[k];
            else if (k === "class") n.className = attrs[k];
            else if (k === "html") n.innerHTML = attrs[k];        // only ever our own markup
            else n.setAttribute(k, attrs[k]);
        });
        (kids || []).forEach(function (c) { if (c != null) n.appendChild(typeof c === "string" ? document.createTextNode(c) : c); });
        return n;
    }

    function fmt(iso, withTime) {
        if (!iso) return "";
        try {
            return new Intl.DateTimeFormat("en-US", withTime
                ? { dateStyle: "medium", timeStyle: "short", timeZone: "America/Chicago" }
                : { dateStyle: "medium", timeZone: "America/Chicago" }).format(new Date(iso));
        } catch (e) { return iso; }
    }

    function localInput(iso) {
        if (!iso) return "";
        var d = new Date(iso), p = function (n) { return String(n).padStart(2, "0"); };
        return d.getFullYear() + "-" + p(d.getMonth() + 1) + "-" + p(d.getDate()) + "T" + p(d.getHours()) + ":" + p(d.getMinutes());
    }
    function toIso(v) { var d = new Date(v); return isNaN(d.getTime()) ? "" : d.toISOString(); }

    /* ------------------------------------------------------------ */
    /* Field definitions — the only thing that differs per record     */
    /* ------------------------------------------------------------ */

    function groupOptions() {
        return [{ value: "", label: "— none —" }].concat(state.groups.map(function (g) {
            return { value: g.groupId, label: g.name };
        }));
    }

    var FIELDS = {
        member: function () {
            return [
                { k: "firstName", label: "First name", type: "text" },
                { k: "lastName", label: "Last name", type: "text" },
                { k: "method", label: "Contact by", type: "select", required: true,
                  options: [{ value: "email", label: "Email" }, { value: "sms", label: "Text" }, { value: "both", label: "Both" }] },
                { k: "email", label: "Email address", type: "email" },
                { k: "phone", label: "Mobile number", type: "tel" },
                { k: "area", label: "Neighborhood", type: "text" },
                { k: "zip", label: "ZIP code", type: "text" },
                { k: "groupId", label: "Firewise group", type: "select", options: groupOptions() },
                { k: "interest", label: "Interested in", type: "select", options: [
                    { value: "updates", label: "Alliance updates" }, { value: "firewise", label: "Starting or renewing a Firewise community" },
                    { value: "presentation", label: "A presentation" }, { value: "evacuation", label: "Evacuation planning" },
                    { value: "volunteer", label: "Volunteering" }, { value: "other", label: "Something else" }] },
                { k: "notes", label: "Notes (board only)", type: "textarea" },
                { k: "consentNote", label: "How consent was obtained", type: "text", newOnly: true, required: true,
                  hint: "Required when adding someone by hand — e.g. \"signed up on paper at the 14 Oct meeting\". It is stored with their record as the consent evidence." }
            ];
        },
        group: function () {
            return [
                { k: "name", label: "Group name", type: "text", required: true },
                { k: "status", label: "Status", type: "select", required: true, options: [
                    { value: "prospective", label: "Prospective — interested, not started" },
                    { value: "in-progress", label: "In progress — working towards recognition" },
                    { value: "recognized", label: "Recognized Firewise USA site" },
                    { value: "lapsed", label: "Lapsed — was recognized, renewal overdue" },
                    { value: "inactive", label: "Inactive — hide from the sign-up form" }] },
                { k: "city", label: "City", type: "text", hint: "Austin, Lago Vista, Jonestown, and so on. Shown to visitors on the sign-up form.", row: "place" },
                { k: "zips", label: "ZIP codes", type: "text", hint: "Comma separated.", row: "place" },
                { k: "area", label: "Area it covers", type: "text", hint: "Streets, subdivision, or boundaries as a resident would describe them." },
                { k: "households", label: "Number of households", type: "number", row: "counts",
                  hint: "How many homes the group covers \u2014 the figure it reports to Firewise USA.", min: "0" },
                { k: "recognizedYear", label: "Year recognized", type: "number", row: "counts",
                  hint: "Optional. Leave it blank if the date is not to hand.", min: "2000" },
                { k: "renewalDue", label: "Renewal due", type: "datetime-local", row: "recognition",
                  hint: "Firewise USA recognition has to be renewed. Past it, move the group to Lapsed." },
                { k: "website", label: "Website", type: "url", hint: "Must start with https://" },
                { k: "about", label: "About the group", type: "textarea" },
                { k: "notes", label: "Notes (board only)", type: "textarea" },
                { k: "leaders", label: "This group's own board and contacts", type: "leaders" }
            ];
        },
        person: function () {
            return [
                { k: "firstName", label: "First name", type: "text", required: true },
                { k: "lastName", label: "Last name", type: "text", required: true },
                { k: "role", label: "Role", type: "text", row: "service",
                  hint: "Chair, treasurer, secretary, member at large…" },
                { k: "status", label: "Status", type: "select", required: true, row: "service", options: [
                    { value: "current", label: "Current board member" }, { value: "past", label: "Past board member" }] },
                { k: "termStart", label: "Term started", type: "datetime-local", row: "term" },
                { k: "termEnd", label: "Term ended", type: "datetime-local", row: "term",
                  hint: "Required for a past board member." },
                { k: "email", label: "Email address", type: "email" },
                { k: "phone", label: "Phone", type: "tel" },
                { k: "groupId", label: "Their Firewise group", type: "select", options: groupOptions() },
                { k: "notes", label: "Notes", type: "textarea" }
            ];
        },
        comm: function () {
            return [
                { k: "name", label: "Name (for your list, not sent)", type: "text", required: true },
                { k: "audience", label: "Send to", type: "select", required: true, row: "how", options: [
                    { value: "email", label: "Email subscribers" }, { value: "sms", label: "Text subscribers" }, { value: "all", label: "Everyone" }] },
                { k: "urgency", label: "Kind of message", type: "select", required: true, row: "how", options: [
                    { value: "routine", label: "Routine — meetings, events, reminders" },
                    { value: "emergency", label: "Emergency — active threat to life or property" }],
                  hint: "Routine texts wait for 8am–9pm Central. An emergency goes at once, at any hour. Only use it for an evacuation, a fire closing a road, or where the shelter is — telling the phone companies a meeting reminder is an emergency is what costs an organization its number." },
                { k: "emailSubject", label: "Email subject", type: "text" },
                { k: "emailBody", label: "Email message", type: "textarea",
                  help: "markdown", helpLabel: "What is Markdown?",
                  hint: "You can use Markdown for headings, bold and bullet points — press \u201cWhat is Markdown?\u201d above for what to type. Plain sentences are fine too. The unsubscribe link and our postal address are added automatically." },
                { k: "smsBody", label: "Text message", type: "textarea", hint: "\"Reply STOP to stop\" is added automatically. Watch the segment count — a long text sends as several." },
                { k: "sendAt", label: "Send at (leave blank for immediately)", type: "datetime-local",
                  hint: "Leave blank and it goes as soon as somebody approves it and presses Send. " +
                        "A routine text can only be scheduled between 8am and 9pm Central — a time outside " +
                        "that is refused. If the window closes before it actually goes out, the email still " +
                        "goes and the text waits until the morning by itself. An emergency ignores all of this." }
            ];
        }
    };

    /* ------------------------------------------------------------ */
    /* Editor dialog                                                 */
    /* ------------------------------------------------------------ */

    function field(f, value) {
        var id = "f_" + f.k;
        var wrap = el("div", { class: "field" });
        var label = el("label", { for: id, text: f.label + (f.required ? "" : " (optional)") });
        // A field that accepts Markdown gets the same way in to the same
        // examples the news editor offers, rather than a hint telling people
        // about a notation and leaving them to find out what it is.
        if (f.help) {
            var pill = el("button", { type: "button", class: "pill", text: f.helpLabel || "Help" });
            pill.addEventListener("click", function () {
                if (window.AAFA_ADMIN && window.AAFA_ADMIN.openHelp) window.AAFA_ADMIN.openHelp(f.help);
            });
            label.appendChild(document.createTextNode(" "));
            label.appendChild(pill);
        }
        wrap.appendChild(label);

        var input;
        if (f.type === "textarea") {
            input = el("textarea", { id: id, rows: "6" });
            input.value = value || "";
        } else if (f.type === "select") {
            input = el("select", { id: id });
            f.options.forEach(function (o) {
                var opt = el("option", { value: o.value, text: o.label });
                if (String(value || "") === String(o.value)) opt.selected = true;
                input.appendChild(opt);
            });
        } else if (f.type === "leaders") {
            return leadersField(value || []);
        } else {
            input = el("input", { type: f.type, id: id });
            if (f.min != null) input.setAttribute("min", f.min);
            if (f.type === "number") input.setAttribute("inputmode", "numeric");
            input.value = f.type === "datetime-local" ? localInput(value) : (value == null ? "" : value);
        }
        wrap.appendChild(input);
        if (f.hint) wrap.appendChild(el("p", { class: "hint", text: f.hint }));
        return wrap;
    }

    /* Matches splitName in the Lambda: a stored single name is read as first
       plus last, with the last word taken as the surname, and is only written
       back once somebody saves the form. */
    function splitPersonName(p) {
        if (p.firstName || p.lastName) return { firstName: p.firstName || "", lastName: p.lastName || "" };
        var whole = String(p.name || "").trim();
        if (!whole) return { firstName: "", lastName: "" };
        var i = whole.lastIndexOf(" ");
        return i < 0 ? { firstName: whole, lastName: "" }
                     : { firstName: whole.slice(0, i).trim(), lastName: whole.slice(i + 1).trim() };
    }

    /* The other direction: whatever is stored, read back as one name. */
    function wholePersonName(p) {
        var parts = splitPersonName(p);
        return [parts.firstName, parts.lastName].filter(Boolean).join(" ");
    }

    /* A Firewise group's own officers -- its chair, its contacts -- which are
       nothing to do with the Alliance's board of directors on the Board tab.
       Two different sets of people, and the wording says so everywhere they
       appear, because a name in the wrong list is not obviously wrong.

       A repeating group, so it gets its own control rather than being
       squeezed into a text box people would have to format. */
    function leadersField(leaders) {
        var wrap = el("div", { class: "field" });
        wrap.appendChild(el("label", { text: "This group's own board and contacts (optional)" }));
        var list = el("div", { id: "leaders-list", class: "leaders" });
        function row(l) {
            var r = el("div", { class: "leader-row" }, [
                el("input", { type: "text", placeholder: "First name", "aria-label": "First name", "data-lk": "firstName" }),
                el("input", { type: "text", placeholder: "Last name", "aria-label": "Last name", "data-lk": "lastName" }),
                el("input", { type: "text", placeholder: "Role", "aria-label": "Role", "data-lk": "role" }),
                el("input", { type: "email", placeholder: "Email", "aria-label": "Email", "data-lk": "email" }),
                el("input", { type: "tel", placeholder: "Phone", "aria-label": "Phone", "data-lk": "phone" }),
                el("button", { type: "button", class: "btn btn-outline btn-small", text: "Remove" })
            ]);
            // Older rows hold one name; split it so an existing group opens
            // with the pieces in the right boxes.
            var parts = splitPersonName(l);
            var ins = r.querySelectorAll("input");
            ins[0].value = parts.firstName; ins[1].value = parts.lastName;
            ins[2].value = l.role || ""; ins[3].value = l.email || ""; ins[4].value = l.phone || "";
            r.querySelector("button").addEventListener("click", function () { r.remove(); });
            return r;
        }
        (leaders.length ? leaders : []).forEach(function (l) { list.appendChild(row(l)); });
        wrap.appendChild(list);
        var add = el("button", { type: "button", class: "btn btn-outline btn-small", text: "+ Add a person" });
        add.addEventListener("click", function () { list.appendChild(row({})); });
        wrap.appendChild(add);
        wrap.appendChild(el("p", { class: "hint", text: "The neighborhood group's own officers — not the Alliance board, which is kept on the Board tab. Names and contact details here are never shown on the public site." }));
        return wrap;
    }

    function openEditor(kind, record) {
        current = { kind: kind, record: record || {} };
        var isNew = !record;
        var defs = FIELDS[kind]().filter(function (f) { return !f.newOnly || isNew; });
        var form = $("rec-form");
        form.textContent = "";
        // Consecutive fields marked with the same row sit side by side. A ZIP
        // and a count of houses are both short, and a short box stretched the
        // width of the page reads as though it wants a sentence.
        for (var i = 0; i < defs.length; i++) {
            var f = defs[i];
            if (f.row && defs[i + 1] && defs[i + 1].row === f.row) {
                var pair = el("div", { class: "admin-two" });
                pair.appendChild(field(f, current.record[f.k]));
                pair.appendChild(field(defs[i + 1], current.record[defs[i + 1].k]));
                form.appendChild(pair);
                i++;
                continue;
            }
            form.appendChild(field(f, current.record[f.k]));
        }

        var titles = { member: "member", group: "Firewise group", person: "board member", comm: "message" };
        $("rec-title").textContent = (isNew ? "Add a " : "Edit ") + titles[kind];
        $("rec-delete").hidden = isNew;
        $("rec-msg").className = "form-status";
        showEditor(kind);
        var first = form.querySelector("input, select, textarea");
        if (first) first.focus();
    }

    /* The editor takes the place of the list it was opened from, rather than
       floating over it. Both are full-width screens in the same section, so
       going in and coming back is the same movement as the news editor. */
    function showEditor(kind) {
        var sec = $("section-" + sectionFor(kind));
        if (sec) sec.hidden = true;
        $("rec-screen").hidden = false;
        window.scrollTo(0, 0);
    }

    function closeEditor() {
        $("rec-screen").hidden = true;
        $("rec-form").textContent = "";
        // Go back to the section the tabs say we are in, not the one the
        // record belongs to. They are normally the same, but if anything has
        // moved on underneath -- a tab pressed while the editor was open --
        // trusting the record's kind would show two sections at once.
        var tab = document.querySelector('.admin-nav .tab[data-section][aria-current="page"]');
        var name = tab ? tab.getAttribute("data-section") : null;
        ["content", "home", "members", "comms", "groups", "board"].forEach(function (n) {
            var sec = $("section-" + n);
            if (sec) sec.hidden = n !== name;
        });
        window.scrollTo(0, 0);
    }

    function collect() {
        var kind = current.kind, isNew = !current.record[idKey(kind)];
        var defs = FIELDS[kind]().filter(function (f) { return !f.newOnly || isNew; });
        var out = {};
        defs.forEach(function (f) {
            if (f.type === "leaders") {
                out.leaders = Array.prototype.map.call(document.querySelectorAll("#leaders-list .leader-row"), function (r) {
                    var v = {};
                    Array.prototype.forEach.call(r.querySelectorAll("input"), function (i) { v[i.getAttribute("data-lk")] = i.value.trim(); });
                    return v;
                }).filter(function (v) { return v.firstName || v.lastName; });
                return;
            }
            var e = $("f_" + f.k);
            if (!e) return;
            var v = e.value;
            if (f.type === "datetime-local") v = v ? toIso(v) : "";
            out[f.k] = typeof v === "string" ? v.trim() : v;
        });
        return out;
    }

    function idKey(kind) {
        return kind === "member" ? "memberId" : kind === "group" ? "groupId" : kind === "person" ? "personId" : "commId";
    }
    function basePath(kind) {
        return kind === "member" ? "/members" : kind === "group" ? "/groups" : kind === "person" ? "/board" : "/comms";
    }

    function saveRecord() {
        var kind = current.kind, id = current.record[idKey(kind)];
        var body = collect();
        $("rec-save").disabled = true;
        $("rec-msg").className = "form-status show info";
        $("rec-msg").textContent = "Saving…";
        api(id ? "PUT" : "POST", basePath(kind) + (id ? "/" + id : ""), body)
            .then(function (j) {
                closeEditor();
                var who = body.name || [body.firstName, body.lastName].filter(Boolean).join(" ") || body.email || body.phone || "The record";
                var extra = "";
                if (j.confirmationsSent && j.confirmationsSent.length) {
                    extra = " A confirmation was sent by " + j.confirmationsSent.join(" and ") +
                            " — they are not on the list until they confirm it.";
                } else if (kind === "member" && !id) {
                    extra = " They are not on the list until they confirm.";
                }
                // A confirmation that could not be sent is said plainly. The
                // record is saved either way, and the two must not be confused:
                // a failed message once reported itself as a failed save.
                if (j.confirmationsFailed && j.confirmationsFailed.length) {
                    extra += " The record is saved, but the confirmation could not be sent by " +
                             j.confirmationsFailed.map(function (f) { return f.channel; }).join(" or ") +
                             ": " + j.confirmationsFailed[0].reason +
                             " Use Resend once that is sorted out.";
                }
                notify(id ? "Saved" : "Added",
                    "\u201c" + who + "\u201d has been " + (id ? "updated." : "added as a " + LABEL[kind] + ".") + extra);
                return refresh(kind);
            })
            .catch(function (e) { $("rec-msg").className = "form-status show err"; $("rec-msg").textContent = e.message; })
            .finally(function () { $("rec-save").disabled = false; });
    }

    function deleteRecord() {
        var kind = current.kind, id = current.record[idKey(kind)];
        var what = current.record.name || current.record.email || "this record";
        var extra = kind === "group" ? "\n\nAnyone who chose this group keeps their sign-up; only the group link is removed."
                  : kind === "person" ? "\n\nThis does not remove their website login, if they have one."
                  : "";
        if (!window.confirm("Delete " + what + "?" + extra)) return;
        api("DELETE", basePath(kind) + "/" + id).then(function (j) {
            closeEditor();
            var tail = j.message ? " " + j.message
                : j.membersUpdated ? " " + j.membersUpdated + " sign-up(s) were kept, with the group removed from them."
                : "";
            notify("Deleted", "\u201c" + what + "\u201d has been removed." + tail);
            return refresh(kind);
        }).catch(function (e) { $("rec-msg").className = "form-status show err"; $("rec-msg").textContent = e.message; });
    }

    function sectionFor(kind) { return kind === "member" ? "members" : kind === "group" ? "groups" : kind === "person" ? "board" : "comms"; }

    function notify(title, text) {
        if (window.AAFA_ADMIN && window.AAFA_ADMIN.notify) window.AAFA_ADMIN.notify(title, text);
        else window.alert(title + "\n\n" + text);   // never fail silently
    }

    var LABEL = { member: "member", group: "Firewise group", person: "board member", comm: "message" };

    /* ------------------------------------------------------------ */
    /* Lists                                                         */
    /* ------------------------------------------------------------ */

    function badge(text, cls) { return el("span", { class: "badge " + (cls || ""), text: text }); }

    function renderMembers() {
        var root = $("member-list"); root.textContent = "";
        var q = ($("member-search").value || "").toLowerCase().trim();
        var groups = {}; state.groups.forEach(function (g) { groups[g.groupId] = g.name; });
        var rows = state.members.filter(function (m) {
            if (!q) return true;
            return [m.name, m.email, m.phone, m.area, m.zip].join(" ").toLowerCase().indexOf(q) >= 0;
        });

        var counts = { confirmed: 0, pending: 0, unsubscribed: 0, bounced: 0, email: 0, sms: 0 };
        state.members.forEach(function (m) {
            counts[m.status] = (counts[m.status] || 0) + 1;
            if (m.emailStatus === "confirmed") counts.email++;
            if (m.smsStatus === "confirmed") counts.sms++;
        });
        $("member-counts").textContent = state.members.length + " people · " + counts.confirmed + " confirmed (" +
            counts.email + " reachable by email, " + counts.sms + " by text) · " + counts.pending + " not yet confirmed · " +
            counts.unsubscribed + " unsubscribed" + (counts.bounced ? " · " + counts.bounced + " bad address" : "");

        if (!rows.length) {
            root.appendChild(el("p", { class: "hint", text: state.members.length ? "Nobody matches that search." : "Nobody has signed up yet." }));
            return;
        }
        rows.forEach(function (m) {
            var bits = [];
            if (m.email) bits.push(m.email + (m.emailStatus === "confirmed" ? "" : " (" + m.emailStatus + ")"));
            if (m.phone) bits.push(m.phone + (m.smsStatus === "confirmed" ? "" : " (" + (m.smsStatus || "none") + ")"));
            if (m.area) bits.push(m.area);
            if (m.zip) bits.push(m.zip);
            if (m.groupId) bits.push(groups[m.groupId] || "(deleted group)");
            var card = el("div", { class: "item " + m.status }, [
                el("div", null, [
                    el("h3", null, [badge(m.status, m.status), m.name || "(no name)"]),
                    el("p", { class: "meta", text: bits.join(" · ") }),
                    el("p", { class: "meta", text: "Joined " + fmt(m.createdAt) + (m.confirmedAt ? " · confirmed " + fmt(m.confirmedAt) : "") })
                ]),
                el("div", { class: "item-actions" })
            ]);
            var acts = card.querySelector(".item-actions");
            var edit = el("button", { type: "button", class: "btn btn-outline btn-small", text: "Edit" });
            edit.addEventListener("click", function () { openEditor("member", m); });
            acts.appendChild(edit);
            if (m.status === "pending") {
                var resend = el("button", { type: "button", class: "btn btn-outline btn-small", text: "Resend" });
                resend.addEventListener("click", function () {
                    resend.disabled = true;
                    api("POST", "/members/" + m.memberId + "/resend").then(function (j) { notify("Confirmation resent", j.message); })
                        .catch(function (e) { window.alert(e.message); }).finally(function () { resend.disabled = false; });
                });
                acts.appendChild(resend);
            }
            if (m.status === "confirmed") {
                var un = el("button", { type: "button", class: "btn btn-outline btn-small", text: "Unsubscribe" });
                un.addEventListener("click", function () {
                    if (!window.confirm("Unsubscribe " + (m.name || m.email || "this person") + "? They stop receiving messages but their record is kept.")) return;
                    api("POST", "/members/" + m.memberId + "/unsubscribe").then(function () {
                        notify("Unsubscribed", "\u201c" + (m.name || m.email || "That person") + "\u201d will not receive further messages. Their record is kept so they are not added back by mistake.");
                        return refresh("member");
                    }).catch(function (e) { window.alert(e.message); });
                });
                acts.appendChild(un);
            }
            root.appendChild(card);
        });
    }

    function renderGroups() {
        var root = $("group-list"); root.textContent = "";
        if (!state.groups.length) {
            root.appendChild(el("p", { class: "hint", text: "No Firewise groups yet. Add one and it appears in the drop-down on the sign-up form." }));
            return;
        }
        var counts = {};
        state.members.forEach(function (m) { if (m.groupId) counts[m.groupId] = (counts[m.groupId] || 0) + 1; });
        state.groups.forEach(function (g) {
            var bits = [];
            if (g.city) bits.push(g.city);
            if (g.area) bits.push(g.area);
            if (g.households) bits.push(g.households + " households");
            if (g.recognizedYear) bits.push("recognized " + g.recognizedYear);
            if (g.renewalDue) bits.push("renewal due " + fmt(g.renewalDue));
            var leaders = (g.leaders || []).map(function (l) { return wholePersonName(l) + (l.role ? " (" + l.role + ")" : ""); }).filter(Boolean).join(", ");
            var card = el("div", { class: "item " + (g.status === "recognized" ? "live" : g.status === "lapsed" ? "scheduled" : "draft") }, [
                el("div", null, [
                    el("h3", null, [badge(g.status, g.status === "recognized" ? "live" : ""), g.name]),
                    el("p", { class: "meta", text: bits.join(" · ") }),
                    el("p", { class: "meta", text: (leaders ? "Their board: " + leaders + " · " : "") + (counts[g.groupId] || 0) + " sign-up(s)" })
                ]),
                el("div", { class: "item-actions" })
            ]);
            var edit = el("button", { type: "button", class: "btn btn-outline btn-small", text: "Edit" });
            edit.addEventListener("click", function () { openEditor("group", g); });
            card.querySelector(".item-actions").appendChild(edit);
            root.appendChild(card);
        });
    }

    function renderBoard() {
        var root = $("person-list"); root.textContent = "";
        var groups = {}; state.groups.forEach(function (g) { groups[g.groupId] = g.name; });
        $("board-note").textContent = "The Alliance's own board of directors. A Firewise group's officers are kept on that group's record, under Firewise groups. " +
            "A board record and a website login are separate things. " +
            "Adding someone here does not give them access to edit the site, and removing them does not take it away — " +
            "that is done separately, by whoever manages the AWS account.";
        if (!state.board.length) {
            root.appendChild(el("p", { class: "hint", text: "No board members recorded yet." }));
            return;
        }
        state.board.forEach(function (p) {
            var bits = [];
            if (p.email) bits.push(p.email);
            if (p.phone) bits.push(p.phone);
            if (p.groupId) bits.push(groups[p.groupId] || "(deleted group)");
            if (p.termStart) bits.push("since " + fmt(p.termStart));
            if (p.termEnd) bits.push("until " + fmt(p.termEnd));
            var hasLogin = p.email && state.logins.indexOf(p.email) >= 0;
            var card = el("div", { class: "item " + (p.status === "current" ? "live" : "draft") }, [
                el("div", null, [
                    el("h3", null, [badge(p.status === "current" ? "current" : "past", p.status === "current" ? "live" : ""), (wholePersonName(p) || "(no name)") + (p.role ? " — " + p.role : "")]),
                    el("p", { class: "meta", text: bits.join(" · ") }),
                    el("p", { class: "meta", text: hasLogin ? "Has a website login" : "No website login" })
                ]),
                el("div", { class: "item-actions" })
            ]);
            var edit = el("button", { type: "button", class: "btn btn-outline btn-small", text: "Edit" });
            edit.addEventListener("click", function () { openEditor("person", p); });
            card.querySelector(".item-actions").appendChild(edit);
            root.appendChild(card);
        });
    }

    /* Show the message exactly as the sender would build it. */
    function previewComm(c) {
        api("POST", "/comms/" + c.commId + "/preview")
            .then(function (j) {
                $("msg-preview-title").textContent = "Preview: " + (j.name || "message") + " — nothing has been sent";
                $("msg-preview-note").textContent =
                    "This is what the sender will produce, built by the same code that sends it. " +
                    "The unsubscribe and manage links are signed for you, so do not follow them from here — " +
                    "they would unsubscribe your own record.";

                var hasSms = !!j.smsText;
                $("msg-preview-sms").hidden = !hasSms;
                if (hasSms) {
                    $("msg-preview-smstext").textContent = j.smsText;
                    var seg = j.smsSegments || {};
                    $("msg-preview-segments").textContent =
                        (seg.chars || j.smsText.length) + " characters · " +
                        (seg.segments || "?") + " message" + (seg.segments === 1 ? "" : "s") +
                        (seg.encoding ? " · " + seg.encoding : "");
                }

                var hasEmail = !!j.emailHtml;
                $("msg-preview-email").hidden = !hasEmail;
                if (hasEmail) {
                    $("msg-preview-subject").textContent = j.emailSubject || "(no subject)";
                    // srcdoc into a sandboxed frame: it renders, and it cannot
                    // reach this page or run anything.
                    $("msg-preview-frame").srcdoc = j.emailHtml;
                }
                $("msg-preview-modal").hidden = false;
                $("msg-preview-close").focus();
            })
            .catch(function (e) { window.alert(e.message); });
    }

    var COMM_STATE = {
        draft: "Draft", review: "Waiting for review", approved: "Approved — ready to send",
        rejected: "Changes requested", scheduled: "Scheduled", sending: "Sending…", sent: "Sent"
    };

    function renderComms() {
        var root = $("comm-list"); root.textContent = "";
        if (!state.comms.length) {
            root.appendChild(el("p", { class: "hint", text: "No messages yet." }));
            return;
        }
        var me = (window.AAFA_ADMIN && window.AAFA_ADMIN.email) || "";
        state.comms.forEach(function (c) {
            var bits = [COMM_STATE[c.status] || c.status];
            if (c.urgency === "emergency") bits.push("EMERGENCY");
            bits.push(c.audience === "all" ? "everyone" : c.audience === "email" ? "email only" : "text only");
            if (c.author) bits.push("by " + c.author);
            if (c.approver && c.status !== "rejected") bits.push("approved by " + c.approver);
            if (c.sentAt) bits.push("sent " + fmt(c.sentAt, true));
            if (c.counts) bits.push(c.counts.sent + " sent, " + c.counts.failed + " failed");

            var cls = c.status === "sent" ? "live" : c.status === "review" ? "scheduled" : "draft";
            var card = el("div", { class: "item " + cls }, [
                el("div", null, [
                    el("h3", null, [badge(COMM_STATE[c.status] || c.status, cls), c.name]),
                    el("p", { class: "meta", text: bits.join(" · ") }),
                    c.decisionNote ? el("p", { class: "meta", text: "Note: " + c.decisionNote }) : null
                ]),
                el("div", { class: "item-actions" })
            ]);
            var acts = card.querySelector(".item-actions");

            function act(label, path, confirmText, cls2) {
                var b = el("button", { type: "button", class: "btn " + (cls2 || "btn-outline") + " btn-small", text: label });
                b.addEventListener("click", function () {
                    if (confirmText && !window.confirm(confirmText)) return;
                    var note = null;
                    if (path.indexOf("/reject") >= 0) {
                        note = window.prompt("What needs to change? The author will see this.");
                        if (!note) return;
                    }
                    b.disabled = true;
                    api("POST", "/comms/" + c.commId + path, note ? { note: note } : undefined)
                        .then(function (j) {
                            var titles = {
                                "/submit": "Sent for review", "/approve": "Approved", "/reject": "Changes requested",
                                "/withdraw": "Withdrawn", "/test": "Test sent", "/send": "Sending"
                            };
                            var texts = {
                                "/submit": "\u201c" + c.name + "\u201d is waiting for another board member to approve it. You cannot approve your own message.",
                                "/approve": "\u201c" + c.name + "\u201d is approved and ready to send. Nothing goes out until someone presses Send.",
                                "/reject": "\u201c" + c.name + "\u201d has gone back to the author with your note.",
                                "/withdraw": "\u201c" + c.name + "\u201d is a draft again and can be edited.",
                                "/test": j.message || "Test sent to you only.",
                                "/send": j.message || "Sending has started."
                            };
                            notify(titles[path] || "Done", texts[path] || j.message || "Done.");
                            return refresh("comm");
                        })
                        .catch(function (e) { window.alert(e.message); b.disabled = false; });
                });
                acts.appendChild(b);
            }

            // Reading it should come before testing it: a test needs email to
            // be working and lands in somebody's inbox. Available in every
            // state, including after sending, so "what did we actually send?"
            // has an answer.
            var prev = el("button", { type: "button", class: "btn btn-outline btn-small", text: "Preview" });
            prev.addEventListener("click", function () { previewComm(c); });
            acts.appendChild(prev);

            if (["draft", "rejected"].indexOf(c.status) >= 0) {
                var edit = el("button", { type: "button", class: "btn btn-outline btn-small", text: "Edit" });
                edit.addEventListener("click", function () { openEditor("comm", c); });
                acts.appendChild(edit);
                act("Send me a test", "/test");
                act("Submit for review", "/submit");
            } else if (c.status === "review") {
                act("Send me a test", "/test");
                if (c.author === me || c.submittedBy === me) {
                    act("Withdraw", "/withdraw");
                    // It said who approves and stopped, leaving the author with
                    // no Edit button and nothing explaining where it went. A
                    // message under review cannot be edited on purpose -- the
                    // approver has to be reading what actually goes out -- so
                    // say that, and say the way back.
                    acts.appendChild(el("span", { class: "meta", text:
                        "Another board member approves this — you cannot approve your own. " +
                        "To change it, press Withdraw: it becomes a draft you can edit again." }));
                } else {
                    act("Approve", "/approve", null, "btn-green");
                    act("Request changes", "/reject");
                }
            } else if (c.status === "approved") {
                act("Send me a test", "/test");
                var to = (c.audience === "sms" ? "" : "email subscribers") + (c.audience === "all" ? " and " : "") + (c.audience === "email" ? "" : "text subscribers");
                act("Send now", "/send", "Send this message to " + to.trim() + "?\n\nIt cannot be recalled.", "btn-primary");
            }
            if (c.status === "sent") {
                var dup = el("button", { type: "button", class: "btn btn-outline btn-small", text: "Duplicate" });
                dup.addEventListener("click", function () {
                    api("POST", "/comms/" + c.commId + "/duplicate").then(function (j) {
                        notify("Duplicated", "A new draft has been created from \u201c" + c.name + "\u201d. The original is unchanged.");
                        return refresh("comm");
                    }).catch(function (e) { window.alert(e.message); });
                });
                acts.appendChild(dup);
            }
            root.appendChild(card);
        });
    }

    /* ------------------------------------------------------------ */
    /* Loading and section switching                                 */
    /* ------------------------------------------------------------ */

    var LOADERS = {
        members: function () { return api("GET", "/members").then(function (j) { state.members = j.members || []; }); },
        groups: function () { return api("GET", "/groups").then(function (j) { state.groups = j.groups || []; }); },
        board: function () { return api("GET", "/board").then(function (j) { state.board = j.board || []; state.logins = j.logins || []; }); },
        comms: function () { return api("GET", "/comms").then(function (j) { state.comms = j.comms || []; }); }
    };
    var RENDER = { members: renderMembers, groups: renderGroups, board: renderBoard, comms: renderComms };

    /* Members, groups and board all show each other's names, so a section
       loads whatever it needs to display, not just its own table. */
    var NEEDS = { members: ["members", "groups"], groups: ["groups", "members"], board: ["board", "groups"], comms: ["comms"] };

    function refresh(kind) {
        var section = sectionFor(kind);
        return Promise.all(NEEDS[section].map(function (n) { return LOADERS[n](); })).then(function () { RENDER[section](); });
    }

    /* Which tab you were on, remembered across a reload.
     *
     * sessionStorage rather than localStorage or a URL hash. The tab dies with
     * the browser tab, which is exactly when the sign-in dies too, so it can
     * never restore a section for a session that has gone. A hash would not
     * survive sign-in at all: the Cognito return calls history.replaceState to
     * strip ?code=, and that takes the fragment with it.
     *
     * Wrapped because sessionStorage throws outright in some privacy settings
     * rather than returning null. Losing the memory is not worth an error. */
    var SECTION_KEY = "aafa-admin-section";

    function rememberSection(name) {
        try { sessionStorage.setItem(SECTION_KEY, name); } catch (e) { /* not remembered */ }
    }

    function lastSection() {
        try { return sessionStorage.getItem(SECTION_KEY); } catch (e) { return null; }
    }

    /* Called once the session is established and the list has loaded, so the
       restored section asks the API with a token in hand. */
    window.AAFA_ADMIN.restoreSection = function () {
        var name = lastSection();
        // "content" is already what the markup shows, so there is nothing to do.
        if (!name || name === "content") return;
        if (!$("section-" + name)) return;
        showSection(name);
    };

    function showSection(name) {
        rememberSection(name);
        $("rec-screen").hidden = true;
        ["content", "home", "members", "comms", "groups", "board"].forEach(function (n) {
            var sec = $("section-" + n);
            if (sec) sec.hidden = n !== name;
        });
        Array.prototype.forEach.call(document.querySelectorAll(".admin-nav .tab[data-section]"), function (t) {
            var on = t.getAttribute("data-section") === name;
            t.setAttribute("aria-current", on ? "page" : "false");
        });
        if (name !== "home") window.AAFA_ADMIN.leftHome();
        if (name === "content") { window.AAFA_ADMIN.showContent(); return; }
        ["screen-signin", "screen-denied", "screen-list", "screen-edit"].forEach(function (id) { if ($(id)) $(id).hidden = true; });
        // The home page is one record rather than a list, so it loads itself.
        if (name === "home") { window.AAFA_ADMIN.showHome(); window.scrollTo(0, 0); return; }
        var host = $(name === "members" ? "member-list" : name === "groups" ? "group-list" : name === "board" ? "person-list" : "comm-list");
        if (!state.loaded[name]) host.textContent = "Loading…";
        Promise.all(NEEDS[name].map(function (n) { return LOADERS[n](); }))
            .then(function () { state.loaded[name] = true; RENDER[name](); })
            .catch(function (e) { host.textContent = ""; host.appendChild(el("p", { class: "form-status show err", text: e.message })); });
        window.scrollTo(0, 0);
    }

    /* ------------------------------------------------------------ */
    /* Importing Firewise groups from a spreadsheet                  */
    /*                                                               */
    /* The board keeps the HOA list in a spreadsheet and refreshes it */
    /* occasionally. Typing forty-odd groups and their contacts back  */
    /* into the form by hand is an evening's work and a fresh chance  */
    /* to mistype an address every time.                              */
    /*                                                               */
    /* This posts each group through the same POST /groups the form   */
    /* uses, so there is one set of rules about what a valid group is */
    /* and the import cannot quietly write something the form would   */
    /* have refused. Nothing is sent until the preview has been read. */
    /* ------------------------------------------------------------ */

    /* A CSV/TSV reader that understands quoted fields containing the
       delimiter, quoted newlines, and "" as an escaped quote. Written out
       rather than split(",") because the real file has all three. */
    function parseDelimited(text, delim) {
        var rows = [], row = [], field = "", inQuotes = false, i = 0;
        text = text.replace(/^﻿/, "").replace(/\r\n?/g, "\n");
        while (i < text.length) {
            var c = text[i];
            if (inQuotes) {
                if (c === '"') {
                    if (text[i + 1] === '"') { field += '"'; i += 2; continue; }
                    inQuotes = false; i++; continue;
                }
                field += c; i++; continue;
            }
            if (c === '"') { inQuotes = true; i++; continue; }
            if (c === delim) { row.push(field); field = ""; i++; continue; }
            if (c === "\n") { row.push(field); rows.push(row); row = []; field = ""; i++; continue; }
            field += c; i++;
        }
        row.push(field);
        rows.push(row);
        return rows.filter(function (r) { return r.some(function (c) { return c.trim(); }); });
    }

    /* Tabs or commas, whichever the heading row has more of. Guessing beats
       asking: the board saves from whichever program is open. */
    function sniffDelimiter(text) {
        var head = text.split(/\r?\n/)[0] || "";
        return (head.split("\t").length > head.split(",").length) ? "\t" : ",";
    }

    var IMPORT_COLUMNS = {
        name: ["name", "group name", "group"],
        city: ["city", "town"],
        zips: ["zip code", "zip codes", "zip", "zips"],
        households: ["# households", "households", "number of households", "homes"],
        status: ["status"],
        area: ["area it covers", "area"],
        recognizedYear: ["year recognized", "recognized year"],
        firstName: ["first name", "firstname"],
        lastName: ["last name", "lastname"],
        role: ["role", "title"],
        phone: ["phone", "telephone"],
        email: ["email", "email address"],
        notes: ["notes", "note"]
    };

    var STATUS_WORDS = {
        "prospective": "prospective", "in progress": "in-progress", "in-progress": "in-progress",
        "recognized": "recognized", "lapsed": "lapsed", "inactive": "inactive"
    };

    function mapHeadings(headings) {
        var map = {};
        headings.forEach(function (h, idx) {
            var key = String(h || "").trim().toLowerCase();
            Object.keys(IMPORT_COLUMNS).forEach(function (field) {
                if (map[field] === undefined && IMPORT_COLUMNS[field].indexOf(key) >= 0) map[field] = idx;
            });
        });
        return map;
    }

    /* Rows to groups. A row with a name starts a group; a row without one
       adds a contact to the group above it, which is how the board's own
       spreadsheet already reads. */
    function rowsToGroups(rows) {
        var map = mapHeadings(rows[0]);
        if (map.name === undefined) throw new Error("No 'Name' column found in the first row.");

        var get = function (r, f) { return map[f] === undefined ? "" : String(r[map[f]] || "").trim(); };
        var groups = [], problems = [], currentG = null;
        // A word the site does not use is almost always in every row of the
        // file, so it is counted and reported once rather than forty times.
        var unknownStatus = {};

        for (var i = 1; i < rows.length; i++) {
            var r = rows[i], line = i + 1;
            var name = get(r, "name");

            if (name) {
                var statusRaw = get(r, "status").toLowerCase();
                var status = STATUS_WORDS[statusRaw] || "";
                if (statusRaw && !status) {
                    var word = get(r, "status");
                    unknownStatus[word] = (unknownStatus[word] || 0) + 1;
                }
                var hh = get(r, "households").replace(/[^\d]/g, "");
                var yr = get(r, "recognizedYear").replace(/[^\d]/g, "");
                currentG = {
                    line: line,
                    name: name,
                    city: get(r, "city"),
                    area: get(r, "area"),
                    zips: get(r, "zips"),
                    households: hh,
                    recognizedYear: yr,
                    status: status || "prospective",
                    notes: get(r, "notes"),
                    leaders: []
                };
                groups.push(currentG);
            } else if (!currentG) {
                problems.push("Line " + line + ": a contact before any group — skipped.");
                continue;
            }

            var first = get(r, "firstName"), last = get(r, "lastName");
            if (first || last) {
                currentG.leaders.push({
                    firstName: first, lastName: last,
                    role: get(r, "role"), email: get(r, "email"), phone: get(r, "phone")
                });
            } else if (!name && (get(r, "email") || get(r, "phone"))) {
                problems.push("Line " + line + ": contact details with no name — skipped.");
            }
            if (!name && get(r, "notes")) {
                currentG.notes = [currentG.notes, get(r, "notes")].filter(Boolean).join("; ");
            }
        }
        Object.keys(unknownStatus).forEach(function (word) {
            var n = unknownStatus[word];
            problems.push("Status '" + word + "' on " + n + " group" + (n === 1 ? "" : "s") +
                " is not one the site uses — they will come in as Prospective, and you can change them afterwards.");
        });

        return { groups: groups, problems: problems };
    }

    var importReady = null;

    function renderImportPreview(parsed) {
        var host = $("group-import-preview");
        host.textContent = "";

        var existing = {};
        state.groups.forEach(function (g) { existing[String(g.name || "").trim().toLowerCase()] = true; });

        var toCreate = [], skipped = [];
        parsed.groups.forEach(function (g) {
            if (existing[g.name.toLowerCase()]) { skipped.push(g); return; }
            toCreate.push(g);
        });

        var leaders = toCreate.reduce(function (n, g) { return n + g.leaders.length; }, 0);

        host.appendChild(el("p", { class: "form-status show info",
            text: toCreate.length + " group" + (toCreate.length === 1 ? "" : "s") + " to add, with " +
                  leaders + " contact" + (leaders === 1 ? "" : "s") + "." }));

        if (skipped.length) {
            host.appendChild(el("p", { class: "hint",
                text: "Already on the site, so left alone: " + skipped.map(function (g) { return g.name; }).join(", ") }));
        }
        parsed.problems.forEach(function (p) {
            host.appendChild(el("p", { class: "hint", text: p }));
        });

        var list = el("ul", { class: "import-list" });
        toCreate.slice(0, 12).forEach(function (g) {
            var where = [g.city, g.area].filter(Boolean).join(", ");
            list.appendChild(el("li", {}, [
                el("strong", { text: g.name }),
                document.createTextNode(
                    (where ? " — " + where : "") +
                    (g.households ? " · " + g.households + " households" : "") +
                    " · " + g.leaders.length + " contact" + (g.leaders.length === 1 ? "" : "s"))
            ]));
        });
        if (toCreate.length > 12) list.appendChild(el("li", { class: "hint", text: "…and " + (toCreate.length - 12) + " more." }));
        host.appendChild(list);

        importReady = toCreate;
        $("group-import-run").disabled = !importReady || !toCreate.length;
        $("group-import-run").textContent = toCreate.length ? "Import " + toCreate.length + " groups" : "Import";
    }

    function runImport() {
        var queue = importReady || [];
        var log = $("group-import-log");
        log.textContent = "";
        $("group-import-run").disabled = true;
        $("group-import-file").disabled = true;

        var status = el("p", { class: "form-status show info", text: "Adding 1 of " + queue.length + "…" });
        log.appendChild(status);
        var failures = el("ul", { class: "import-list" });
        log.appendChild(failures);

        var done = 0, failed = 0;

        // One at a time, on purpose: a volunteer site's API is not the place
        // for forty parallel writes, and a sequential run makes the log read
        // in the same order as the file.
        function step() {
            if (!queue.length) {
                status.className = "form-status show " + (failed ? "err" : "ok");
                status.textContent = done + " group" + (done === 1 ? "" : "s") + " added" +
                    (failed ? ", " + failed + " failed — see below." : ".");
                $("group-import-file").disabled = false;
                return refresh("group").then(function () { renderGroups(); });
            }
            var g = queue.shift();
            status.textContent = "Adding " + (done + failed + 1) + " of " + (done + failed + 1 + queue.length) + ": " + g.name;

            var body = {
                name: g.name, status: g.status,
                city: g.city || undefined,
                area: g.area || undefined,
                zips: g.zips || "",
                households: g.households || "",
                recognizedYear: g.recognizedYear || "",
                notes: g.notes || undefined,
                leaders: g.leaders
            };
            return api("POST", "/groups", body)
                .then(function () { done++; })
                .catch(function (e) {
                    failed++;
                    failures.appendChild(el("li", {}, [
                        el("strong", { text: g.name }), document.createTextNode(" (line " + g.line + "): " + e.message)
                    ]));
                })
                .then(step);
        }
        step();
    }

    function openImport() {
        $("group-import").hidden = false;
        $("group-import-preview").textContent = "";
        $("group-import-log").textContent = "";
        $("group-import-file").value = "";
        $("group-import-file").disabled = false;
        $("group-import-run").disabled = true;
        importReady = null;
    }

    /* ------------------------------------------------------------ */
    /* Wiring                                                        */
    /* ------------------------------------------------------------ */

    $("group-import-open").addEventListener("click", openImport);
    $("group-import-cancel").addEventListener("click", function () { $("group-import").hidden = true; });
    $("group-import-run").addEventListener("click", runImport);
    $("group-import-file").addEventListener("change", function (e) {
        var file = e.target.files && e.target.files[0];
        if (!file) return;
        var reader = new FileReader();
        reader.onload = function () {
            try {
                var text = String(reader.result || "");
                var rows = parseDelimited(text, sniffDelimiter(text));
                if (rows.length < 2) throw new Error("That file has headings but no rows under them.");
                renderImportPreview(rowsToGroups(rows));
            } catch (err) {
                $("group-import-preview").textContent = "";
                $("group-import-preview").appendChild(el("p", { class: "form-status show err", text: err.message }));
                $("group-import-run").disabled = true;
            }
        };
        reader.readAsText(file);
    });

    /* [data-section] matters. Training and Help are .tab elements too, and
       getAttribute returns null for a missing attribute — so an unfiltered
       selector wired them to showSection(null), which hid every section and
       then, because null === null, handed aria-current="page" to Training and
       Help instead of the real tab. Everything that asks "which tab is
       current" read Training back, found no lesson for a section named null,
       and hid the Training button until another tab was clicked. */
    Array.prototype.forEach.call(document.querySelectorAll(".admin-nav .tab[data-section]"), function (t) {
        t.addEventListener("click", function () { showSection(t.getAttribute("data-section")); });
    });

    $("member-new").addEventListener("click", function () { openEditor("member", null); });
    $("group-new").addEventListener("click", function () { openEditor("group", null); });
    $("person-new").addEventListener("click", function () { openEditor("person", null); });
    $("comm-new").addEventListener("click", function () { openEditor("comm", null); });
    $("member-search").addEventListener("input", renderMembers);

    $("member-export").addEventListener("click", function () {
        var token = window.AAFA_ADMIN.token();
        fetch(API + "/members/export", { headers: { Authorization: "Bearer " + token } })
            .then(function (r) { return r.text(); })
            .then(function (csv) {
                var a = document.createElement("a");
                a.href = URL.createObjectURL(new Blob([csv], { type: "text/csv" }));
                a.download = "members-" + new Date().toISOString().slice(0, 10) + ".csv";
                a.click(); URL.revokeObjectURL(a.href);
            })
            .catch(function (e) { window.alert(e.message); });
    });

    $("msg-preview-close").addEventListener("click", function () {
        $("msg-preview-modal").hidden = true;
        $("msg-preview-frame").removeAttribute("srcdoc");
    });
    document.addEventListener("keydown", function (e) {
        if (e.key === "Escape" && !$("msg-preview-modal").hidden) $("msg-preview-close").click();
    });

    $("rec-cancel").addEventListener("click", closeEditor);
    $("rec-back").addEventListener("click", closeEditor);
    $("rec-save").addEventListener("click", saveRecord);
    $("rec-delete").addEventListener("click", deleteRecord);
})();

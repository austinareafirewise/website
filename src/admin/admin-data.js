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
                { k: "area", label: "Area it covers", type: "text", hint: "Streets, subdivision, or boundaries as a resident would describe them." },
                { k: "zips", label: "ZIP codes", type: "text", hint: "Comma separated.", row: "area" },
                { k: "households", label: "Number of households", type: "number", row: "area",
                  hint: "How many homes the group covers \u2014 the figure it reports to Firewise USA.", min: "0" },
                { k: "recognizedYear", label: "Year recognized", type: "number", row: "recognition",
                  hint: "Required if the status is Recognized.", min: "2000" },
                { k: "renewalDue", label: "Renewal due", type: "datetime-local", row: "recognition",
                  hint: "Firewise USA recognition has to be renewed. Past it, move the group to Lapsed." },
                { k: "website", label: "Website", type: "url", hint: "Must start with https://" },
                { k: "about", label: "About the group", type: "textarea" },
                { k: "notes", label: "Notes (board only)", type: "textarea" },
                { k: "leaders", label: "Leadership", type: "leaders" }
            ];
        },
        person: function () {
            return [
                { k: "firstName", label: "First name", type: "text", required: true },
                { k: "lastName", label: "Last name", type: "text", required: true },
                { k: "role", label: "Role", type: "text", hint: "Chair, treasurer, secretary, member at large…" },
                { k: "status", label: "Status", type: "select", required: true, options: [
                    { value: "current", label: "Current board member" }, { value: "past", label: "Past board member" }] },
                { k: "email", label: "Email address", type: "email" },
                { k: "phone", label: "Phone", type: "tel" },
                { k: "groupId", label: "Their Firewise group", type: "select", options: groupOptions() },
                { k: "termStart", label: "Term started", type: "datetime-local" },
                { k: "termEnd", label: "Term ended", type: "datetime-local", hint: "Required for a past board member." },
                { k: "notes", label: "Notes", type: "textarea" }
            ];
        },
        comm: function () {
            return [
                { k: "name", label: "Name (for your list, not sent)", type: "text", required: true },
                { k: "audience", label: "Send to", type: "select", required: true, options: [
                    { value: "email", label: "Email subscribers" }, { value: "sms", label: "Text subscribers" }, { value: "all", label: "Everyone" }] },
                { k: "emailSubject", label: "Email subject", type: "text" },
                { k: "emailBody", label: "Email message", type: "textarea", hint: "Markdown allowed. The unsubscribe link and our postal address are added automatically." },
                { k: "smsBody", label: "Text message", type: "textarea", hint: "\"Reply STOP to stop\" is added automatically. Watch the segment count — a long text sends as several." },
                { k: "sendAt", label: "Send at (leave blank for immediately)", type: "datetime-local" }
            ];
        }
    };

    /* ------------------------------------------------------------ */
    /* Editor dialog                                                 */
    /* ------------------------------------------------------------ */

    function field(f, value) {
        var id = "f_" + f.k;
        var wrap = el("div", { class: "field" });
        wrap.appendChild(el("label", { for: id, text: f.label + (f.required ? "" : " (optional)") }));

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

    /* Leadership is a repeating group, so it gets its own control rather
       than being squeezed into a text box people would have to format. */
    function leadersField(leaders) {
        var wrap = el("div", { class: "field" });
        wrap.appendChild(el("label", { text: "Leadership (optional)" }));
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
        wrap.appendChild(el("p", { class: "hint", text: "Names and contact details here are never shown on the public site." }));
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
        var tab = document.querySelector('.admin-nav .tab[aria-current="page"]');
        var name = tab ? tab.getAttribute("data-section") : null;
        ["content", "members", "comms", "groups", "board"].forEach(function (n) {
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
            if (g.area) bits.push(g.area);
            if (g.households) bits.push(g.households + " households");
            if (g.recognizedYear) bits.push("recognized " + g.recognizedYear);
            if (g.renewalDue) bits.push("renewal due " + fmt(g.renewalDue));
            var leaders = (g.leaders || []).map(function (l) { return l.name + (l.role ? " (" + l.role + ")" : ""); }).join(", ");
            var card = el("div", { class: "item " + (g.status === "recognized" ? "live" : g.status === "lapsed" ? "scheduled" : "draft") }, [
                el("div", null, [
                    el("h3", null, [badge(g.status, g.status === "recognized" ? "live" : ""), g.name]),
                    el("p", { class: "meta", text: bits.join(" · ") }),
                    el("p", { class: "meta", text: (leaders ? "Leads: " + leaders + " · " : "") + (counts[g.groupId] || 0) + " sign-up(s)" })
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
        $("board-note").textContent = "A board record and a website login are separate things. " +
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
                    el("h3", null, [badge(p.status === "current" ? "current" : "past", p.status === "current" ? "live" : ""), (p.name || [p.firstName, p.lastName].filter(Boolean).join(" ") || "(no name)") + (p.role ? " — " + p.role : "")]),
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
                    acts.appendChild(el("span", { class: "meta", text: "Someone else on the board approves this." }));
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

    function showSection(name) {
        $("rec-screen").hidden = true;
        ["content", "members", "comms", "groups", "board"].forEach(function (n) {
            var sec = $("section-" + n);
            if (sec) sec.hidden = n !== name;
        });
        Array.prototype.forEach.call(document.querySelectorAll(".admin-nav .tab"), function (t) {
            var on = t.getAttribute("data-section") === name;
            t.setAttribute("aria-current", on ? "page" : "false");
        });
        if (name === "content") { window.AAFA_ADMIN.showContent(); return; }
        ["screen-signin", "screen-denied", "screen-list", "screen-edit"].forEach(function (id) { if ($(id)) $(id).hidden = true; });
        var host = $(name === "members" ? "member-list" : name === "groups" ? "group-list" : name === "board" ? "person-list" : "comm-list");
        if (!state.loaded[name]) host.textContent = "Loading…";
        Promise.all(NEEDS[name].map(function (n) { return LOADERS[n](); }))
            .then(function () { state.loaded[name] = true; RENDER[name](); })
            .catch(function (e) { host.textContent = ""; host.appendChild(el("p", { class: "form-status show err", text: e.message })); });
        window.scrollTo(0, 0);
    }

    /* ------------------------------------------------------------ */
    /* Wiring                                                        */
    /* ------------------------------------------------------------ */

    Array.prototype.forEach.call(document.querySelectorAll(".admin-nav .tab"), function (t) {
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

    $("rec-cancel").addEventListener("click", closeEditor);
    $("rec-back").addEventListener("click", closeEditor);
    $("rec-save").addEventListener("click", saveRecord);
    $("rec-delete").addEventListener("click", deleteRecord);
})();

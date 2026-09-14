from pptx import Presentation
from pptx.util import Inches, Pt, Emu
from pptx.dml.color import RGBColor
from pptx.enum.text import PP_ALIGN, MSO_ANCHOR
from pptx.enum.shapes import MSO_SHAPE, MSO_CONNECTOR

GREEN9 = RGBColor(0x19, 0x46, 0x2B)
GREEN7 = RGBColor(0x26, 0x54, 0x38)
GREEN5 = RGBColor(0x4C, 0x78, 0x4B)
ORANGE = RGBColor(0xDA, 0x7B, 0x37)
ORANGED = RGBColor(0xA8, 0x55, 0x12)
INK    = RGBColor(0x1D, 0x2A, 0x21)
MUTED  = RGBColor(0x55, 0x66, 0x66)
PAGE   = RGBColor(0xFB, 0xFA, 0xF7)
SAGE2  = RGBColor(0xD7, 0xE0, 0xD9)
WHITE  = RGBColor(0xFF, 0xFF, 0xFF)
FONT   = "Trebuchet MS"

prs = Presentation()
prs.slide_width  = Inches(13.333)
prs.slide_height = Inches(7.5)
BLANK = prs.slide_layouts[6]

def slide():
    s = prs.slides.add_slide(BLANK)
    bg = s.shapes.add_shape(MSO_SHAPE.RECTANGLE, 0, 0, prs.slide_width, prs.slide_height)
    bg.fill.solid(); bg.fill.fore_color.rgb = PAGE; bg.line.fill.background()
    bg.shadow.inherit = False
    return s

def textbox(s, x, y, w, h, align=PP_ALIGN.LEFT):
    tb = s.shapes.add_textbox(Inches(x), Inches(y), Inches(w), Inches(h))
    tf = tb.text_frame; tf.word_wrap = True
    tf.paragraphs[0].alignment = align
    return tf

def run(p, text, size, color=INK, bold=False, italic=False):
    r = p.add_run(); r.text = text
    r.font.size = Pt(size); r.font.color.rgb = color
    r.font.bold = bold; r.font.italic = italic; r.font.name = FONT
    return r

def heading(s, title, kicker=None):
    if kicker:
        tf = textbox(s, 0.85, 0.45, 11.6, 0.4)
        run(tf.paragraphs[0], kicker.upper(), 12, GREEN5, bold=True)
        ytitle = 0.82
    else:
        ytitle = 0.6
    tf = textbox(s, 0.85, ytitle, 11.6, 1.0)
    run(tf.paragraphs[0], title, 32, GREEN9, bold=True)
    rule = s.shapes.add_shape(MSO_SHAPE.RECTANGLE, Inches(0.85), Inches(ytitle + 0.78), Inches(1.5), Pt(4))
    rule.fill.solid(); rule.fill.fore_color.rgb = ORANGE; rule.line.fill.background()
    rule.shadow.inherit = False

def footer(s, n):
    tf = textbox(s, 0.85, 6.95, 8.0, 0.35)
    run(tf.paragraphs[0], "Austin Area Firewise Alliance", 10, MUTED)
    tf = textbox(s, 11.0, 6.95, 1.5, 0.35, PP_ALIGN.RIGHT)
    run(tf.paragraphs[0], str(n), 10, MUTED)

def bullets(s, items, top=2.1, size=17, width=11.6, gap=10):
    tf = textbox(s, 0.85, top, width, 4.5)
    first = True
    for it in items:
        lead, rest = (it if isinstance(it, tuple) else (None, it))
        p = tf.paragraphs[0] if first else tf.add_paragraph()
        first = False
        p.space_after = Pt(gap)
        run(p, "▪  ", size, ORANGE, bold=True)
        if lead:
            run(p, lead, size, GREEN9, bold=True)
            run(p, "  " + rest, size, INK)
        else:
            run(p, rest, size, INK)

def note(s, text, top=5.95, height=0.85, size=14):
    box = s.shapes.add_shape(MSO_SHAPE.ROUNDED_RECTANGLE, Inches(0.85), Inches(top), Inches(11.6), Inches(height))
    box.fill.solid(); box.fill.fore_color.rgb = SAGE2
    box.line.color.rgb = GREEN5; box.line.width = Pt(1)
    box.shadow.inherit = False
    tf = box.text_frame; tf.word_wrap = True
    tf.margin_left = Inches(0.25); tf.margin_right = Inches(0.25)
    tf.vertical_anchor = MSO_ANCHOR.MIDDLE
    run(tf.paragraphs[0], text, size, GREEN9)

def box(s, x, y, w, h, label, sub=None, fill=WHITE, edge=GREEN7, textcol=GREEN9):
    sh = s.shapes.add_shape(MSO_SHAPE.ROUNDED_RECTANGLE, Inches(x), Inches(y), Inches(w), Inches(h))
    sh.fill.solid(); sh.fill.fore_color.rgb = fill
    sh.line.color.rgb = edge; sh.line.width = Pt(1.75)
    sh.shadow.inherit = False
    tf = sh.text_frame; tf.word_wrap = True
    tf.vertical_anchor = MSO_ANCHOR.MIDDLE
    tf.margin_left = Inches(0.1); tf.margin_right = Inches(0.1)
    p = tf.paragraphs[0]; p.alignment = PP_ALIGN.CENTER
    run(p, label, 14, textcol, bold=True)
    if sub:
        p2 = tf.add_paragraph(); p2.alignment = PP_ALIGN.CENTER
        run(p2, sub, 11, MUTED)
    return sh

def arrow(s, x1, y1, x2, y2, color=ORANGED):
    c = s.shapes.add_connector(MSO_CONNECTOR.STRAIGHT, Inches(x1), Inches(y1), Inches(x2), Inches(y2))
    c.line.color.rgb = color; c.line.width = Pt(2.5)
    el = c.line._get_or_add_ln()
    from pptx.oxml.ns import qn
    import copy
    tail = el.makeelement(qn('a:tailEnd'), {'type': 'triangle', 'w': 'med', 'len': 'med'})
    el.append(tail)
    return c

def caption(s, x, y, w, text, size=12, color=MUTED, align=PP_ALIGN.CENTER):
    tf = textbox(s, x, y, w, 0.5, align)
    run(tf.paragraphs[0], text, size, color)

# ---------------------------------------------------------------- 1. Title
s = slide()
band = s.shapes.add_shape(MSO_SHAPE.RECTANGLE, 0, 0, prs.slide_width, Inches(3.5))
band.fill.solid(); band.fill.fore_color.rgb = GREEN9; band.line.fill.background()
band.shadow.inherit = False
tf = textbox(s, 1.0, 1.05, 11.0, 1.2)
run(tf.paragraphs[0], "How the Alliance website works", 44, WHITE, bold=True)
tf = textbox(s, 1.0, 2.35, 11.0, 0.7)
run(tf.paragraphs[0], "What it is built from, how a change reaches the public, and what it costs", 19, RGBColor(0xD7,0xE0,0xD9))
tf = textbox(s, 1.0, 4.3, 11.0, 1.2)
p = tf.paragraphs[0]
run(p, "Board briefing", 17, GREEN7, bold=True)
p2 = tf.add_paragraph(); run(p2, "September 2026", 15, MUTED)
p3 = tf.add_paragraph(); p3.space_before = Pt(14)
run(p3, "www.austinareafirewise.org", 15, ORANGED, bold=True)

# ---------------------------------------------------------------- 2. Short version
s = slide(); heading(s, "The short version", "Start here")
bullets(s, [
    "The public website is a set of finished pages sitting on a web host. Nothing complicated happens when somebody opens it — which is exactly why it is fast and hard to break.",
    "Behind a locked door — the /admin/ part of the same website — board members type meeting notices, news articles, and messages to the membership.",
    "The two sides are kept deliberately apart. A visitor never touches the locked side, and a problem on the locked side never reaches a visitor.",
    "Everything else in this deck is detail hanging off those three sentences.",
], top=2.2, size=18, gap=16)
footer(s, 2)

# ---------------------------------------------------------------- 3. Two halves diagram
s = slide(); heading(s, "Two halves, on purpose", "The design")
caption(s, 0.85, 1.95, 5.4, "BOARD MEMBER  —  signed in at /admin/", 12, GREEN5, PP_ALIGN.LEFT)
box(s, 0.85, 2.35, 1.9, 0.85, "Board member")
arrow(s, 2.85, 2.78, 3.25, 2.78)
box(s, 3.3, 2.35, 1.7, 0.85, "Sign in", "checks who you are")
arrow(s, 5.1, 2.78, 5.5, 2.78)
box(s, 5.55, 2.35, 1.9, 0.85, "Admin area", "the five sections")
arrow(s, 7.55, 2.78, 7.95, 2.78)
box(s, 8.0, 2.35, 1.9, 0.85, "The ledger", "members, notices")
arrow(s, 8.95, 3.25, 8.95, 4.05)
caption(s, 9.05, 3.35, 3.2, "Publish writes one public file", 11, ORANGED, PP_ALIGN.LEFT)
box(s, 8.0, 4.1, 1.9, 0.85, "Published files", "pages and photos", fill=SAGE2)
caption(s, 0.85, 3.75, 5.4, "EVERYONE  —  no sign-in needed", 12, GREEN5, PP_ALIGN.LEFT)
box(s, 3.3, 4.1, 4.15, 0.85, "www.austinareafirewise.org", "what the public sees", fill=SAGE2)
arrow(s, 7.95, 4.53, 7.55, 4.53)
note(s, "If the locked side is down, broken or under attack, visitors see no difference at all — the website keeps serving whatever was published last. On a page people may open during an actual fire, that is the property that matters most.", top=5.5)
footer(s, 3)

# ---------------------------------------------------------------- 4. What the board uses
s = slide(); heading(s, "What the board actually uses", "In practice")
bullets(s, [
    ("Where.", "www.austinareafirewise.org/admin/ — the same website, one extra word in the address."),
    ("Signing in.", "Your own email and your own password. Each board member has their own."),
    ("Five sections.", "News & notices  ·  Members  ·  Messages  ·  Firewise groups  ·  Board."),
    ("Nothing to install.", "It is a web page. It works on a laptop, a tablet or a phone."),
    ("Help on the screen.", "A “? Help” button beside the section tabs explains whichever section you are in, in plain words."),
], top=2.2, size=17, gap=15)
note(s, "Nothing a board member types is visible to the public until they press Publish.", top=5.9)
footer(s, 4)

# ---------------------------------------------------------------- 5. The pieces
s = slide(); heading(s, "The pieces, in plain words", "The parts list")
rows = [
    ("Route 53", "The phone book. Turns “austinareafirewise.org” into an actual address on the internet."),
    ("Amplify", "The building. Holds the pages, serves them to visitors, and provides the padlock in the address bar."),
    ("S3", "The filing cabinet. Published content and photographs."),
    ("Lambda", "The helpers. Small programs that wake up, do one job, and go back to sleep."),
    ("DynamoDB", "The ledger. Members, messages, Firewise groups, board roster."),
    ("Cognito", "The doorman. Decides who is allowed to sign in to the admin area."),
    ("GitHub", "The archive. Every version of the site, and who changed what, and when."),
]
y = 1.95
for name, desc in rows:
    tf = textbox(s, 0.85, y, 2.1, 0.5)
    run(tf.paragraphs[0], name, 15, GREEN9, bold=True)
    tf = textbox(s, 3.0, y, 9.4, 0.5)
    run(tf.paragraphs[0], desc, 14, INK)
    y += 0.62
caption(s, 0.85, 6.5, 11.6, "The first six are Amazon services. We pay for what we use, and at our size that is very little.", 13, MUTED, PP_ALIGN.LEFT)
footer(s, 5)

# ---------------------------------------------------------------- 6. Publishing the site itself
s = slide(); heading(s, "How a change to the site itself is published", "Pipeline 1 of 2")
box(s, 0.85, 2.5, 2.5, 1.0, "A change is made", "wording, a new page")
arrow(s, 3.45, 3.0, 3.95, 3.0)
box(s, 4.0, 2.5, 2.5, 1.0, "GitHub", "the archive")
arrow(s, 6.6, 3.0, 7.1, 3.0)
box(s, 7.15, 2.5, 2.5, 1.0, "Amplify rebuilds", "automatically")
arrow(s, 9.75, 3.0, 10.25, 3.0)
box(s, 10.3, 2.5, 2.15, 1.0, "Live", "about a minute", fill=SAGE2)
bullets(s, [
    "Nobody uploads anything by hand, so nobody can forget a step or upload the wrong file.",
    "Every version is kept, with a note of what changed and why. Any change can be undone.",
    "This is the path for the site’s own design and wording — not for meeting notices and news.",
], top=4.1, size=16, gap=12)
footer(s, 6)

# ---------------------------------------------------------------- 7. Publishing board content
s = slide(); heading(s, "How the board’s own content is published", "Pipeline 2 of 2")
box(s, 0.85, 2.5, 2.3, 1.0, "Write it", "in the admin area")
arrow(s, 3.25, 3.0, 3.65, 3.0)
box(s, 3.7, 2.5, 2.3, 1.0, "Checked", "title, dates, links")
arrow(s, 6.1, 3.0, 6.5, 3.0)
box(s, 6.55, 2.5, 2.3, 1.0, "Filed", "in the ledger")
arrow(s, 8.95, 3.0, 9.35, 3.0)
box(s, 9.4, 2.5, 3.05, 1.0, "One public file rewritten", "visible within a minute", fill=SAGE2)
bullets(s, [
    "Drafts never leave the locked side. Only publishing puts anything in front of a visitor.",
    "Start and stop dates are part of every item, so a notice appears and disappears on its own. Nobody has to remember to take it down.",
    "Because scheduled items sit in the public file before they go live, nothing confidential should ever be typed into this system.",
], top=4.1, size=16, gap=12)
footer(s, 7)

# ---------------------------------------------------------------- 8. Helpers
s = slide(); heading(s, "The helpers that run on their own", "Lambda")
bullets(s, [
    ("Burn ban watch.", "Reads the Travis County Fire Marshal’s page every 30 minutes and updates the notice on the home page. If it cannot understand the page, it says nothing rather than saying the wrong thing."),
    ("Content.", "Takes what a board member types, checks it, and files it."),
    ("Membership.", "Handles sign-ups, confirmations, unsubscribes and STOP replies."),
    ("Sending.", "Sends the approved emails and texts, one by one, without sending anything twice."),
    ("Housekeeping, every five minutes.", "Sends anything scheduled and clears out sign-ups that were never confirmed."),
], top=2.1, size=16, gap=13)
note(s, "Five small programs. They cost nothing while asleep, which is almost all of the time.", top=6.0)
footer(s, 8)

# ---------------------------------------------------------------- 9. Access
s = slide(); heading(s, "Who can get in", "Access")
bullets(s, [
    "Only named board members, each with their own login. There is no shared password.",
    ("A login and a board record are separate.", "Adding somebody to the Board section does not give them access to edit the site and removing them does not take it away."),
    ("That is deliberate.", "It means the roster can be kept accurate by anybody, without accidentally handing out or cutting off access to the website."),
    ("When somebody leaves the board, do both.", "Mark them as a past board member and ask whoever manages the account to remove their login."),
], top=2.2, size=17, gap=16)
footer(s, 9)

# ---------------------------------------------------------------- 10. Members and messages
s = slide(); heading(s, "Members and messages", "The mailing list")
bullets(s, [
    ("Nobody is on the list until they confirm.", "One message asks them to; nothing else is ever sent until they answer it. This is a legal requirement, and it is also what keeps our messages out of spam folders."),
    ("Two people, always.", "One board member writes a message; a different one approves it. Nobody can approve their own."),
    ("Stopping is automatic and permanent.", "Unsubscribes, bounced addresses and STOP replies are handled without anybody doing anything, and cannot be undone by a later sign-up."),
    ("Email and text.", "Email is sent through Amazon. Texts go through a toll-free number, once its verification finishes."),
], top=2.15, size=16, gap=14)
footer(s, 10)

# ---------------------------------------------------------------- 11. Cost
s = slide(); heading(s, "What it costs", "Money \u2014 actual figures from the bill")

def money(y, label, amount, sub=None, strong=False):
    tf = textbox(s, 0.85, y, 8.6, 0.45)
    run(tf.paragraphs[0], label, 15, GREEN9 if strong else INK, bold=strong)
    if sub:
        tf2 = textbox(s, 0.85, y + 0.26, 8.6, 0.35)
        run(tf2.paragraphs[0], sub, 11, MUTED)
    tf = textbox(s, 9.6, y, 2.85, 0.45, PP_ALIGN.RIGHT)
    run(tf.paragraphs[0], amount, 15, GREEN7 if strong else INK, bold=strong)

y = 1.88
money(y, "Route 53 hosted zone", "$0.50 / month",
      "The fixed charge for holding the domain\u2019s address records. The only charge that is not pennies."); y += 0.66
money(y, "DNS lookups \u2014 2,205 of them so far", "$0.0009"); y += 0.44
money(y, "Amplify, S3, Lambda, DynamoDB, Cognito, API Gateway", "$0.0004",
      "All six together, for the month to date."); y += 0.66
rule = s.shapes.add_shape(MSO_SHAPE.RECTANGLE, Inches(0.85), Inches(y), Inches(11.6), Pt(1))
rule.fill.solid(); rule.fill.fore_color.rgb = RGBColor(0xE2,0xE0,0xD8); rule.line.fill.background()
rule.shadow.inherit = False
y += 0.16
money(y, "September so far \u2014 everything", "$0.50", strong=True); y += 0.46
money(y, "August", "$0.00", "Nothing was running yet."); y += 0.64
money(y, "austinareafirewise.org \u2014 registration and renewal", "$16.00 / year",
      "Amazon\u2019s current .org price. Renews 12 September 2027, automatically. Not yet on the bill."); y += 0.64
money(y, "Text messages", "not billed yet",
      "The toll-free number is still being verified. Charges start when it goes live.")

note(s, "About $22 a year at today\u2019s traffic \u2014 $6 of hosted zone plus the $16 name. Text messages are the one line that will grow.", top=6.3, height=0.55, size=13)
footer(s, 11)

# ---------------------------------------------------------------- 12. Resilience
s = slide(); heading(s, "If something goes wrong", "Resilience")
bullets(s, [
    ("The website stays up.", "It keeps serving the last published version. A problem in the admin area is invisible to visitors."),
    ("Nothing is lost.", "Every version of the site is kept. Any change can be reversed."),
    ("A failed save changes nothing.", "If an error appears, it is safe to stop and ask rather than trying again and again."),
    ("It can be rebuilt.", "The whole set-up is written down, step by step, so somebody who has never seen it could rebuild it from nothing."),
], top=2.2, size=17, gap=16)
footer(s, 12)

# ---------------------------------------------------------------- 13. Where the instructions are
s = slide(); heading(s, "Where the instructions are", "Handover")
bullets(s, [
    ("Seven written guides,", "kept with the site itself: what you need before you start, deploying it, connecting GitHub, editing the site, running it day to day, and the design notes for the content and membership systems."),
    ("Help on the screen,", "in the admin area: “? Help” for each section, and “How the site works” for the whole picture."),
    ("One account to look after.", "The AWS account and the GitHub organization are both owned by the Alliance, not by an individual."),
], top=2.2, size=17, gap=16)
note(s, "The single most useful thing a new board member can do: sign in, press “? Help”, and read “How the site works”. Ten minutes, once.", top=5.7)
footer(s, 13)

out = "/Users/bob/austinareafirewise-website/docs/AAFA-website-overview.pptx"
prs.save(out)
print("saved", out, len(prs.slides.__iter__.__self__._sldIdLst), "slides")

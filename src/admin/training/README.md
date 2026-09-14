# Training scripts

One file per lesson. Each is **both** the script a board member steps through
in the admin area and the script the narration is recorded from — the same
arrangement as the RP desktop app, and for the same reason.

**Why the script lives here as text.** A video cannot be grepped, diffed or
checked. Rename a button and a hand-written script is wrong from that moment,
silently, until somebody watches the whole thing and notices. Kept as a file
whose every target is a real selector, `check.mjs` can prove the lesson still
matches the page, and it fails loudly the moment it does not.

## Shape of a file

```markdown
# Post a meeting notice
<!-- lesson-id: post-a-meeting-notice -->
<!-- order: 20 -->
<!-- minutes: 2 -->
<!-- description: Getting a meeting, seminar or chipper day onto the home page. -->

## Start a new notice
- section: content
- target: #new-notice
- audio: post-a-meeting-notice-01.mp3

The words spoken over this step. One or two breaths, no more.
```

### Step fields

| Field | Meaning |
| --- | --- |
| `section` | Which tab the step happens on: `content`, `members`, `comms`, `groups`, `board`. Omit on a step that is not tied to one. |
| `screen` | `list` or `editor`, when a section has both and the step needs one. |
| `target` | A CSS selector in `admin/index.html` for the thing being pointed at. Checked by `check.mjs`. Omit to talk over the whole screen. |
| `audio` | The narration clip. Generated, not hand-made. |
| `audio-hash` | Set by the audio generator. Proves the clip still matches these words. |

## Writing the words

**Keep each step to a breath or two.** These are read aloud over a screen
somebody is looking at. A paragraph that reads well on a page is far too long
out loud.

Say what the thing is for before saying which button to press. Somebody who
understands why can find a moved button; somebody who only memorised the
button cannot.

Never promise what the screen does not do. If a step says "press Publish and it
appears", it had better appear.

## Checking

```bash
node src/admin/training/check.mjs
```

Proves every `target` exists in `admin/index.html` and every `section` is a
real tab. Run it after changing the admin page.

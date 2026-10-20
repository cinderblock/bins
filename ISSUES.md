# Known issues

Side issues found while working on something else. Each entry is a seed for
a separate fix; claim one (`in progress — <thread/branch>`) before starting.

## Label subtext stops at four lines

A box's description prints at most four lines. `.slice(0, 4)` appears in
`api/label.ts` (buildLabel), `api/labels/render.ts` (renderLabel) and
`api/art.ts` (handleArt). A box described as five lines (Temp / Humidity /
PM2 / VOC / CO2) prints the first four and drops CO2, even though the
left column has room for more above the QR. The studio preview shows the
same cut, so it's visible, but nothing says why, and the description field
accepts any number of lines.

Why it matters: the label quietly disagrees with what someone typed. Decide
whether four is the real limit (then say so in the studio) or fit the lines
to the space the way the title already shrinks to fit.

## Deployment specifics in tracked plan files

CLAUDE.md says nothing about a particular group, domain or deployment may
appear in tracked files, but three tracked plans name one:
`plans/ai-assist.md` ("Deployed" sections: host, stack and hostname, plus an
ops secret name), `plans/backend-down-is-visible.md` (the hostname), and
`plans/remote-admin-passkey.md` (a `curl --resolve` with the hostname and a
Cloudflare edge IP). Find them by grepping tracked `*.md` for the
hostnames and host names listed in the untracked `plans/*.local.md` files.

Why it matters: the repo is meant to be publishable as a tenant-agnostic
core. Move the specifics into the untracked `plans/*.local.md` files and
leave generic wording behind. They stay in git history either way.

## An upstream provider's failure reads as "server unreachable"

`app/lib/health.ts` treats every 5xx as the backend being down
(`isServerDownStatus`: `status >= 500`), on purpose: a reverse proxy's 502 is
indistinguishable from the app being down. But the app itself answers 502/503
for failures that are NOT the server: `api/art.ts` and `api/label.ts`
("could not generate label art", printer unreachable) and
`api/ai/handler.ts` (provider error 502, AI not configured 503). Reproduce:
the label studio with an invalid `GEMINI_API_KEY`, tap Generate. The red
"Can't reach the server" banner appears and "Another one" is disabled until
the next probe (~3 s) recovers.

Why it matters: Gemini safety blocks and outages are routine, and each one
tells the warehouse the whole server is down. Needs a way to tell an app
answer from a proxy's (a response header, or non-5xx codes for upstream
failures), plus whatever the AI sheet's `askErrorMessage` 502/503 cases
should become.

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

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

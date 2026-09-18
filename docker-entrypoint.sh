#!/bin/sh
# Reproduce the release-tree layout on the persistent volume, using the image
# as the release source.
#
# Why this exists: release-assets.ts serves hashed client assets out of EARLIER
# releases, so a device whose installed service worker still holds the previous
# shell can boot, sync and show the normal update prompt instead of stranding on
# a blank page — that failure was observed live, and the fallback was built for
# it. It finds those releases as SIBLINGS of the running release's directory. A
# plain image runs from /app, whose siblings are nothing, and the fallback would
# quietly find nothing.
#
# So: the running release lives at /srv/bins/releases/<sha>/ on the app volume,
# and earlier releases persist beside it. Only the client build is kept for old
# releases; node_modules stays in the image and is reached by symlink.
set -e

ROOT=/srv/bins
SHA=$(cat /app/BUILD_SHA)
REL="$ROOT/releases/$SHA"

if [ ! -f "$REL/.complete" ]; then
	echo "bins: staging release $SHA on the app volume"
	rm -rf "$REL"
	mkdir -p "$REL"
	# Everything server.ts needs, except node_modules (linked, not copied —
	# it's large, it's identical for every release, and it lives in the image).
	cp -r /app/build /app/api /app/shared /app/db "$REL/"
	cp /app/server.ts /app/release-assets.ts /app/package.json /app/BUILD_SHA "$REL/"
	ln -s /app/node_modules "$REL/node_modules"
	touch "$REL/.complete"
fi

ln -sfn "releases/$SHA" "$ROOT/current"

# Prune, matching what the old deploy kept: the newest few releases stay
# runnable, ~30 stay SERVABLE (stripped to just their client build, which is
# all the asset fallback reads), everything older goes.
cd "$ROOT/releases"
i=0
for d in $(ls -1dt */ 2>/dev/null); do
	d=${d%/}
	i=$((i + 1))
	[ "$d" = "$SHA" ] && continue
	if [ "$i" -gt 30 ]; then
		rm -rf "$d"
	elif [ "$i" -gt 3 ] && [ -d "$d/api" ]; then
		# Keep only build/client; drop the rest so a stale release can't be run.
		find "$d" -mindepth 1 -maxdepth 1 ! -name build -exec rm -rf {} +
		find "$d/build" -mindepth 1 -maxdepth 1 ! -name client -exec rm -rf {} + 2>/dev/null || true
	fi
done

cd "$REL"
exec bun server.ts

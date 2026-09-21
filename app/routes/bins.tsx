/**
 * "All boxes" — the one browse surface: every box in the group, with search
 * ("which box is X in" — MiniSearch over names, subtext, locations, notes;
 * prefix + fuzzy so "sharpee" finds the Sharpies) and category filter
 * chips. Everyone can open a box and bulk-select boxes to MOVE (relocate)
 * them together. Admins (unlock with the group admin password) additionally
 * see retired boxes and get per-box edit + retire/restore. Retire/restore
 * are server-enforced (api/admin.ts); edit and move ride the normal client
 * ops. /search redirects here.
 */
import {
  ActionIcon,
  Badge,
  Button,
  Checkbox,
  Chip,
  Group,
  Modal,
  Paper,
  Stack,
  Text,
  TextInput,
  Textarea,
  Title,
  UnstyledButton,
} from "@mantine/core";
import { useDocumentTitle, useMediaQuery } from "@mantine/hooks";
import { notifications } from "@mantine/notifications";
import { locationLabel } from "@shared/locations";
import type { BinState } from "@shared/reducer";
import {
  IconAdjustments,
  IconArchive,
  IconArchiveOff,
  IconArrowLeft,
  IconLayoutGrid,
  IconLock,
  IconMapPin,
  IconPencil,
  IconPlus,
  IconQrcode,
  IconSearch,
  IconSettings,
  IconSparkles,
  IconTrash,
} from "@tabler/icons-react";
import { useLiveQuery } from "dexie-react-hooks";
import type MiniSearch from "minisearch";
import { useEffect, useRef, useState } from "react";
import { useLocation, useNavigate } from "react-router";
import { AdminUnlock } from "~/components/AdminUnlock";
import { AskAiSheet } from "~/components/AskAiSheet";
import { BinDetailPane } from "~/components/BinDetailPane";
import { FillLevelBadge, FillLevelInput } from "~/components/FillLevel";
import { InlineCreate } from "~/components/InlineCreate";
import { LabelChips } from "~/components/LabelChips";
import { useServerDown } from "~/components/NeedsServer";
import { PhotoImg } from "~/components/PhotoImg";
import { ResponsiveSheet } from "~/components/ResponsiveSheet";
import { WeightInput } from "~/components/WeightInput";
import { setBinFields, setBinLabel, setBinLocation } from "~/lib/actions";
import { forgetAdmin, useAdminPassword } from "~/lib/admin";
import { type AskKind, useAiAvailable } from "~/lib/ai";
import { apiJson } from "~/lib/api";
import { boxPath, boxTitle, useBoxNumbersInternal } from "~/lib/boxRef";
import { useBoxSizes } from "~/lib/boxSizes";
import { db } from "~/lib/db";
import { useDeployment } from "~/lib/deployment";
import { relativeTime } from "~/lib/format";
import { formatWeight, labelColor } from "~/lib/labels";
import { createPlace, describeBinLocation, usePlaceMap } from "~/lib/places";
import { type SearchDoc, buildSearchIndex } from "~/lib/search";
import { SizeIcon } from "~/lib/sizeIcons";
import { syncNow } from "~/lib/sync";
import { PAGE_MAXW } from "~/lib/ui";

function usePlaces() {
  return useLiveQuery(
    () =>
      db.locations
        .orderBy("sortOrder")
        .filter((l) => !l.archived)
        .toArray(),
    [],
    [],
  );
}

/** The group's label rows keyed by id, for rendering bins' labelIds as chips. */
function useLabelMap() {
  return useLiveQuery(
    async () => new Map((await db.labels.toArray()).map((l) => [l.id, l])),
    [],
    new Map(),
  );
}

function fail(err: unknown) {
  notifications.show({
    message: err instanceof Error ? err.message : String(err),
    color: "red",
  });
}

export default function Bins() {
  useDocumentTitle("All boxes · bins");
  const navigate = useNavigate();
  const location = useLocation();
  // This component is BOTH the /bins route and (on browse-home deployments)
  // the "/" home surface. Test the path, not the deployment setting: /bins
  // reached from the scanner still wants a working back arrow.
  const atHome = location.pathname === "/";
  const numbersInternal = useDeployment()?.boxNumbers === "internal";
  const labelById = useLabelMap();
  const sizes = useBoxSizes();
  const sizeById = new Map(sizes.map((s) => [s.id, s]));
  const placeById = usePlaceMap();

  // Search-intent entries (the scanner's magnifier icon, the /search
  // redirect) land with this state so the keyboard pops immediately.
  // Desk mode: a wide screen gets list + detail side by side, so checking a
  // shelf doesn't mean navigating in and out of every box and losing your
  // place. Phones and narrow windows keep the plain list.
  const twoPane =
    useMediaQuery("(min-width: 75em)", false, {
      getInitialValueInEffect: false,
    }) ?? false;
  const [previewId, setPreviewId] = useState<number | null>(null);

  const focusSearch = Boolean(
    (location.state as { focusSearch?: boolean } | null)?.focusSearch,
  );

  const [query, setQuery] = useState("");
  const aiAvailable = useAiAvailable();
  const [askKind, setAskKind] = useState<AskKind | null>(null);
  const [filterLabel, setFilterLabel] = useState<string | null>(null);
  const indexRef = useRef<MiniSearch<SearchDoc> | null>(null);
  const [indexReady, setIndexReady] = useState(0);

  const labels = useLiveQuery(
    () =>
      db.labels
        .orderBy("sortOrder")
        .filter((l) => !l.archived)
        .toArray(),
    [],
    [],
  );

  // Rebuild when the replica changes (cheap at this scale).
  const changeStamp = useLiveQuery(
    async () => `${await db.bins.count()}:${await db.entries.count()}`,
    [],
    "",
  );
  // biome-ignore lint/correctness/useExhaustiveDependencies: changeStamp is the rebuild trigger — the index reads the replica directly
  useEffect(() => {
    void buildSearchIndex().then((index) => {
      indexRef.current = index;
      setIndexReady((n) => n + 1);
    });
  }, [changeStamp]);
  void indexReady; // rerender trigger

  // Admin unlock is remembered per device (lib/admin.ts): undefined while
  // loading, null when locked, the password string once unlocked here.
  const remembered = useAdminPassword();
  const unlocked = typeof remembered === "string";
  const adminPassword = remembered ?? "";
  const serverDown = useServerDown();
  const [unlockOpen, setUnlockOpen] = useState(false);

  const [selecting, setSelecting] = useState(false);
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const [moveOpen, setMoveOpen] = useState(false);
  const [editing, setEditing] = useState<BinState | null>(null);

  /**
   * Retired boxes are OUT of the normal list, including an admin's.
   *
   * They used to appear for anyone with admin unlocked, which meant the
   * everyday list of what's in the warehouse was padded with boxes whose
   * contents are gone. They live behind their own toggle now, which is also
   * the only place restore and delete are offered — so the destructive
   * action is somewhere you go on purpose.
   *
   * Deleted boxes are never listed anywhere: the id survives so a stale
   * sticker still resolves to "this is dead", and nothing more.
   */
  const [showRetired, setShowRetired] = useState(false);
  const retiredCount = useLiveQuery(
    async () => db.bins.where("status").equals("retired").count(),
    [],
    0,
  );
  const bins = useLiveQuery(
    async () => {
      const all = await db.bins.orderBy("id").toArray();
      return all.filter((bin) =>
        showRetired ? bin.status === "retired" : bin.status === "active",
      );
    },
    [showRetired],
    undefined,
  );

  function toggle(id: number) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function cancelSelect() {
    setSelecting(false);
    setSelected(new Set());
  }

  function activate(bin: BinState) {
    if (selecting) toggle(bin.id);
    // Side by side, a click selects rather than navigates — the detail is
    // already on screen, and leaving would throw away the list and its scroll.
    else if (twoPane) setPreviewId(bin.id);
    else navigate(boxPath(bin, numbersInternal));
  }

  async function moveSelected(
    target: { locationId: string; name: string } | string | null,
  ) {
    const ids = [...selected];
    // A bulk move lands boxes ON a place, never in a slot: slots are one box
    // each and are picked one at a time on the box page.
    for (const id of ids)
      await setBinLocation(
        id,
        typeof target === "object" && target
          ? { locationId: target.locationId }
          : target,
      );
    const n = ids.length;
    const name = typeof target === "object" ? target?.name : target;
    notifications.show({
      message: name
        ? `Moved ${n} box${n === 1 ? "" : "es"} to ${name}`
        : `Cleared location on ${n} box${n === 1 ? "" : "es"}`,
      color: "green",
    });
    setMoveOpen(false);
    cancelSelect();
  }

  async function setStatus(
    binId: number,
    action: "retire" | "restore" | "delete",
  ) {
    try {
      await apiJson(`/api/admin/bins/${action}`, {
        method: "POST",
        body: JSON.stringify({ adminPassword, binId }),
      });
      await syncNow();
    } catch (err) {
      fail(err);
    }
  }

  /**
   * Two taps, and the second one says what it does. Delete is the only
   * action here that cannot be undone from the app, so it does not share a
   * one-tap icon with restore.
   */
  const [confirmDelete, setConfirmDelete] = useState<number | null>(null);

  /**
   * Start a new box. Nothing is allocated yet: /new opens the label studio
   * and the box comes into existence at the first save, drawing or print,
   * so an abandoned "New box" tap burns no id. Admin-gated, matching
   * /api/admin/bins/allocate.
   */
  function createBox() {
    navigate("/new");
  }

  // The rendered order, for the key handler below. A ref because that handler
  // is registered once but must always see the CURRENT list.
  const shownRef = useRef<BinState[]>([]);

  // Arrow keys walk the list without leaving the search box — the point of
  // this layout is working down a shelf, and reaching for the mouse on every
  // box defeats it. Ignored while bulk-selecting, where arrows mean nothing.
  //
  // Registered above the `bins === undefined` bail-out on purpose: a hook that
  // only runs on some renders changes the hook count between them, which React
  // rejects outright (error #310 — caught by driving this in a browser, since
  // types and tests both pass happily).
  useEffect(() => {
    if (!twoPane || selecting) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "ArrowDown" && e.key !== "ArrowUp") return;
      const list = shownRef.current;
      if (list.length === 0) return;
      e.preventDefault();
      setPreviewId((current) => {
        const at = list.findIndex((b) => b.id === current);
        if (at === -1) return list[0]?.id ?? null;
        const next =
          e.key === "ArrowDown"
            ? Math.min(at + 1, list.length - 1)
            : Math.max(at - 1, 0);
        return list[next]?.id ?? null;
      });
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [twoPane, selecting]);

  if (bins === undefined) return null;

  // Text query: MiniSearch relevance order. The index only covers ACTIVE
  // boxes, so a query hides retired ones even for admins — browse with an
  // empty query to see those. A category chip then narrows either view.
  const results =
    query.trim() && indexRef.current
      ? indexRef.current.search(query).slice(0, 50)
      : null;
  const byId = new Map(bins.map((bin) => [bin.id, bin]));
  const listed = results
    ? results.flatMap((r) => {
        const bin = byId.get(r.id as number);
        return bin ? [bin] : [];
      })
    : bins;
  const shown = filterLabel
    ? listed.filter((bin) => bin.labelIds.includes(filterLabel))
    : listed;

  shownRef.current = shown;

  const list = (
    <Stack
      p="md"
      pt="max(var(--mantine-spacing-md), calc(env(safe-area-inset-top) + var(--bins-banner-h, 0px)))"
      gap="md"
      maw={twoPane ? undefined : PAGE_MAXW}
      mx={twoPane ? undefined : "auto"}
    >
      <Group justify="space-between">
        <Group gap="sm">
          {/* No back arrow when this IS the home surface — going "back" from
              the home screen leaves the app entirely. */}
          {!atHome && (
            <ActionIcon
              variant="default"
              size="xl"
              radius="xl"
              onClick={() => navigate(-1)}
              aria-label="Back"
            >
              <IconArrowLeft />
            </ActionIcon>
          )}
          <Title order={3}>{showRetired ? "Retired boxes" : "All boxes"}</Title>
        </Group>
        <Group gap="xs">
          {/* Where boxes are containers drawn from a pile of empties, "start
              a new box" is the everyday act, not batch-allocating a sticker
              sheet. Mints ONE id and goes straight to it so you can name it
              and shoot its contents while it's still open in front of you.
              Admin-gated, matching /api/admin/bins/allocate. */}
          {unlocked && !selecting && (
            <Button
              size="sm"
              radius="xl"
              variant="light"
              leftSection={<IconPlus size={18} />}
              onClick={createBox}
              // Box ids come from one global sequence on the server, so a new
              // box is not something this device can invent while offline.
              // Disabled and labelled rather than hidden — see NeedsServer.
              disabled={serverDown}
            >
              {serverDown ? "New box (server down)" : "New box"}
            </Button>
          )}
          {!selecting && placeById.size > 0 && (
            <ActionIcon
              variant="default"
              size="xl"
              radius="xl"
              aria-label="Shelves"
              onClick={() => navigate("/shelves")}
            >
              <IconLayoutGrid />
            </ActionIcon>
          )}
          {/* Settings — and behind it admin, which is where box sizes,
              shelves and devices are configured. It used to hang off the
              SCANNER header only, so a deployment that opens on this list
              had no way to reach any of it. */}
          {!selecting && (
            <ActionIcon
              variant="default"
              size="xl"
              radius="xl"
              aria-label="Settings"
              onClick={() => navigate("/settings")}
            >
              <IconSettings />
            </ActionIcon>
          )}
          {/* One tap straight to admin once it's unlocked: an admin on this
              screen is usually on their way there. */}
          {unlocked && !selecting && (
            <ActionIcon
              variant="default"
              size="xl"
              radius="xl"
              aria-label="Admin"
              onClick={() => navigate("/admin")}
            >
              <IconAdjustments />
            </ActionIcon>
          )}
          {/* Browse-home deployments open here, so scanning has to be one
              obvious tap away — opt-in, but never buried. */}
          {atHome && !selecting && (
            <Button
              size="sm"
              radius="xl"
              leftSection={<IconQrcode size={18} />}
              onClick={() => navigate("/scan")}
            >
              Scan
            </Button>
          )}
          {/* Retired boxes are a place you go, not clutter in the list.
              Only offered when there are any, and only to an admin — they
              are the only one who can do anything about them. */}
          {unlocked && !selecting && (retiredCount > 0 || showRetired) && (
            <Button
              size="xs"
              variant={showRetired ? "filled" : "light"}
              color="gray"
              leftSection={<IconArchive size={12} />}
              onClick={() => setShowRetired((on) => !on)}
            >
              {showRetired ? "Back to active" : `Retired (${retiredCount})`}
            </Button>
          )}
          {!selecting &&
            (unlocked ? (
              <Button
                size="xs"
                variant="light"
                color="yellow"
                leftSection={<IconLock size={12} />}
                onClick={() => void forgetAdmin()}
              >
                Lock admin
              </Button>
            ) : (
              <ActionIcon
                variant="default"
                size="xl"
                radius="xl"
                aria-label="Admin controls"
                onClick={() => setUnlockOpen(true)}
              >
                <IconLock />
              </ActionIcon>
            ))}
        </Group>
      </Group>

      <TextInput
        size="lg"
        placeholder="Which box is it in…"
        leftSection={<IconSearch size={18} />}
        value={query}
        onChange={(e) => setQuery(e.currentTarget.value)}
        autoFocus={focusSearch}
      />

      {/* The typed query doubles as the question, so there is no second text
          field to fill in. Hidden entirely when the server has no provider
          configured — the list below is the feature that always works. */}
      {aiAvailable && query.trim() && (
        <Group gap="xs">
          <Button
            size="compact-sm"
            variant="light"
            leftSection={<IconSparkles size={14} />}
            onClick={() => setAskKind("find")}
          >
            Where is it?
          </Button>
          <Button
            size="compact-sm"
            variant="light"
            leftSection={<IconSparkles size={14} />}
            onClick={() => setAskKind("place")}
          >
            Where should it go?
          </Button>
        </Group>
      )}

      {askKind && (
        <AskAiSheet
          opened
          onClose={() => setAskKind(null)}
          kind={askKind}
          query={query.trim()}
        />
      )}

      {labels.length > 0 && (
        <Group gap="xs">
          {labels.map((label) => (
            <Chip
              key={label.id}
              size="sm"
              color={labelColor(label.color)}
              checked={filterLabel === label.id}
              onChange={(checked) => setFilterLabel(checked ? label.id : null)}
            >
              {label.name}
            </Chip>
          ))}
        </Group>
      )}

      {selecting ? (
        <Group justify="space-between">
          <Text fw={600}>{selected.size} selected</Text>
          <Group gap="xs">
            <Button variant="default" onClick={cancelSelect}>
              Cancel
            </Button>
            <Button
              leftSection={<IconMapPin size={16} />}
              disabled={selected.size === 0}
              onClick={() => setMoveOpen(true)}
            >
              Move
            </Button>
          </Group>
        </Group>
      ) : (
        bins.length > 0 && (
          <Button
            variant="light"
            onClick={() => setSelecting(true)}
            style={{ alignSelf: "flex-start" }}
          >
            Select to move
          </Button>
        )
      )}

      {shown.length === 0 && (
        <Text c="dimmed" ta="center" mt="xl">
          {query.trim()
            ? `Nothing matches "${query}".`
            : filterLabel
              ? "No boxes in this category yet."
              : "No boxes yet."}
        </Text>
      )}

      <Stack gap="xs">
        {shown.map((bin) => {
          const retired = bin.status === "retired";
          return (
            <Paper
              key={bin.id}
              p="sm"
              radius="md"
              withBorder
              style={{ opacity: retired ? 0.6 : 1 }}
            >
              <Group wrap="nowrap" gap="sm">
                {selecting && (
                  <Checkbox
                    checked={selected.has(bin.id)}
                    readOnly
                    tabIndex={-1}
                  />
                )}
                <UnstyledButton
                  onClick={() => activate(bin)}
                  aria-label={`${selecting ? "Select" : "Open"} ${boxTitle(bin, numbersInternal)}`}
                  style={{ flex: 1, minWidth: 0 }}
                >
                  <Group wrap="nowrap">
                    {bin.primaryPhotoHash ? (
                      <PhotoImg
                        hash={bin.primaryPhotoHash}
                        thumbHash={bin.primaryThumbHash}
                        alt=""
                        style={{
                          width: 56,
                          height: 56,
                          borderRadius: 8,
                          flexShrink: 0,
                        }}
                      />
                    ) : bin.labelArtHash ? (
                      // No contents photo yet — the label's drawing is the
                      // next best way to recognise the box at a glance.
                      <PhotoImg
                        hash={bin.labelArtHash}
                        alt=""
                        style={{
                          width: 56,
                          height: 56,
                          borderRadius: 8,
                          background: "#fff",
                          objectFit: "contain",
                          flexShrink: 0,
                        }}
                      />
                    ) : (
                      <div
                        style={{
                          width: 56,
                          height: 56,
                          borderRadius: 8,
                          background: "var(--mantine-color-dark-5)",
                          flexShrink: 0,
                        }}
                      />
                    )}
                    <div style={{ minWidth: 0, flex: 1 }}>
                      <Group gap={8}>
                        {/* Name leads where numbers are internal; an unnamed
                            box says so rather than showing the number. */}
                        {numbersInternal ? (
                          <Text fw={600} truncate>
                            {boxTitle(bin, true)}
                          </Text>
                        ) : (
                          <>
                            <Text fw={600}>#{bin.id}</Text>
                            {bin.name && <Text truncate>{bin.name}</Text>}
                          </>
                        )}
                        {retired && (
                          <Badge color="gray" size="sm">
                            retired
                          </Badge>
                        )}
                      </Group>
                      <Group gap={6}>
                        {(() => {
                          const size = bin.sizeId
                            ? sizeById.get(bin.sizeId)
                            : undefined;
                          return size ? (
                            <Badge
                              variant="light"
                              color="gray"
                              leftSection={
                                <SizeIcon icon={size.icon} size={12} />
                              }
                              style={{ textTransform: "none" }}
                            >
                              {size.name}
                            </Badge>
                          ) : null;
                        })()}
                        {(() => {
                          const where = describeBinLocation(bin, placeById);
                          return (
                            where && (
                              <Badge
                                variant="light"
                                leftSection={<IconMapPin size={12} />}
                                style={{ textTransform: "none" }}
                              >
                                {where}
                              </Badge>
                            )
                          );
                        })()}
                        {bin.weightGrams != null && (
                          <Badge variant="light" color="gray">
                            {formatWeight(bin.weightGrams)}
                          </Badge>
                        )}
                        <FillLevelBadge percent={bin.fillLevel} />
                        {bin.labelIds.map((id) => {
                          const label = labelById.get(id);
                          if (!label) return null;
                          return (
                            <Badge
                              key={id}
                              variant="light"
                              color={labelColor(label.color)}
                              style={{ textTransform: "none" }}
                            >
                              {label.name}
                            </Badge>
                          );
                        })}
                        {bin.lastSeenAt != null && (
                          <Text size="xs" c="dimmed">
                            scanned {relativeTime(bin.lastSeenAt)}
                          </Text>
                        )}
                        {/* Legacy field: no longer editable, still shown
                            where a box carries one so nothing typed on an
                            older deployment silently vanishes. */}
                        {bin.externalLabel && (
                          <Text size="xs" c="dimmed" truncate>
                            {bin.externalLabel}
                          </Text>
                        )}
                      </Group>
                    </div>
                  </Group>
                </UnstyledButton>
                {unlocked && !selecting && (
                  <Group gap={4} wrap="nowrap">
                    <ActionIcon
                      variant="subtle"
                      aria-label={`Edit ${boxTitle(bin, numbersInternal)}`}
                      onClick={() => setEditing(bin)}
                    >
                      <IconPencil size={18} />
                    </ActionIcon>
                    {retired ? (
                      <>
                        <ActionIcon
                          variant="subtle"
                          color="green"
                          aria-label={`Restore ${boxTitle(bin, numbersInternal)}`}
                          onClick={() => void setStatus(bin.id, "restore")}
                        >
                          <IconArchiveOff size={18} />
                        </ActionIcon>
                        {confirmDelete === bin.id ? (
                          <Button
                            size="compact-xs"
                            color="red"
                            onClick={() => {
                              setConfirmDelete(null);
                              void setStatus(bin.id, "delete");
                            }}
                            onBlur={() => setConfirmDelete(null)}
                          >
                            Delete for good
                          </Button>
                        ) : (
                          <ActionIcon
                            variant="subtle"
                            color="red"
                            aria-label={`Delete ${boxTitle(bin, numbersInternal)}`}
                            onClick={() => setConfirmDelete(bin.id)}
                          >
                            <IconTrash size={18} />
                          </ActionIcon>
                        )}
                      </>
                    ) : (
                      <ActionIcon
                        variant="subtle"
                        color="red"
                        aria-label={`Retire ${boxTitle(bin, numbersInternal)}`}
                        onClick={() => void setStatus(bin.id, "retire")}
                      >
                        <IconArchive size={18} />
                      </ActionIcon>
                    )}
                  </Group>
                )}
              </Group>
            </Paper>
          );
        })}
      </Stack>

      <Modal
        opened={unlockOpen}
        onClose={() => setUnlockOpen(false)}
        title="Admin controls"
        centered
      >
        <AdminUnlock
          description="Unlock per-box editing, new boxes and retire/restore — with the group admin password, or a passkey."
          onUnlocked={() => setUnlockOpen(false)}
        />
      </Modal>

      <MoveSheet
        opened={moveOpen}
        count={selected.size}
        onClose={() => setMoveOpen(false)}
        onPick={moveSelected}
      />

      {editing && <EditSheet bin={editing} onClose={() => setEditing(null)} />}
    </Stack>
  );

  if (!twoPane) return list;
  return (
    <Group
      align="stretch"
      gap="md"
      wrap="nowrap"
      p="md"
      style={{ height: "100dvh" }}
    >
      <div
        style={{
          flex: "0 0 clamp(360px, 40%, 560px)",
          minWidth: 0,
          overflowY: "auto",
        }}
      >
        {list}
      </div>
      <div style={{ flex: 1, minWidth: 0 }}>
        <BinDetailPane binId={previewId} />
      </div>
    </Group>
  );
}

function MoveSheet({
  opened,
  count,
  onClose,
  onPick,
}: {
  opened: boolean;
  count: number;
  onClose: () => void;
  onPick: (
    target: { locationId: string; name: string } | string | null,
  ) => void | Promise<void>;
}) {
  const places = usePlaces();
  const byId = usePlaceMap();
  const [freeform, setFreeform] = useState("");
  const pick = (
    target: { locationId: string; name: string } | string | null,
  ) => {
    void onPick(target);
    setFreeform("");
  };
  return (
    <ResponsiveSheet
      opened={opened}
      onClose={onClose}
      title={`Move ${count} box${count === 1 ? "" : "es"} to…`}
    >
      <Stack gap="xs" pb="env(safe-area-inset-bottom)">
        {places.map((place) => (
          <Button
            key={place.id}
            size="lg"
            variant="light"
            onClick={() => pick({ locationId: place.id, name: place.name })}
          >
            {locationLabel(byId, place.id) || place.name}
          </Button>
        ))}
        {/* A real place, not a typed-in name: it shows up on the shelf
            view, in every other picker, and can be given a grid later. The
            freeform field below stays for the genuinely one-off ("Sam's
            truck"), which is a different thing. */}
        <Group gap="xs" mt="xs">
          <InlineCreate
            size="lg"
            label="New place"
            placeholder="e.g. Aisle H"
            onCreate={async (name) => {
              const made = await createPlace(byId, name, null);
              pick({ locationId: made.id, name: made.name });
            }}
          />
        </Group>
        <Group gap="xs" mt="xs">
          <TextInput
            placeholder="somewhere else…"
            value={freeform}
            onChange={(e) => setFreeform(e.currentTarget.value)}
            size="lg"
            style={{ flex: 1 }}
            onKeyDown={(e) => {
              if (e.key === "Enter" && freeform.trim()) pick(freeform.trim());
            }}
          />
          <Button
            size="lg"
            variant="default"
            disabled={!freeform.trim()}
            onClick={() => pick(freeform.trim())}
          >
            Set
          </Button>
        </Group>
        <Button
          size="sm"
          variant="subtle"
          color="gray"
          onClick={() => pick(null)}
        >
          Clear location
        </Button>
      </Stack>
    </ResponsiveSheet>
  );
}

function EditSheet({ bin, onClose }: { bin: BinState; onClose: () => void }) {
  const numbersInternal = useBoxNumbersInternal();
  const [name, setName] = useState(bin.name ?? "");
  const [description, setDescription] = useState(bin.description ?? "");
  const [locationName, setLocationName] = useState(bin.locationName ?? "");
  const [weightGrams, setWeightGrams] = useState<number | null>(
    bin.weightGrams,
  );
  const [fillLevel, setFillLevel] = useState<number | null>(bin.fillLevel);
  const [busy, setBusy] = useState(false);

  async function save() {
    setBusy(true);
    try {
      await setBinFields(bin.id, {
        name: name.trim() || null,
        description: description.trim() || null,
        weightGrams,
        fillLevel,
      });
      if ((locationName.trim() || null) !== (bin.locationName ?? null)) {
        await setBinLocation(bin.id, locationName.trim() || null);
      }
      notifications.show({ message: "Saved", color: "green" });
      onClose();
    } catch (err) {
      fail(err);
    } finally {
      setBusy(false);
    }
  }

  return (
    <ResponsiveSheet
      opened
      onClose={onClose}
      title={`Edit ${boxTitle(bin, numbersInternal)}`}
    >
      <Stack gap="sm" pb="env(safe-area-inset-bottom)">
        <TextInput
          label="Name"
          value={name}
          onChange={(e) => setName(e.currentTarget.value)}
        />
        <Textarea
          label="Subtext"
          description="A few short lines under the title — printed on the label."
          autosize
          minRows={2}
          maxRows={4}
          value={description}
          onChange={(e) => setDescription(e.currentTarget.value)}
        />
        <TextInput
          label="Location"
          value={locationName}
          onChange={(e) => setLocationName(e.currentTarget.value)}
        />
        <FillLevelInput value={fillLevel} onChange={setFillLevel} />
        <WeightInput grams={weightGrams} onChange={setWeightGrams} />
        <div>
          <Text size="sm" fw={500} mb={4}>
            Categories
          </Text>
          {/* Membership applies immediately (the bin already exists). */}
          <LabelChips
            selected={new Set(bin.labelIds)}
            onToggle={(labelId, present) =>
              void setBinLabel(bin.id, labelId, present)
            }
          />
        </div>
        <Button onClick={() => void save()} loading={busy}>
          Save
        </Button>
      </Stack>
    </ResponsiveSheet>
  );
}

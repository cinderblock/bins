/**
 * "Which box is X in" — MiniSearch over the local replica (names, external
 * labels, locations, note text). Fully offline; prefix + fuzzy so "sharpee"
 * finds the Sharpies.
 */
import {
  ActionIcon,
  Badge,
  Button,
  Chip,
  Group,
  Paper,
  Stack,
  Text,
  TextInput,
} from "@mantine/core";
import { useDocumentTitle } from "@mantine/hooks";
import {
  IconArrowLeft,
  IconBoxMultiple,
  IconMapPin,
  IconSearch,
} from "@tabler/icons-react";
import { useLiveQuery } from "dexie-react-hooks";
import type MiniSearch from "minisearch";
import { useEffect, useRef, useState } from "react";
import { Link, useNavigate } from "react-router";
import { PhotoImg } from "~/components/PhotoImg";
import { db } from "~/lib/db";
import { formatWeight, labelColor } from "~/lib/labels";
import { type SearchDoc, buildSearchIndex } from "~/lib/search";
import { PAGE_MAXW } from "~/lib/ui";

export default function Search() {
  useDocumentTitle("Search · bins");
  const navigate = useNavigate();
  const [query, setQuery] = useState("");
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
  const labelById = useLiveQuery(
    async () => new Map((await db.labels.toArray()).map((l) => [l.id, l])),
    [],
    new Map(),
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

  const results =
    query.trim() && indexRef.current
      ? indexRef.current.search(query).slice(0, 30)
      : [];
  void indexReady; // rerender trigger

  const hits = useLiveQuery(
    async () => {
      // A category filter browses every active box with that label (the
      // "show me all the booze boxes" view); a text query then narrows it.
      if (filterLabel) {
        const labeled = (
          await db.bins.where("labelIds").equals(filterLabel).toArray()
        )
          .filter((b) => b.status === "active")
          .sort((a, b) => a.id - b.id);
        if (!query.trim()) return labeled;
        const keep = new Set(results.map((r) => r.id as number));
        return labeled.filter((b) => keep.has(b.id));
      }
      const ids = results.map((r) => r.id as number);
      const bins = await db.bins.bulkGet(ids);
      return bins.flatMap((bin) => (bin ? [bin] : []));
    },
    [filterLabel, query, results.map((r) => r.id).join(",")],
    [],
  );

  return (
    <Stack
      p="md"
      pt="max(var(--mantine-spacing-md), env(safe-area-inset-top))"
      gap="md"
      maw={PAGE_MAXW}
      mx="auto"
    >
      <Group gap="sm">
        <ActionIcon
          variant="default"
          size="xl"
          radius="xl"
          onClick={() => navigate(-1)}
          aria-label="Back"
        >
          <IconArrowLeft />
        </ActionIcon>
        <TextInput
          style={{ flex: 1 }}
          size="lg"
          placeholder="Which box is it in…"
          leftSection={<IconSearch size={18} />}
          value={query}
          onChange={(e) => setQuery(e.currentTarget.value)}
          autoFocus
        />
      </Group>

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

      {(query.trim() || filterLabel) && hits.length === 0 && (
        <Text c="dimmed" ta="center" mt="xl">
          {query.trim() ? `Nothing matches "${query}".` : "No boxes here yet."}
        </Text>
      )}

      {!query.trim() && !filterLabel && (
        <Button
          variant="subtle"
          color="gray"
          component={Link}
          to="/bins"
          leftSection={<IconBoxMultiple size={16} />}
          style={{ alignSelf: "center" }}
        >
          Browse all boxes
        </Button>
      )}

      <Stack gap="xs">
        {hits.map((bin) => (
          <Paper
            key={bin.id}
            component={Link}
            to={`/${bin.id}`}
            p="sm"
            radius="md"
            withBorder
            style={{ textDecoration: "none", color: "inherit" }}
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
              <div style={{ minWidth: 0 }}>
                <Group gap={8}>
                  <Text fw={600}>#{bin.id}</Text>
                  {bin.name && <Text truncate>{bin.name}</Text>}
                </Group>
                <Group gap={6}>
                  {bin.locationName && (
                    <Badge
                      variant="light"
                      leftSection={<IconMapPin size={12} />}
                      style={{ textTransform: "none" }}
                    >
                      {bin.locationName}
                    </Badge>
                  )}
                  {bin.weightGrams != null && (
                    <Badge variant="light" color="gray">
                      {formatWeight(bin.weightGrams)}
                    </Badge>
                  )}
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
                  {bin.externalLabel && (
                    <Text size="xs" c="dimmed" truncate>
                      {bin.externalLabel}
                    </Text>
                  )}
                </Group>
              </div>
            </Group>
          </Paper>
        ))}
      </Stack>
    </Stack>
  );
}

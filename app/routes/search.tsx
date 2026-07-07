/**
 * "Which box is X in" — MiniSearch over the local replica (names, external
 * labels, locations, note text). Fully offline; prefix + fuzzy so "sharpee"
 * finds the Sharpies.
 */
import {
  ActionIcon,
  Badge,
  Group,
  Paper,
  Stack,
  Text,
  TextInput,
} from "@mantine/core";
import { IconArrowLeft, IconMapPin, IconSearch } from "@tabler/icons-react";
import { useLiveQuery } from "dexie-react-hooks";
import type MiniSearch from "minisearch";
import { useEffect, useRef, useState } from "react";
import { Link, useNavigate } from "react-router";
import { PhotoImg } from "~/components/PhotoImg";
import { db } from "~/lib/db";
import { type SearchDoc, buildSearchIndex } from "~/lib/search";

export default function Search() {
  const navigate = useNavigate();
  const [query, setQuery] = useState("");
  const indexRef = useRef<MiniSearch<SearchDoc> | null>(null);
  const [indexReady, setIndexReady] = useState(0);

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
      const ids = results.map((r) => r.id as number);
      const bins = await db.bins.bulkGet(ids);
      return bins.flatMap((bin) => (bin ? [bin] : []));
    },
    [results.map((r) => r.id).join(",")],
    [],
  );

  return (
    <Stack
      p="md"
      pt="max(var(--mantine-spacing-md), env(safe-area-inset-top))"
      gap="md"
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

      {query.trim() && hits.length === 0 && (
        <Text c="dimmed" ta="center" mt="xl">
          Nothing matches "{query}".
        </Text>
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

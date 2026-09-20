/**
 * "/new" — a box that doesn't exist yet.
 *
 * Nothing is allocated until the first save or the first drawing: opening
 * this page and walking away costs nothing and burns no id. Once the studio
 * needs a real box (to draw for it, to print it, to save it) it allocates
 * one and carries on; leaving goes to that box's page.
 */
import { Box, Center, Text } from "@mantine/core";
import { useDocumentTitle } from "@mantine/hooks";
import { useNavigate } from "react-router";
import { LabelStudio } from "~/components/LabelStudio";
import { useAdminPassword } from "~/lib/admin";
import { boxPath, useBoxNumbersInternal } from "~/lib/boxRef";
import { PAGE_MAXW } from "~/lib/ui";

export default function NewBox() {
  useDocumentTitle("New box · bins");
  const navigate = useNavigate();
  const adminPassword = useAdminPassword();
  const numbersInternal = useBoxNumbersInternal();

  if (adminPassword === undefined) return null;
  if (adminPassword === null) {
    return (
      <Center h="100dvh" p="md">
        <Text c="dimmed" ta="center">
          Making a box needs admin unlocked — unlock it from the box list.
        </Text>
      </Center>
    );
  }

  return (
    <Box
      maw={PAGE_MAXW}
      mx="auto"
      px="md"
      pb="xl"
      pt="max(var(--mantine-spacing-md), calc(env(safe-area-inset-top) + var(--bins-banner-h, 0px)))"
    >
      <LabelStudio
        bin={null}
        mode="new"
        adminPassword={adminPassword}
        onDone={(box) =>
          navigate(box ? boxPath(box, numbersInternal) : "/bins", {
            replace: true,
          })
        }
      />
    </Box>
  );
}

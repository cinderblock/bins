/**
 * Legacy alias — search merged into the All-boxes page (routes/bins.tsx).
 * Kept as a redirect so old history entries and muscle-memory URLs still
 * land somewhere useful, with the search box focused.
 */
import { Navigate } from "react-router";

export default function Search() {
  return <Navigate to="/bins" replace state={{ focusSearch: true }} />;
}

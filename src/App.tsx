import { MutationCache, QueryCache, QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { createBrowserRouter, Navigate, RouterProvider, useLocation } from "react-router";
import { api } from "@/api";
import { queryKeys } from "@/api/hooks";
import { ApiError, ErrorCodes } from "@/api/types";
import { AppShell } from "@/components/shell/AppShell";
import { AssistantPage } from "@/pages/AssistantPage";
import { HighlightsPage } from "@/pages/HighlightsPage";
import { LibraryPage } from "@/pages/LibraryPage";
import { NotFoundPage } from "@/pages/NotFoundPage";
import { PairPage } from "@/pages/PairPage";
import { ReaderPage } from "@/pages/ReaderPage";
import { SettingsPage } from "@/pages/SettingsPage";
import { useApplySettings } from "@/state/settings";

const FINAL: string[] = [ErrorCodes.notFound, ErrorCodes.unsupported, ErrorCodes.unauthorized];

/** A phone that isn't paired, or was revoked or expired, is sent to /pair. The computer never sees this. */
function onApiError(err: unknown) {
  if (api.mode === "http" && err instanceof ApiError && err.code === ErrorCodes.unauthorized && window.location.pathname !== "/pair") {
    // Health still says which device this was; ask again.
    void queryClient.invalidateQueries({ queryKey: queryKeys.health });
    void router.navigate("/pair", { replace: true });
  }
}

const queryClient = new QueryClient({
  queryCache: new QueryCache({ onError: onApiError }),
  mutationCache: new MutationCache({ onError: onApiError }),
  defaultOptions: {
    queries: {
      staleTime: 30_000,
      refetchOnWindowFocus: false,
      // Don't hammer a missing document, an unsupported call or a missing credential; retry transient failures once.
      retry: (count, err) => !(err instanceof ApiError && FINAL.includes(err.code)) && count < 1,
    },
  },
});

/** Old `/library?…` links keep working: the library is the front page now. */
function LibraryRedirect() {
  const { search } = useLocation();
  return <Navigate to={`/${search}`} replace />;
}

const router = createBrowserRouter([
  // Pairing a phone stands alone: no navigation, nothing that needs a credential.
  { path: "pair", element: <PairPage /> },
  {
    element: <AppShell />,
    children: [
      { index: true, element: <LibraryPage /> },
      { path: "library", element: <LibraryRedirect /> },
      { path: "read/:docId/:sectionId?", element: <ReaderPage /> },
      { path: "assistant", element: <AssistantPage /> },
      { path: "highlights", element: <HighlightsPage /> },
      { path: "settings", element: <SettingsPage /> },
      { path: "*", element: <NotFoundPage /> },
    ],
  },
]);

export function App() {
  useApplySettings();
  return (
    <QueryClientProvider client={queryClient}>
      <RouterProvider router={router} />
    </QueryClientProvider>
  );
}

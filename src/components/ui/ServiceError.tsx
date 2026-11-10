import { CloudOff } from "lucide-react";
import { offline } from "@/api";
import { ApiError, ErrorCodes } from "@/api/types";
import { Button } from "@/components/ui/Button";
import { EmptyState } from "@/components/ui/EmptyState";
import { useOffline } from "@/offline";

export function ServiceError({ error, onRetry }: { error: unknown; onRetry: () => void }) {
  const unavailable = error instanceof ApiError && error.code === ErrorCodes.unavailable;
  // In the iPhone app the backend is your computer, and trying again dials it first.
  const onPhone = useOffline().available;
  const retry = () => {
    if (onPhone && unavailable) void offline?.probe().catch(() => {});
    onRetry();
  };
  return (
    <EmptyState
      icon={CloudOff}
      title={unavailable ? (onPhone ? "This needs your computer" : "Can't reach the reading service") : "Couldn't load this"}
      action={
        <Button variant="secondary" onClick={retry}>
          Try again
        </Button>
      }
    >
      {unavailable
        ? onPhone
          ? "It isn't on this iPhone, and Pager can't reach your computer right now."
          : "Pager is set up to use a backend, and it isn't answering. Check that it's running."
        : error instanceof Error
          ? error.message
          : null}
    </EmptyState>
  );
}

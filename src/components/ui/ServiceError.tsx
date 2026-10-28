import { CloudOff } from "lucide-react";
import { ApiError, ErrorCodes } from "@/api/types";
import { Button } from "@/components/ui/Button";
import { EmptyState } from "@/components/ui/EmptyState";

export function ServiceError({ error, onRetry }: { error: unknown; onRetry: () => void }) {
  const unavailable = error instanceof ApiError && error.code === ErrorCodes.unavailable;
  return (
    <EmptyState
      icon={CloudOff}
      title={unavailable ? "Can't reach the reading service" : "Couldn't load this"}
      action={
        <Button variant="secondary" onClick={onRetry}>
          Try again
        </Button>
      }
    >
      {unavailable
        ? "Pager is set up to use a backend, and it isn't answering. Check that it's running."
        : error instanceof Error
          ? error.message
          : null}
    </EmptyState>
  );
}

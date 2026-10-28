import { Link } from "react-router";
import { Compass } from "lucide-react";
import { CenterColumn } from "@/components/shell/Page";
import { buttonClasses } from "@/components/ui/Button";
import { EmptyState } from "@/components/ui/EmptyState";

export function NotFoundPage() {
  return (
    <CenterColumn className="pt-10">
      <EmptyState
        icon={Compass}
        title="Nothing at this address"
        action={
          <Link to="/" className={buttonClasses("secondary", "md")}>
            Go home
          </Link>
        }
      />
    </CenterColumn>
  );
}

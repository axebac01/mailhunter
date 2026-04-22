import { AlertTriangle, Loader2, RefreshCw } from "lucide-react";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";

interface Props {
  companyIdCount: number;
  isFetching: boolean;
  onRetry: () => void;
}

export function DomainStatsError({ companyIdCount, isFetching, onRetry }: Props) {
  return (
    <Alert className="mb-3 border-warning/40 bg-warning/10 text-foreground [&>svg]:text-warning">
      <AlertTriangle className="h-4 w-4" />
      <div className="flex items-start justify-between gap-3">
        <div className="flex-1">
          <AlertTitle>Couldn't load domain resolution stats</AlertTitle>
          <AlertDescription className="text-muted-foreground">
            Tried to fetch status for {companyIdCount.toLocaleString()} companies but the request failed.
            Banners about resolution progress are hidden until this loads.
          </AlertDescription>
        </div>
        <Button size="sm" variant="outline" onClick={onRetry} disabled={isFetching}>
          {isFetching ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
          Retry
        </Button>
      </div>
    </Alert>
  );
}

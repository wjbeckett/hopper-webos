export function LoadingState({ label }: { label?: string }) {
  return (
    <div className="screen-state loading-state" role="status" aria-busy="true" aria-label={label ?? "Loading"}>
      <span className="loading-spinner" />
    </div>
  );
}

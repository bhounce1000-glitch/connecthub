import EmptyState from './empty-state';
import ScreenShell from './screen-shell';

export default function ListScreen({
  eyebrow,
  title,
  subtitle,
  accentColor,
  accentTextColor,
  backgroundColor,
  toolbar = null,
  isLoading = false,
  loadingView = null,
  hasItems = true,
  emptyTitle = 'Nothing here yet',
  emptyDescription = 'Content will appear here when it becomes available.',
  children,
}) {
  return (
    <ScreenShell
      eyebrow={eyebrow}
      title={title}
      subtitle={subtitle}
      accentColor={accentColor}
      accentTextColor={accentTextColor}
      backgroundColor={backgroundColor}
    >
      {toolbar}

      {isLoading
        ? loadingView
        : hasItems
          ? children
          : (
            <EmptyState
              title={emptyTitle}
              description={emptyDescription}
            />
          )}
    </ScreenShell>
  );
}
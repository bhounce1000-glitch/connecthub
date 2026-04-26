import AppCard from './app-card';
import ScreenShell from './screen-shell';

export default function FormScreen({
  eyebrow,
  title,
  subtitle,
  accentColor,
  accentTextColor,
  backgroundColor,
  scroll = false,
  cardStyle = null,
  footer = null,
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
      scroll={scroll}
    >
      <AppCard style={cardStyle}>
        {children}
      </AppCard>
      {footer}
    </ScreenShell>
  );
}
import { Redirect } from 'expo-router';

// /request is superseded by /request-wizard (multi-step flow).
// This redirect keeps any old bookmarks/links working.
export default function Request() {
  return <Redirect href="/request-wizard" />;
}

const base = require('./app.json').expo;

function uniquePlugins(plugins = []) {
  const out = [];
  const seen = new Set();
  plugins.forEach((plugin) => {
    const key = Array.isArray(plugin) ? JSON.stringify(plugin) : String(plugin);
    if (seen.has(key)) return;
    seen.add(key);
    out.push(plugin);
  });
  return out;
}

module.exports = () => {
  const googleMapsApiKey = process.env.EXPO_PUBLIC_GOOGLE_MAPS_API_KEY || 'EXPO_PUBLIC_GOOGLE_MAPS_API_KEY';
  const plugins = uniquePlugins([
    [
      'expo-location',
      {
        locationAlwaysAndWhenInUsePermission: 'ConnectHub uses your location to help providers navigate to job sites accurately and show distance to nearby jobs.',
        locationWhenInUsePermission: 'ConnectHub uses your location to show job distance and help providers navigate to your location.',
      },
    ],
    ...(base.plugins || []).filter((plugin) => {
      const pluginName = Array.isArray(plugin) ? plugin[0] : plugin;
      return pluginName !== 'expo-location';
    }),
  ]);

  return {
    ...base,
    ios: {
      ...(base.ios || {}),
      infoPlist: {
        ...((base.ios && base.ios.infoPlist) || {}),
        ITSAppUsesNonExemptEncryption: false,
      },
    },
    android: {
      ...(base.android || {}),
      config: {
        googleMaps: {
          apiKey: googleMapsApiKey,
        },
      },
    },
    plugins,
  };
};

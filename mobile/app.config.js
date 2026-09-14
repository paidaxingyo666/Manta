// Why this file exists: a bare "expo-notifications" plugin entry writes
// `aps-environment: development` into the iOS entitlements, while push-token.ts
// reports `production` for every non-__DEV__ build. A TestFlight or App Store build
// would then register a production APNs token against a sandbox entitlement, and the
// relay's pushes would be accepted by Apple and delivered nowhere.
//
// Why production is the default: the self-hosted relay only speaks production APNs,
// so a build made without ORCA_IOS_APS_ENVIRONMENT must not silently mint sandbox
// tokens. Only an explicit `development` opts a local Xcode build into sandbox.
//
// app.json stays the source for everything else: Expo reads it first and hands it to
// this function, so the fastlane version/buildNumber rewrite still flows through.
function resolveApsEnvironment() {
  return process.env.ORCA_IOS_APS_ENVIRONMENT === 'development' ? 'development' : 'production'
}

module.exports = ({ config }) => {
  const apsEnvironment = resolveApsEnvironment()
  return {
    ...config,
    ios: {
      ...config.ios,
      entitlements: { ...config.ios?.entitlements, 'aps-environment': apsEnvironment }
    },
    plugins: (config.plugins ?? []).map((plugin) =>
      plugin === 'expo-notifications'
        ? [
            'expo-notifications',
            {
              enableBackgroundRemoteNotifications: true,
              mode: apsEnvironment,
              icon: './assets/notification-icon.png'
            }
          ]
        : plugin
    )
  }
}

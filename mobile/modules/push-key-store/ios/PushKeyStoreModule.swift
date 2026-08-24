import ExpoModulesCore
import Security

/// Publishes the push decryption key where the notification service extension
/// can read it.
///
/// expo-secure-store cannot do this: it exposes no keychain access group, so
/// everything it writes belongs to the app alone and an extension querying for
/// it finds nothing. The access group below is the whole reason this module
/// exists.
public class PushKeyStoreModule: Module {
  private let service = "cn.sh.manta.mobile.push"
  private let account = "push-key"
  private let accessGroup = "group.cn.sh.manta.mobile"

  public func definition() -> ModuleDefinition {
    Name("PushKeyStore")

    /// Stores a base64 32-byte key. Returns false rather than throwing: a phone
    /// that cannot publish a key still receives notifications, just generic ones.
    Function("setKey") { (keyB64: String) -> Bool in
      guard let data = Data(base64Encoded: keyB64), data.count == 32 else {
        return false
      }
      let query: [String: Any] = [
        kSecClass as String: kSecClassGenericPassword,
        kSecAttrService as String: service,
        kSecAttrAccount as String: account,
        kSecAttrAccessGroup as String: accessGroup
      ]
      // Delete first because SecItemAdd fails with errSecDuplicateItem rather
      // than replacing. Note this only clears the item in THIS access group —
      // a copy written before the entitlement existed lives under a different
      // composite key and is neither removed nor in the way.
      SecItemDelete(query as CFDictionary)

      var attributes = query
      attributes[kSecValueData as String] = data
      // AfterFirstUnlock, not WhenUnlocked: a push can arrive with the screen
      // locked and the extension has to read this then. ThisDeviceOnly on top so
      // an encrypted backup does not carry the key onto a second device, where
      // two installs would hold the same one.
      attributes[kSecAttrAccessible as String] = kSecAttrAccessibleAfterFirstUnlockThisDeviceOnly
      return SecItemAdd(attributes as CFDictionary, nil) == errSecSuccess
    }

    /// Returns the published key so it can be reported again.
    ///
    /// The phone is the only holder: if the desktop loses its copy — a wiped
    /// profile, a re-pair — nothing else can tell it what to seal with, and a
    /// push would fall back to generic text permanently.
    Function("getKey") { () -> String? in
      let query: [String: Any] = [
        kSecClass as String: kSecClassGenericPassword,
        kSecAttrService as String: service,
        kSecAttrAccount as String: account,
        kSecAttrAccessGroup as String: accessGroup,
        kSecReturnData as String: true,
        kSecMatchLimit as String: kSecMatchLimitOne
      ]
      var item: CFTypeRef?
      guard SecItemCopyMatching(query as CFDictionary, &item) == errSecSuccess,
            let data = item as? Data, data.count == 32
      else {
        return nil
      }
      return data.base64EncodedString()
    }

    /// Lets the app tell "never published" from "published and still there".
    Function("hasKey") { () -> Bool in
      let query: [String: Any] = [
        kSecClass as String: kSecClassGenericPassword,
        kSecAttrService as String: service,
        kSecAttrAccount as String: account,
        kSecAttrAccessGroup as String: accessGroup,
        kSecReturnData as String: true,
        kSecMatchLimit as String: kSecMatchLimitOne
      ]
      var item: CFTypeRef?
      guard SecItemCopyMatching(query as CFDictionary, &item) == errSecSuccess,
            let data = item as? Data
      else {
        return false
      }
      return data.count == 32
    }
  }
}

import UserNotifications
import CryptoKit
import Security

/// Opens the sealed body the desktop put in the push and swaps it in.
///
/// iOS gives this about 30 seconds and kills it if the completion handler has
/// not fired. So every failure path below calls it too — with the notification
/// exactly as it arrived. The generic text the desktop already put in `alert`
/// is the floor, and showing that is always better than showing nothing.
class NotificationService: UNNotificationServiceExtension {
  /// Shared with the app: the keychain group holding the decryption key, and
  /// the defaults suite holding how far each push carried the counter.
  private static let appGroup = "group.cn.sh.manta.mobile"
  /// Read by the app before it asks the desktop what it missed.
  private static let deliveredKey = "pushDeliveredSeqByEpoch"
  private static let maxTrackedEpochs = 8

  private var handler: ((UNNotificationContent) -> Void)?
  private var content: UNMutableNotificationContent?

  override func didReceive(
    _ request: UNNotificationRequest,
    withContentHandler contentHandler: @escaping (UNNotificationContent) -> Void
  ) {
    handler = contentHandler
    content = request.content.mutableCopy() as? UNMutableNotificationContent
    guard let content else {
      contentHandler(request.content)
      return
    }

    // Before every guard below: those all end in the desktop's generic text,
    // which is still a delivered notification. Recording only on the decrypt
    // path would leave the app re-notifying everything the extension could not
    // read — the exact duplicate this mark exists to stop.
    recordDelivered(request.content.userInfo)

    guard
      let sealed = request.content.userInfo["mb"] as? [String: Any],
      let version = sealed["v"] as? Int, version == 1,
      let payload = sealed["d"] as? String,
      let key = readSharedKey(),
      let plaintext = open(payload: payload, with: key),
      let items = decodeItems(plaintext),
      // Last, not first: the batch arrives oldest-first, and a lock screen has
      // room for one line. Showing the oldest meant every push in a busy session
      // displayed the same stale message no matter what had just happened.
      let latest = items.last
    else {
      // Every one of these is the same outcome: the desktop's generic text.
      contentHandler(content)
      return
    }

    // Both fall back to what the desktop already wrote. A decrypted-but-empty
    // body would otherwise replace readable generic text with nothing, which is
    // worse on the lock screen than not decrypting at all.
    content.title = latest.title.isEmpty ? content.title : latest.title
    let body = latest.body.isEmpty ? content.body : latest.body
    content.body = items.count == 1 ? body : "\(body)\n+\(items.count - 1)"
    contentHandler(content)
  }

  /// Called when the 30 seconds run out. Delivering the unmodified push beats
  /// delivering nothing, so this is not an error path either.
  override func serviceExtensionTimeWillExpire() {
    if let handler, let content {
      handler(content)
    }
  }

  // MARK: - Decryption

  private func open(payload: String, with key: SymmetricKey) -> String? {
    guard let raw = Data(base64Encoded: payload), raw.count > 12 + 16 else {
      return nil
    }
    // nonce ‖ ciphertext ‖ tag — the layout push-payload-encryption.ts writes.
    guard let nonce = try? AES.GCM.Nonce(data: raw.prefix(12)) else {
      return nil
    }
    guard
      let box = try? AES.GCM.SealedBox(
        nonce: nonce,
        ciphertext: raw.dropFirst(12).dropLast(16),
        tag: raw.suffix(16)
      ),
      let opened = try? AES.GCM.open(box, using: key)
    else {
      return nil
    }
    return String(data: opened, encoding: .utf8)
  }

  private struct Item {
    let title: String
    let body: String
  }

  private func decodeItems(_ json: String) -> [Item]? {
    // Parenthesised deliberately: `try? x as? T` parses as `try? (x as? T)` and
    // yields a double optional, so the bind below would succeed on nil.
    guard
      let data = json.data(using: .utf8),
      let raw = (try? JSONSerialization.jsonObject(with: data)) as? [[String: Any]]
    else {
      return nil
    }
    return raw.map { Item(title: $0["t"] as? String ?? "", body: $0["b"] as? String ?? "") }
  }

  // MARK: - Shared key

  /// Records how far this push carried the desktop's notification counter.
  ///
  /// The app's catch-up watermark only advances on a live socket delivery, so
  /// without this every push shown while the app was closed is replayed as a
  /// local notification on the next open. Keyed by epoch because a seq means
  /// nothing across a desktop restart.
  ///
  /// Best effort by design: a miss here costs a duplicate notification, and
  /// nothing about it is worth failing a delivery over.
  private func recordDelivered(_ userInfo: [AnyHashable: Any]) {
    guard
      let seq = userInfo["ds"] as? Int,
      let epoch = userInfo["de"] as? String,
      let defaults = UserDefaults(suiteName: Self.appGroup)
    else {
      return
    }
    var marks = defaults.dictionary(forKey: Self.deliveredKey) as? [String: Int] ?? [:]
    // Monotonic: pushes can arrive out of order, and a lower seq must never
    // walk the mark backwards into ground the app has already skipped.
    if let known = marks[epoch], known >= seq {
      return
    }
    marks[epoch] = seq
    // One epoch per desktop counter lifetime, so this grows only with restarts
    // of paired desktops. Keeping the newest few bounds it without needing to
    // know which epoch is live — the app ignores every epoch but its own.
    if marks.count > Self.maxTrackedEpochs {
      let newest = marks.sorted { $0.value > $1.value }.prefix(Self.maxTrackedEpochs)
      marks = Dictionary(uniqueKeysWithValues: newest.map { ($0.key, $0.value) })
    }
    defaults.set(marks, forKey: Self.deliveredKey)
  }

  /// Reads the key the app published into the shared keychain group.
  ///
  /// The access group is what makes this readable from an extension at all: a
  /// keychain item written without one belongs to the app alone, and this
  /// target would find nothing no matter how correct everything else is.
  private func readSharedKey() -> SymmetricKey? {
    let query: [String: Any] = [
      kSecClass as String: kSecClassGenericPassword,
      kSecAttrService as String: "cn.sh.manta.mobile.push",
      kSecAttrAccount as String: "push-key",
      kSecAttrAccessGroup as String: Self.appGroup,
      kSecReturnData as String: true,
      kSecMatchLimit as String: kSecMatchLimitOne
    ]
    var item: CFTypeRef?
    guard SecItemCopyMatching(query as CFDictionary, &item) == errSecSuccess,
          let data = item as? Data, data.count == 32
    else {
      return nil
    }
    return SymmetricKey(data: data)
  }
}

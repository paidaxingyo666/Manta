import ExpoModulesCore

/// Reads what the notification service extension recorded on each delivered push.
///
/// The app's catch-up watermark only advances when a notification arrives over a
/// live socket. Everything APNs showed while the app was closed leaves it
/// untouched, so the next connect asks the desktop for that whole span again and
/// notifies all of it a second time. The extension writes how far each push
/// carried the counter; this hands that back so the catch-up can skip it.
///
/// Read-only on purpose. The extension owns the writes — it is the only side
/// that runs for every delivery — and a second writer could only walk the mark
/// backwards.
public class PushDeliveredSeqModule: Module {
  private let appGroup = "group.cn.sh.manta.mobile"
  private let deliveredKey = "pushDeliveredSeqByEpoch"

  public func definition() -> ModuleDefinition {
    Name("PushDeliveredSeq")

    /// Highest sequence a push delivered for `epoch`, or nil if none did.
    ///
    /// Keyed by epoch because a sequence only means something inside one
    /// counter lifetime: a desktop restart begins a new one, and folding a
    /// number from the old counter into the new would skip real notifications.
    Function("seqForEpoch") { (epoch: String) -> Int? in
      guard
        let defaults = UserDefaults(suiteName: appGroup),
        let marks = defaults.dictionary(forKey: deliveredKey) as? [String: Int]
      else {
        return nil
      }
      return marks[epoch]
    }
  }
}

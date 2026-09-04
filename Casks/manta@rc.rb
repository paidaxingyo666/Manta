# This repo IS the Homebrew tap — see manta.rb. `fork-release.yml` keeps the
# version and hashes below in sync with the newest pre-release.
#
#   brew tap paidaxingyo666/manta https://github.com/paidaxingyo666/Manta
#   brew install --cask paidaxingyo666/manta/manta@rc
#
cask "manta@rc" do
  arch arm: "arm64", intel: "x64"

  version "1.4.196-rc.3"
  sha256 arm:   "1e15ade18dfa6a5ce6cece0f7fa7c3fc33ee252d750cdb392ac13a52c8212e71",
         intel: "346ca069e5760df30540a08267e1380edbefc30c8e2b6ebfaa7fe3c7cf03dcb4"

  url "https://github.com/paidaxingyo666/Manta/releases/download/v#{version}/manta-macos-#{arch}.dmg",
      verified: "github.com/paidaxingyo666/Manta/"
  name "Manta RC"
  desc "IDE for orchestrating AI coding agents across terminals and worktrees"
  homepage "https://github.com/paidaxingyo666/Manta"

  livecheck do
    url "https://github.com/paidaxingyo666/Manta"
    regex(/^v?(\d+(?:\.\d+)+-rc\.\d+)$/i)
    strategy :github_releases do |json, regex|
      json.map do |release|
        next if release["draft"]
        next unless release["prerelease"]

        match = release["tag_name"]&.match(regex)
        next if match.blank?

        match[1]
      end
    end
  end

  # Why: RC installs should follow Manta's prerelease-aware updater instead of
  # waiting for Homebrew metadata churn between frequent release candidates.
  auto_updates true
  conflicts_with cask: "manta"
  depends_on macos: :big_sur

  app "Manta.app"

  # Why: expose the bundled `manta` CLI on PATH at install time (Homebrew symlinks
  # this into its already-on-PATH bin dir). Without it, the CLI is only registered
  # by the in-app "Install CLI" action, which a headless host can never trigger —
  # so `manta serve` on a server would be unreachable from the shell. The shim
  # resolves the real app by walking symlinks, so the Homebrew symlink works.
  binary "#{appdir}/Manta.app/Contents/Resources/bin/manta"

  # Why: Manta writes user data under ~/.manta (worktrees, agent state) and
  # Electron's standard userData directories. Zap removes everything the app
  # creates during normal use so `brew uninstall --zap` is a clean slate.
  zap trash: [
    "~/.manta",
    "~/Library/Application Support/Manta",
    "~/Library/Caches/cn.sh.manta",
    "~/Library/Caches/cn.sh.manta.ShipIt",
    "~/Library/HTTPStorages/cn.sh.manta",
    "~/Library/Preferences/cn.sh.manta.plist",
    "~/Library/Saved Application State/cn.sh.manta.savedState",
  ]
end

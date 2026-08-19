cask "manta" do
  arch arm: "arm64", intel: "x64"

  version "1.3.24"
  sha256 arm:   "fc707f290ff3b631b7b7947bf339885b61a43d2e89475997c125b61268ed4966",
         intel: "5f677c13a08f7a5740442e29d388285a86488c8c1f7aa5f10a8721a2c6ede8e4"

  url "https://github.com/paidaxingyo666/Manta/releases/download/v#{version}/manta-macos-#{arch}.dmg",
      verified: "github.com/paidaxingyo666/Manta/"
  name "Manta"
  desc "IDE for orchestrating AI coding agents across terminals and worktrees"
  homepage "https://github.com/paidaxingyo666/Manta"

  livecheck do
    url :url
    strategy :github_latest
  end

  # Why: electron-updater (src/main/updater.ts) handles in-place updates by
  # writing a new Manta.app into /Applications. Marking the cask auto_updates
  # tells Homebrew not to compete with the in-app updater — `brew upgrade`
  # becomes a no-op unless the user passes --greedy, and brew's version
  # metadata stays aligned with whatever the app has swapped itself to.
  auto_updates true
  conflicts_with cask: "manta@rc"
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

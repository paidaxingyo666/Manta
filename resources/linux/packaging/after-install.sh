#!/bin/bash
# Why: register the bundled `manta-ide` CLI on PATH at package-install time.
# The in-app "Install CLI" action (CliInstaller) can never run on a headless
# server, so without this symlink `manta serve` is unreachable from the shell on
# the exact hosts that need it most. deb/rpm both run this after unpacking.
#
# The shim resolves the real app by walking up from its own location, so a
# symlink works. We discover the install dir instead of hardcoding /opt/Manta
# because electron-builder's directory name can vary by productName sanitization.
set -e

link="/usr/bin/orca-ide"

for dir in /opt/Manta /opt/manta-ide /opt/manta; do
  sandbox="$dir/chrome-sandbox"
  if [ -f "$sandbox" ]; then
    # Why: packaged Linux installs must leave Chromium's sandbox helper usable
    # on hosts where unprivileged user namespaces are unavailable.
    chmod 4755 "$sandbox" || true
  fi

  shim="$dir/resources/bin/manta-ide"
  if [ -x "$shim" ]; then
    # Only manage our own symlink; never clobber an unrelated /usr/bin/orca-ide.
    if [ ! -e "$link" ] || [ -L "$link" ]; then
      ln -sf "$shim" "$link"
    fi
    break
  fi
done

exit 0

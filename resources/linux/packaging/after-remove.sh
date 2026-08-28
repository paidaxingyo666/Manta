#!/bin/bash
# Why: remove the PATH symlink that after-install.sh created, but only if it
# still points into a Manta install dir — never delete an unrelated
# /usr/bin/manta-ide a user or other package may own.
set -e

link="/usr/bin/manta-ide"

if [ -L "$link" ]; then
  target="$(readlink "$link" || true)"
  case "$target" in
    /opt/Manta/*|/opt/manta-ide/*|/opt/manta/*)
      rm -f "$link"
      ;;
  esac
fi

exit 0

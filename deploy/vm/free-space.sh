#!/usr/bin/env bash
# Free disk space taken by EkBill's own leftovers, and nothing else.
#
# Each rebuild leaves the previous app image behind. This removes EkBill images that no container
# uses: ones built by the ekbill compose project and no longer tagged. It never touches the
# tariff product's images, containers, volumes or build cache, and never runs a system or volume
# prune. The database volume is not an image and is not touched.
#
#   cd ~/easybills && deploy/vm/free-space.sh
source "$(dirname "${BASH_SOURCE[0]}")/lib.sh"

say "Before"
df -h / | tail -1
docker system df

say "EkBill images no container uses"
in_use="$(docker ps -a --format '{{.Image}}' | sort -u)"
old="$(docker image ls --filter 'label=com.docker.compose.project=ekbill' --filter dangling=true -q | sort -u)"
if [ -z "$old" ]; then
  echo "none"
else
  for id in $old; do
    if echo "$in_use" | grep -q "$id"; then continue; fi
    docker image rm "$id" >/dev/null && echo "removed $id"
  done
fi

say "After"
df -h / | tail -1
echo
echo "Still short of space? 'docker system df' above shows what is large. The build cache and the"
echo "other projects' images are shared with the tariff product: ask its owner before clearing them."

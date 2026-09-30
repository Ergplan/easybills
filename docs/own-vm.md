# Moving EkBill to its own VM

EkBill started on the tariff-order VM, next to the tariff and fdre products. Sharing that VM has
cost it twice: the disk filled up (no room to build), and the VM's IP changed under it (the link
stopped working). This moves EkBill to a VM of its own, `ekbill`, without copying the tariff VM:
a machine image would copy the other products, their data and their keys too.

What Terraform creates (`infra/gcp/own_vm.tf`, EkBill's own state `ekbill/dev`):

| | |
| --- | --- |
| VM | `ekbill`, e2-standard-4 (4 vCPU, 16 GB), Ubuntu 24.04, 50 GB disk, `asia-south2-b`, deletion protection on |
| Address | `ekbill-vm-ip`, reserved from the start, so the link never changes under it |
| Identity | service account `ekbill-vm`: reads only the `ekbill-*` secrets, writes only the EkBill backup bucket, sends logs |
| Firewall | the existing `ekbill-allow-web` rule, through the `ekbill-web` tag |
| First boot | Docker, git and cron installed, container logs capped at 30 MB each |

The secrets (database password, gate password, OpenAI key) are the same ones, so the gate
password does not change. The bills move with a backup and a restore; the new VM also gets the
latest code, built with room to spare.

The steps below take about 30 minutes, of which EkBill is unavailable for about 5 (step 3).

## 1. Create the VM (on the tariff-order VM, as before)

```bash
cd ~/easybills && git pull && deploy/vm/own-vm.sh create
```

The plan should only **create**: `ekbill-vm` (service account), `ekbill-vm-ip`, `ekbill` (the VM)
and a few access grants. It also says one existing grant has "moved" (a rename inside Terraform,
nothing changes in Google Cloud). If anything would be destroyed, the script stops by itself.

If the apply fails with a permission error (the VM's own account may not be allowed to create
service accounts or VMs), run the same thing from Cloud Shell, which uses your own login:

```bash
gcloud compute scp --recurse --zone asia-south2-b --project tariff-order-parsing tariff-order:~/easybills ~/
cd ~/easybills && deploy/vm/own-vm.sh create
```

At the end it prints the new VM's IP, its link (`<ip-with-dashes>.sslip.io`) and the ssh command.

## 2. Set up EkBill on the new VM

Wait two minutes for the first boot to install Docker, then:

```bash
gcloud compute ssh ekbill --zone asia-south2-b --project tariff-order-parsing
sudo usermod -aG docker $USER && exit        # then ssh in again, so the group applies
```

The new VM needs its own read-only deploy key (never copy the old VM's key):

```bash
ssh-keygen -t ed25519 -C "ekbill-own-vm" -f ~/.ssh/id_ed25519_ekbill -N ""
cat ~/.ssh/id_ed25519_ekbill.pub   # github.com/Ergplan/easybills > Settings > Deploy keys > Add (read-only)
cat >> ~/.ssh/config <<'EOF'
Host github-ekbill
  HostName github.com
  User git
  IdentityFile ~/.ssh/id_ed25519_ekbill
  IdentitiesOnly yes
EOF
git clone -b claude/admiring-wright-5w8x4g git@github-ekbill:Ergplan/easybills.git ~/easybills
cd ~/easybills && deploy/vm/host-setup.sh
```

`host-setup.sh` checks the VM can read the secrets, schedules the nightly backup, builds and
starts EkBill (about 10 minutes the first time) and prints the new link. It starts with an empty
database; open `https://<new-ip-with-dashes>.sslip.io/api/health` and check `"database":"ok"`.

## 3. Move the bills (about 5 minutes without EkBill)

On the **old** VM: stop EkBill there and write the final backup.

```bash
cd ~/easybills && git pull && deploy/vm/handover.sh
```

On the **new** VM: load it and start.

```bash
cd ~/easybills && deploy/vm/restore.sh latest --replace && EKBILL_NO_BUILD=1 deploy/vm/up.sh
```

`restore.sh` prints how many businesses and bills it restored. Open the new link, sign past the
gate with the same password, and check your bills are there. Share the new link.

**Changed your mind?** On the old VM, `EKBILL_NO_BUILD=1 deploy/vm/up.sh` brings the old copy
back exactly as it was: nothing there was deleted.

## 4. Tidy up the old VM (after a day or two of the new one working)

```bash
# On the old VM: remove EkBill's containers, its data volume and images (asks twice)
cd ~/easybills && deploy/vm/retire.sh --delete-data
# Where you ran step 1: the old VM stops reading EkBill's secrets and bucket
deploy/vm/own-vm.sh drop-old-access
```

`retire.sh` touches only the `ekbill` compose project: `tariff_pgdata` and everything else of the
tariff and fdre products stay. It frees the disk EkBill used there (roughly 10 GB with images).

One thing stays: `ekbill-ip`, the address EkBill reserved on the tariff-order VM. It keeps that
VM's IP from changing again, which helps the tariff product. Keep it, move it into the tariff
product's Terraform, or ask to release it; it costs a little while reserved.

## Backups

The nightly backup (02:30 IST) now talks to the database container directly. The earlier version
went through `docker compose -f ...`, which refuses to start without the secrets in its
environment, as under cron: backups before this change most likely did not run. `handover.sh`
writes a fresh one, and `deploy/vm/backup.sh` can be run by hand any time.

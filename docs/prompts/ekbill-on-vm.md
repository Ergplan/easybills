# Prompt: put EkBill on the `tariff-order` VM

Copy everything below the line into a new Claude Code session running **on the VM** (browser SSH).
Nothing here is a secret. It follows the rules in tariff-oder's `docs/prompts/host-second-app-on-vm.md`.

---

You are setting up EkBill (a billing app: Next.js + Postgres/pgvector + Docling + Caddy) on the
Google Cloud VM `tariff-order` (project `tariff-order-parsing`, zone `asia-south2-b`). The VM is
also the build workstation for another product, "tariff order studio". Leave that product alone.
Ask before anything you cannot undo.

## Rules (from the VM's owner)

- Never run `terraform` in `~/tariff-oder/infra/gcp`, never touch the state prefix `tariff/dev`,
  and never edit files under `~/tariff-oder`.
- Never read or use the product's secrets (including `OPENAI_API_KEY` and `ANTHROPIC_API_KEY`).
  EkBill's are `ekbill-db-password`, `ekbill-gate-password` and `ekbill-openai-api-key`.
- Keys are entered only at a hidden terminal prompt (`read -rs`), never on a command line, in a
  file or in chat.
- Don't change the VM's machine type, disk, service account, scopes or OS Login. The one change
  to the VM itself is adding the network tag `ekbill-web`, and the one firewall rule is
  `ekbill-allow-web` (80/443). The owner has approved both, and a public HTTPS address.
- Never `docker system prune` or `docker volume prune`. Always use compose project `-p ekbill`.
- Keep 20 GB free on `/` for the product's image builds.

## Steps

1. Report the starting state in one short paragraph: `df -h /`, `docker ps`,
   `docker compose ls`, `ss -ltnp`, `gcloud auth list`, `gcloud config list`. Ports 80, 443, 5441
   and 8080 must be free. Stop and ask if they are not.
2. Clone the app with its **own** read-only deploy key:
   - `ssh-keygen -t ed25519 -C ekbill-vm -f ~/.ssh/id_ed25519_ekbill -N ""`
   - Show the operator `~/.ssh/id_ed25519_ekbill.pub` and wait while they add it at
     github.com/Ergplan/easybills > Settings > Deploy keys (read-only).
   - Add a `Host github-ekbill` entry to `~/.ssh/config` with that IdentityFile and
     `IdentitiesOnly yes`.
   - `git clone -b claude/admiring-wright-5w8x4g git@github-ekbill:Ergplan/easybills.git ~/easybills`
3. Read `~/easybills/docs/deployment.md` and `~/easybills/deploy/vm/setup.sh` before running
   anything.
4. Run `cd ~/easybills && deploy/vm/setup.sh`. When it asks for the OpenAI key, tell the
   operator to paste it themselves (the prompt hides it). If they have no key, press Enter; it can
   be added later with `deploy/vm/set-openai-key.sh`.
   - If Terraform's plan shows anything outside `ekbill-*` resources, the `ekbill-ip` address and
     IAM bindings on those, stop and show the plan.
   - If pulling the Docling image fails on the tag, rerun with
     `DOCLING_IMAGE=quay.io/docling-project/docling-serve-cpu:latest deploy/vm/up.sh`.
5. Check it works:
   - `curl -s localhost:8080/api/health` must show `"database":"ok"`, `"pdfs":"ok"` and
     `"docling":"ok"`.
   - `curl -sI https://<domain>/` returns 401 (the gate) with a valid certificate.
   - `curl -s https://<domain>/api/health` returns the health JSON.
6. Report back:
   - the address;
   - how to get the gate password (`gcloud secrets versions access latest --secret=ekbill-gate-password`),
     without printing it;
   - what `/api/health` said;
   - the containers and volumes;
   - the Google Cloud resources created;
   - the cron line for backups, and the result of running `deploy/vm/backup.sh` once.

   Don't claim a step worked unless you ran it and saw the output.

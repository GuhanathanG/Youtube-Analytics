# Oracle Cloud free server: step-by-step

Goal: one always-on free server in **Mumbai** that runs the engine non-stop (and later its own fast
Postgres and local AI models). You do steps 1–6 once (about 30–45 minutes). After that, every update is
installed by a GitHub workflow — you never need to log in to the server.

**Cost:** ₹0. Oracle's *Always Free* allowance (as of 2026: Ampere A1 Arm, **2 CPUs / 12 GB memory**
in total, 200 GB disk) covers this server. A card is needed only to verify you; Oracle places a small
temporary hold and releases it. Step 6 adds a ₹100 budget alert as a safety net.

---

## 1. Create the account (10 min)

1. On your PC, open **https://www.oracle.com/cloud/free/** and click **Start for free**.
2. **Country/Territory:** India. Enter your name and email, then confirm the email link.
3. **Account name** (cloud account name): something short like `guhanpulse` (lowercase, you'll type it to sign in).
4. **Home Region: choose `India West (Mumbai)`.** ⚠️ This can never be changed, and Always Free
   servers can only be created in the home region. Mumbai = next to your database and to you.
5. Fill in the address, then **Add payment verification method** → card details. (Debit cards sometimes
   fail; a credit card works most reliably.)
6. Accept the agreement → **Start my free trial**.
7. Wait for the email **"Your Oracle Cloud account is fully provisioned"** (usually 5–30 minutes,
   occasionally a few hours). Sign in at **https://cloud.oracle.com** with the account name from step 3.

> You also get a 30-day trial credit. Ignore it; nothing we create uses it. When the trial ends,
> Always Free resources keep running.

## 2. Create the server (10 min)

1. In the Oracle console: **☰ menu → Compute → Instances → Create instance**.
2. **Name:** `pulse-server`.
3. **Placement:** leave as is (Mumbai has one availability domain).
4. **Image and shape → Edit:**
   - **Change image** → **Canonical Ubuntu** → version **24.04** (it must be the plain one, *not* "Minimal") → **Select image**.
   - **Change shape** → **Ampere** → tick **VM.Standard.A1.Flex** → set **OCPUs: 2** and **Memory: 12 GB** → **Select shape**.
     The box should say *"Always Free-eligible"*.
5. **Primary VNIC information / Networking:** choose **Create new virtual cloud network** and **Create new public subnet**
   (defaults are fine). Make sure **Assign a public IPv4 address** is **on**.
6. **Add SSH keys:** choose **Generate a key pair for me** → click **Save private key** (and **Save public key**).
   Keep the downloaded `.key` file safe, e.g. in `Documents\oracle`. **Never share it in chat.**
7. **Boot volume:** leave the default size (about 47 GB).
8. Scroll down → **Show advanced options → Management → Initialization script → Paste cloud-init script**,
   and paste the whole content of [`deploy/oracle/cloud-init.yaml`](../deploy/oracle/cloud-init.yaml)
   (open it on GitHub → **Raw** → select all → copy).
9. Click **Create**. After 1–3 minutes the instance shows **Running**. Copy its **Public IP address**
   (Instance details → *Instance access*).

**"Out of capacity for shape VM.Standard.A1.Flex"?** Very common. Options, in order:
- Try again later (early morning or late night India time usually works), same settings.
- Temporarily use **1 OCPU / 6 GB**, and resize to 2 / 12 later (Instance → *Edit* → shape).
- Upgrading the account to **Pay As You Go** (Billing → *Upgrade*) gives much better capacity and stops
  Oracle from reclaiming idle Always Free servers. Always Free resources stay free; with the budget alert
  from step 6 you'd be told the moment anything costs money.

## 3. Open the web ports in Oracle's firewall (3 min)

The server's own firewall is opened by the init script. Oracle also has a network firewall:

1. Instance details → under **Primary VNIC**, click the **Subnet** link → **Security Lists** →
   **Default Security List for vcn-…**.
2. **Add Ingress Rules** → Source CIDR `0.0.0.0/0`, IP protocol **TCP**, Destination port range `80,443`
   → **Add Ingress Rules**.

## 4. Check the server is ready (2 min, optional)

On Windows: open **PowerShell** and run (change the key file path and the IP):

```
ssh -i "$HOME\Documents\oracle\ssh-key-2026-11-07.key" ubuntu@YOUR.PUBLIC.IP "cat /opt/pulse/READY"
```

It should print `Creator Pulse server prepared`. (If Windows complains the key's permissions are too
open: right-click the key file → Properties → Security → Advanced → *Disable inheritance* → remove every
user except yourself.)

## 5. Give GitHub the keys to install updates (3 min)

GitHub → repository **Settings → Secrets and variables → Actions → New repository secret**, add:

| Name | Value |
|---|---|
| `ORACLE_HOST` | the server's public IP, e.g. `140.238.xx.xx` |
| `ORACLE_SSH_KEY` | the **whole content** of the private key file (open the `.key` file in Notepad, copy everything including the `-----BEGIN` and `-----END` lines) |

Then tell Claude **"Oracle ready"**. Claude adds the *Deploy to server* workflow, which installs and
updates everything over SSH using these secrets — the key is never shown in chat or logs.

## 6. Safety net: budget alert (2 min)

**☰ menu → Billing & Cost Management → Budgets → Create Budget:** name `free-tier-guard`, target
*Compartment* = your root compartment, monthly amount **₹100**, alert at **1%** of budget, your email.
You'll get an email if anything ever starts costing money.

---

### What runs on the server (after "Oracle ready")

1. **Phase 1 — engine:** the background job runs continuously (no 20-minute slices), the AI reads new
   comments as they arrive, and topic/emotion models stay loaded. The database stays on Supabase Mumbai
   (same city, ~1 ms away). GitHub Actions and the Vercel engine stay as backups.
2. **Phase 2 (optional) — its own Postgres:** a database with 12 GB of memory on the same machine,
   copied from Supabase (the *Move database* workflow), with Supabase kept as a nightly backup.
3. The website can stay on Vercel (simplest) or move to the server later.

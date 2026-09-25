# GST returns — a short guide

This part of the app appears only if you are registered under **regular GST**.
If you are not, you will never see it.

---

## The five words that matter

People use "filed" loosely. This app does not. These mean different things and
we always tell you which one you are at.

| Word | What it means |
|---|---|
| **Being prepared** | We have worked out the figures from your records |
| **Needs checking** | Something does not add up and needs your attention |
| **Ready** | Nothing is blocking. You can take it to the portal |
| **Uploaded** | A file has been sent and the portal is processing it |
| **Filed** | The portal confirmed it and issued an acknowledgement number |

**Only "Filed" means the return is done.** A generated file is not filing. An
upload receipt is not filing. A challan or a payment receipt is not filing —
paying tax and filing a return are two separate things.

If you file on the portal yourself and tell us the acknowledgement number, we
show **"Reported filed — verification pending"** until it has been checked
against the portal. We will not claim a return is filed on your word alone. That
is not distrust; it is that the record needs to be true even when nobody
remembers typing it.

---

## Setting up, once

We ask four things. They come from your GST registration, so please check them
on the portal or with your accountant rather than guessing.

- **Your GST number.**
- **How often you file** — every month, or every three months (QRMP). This is
  set on your registration. It is **not** decided by how small your business is,
  and we will never assume it for you or enrol you in anything.
- **If you file quarterly**: whether you upload your business-to-business bills
  in the first two months (the Invoice Furnishing Facility). If you do, we will
  not report those same bills again in the quarterly return.
- **The first period** you want us to help with. Earlier periods stay with
  whoever handled them.

If you file quarterly, remember that you still **pay** tax in the first two
months of each quarter, even though the return itself is quarterly.

---

## The four steps

### 1. Check sales

Everything you billed in the period. Bills you raised in this app are counted
automatically; drafts are not, because a draft is not a sale.

We then ask you three questions, and we need honest answers:

- Are **all** your sales for this period here?
- Are **all** your purchases here?
- Have you checked whether you owe tax on anything **else** — tax you pay
  yourself on a purchase, imports, advances?

Sales invoices on their own are not a complete return. And if the app is empty
we will *not* assume you had no business — we ask you to say so explicitly.

If a figure looks wrong, open **See every sale behind these figures**. It shows
the bills behind each total: sales to GST-registered customers one by one,
everything else grouped by state and rate but still openable to the individual
bills, your credit and debit notes, what you sold by HSN/SAC code, and the bill
numbers you used. Anything you imported from a CSV or the portal says so,
because there is no bill in this app to open.

### 2. Check purchases

Two uploads:

- **Your purchase bills**, as a CSV. Columns: `supplier_gstin`, `supplier_name`,
  `document_number`, `document_date`, `taxable_value`, `cgst`, `sgst`, `igst`,
  `cess`. Dates as `YYYY-MM-DD` or `DD/MM/YYYY`.
- **Your GSTR-2B**, downloaded from the GST portal for that period.

We then compare them and tell you where they disagree:

| What we say | What it means |
|---|---|
| The amounts do not match | You and your supplier have recorded different figures |
| Not in the GST statement | Your supplier may not have reported it yet |
| Not in your records | The statement has a bill you have not entered |
| Entered twice | The same bill is in your records more than once |
| Written differently | It looks like the same bill, but the numbers differ — please check |

Anything serious must be dealt with before the return is ready. You can always
say "I have checked this" and record **why** — your reason is kept.

Then, the part nobody else will do for you: **for each purchase, say whether you
can claim the credit.** A bill showing up in GSTR-2B does not by itself mean the
credit is yours. We never claim it on your behalf, and the return will not be
ready while any bill is undecided.

### 3. Review GST

What you owe, and why. In plain terms: GST on your sales, less the credit you
confirmed, gives what you are likely to pay.

Open *See the detail* for the figures head by head — CGST, SGST/UTGST, IGST and
cess. They are kept separate on purpose, because credit in one cannot always pay
another. The total is **not** simply "sales GST minus purchase GST".

If we do not have your credit and cash balances from the GST portal, we say the
figure is an **estimate** and tell you to check the portal before paying. We
will not work out your balances from your bank receipts — that is not what they
mean.

### 4. File or hand over

**Download the accountant pack.** Spreadsheets of your sales, your purchases and
the credit decision recorded against each one, the checks, and the workings —
plus a plain-English note explaining what has and has not happened. Your
accountant does not need an account here. Every file says, at the top, that it
is prepared and not filed.

**Approve this return.** If nothing is blocking, you can approve it. If you then
change anything at all, the approval stops being valid and you approve again —
so what gets sent is always what you actually looked at.

**Filing from inside the app is not available yet.** It needs a connection to an
authorised GST provider, and this installation does not have one. We tell you
that plainly rather than pretending. Use the pack and file on the portal.

**Already filed it yourself?** Record the acknowledgement number and we will
show it as *Reported filed — verification pending*.

---

## Why we block things

It can be irritating to be told a return is not ready. Each block is there
because the alternative is worse:

| Blocked when | Because |
|---|---|
| You have not answered the completeness questions | Sales invoices alone are not a complete return |
| There are no sales but there are purchases | That is not automatically a nil return |
| Nothing at all is recorded and you have not confirmed it | An empty app is not proof of no business |
| A purchase has no credit decision | We will not claim credit for you |
| No GSTR-2B has been imported | There is nothing to check your purchases against |
| Your records changed after the statement was imported | The checks are out of date |
| A purchase is marked reverse charge | This app cannot work out that tax |
| Tax rules are unconfirmed in this installation | A setup step for whoever runs the app |

---

## What this app does not do

- Composition returns (CMP-08, GSTR-4) and annual returns (GSTR-9, GSTR-9C)
- Work out tax you owe under reverse charge, on imports, or on advances
- Decide whether you can claim a credit
- Pay your tax
- File anything automatically, or on a schedule
- Handle your GST portal password, or your OTP

We will never ask for your GST portal password.

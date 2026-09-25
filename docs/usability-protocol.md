# Usability testing protocol

**Status: not yet run. No human participants have used this application.**

The targets below are things to *measure*, not claims. Nothing in this
repository should be read as asserting any of them has been achieved.

---

## Targets

| Target | How to measure |
|---|---|
| First simple invoice in under 3 minutes | From landing on Home (business details to hand) to a bill issued. Excludes sign-in delays outside our control |
| Repeat invoice in under 30 seconds | After setup, from Home to a second bill issued for the same customer |
| Quick bill in under 45 seconds | Walk-in bill with three saved items, from Home to issued |
| 80% of 8–10 owners complete first billing unaided | No help beyond "here is the app" |
| AI entry saves time versus the form, without adding unnoticed errors | Compare completion time **and** error rate on complex instructions |
| 80% complete the prepared-data GST task within 5 minutes | Import fixtures, resolve one mismatch, produce the pack |
| Every participant distinguishes Prepared, Uploaded and Filed | Asked directly at the end |

Note the second half of the AI target. Faster entry that introduces errors
nobody notices is a worse product, not a better one.

---

## Participants

Eight to ten owners of very small Indian businesses: freelancers, consultants,
home businesses, repair providers, monthly service providers. Mixed GST status —
some registered, some not. Mixed comfort with apps. Mixed languages, including
participants who would naturally speak Hindi or mix Hindi and English.

Their own phone, their own network. Not a lab device on office wifi.

---

## Tasks

Give each participant the scenario and nothing else. Do not demonstrate.

### 1. First invoice
> You have just installed this. Bill your customer ₹5,000 for this month's work.

Watch for: whether they find Create bill; whether GST status blocks them and
whether the message helps; whether they understand that issuing is final.

### 2. Walk-in bill
> Someone walked in, you fixed their fan for ₹350, they paid cash. Record it.

Watch for: whether they choose Quick bill; whether they try to create a customer
record when they do not need one; whether recording payment is obvious.

### 3. Duplicate with a changed quantity
> Bill the same customer as last month, but this time it was three visits, not two.

Watch for: whether they find Duplicate; whether they expect the payment status
to carry over (it must not); whether they notice the new bill has no number yet.

### 4. Monthly schedule, one-off change, skipped month
> Set this customer up to be billed every month. Next month only, add ₹500. The
> month after, skip it.

Watch for: whether "we will prepare a draft for you to review" is understood as
*not* sending; whether "this invoice only" versus "this and future" is clear;
whether skipping feels safe.

### 5. Interrupted draft, then part payment
> Start a bill, then put your phone away mid-way. Come back, finish it, issue
> it. Your customer pays half.

Watch for: whether the draft is still there; whether the save status was noticed
and believed; whether "Part paid" is understood.

### 6. AI entry, with deliberate ambiguity
> Tell the app: "Bill Sharma for two repair visits at 800 each and some spare
> parts."

There are two customers whose names contain "Sharma", and no price for the
parts. Watch for: whether the disambiguation question is understood; whether the
missing price is noticed; **whether the participant checks what was filled in or
simply issues it.** That last one is the finding that matters.

### 7. GST, with prepared data
> Prepare your GST for last month. Here are your purchase bills and your GSTR-2B.

One deliberate mismatch is seeded. Watch for: whether the four steps read as a
sequence; whether the credit decision is understood as theirs to make; whether
they can produce the accountant pack; **whether they believe the return has been
filed.**

---

## Measuring

For each task: time to complete, completed unaided yes/no, number of times they
went the wrong way, requests for help, and errors made.

Separately, and most importantly: **errors they did not notice.** Seed a wrong
customer or a wrong amount in one task per participant and record whether they
catch it before issuing. A fast flow that lets a wrong bill through is a failure
even if every timing target is met.

---

## Closing questions

1. What does "Ready" mean, as opposed to "Filed"?
2. When you tapped Share, was your customer sent the bill?
3. What happens next month with the monthly bill you set up?
4. Whose decision is it whether you can claim credit on a purchase?
5. Was anything confusing, or did anything feel risky?

Question 2 and question 4 are the honesty checks. If participants believe
sharing delivered the bill, or that the app decided their credit for them, the
wording has failed regardless of how fast they were.

---

## Reporting

Report what happened, including tasks nobody completed. Do not average away a
participant who gave up. If fewer than eight take part, say so and do not
generalise.

Until this has been run, the acceptance report must continue to say **user
validation pending**.

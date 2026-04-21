const express = require("express");
const { Resend } = require("resend");

const app = express();
const resend = new Resend(process.env.RESEND_API_KEY);

// Parse raw body for webhook signature verification
app.use(
  express.json({
    verify: (req, _res, buf) => {
      req.rawBody = buf.toString();
    },
  }),
);

app.post("/webhook", async (req, res) => {
  try {
    // Optional: Verify the webhook is genuinely from Resend
    if (process.env.RESEND_WEBHOOK_SECRET) {
      resend.webhooks.verify({
        payload: req.rawBody,
        headers: {
          id: req.headers["svix-id"],
          timestamp: req.headers["svix-timestamp"],
          signature: req.headers["svix-signature"],
        },
        webhookSecret: process.env.RESEND_WEBHOOK_SECRET,
      });
    }

    const event = req.body;

    if (event.type === "email.received") {
      const emailId = event.data.email_id;
      const originalTo = event.data.to?.[0] || "unknown";
      const subject = event.data.subject || "(no subject)";

      const recipients = process.env.FORWARD_TO.split(",").map((e) =>
        e.trim(),
      ).filter(Boolean);

      console.log(
        `Forwarding email "${subject}" (id: ${emailId}) to ${recipients.join(", ")}`,
      );

      const results = await Promise.all(
        recipients.map((to) =>
          resend.emails.receiving.forward({
            emailId,
            to,
            from: `Forward <forward@${process.env.SENDING_DOMAIN}>`,
          }),
        ),
      );

      const errors = results.filter((r) => r.error);
      if (errors.length) {
        console.error("Forward errors:", errors.map((e) => e.error));
        return res.status(500).json({ errors: errors.map((e) => e.error) });
      }

      const data = results.map((r) => r.data);
      console.log("Forwarded successfully:", data);
      return res.status(200).json({ forwarded: true, data });
    }

    // Acknowledge other event types
    return res.status(200).json({ received: true });
  } catch (err) {
    console.error("Webhook error:", err.message);
    return res.status(400).json({ error: err.message });
  }
});

app.get("/health", (_req, res) => res.json({ status: "ok" }));

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Webhook server running on port ${PORT}`));

import nodemailer from "nodemailer";

let transporter = null;

const createTransporter = () => {
  if (transporter) return transporter;

  // 1️⃣ SMTP method (primary)
  if (
    process.env.SMTP_HOST &&
    process.env.SMTP_PORT &&
    process.env.SMTP_USER &&
    process.env.SMTP_PASS
  ) {
    transporter = nodemailer.createTransport({
      host: process.env.SMTP_HOST,
      port: Number(process.env.SMTP_PORT),
      secure: process.env.SMTP_SECURE === "true",
      auth: {
        user: process.env.SMTP_USER,
        pass: process.env.SMTP_PASS,
      },
    });
    return transporter;
  }

  // 2️⃣ Gmail (fallback)
  if (process.env.EMAIL_USER && process.env.EMAIL_PASS) {
    transporter = nodemailer.createTransport({
      service: "gmail",
      auth: {
        user: process.env.EMAIL_USER,
        pass: process.env.EMAIL_PASS,
      },
    });
    return transporter;
  }

  throw new Error("Email not configured. Add SMTP or Gmail credentials in .env");
};

const sendEmail = async (to, subject, text) => {
  const mailTransporter = createTransporter();
  await mailTransporter.sendMail({
    from: process.env.SMTP_USER || process.env.EMAIL_USER,
    to,
    subject,
    text,
  });
};

export default sendEmail;


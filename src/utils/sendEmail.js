const nodemailer = require('nodemailer');

const transporter = nodemailer.createTransport({
  // Configure your SMTP settings here
  host: process.env.SMTP_HOST,
  port: process.env.SMTP_PORT,
  secure: false, // true for 465, false for other ports
  auth: {
    user: process.env.SMTP_USER,
    pass: process.env.SMTP_PASS,
  },
});

async function sendPasswordResetEmail(to, token) {
  const resetUrl = `${process.env.FRONTEND_URL}/reset-password?token=${token}`;
  const mailOptions = {
    from: process.env.SMTP_FROM,
    to,
    subject: 'Password Reset Request',
    text: `You requested a password reset. Click the link to reset your password: ${resetUrl}`,
    html: `<p>You requested a password reset.</p><p><a href="${resetUrl}">Reset your password</a></p>`
  };
  try {
    await transporter.sendMail(mailOptions);
    return true;
  } catch (err) {
    console.error('Error sending password reset email:', err);
    return false;
  }
}

module.exports = { sendPasswordResetEmail }; 
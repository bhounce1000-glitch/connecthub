const nodemailer = require('nodemailer');

const EMAIL_FROM = process.env.EMAIL_FROM || 'no-reply@connecthub.app';
const EMAIL_USER = process.env.EMAIL_USER;
const EMAIL_PASS = process.env.EMAIL_PASS;

const transporter = nodemailer.createTransport({
  service: 'gmail',
  auth: {
    user: EMAIL_USER,
    pass: EMAIL_PASS,
  },
});

function maskNumber(number) {
  if (!number) return '';
  const str = String(number);
  if (str.length < 4) return '****';
  return str.slice(0, 2) + '****' + str.slice(-2);
}

async function sendPaymentReceiptEmail(data) {
  const {
    senderEmail,
    senderName,
    senderNumber,
    receiverEmail,
    receiverName,
    receiverNumber,
    jobTitle,
    transactionId,
    amount,
    commission,
    netAmount,
    paymentMethod,
    timestamp,
    status,
  } = data;

  const subject = `Payment Receipt — ${jobTitle}`;
  const html = `
    <h2>Payment Receipt</h2>
    <p><b>Transaction ID:</b> ${transactionId}</p>
    <p><b>Job Title:</b> ${jobTitle}</p>
    <p><b>Sender:</b> ${senderName} (${maskNumber(senderNumber)})</p>
    <p><b>Receiver:</b> ${receiverName} (${maskNumber(receiverNumber)})</p>
    <p><b>Amount:</b> GHS ${Number(amount).toFixed(2)}</p>
    <p><b>Commission Deducted:</b> GHS ${Number(commission).toFixed(2)}</p>
    <p><b>Net Amount Received:</b> GHS ${Number(netAmount).toFixed(2)}</p>
    <p><b>Payment Method:</b> ${paymentMethod}</p>
    <p><b>Timestamp:</b> ${timestamp}</p>
    <p><b>Status:</b> ${status}</p>
    <hr />
    <p>Keep this receipt for your records.</p>
  `;

  const mailOptions = {
    from: EMAIL_FROM,
    to: [senderEmail, receiverEmail],
    subject,
    html,
  };

  await transporter.sendMail(mailOptions);
}

async function sendKycSubmissionEmail({ email, name }) {
  const displayName = name || email;
  const subject = 'KYC Submitted — We\'ve received your verification';
  const html = `
    <h2>Identity Verification Received</h2>
    <p>Hi ${displayName},</p>
    <p>Thank you for submitting your identity verification on <b>ConnectHub</b>.</p>
    <p>Our team will review your documents and notify you once the process is complete. This usually takes <b>1–2 business days</b>.</p>
    <p>If you have any questions, reply to this email.</p>
    <hr />
    <p style="color:#888;font-size:12px;">ConnectHub · connecthub-1873e.web.app</p>
  `;
  await transporter.sendMail({ from: EMAIL_FROM, to: email, subject, html });
}

async function sendKycApprovalEmail({ email, name }) {
  const displayName = name || email;
  const subject = 'KYC Approved — You\'re verified on ConnectHub!';
  const html = `
    <h2>Identity Verification Approved ✅</h2>
    <p>Hi ${displayName},</p>
    <p>Great news! Your identity has been <b>verified</b> on ConnectHub.</p>
    <p>You now have full access to all ConnectHub features — start exploring service providers or accepting jobs today.</p>
    <a href="https://connecthub-1873e.web.app" style="display:inline-block;padding:10px 20px;background:#6366f1;color:#fff;border-radius:6px;text-decoration:none;font-weight:bold;">Open ConnectHub</a>
    <hr />
    <p style="color:#888;font-size:12px;">ConnectHub · connecthub-1873e.web.app</p>
  `;
  await transporter.sendMail({ from: EMAIL_FROM, to: email, subject, html });
}

async function sendKycRejectionEmail({ email, name, reason }) {
  const displayName = name || email;
  const subject = 'KYC Update — Action required on ConnectHub';
  const html = `
    <h2>Identity Verification Not Approved</h2>
    <p>Hi ${displayName},</p>
    <p>Unfortunately, we were unable to verify your identity at this time.</p>
    <p><b>Reason:</b> ${reason || 'Documents did not meet our verification requirements.'}</p>
    <p>Please <a href="https://connecthub-1873e.web.app/kyc/step1">resubmit your KYC</a> with the correct documents.</p>
    <p>If you believe this is an error, reply to this email.</p>
    <hr />
    <p style="color:#888;font-size:12px;">ConnectHub · connecthub-1873e.web.app</p>
  `;
  await transporter.sendMail({ from: EMAIL_FROM, to: email, subject, html });
}

module.exports = { sendPaymentReceiptEmail, sendKycSubmissionEmail, sendKycApprovalEmail, sendKycRejectionEmail };

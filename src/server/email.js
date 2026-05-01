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

module.exports = { sendPaymentReceiptEmail };

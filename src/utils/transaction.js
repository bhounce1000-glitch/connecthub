import { addDoc, collection, serverTimestamp } from 'firebase/firestore';
import { db } from '../firebase';

/**
 * Create a transaction record in Firestore
 * @param {Object} tx - Transaction data
 * @returns {Promise<string>} Transaction document ID
 */
export async function createTransactionRecord(tx) {
  // Add participants array for querying
  const txDoc = {
    ...tx,
    participants: [tx.senderEmail, tx.receiverEmail].filter(Boolean),
    timestamp: serverTimestamp(),
  };
  const docRef = await addDoc(collection(db, 'transactions'), txDoc);

  // Notifications for sender and receiver
  const notifications = [];
  if (tx.senderEmail) {
    notifications.push({
      userId: tx.senderEmail,
      title: 'Payment Confirmed',
      body: `Payment of GHS ${Number(tx.amount).toFixed(2)} for ${tx.jobTitle || 'a job'} has been processed.`,
      type: 'payment',
      transactionId: tx.transactionId,
      read: false,
      createdAt: serverTimestamp(),
    });
  }
  if (tx.receiverEmail) {
    notifications.push({
      userId: tx.receiverEmail,
      title: 'Payment Confirmed',
      body: `Payment of GHS ${Number(tx.amount).toFixed(2)} for ${tx.jobTitle || 'a job'} has been processed.`,
      type: 'payment',
      transactionId: tx.transactionId,
      read: false,
      createdAt: serverTimestamp(),
    });
  }
  await Promise.all(
    notifications.map((n) => addDoc(collection(db, 'notifications'), n))
  );

  return docRef.id;
}
